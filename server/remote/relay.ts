import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { TextDecoder } from 'node:util';
import WebSocket, { type RawData } from 'ws';
import {
  DEFAULT_REMOTE_MESSAGE_BYTES, REMOTE_CHUNK_FRAME_BYTES, RemoteChunkAssembler, RemoteProtocolError,
  decodeServerFrame, encodeClientMessage, type ChunkAssemblerOptions, type RpcMessage, type ServerAck, type ServerPong,
} from './envelope.js';

export type RemoteRelayState = 'connecting' | 'online' | 'offline' | 'auth-required' | 'closed';
export interface RemoteConnectionAuth {
  url: string;
  headers: Record<string, string>;
  /** Provider 校验完整挑战并独立管理凭据和签名。 */
  signChallenge(challenge: Readonly<Record<string, unknown>>): Promise<object>;
}
export interface RemoteAuthProvider { prepareConnection(): Promise<RemoteConnectionAuth> }
export class RemoteAuthRequiredError extends Error {
  constructor(message = 'Remote 需要重新认证') { super(message); this.name = 'RemoteAuthRequiredError'; }
}
export class RemoteSendError extends Error {
  constructor(message: string, readonly mayHaveBeenSent: boolean, readonly seqId?: number) { super(message); this.name = 'RemoteSendError'; }
}
export interface RemoteDisconnect {
  reason: 'network' | 'protocol' | 'auth-required' | 'closed'; mayHaveBeenSent: boolean; lastSentSeqId?: number;
}
export interface RemoteSendReceipt { seqId: number }
export interface RemoteRelayOptions {
  clientId: string; authProvider: RemoteAuthProvider;
  reconnectMinMs?: number; reconnectMaxMs?: number; handshakeTimeoutMs?: number;
  streamPingMs?: number; nativePingMs?: number; nativePongTimeoutMs?: number;
  maxMessageBytes?: number; maxBufferedBytes?: number; maxStreams?: number;
  assembly?: ChunkAssemblerOptions;
}
interface StreamEvents {
  message: [message: RpcMessage, metadata: { seqId: number; cursor?: string | null }];
  ack: [ack: ServerAck]; pong: [pong: ServerPong]; disconnect: [event: RemoteDisconnect];
  sendError: [error: RemoteSendError]; close: [];
}
interface RelayEvents {
  state: [state: RemoteRelayState]; pong: [pong: ServerPong]; disconnect: [event: RemoteDisconnect];
  protocolError: [error: RemoteProtocolError]; authRequired: [error: RemoteAuthRequiredError];
}
export class RemoteStream extends EventEmitter<StreamEvents> {
  private sequence = 0;
  private serverSequence = 0;
  private observedServerSequence = 0;
  private pendingServerMessage = false;
  private closing?: Promise<void>;
  private isClosed = false;
  constructor(
    readonly environmentId: string, readonly streamId: string,
    private readonly transmit: (stream: RemoteStream, message?: RpcMessage, control?: 'ping' | 'client_closed') => Promise<RemoteSendReceipt>,
    private readonly release: (stream: RemoteStream) => void,
  ) { super(); }
  get closed(): boolean { return this.isClosed; }
  get lastSentSeqId(): number { return this.sequence; }
  /** @internal 仅完整恢复且连续交付的服务端消息推进此序列。 */
  get lastServerSeqId(): number { return this.serverSequence; }
  /** @internal */
  get hasPartialMessage(): boolean { return this.pendingServerMessage; }
  /** @internal 恢复责任跨重连保留，直到追齐曾观察到的序列上界。 */
  get hasUnrecoveredHistory(): boolean { return this.serverSequence < this.observedServerSequence; }
  /** 本地 socket 写入完成后返回，不代表 Remote 确认；离线不排队，断线不重发。 */
  send(message: RpcMessage): Promise<RemoteSendReceipt> { return this.transmit(this, message); }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.isClosed = true;
    this.closing = this.transmit(this, undefined, 'client_closed').then(() => undefined);
    this.release(this);
    this.emit('close');
    return this.closing;
  }
  /** @internal 仅在发送预算和在线状态检查通过后分配序号。 */
  commitSequence(seq: number): void { this.sequence = seq; }
  /** @internal */
  commitServerSequence(seq: number): void { this.serverSequence = seq; this.pendingServerMessage = false; }
  /** @internal 只记序号，不缓冲业务消息或分块内容。 */
  observeServerSequence(seq: number): void { this.observedServerSequence = Math.max(this.observedServerSequence, seq); }
  /** @internal */
  setPartialMessage(pending: boolean): void { this.pendingServerMessage = pending; }
}
interface PendingWrite { socket: WebSocket; bytes: number; reject: (error: RemoteSendError) => void; seqId?: number }
function positive(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > 2 ** 31 - 1) throw new Error('Remote 配置无效');
  return result;
}
function validId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 1024; }

