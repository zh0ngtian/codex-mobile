import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { TextDecoder } from 'node:util';
import WebSocket, { type RawData } from 'ws';
import { RemoteNetworkError } from './auth.js';
import { RemoteSendError, RemoteStream, type RemoteDisconnect } from './relay.js';
import type { JsonValue, RpcMessage, ServerPong } from './envelope.js';

export interface RemoteRpcSessionOptions {
  connectTimeoutMs?: number; initializeTimeoutMs?: number; responseTimeoutMs?: number;
  maxPending?: number; maxRequestBytes?: number; maxInboundBytes?: number;
}
export type RemoteRpcFailure = 'network' | 'timeout' | 'protocol' | 'capacity' | 'closed' | 'response';
/** 仅包含固定错误文本；上游 payload、URL 和凭据不进入 error/cause。 */
export class RemoteRpcError extends RemoteNetworkError {
  constructor(readonly code: RemoteRpcFailure, readonly mayHaveBeenSent: boolean) {
    super(code === 'timeout' ? 'Remote RPC 操作超时' : 'Remote RPC 操作失败'); this.name = 'RemoteRpcError';
  }
}
interface SessionEvents {
  notification: [message: RpcMessage]; request: [message: RpcMessage];
  disconnect: [event: RemoteDisconnect]; close: [];
}
interface Pending {
  id?: string; submitted: boolean; timer: NodeJS.Timeout;
  resolve: (value: unknown) => void; reject: (error: RemoteRpcError) => void;
}
function boundedOption(value: number | undefined, fallback: number, max: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > max) throw new RemoteRpcError('capacity', false);
  return result;
}
const managedStreams = new WeakSet<RemoteStream>();
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function safeJson(value: unknown): string {
  const encoded = JSON.stringify(value, (key, item: unknown) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || typeof item === 'bigint' || typeof item === 'function' || typeof item === 'symbol' || (typeof item === 'number' && !Number.isFinite(item))) throw new Error();
    return item;
  });
  if (typeof encoded !== 'string') throw new Error(); return encoded;
}

/** 管理 RPC 的小型 session；不创建 Remote 主连接，不重放任何请求。 */
export class RemoteRpcSession extends EventEmitter<SessionEvents> {
  private readonly options: Required<RemoteRpcSessionOptions>;
  private readonly prefix = randomUUID();
  private sequence = 0;
  private readonly pending = new Set<Pending>();
  private readonly responses = new Map<string, Pending>();
  private readonly disposers: (() => void)[] = [];
  private initializing?: Promise<Readonly<Record<string, unknown>>>;
  private initializeTimer?: NodeJS.Timeout;
  private initialization?: Readonly<Record<string, unknown>>;
  private terminal = false;
  private initialized = false;

