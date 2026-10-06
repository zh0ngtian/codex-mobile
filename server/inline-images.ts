import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

type RecordValue = Record<string, any>;
const extensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/avif": "avif",
};
const cacheFile = /^image-[a-f0-9]{64}\.(png|jpg|gif|webp|avif)$/;

/** 原图仅保存在设备侧；历史响应携带引用，缩略图与原图复用现有鉴权接口。 */
export class InlineImages {
  private pending = new Map<string, Promise<string>>();
  private writes = Promise.resolve();

  constructor(private root: string, private maxBytes = 256 * 1024 * 1024) {}

  private async retain(bytes: Buffer, extension: string) {
    const path = join(this.root, `image-${createHash("sha256").update(bytes).digest("hex")}.${extension}`);
    const pending = this.pending.get(path);
    if (pending) return pending;
    const write = this.writes.then(async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const existing = await stat(path).catch(() => null);
      if (existing?.isFile() && existing.size === bytes.length) return path;
      const temporary = join(this.root, `${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
        await rename(temporary, path);
      } finally { await unlink(temporary).catch(() => {}); }
      const files = await Promise.all((await readdir(this.root)).filter(name => cacheFile.test(name)).map(async name => {
        const file = join(this.root, name); const info = await stat(file);
        return { path: file, bytes: info.size, modified: info.mtimeMs };
      }));
      let size = files.reduce((sum, file) => sum + file.bytes, 0);
      let count = files.length;
      for (const file of files.filter(file => file.path !== path).sort((a, b) => a.modified - b.modified)) {
        if (size <= this.maxBytes && count <= 512) break;
        await unlink(file.path); size -= file.bytes; count -= 1;
      }
      return path;
    });
    this.pending.set(path, write);
    this.writes = write.then(() => {}, () => {});
    try { return await write; } finally { if (this.pending.get(path) === write) this.pending.delete(path); }
  }

  private async image(source: unknown) {
    if (typeof source !== "string") return null;
    const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source);
    if (!match || !extensions[match[1].toLowerCase()] || match[2].length > Math.min(this.maxBytes, 64 * 1024 * 1024) * 4 / 3 + 4) return null;
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > this.maxBytes || bytes.toString("base64").replace(/=+$/, "") !== match[2].replace(/=+$/, "")) return null;
    try { return await this.retain(bytes, extensions[match[1].toLowerCase()]); }
    catch { return null; } // 缓存不可写时保留完整原协议响应，不让文字加载失败。
  }

  private async item(item: RecordValue): Promise<RecordValue> {
    if (item.type === "userMessage" && Array.isArray(item.content)) {
      return { ...item, content: await Promise.all(item.content.map(async (part: RecordValue) => {
        const path = part.type === "image" ? await this.image(part.url) : null;
        return path ? { ...part, url: path, name: part.name || "图片" } : part;
      })) };
    }
    if (item.type === "imageGeneration" && typeof item.result === "string" && /^data:/i.test(item.result)) {
      const path = typeof item.savedPath === "string" && isAbsolute(item.savedPath) ? item.savedPath : await this.image(item.result);
      if (path) { const { result: _result, ...rest } = item; return { ...rest, savedPath: path }; }
    }
    return item;
  }

  private async turn(turn: RecordValue) {
    return Array.isArray(turn.items) ? { ...turn, items: await Promise.all(turn.items.map((item: RecordValue) => this.item(item))) } : this.item(turn);
  }

  async result(result: RecordValue): Promise<RecordValue> {
    return {
      ...result,
      ...(Array.isArray(result.data) ? { data: await Promise.all(result.data.map((turn: RecordValue) => this.turn(turn))) } : {}),
      ...(result.thread ? { thread: {
        ...result.thread,
        ...(Array.isArray(result.thread.turns) ? { turns: await Promise.all(result.thread.turns.map((turn: RecordValue) => this.turn(turn))) } : {}),
      } } : {}),
      ...(result.initialTurnsPage ? { initialTurnsPage: await this.result(result.initialTurnsPage) } : {}),
    };
  }

  async notification(message: RecordValue) {
    const params = message.params;
    if (!params) return message;
    return { ...message, params: {
      ...params,
      ...(params.item ? { item: await this.item(params.item) } : {}),
      ...(params.turn ? { turn: await this.turn(params.turn) } : {}),
      ...(params.thread ? { thread: (await this.result({ thread: params.thread })).thread } : {}),
    } };
  }
}
