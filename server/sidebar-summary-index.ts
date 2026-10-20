import { createHash, randomUUID } from "node:crypto";
import { isVisibleThread } from "./thread-visibility.js";

type Thread = Record<string, any>;
type Request = (method: string, params: Record<string, any>) => Promise<any>;
type Entry = { thread?: Thread | null; dirty: boolean; revision: number; pending?: Promise<Thread | null> };
type Scope = { threadIds: string[]; excludedThreadIds?: string[]; fixedExcludedThreadIds?: string[] };
type Page = { epoch: string; scope: string; expires: number; ids: string[] };
const running = (thread: Thread) => (thread.status?.type ?? thread.status) === "active";
const listable = (thread: Thread) => isVisibleThread(thread) && thread.archived !== true &&
  !(typeof thread.path === "string" && /(?:^|[\\/])archived_sessions(?:[\\/]|$)/.test(thread.path));
const timestamp = (thread: Thread) => Number(thread.recencyAt ?? thread.updatedAt ?? thread.createdAt ?? 0);
const compare = (a: Thread, b: Thread) => timestamp(b) - timestamp(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 只保存同一上游连接的轻量摘要；缺失、变化与重连才重新读取，不读取回合。 */
export class SidebarSummaryIndex {
  private epoch = "";
  private entries = new Map<string, Entry>();
  private pages = new Map<string, Page>();
  private discovery?: Promise<string[]>;
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private request: Request) {}

  setEpoch(epoch: string) {
    if (epoch === this.epoch) return;
    this.epoch = epoch; this.entries.clear(); this.pages.clear(); this.discovery = undefined;
  }

  observe(message: { method?: string; params?: Record<string, any> }) {
    const params = message.params ?? {};
    const id = params.threadId ?? params.thread?.id;
    if (typeof id !== "string") return;
    if (!["thread/started", "thread/status/changed", "thread/name/updated", "thread/archived", "thread/unarchived",
      "thread/closed", "turn/started", "turn/completed"].includes(message.method ?? "")) return;
    const entry = this.entries.get(id);
    if (entry) { entry.dirty = true; entry.revision++; }
  }

  private checkEpoch(epoch: string) {
    if (!epoch || epoch !== this.epoch) throw new Error("摘要连接已变化，请刷新重试");
  }

  private async schedule<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= 2) await new Promise<void>(resolve => this.queue.push(resolve));
    else this.active++;
    try { return await operation(); }
    finally { const next = this.queue.shift(); if (next) next(); else this.active--; }
  }

  private read(id: string, epoch: string): Promise<Thread | null> {
    this.checkEpoch(epoch);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { dirty: true, revision: 0 }; this.entries.set(id, entry);
    }
    if (entry.pending) return entry.pending;
    if (!entry.dirty) return Promise.resolve(entry.thread ?? null);
    const current = entry;
    const pending = this.schedule(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        this.checkEpoch(epoch);
        const revision = current.revision;
        let thread: Thread | null;
        try {
          const result = await this.request("thread/read", { threadId: id, includeTurns: false });
          if (!result.thread || result.thread.id !== id) throw new Error("会话摘要 ID 不匹配");
          const { turns: _turns, ...metadata } = result.thread;
          thread = metadata;
        } catch (error: any) {
          if (error?.code === -32600 && error?.message === `thread not loaded: ${id}`) thread = null;
          else throw error;
        }
        this.checkEpoch(epoch);
        // 读取期间收到状态变化，旧响应不能抹掉新事件。
        if (revision !== current.revision) continue;
        current.thread = thread; current.dirty = false;
        return thread;
      }
      throw new Error("会话摘要状态持续变化，请重试");
    }).finally(() => {
      if (current.pending === pending) delete current.pending;
      // 有界缓存不截断查询；淘汰后下一轮重新核对。
      if (this.entries.size > 4096) for (const [key, value] of this.entries) {
        if (!value.pending && key !== id) this.entries.delete(key);
        if (this.entries.size <= 4096) break;
      }
    });
    current.pending = pending;
    return pending;
  }

  private loaded(epoch: string) {
    if (this.discovery) return this.discovery;
    const pending = (async () => {
      const ids = new Set<string>(), cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        this.checkEpoch(epoch);
        const result = await this.request("thread/loaded/list", { limit: 100, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(result.data)) throw new Error("运行会话目录无效");
        for (const id of result.data) if (typeof id === "string" && id) ids.add(id);
        cursor = result.nextCursor ?? null;
        if (cursor && cursors.has(cursor)) throw new Error("运行会话目录游标重复");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      this.checkEpoch(epoch);
      return [...ids];
    })().finally(() => { if (this.discovery === pending) this.discovery = undefined; });
    this.discovery = pending;
    return pending;
  }

  async summaries(params: { threadIds: string[]; includeRunning: boolean }) {
    const epoch = this.epoch;
    const explicit = new Set(params.threadIds);
    const ids = new Set([...explicit, ...(params.includeRunning ? await this.loaded(epoch) : [])]);
    const threads = await Promise.all([...ids].map(id => this.read(id, epoch)));
    this.checkEpoch(epoch);
    return { data: threads.filter((thread): thread is Thread => !!thread && listable(thread) &&
      (explicit.has(thread.id) || running(thread))).sort(compare) };
  }

  async projectless(params: Scope & { cursor?: string | null }) {
    const epoch = this.epoch;
    this.checkEpoch(epoch);
    const normalize = (ids: string[] = []) => [...new Set(ids)].sort();
    const candidates = normalize(params.threadIds), candidateIds = new Set(candidates);
    const relevant = (ids?: string[]) => normalize(ids).filter(id => candidateIds.has(id));
    const scope = createHash("sha256").update(JSON.stringify([
      candidates, relevant(params.excludedThreadIds), relevant(params.fixedExcludedThreadIds),
    ])).digest("hex");
    const now = Date.now();
    for (const [key, page] of this.pages) if (page.expires < now) this.pages.delete(key);
    let threads: Thread[];
    const fixed = new Set(params.fixedExcludedThreadIds), excluded = new Set(params.excludedThreadIds);
    const accepted = (thread: Thread | null): thread is Thread => !!thread && listable(thread) &&
      !fixed.has(thread.id) && (!excluded.has(thread.id) || running(thread));
    if (params.cursor) {
      const page = this.pages.get(params.cursor);
      if (!page || page.scope !== scope || page.epoch !== epoch) throw new Error("无项目分页已失效，请刷新重试");
      // 游标固定顺序，状态变化仍核对；旧快照不能把已归档或结束运行的记录带回来。
      threads = (await Promise.all(page.ids.map(id => this.read(id, epoch)))).filter(accepted);
    } else {
      const records = await Promise.all(candidates.filter(id => !fixed.has(id)).map(id => this.read(id, epoch)));
      threads = records.filter(accepted).sort(compare);
    }
    this.checkEpoch(epoch);
    const data: Thread[] = threads.slice(0, 5).map(thread => ({ ...thread, isProjectless: true }));
    let nextCursor: string | null = null;
    if (threads.length > 5) {
      nextCursor = randomUUID();
      this.pages.set(nextCursor, { epoch, scope, expires: now + 60_000, ids: threads.slice(5).map(thread => thread.id) });
      while (this.pages.size > 128) this.pages.delete(this.pages.keys().next().value!);
    }
    return { data, nextCursor };
  }
}

export function validSidebarParams(method: string, params: any) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return false;
  const ids = (value: any) => Array.isArray(value) && value.every(id => typeof id === "string" && id.length > 0 && id.length <= 1024);
  if (!ids(params.threadIds)) return false;
  if (method === "mobile/sidebar/summaries") return typeof params.includeRunning === "boolean";
  return [params.excludedThreadIds, params.fixedExcludedThreadIds].every(value => value === undefined || ids(value)) &&
    (params.cursor == null || typeof params.cursor === "string");
}