  private constructor(private readonly transport: WebSocket | RemoteStream, options: RemoteRpcSessionOptions) {
    super();
    this.options = {
      connectTimeoutMs: boundedOption(options.connectTimeoutMs, 10000, 180000),
      initializeTimeoutMs: boundedOption(options.initializeTimeoutMs, 20000, 180000),
      responseTimeoutMs: boundedOption(options.responseTimeoutMs, 20000, 180000),
      maxPending: boundedOption(options.maxPending, 64, 65536),
      maxRequestBytes: boundedOption(options.maxRequestBytes, 1024 * 1024, 64 * 1024 * 1024),
      maxInboundBytes: boundedOption(options.maxInboundBytes, 8 * 1024 * 1024, 64 * 1024 * 1024),
    };
    if (transport instanceof RemoteStream) {
      const message = (value: RpcMessage) => this.receive(value);
      const disconnect = (event: RemoteDisconnect) => {
        const terminal = !this.initialized || event.reason === 'auth-required' || event.reason === 'closed';
        this.rejectPending('network');
        try { this.emit('disconnect', { ...event }); } catch { /* 调用方监听器不阻碍清理。 */ }
        if (terminal) this.finish('network');
      };
      const pong = (value: ServerPong) => { if (value.status === 'unknown') this.finish('protocol'); };
      const sendError = () => { this.rejectPending('network'); };
      const close = () => this.finish('closed');
      transport.on('message', message); transport.on('disconnect', disconnect); transport.on('pong', pong); transport.on('sendError', sendError); transport.on('close', close);
      this.disposers.push(() => transport.off('message', message), () => transport.off('disconnect', disconnect), () => transport.off('pong', pong), () => transport.off('sendError', sendError), () => transport.off('close', close));
      if (transport.closed) this.finish('closed');
    } else {
      const message = (raw: RawData, binary: boolean) => {
        if (binary) { this.finish('protocol'); return; }
        try {
          const bytes = Array.isArray(raw) ? Buffer.concat(raw) : raw instanceof ArrayBuffer ? Buffer.from(raw) : raw;
          if (bytes.byteLength > this.options.maxInboundBytes) throw new Error();
          this.receive(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes), (key, value: unknown) => {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(); return value;
          }));
        } catch { this.finish('protocol'); }
      };
      const error = () => this.finish('network'); const close = () => this.finish('network');
      transport.on('message', message); transport.on('error', error); transport.on('close', close);
      this.disposers.push(() => transport.off('message', message), () => transport.off('error', error), () => transport.off('close', close));
    }
  }
  /** 显式 canonical 地址；不猜端口、环境变量或其他本机实例。 */
  static async connectCanonical(url: string, options: RemoteRpcSessionOptions = {}): Promise<RemoteRpcSession> {
    let socket: WebSocket | undefined; let session: RemoteRpcSession | undefined;
    try {
      const parsed = new URL(url);
      if (!['ws:', 'wss:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.hash) throw new RemoteRpcError('protocol', false);
      const timeout = boundedOption(options.connectTimeoutMs, 10000, 180000);
      const maxPayload = boundedOption(options.maxInboundBytes, 8 * 1024 * 1024, 64 * 1024 * 1024);
      socket = new WebSocket(url, { maxPayload, perMessageDeflate: false });
      session = new RemoteRpcSession(socket, options);
      const current = session; const connection = socket;
      await new Promise<void>((resolve, reject) => {
        const done = (failure?: RemoteRpcFailure) => {
          clearTimeout(timer); connection.off('open', opened); current.off('close', closed);
          if (failure) reject(new RemoteRpcError(failure, false)); else resolve();
        };
        const opened = () => done(); const closed = () => done('network');
        const timer = setTimeout(() => { done('timeout'); current.finish('timeout'); }, timeout);
        connection.once('open', opened); current.once('close', closed);
      });
      return session;
    } catch (error) {
      session?.close();
      if (socket && !session) { socket.on('error', () => {}); socket.terminate(); }
      throw new RemoteRpcError(error instanceof RemoteRpcError ? error.code : 'network', false);
    }
  }
  static fromRemoteStream(stream: RemoteStream, options: RemoteRpcSessionOptions = {}): RemoteRpcSession {
    if (stream.closed || managedStreams.has(stream)) throw new RemoteRpcError('closed', false);
    const session = new RemoteRpcSession(stream, options); managedStreams.add(stream); return session;
  }
  get ready(): boolean { return this.initialized && !this.terminal; }
  get closed(): boolean { return this.terminal; }
  get metadata(): Readonly<Record<string, unknown>> | undefined { return this.initialization; }
  initialize(params: JsonValue = { clientInfo: { name: 'codex-mobile-remote-manager', version: '1' }, capabilities: { experimentalApi: true } }): Promise<Readonly<Record<string, unknown>>> {
    if (this.terminal) return Promise.reject(new RemoteRpcError('closed', false));
    if (this.initializing) return this.initializing;
    this.initializeTimer = setTimeout(() => this.finish('timeout'), this.options.initializeTimeoutMs);
    this.initializing = (async () => {
      try {
        const metadata = await this.submit('initialize', params, true, this.options.initializeTimeoutMs);
        if (!record(metadata)) throw new RemoteRpcError('protocol', true);
        await this.submit('initialized', {}, false, this.options.initializeTimeoutMs);
        if (this.terminal) throw new RemoteRpcError('closed', true);
        this.initialization = Object.freeze(metadata); this.initialized = true;
        return this.initialization;
      } catch (error) {
        this.finish(error instanceof RemoteRpcError ? error.code : 'protocol');
        throw error instanceof RemoteRpcError ? error : new RemoteRpcError('protocol', true);
      } finally { clearTimeout(this.initializeTimer); this.initializeTimer = undefined; }
    })();
    return this.initializing;
  }
  call(method: string, params?: JsonValue): Promise<unknown> {
    if (!this.ready || method === 'initialize' || method === 'initialized') return Promise.reject(new RemoteRpcError('closed', false));
    return this.submit(method, params, true, this.options.responseTimeoutMs);
  }
  async notify(method: string, params?: JsonValue): Promise<void> {
    if (!this.ready || method === 'initialize' || method === 'initialized') throw new RemoteRpcError('closed', false);
    await this.submit(method, params, false, this.options.responseTimeoutMs);
  }
  private submit(method: string, params: JsonValue | undefined, response: boolean, timeout: number): Promise<unknown> {
    if (this.terminal) return Promise.reject(new RemoteRpcError('closed', false));
    if (this.pending.size >= this.options.maxPending) return Promise.reject(new RemoteRpcError('capacity', false));
    let message: RpcMessage; let encoded: string; let id: string | undefined;
    try {
      if (typeof method !== 'string' || !method.length || method.length > 1024 || /[\u0000-\u001f\u007f]/.test(method)) throw new Error();
      if (!Number.isSafeInteger(++this.sequence)) throw new Error();
      id = response ? `${this.prefix}:${this.sequence}` : undefined;
      message = { ...(id === undefined ? {} : { id }), method, ...(params === undefined ? {} : { params }) };
      encoded = safeJson(message);
      if (Buffer.byteLength(encoded) > this.options.maxRequestBytes) throw new Error();
    } catch { return Promise.reject(new RemoteRpcError('capacity', false)); }
    return new Promise((resolve, reject) => {
      const entry: Pending = { id, submitted: false, resolve, reject, timer: setTimeout(() => this.settle(entry, new RemoteRpcError('timeout', entry.submitted)), timeout) };
      this.pending.add(entry); if (id !== undefined) this.responses.set(id, entry);
      const sent = (error?: unknown) => {
        if (!this.pending.has(entry)) return;
        if (error) this.settle(entry, new RemoteRpcError('network', error instanceof RemoteSendError ? error.mayHaveBeenSent : entry.submitted));
        else if (!response) this.settle(entry, undefined, undefined);
      };
      try {
        if (this.transport instanceof RemoteStream) {
          entry.submitted = true;
          Promise.resolve(this.transport.send(message)).then(() => sent(), sent);
        } else {
          if (this.transport.readyState !== WebSocket.OPEN) { sent(new RemoteSendError('', false)); return; }
          entry.submitted = true; this.transport.send(encoded, error => sent(error));
        }
      } catch (error) { sent(error); }
    });
  }
  private receive(value: unknown): void {
    if (this.terminal) return;
    try {
      if (!record(value) || Buffer.byteLength(safeJson(value)) > this.options.maxInboundBytes) throw new Error();
      const message = value as RpcMessage;
      if (Object.hasOwn(value, 'method')) {
        if (typeof value.method !== 'string' || !value.method.length) throw new Error();
        this.emit(Object.hasOwn(value, 'id') ? 'request' : 'notification', message); return;
      }
      if (typeof value.id !== 'string') return;
      const entry = this.responses.get(value.id); if (!entry) return;
      const hasResult = Object.hasOwn(value, 'result'); const hasError = Object.hasOwn(value, 'error');
      if (hasResult === hasError) throw new Error();
      this.settle(entry, hasError ? new RemoteRpcError('response', true) : undefined, value.result);
    } catch { this.finish('protocol'); }
  }
  private settle(entry: Pending, error?: RemoteRpcError, value?: unknown): void {
    if (!this.pending.delete(entry)) return;
    clearTimeout(entry.timer); if (entry.id !== undefined) this.responses.delete(entry.id);
    if (error) entry.reject(error); else entry.resolve(value);
  }
  private rejectPending(code: RemoteRpcFailure): void {
    for (const entry of this.pending) this.settle(entry, new RemoteRpcError(code, entry.submitted));
  }
  private finish(code: RemoteRpcFailure): void {
    if (this.terminal) return; this.terminal = true; this.initialized = false;
    clearTimeout(this.initializeTimer); this.initializeTimer = undefined; this.rejectPending(code);
    for (const dispose of this.disposers.splice(0)) { try { dispose(); } catch { /* 尽可能清理其余监听器。 */ } }
    try {
      if (this.transport instanceof RemoteStream) void this.transport.close().catch(() => undefined);
      else if (this.transport.readyState !== WebSocket.CLOSED) {
        const socket = this.transport;
        socket.on('error', ignoreSocketError); socket.once('close', () => socket.off('error', ignoreSocketError)); socket.terminate();
      }
    } catch { /* close 失败也不保留 session 资源。 */ }
    try { this.emit('close'); } catch { /* 调用方监听器不阻碍清理。 */ }
    finally { this.removeAllListeners(); }
  }
  close(): void { this.finish('closed'); }
}
function ignoreSocketError(): void { /* terminate 期间 ws 仍可能异步报告连接错误。 */ }
