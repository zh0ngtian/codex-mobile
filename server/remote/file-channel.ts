import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { TextDecoder } from 'node:util';
import { RemoteRpcError, type RemoteRpcSession } from './rpc-session.js';
import { assertRemoteOperation, withRemoteOperation } from './operation-guard.js';
import type { JsonValue, RpcMessage } from './envelope.js';
import { REMOTE_FILE_PYTHON } from './file-python.js';

export const FILE_CHUNK_BYTES = 512 * 1024;
export const FILE_WINDOW = 4;
export const FILE_MAX_BYTES = 100 * 1024 * 1024;
const RECORD_LIMIT = 710000;
const TOTAL_WIRE_LIMIT = 150 * 1024 * 1024;
// 最大文件base64约140MB，4KiB通知约3.5万条；保留有界控制记录余量。
const NOTIFICATION_LIMIT = 65536;
// 四个JSON/base64记录、UTF16解析对象、解码窗口、RPC双层编码及暂存的保守适配器峰值。
const RESERVATION = 16 * 1024 * 1024;
const GLOBAL_MEMORY = 64 * 1024 * 1024;
let active = 0; let memory = 0;
export type RemoteFileFailure = 'binding' | 'metadata' | 'python3-required' | 'capability' | 'invalid-input' | 'capacity' | 'protocol' | 'integrity' | 'version' | 'encoding' | 'not-found' | 'permission' | 'timeout' | 'cancelled' | 'disconnected' | 'closed';
export class RemoteFileError extends Error {
  readonly outcome: 'not-sent' | 'unknown';
  // 收据由可信调用者显式读取；常规JSON/inspect错误日志只暴露有限分类与固定文本。
  #operation?: unknown;
  get operation(): unknown { return this.#operation; }
  set operation(value: unknown) { this.#operation = value; }
  constructor(readonly code: RemoteFileFailure, readonly mayHaveBeenSent: boolean) {
    super('Remote 目标文件操作未完成'); this.name = 'RemoteFileError'; this.outcome = mayHaveBeenSent ? 'unknown' : 'not-sent';
  }
}
export function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
export function strictBase64(value: unknown, max: number): Buffer {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || value.length % 4 || /[^A-Za-z0-9+/=]/.test(value)) throw new RemoteFileError('protocol', true);
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (value.indexOf('=') !== (padding ? value.length - padding : -1)) throw new RemoteFileError('protocol', true);
  const bytes = Buffer.from(value, 'base64'); if (bytes.length > max || bytes.toString('base64') !== value) throw new RemoteFileError('protocol', true); return bytes;
}
export const fileSha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
export function fileText(value: Uint8Array): string { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value); } catch { throw new RemoteFileError('encoding', true); } }
export function fileFailure(error: unknown, sent: boolean): RemoteFileError {
  if (error instanceof RemoteFileError) return new RemoteFileError(error.code, sent || error.mayHaveBeenSent);
  if (error instanceof RemoteRpcError) return new RemoteFileError(error.code === 'network' || error.code === 'closed' ? 'disconnected' : error.code === 'response' ? 'capability' : error.code === 'capacity' ? 'capacity' : error.code === 'cancelled' ? 'cancelled' : error.code === 'timeout' ? 'timeout' : 'protocol', sent || error.mayHaveBeenSent);
  return new RemoteFileError('protocol', sent);
}
interface Waiter { records: Record<string, unknown>[]; max: number; done: (record: Record<string, unknown>, count: number) => boolean; resolve: (value: Record<string, unknown>[]) => void }
/** 仅文件层内部使用的有限窗口；没有任意源码、权限或物理连接入口。 */
export class RemoteFileChannel {
  readonly processId = 'codex-mobile-file:' + randomUUID();
  readonly nonce = randomUUID();
  sent = false; error?: RemoteFileError; settled = false;
  private disposed = false; private stopping?: Promise<boolean>; private execution?: Promise<unknown>;
  private trailingBytes = 0;
  private released = false;
  private window?: () => void;
  private readonly abort = new AbortController();
  private ready = false; private pending = Buffer.alloc(0); private sequence = 0; private notifications = 0;
  private initialRequest = true;
  private bytes = 0; private readonly hash = createHash('sha256'); private control = Buffer.alloc(0); private completion?: { size: number; sha256: string };
  private waiter?: Waiter;
  private readonly failure: Promise<never>; private rejectFailure!: (error: RemoteFileError) => void;
  private readonly readiness: Promise<void>; private resolveReady!: () => void;
  private readonly done: Promise<void>; private resolveDone!: () => void;
  private readonly timer: NodeJS.Timeout;
  constructor(private readonly session: RemoteRpcSession, private readonly binding: { python: string; metadata: { codexHome: string } }, readonly deadline: number, private readonly signal?: AbortSignal, private readonly cleanup = false, private readonly onRelease?: () => void) {
    this.assert(); if (!cleanup) assertRemoteOperation();
    if (active >= 4 || memory + RESERVATION > GLOBAL_MEMORY) throw new RemoteFileError('capacity', false);
    active++; memory += RESERVATION;
    this.failure = new Promise((_resolve, reject) => { this.rejectFailure = reject; }); void this.failure.catch(() => undefined);
    this.readiness = new Promise(resolve => { this.resolveReady = resolve; }); this.done = new Promise(resolve => { this.resolveDone = resolve; });
    this.timer = setTimeout(() => this.fail('timeout'), Math.max(1, deadline - performance.now()));
    signal?.addEventListener('abort', this.cancelled, { once: true });
    session.on('notification', this.notification); session.on('disconnect', this.disconnected); session.on('close', this.disconnected);
  }
  assert(checkParents = true): void {
    if (this.error) throw this.error;
    if (checkParents && !this.cleanup) assertRemoteOperation();
    if (!this.session.ready) throw new RemoteFileError('disconnected', this.sent);
    if (performance.now() >= this.deadline) throw new RemoteFileError('timeout', this.sent);
    if (this.signal?.aborted) throw new RemoteFileError('cancelled', this.sent);
  }
  private remaining(): number { this.assert(); if (!this.cleanup) assertRemoteOperation(); return Math.max(1, Math.floor(this.deadline - performance.now())); }
  private cancelled = () => this.fail('cancelled');
  private disconnected = () => this.fail('disconnected');
  fail(code: RemoteFileFailure): void {
    if (this.error || this.released) return;
    this.error = new RemoteFileError(code, this.sent); this.rejectFailure(this.error); this.abort.abort(); this.window?.();
    void this.stop().then(() => this.release());
  }
  holdWindow(...arrays: unknown[][]): void { this.window = () => { for (const array of arrays) array.length = 0; }; }
  clearWindow(): void { this.window?.(); this.window = undefined; }
  private notification = (message: RpcMessage): void => {
    if (message.method !== 'command/exec/outputDelta' || !record(message.params) || message.params.processId !== this.processId || this.error) return;
    try {
      this.assert(); const p = message.params;
      if (!['stdout', 'stderr'].includes(p.stream as string) || p.capReached !== false || ++this.notifications > NOTIFICATION_LIMIT) throw new RemoteFileError('protocol', true);
      const bytes = strictBase64(p.deltaBase64, p.stream === 'stderr' ? 256 : RECORD_LIMIT);
      if (p.stream === 'stderr') {
        if (this.completion || this.control.length + bytes.length > 256) throw new RemoteFileError('protocol', true);
        this.control = Buffer.concat([this.control, bytes]);
        const prefix = Buffer.from('CMFILE1_DONE:' + this.nonce + ':'); const n = Math.min(prefix.length, this.control.length);
        if (!this.control.subarray(0, n).equals(prefix.subarray(0, n))) throw new RemoteFileError('protocol', true);
        if (this.control.includes(10)) {
          const match = /^CMFILE1_DONE:([a-z0-9-]+):([1-9][0-9]{0,9}):([a-f0-9]{64})\n$/.exec(fileText(this.control));
          if (!match || match[1] !== this.nonce || Number(match[2]) > TOTAL_WIRE_LIMIT) throw new RemoteFileError('protocol', true);
          this.completion = { size: Number(match[2]), sha256: match[3]! }; this.resolveDone();
        }
        return;
      }
      if (this.bytes + this.pending.length + bytes.length > TOTAL_WIRE_LIMIT + (this.ready ? 0 : 64)) throw new RemoteFileError('capacity', true);
      this.pending = Buffer.concat([this.pending, bytes]);
      let end: number;
      while ((end = this.pending.indexOf(10)) >= 0) {
        if (end + 1 >= RECORD_LIMIT) throw new RemoteFileError('capacity', true);
        const line = this.pending.subarray(0, end + 1); this.pending = this.pending.subarray(end + 1);
        if (!this.ready) {
          if (!line.equals(Buffer.from('CMFILE1_READY:' + this.nonce + '\n'))) throw new RemoteFileError('protocol', true);
          this.ready = true; this.resolveReady(); continue;
        }
        this.bytes += line.length; this.hash.update(line);
        const value: unknown = JSON.parse(fileText(line), (key, item: unknown) => { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(); return item; });
        if (!record(value) || value.v !== 1 || value.n !== this.nonce || value.end !== this.nonce || value.seq !== ++this.sequence || typeof value.kind !== 'string') throw new RemoteFileError('protocol', true);
        if (value.kind === 'failure') {
          const codes: RemoteFileFailure[] = ['protocol', 'integrity', 'version', 'capacity', 'invalid-input', 'not-found', 'permission', 'timeout'];
          throw new RemoteFileError(codes.includes(value.code as RemoteFileFailure) ? value.code as RemoteFileFailure : 'protocol', true);
        }
        const waiter = this.waiter;
        if (!waiter || waiter.records.length >= waiter.max) throw new RemoteFileError('protocol', true);
        waiter.records.push(value);
        if (waiter.done(value, waiter.records.length)) { this.waiter = undefined; waiter.resolve(waiter.records); }
      }
      // 通知可以同时包含上一记录尾和下一记录头；限制针对记录而非传输分片拼接。
      if (this.pending.length >= RECORD_LIMIT) throw new RemoteFileError('capacity', true);
      this.assert();
    } catch (error) { this.fail(error instanceof RemoteFileError ? error.code : 'protocol'); }
  };
  async start(): Promise<void> {
    try {
      this.assert(); const params: Record<string, JsonValue> = { command: [this.binding.python, '-I', '-u', '-c', REMOTE_FILE_PYTHON, this.nonce, String(this.remaining())], cwd: this.binding.metadata.codexHome, processId: this.processId, streamStdin: true, streamStdoutStderr: true, outputBytesCap: TOTAL_WIRE_LIMIT, timeoutMs: this.remaining() };
      this.execution = this.session.call('command/exec', params, { timeoutMs: this.remaining() }); this.sent = true;
      void this.execution.then(() => { if (!this.stopping) this.fail('protocol'); }, error => {
        if (!this.ready && error instanceof RemoteRpcError && !error.mayHaveBeenSent) this.sent = false;
        if (!this.stopping) this.fail(fileFailure(error, this.sent).code);
      });
      await this.race(Promise.race([this.readiness, this.execution.then(() => { throw new RemoteFileError('protocol', true); })])); this.assert();
    } catch (error) {
      if (error instanceof RemoteRpcError && !error.mayHaveBeenSent && !this.ready) this.sent = false;
      const failure = fileFailure(error, this.sent); this.fail(failure.code); throw failure;
    }
  }
  async race<T>(promise: Promise<T>): Promise<T> {
    const value = await Promise.race([promise, this.failure]); this.assert(); return value;
  }
  async exchange(payloads: Record<string, unknown>[], max = payloads.length, done = (_record: Record<string, unknown>, count: number) => count === max): Promise<Record<string, unknown>[]> {
    const operation = async () => {
      this.assert(); if (this.waiter || payloads.length < 1 || payloads.length > FILE_WINDOW || max > FILE_WINDOW + 1) throw new RemoteFileError('protocol', this.sent);
      const response = new Promise<Record<string, unknown>[]>(resolve => { this.waiter = { records: [], max, done, resolve }; });
      // 每帧双层base64后小于默认1MiB RPC上限。只允许本文件有限窗口，不扩大通用命令输入。
      const writes = payloads.map((payload, index) => {
        const request = this.initialRequest ? { ...payload, readyBudgetMs: this.remaining() } : payload; this.initialRequest = false;
        const bytes = Buffer.from(JSON.stringify(request) + '\n');
        // RPC持有自己的序列化值后，不再同时保留整个窗口的内层base64对象。
        payloads[index] = {};
        if (bytes.length >= RECORD_LIMIT) throw new RemoteFileError('capacity', this.sent);
        this.assert(); return this.session.call('command/exec/write', { processId: this.processId, deltaBase64: bytes.toString('base64'), closeStdin: false }, { timeoutMs: this.remaining(), signal: this.abort.signal }).then(ack => {
          this.assert(); if (!record(ack) || Object.keys(ack).length) throw new RemoteFileError('protocol', true);
        });
      });
      // 即使一帧失败，也观察全部在途Promise；从不重发。
      const all = Promise.all(writes); void all.catch(() => undefined);
      await this.race(all); const result = await this.race(response); this.assert(); return result;
    };
    return this.cleanup ? operation() : withRemoteOperation(() => this.assert(false), operation);
  }
  async finish(): Promise<void> {
    await this.race(Promise.race([this.done, this.execution!.then(() => { throw new RemoteFileError('protocol', true); })]));
    if (!(await this.stop(true))) throw new RemoteFileError('protocol', true);
    this.assert();
    if (this.trailingBytes || !this.completion || this.bytes !== this.completion.size || this.hash.digest('hex') !== this.completion.sha256) throw new RemoteFileError('integrity', true);
    this.assert();
  }
  stop(success = false): Promise<boolean> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        if (!this.sent || !this.session.ready) return !this.sent;
        const budget = success ? this.remaining() : 1000;
        const termination = this.session.call('command/exec/terminate', { processId: this.processId }, { timeoutMs: budget });
        const final = Promise.all([termination, this.execution]).then(([ack, result]) => {
          if (!record(ack) || Object.keys(ack).length || !record(result) || Object.keys(result).sort().join(',') !== 'exitCode,stderr,stdout' || !Number.isSafeInteger(result.exitCode) || (result.exitCode as number) < -2147483648 || (result.exitCode as number) > 2147483647 || result.stdout !== '' || result.stderr !== '') return false;
          return true;
        });
        const bounded = new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), budget); });
        const value = await Promise.race([final, bounded]); this.settled = value; return value;
      } catch { return false; }
      finally { if (timer) clearTimeout(timer); this.dispose(); }
    })(); return this.stopping;
  }
  private dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.session.off('notification', this.notification); this.session.off('disconnect', this.disconnected); this.session.off('close', this.disconnected);
    this.abort.abort(); this.waiter = undefined; this.trailingBytes = this.pending.length; this.pending = Buffer.alloc(0);
  }
  /** 命令实际结束不等于调用者已消费最终窗口；预算直到消费/取消/期限/close才释放。 */
  release(): void {
    if (this.released) return; this.released = true; clearTimeout(this.timer); this.signal?.removeEventListener('abort', this.cancelled);
    this.clearWindow(); active--; memory -= RESERVATION; this.onRelease?.();
  }
}