/** 始终复用一条常驻物理连接；逻辑流的生命周期不会关闭主连接。 */
export class RemoteRelay extends EventEmitter<RelayEvents> {
  readonly clientId: string;
  private currentState: RemoteRelayState = 'connecting';
  private socket?: WebSocket;
  private streams = new Map<string, RemoteStream>();
  private readonly assembler: RemoteChunkAssembler;
  private readonly reconnectMinMs: number;
  private readonly reconnectMaxMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly streamPingMs: number;
  private readonly nativePingMs: number;
  private readonly nativePongTimeoutMs: number;
  private readonly maxMessageBytes: number;
  private readonly maxBufferedBytes: number;
  private readonly maxStreams: number;
  private epoch = 0;
  private attempting = false;
  private authenticationPending = false;
  private retryCount = 0;
  private retryTimer?: NodeJS.Timeout;
  private handshakeTimer?: NodeJS.Timeout;
  private streamTimer?: NodeJS.Timeout;
  private nativeTimer?: NodeJS.Timeout;
  private pongTimer?: NodeJS.Timeout;
  private awaitingNativePong = false;
  private safeCursor: string | null = null;
  private latestCursor: string | null = null;
  private writes = new Set<PendingWrite>();
  private queuedBytes = 0;

  constructor(private readonly options: RemoteRelayOptions) {
    super();
    if (!validId(options.clientId)) throw new Error('Remote clientId 无效');
    this.clientId = options.clientId;
    this.reconnectMinMs = positive(options.reconnectMinMs, 500);
    this.reconnectMaxMs = positive(options.reconnectMaxMs, 30000);
    this.handshakeTimeoutMs = positive(options.handshakeTimeoutMs, 20000);
    this.streamPingMs = positive(options.streamPingMs, 30000);
    this.nativePingMs = positive(options.nativePingMs, 15000);
    this.nativePongTimeoutMs = positive(options.nativePongTimeoutMs, 10000);
    this.maxMessageBytes = positive(options.maxMessageBytes, DEFAULT_REMOTE_MESSAGE_BYTES);
    this.maxBufferedBytes = positive(options.maxBufferedBytes, 96 * 1024 * 1024);
    this.maxStreams = positive(options.maxStreams, 4096);
    this.assembler = new RemoteChunkAssembler({ maxMessageBytes: this.maxMessageBytes, ...options.assembly });
    this.assembler.on('discard', () => this.failProtocol(new RemoteProtocolError('Remote 分块接收超时')));
    queueMicrotask(() => { void this.connect(); });
  }
  get state(): RemoteRelayState { return this.currentState; }
  createStream(options: { environmentId: string }): RemoteStream {
    if (this.state === 'closed') throw new Error('Remote relay 已关闭');
    const streamId = randomUUID();
    if (!validId(options.environmentId)) throw new Error('Remote stream 路由无效');
    if (this.streams.size >= this.maxStreams) throw new Error('Remote 活跃 stream 超过预算');
    const stream = new RemoteStream(options.environmentId, streamId, (value, message, control) => this.sendStream(value, message, control), value => this.releaseStream(value));
    this.streams.set(streamId, stream); return stream;
  }
  private releaseStream(stream: RemoteStream): void {
    this.streams.delete(stream.streamId);
    this.assembler.discardStream({ clientId: this.clientId, streamId: stream.streamId, environmentId: stream.environmentId });
    // 主动关闭流的历史可以丢弃，其他活跃流的未完成分块仍阻止游标推进。
    this.advanceSafeCursor();
  }
  private advanceSafeCursor(): void {
    if (this.assembler.pendingCount > 0) return;
    for (const stream of this.streams.values()) if (stream.hasUnrecoveredHistory) return;
    this.safeCursor = this.latestCursor;
  }
  private setState(state: RemoteRelayState): void {
    if (this.currentState === state) return;
    this.currentState = state; this.emit('state', state);
  }
  private async connect(): Promise<void> {
    if (this.attempting || this.authenticationPending || this.socket || this.state === 'closed' || this.state === 'auth-required') return;
    this.attempting = true; this.authenticationPending = true; const epoch = ++this.epoch; this.setState('connecting');
    try {
      const auth = await this.options.authProvider.prepareConnection();
      if (!this.isCurrent(epoch)) return;
      const url = new URL(auth.url);
      if (!['ws:', 'wss:'].includes(url.protocol)) throw new RemoteAuthRequiredError('Remote 连接地址无效');
      const headers = { ...auth.headers };
      // 恢复游标由传输层控制，Provider 的同名请求头不能跳过已验证位置。
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'x-codex-subscribe-cursor') delete headers[key];
      if (this.safeCursor !== null) headers['x-codex-subscribe-cursor'] = this.safeCursor;
      const socket = new WebSocket(auth.url, { headers, maxPayload: REMOTE_CHUNK_FRAME_BYTES, perMessageDeflate: false, handshakeTimeout: this.handshakeTimeoutMs });
      this.socket = socket;
      let challengeStarted = false;
      this.handshakeTimer = setTimeout(() => this.disconnect('network'), this.handshakeTimeoutMs); this.handshakeTimer.unref();
      socket.on('error', () => { if (this.socket === socket) this.disconnect('network'); });
      socket.on('close', () => { if (this.socket === socket) this.disconnect('network'); });
      socket.on('unexpected-response', (_request, response) => {
        if (this.socket === socket) {
          if (response.statusCode === 401 || response.statusCode === 403) this.disconnect('auth-required', new RemoteAuthRequiredError('Remote 握手鉴权失败'));
          else this.disconnect('network');
        }
        response.resume(); response.destroy();
      });
      socket.on('pong', () => { if (this.socket === socket) { this.awaitingNativePong = false; clearTimeout(this.pongTimer); this.pongTimer = undefined; } });
      socket.on('message', (raw, binary) => {
        if (!this.isCurrent(epoch) || this.socket !== socket) return;
        try {
          if (binary) throw new RemoteProtocolError('Remote 不接受二进制帧');
          const value = this.readControl(raw);
          if (value.type === 'device_key_challenge') {
            if (challengeStarted || this.state === 'online') throw new RemoteProtocolError('Remote 重复认证挑战');
            challengeStarted = true;
            void this.prove(auth, value, socket, epoch);
          } else if (value.type === 'device_key_authenticated') {
            if (value.clientId !== this.clientId) this.disconnect('auth-required', new RemoteAuthRequiredError('Remote clientId 不匹配'));
          } else {
            if (this.state !== 'online') throw new RemoteProtocolError('Remote 认证阶段收到未知帧');
            this.receive(raw);
          }
        } catch (error) { this.failProtocol(error); }
      });
    } catch (error) {
      if (!this.isCurrent(epoch)) return;
      if (error instanceof RemoteAuthRequiredError) this.disconnect('auth-required', error);
      else this.disconnect('network');
    } finally {
      this.authenticationPending = false;
      this.scheduleReconnect();
    }
  }
  private isCurrent(epoch: number): boolean { return this.epoch === epoch && this.state !== 'closed' && this.state !== 'auth-required'; }
  private readControl(raw: RawData): Record<string, unknown> {
    const bytes = Array.isArray(raw) ? Buffer.concat(raw) : raw instanceof ArrayBuffer ? Buffer.from(raw) : raw;
    if (bytes.byteLength > REMOTE_CHUNK_FRAME_BYTES) throw new RemoteProtocolError('Remote 帧超限');
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes), (key, item) => {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(); return item;
      });
    } catch { throw new RemoteProtocolError('Remote JSON 无效'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteProtocolError();
    return value as Record<string, unknown>;
  }
  private async prove(auth: RemoteConnectionAuth, challenge: Record<string, unknown>, socket: WebSocket, epoch: number): Promise<void> {
    this.authenticationPending = true;
    try {
      const proof = await auth.signChallenge(challenge);
      if (!this.isCurrent(epoch) || this.socket !== socket) return;
      if (!proof || typeof proof !== 'object' || Array.isArray(proof)) throw new RemoteAuthRequiredError('Remote 签名证明无效');
      const encoded = JSON.stringify({ ...proof, type: 'device_key_proof' });
      // Provider 返回的证明写入网络前也必须通过安全 JSON 校验。
      this.readControl(Buffer.from(encoded));
      const prepared = this.preflight([encoded], true);
      await this.write(prepared.socket, [encoded], prepared.bytes);
      if (!this.isCurrent(epoch) || this.socket !== socket) return;
      clearTimeout(this.handshakeTimer); this.handshakeTimer = undefined;
      this.attempting = false; this.retryCount = 0;
      this.setState('online');
      if (this.state === 'online') this.startHeartbeats();
    } catch (error) {
      if (!this.isCurrent(epoch) || this.socket !== socket) return;
      if (error instanceof RemoteAuthRequiredError) this.disconnect('auth-required', error);
      else this.disconnect('network');
    } finally {
      this.authenticationPending = false;
      this.scheduleReconnect();
    }
  }
  private receive(raw: RawData): void {
    const bytes = Array.isArray(raw) ? Buffer.concat(raw) : raw instanceof ArrayBuffer ? Buffer.from(raw) : raw;
    const frame = decodeServerFrame(bytes);
    const stream = this.streams.get(frame.stream_id);
    if (frame.client_id !== this.clientId || !stream || stream.environmentId !== frame.env_id) return;
    let message: RpcMessage | undefined;
    let duplicate = false;
    if (frame.type !== 'ack') {
      stream.observeServerSequence(frame.seq_id);
      duplicate = frame.seq_id <= stream.lastServerSeqId;
      if (!duplicate) {
        // 序列缺口只通过恢复历史补齐，绝不重发出站请求；高序号不会标为已交付，
        // 因而恢复时较低的缺失序号仍可正常交付。
        if (frame.seq_id !== stream.lastServerSeqId + 1) throw new RemoteProtocolError('Remote 服务端序列存在缺口');
        if (frame.type === 'server_message_chunk') {
          message = this.assembler.accept(frame).message;
          stream.setPartialMessage(message === undefined);
        } else {
          if (stream.hasPartialMessage) throw new RemoteProtocolError('Remote 未完成分块与完整帧冲突');
          if (frame.type === 'server_message') message = frame.message;
        }
        if (message !== undefined || frame.type === 'pong') stream.commitServerSequence(frame.seq_id);
      }
    }
    if (typeof frame.cursor === 'string') this.latestCursor = frame.cursor;
    // 分块内容可在断线时清理；观察到的缺口上界仍阻止其他流越过恢复责任。
    this.advanceSafeCursor();
    if (stream.closed) return;
    if (message !== undefined) stream.emit('message', message, { seqId: frame.seq_id, cursor: frame.cursor });
    else if (frame.type === 'pong' && !duplicate) { stream.emit('pong', frame); this.emit('pong', frame); }
    else if (frame.type === 'ack') stream.emit('ack', frame);
  }
  private sendStream(stream: RemoteStream, message?: RpcMessage, control?: 'ping' | 'client_closed'): Promise<RemoteSendReceipt> {
    const seqId = stream.lastSentSeqId + 1;
    try {
      if (stream.closed && control !== 'client_closed') throw new RemoteSendError('Remote stream 已关闭', false);
      if (!Number.isSafeInteger(seqId)) throw new RemoteSendError('Remote 序列耗尽', false);
      const route = { clientId: this.clientId, streamId: stream.streamId, environmentId: stream.environmentId, seqId };
      const frames = control ? [JSON.stringify({ type: control, client_id: this.clientId, stream_id: stream.streamId, env_id: stream.environmentId, seq_id: seqId,
        ...(control === 'ping' ? { skip_history: true, state: 'foreground' } : {}) })] : encodeClientMessage(route, message!, { maxMessageBytes: this.maxMessageBytes });
      const prepared = this.preflight(frames);
      stream.commitSequence(seqId);
      return this.write(prepared.socket, frames, prepared.bytes, seqId).then(() => ({ seqId }));
    } catch (error) {
      return Promise.reject(error instanceof RemoteSendError ? error : new RemoteSendError(error instanceof RemoteProtocolError ? error.message : 'Remote 发送数据无效', false));
    }
  }
  private preflight(frames: string[], handshake = false): { socket: WebSocket; bytes: number } {
    const socket = this.socket;
    if ((!handshake && this.state !== 'online') || !socket || socket.readyState !== WebSocket.OPEN) throw new RemoteSendError('Remote 尚未在线', false);
    const bytes = frames.reduce((sum, frame) => sum + Buffer.byteLength(frame), 0);
    if (bytes + Math.max(this.queuedBytes, socket.bufferedAmount) > this.maxBufferedBytes) throw new RemoteSendError('Remote 发送背压预算超限', false);
    return { socket, bytes };
  }
  private write(socket: WebSocket, frames: string[], bytes: number, seqId?: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const operation: PendingWrite = { socket, bytes, reject, seqId };
      this.writes.add(operation); this.queuedBytes += bytes; let remaining = frames.length;
      const finish = (error?: Error) => {
        if (!this.writes.delete(operation)) return;
        this.queuedBytes -= bytes;
        if (error) reject(new RemoteSendError('Remote 写入中断，消息可能已发送', true, seqId)); else resolve();
      };
      try {
        for (const frame of frames) socket.send(frame, { binary: false }, error => {
          if (error) finish(error); else if (--remaining === 0) finish();
        });
      } catch { finish(new Error('Remote socket 写入失败')); }
    });
  }
  private startHeartbeats(): void {
    this.streamTimer = setInterval(() => {
      for (const stream of this.streams.values()) if (!stream.closed) void this.sendStream(stream, undefined, 'ping').catch((error: RemoteSendError) => stream.emit('sendError', error));
    }, this.streamPingMs); this.streamTimer.unref();
    this.nativeTimer = setInterval(() => {
      const socket = this.socket;
      if (this.state !== 'online' || !socket || this.awaitingNativePong) return;
      if (socket.bufferedAmount >= this.maxBufferedBytes) { this.disconnect('network'); return; }
      this.awaitingNativePong = true;
      this.pongTimer = setTimeout(() => this.disconnect('network'), this.nativePongTimeoutMs); this.pongTimer.unref();
      try { socket.ping(undefined, true, error => { if (error && this.socket === socket) this.disconnect('network'); }); }
      catch { this.disconnect('network'); }
    }, this.nativePingMs); this.nativeTimer.unref();
  }
  private failProtocol(error: unknown): void {
    if (this.state === 'closed' || this.state === 'auth-required') return;
    this.emit('protocolError', error instanceof RemoteProtocolError ? error : new RemoteProtocolError());
    this.disconnect('protocol');
  }
  private clearConnection(): void {
    ++this.epoch; this.attempting = false;
    clearTimeout(this.handshakeTimer); clearInterval(this.streamTimer); clearInterval(this.nativeTimer); clearTimeout(this.pongTimer);
    this.handshakeTimer = this.streamTimer = this.nativeTimer = this.pongTimer = undefined;
    this.awaitingNativePong = false; this.assembler.clear(); this.latestCursor = this.safeCursor;
    for (const stream of this.streams.values()) stream.setPartialMessage(false);
    const socket = this.socket; this.socket = undefined;
    for (const write of this.writes) write.reject(new RemoteSendError('Remote 连接已断开，消息可能已发送', true, write.seqId));
    this.writes.clear(); this.queuedBytes = 0;
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }
  private notifyDisconnect(reason: RemoteDisconnect['reason']): void {
    let mayHaveBeenSent = false;
    for (const stream of this.streams.values()) if (!stream.closed) {
      mayHaveBeenSent ||= stream.lastSentSeqId > 0;
      stream.emit('disconnect', { reason, mayHaveBeenSent: stream.lastSentSeqId > 0, ...(stream.lastSentSeqId ? { lastSentSeqId: stream.lastSentSeqId } : {}) });
    }
    this.emit('disconnect', { reason, mayHaveBeenSent });
  }
  private disconnect(reason: Exclude<RemoteDisconnect['reason'], 'closed'>, error?: RemoteAuthRequiredError): void {
    if (this.state === 'closed' || this.state === 'auth-required') return;
    this.clearConnection();
    if (reason === 'auth-required') {
      this.setState('auth-required'); this.notifyDisconnect(reason); this.emit('authRequired', error ?? new RemoteAuthRequiredError()); return;
    }
    this.setState('offline'); this.notifyDisconnect(reason);
    this.scheduleReconnect();
  }
  private scheduleReconnect(): void {
    if (this.currentState !== 'offline' || this.retryTimer || this.authenticationPending) return;
    const delay = Math.min(this.reconnectMaxMs, this.reconnectMinMs * 2 ** Math.min(this.retryCount++, 20));
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.connect(); }, delay); this.retryTimer.unref();
  }
  close(): void {
    if (this.state === 'closed') return;
    this.setState('closed'); clearTimeout(this.retryTimer); this.retryTimer = undefined;
    this.clearConnection(); this.assembler.close(); this.notifyDisconnect('closed');
  }
}
