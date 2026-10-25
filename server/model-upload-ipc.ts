import { createHash, randomBytes } from 'node:crypto';
import { type Stats } from 'node:fs';
import { chmod, link, lstat, mkdir, unlink } from 'node:fs/promises';
import { createConnection, createServer, type Socket } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { type ModelUploadMeter, type ModelUploadSource, type ModelUploadUsage } from './model-upload-meter.js';

const MAX_FRAME_BYTES = 4096;
const MAX_PENDING_BYTES = 1024 * 1024;
const MAX_THREADS = 2048;
const usageKeys = ['epoch', 'revision', 'turnId', 'lastRequestBytes', 'turnBytes', 'requestCount'];

type Address = { socketPath: string; upstreamUrl: string };
type FileIdentity = Pick<Stats, 'dev' | 'ino'>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
/** 重新构造白名单对象；未成功发送的请求没有可发布的计量值。 */
function usageCopy(value: unknown): ModelUploadUsage | null {
  if (!record(value) || !identifier(value.epoch) || !identifier(value.turnId)
    || !positive(value.revision) || !positive(value.turnBytes) || !positive(value.requestCount)
    || typeof value.lastRequestBytes !== 'number' || !Number.isSafeInteger(value.lastRequestBytes)
    || value.lastRequestBytes < 0 || value.lastRequestBytes > value.turnBytes) return null;
  return { epoch: value.epoch, revision: value.revision, turnId: value.turnId,
    lastRequestBytes: value.lastRequestBytes, turnBytes: value.turnBytes, requestCount: value.requestCount };
}
function sourceHash(upstreamUrl: string) {
  return createHash('sha256').update(upstreamUrl).digest('hex');
}
function sameFile(left: FileIdentity, right: FileIdentity) {
  return left.dev === right.dev && left.ino === right.ino;
}
function ownedPrivate(stats: Stats) {
  if (typeof process.getuid !== 'function' || stats.uid !== process.getuid() || (stats.mode & 0o077) !== 0) {
    throw new Error('桌面计量路径必须仅允许当前用户访问');
  }
}
async function privateDirectory(path: string, create = false) {
  let stats: Stats;
  try { stats = await lstat(path); } catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(path, { recursive: true, mode: 0o700 });
    stats = await lstat(path);
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('桌面计量父目录必须是实际目录');
  ownedPrivate(stats);
}
async function privateSocket(path: string) {
  const stats = await lstat(path);
  if (!stats.isSocket() || stats.isSymbolicLink()) throw new Error('桌面计量路径必须是 Unix socket');
  ownedPrivate(stats);
  return stats;
}
async function unlinkOwned(path: string, identity: FileIdentity) {
  try {
    const current = await lstat(path);
    if (current.isSocket() && sameFile(current, identity)) await unlink(path);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
async function removeStaleSocket(path: string) {
  let original: Stats;
  try { original = await privateSocket(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const refused = await new Promise<boolean>((resolveProbe, reject) => {
    const probe = createConnection(path);
    probe.setTimeout(1000);
    probe.once('connect', () => { probe.destroy(); resolveProbe(false); });
    probe.once('timeout', () => { probe.destroy(); reject(new Error('无法确认桌面计量 socket 已失效')); });
    probe.once('error', error => {
      probe.destroy();
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') resolveProbe(true); else reject(error);
    });
  });
  if (!refused) throw new Error('桌面计量 socket 已有活动服务');
  const current = await privateSocket(path);
  if (!sameFile(original, current)) throw new Error('桌面计量 socket 在检查期间被替换');
  await unlink(path);
}

/** 只在私有 Unix socket 发布统计，不发送模型地址、凭据或请求正文。 */
export async function publishDesktopModelUsage({ socketPath, upstreamUrl, meter }: Address & { meter: ModelUploadMeter }) {
  const path = resolve(socketPath);
  await privateDirectory(dirname(path), true);
  await removeStaleSocket(path);
  const sockets = new Set<Socket>();
  let closed = false;
  let identity: FileIdentity | undefined;
  let unsubscribe: (() => void) | undefined;
  const hello = { type: 'hello', version: 1, sourceHash: sourceHash(upstreamUrl) };
  function send(socket: Socket, value: unknown) {
    if (socket.destroyed) return false;
    const data = Buffer.from(JSON.stringify(value) + '\n');
    let pending = 0;
    for (const client of sockets) if (!client.destroyed) pending += client.writableLength;
    if (data.length > MAX_FRAME_BYTES || pending + data.length > MAX_PENDING_BYTES) { socket.destroy(); return false; }
    return socket.write(data);
  }
  function sendUsage(socket: Socket, threadId: string, value: ModelUploadUsage) {
    const usage = usageCopy(value);
    return !identifier(threadId) || !usage || send(socket, { type: 'usage', threadId, usage });
  }
  const server = createServer(socket => {
    if (closed) { socket.destroy(); return; }
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    // 单向发布协议不接收客户端数据。
    socket.on('data', () => socket.destroy());
    send(socket, hello);
    const snapshot = meter.snapshot().entries();
    function sendSnapshot() {
      for (const [threadId, usage] of snapshot) {
        if (!sendUsage(socket, threadId, usage)) {
          if (!socket.destroyed) socket.once('drain', sendSnapshot);
          return;
        }
      }
    }
    sendSnapshot();
  });
  server.on('error', () => {});
  // libuv 会在 close 时删除绑定路径。用已移除的随机内部路径绑定，避免误删被替换的公开路径。
  const internalPath = join(dirname(path), `.meter-${randomBytes(8).toString('hex')}`);
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(internalPath, () => { server.off('error', reject); resolveListen(); });
    });
    await chmod(internalPath, 0o600);
    identity = await privateSocket(internalPath);
    await link(internalPath, path);
    await unlinkOwned(internalPath, identity);
    unsubscribe = meter.subscribe((threadId, usage) => {
      for (const socket of sockets) sendUsage(socket, threadId, usage);
    });
  } catch (error) {
    closed = true;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    if (identity) await unlinkOwned(path, identity);
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    close(): Promise<void> {
      return closing ??= (async () => {
        closed = true; unsubscribe?.();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>(resolveClose => server.close(() => resolveClose()));
        if (identity) await unlinkOwned(path, identity);
      })();
    },
  };
}

/** 网关只订阅已绑定来源；连接失效后立即停止提供旧计量值。 */
export function connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs = 1000 }: Address & { retryMs?: number }): ModelUploadSource & { close(): Promise<void> } {
  const path = resolve(socketPath);
  const expectedHash = sourceHash(upstreamUrl);
  const delay = Number.isSafeInteger(retryMs) && retryMs > 0 ? retryMs : 1000;
  const threads = new Map<string, ModelUploadUsage>();
  const listeners = new Set<(threadId: string, usage: ModelUploadUsage) => void>();
  let closed = false;
  let verified = false;
  let connection: Socket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  function invalidate() { verified = false; threads.clear(); }
  function schedule() {
    if (closed || retry) return;
    retry = setTimeout(() => { retry = undefined; void connect(); }, delay);
    retry.unref();
  }
  async function connect() {
    const attempt = ++generation;
    let original: Stats;
    try {
      await privateDirectory(dirname(path));
      original = await privateSocket(path);
    } catch { schedule(); return; }
    if (closed || attempt !== generation) return;
    const socket = createConnection(path);
    connection = socket; socket.pause();
    let pending = Buffer.alloc(0);
    let greeted = false;
    function fail() { invalidate(); socket.destroy(); }
    function accept(raw: Buffer) {
      let value: unknown;
      try { value = JSON.parse(raw.toString('utf8')); } catch { fail(); return; }
      if (!record(value)) { fail(); return; }
      if (!greeted) {
        if (!keys(value, ['type', 'version', 'sourceHash']) || value.type !== 'hello'
          || value.version !== 1 || value.sourceHash !== expectedHash) { fail(); return; }
        greeted = true; verified = true; return;
      }
      if (!keys(value, ['type', 'threadId', 'usage']) || value.type !== 'usage' || !identifier(value.threadId)
        || !record(value.usage) || !keys(value.usage, usageKeys)) { fail(); return; }
      const usage = usageCopy(value.usage);
      if (!usage) { fail(); return; }
      const previous = threads.get(value.threadId);
      if (previous?.epoch === usage.epoch && previous.revision >= usage.revision) return;
      threads.set(value.threadId, usage);
      while (threads.size > MAX_THREADS) threads.delete(threads.keys().next().value!);
      for (const listener of listeners) listener(value.threadId, { ...usage });
    }
    socket.on('data', (data: Buffer) => {
      let offset = 0;
      while (offset < data.length && !socket.destroyed) {
        const newline = data.indexOf(10, offset);
        const end = newline === -1 ? data.length : newline;
        const part = data.subarray(offset, end);
        if (pending.length + part.length + 1 > MAX_FRAME_BYTES) { fail(); return; }
        if (newline === -1) { pending = Buffer.concat([pending, part]); return; }
        const raw = pending.length ? Buffer.concat([pending, part]) : part;
        pending = Buffer.alloc(0); accept(raw); offset = end + 1;
      }
    });
    socket.once('connect', () => {
      void (async () => {
        try {
          await privateDirectory(dirname(path));
          const current = await privateSocket(path);
          if (closed || attempt !== generation || !sameFile(original, current)) { socket.destroy(); return; }
          socket.resume();
        } catch { socket.destroy(); }
      })();
    });
    socket.on('end', () => { invalidate(); socket.destroy(); });
    socket.on('error', fail);
    socket.once('close', () => {
      if (connection !== socket) return;
      connection = undefined; invalidate(); schedule();
    });
  }
  void connect();
  let closing: Promise<void> | undefined;
  return {
    read(threadId) {
      const usage = verified ? threads.get(threadId) : undefined;
      return usage ? { ...usage } : null;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() {
      return closing ??= (async () => {
        closed = true; generation++; invalidate(); listeners.clear();
        if (retry) { clearTimeout(retry); retry = undefined; }
        const socket = connection;
        if (socket && !socket.closed) {
          await new Promise<void>(resolveClose => { socket.once('close', resolveClose); socket.destroy(); });
        }
      })();
    },
  };
}
