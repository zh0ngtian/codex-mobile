import type { Stats } from 'node:fs';
import { lstat, mkdtemp, rename, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
type Identity = Pick<Stats, 'dev' | 'ino'>;
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
/**
 * 公开路径的stat不能授权稍后的unlink。先原子捕获到私有随机目录，再验证捕获物。
 * 捕获到替换物时保留原inode并失败关闭，绝不向可能已替换的父目录恢复。
 * 隔离目录放在锁目录外，避免崩溃残留改变原有非空目录rename竞争协议。
 */
export async function removeExactEntry(options: {
  path: string;
  identity: Identity;
  directory: string;
  assertSource(): Promise<void>;
  assertDirectory(): Promise<void>;
  validate(stat: Stats): void;
}): Promise<boolean> {
  await options.assertDirectory();
  await options.assertSource();
  let before: Stats;
  try { before = await lstat(options.path); }
  catch (error) { if (missing(error)) return false; throw error; }
  if (!same(before, options.identity)) return false;
  options.validate(before);
  const capture = await mkdtemp(join(options.directory, '.cleanup-'));
  const held = join(capture, 'entry');
  let captured = false;
  try {
    await options.assertDirectory();
    await options.assertSource();
    try { await rename(options.path, held); captured = true; }
    catch (error) { if (missing(error)) return false; throw error; }
    await options.assertDirectory();
    const actual = await lstat(held);
    if (!same(actual, options.identity)) throw new Error('Remote 精确清理目标已变化');
    options.validate(actual);
    await unlink(held);
    captured = false;
    return true;
  } finally {
    if (!captured) await rmdir(capture);
  }
}
