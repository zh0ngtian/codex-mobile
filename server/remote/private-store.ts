import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';

const MAX_RECORD_BYTES = 1024 * 1024;
function failure(): Error { return new Error('Remote 私有存储不可用或记录损坏'); }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function owned(stat: { uid: number }): boolean { return !process.getuid || stat.uid === process.getuid(); }

/** 仅负责自己的目录；不会修复或 chmod 既有父目录。 */
export class PrivateStore {
  readonly directory: string;
  constructor(directory = join(homedir(), '.codex-mobile', 'remote')) {
    if (!isAbsolute(directory) || directory.split('/').some(part => part === '.' || part === '..')) throw failure();
    this.directory = resolve(directory);
    if ([parse(this.directory).root, homedir(), tmpdir()].some(path => resolve(path) === this.directory)) throw failure();
  }
  private filename(name: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name) || name.includes('..')) throw failure();
    return join(this.directory, name);
  }
  private async directoryReady(): Promise<void> {
    const parts: string[] = [];
    for (let path = this.directory; path !== dirname(path); path = dirname(path)) parts.unshift(path);
    for (const path of parts) {
      try {
        const stat = await lstat(path);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure();
      } catch (error) {
        if (!missing(error)) throw failure();
        try { await mkdir(path, { mode: 0o700 }); }
        catch (createError) { if ((createError as NodeJS.ErrnoException)?.code !== 'EEXIST') throw failure(); }
        const stat = await lstat(path);
        if (stat.isSymbolicLink() || !stat.isDirectory() || !owned(stat)) throw failure();
      }
    }
    const stat = await lstat(this.directory);
    if (!owned(stat)) throw failure();
    await chmod(this.directory, 0o700);
  }
  private async checkFile(path: string): Promise<void> {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || !owned(stat)) throw failure();
    } catch (error) { if (!missing(error)) throw failure(); }
  }
  async readJson(name: string): Promise<unknown | null> {
    const path = this.filename(name);
    try {
      await this.directoryReady(); await this.checkFile(path);
      let handle;
      try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) { if (missing(error)) return null; throw error; }
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink > 1 || !owned(stat) || stat.size > MAX_RECORD_BYTES) throw failure();
        await handle.chmod(0o600);
        const bytes = await handle.readFile();
        if (bytes.length > MAX_RECORD_BYTES) throw failure();
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
      } finally { await handle.close(); }
    } catch { throw failure(); }
  }
  async writeJson(name: string, value: unknown): Promise<void> {
    const path = this.filename(name);
    let temporary: string | undefined;
    try {
      const encoded = JSON.stringify(value);
      if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_RECORD_BYTES) throw failure();
      await this.directoryReady(); await this.checkFile(path);
      temporary = join(this.directory, `.tmp-${randomUUID()}`);
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.chmod(0o600); await handle.writeFile(encoded); await handle.sync(); } finally { await handle.close(); }
      // 写入前重新验证路径，避免覆盖显式符号链接或危险目标。
      await this.directoryReady(); await this.checkFile(path);
      await rename(temporary, path); temporary = undefined;
      const directory = await open(this.directory, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { throw failure(); }
    finally { if (temporary) await unlink(temporary).catch(() => undefined); }
  }
}
