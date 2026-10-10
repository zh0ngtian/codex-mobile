import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_METADATA_BYTES = 64 * 1024;

/** 完成推送的本机分类补查：只读取 rollout 首行，不加载会话正文。 */
export async function readLocalThreadMetadata(codexHome: string, threadId: string) {
  if (!UUID.test(threadId)) return;
  const directories = new Set<string>();
  if (threadId[14] === "7") {
    const stamp = Number.parseInt(threadId.replaceAll("-", "").slice(0, 12), 16);
    for (const offset of [0, -86_400_000, 86_400_000]) {
      const date = new Date(stamp + offset);
      for (const utc of [true, false]) {
        const year = utc ? date.getUTCFullYear() : date.getFullYear();
        const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
        const day = utc ? date.getUTCDate() : date.getDate();
        directories.add(join(codexHome, "sessions", String(year), String(month).padStart(2, "0"), String(day).padStart(2, "0")));
      }
    }
  }
  directories.add(join(codexHome, "archived_sessions"));
  for (const directory of directories) {
    let names: string[];
    try { names = await readdir(directory); } catch { continue; }
    if (names.length > 10_000) continue;
    for (const name of names) {
      if (!name.startsWith("rollout-") || !name.endsWith(`-${threadId}.jsonl`)) continue;
      try {
        const file = await open(join(directory, name), "r");
        let text: string;
        try {
          const buffer = Buffer.alloc(MAX_METADATA_BYTES);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          text = buffer.subarray(0, bytesRead).toString("utf8");
        } finally { await file.close(); }
        const newline = text.indexOf("\n");
        if (newline < 0) continue;
        const record = JSON.parse(text.slice(0, newline));
        const payload = record?.payload;
        if (record?.type !== "session_meta" || payload?.id !== threadId) continue;
        return {
          id: threadId,
          source: payload.source,
          threadSource: payload.thread_source,
          parentThreadId: payload.parent_thread_id,
          ephemeral: payload.ephemeral,
        };
      } catch { /* 缺文件、正在写入或无效元数据不影响普通会话完成通知。 */ }
    }
  }
}
