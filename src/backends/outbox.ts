import type { GatewayRoute } from './gateway-route';
import { t } from '../i18n';

export interface OutboxEntry {
  id: string; kind: 'rpc' | 'upload' | 'title' | 'follow-up'; route: GatewayRoute & { id: string }; state: 'retained' | 'submitted' | 'completed';
  sourceId?: string; uploaded?: { path: string; name: string; type: string; size: number };
  signature?: string; sessionId?: string; message?: unknown; epoch?: string; name?: string; type?: string; bytes?: ArrayBuffer;
}
/** 原目标、UUID、参数与附件字节在首次网络发送之前完成同一 IndexedDB 事务。 */
export class GatewayOutbox {
  constructor(private factory?: IDBFactory) {}
  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const factory = this.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error(t('无法保存待发送操作，请检查本机存储'));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('codex-mobile:gateway-outbox', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('operations', { keyPath: 'id' });
      request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error(t('待发送操作存储被占用')));
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    });
    try { return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('operations', mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); let value: T;
      tx.oncomplete = () => resolve(value); tx.onabort = () => reject(tx.error ?? new Error(t('无法保存待发送操作')));
      tx.onerror = event => reject((event.target as IDBRequest)?.error ?? tx.error);
      try { run(tx.objectStore('operations'), result => { value = result; }); } catch (error) { tx.abort(); reject(error); }
    }); } finally { db.close(); }
  }
  put(entry: OutboxEntry): Promise<void> { return this.transaction('readwrite', (store, result) => { store.put(entry); result(undefined); }); }
  get(id: string): Promise<OutboxEntry | undefined> { return this.transaction('readonly', (store, result) => { const request = store.get(id); request.onsuccess = () => result(request.result); }); }
  list(): Promise<OutboxEntry[]> { return this.transaction('readonly', (store, result) => { const request = store.getAll(); request.onsuccess = () => result(request.result); }); }
  remove(id: string): Promise<void> { return this.transaction('readwrite', (store, result) => { store.delete(id); result(undefined); }); }
}
export const gatewayOutbox = new GatewayOutbox();
