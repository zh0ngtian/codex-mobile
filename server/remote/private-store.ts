import { constants, type Stats } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, rmdir, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { removeExactEntry } from './exact-cleanup.js';

const MAX_RECORD_BYTES = 1024 * 1024;
function failure(): Error { return new Error('Remote 私有存储不可用或记录损坏'); }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
type FileIdentity = Pick<Stats, 'dev' | 'ino'>;
function sameFile(a: FileIdentity, b: FileIdentity): boolean { return a.dev === b.dev && a.ino === b.ino; }
function owned(stat: { uid: number }): boolean { return !process.getuid || stat.uid === process.getuid(); }
class LockDirectoryChanged extends Error { constructor() { super('Remote 私有存储不可用或记录损坏'); } }

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
  async writeJson(name: string, value: unknown): Promise<void> { await this.withInitialization(`record-${name}`, () => this.persist(name, value, true)); }
  /** 首次发布完整文件：已存在时绝不替换，即使既有内容损坏。 */
  async createJson(name: string, value: unknown): Promise<boolean> { return this.withInitialization(`record-${name}`, () => this.persist(name, value, false)); }
  private async syncDirectory(path = this.directory): Promise<void> {
    const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  }
  private async persist(name: string, value: unknown, replace: boolean): Promise<boolean> {
    const path = this.filename(name);
    let temporary: string | undefined;
    try {
      const encoded = JSON.stringify(value);
      if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_RECORD_BYTES) throw failure();
      await this.directoryReady(); await this.checkFile(path);
      if (!replace) {
        try { await lstat(path); return false; }
        catch (error) { if (!missing(error)) throw error; }
      }
      temporary = join(this.directory, `.tmp-${randomUUID()}`);
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.chmod(0o600); await handle.writeFile(encoded); await handle.sync(); } finally { await handle.close(); }
      // 写入前重新验证路径，避免覆盖显式符号链接或危险目标。
      await this.directoryReady(); await this.checkFile(path);
      // 全部合法 writer 共用记录级事务；完整临时文件 rename 无硬链接中间态。
      await rename(temporary, path); temporary = undefined;
      await this.syncDirectory();
      return true;
    } catch { throw failure(); }
    finally { if (temporary) await unlink(temporary).catch(() => undefined); }
  }

  /**
   * 原子发布非空目录取得跨进程锁；活跃锁永远含唯一 owner 文件。
   * 不按年龄抢锁。只回收已确认退出进程的确切 owner，PID 仍活跃或无法
   * 证明死亡时有界等待；随机文件名使旧回收者不能删除新 owner。
   */
  async withInitialization<T>(name: string, operation: () => Promise<T>, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<T> {
    this.filename(name);
    const timeoutMs = options.timeoutMs ?? 150000; const pollMs = options.pollMs ?? 25;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000 || !Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 1000) throw failure();
    await this.directoryReady();
    await this.cleanupDeadPreparations();
    const lockPath = join(this.directory, `.init-${name}.lock`);
    const nonce = randomUUID(); const ownerName = `owner-${process.pid}-${nonce}.json`;
    let prepared: string | undefined = join(this.directory, `.lock-prepare-${process.pid}-${nonce}`);
    let acquired = false; let directoryIdentity: FileIdentity | undefined; let ownerIdentity: FileIdentity | undefined;
    try {
      await mkdir(prepared, { mode: 0o700 }); await chmod(prepared, 0o700); directoryIdentity = await lstat(prepared);
      const owner = await open(join(prepared, ownerName), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await owner.chmod(0o600); ownerIdentity = await owner.stat(); await owner.writeFile(JSON.stringify({ version: 1, pid: process.pid, nonce })); await owner.sync(); }
      finally { await owner.close(); }
      await this.syncDirectory(prepared);
      const preparationPath = prepared;
      const deadline = performance.now() + timeoutMs;
      while (true) {
        await this.directoryReady();
        await this.inspectLockDirectory(lockPath);
        try {
          // rename 不会替换非空目录，目录和完整 owner 一起发布。
          await rename(preparationPath, lockPath); prepared = undefined; acquired = true;
          await this.syncDirectory(); break;
        } catch (error) {
          if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException)?.code ?? '')) throw failure();
        }
        await this.recoverDeadOwner(lockPath);
        if (performance.now() >= deadline) throw new Error('Remote 私有初始化等待超时');
        await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - performance.now()))));
      }
      return await operation();
    } finally {
      if (prepared && directoryIdentity) await this.removeLockOwner(prepared, ownerName, directoryIdentity, ownerIdentity);
      if (acquired) await this.removeLockOwner(lockPath, ownerName, directoryIdentity!, ownerIdentity);
    }
  }
  private async cleanupDeadPreparations(): Promise<void> {
    for (const entry of await readdir(this.directory)) {
      const match = /^\.lock-prepare-([1-9][0-9]*)-([a-f0-9-]{36})$/.exec(entry);
      if (!match || !Number.isSafeInteger(Number(match[1]))) continue;
      try { process.kill(Number(match[1]), 0); continue; }
      catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'ESRCH') continue; }
      const path = join(this.directory, entry);
      const directoryIdentity = await this.inspectLockDirectory(path); if (!directoryIdentity) continue;
      let entries: string[];
      try { entries = await readdir(path); } catch (error) { if (missing(error)) continue; throw failure(); }
      const ownerName = `owner-${match[1]}-${match[2]}.json`;
      // prepare 尚未发布；PID/nonce 都在唯一目录名中，可处理 owner 写入前崩溃。
      // 不递归删除未知内容，不按年龄回收活跃或无法证明已死的进程。
      if (entries.length === 0 || (entries.length === 1 && entries[0] === ownerName)) {
        let ownerIdentity: FileIdentity | undefined;
        try { const stat = await lstat(join(path, ownerName)); if (!stat.isFile() || !owned(stat) || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) throw failure(); ownerIdentity = stat; } catch (error) { if (!missing(error)) throw error; }
        await this.removeLockOwner(path, ownerName, directoryIdentity, ownerIdentity);
      }
    }
  }
  private async inspectLockDirectory(path: string): Promise<Stats | undefined> {
    try {
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !owned(stat) || (stat.mode & 0o777) !== 0o700) throw failure();
      return stat;
    } catch (error) { if (missing(error)) return undefined; throw failure(); }
  }
  private async recoverDeadOwner(path: string): Promise<void> {
    const directoryIdentity = await this.inspectLockDirectory(path); if (!directoryIdentity) return;
    let entries: string[];
    try { entries = await readdir(path); } catch (error) { if (missing(error)) return; throw failure(); }
    if (entries.length === 0) return; // rename 可原子替换崩溃留下的空目录。
    if (entries.length !== 1) throw failure();
    const name = entries[0]!;
    let owner: { pid: number; identity: FileIdentity };
    try { owner = await this.readLockOwner(path, name); }
    catch (error) { if (missing(error)) return; throw failure(); }
    try { process.kill(owner.pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ESRCH') return;
      try { await this.removeLockOwner(path, name, directoryIdentity, owner.identity); }
      catch (cleanupError) {
        if (!(cleanupError instanceof LockDirectoryChanged)) throw cleanupError;
        // 其他合法回收者可能已发布后继非空目录。只接受不同完整owner，
        // 不把同名替换、未知文件或捕获后的身份不匹配当作正常竞争。
        const nextDirectory = await this.inspectLockDirectory(path); if (!nextDirectory) return;
        if (sameFile(nextDirectory, directoryIdentity)) throw failure();
        const nextEntries = await readdir(path);
        if (nextEntries.length !== 1 || nextEntries[0] === name) throw failure();
        const nextName = nextEntries[0]!; const next = await this.readLockOwner(path, nextName);
        const nextFile = await lstat(join(path, nextName));
        const directoryAfter = await this.inspectLockDirectory(path);
        if (!directoryAfter || !sameFile(directoryAfter, nextDirectory) || !sameFile(nextFile, next.identity)) throw failure();
      }
      // EPERM、PID复用等无法证明owner已死的情况绝不解锁。
    }
  }
  private async readLockOwner(path: string, name: string): Promise<{ pid: number; identity: FileIdentity }> {
    const match = /^owner-([1-9][0-9]*)-([a-f0-9-]{36})\.json$/.exec(name);
    if (!match) throw failure();
    let record: unknown; let ownerIdentity: FileIdentity | undefined;
    try {
      const owner = await open(join(path, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await owner.stat();
        if (!stat.isFile() || !owned(stat) || stat.nlink > 1 || stat.size > 1024 || (stat.mode & 0o777) !== 0o600) throw failure();
        ownerIdentity = stat; record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await owner.readFile()));
      } finally { await owner.close(); }
    } catch (error) { if (missing(error)) throw error; throw failure(); }
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw failure();
    const value = record as Record<string, unknown>;
    if (value.version !== 1 || value.pid !== Number(match[1]) || !Number.isSafeInteger(value.pid) || value.nonce !== match[2]) throw failure();
    return { pid: value.pid as number, identity: ownerIdentity! };
  }
  private async removeLockOwner(path: string, ownerName: string, expectedDirectory: FileIdentity, expectedOwner?: FileIdentity): Promise<void> {
    const directory = await this.inspectLockDirectory(path); if (!directory) return;
    if (!sameFile(directory, expectedDirectory)) throw new LockDirectoryChanged();
    try {
      const root = await this.inspectLockDirectory(this.directory); if (!root) throw failure();
      const removed = expectedOwner ? await removeExactEntry({
        path: join(path, ownerName), identity: expectedOwner, directory: this.directory,
        assertDirectory: async () => {
          const current = await this.inspectLockDirectory(this.directory);
          if (!current || !sameFile(current, root)) throw failure();
        },
        assertSource: async () => {
          const current = await this.inspectLockDirectory(path);
          if (!current || !sameFile(current, expectedDirectory)) throw new LockDirectoryChanged();
        },
        validate: owner => {
          if (!owner.isFile() || !owned(owner) || owner.nlink !== 1 || (owner.mode & 0o777) !== 0o600) throw failure();
        },
      }) : false;
      if (!removed) {
        // 缺失owner可继续清理空目录；同名替换owner必须保留并拒绝。
        try { await lstat(join(path, ownerName)); throw failure(); }
        catch (error) { if (!missing(error)) throw error; }
      }
    } catch (error) { if (error instanceof LockDirectoryChanged) throw error; if (!missing(error)) throw failure(); }
    const recheck = await this.inspectLockDirectory(path); if (!recheck) return;
    // 自己的owner已移除后，合法竞争者可原子替换空目录；保留其新归属。
    if (!sameFile(recheck, expectedDirectory)) return;
    // 另一竞争者已发布新的非空目录时，rmdir会失败而保留新owner。
    try { await rmdir(path); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException)?.code ?? '')) throw failure(); }
    await this.syncDirectory();
  }
}
