import { EventEmitter } from 'node:events';
import { TextDecoder } from 'node:util';

export const REMOTE_MESSAGE_FRAME_BYTES = 102400;
export const REMOTE_CHUNK_FRAME_BYTES = 153600;
export const DEFAULT_REMOTE_MESSAGE_BYTES = 64 * 1024 * 1024;
const MAX_PROTOCOL_MESSAGE_BYTES = 1024 * 1024 * 1024;
const MAX_SEGMENTS = 65536;
// 保守预留段元数据、Map 条目与定时器开销，避免微小分段绕过总预算。
const ASSEMBLY_METADATA_BYTES = 1024;
const SEGMENT_METADATA_BYTES = 256;
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const utf8 = new TextDecoder('utf-8', { fatal: true });

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
/** 传输层保留完整安全 JSON 对象；RPC 和 legacy 错误语义由上层解析。 */
export type RpcMessage = { [key: string]: JsonValue };
export interface RemoteRoute { clientId: string; streamId: string; environmentId: string; seqId: number }
export interface RoutedFrame {
  client_id: string; stream_id: string; env_id: string; seq_id: number; cursor?: string | null; skip_history?: boolean;
}
export interface ServerMessage extends RoutedFrame { type: 'server_message'; message: RpcMessage }
export interface ServerMessageChunk extends RoutedFrame {
  type: 'server_message_chunk'; segment_id: number; segment_count: number; message_size_bytes: number; message_chunk_base64: string;
}
export interface ServerAck extends RoutedFrame { type: 'ack' }
export interface ServerPong extends RoutedFrame { type: 'pong'; status: 'active' | 'unknown' }
export type ServerFrame = ServerMessage | ServerMessageChunk | ServerAck | ServerPong;
export class RemoteProtocolError extends Error {
  constructor(message = 'Remote 协议数据无效') { super(message); this.name = 'RemoteProtocolError'; }
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function identifier(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 1024; }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
/** 序列化或交付前拒绝非 JSON 值及不安全的自有字段。 */
function validateJson(value: unknown): void {
  const active = new Set<object>();
  let nodes = 0;
  function visit(item: unknown, depth: number): void {
    if (++nodes > 1000000 || depth > 64) throw new RemoteProtocolError('Remote JSON 复杂度超限');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!Array.isArray(item) && !object(item)) throw new RemoteProtocolError();
    if (active.has(item)) throw new RemoteProtocolError('Remote JSON 包含循环引用');
    active.add(item);
    for (const key of Object.keys(item)) {
      if (unsafeKeys.has(key)) throw new RemoteProtocolError('Remote JSON 包含不安全字段');
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!('value' in descriptor)) throw new RemoteProtocolError();
      visit(descriptor.value, depth + 1);
    }
    active.delete(item);
  }
  visit(value, 0);
}
function validateMessage(value: unknown): asserts value is RpcMessage {
  validateJson(value);
  if (!object(value)) throw new RemoteProtocolError('Remote 消息必须为 JSON 对象');
}
function checkedBudget(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!integer(result, 1, MAX_PROTOCOL_MESSAGE_BYTES)) throw new RemoteProtocolError('Remote 预算无效');
  return result;
}
function validateRoute(frame: Record<string, unknown>, minimumSeqId: 0 | 1 = 1): void {
  if (!identifier(frame.client_id) || !identifier(frame.stream_id) || !identifier(frame.env_id) || !integer(frame.seq_id, minimumSeqId, Number.MAX_SAFE_INTEGER)) throw new RemoteProtocolError('Remote 路由无效');
  if ('cursor' in frame && frame.cursor !== null && (typeof frame.cursor !== 'string' || frame.cursor.length > 8192)) throw new RemoteProtocolError('Remote cursor 无效');
  if ('skip_history' in frame && typeof frame.skip_history !== 'boolean') throw new RemoteProtocolError();
}
function chunkBytes(frame: ServerMessageChunk, maxMessageBytes: number): Buffer {
  if (!integer(frame.segment_count, 1, MAX_SEGMENTS) || !integer(frame.segment_id, 0, frame.segment_count - 1) || !integer(frame.message_size_bytes, 2, maxMessageBytes)) throw new RemoteProtocolError('Remote 分块声明超限');
  const data = frame.message_chunk_base64;
  if (typeof data !== 'string' || data.length === 0 || data.length > REMOTE_CHUNK_FRAME_BYTES || data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new RemoteProtocolError('Remote base64 无效');
  const decoded = Buffer.from(data, 'base64');
  if (decoded.toString('base64') !== data || decoded.length > frame.message_size_bytes) throw new RemoteProtocolError('Remote base64 无效');
  return decoded;
}
function validateFrame(value: unknown): asserts value is ServerFrame {
  validateJson(value);
  if (!object(value)) throw new RemoteProtocolError();
  validateRoute(value, 0);
  switch (value.type) {
    case 'server_message': validateMessage(value.message); break;
    case 'server_message_chunk': chunkBytes(value as unknown as ServerMessageChunk, MAX_PROTOCOL_MESSAGE_BYTES); break;
    case 'ack': break;
    case 'pong': if (value.status !== 'active' && value.status !== 'unknown') throw new RemoteProtocolError(); break;
    default: throw new RemoteProtocolError('Remote 帧类型无效');
  }
}

export function decodeServerFrame(raw: string | Uint8Array): ServerFrame {
  if (Buffer.byteLength(raw) > REMOTE_CHUNK_FRAME_BYTES) throw new RemoteProtocolError('Remote 帧超限');
  let value: unknown;
  try { value = JSON.parse(typeof raw === 'string' ? raw : utf8.decode(raw)); }
  catch { throw new RemoteProtocolError('Remote JSON 编码无效'); }
  validateFrame(value);
  if (value.type === 'server_message' && Buffer.byteLength(raw) > REMOTE_MESSAGE_FRAME_BYTES) throw new RemoteProtocolError('Remote 普通消息帧超限');
  return value;
}

export function encodeClientMessage(route: RemoteRoute, message: RpcMessage, options: { maxMessageBytes?: number } = {}): string[] {
  validateMessage(message);
  const routing = { client_id: route.clientId, stream_id: route.streamId, env_id: route.environmentId, seq_id: route.seqId, skip_history: false };
  validateRoute(routing);
  const serializedMessage = JSON.stringify(message);
  const size = Buffer.byteLength(serializedMessage);
  if (size > checkedBudget(options.maxMessageBytes, DEFAULT_REMOTE_MESSAGE_BYTES)) throw new RemoteProtocolError('Remote 消息超出发送预算');
  const envelope = JSON.stringify({ type: 'client_message', ...routing, message });
  if (Buffer.byteLength(envelope) <= REMOTE_MESSAGE_FRAME_BYTES) return [envelope];
  const bytes = Buffer.from(serializedMessage);
  const base = { type: 'client_message_chunk', ...routing, message_size_bytes: size };
  // 按最大合法段编号预留开销，保证每个完整信封都满足字节上限。
  const overhead = Buffer.byteLength(JSON.stringify({ ...base, segment_id: MAX_SEGMENTS - 1, segment_count: MAX_SEGMENTS, message_chunk_base64: '' }));
  const bytesPerChunk = Math.floor((REMOTE_CHUNK_FRAME_BYTES - overhead) / 4) * 3;
  const count = Math.ceil(size / bytesPerChunk);
  if (bytesPerChunk < 1 || count > MAX_SEGMENTS) throw new RemoteProtocolError('Remote 分块数量超限');
  return Array.from({ length: count }, (_, index) => JSON.stringify({
    ...base, segment_id: index, segment_count: count,
    message_chunk_base64: bytes.subarray(index * bytesPerChunk, (index + 1) * bytesPerChunk).toString('base64'),
  }));
}

export interface ChunkAssemblerOptions { maxMessageBytes?: number; maxTotalBytes?: number; maxAssemblies?: number; timeoutMs?: number }
interface Assembly { count: number; size: number; bytes: number; reserved: number; segments: Map<number, Buffer>; timer: NodeJS.Timeout }
export function remoteAssemblyKey(frame: RoutedFrame): string { return JSON.stringify([frame.client_id, frame.stream_id, frame.env_id, frame.seq_id]); }

/** 仅保留实际收到的分段；不会根据消息长度声明提前分配大缓冲。 */
export class RemoteChunkAssembler extends EventEmitter {
  private assemblies = new Map<string, Assembly>();
  private totalBytes = 0;
  private reservedBytes = 0;
  private readonly maxMessageBytes: number;
  private readonly maxTotalBytes: number;
  private readonly maxAssemblies: number;
  private readonly timeoutMs: number;
  private closed = false;
  constructor(options: ChunkAssemblerOptions = {}) {
    super();
    this.maxMessageBytes = checkedBudget(options.maxMessageBytes, DEFAULT_REMOTE_MESSAGE_BYTES);
    this.maxTotalBytes = checkedBudget(options.maxTotalBytes, DEFAULT_REMOTE_MESSAGE_BYTES);
    this.maxAssemblies = checkedBudget(options.maxAssemblies, 64);
    this.timeoutMs = checkedBudget(options.timeoutMs, 30000);
  }
  get bufferedBytes(): number { return this.totalBytes; }
  get pendingCount(): number { return this.assemblies.size; }
  accept(frame: ServerMessageChunk): { key: string; message?: RpcMessage } {
    const key = remoteAssemblyKey(frame);
    try {
      if (this.closed) throw new RemoteProtocolError('Remote 分块组装器已关闭');
      validateFrame(frame);
      if (frame.type !== 'server_message_chunk' || Buffer.byteLength(JSON.stringify(frame)) > REMOTE_CHUNK_FRAME_BYTES) throw new RemoteProtocolError();
      const bytes = chunkBytes(frame, this.maxMessageBytes);
      let pending = this.assemblies.get(key);
      if (pending && (pending.count !== frame.segment_count || pending.size !== frame.message_size_bytes)) throw new RemoteProtocolError('Remote 分块元数据冲突');
      const previous = pending?.segments.get(frame.segment_id);
      if (previous) {
        if (!previous.equals(bytes)) throw new RemoteProtocolError('Remote 分块内容冲突');
        return { key };
      }
      const metadataBytes = pending ? 0 : ASSEMBLY_METADATA_BYTES + key.length * 2;
      const reservation = metadataBytes + SEGMENT_METADATA_BYTES + bytes.length;
      if (this.reservedBytes + reservation > this.maxTotalBytes || (pending?.bytes ?? 0) + bytes.length > frame.message_size_bytes) throw new RemoteProtocolError('Remote 分块内存超限');
      if (!pending) {
        if (this.assemblies.size >= this.maxAssemblies) throw new RemoteProtocolError('Remote 并发分块超限');
        const timer = setTimeout(() => { this.remove(key); this.emit('discard', { key, reason: 'timeout' }); }, this.timeoutMs);
        timer.unref();
        pending = { count: frame.segment_count, size: frame.message_size_bytes, bytes: 0, reserved: 0, segments: new Map(), timer };
        this.assemblies.set(key, pending);
      }
      pending.segments.set(frame.segment_id, bytes); pending.bytes += bytes.length; this.totalBytes += bytes.length;
      pending.reserved += reservation; this.reservedBytes += reservation;
      if (pending.segments.size !== pending.count) return { key };
      if (pending.bytes !== pending.size) throw new RemoteProtocolError('Remote 分块总字节数不符');
      const ordered = Array.from({ length: pending.count }, (_, index) => pending.segments.get(index)!);
      const full = Buffer.concat(ordered, pending.bytes);
      this.remove(key);
      let message: unknown;
      try { message = JSON.parse(utf8.decode(full)); } catch { throw new RemoteProtocolError('Remote 分块 JSON 编码无效'); }
      validateMessage(message);
      return { key, message };
    } catch (error) { this.remove(key); throw error; }
  }
  private remove(key: string): void {
    const pending = this.assemblies.get(key);
    if (!pending) return;
    clearTimeout(pending.timer); this.totalBytes -= pending.bytes; this.reservedBytes -= pending.reserved; this.assemblies.delete(key);
  }
  discardStream(route: Omit<RemoteRoute, 'seqId'>): void {
    for (const key of this.assemblies.keys()) {
      const [clientId, streamId, environmentId] = JSON.parse(key) as string[];
      if (clientId === route.clientId && streamId === route.streamId && environmentId === route.environmentId) this.remove(key);
    }
  }
  clear(): void { for (const key of this.assemblies.keys()) this.remove(key); }
  close(): void { this.closed = true; this.clear(); this.removeAllListeners(); }
}
