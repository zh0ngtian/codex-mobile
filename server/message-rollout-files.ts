import { opendir, readdir } from "node:fs/promises";
import { join } from "node:path";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

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

/** 文件名只负责定位；每个读取器仍核对首行 session_meta.id。 */
export async function* messageRolloutFiles(codexHome: string, threadId: string): AsyncGenerator<string> {
  if (!UUID.test(threadId)) return;
  const directories = new Set<string>();
  if (threadId[14] === "7") {
    const created = Number.parseInt(threadId.replaceAll("-", "").slice(0, 12), 16);
    for (const offset of [0, -86_400_000, 86_400_000]) {
      const date = new Date(created + offset);
      for (const utc of [true, false]) {
        directories.add(join(codexHome, "sessions", String(utc ? date.getUTCFullYear() : date.getFullYear()),
          String((utc ? date.getUTCMonth() : date.getMonth()) + 1).padStart(2, "0"),
          String(utc ? date.getUTCDate() : date.getDate()).padStart(2, "0")));
      }
    }
  }
  directories.add(join(codexHome, "archived_sessions"));
  // 续写 rollout 可带 _UUID 后缀；文件名仅用于定位，必须再验证 session_meta.id。
  const filename = new RegExp(`-${threadId}(?:_[a-f0-9-]{36})*\\.jsonl$`, "i");
  const scan = async function* (directory: string) {
    const names = await readdir(directory).catch(() => []);
    if (names.length > 10_000) return;
    for (const name of names.sort()) {
      if (name.startsWith("rollout-") && filename.test(name)) yield join(directory, name);
    }
  };
  for (const directory of directories) yield* scan(directory);
  for await (const directory of dateDirectories(join(codexHome, "sessions"))) {
    if (!directories.has(directory)) yield* scan(directory);
  }
}
