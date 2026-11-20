import { constants, type Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { removeExactEntry } from './exact-cleanup.js';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { metadata, RemoteAdminError, type AdminMetadata } from './admin-protocol.js';
export type Identity = Pick<Stats, 'dev' | 'ino'>;
export type DirectoryProof = {
  path: string;
  identity: Identity;
}[];
export const sameFile = (a: Identity, b: Identity): boolean => a.dev === b.dev && a.ino === b.ino;
export function remoteDirectory(value = process.env.CODEX_MOBILE_REMOTE_DIR): string {
  const path = value ?? join(homedir(), '.codex-mobile', 'remote');
  if (!isAbsolute(path) || path.split('/').some(p => p === '.' || p === '..') || resolve(path) === '/') {
    throw new RemoteAdminError('unavailable');
  }
  return resolve(path);
}
export function privateOwned(stat: Stats, type: 'file' | 'socket'): void {
  if (!process.getuid || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.isSymbolicLink() || !(type === 'file' ? stat.isFile() : stat.isSocket())) {
    throw new RemoteAdminError('unavailable');
  }
}
/** 只读证明，不创建目录、chmod、修复记录或跟随符号链接。 */
export async function proveDirectory(directory: string): Promise<DirectoryProof> {
  const path = remoteDirectory(directory);
  const paths: string[] = [];
  for (let current = path; current !== dirname(current); current = dirname(current)) {
    paths.unshift(current);
  }
  const proof: DirectoryProof = [];
  for (const current of paths) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (current === path && (!process.getuid || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700))) {
      throw new RemoteAdminError('unavailable');
    }
    proof.push({ path: current, identity: stat });
  }
  return proof;
}
export async function recheckDirectory(proof: DirectoryProof): Promise<void> {
  const actual = await proveDirectory(proof.at(-1)!.path);
  if (actual.length !== proof.length || !actual.every((p, i) => p.path === proof[i]!.path && sameFile(p.identity, proof[i]!.identity))) {
    throw new RemoteAdminError('unavailable');
  }
}
export function pidState(pid: number): 'alive' | 'dead' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'dead' : 'unknown';
  }
}
export async function readAdminMetadata(directory: string, proof: DirectoryProof): Promise<{
  value: AdminMetadata;
  identity: Identity;
}> {
  const path = join(directory, 'admin.json');
  await recheckDirectory(proof);
  const before = await lstat(path);
  privateOwned(before, 'file');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    privateOwned(stat, 'file');
    if (!sameFile(stat, before) || stat.size > 1024) {
      throw new RemoteAdminError('unavailable');
    }
    const buffer = Buffer.alloc(1025);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.length > 1024) {
      throw new RemoteAdminError('unavailable');
    }
    const value = metadata(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    const after = await lstat(path);
    privateOwned(after, 'file');
    if (!sameFile(stat, after)) {
      throw new RemoteAdminError('unavailable');
    }
    await recheckDirectory(proof);
    return { value, identity: stat };
  }
  finally {
    await handle.close();
  }
}
export async function proveSocket(directory: string, proof: DirectoryProof): Promise<Identity> {
  await recheckDirectory(proof);
  const stat = await lstat(join(directory, 'admin.sock'));
  privateOwned(stat, 'socket');
  await recheckDirectory(proof);
  return stat;
}
export async function unlinkExact(path: string, identity: Identity, type: 'file' | 'socket', proof: DirectoryProof): Promise<void> {
  try {
    await removeExactEntry({
      path, identity, directory: proof.at(-1)!.path,
      assertDirectory: () => recheckDirectory(proof),
      assertSource: () => recheckDirectory(proof),
      validate: stat => privateOwned(stat, type),
    });
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
