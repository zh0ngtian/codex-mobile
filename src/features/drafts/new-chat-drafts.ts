import type { DraftFile, DraftImage } from "../../ui/attachments";
import type { ApprovalPolicy, ApprovalsReviewer } from "../../ui/settings";
import { t } from "../../i18n";
import { transportUuid } from "../../backends/http-transport";

export interface NewChatDraftSettings {
  model: string;
  effort: string | null;
  serviceTier: string | null;
  permissions: string;
  approvalPolicy: ApprovalPolicy;
  approvalsReviewer: ApprovalsReviewer;
}

export interface NewChatDraftInput {
  backendId: string;
  backendName: string;
  cwd: string | null;
  text: string;
  settings: NewChatDraftSettings;
  images: DraftImage[];
  files: DraftFile[];
}

export interface SavedNewChatDraft extends Omit<NewChatDraftInput, "files"> {
  id: string;
  revision: string;
  updatedAt: number;
  files: Array<{
    id: string;
    name: string;
    type: string;
    size: number;
    lastModified: number;
    bytes: ArrayBuffer;
  }>;
}

export type SavedDraftReference = Pick<SavedNewChatDraft, "id" | "revision">;

export class NewChatDraftStore {
  constructor(private factory?: IDBFactory) {}

  private open() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const factory = this.factory ?? globalThis.indexedDB;
      if (!factory) throw new Error(t("本地草稿存储不可用"));
      const request = factory.open("codex-mobile:new-chat-drafts", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("drafts", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error(t("本地草稿存储不可用")));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }

  private async transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void) {
    const db = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction("drafts", mode);
        let value: T;
        transaction.oncomplete = () => resolve(value);
        transaction.onabort = () => reject(transaction.error ?? new Error(t("无法保存草稿")));
        transaction.onerror = event => reject((event.target as IDBRequest | null)?.error ?? transaction.error ?? new Error(t("无法保存草稿")));
        try {
          run(transaction.objectStore("drafts"), (result) => { value = result; });
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      });
    } finally {
      db.close();
    }
  }

  async save(input: NewChatDraftInput, id?: string) {
    const record: SavedNewChatDraft = {
      ...input,
      id: id ?? transportUuid(),
      revision: transportUuid(),
      updatedAt: Date.now(),
      files: await Promise.all(input.files.map(async ({ id, name, type, size, file }) => ({
        id, name, type, size, lastModified: file.lastModified,
        bytes: await file.arrayBuffer(),
      }))),
    };
    return this.transact<SavedNewChatDraft>("readwrite", (store, result) => {
      store.put(record);
      result(record);
    });
  }

  list() {
    return this.transact<SavedNewChatDraft[]>("readonly", (store, result) => {
      const request = store.getAll();
      request.onsuccess = () => result((request.result as SavedNewChatDraft[]).sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id)));
    });
  }

  remove(id: string, revision?: string) {
    return this.transact<void>("readwrite", (store, result) => {
      if (!revision) store.delete(id);
      else {
        const request = store.get(id);
        request.onsuccess = () => {
          if ((request.result as SavedNewChatDraft | undefined)?.revision === revision) store.delete(id);
        };
      }
      result(undefined);
    });
  }
}

export const newChatDraftStore = new NewChatDraftStore();

export function restoreNewChatDraft(record: SavedNewChatDraft) {
  const files: DraftFile[] = [];
  try {
    for (const saved of record.files) {
      const file = new File([saved.bytes], saved.name, { type: saved.type, lastModified: saved.lastModified });
      files.push({ id: saved.id, name: saved.name, type: saved.type, size: saved.size, file, previewUrl: URL.createObjectURL(file) });
    }
    return { images: record.images.map(image => ({ ...image })), files };
  } catch (error) {
    files.forEach(file => URL.revokeObjectURL(file.previewUrl));
    throw error;
  }
}
