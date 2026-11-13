import { AdminDeadline } from './admin-deadline.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, lstat, open, unlink } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { RemoteRuntime } from './runtime.js';
import { ADMIN_REQUEST_BYTES, ADMIN_RESPONSE_BYTES, adminFailure, operationLimit, RemoteAdminError, request, type AdminMetadata, type AdminMethod, type AdminParams } from './admin-protocol.js';
import { pidState, privateOwned, proveDirectory, proveSocket, readAdminMetadata, recheckDirectory, sameFile, unlinkExact, type Identity } from './admin-path.js';
export type AdminRuntime = Pick<RemoteRuntime, 'status' | 'queryStatus' | 'login' | 'authorize' | 'recover' | 'refreshTargets' | 'pairLocal' | 'pairManual' | 'acceptTarget' | 'resume' | 'reassociate'>;
export interface RemoteAccess {
  host: string;
  port: number;
  token: string;
}
export interface AdminOptions {
  directory: string;
  runtime: AdminRuntime;
  access: () => RemoteAccess;
  signal?: AbortSignal;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  operationTimeoutMs?: number;
  writeTimeoutMs?: number;
  maxConnections?: number;
}
async function dispatch(runtime: AdminRuntime, method: AdminMethod, params: AdminParams, signal: AbortSignal, access: () => RemoteAccess): Promise<unknown> {
  switch (method) {
    case 'status':
    case 'queryStatus': return runtime.queryStatus();
    case 'url': {
      const v = access();
      if (!v.token || typeof v.host !== 'string' || !Number.isSafeInteger(v.port) || v.port < 1 || v.port > 65535) {
        throw new RemoteAdminError('unavailable');
      }
      return { host: v.host, port: v.port, token: v.token };
    }
    case 'login': return runtime.login(signal);
    case 'authorize': return runtime.authorize(signal);
    case 'recover':
    case 'reauthorize': return runtime.recover(signal);
    case 'targets': return runtime.refreshTargets(signal);
    case 'pair-local': return runtime.pairLocal(signal);
    case 'pair': return runtime.pairManual(params.code!, params.target!, signal);
    case 'accept': return runtime.acceptTarget(params.target!, signal);
    case 'resume': return runtime.resume(params.target!, signal);
    case 'reassociate': return runtime.reassociate(params.previous!, params.next!, params.code, signal);
  }
}
export interface RemoteAdminServer {
  close(): Promise<void>;
  settled(): Promise<void>;
}
export type RemoteAdminPublication = Promise<RemoteAdminServer> & {
  settled(): Promise<void>;
};
/** 有界启动与实际启动分开跟踪，迟到FS收尾前不能释放网关归属。 */
export function publishRemoteAdmin(options: AdminOptions): RemoteAdminPublication {
  const phase = new AdminDeadline(options.startupTimeoutMs ?? 10000, options.signal);
  const actual = Promise.resolve().then(() => {
    phase.assert();
    return publishRemoteAdminInner({ ...options, signal: phase.signal }, phase);
  });
  let completed: RemoteAdminServer | undefined;
  const closeLate = () => {
    if (completed) {
      void completed.settled().catch(() => undefined);
    }
  };
  phase.signal.addEventListener('abort', closeLate, { once: true });
  void actual.then(server => {
    completed = server;
    if (phase.signal.aborted) {
      closeLate();
    }
  }, () => undefined);
  const pending = phase.wait(() => actual).catch(error => {
    throw adminFailure(error);
  }).finally(() => {
    phase.dispose();
    phase.signal.removeEventListener('abort', closeLate);
  });
  return Object.assign(pending, { async settled() {
      const server = await actual.catch(() => undefined);
      if (phase.signal.aborted) {
        await server?.settled();
      }
    } });
}
/** 与手机 HTTP/WS完全隔离；固定动作，一连接一请求，读到EOF才执行完整帧。 */
async function publishRemoteAdminInner(options: AdminOptions, startup: AdminDeadline): Promise<RemoteAdminServer> {
  const { directory } = options;
  const proof = await proveDirectory(directory);
  const metadataPath = join(directory, 'admin.json');
  const socketPath = join(directory, 'admin.sock');
  const value: AdminMetadata = { version: 1, pid: process.pid, instance: randomUUID(), nonce: randomUUID() };
  const sockets = new Set<Socket>();
  let closed = false;
  let metadataIdentity: Identity | undefined;
  let socketIdentity: Identity | undefined;
  let rejectListen: ((error: Error) => void) | undefined;
  let startupFailure: RemoteAdminError | undefined;
  function assertOpen() {
    startup.assert();
    if (startupFailure) {
      throw startupFailure;
    }
    if (closed) {
      throw new RemoteAdminError('cancelled');
    }
  }
  const server = createServer({ allowHalfOpen: true }, socket => {
    if (closed || sockets.size >= (options.maxConnections ?? 32)) {
      const timer = setTimeout(() => socket.destroy(), options.writeTimeoutMs ?? 5000);
      socket.on('error', () => socket.destroy());
      socket.once('close', () => clearTimeout(timer));
      socket.end(JSON.stringify({ version: 1, ok: false, error: 'limit' }) + '\n', () => socket.destroy());
      return;
    }
    sockets.add(socket);
    const abort = new AbortController();
    let pending = Buffer.alloc(0);
    let ended = false;
    let replied = false;
    let limit = performance.now() + (options.requestTimeoutMs ?? 10000);
    let timer: NodeJS.Timeout;
    let heartbeat: NodeJS.Timeout | undefined;
    let sentBytes = 0;
    function dispose() {
      clearTimeout(timer);
      clearInterval(heartbeat);
      abort.abort();
      socket.destroy();
    }
    function send(payload: unknown) {
      if (closed || socket.destroyed || replied) {
        return;
      }
      let encoded = Buffer.from(JSON.stringify({ version: 1, ok: true, result: payload === undefined ? null : payload }) + '\n');
      if (closed || abort.signal.aborted || performance.now() >= limit) {
        fail(new RemoteAdminError('timeout'));
        return;
      }
      replied = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      let queued = 0;
      for (const client of sockets) {
        queued += client.writableLength;
      }
      if (sentBytes + encoded.length > ADMIN_RESPONSE_BYTES || queued + encoded.length > 16 * 1024 * 1024) {
        encoded = Buffer.from(JSON.stringify({ version: 1, ok: false, error: 'limit' }) + '\n');
      }
      timer = setTimeout(dispose, options.writeTimeoutMs ?? 5000);
      socket.end(encoded, () => socket.destroy());
    }
    function fail(error: unknown) {
      if (replied || socket.destroyed || closed) {
        return;
      }
      replied = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      abort.abort();
      timer = setTimeout(dispose, options.writeTimeoutMs ?? 5000);
      socket.end(JSON.stringify({ version: 1, ok: false, error: adminFailure(error).code }) + '\n', () => socket.destroy());
    }
    timer = setTimeout(() => fail(new RemoteAdminError('timeout')), Math.max(1, limit - performance.now()));
    socket.on('error', dispose);
    socket.once('close', () => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      abort.abort();
      sockets.delete(socket);
    });
    socket.on('data', (bytes: Buffer) => {
      if (ended || replied) {
        dispose();
        return;
      }
      if (performance.now() >= limit) {
        fail(new RemoteAdminError('timeout'));
        return;
      }
      if (pending.length + bytes.length > ADMIN_REQUEST_BYTES) {
        fail(new RemoteAdminError('limit'));
        return;
      }
      pending = Buffer.concat([pending, bytes]);
    });
    socket.once('end', () => {
      ended = true;
      if (replied || closed) {
        return;
      }
      let parsed: ReturnType<typeof request>;
      try {
        if (performance.now() >= limit) {
          throw new RemoteAdminError('timeout');
        }
        if (pending.length < 2 || pending.at(-1) !== 10 || pending.subarray(0, -1).includes(10)) {
          throw new RemoteAdminError('protocol');
        }
        parsed = request(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pending.subarray(0, -1))), value);
        pending = Buffer.alloc(0);
      }
      catch (error) {
        fail(error instanceof RemoteAdminError ? error : new RemoteAdminError('protocol'));
        return;
      }
      clearTimeout(timer);
      limit = performance.now() + (options.operationTimeoutMs ?? operationLimit(parsed.method));
      timer = setTimeout(() => fail(new RemoteAdminError('timeout')), Math.max(1, limit - performance.now()));
      // EOF 后对端关闭读半边只有写入才能证明；固定心跳不延长绝对期限。
      heartbeat = setInterval(() => {
        if (closed || replied || socket.destroyed) {
          clearInterval(heartbeat);
          return;
        }
        if (performance.now() >= limit) {
          fail(new RemoteAdminError('timeout'));
          return;
        }
        const frame = Buffer.from('{"version":1,"type":"pending"}\n');
        let queued = 0;
        for (const client of sockets) {
          queued += client.writableLength;
        }
        if (sentBytes + frame.length > ADMIN_RESPONSE_BYTES || queued + frame.length > 16 * 1024 * 1024 || socket.writableLength > 65536) {
          fail(new RemoteAdminError('limit'));
          return;
        }
        sentBytes += frame.length;
        socket.write(frame);
      }, 100);
      void Promise.resolve().then(async () => {
        if (closed || abort.signal.aborted || performance.now() >= limit) {
          throw new RemoteAdminError('timeout');
        }
        const result = await dispatch(options.runtime, parsed.method, parsed.params, abort.signal, options.access);
        if (closed || abort.signal.aborted || performance.now() >= limit) {
          throw new RemoteAdminError('timeout');
        }
        send(result);
      }).catch(fail);
    });
    socket.write(JSON.stringify({ type: 'hello', ...value }) + '\n');
  });
  server.on('error', () => {
  });
  const internalPath = join(directory, `.a-${randomBytes(4).toString('hex')}`);
  let internalIdentity: Identity | undefined;
  async function close() {
    closed = true;
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (socketIdentity) {
      await unlinkExact(socketPath, socketIdentity, 'socket', proof).catch(() => undefined);
    }
    if (metadataIdentity) {
      await unlinkExact(metadataPath, metadataIdentity, 'file', proof).catch(() => undefined);
    }
    if (internalIdentity) {
      await unlinkExact(internalPath, internalIdentity, 'socket', proof).catch(() => undefined);
    }
  }
  const abortStartup = (error: RemoteAdminError) => {
    startupFailure ??= error;
    closed = true;
    rejectListen?.(error);
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close();
  };
  const cancel = () => abortStartup(options.signal?.reason instanceof RemoteAdminError ? options.signal.reason : new RemoteAdminError('cancelled'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    assertOpen();
    let existing: Awaited<ReturnType<typeof readAdminMetadata>> | undefined;
    try {
      existing = await readAdminMetadata(directory, proof);
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    assertOpen();
    if (existing) {
      if (pidState(existing.value.pid) !== 'dead') {
        throw new RemoteAdminError('busy');
      }
      let previousSocket: Identity | undefined;
      try {
        previousSocket = await proveSocket(directory, proof);
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
      const current = await readAdminMetadata(directory, proof);
      if (!sameFile(existing.identity, current.identity) || pidState(current.value.pid) !== 'dead') {
        throw new RemoteAdminError('unavailable');
      }
      assertOpen();
      if (previousSocket) {
        await unlinkExact(socketPath, previousSocket, 'socket', proof);
      }
      assertOpen();
      await unlinkExact(metadataPath, existing.identity, 'file', proof);
    }
    else {
      try {
        await lstat(socketPath);
        throw new RemoteAdminError('unavailable');
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
    assertOpen();
    await recheckDirectory(proof);
    assertOpen();
    await new Promise<void>((resolve, reject) => {
      rejectListen = reject;
      server.once('error', reject);
      server.listen(internalPath, () => {
        server.off('error', reject);
        resolve();
      });
    }).finally(() => {
      rejectListen = undefined;
    });
    await chmod(internalPath, 0o600);
    internalIdentity = await lstat(internalPath);
    privateOwned(internalIdentity as import('node:fs').Stats, 'socket');
    assertOpen();
    await recheckDirectory(proof);
    assertOpen();
    await link(internalPath, socketPath);
    socketIdentity = internalIdentity;
    await unlink(internalPath);
    internalIdentity = undefined;
    assertOpen();
    await recheckDirectory(proof);
    assertOpen();
    const handle = await open(metadataPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.chmod(0o600);
      metadataIdentity = await handle.stat();
      assertOpen();
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    }
    finally {
      await handle.close();
    }
    assertOpen();
    await recheckDirectory(proof);
    const actual = await readAdminMetadata(directory, proof);
    if (!sameFile(actual.identity, metadataIdentity!)) {
      throw new RemoteAdminError('unavailable');
    }
    assertOpen();
  }
  catch (error) {
    await close();
    throw adminFailure(error);
  }
  finally {
    options.signal?.removeEventListener('abort', cancel);
  }
  let closing: Promise<void> | undefined;
  return {
    close() {
      closing ??= close();
      const deadline = new AdminDeadline(2000);
      return deadline.wait(() => closing!).catch(error => {
        if (!(error instanceof RemoteAdminError) || error.code !== 'timeout') {
          throw error;
        }
      }).finally(() => deadline.dispose());
    },
    settled() {
      return closing ??= close();
    },
  };
}
