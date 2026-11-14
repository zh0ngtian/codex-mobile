import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { TextDecoder } from 'node:util';
import { assertRemoteOperation, runRemoteCleanup, withRemoteOperation } from './operation-guard.js';
import { RemoteRpcError, type RemoteRpcSession } from './rpc-session.js';
import type { JsonValue, RpcMessage } from './envelope.js';
import { REMOTE_MODEL_UPLOAD_PYTHON } from './model-upload-python.js';

export type RemoteModelUploadFailure = 'binding' | 'capability' | 'capacity' | 'protocol' | 'timeout' | 'cancelled' | 'disconnected' | 'closed' | 'invalid-input';
export class RemoteModelUploadError extends Error {
  constructor(readonly code: RemoteModelUploadFailure) { super('Remote 目标既有模型计量来源不可用'); this.name = 'RemoteModelUploadError'; }
}
const MAX_WIRE = 8 * 1024 * 1024;
const MAX_RECORD = 16384;
let channels = 0;
export function meterRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
export function meterKeys(value: unknown, names: string[]): value is Record<string, unknown> { return meterRecord(value) && Reflect.ownKeys(value).length === names.length && names.every(name => Object.hasOwn(value, name) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, name)!, 'value')); }
function bytes(value: unknown, max: number): Buffer {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || value.length % 4 || /[^A-Za-z0-9+/=]/.test(value)) throw new RemoteModelUploadError('protocol');
  const result = Buffer.from(value, 'base64'); if (result.length > max || result.toString('base64') !== value) throw new RemoteModelUploadError('protocol'); return result;
}
const utf8 = (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
const execEnded = (value: unknown) => meterKeys(value, ['exitCode', 'stdout', 'stderr']) && Number.isSafeInteger(value.exitCode) && (value.exitCode as number) >= -2147483648 && (value.exitCode as number) <= 2147483647 && typeof value.stdout === 'string' && typeof value.stderr === 'string';
function failure(error: unknown): RemoteModelUploadFailure {
  return error instanceof RemoteModelUploadError ? error.code : error instanceof RemoteRpcError ? error.code === 'timeout' ? 'timeout' : error.code === 'cancelled' ? 'cancelled' : error.code === 'response' ? 'capability' : error.code === 'capacity' ? 'capacity' : 'disconnected' : 'protocol';
}

/** 单一固定统计程序的有界通知通道；无任意脚本/权限入口，不拥有调用者session。 */
export class RemoteModelUploadChannel {
  readonly processId = 'codex-mobile-meter:' + randomUUID();
  private readonly nonce = randomUUID();
  private readonly deadline: number;
  private readonly readiness: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: RemoteModelUploadError) => void;
  private readonly ended: Promise<void>;
  private resolveEnded!: () => void;
  private execution?: Promise<unknown>;
  private completed = false;
  private actualEnded = false;
  private released = false;
  private sent = false;
  private stopped = false;
  private termination?: Promise<unknown>;
  private error?: RemoteModelUploadError;
  private pending = Buffer.alloc(0);
  private control = Buffer.alloc(0);
  private ready = false;
  private sequence = 0;
  private notifications = 0;
  private total = 0;
  private readonly digest = createHash('sha256');
  private completion?: { bytes: number; sha256: string };
  private timer: NodeJS.Timeout;
  constructor(private readonly session: RemoteRpcSession, private readonly binding: { python: string; metadata: { codexHome: string } }, deadline: number,
    private readonly accept: (value: Record<string, unknown>) => void, private readonly invalidated: (error?: RemoteModelUploadError) => void, private readonly signal?: AbortSignal) {
    this.deadline = deadline;
    if (channels >= 4) throw new RemoteModelUploadError('capacity');
    channels++;
    this.readiness = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; }); void this.readiness.catch(() => undefined);
    this.ended = new Promise(resolve => { this.resolveEnded = resolve; });
    this.timer = setTimeout(this.expired, Math.max(1, Math.ceil(deadline - performance.now())));
    session.on('notification', this.notification); session.on('disconnect', this.disconnected); session.on('close', this.disconnected);
    signal?.addEventListener('abort', this.cancelled, { once: true });
  }
  private assert(checkParents = true): void {
    if (this.error) throw this.error;
    if (this.stopped) throw new RemoteModelUploadError('closed');
    if (performance.now() >= this.deadline) throw new RemoteModelUploadError('timeout');
    if (this.signal?.aborted) throw new RemoteModelUploadError('cancelled');
    if (!this.session.ready) throw new RemoteModelUploadError('disconnected');
    if (checkParents) assertRemoteOperation();
  }
  private remaining(): number { this.assert(); return Math.max(1, Math.floor(this.deadline - performance.now())); }
  private expired = (): void => {
    if (performance.now() < this.deadline) { this.timer = setTimeout(this.expired, Math.max(1, Math.ceil(this.deadline - performance.now()))); return; }
    this.fail('timeout'); this.release();
  };
  private disconnected = () => this.fail('disconnected');
  private cancelled = () => this.fail('cancelled');
  async start(): Promise<void> {
    try {
      this.assert();
      const params: Record<string, JsonValue> = { command: [this.binding.python, '-I', '-u', '-c', REMOTE_MODEL_UPLOAD_PYTHON, this.nonce, String(this.remaining())], cwd: this.binding.metadata.codexHome,
        processId: this.processId, streamStdin: true, streamStdoutStderr: true, timeoutMs: this.remaining(), outputBytesCap: MAX_WIRE + 1024,
        sandboxPolicy: { type: 'readOnly', networkAccess: true } };
      const begin = () => {
        this.sent = true;
        this.execution = this.session.call('command/exec', params, { timeoutMs: this.remaining(), deadline: this.deadline });
        // 原始exec独立观察实际结束；live guard失效不能用abort把终结事实提前替换成RPC拒绝。
        void this.execution.then(value => {
          this.actualEnded = execEnded(value);
          if (!this.stopped) {
            try {
              this.assert();
              if (!this.completed || !this.completion || this.pending.length || !execEnded(value) || (value as Record<string, unknown>).exitCode !== 0 || (value as Record<string, unknown>).stdout !== '' || (value as Record<string, unknown>).stderr !== ''
                || this.total !== this.completion.bytes || this.digest.digest('hex') !== this.completion.sha256) throw new RemoteModelUploadError('protocol');
              this.stopped = true; this.invalidated();
            } catch (error) { this.fail(failure(error)); }
          }
          this.tryRelease();
        }, error => {
          if (!this.ready && error instanceof RemoteRpcError && !error.mayHaveBeenSent) this.sent = false;
          this.fail(failure(error)); this.tryRelease();
        });
        return this.execution;
      };
      void withRemoteOperation(() => this.assert(false), begin).catch(error => { if (!this.execution) this.sent = false; this.fail(failure(error)); this.tryRelease(); });
      await this.readiness; this.assert();
    } catch (error) { this.fail(failure(error)); throw this.error ?? new RemoteModelUploadError(failure(error)); }
  }
  private notification = (message: RpcMessage): void => {
    if (message.method !== 'command/exec/outputDelta' || !meterRecord(message.params) || message.params.processId !== this.processId || this.stopped) return;
    try {
      this.assert(); const p = message.params;
      if (!meterKeys(p, ['processId', 'stream', 'deltaBase64', 'capReached']) || p.capReached !== false || !['stdout', 'stderr'].includes(p.stream as string) || ++this.notifications > 65536) throw new RemoteModelUploadError('protocol');
      if (p.stream === 'stderr') {
        const part = bytes(p.deltaBase64, 256);
        if (this.completion || this.control.length + part.length > 256) throw new RemoteModelUploadError('protocol');
        this.control = Buffer.concat([this.control, part]);
        const prefix = Buffer.from('CMMETER1_DONE:' + this.nonce + ':'); const length = Math.min(this.control.length, prefix.length);
        if (!this.control.subarray(0, length).equals(prefix.subarray(0, length))) throw new RemoteModelUploadError('protocol');
        if (this.control.includes(10)) {
          const match = /^CMMETER1_DONE:([a-z0-9-]+):([1-9][0-9]{0,7}):([a-f0-9]{64})\n$/.exec(utf8(this.control));
          if (!match || match[1] !== this.nonce || Number(match[2]) > MAX_WIRE) throw new RemoteModelUploadError('protocol');
          this.completion = { bytes: Number(match[2]), sha256: match[3]! };
        }
        return;
      }
      const encoded = p.deltaBase64;
      if (typeof encoded !== 'string' || encoded.length % 4 || encoded.length > Math.ceil(MAX_WIRE / 3) * 4) throw new RemoteModelUploadError('protocol');
      const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
      if (encoded.indexOf('=') !== (padding ? encoded.length - padding : -1)) throw new RemoteModelUploadError('protocol');
      if (this.total + this.pending.length + encoded.length / 4 * 3 - padding > MAX_WIRE + 128) throw new RemoteModelUploadError('capacity');
      // 通知可合并多条记录；只解码有限片段，不复制整个上游大通知。
      for (let offset = 0; offset < encoded.length; offset += 65536) { this.stdout(bytes(encoded.slice(offset, offset + 65536), 49152)); this.assert(); }
    } catch (error) { this.fail(failure(error)); }
  };
  private stdout(data: Buffer): void {
    let offset = 0;
    while (offset < data.length) {
      const end = data.indexOf(10, offset); const part = data.subarray(offset, end < 0 ? data.length : end + 1);
      if (this.pending.length + part.length > MAX_RECORD) throw new RemoteModelUploadError('protocol');
      this.pending = Buffer.concat([this.pending, part]); offset += part.length;
      if (end < 0) break;
      const line = this.pending; this.pending = Buffer.alloc(0); this.line(line); this.assert();
    }
  }
  private line(line: Buffer): void {
    if (!this.ready) {
      if (!line.equals(Buffer.from('CMMETER1_READY:' + this.nonce + '\n'))) throw new RemoteModelUploadError('protocol');
      this.ready = true;
      const input = Buffer.from(JSON.stringify({ home: this.binding.metadata.codexHome, budgetMs: this.remaining() }) + '\n');
      if (input.length > 32768) throw new RemoteModelUploadError('capacity');
      void withRemoteOperation(() => this.assert(false), () => this.session.call('command/exec/write', { processId: this.processId, deltaBase64: input.toString('base64'), closeStdin: true }, { timeoutMs: this.remaining(), deadline: this.deadline })).then(ack => {
        if (this.stopped) return;
        try { this.assert(); if (!meterKeys(ack, [])) throw new RemoteModelUploadError('protocol'); } catch (error) { this.fail(failure(error)); }
      }, error => this.fail(failure(error)));
      return;
    }
    if (this.completed) throw new RemoteModelUploadError('protocol');
    const value: unknown = JSON.parse(utf8(line), (key, item: unknown) => { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(); return item; });
    if (!meterRecord(value) || value.v !== 1 || value.n !== this.nonce || value.end !== this.nonce || value.seq !== this.sequence + 1) throw new RemoteModelUploadError('protocol');
    const keys = ['v', 'n', 'end', 'seq', 'kind'];
    if (value.kind === 'failure') {
      if (!meterKeys(value, [...keys, 'code']) || !['capability', 'protocol'].includes(value.code as string)) throw new RemoteModelUploadError('protocol');
      throw new RemoteModelUploadError(value.code as 'capability' | 'protocol');
    }
    if (value.kind === 'complete') {
      if (!meterKeys(value, [...keys, 'records', 'bytes', 'sha256']) || value.records !== this.sequence || value.bytes !== this.total || value.sha256 !== this.digest.copy().digest('hex')) throw new RemoteModelUploadError('protocol');
      this.completed = true;
    } else if (!meterKeys(value, [...keys, ...(value.kind === 'verified' ? ['sourceHash'] : ['frame'])]) || !['verified', 'frame'].includes(value.kind as string)) throw new RemoteModelUploadError('protocol');
    this.sequence++; this.total += line.length; this.digest.update(line);
    if (value.kind === 'complete') { this.invalidated(); return; }
    this.accept(value); this.assert();
    if (value.kind === 'verified') this.resolveReady();
  }
  private fail(code: RemoteModelUploadFailure): void {
    if (this.stopped) return;
    this.stopped = true; this.error = new RemoteModelUploadError(code); this.rejectReady(this.error); this.invalidated(this.error);
    this.detach(); this.terminate(); this.tryRelease();
  }
  private terminate(): void {
    if (this.sent && !this.actualEnded && this.session.ready && !this.termination) {
      // cleanup仅精确定位本实例生成的processId；不继承已过期的业务期限。
      this.termination = runRemoteCleanup(() => this.session.call('command/exec/terminate', { processId: this.processId }, { timeoutMs: 1000 }));
      void this.termination.catch(() => undefined);
    }
  }
  private detach(): void {
    this.session.off('notification', this.notification); this.session.off('disconnect', this.disconnected); this.session.off('close', this.disconnected);
    this.signal?.removeEventListener('abort', this.cancelled); this.pending = Buffer.alloc(0); this.control = Buffer.alloc(0);
  }
  private tryRelease(): void { if (this.stopped && (!this.sent || this.actualEnded || performance.now() >= this.deadline)) this.release(); }
  private release(): void {
    if (this.released) return; this.released = true; this.detach(); clearTimeout(this.timer); channels--; this.resolveEnded();
  }
  close(): Promise<void> { this.fail(this.signal?.aborted ? 'cancelled' : 'closed'); this.tryRelease(); return this.ended; }
  settled(): Promise<void> { return this.ended; }
  valid(): boolean { try { this.assert(false); return !this.completed; } catch (error) { this.fail(failure(error)); return false; } }
}
