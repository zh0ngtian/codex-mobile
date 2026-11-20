import type { OperationContext } from './operation-queue.js';
import type { RpcMessage } from './http-session.js';
import { canonicalRpc, snapshotRead } from './rpc-replay.js';

export { snapshotRead } from './rpc-replay.js';
interface Entry { context: OperationContext; request: RpcMessage; message: RpcMessage; updatedAt: number; bytes: number }
/** 可丢弃的成功读取投影；不保存队列状态，不授予上游执行权限。 */
export class RemoteReadSnapshots {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(private options: { now?: () => number; maxEntries?: number; maxBytes?: number; ttlMs?: number } = {}) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  private key(context: OperationContext, request: RpcMessage) { return canonicalRpc([context, { method: request.method, params: request.params }]); }
  private remove(key: string) { const value = this.entries.get(key); if (value) this.bytes -= value.bytes; this.entries.delete(key); }
  get(context: OperationContext, request: RpcMessage) {
    if (context.mode !== 'remote' || !snapshotRead(request)) return;
    const key = this.key(context, request); const value = this.entries.get(key); if (!value) return;
    if (this.now() - value.updatedAt >= (this.options.ttlMs ?? 86400000)) { this.remove(key); return; }
    return { message: { ...structuredClone(value.message), id: request.id }, updatedAt: value.updatedAt, refreshing: this.now() - value.updatedAt >= 3000 };
  }
  put(context: OperationContext, request: RpcMessage, message: RpcMessage) {
    if (context.mode !== 'remote' || !snapshotRead(request) || message.error != null || message.result == null) return;
    const key = this.key(context, request); const value = structuredClone({ context, request, message, updatedAt: this.now(), bytes: 0 });
    value.bytes = Buffer.byteLength(JSON.stringify(value)); this.remove(key);
    if (value.bytes > (this.options.maxBytes ?? 32 * 1024 * 1024)) return;
    this.entries.set(key, value); this.bytes += value.bytes;
    while (this.entries.size > (this.options.maxEntries ?? 256) || this.bytes > (this.options.maxBytes ?? 32 * 1024 * 1024)) this.remove(this.entries.keys().next().value!);
  }
  requestsForThread(context: OperationContext, threadId: string) {
    return [...this.entries.values()].filter(value => canonicalRpc(value.context) === canonicalRpc(context) && value.request.params?.threadId === threadId && this.now() - value.updatedAt < (this.options.ttlMs ?? 86400000)).map(value => structuredClone(value.request));
  }
}
