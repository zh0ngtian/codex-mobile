import { AdminDeadline } from './admin-deadline.js';
import { createConnection } from 'node:net';
import { performance } from 'node:perf_hooks';
import { ADMIN_ERROR_CODES, ADMIN_REQUEST_BYTES, ADMIN_RESPONSE_BYTES, exact, metadata, object, operationLimit, parameters, RemoteAdminError, type AdminMethod, type AdminParams } from './admin-protocol.js';
import { pidState, proveDirectory, proveSocket, readAdminMetadata, recheckDirectory, remoteDirectory, sameFile } from './admin-path.js';
export interface AdminCallOptions {
  directory?: string;
  method: AdminMethod;
  params?: AdminParams;
  signal?: AbortSignal;
  handshakeTimeoutMs?: number;
  timeoutMs?: number;
  writeTimeoutMs?: number;
}
/** 只能连接显式根中已证明的运行实例；绝不启动服务或离线写身份。 */
export async function callRemoteAdmin(options: AdminCallOptions): Promise<unknown> {
  const phase = new AdminDeadline(options.handshakeTimeoutMs ?? 5000, options.signal);
  try {
    const validated = parameters(options.method, options.params ?? {});
    if (options.signal?.aborted) {
      throw new RemoteAdminError('cancelled');
    }
    const handshakeDeadline = phase.deadline;
    const assertTime = () => {
      if (options.signal?.aborted) {
        throw new RemoteAdminError('cancelled');
      }
      if (performance.now() >= handshakeDeadline) {
        throw new RemoteAdminError('timeout');
      }
    };
    const directory = remoteDirectory(options.directory);
    const proof = await phase.wait(() => proveDirectory(directory));
    assertTime();
    const record = await phase.wait(() => readAdminMetadata(directory, proof));
    const original = await phase.wait(() => proveSocket(directory, proof));
    assertTime();
    if (pidState(record.value.pid) !== 'alive') {
      throw new RemoteAdminError('unavailable');
    }
    return await new Promise<unknown>((resolve, reject) => {
      const socket = createConnection({ path: `${directory}/admin.sock`, allowHalfOpen: true });
      let pending = Buffer.alloc(0);
      let greeted = false;
      let done = false;
      let verifying = false;
      let responseBytes = 0;
      let deadline = handshakeDeadline;
      let timer: NodeJS.Timeout;
      function finish(error?: unknown, value?: unknown) {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancel);
        phase.signal.removeEventListener('abort', handshakeFailed);
        socket.destroy();
        error ? reject(error) : resolve(value);
      }
      function cancel() {
        finish(new RemoteAdminError('cancelled'));
      }
      function handshakeFailed() {
        finish(phase.signal.reason);
      }
      phase.signal.addEventListener('abort', handshakeFailed, { once: true });
      function schedule() {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new RemoteAdminError('timeout')), Math.max(1, deadline - performance.now()));
      }
      schedule();
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) {
        cancel();
      }
      socket.on('error', () => finish(new RemoteAdminError('unavailable')));
      socket.on('close', () => {
        if (!done) {
          finish(new RemoteAdminError('unavailable'));
        }
      });
      socket.on('data', (bytes: Buffer) => {
        if (done) {
          return;
        }
        if (performance.now() >= deadline) {
          finish(new RemoteAdminError('timeout'));
          return;
        }
        if (pending.length + bytes.length > (greeted ? ADMIN_RESPONSE_BYTES : 4096)) {
          finish(new RemoteAdminError('limit'));
          return;
        }
        pending = Buffer.concat([pending, bytes]);
        if (greeted) {
          responseBytes += bytes.length;
          if (responseBytes > ADMIN_RESPONSE_BYTES) {
            finish(new RemoteAdminError('limit'));
            return;
          }
          while (pending.includes(10)) {
            const newline = pending.indexOf(10);
            let frame: unknown;
            try {
              frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pending.subarray(0, newline)));
            }
            catch {
              finish(new RemoteAdminError('protocol'));
              return;
            }
            if (object(frame) && exact(frame, ['version', 'type']) && frame.version === 1 && frame.type === 'pending') {
              pending = pending.subarray(newline + 1);
            }
            else {
              break;
            }
          }
        }
        if (!greeted && !verifying && pending.includes(10)) {
          verifying = true;
          socket.pause();
          void (async () => {
            const newline = pending.indexOf(10);
            if (newline !== pending.length - 1) {
              throw new RemoteAdminError('protocol');
            }
            const hello = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pending.subarray(0, newline)));
            if (object(hello) && exact(hello, ['version', 'ok', 'error']) && hello.version === 1 && hello.ok === false && hello.error === 'limit') {
              throw new RemoteAdminError('limit');
            }
            if (!object(hello) || !exact(hello, ['type', 'version', 'pid', 'instance', 'nonce']) || hello.type !== 'hello') {
              throw new RemoteAdminError('protocol');
            }
            const { type: _type, ...raw } = hello;
            const actual = metadata(raw);
            if (JSON.stringify(actual) !== JSON.stringify(record.value)) {
              throw new RemoteAdminError('unavailable');
            }
            await phase.wait(() => recheckDirectory(proof));
            const currentMetadata = await phase.wait(() => readAdminMetadata(directory, proof));
            const currentSocket = await phase.wait(() => proveSocket(directory, proof));
            if (!sameFile(original, currentSocket) || !sameFile(record.identity, currentMetadata.identity) || JSON.stringify(record.value) !== JSON.stringify(currentMetadata.value) || pidState(actual.pid) !== 'alive') {
              throw new RemoteAdminError('unavailable');
            }
            assertTime();
            if (done) {
              return;
            }
            const data = Buffer.from(JSON.stringify({ version: 1, instance: actual.instance, nonce: actual.nonce, ...validated }) + '\n');
            if (data.length > ADMIN_REQUEST_BYTES) {
              throw new RemoteAdminError('limit');
            }
            pending = Buffer.alloc(0);
            greeted = true;
            phase.signal.removeEventListener('abort', handshakeFailed);
            phase.dispose();
            const operationDeadline = performance.now() + (options.timeoutMs ?? operationLimit(validated.method) + 5000);
            const writeDeadline = Math.min(operationDeadline, performance.now() + (options.writeTimeoutMs ?? 5000));
            deadline = writeDeadline;
            schedule();
            socket.end(data, () => {
              if (done) {
                return;
              }
              if (performance.now() >= writeDeadline) {
                finish(new RemoteAdminError('timeout'));
                return;
              }
              deadline = operationDeadline;
              schedule();
            });
            if (performance.now() >= writeDeadline) {
              finish(new RemoteAdminError('timeout'));
              return;
            }
            socket.resume();
          })().catch(error => finish(error instanceof RemoteAdminError ? error : new RemoteAdminError('unavailable')));
        }
      });
      socket.on('end', () => {
        if (done) {
          return;
        }
        try {
          if (!greeted || performance.now() >= deadline || pending.length < 2 || pending.at(-1) !== 10 || pending.subarray(0, -1).includes(10)) {
            throw new RemoteAdminError('protocol');
          }
          const response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pending.subarray(0, -1)));
          if (!object(response) || response.version !== 1 || typeof response.ok !== 'boolean') {
            throw new RemoteAdminError('protocol');
          }
          if (response.ok) {
            if (!exact(response, ['version', 'ok', 'result'])) {
              throw new RemoteAdminError('protocol');
            }
            finish(undefined, response.result);
          }
          else {
            if (!exact(response, ['version', 'ok', 'error']) || typeof response.error !== 'string') {
              throw new RemoteAdminError('protocol');
            }
            if (!(ADMIN_ERROR_CODES as readonly string[]).includes(response.error)) {
              throw new RemoteAdminError('unavailable');
            }
            finish(new RemoteAdminError(response.error as import('./admin-protocol.js').AdminErrorCode));
          }
        }
        catch (error) {
          finish(error instanceof RemoteAdminError ? error : new RemoteAdminError('protocol'));
        }
      });
    });
  }
  catch (error) {
    throw error instanceof RemoteAdminError ? error : new RemoteAdminError('unavailable');
  }
  finally {
    phase.dispose();
  }
}
