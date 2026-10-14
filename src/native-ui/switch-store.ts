import type { BackendRegistry } from '../backends/types';
import { restoreNewChatDraft } from '../features/drafts/new-chat-drafts';
import type { NewChatDraftInput, SavedNewChatDraft, SavedDraftReference } from '../features/drafts/new-chat-drafts';
export interface SwitchWorkspace extends NewChatDraftInput { thread: { id: string; cwd: string | null; preview?: string; isProjectless?: boolean } | null; savedDraftReference?: SavedDraftReference }
export interface SavedSwitchWorkspace extends Omit<SwitchWorkspace, 'files'> { files: SavedNewChatDraft['files'] }
export interface SwitchCheckpoint { version: 1; registry: BackendRegistry; storage: Record<string, string>; workspaces: SwitchWorkspace[] }
export interface SavedSwitchCheckpoint extends Omit<SwitchCheckpoint, 'workspaces'> { workspaces: SavedSwitchWorkspace[] }
/** 与手动草稿完全独立，单个事务只替换完整检查点；事务完成才允许宿主保存偏好。 */
export class NativeSwitchStore {
 constructor(private factory?: IDBFactory) {}
 private bytes = new WeakMap<File, Promise<ArrayBuffer>>();
 private readBytes(file: File) {
  let read = this.bytes.get(file);
  if (!read) { read = file.arrayBuffer().catch(reason => { this.bytes.delete(file); throw reason; }); this.bytes.set(file, read); }
  return read;
 }
 private async transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
   const factory = this.factory ?? globalThis.indexedDB;
   if (!factory) { reject(new Error('界面切换检查点存储不可用')); return; }
   const request = factory.open('codex-mobile:native-ui-switch', 1);
   request.onupgradeneeded = () => request.result.createObjectStore('checkpoint');
   request.onerror = () => reject(request.error);
   request.onblocked = () => reject(new Error('界面切换检查点存储被阻止'));
   request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
  try { return await new Promise<T>((resolve, reject) => {
   const transaction = db.transaction('checkpoint', mode); let value: T;
   transaction.oncomplete = () => resolve(value);
   transaction.onabort = () => reject(transaction.error ?? new Error('无法保存界面切换检查点'));
   transaction.onerror = event => reject((event.target as IDBRequest)?.error ?? transaction.error);
   try { run(transaction.objectStore('checkpoint'), result => { value = result; }); }
   catch (error) { transaction.abort(); reject(error); }
  }); } finally { db.close(); }
 }
 async save(input: SwitchCheckpoint): Promise<void> {
  const workspaces = await Promise.all(input.workspaces.map(async workspace => ({ ...workspace,
   images: workspace.images.map(image => ({ ...image })),
   files: await Promise.all(workspace.files.map(async ({ id, name, type, size, file }) => ({ id, name, type, size, lastModified: file.lastModified, bytes: await this.readBytes(file) }))),
  })));
  await this.transact<void>('readwrite', (store, result) => { store.put({ ...input, workspaces }, 'current'); result(undefined); });
 }
 load(): Promise<SavedSwitchCheckpoint | null> {
  return this.transact('readonly', (store, result) => { const request = store.get('current'); request.onsuccess = () => result(request.result ?? null); });
 }
 restore(saved: SavedSwitchCheckpoint | null): Promise<void> {
  return this.transact('readwrite', (store, result) => { if (saved) store.put(saved, 'current'); else store.delete('current'); result(undefined); });
 }
 remove(): Promise<void> { return this.transact('readwrite', (store, result) => { store.delete('current'); result(undefined); }); }
}
export function restoreSwitchWorkspace(saved: SavedSwitchWorkspace): SwitchWorkspace {
 const restored = restoreNewChatDraft({ ...saved, id: '', revision: '', updatedAt: 0 });
 return { ...saved, ...restored };
}
export const nativeSwitchStore = new NativeSwitchStore();
