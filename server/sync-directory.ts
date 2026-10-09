import { open } from "node:fs/promises";

export async function syncDirectory(directory: string, platform: NodeJS.Platform = process.platform) {
  // Windows 不支持目录句柄 fsync；调用方仍须同步文件内容并原子重命名。
  // macOS/Linux 保留原有目录持久化语义，同步错误不得被静默忽略。
  if (platform === "win32") return;
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
