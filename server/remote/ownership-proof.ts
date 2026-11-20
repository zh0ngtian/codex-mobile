import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from 'node:fs';
import { dirname, join } from 'node:path';
type Identity = Pick<Stats, 'dev' | 'ino'>;
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;
function unavailable(): Error {
  return new Error('Remote 私有归属已失效');
}
function directory(stat: Stats, owned: boolean): void {
  if (!stat.isDirectory() || stat.isSymbolicLink() || (owned && (!process.getuid || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700)))
    throw unavailable();
}
/** 可信进程内部证明；同步只读检查贴近动作，绝不重新采纳后来同名目录。 */
export class RemoteOwnershipProof {
  private readonly ancestors: {
    path: string;
    identity: Identity;
  }[] = [];
  private readonly paths: string[] = [];
  private readonly abort = new AbortController();
  readonly signal = this.abort.signal;
  private lock?: {
    path: string;
    directory: Identity;
    ownerName: string;
    owner: Identity;
    nonce: string;
  };
  constructor(readonly root: string) {
    for (let path = root; path !== dirname(path); path = dirname(path))
      this.paths.unshift(path);
    for (const path of this.paths) {
      let stat: Stats;
      try {
        stat = lstatSync(path);
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          break;
        throw error;
      }
      directory(stat, path === root);
      this.ancestors.push({ path, identity: stat });
    }
    this.assertRoot();
  }
  /** 缺失目录由原PrivateStore初始化流程逐级创建；每级首次stat也绑定inode。 */
  observe(path: string, stat: Stats): void {
    const index = this.paths.indexOf(path);
    if (index < 0)
      return;
    this.checked(() => {
      this.verifyRoot();
      directory(stat, path === this.root);
      if (!same(lstatSync(path), stat))
        throw unavailable();
      if (index < this.ancestors.length) {
        if (!same(this.ancestors[index]!.identity, stat))
          throw unavailable();
      }
      else {
        if (index !== this.ancestors.length)
          throw unavailable();
        this.ancestors.push({ path, identity: stat });
      }
    });
  }
  private verifyRoot(): void {
    for (const item of this.ancestors) {
      const stat = lstatSync(item.path);
      directory(stat, item.path === this.root);
      if (!same(stat, item.identity))
        throw unavailable();
    }
  }
  private checked(operation: () => void): void {
    if (this.signal.aborted)
      throw this.signal.reason;
    try {
      operation();
    }
    catch {
      this.abort.abort(unavailable());
      throw this.signal.reason;
    }
  }
  assertRoot(): void {
    this.checked(() => this.verifyRoot());
  }
  bind(path: string, identity: Identity, ownerName: string, owner: Identity, nonce: string): void {
    if (this.lock || this.ancestors.length !== this.paths.length)
      throw unavailable();
    this.lock = { path, directory: identity, ownerName, owner, nonce };
    this.assert();
  }
  assert(): void {
    this.checked(() => {
      this.verifyRoot();
      const lock = this.lock;
      if (!lock)
        return;
      const stat = lstatSync(lock.path);
      directory(stat, true);
      if (!same(stat, lock.directory))
        throw unavailable();
      const path = join(lock.path, lock.ownerName);
      const file = lstatSync(path);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const actual = fstatSync(fd);
        if (!actual.isFile() || actual.isSymbolicLink() || actual.nlink !== 1 || !process.getuid || actual.uid !== process.getuid() || (actual.mode & 0o777) !== 0o600 || actual.size > 1024 || !same(actual, file) || !same(actual, lock.owner))
          throw unavailable();
        const buffer = Buffer.alloc(1025);
        const length = readSync(fd, buffer, 0, buffer.length, 0);
        if (length > 1024)
          throw unavailable();
        const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
        if (!record || Object.keys(record).sort().join(',') !== 'nonce,pid,version' || record.version !== 1 || record.pid !== process.pid || record.nonce !== lock.nonce || !same(lstatSync(path), lock.owner))
          throw unavailable();
      }
      finally {
        closeSync(fd);
      }
      this.verifyRoot();
      if (!same(lstatSync(lock.path), lock.directory))
        throw unavailable();
    });
  }
}
