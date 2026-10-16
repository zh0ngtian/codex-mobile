import { createReadStream } from "node:fs";
import { opendir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

type RecordValue = Record<string, any>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const MAX_FILES = 32;
const MAX_IDS = 2048;
type Cached = { signature: string; checked: Set<string>; times: Record<string, number> };

// 固定三层数字日期目录逐项枚举，不递归其他路径，也不缓存目录缺失结果。
async function* dateDirectories(sessions: string): AsyncGenerator<string> {
  async function* children(parent: string, pattern: RegExp): AsyncGenerator<string> {
    let directory;
    try { directory = await opendir(parent); } catch { return; }
    try {
      for await (const entry of directory) {
        if (entry.isDirectory() && pattern.test(entry.name)) yield join(parent, entry.name);
      }
    } catch { /* 目录在枚举期间移除或不可读时，继续其他日期。 */ }
  }
  for await (const year of children(sessions, /^\d{4}$/)) {
    for await (const month of children(year, /^(0[1-9]|1[0-2])$/)) {
      yield* children(month, /^(0[1-9]|[12]\d|3[01])$/);
    }
  }
}

/** 只读原始 rollout；内存只缓存所请求消息的 ID 与真实时间，不保存正文。 */
export class MessageTimestamps {
  private cache = new Map<string, Cached>();
  constructor(private codexHome: string) {}

  async read(threadId: string, messageIds: string[]): Promise<Record<string, number>> {
    if (!UUID.test(threadId)) return {};
    const wanted = new Set(messageIds.filter(id => typeof id === "string" && MESSAGE_ID.test(id)));
    if (!wanted.size) return {};
    const directories = new Set<string>();
    if (threadId[14] === "7") {
      const created = Number.parseInt(threadId.replaceAll("-", "").slice(0, 12), 16);
      for (const offset of [0, -86_400_000, 86_400_000]) {
        const date = new Date(created + offset);
        for (const utc of [true, false]) {
          directories.add(join(this.codexHome, "sessions", String(utc ? date.getUTCFullYear() : date.getFullYear()),
            String((utc ? date.getUTCMonth() : date.getMonth()) + 1).padStart(2, "0"),
            String(utc ? date.getUTCDate() : date.getDate()).padStart(2, "0")));
        }
      }
    }
    directories.add(join(this.codexHome, "archived_sessions"));
    const found: Record<string, number> = Object.create(null);
    // 续写 rollout 可带 _UUID 后缀；文件名仅用于定位，必须再验证 session_meta.id。
    const filename = new RegExp(`-${threadId}(?:_[a-f0-9-]{36})*\\.jsonl$`, "i");
    const scanDirectory = async (directory: string) => {
      const names = await readdir(directory).catch(() => []);
      if (names.length > 10_000) return;
      for (const name of names.sort()) {
        if (!name.startsWith("rollout-") || !filename.test(name)) continue;
        const missing = [...wanted].filter(id => found[id] === undefined);
        if (!missing.length) return;
        const times = await this.readFile(join(directory, name), threadId, missing);
        Object.assign(found, times);
      }
    };
    for (const directory of directories) {
      await scanDirectory(directory);
      if (Object.keys(found).length === wanted.size) return found;
    }
    // v7 日期只作快速定位；续写可以跨天，旧格式 UUID 也可能仍位于活动目录。
    for await (const directory of dateDirectories(join(this.codexHome, "sessions"))) {
      if (directories.has(directory)) continue;
      await scanDirectory(directory);
      if (Object.keys(found).length === wanted.size) return found;
    }
    return found;
  }

  private async readFile(path: string, threadId: string, wanted: string[]): Promise<Record<string, number>> {
    try {
      const file = await stat(path);
      const signature = `${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`;
      const previous = this.cache.get(path);
      if (previous?.signature === signature && wanted.every(id => previous.checked.has(id))) {
        return Object.fromEntries(wanted.filter(id => Object.hasOwn(previous.times, id)).map(id => [id, previous.times[id]]));
      }
      const ids = new Set(wanted);
      const times: Record<string, number> = Object.create(null);
      const stream = createReadStream(path);
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      let first = true;
      try {
        for await (const line of lines) {
          if (first) {
            first = false;
            try {
              const meta = JSON.parse(line);
              if (meta?.type !== "session_meta" || meta.payload?.id !== threadId) return {};
            } catch { return {}; }
            continue;
          }
          try {
            const entry = JSON.parse(line);
            const item = entry?.payload;
            if (entry?.type !== "response_item" || item?.type !== "message" || item.role !== "assistant" ||
              !ids.has(item.id) || times[item.id] !== undefined || typeof entry.timestamp !== "string") continue;
            const timestamp = Date.parse(entry.timestamp) / 1000;
            if (Number.isFinite(timestamp) && timestamp > 0) times[item.id] = timestamp;
          } catch { /* 忽略损坏及尚未写完的行；追加后按文件版本重新扫描。 */ }
        }
      } finally { lines.close(); stream.destroy(); }
      const checked = new Set(wanted.slice(0, MAX_IDS));
      const cachedTimes = Object.fromEntries(Object.entries(times).filter(([id]) => checked.has(id)));
      this.cache.delete(path);
      this.cache.set(path, { signature, checked, times: cachedTimes });
      while (this.cache.size > MAX_FILES) this.cache.delete(this.cache.keys().next().value!);
      return times;
    } catch { return {}; }
  }

  async result(threadId: string, result: RecordValue): Promise<RecordValue> {
    if (!Array.isArray(result?.data)) return result;
    const turns = result.data;
    const ids = turns.flatMap((turn: RecordValue) => (turn.items ?? [])
      .filter((item: RecordValue) => item.type === "agentMessage" && typeof item.id === "string")
      .map((item: RecordValue) => item.id));
    const times = await this.read(threadId, ids);
    return { ...result, data: turns.map((turn: RecordValue) => ({ ...turn,
      items: (turn.items ?? []).map((item: RecordValue) => item.type === "agentMessage" && Object.hasOwn(times, item.id)
        ? { ...item, timestamp: times[item.id] } : item),
    })) };
  }

  async notification<T extends RecordValue>(message: T): Promise<T> {
    const item = message.params?.item;
    if (message.method !== "item/completed" || item?.type !== "agentMessage" || item.phase !== "commentary" ||
      typeof message.params?.threadId !== "string" || typeof item.id !== "string") return message;
    const times = await this.read(message.params.threadId, [item.id]);
    return !Object.hasOwn(times, item.id) ? message : { ...message, params: { ...message.params,
      item: { ...item, timestamp: times[item.id] },
    } };
  }
}
