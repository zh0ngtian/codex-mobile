import type { ModelUploadSource, ModelUploadUsage } from '../model-upload-meter.js';
import { AsyncResource } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { RemoteRpcSession } from './rpc-session.js';
import { RemoteCommands, RemoteCommandError } from './commands.js';
import { RemoteModelUploadChannel, RemoteModelUploadError, meterKeys, meterRecord } from './model-upload-channel.js';
export { RemoteModelUploadError } from './model-upload-channel.js';

let sources = 0;
const usageKeys = ['epoch', 'revision', 'turnId', 'lastRequestBytes', 'turnBytes', 'requestCount'];
function identifier(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && Buffer.from(value).toString('utf8') === value; }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function usageCopy(value: unknown): ModelUploadUsage {
  if (!meterKeys(value, usageKeys) || !identifier(value.epoch) || !identifier(value.turnId) || !positive(value.revision) || !positive(value.turnBytes) || !positive(value.requestCount)
    || typeof value.lastRequestBytes !== 'number' || !Number.isSafeInteger(value.lastRequestBytes) || value.lastRequestBytes < 0 || value.lastRequestBytes > value.turnBytes) throw new RemoteModelUploadError('protocol');
  return { epoch: value.epoch, revision: value.revision, turnId: value.turnId, turnBytes: value.turnBytes, lastRequestBytes: value.lastRequestBytes, requestCount: value.requestCount };
}

/** 只订阅绑定目标自己的既有来源；ready仅证明hello，绝不把静默视为完整快照。 */
export class RemoteModelUploadSource implements ModelUploadSource {
  // 保留创建者作用域；后续重新证明不继承上一有限读取命令已经失效的live guard。
  private readonly context = new AsyncResource('remote-model-upload-source');
  private readonly threads = new Map<string, ModelUploadUsage>();
  private readonly listeners = new Set<(threadId: string, usage: ModelUploadUsage | null) => void>();
  private channel?: RemoteModelUploadChannel;
  private verified = false;
  private closed = false;
  private initialized = false;
  private retry?: NodeJS.Timeout;
  private closing?: Promise<void>;
  private constructor(private readonly session: RemoteRpcSession, private readonly commands: RemoteCommands, private readonly windowMs: number, private readonly signal?: AbortSignal) { sources++; signal?.addEventListener('abort', this.cancelled, { once: true }); }
  static async create(session: RemoteRpcSession, commands: RemoteCommands, options: { windowMs?: number; signal?: AbortSignal } = {}): Promise<RemoteModelUploadSource> {
    const started = performance.now();
    if (!meterRecord(options) || Reflect.ownKeys(options).some(key => typeof key !== 'string' || !['windowMs', 'signal'].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key)!, 'value'))
      || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) throw new RemoteModelUploadError('invalid-input');
    const windowMs = options.windowMs ?? 180000;
    if (!Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > 180000) throw new RemoteModelUploadError('capacity');
    if (options.signal?.aborted) throw new RemoteModelUploadError('cancelled');
    if (!(session instanceof RemoteRpcSession) || !(commands instanceof RemoteCommands)) throw new RemoteModelUploadError('binding');
    if (sources >= 4) throw new RemoteModelUploadError('capacity');
    const source = new RemoteModelUploadSource(session, commands, windowMs, options.signal);
    try { await source.connect(started + windowMs); source.initialized = true; return source; }
    catch (error) { void source.close(); throw error; }
  }
  private notify(threadId: string, usage: ModelUploadUsage | null, subscribers = [...this.listeners]): void {
    for (const listener of subscribers) {
      if (usage ? !this.verified || this.closed || this.threads.get(threadId) !== usage : this.threads.has(threadId)) break;
      if (this.listeners.has(listener)) try { listener(threadId, usage ? { ...usage } : null); } catch { /* 订阅者不影响共享来源。 */ }
    }
  }
  private remove(threadId: string): void { if (this.threads.delete(threadId)) this.notify(threadId, null); }
  private invalidate = (): void => {
    this.verified = false;
    const affected = [...this.threads.keys()]; const subscribers = [...this.listeners]; this.threads.clear();
    for (const threadId of affected) this.notify(threadId, null, subscribers);
  };
  private cancelled = (): void => { void this.close(); };
  private accept = (value: Record<string, unknown>): void => {
    if (this.closed) throw new RemoteModelUploadError('closed');
    if (value.kind === 'verified') {
      if (this.verified || typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash)) throw new RemoteModelUploadError('protocol');
      this.verified = true; return;
    }
    if (!this.verified || !meterRecord(value.frame)) throw new RemoteModelUploadError('protocol');
    const frame = value.frame;
    if (frame.type === 'remove') {
      if (!meterKeys(frame, ['type', 'threadId']) || !identifier(frame.threadId)) throw new RemoteModelUploadError('protocol');
      this.remove(frame.threadId); return;
    }
    if (!meterKeys(frame, ['type', 'threadId', 'usage']) || frame.type !== 'usage' || !identifier(frame.threadId)) throw new RemoteModelUploadError('protocol');
    const usage = usageCopy(frame.usage); const previous = this.threads.get(frame.threadId);
    if (previous?.epoch === usage.epoch && previous.revision >= usage.revision) return;
    this.threads.set(frame.threadId, usage);
    while (this.threads.size > 2048) this.remove(this.threads.keys().next().value!);
    this.notify(frame.threadId, usage);
  };
  private async connect(deadline = performance.now() + this.windowMs): Promise<void> {
    if (this.closed) throw new RemoteModelUploadError('closed');
    let binding: ReturnType<RemoteCommands['fileTransportBinding']>;
    try { binding = this.commands.fileTransportBinding(this.session); }
    catch (error) { throw new RemoteModelUploadError(error instanceof RemoteCommandError && error.code === 'binding' ? 'binding' : 'capability'); }
    if (binding.metadata.platformFamily !== 'unix') throw new RemoteModelUploadError('capability');
    const channel = new RemoteModelUploadChannel(this.session, binding, deadline, value => {
      if (this.channel === channel && !this.closed) this.accept(value);
    }, () => {
      if (this.channel !== channel || this.closed) return;
      this.invalidate();
      if (this.initialized) void channel.settled().then(() => {
        if (this.channel === channel) this.context.runInAsyncScope(() => this.schedule());
      });
    }, this.signal);
    this.channel = channel;
    await channel.start();
  }
  private schedule(): void {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect().catch(() => this.schedule()); }, 1000); this.retry.unref();
  }
  read(threadId: string): ModelUploadUsage | null {
    if (!this.verified || !this.channel?.valid()) return null;
    const value = this.threads.get(threadId); return value ? { ...value } : null;
  }
  subscribe(listener: (threadId: string, usage: ModelUploadUsage | null) => void): () => void { if (!this.closed) this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = Promise.resolve().then(async () => { await this.channel?.close(); })
      .finally(() => { sources--; this.context.emitDestroy(); });
    this.closed = true; this.invalidate(); this.listeners.clear(); this.signal?.removeEventListener('abort', this.cancelled);
    if (this.retry) clearTimeout(this.retry); this.retry = undefined;
    return this.closing;
  }
}
