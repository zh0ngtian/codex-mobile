import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { isVisibleThread } from "./thread-visibility.js";

type Thread = Record<string, any>;
type Request = (method: string, params: Record<string, any>) => Promise<any>;
export type SidebarRequestContext = { request: Request; deadline: number; signal?: AbortSignal; assertCurrent: () => void };
type Entry = { thread?: Thread | null; dirty: boolean; revision: number; pending: Map<Request, Promise<Thread | null>> };
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
  private discovery = new Map<Request, Promise<string[]>>();
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private request: Request) {}

  setEpoch(epoch: string) {
    if (epoch === this.epoch) return;
    this.epoch = epoch; this.entries.clear(); this.pages.clear(); this.discovery.clear();
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

  private wait<T>(pending: Promise<T>, context?: SidebarRequestContext): Promise<T> {
    if (!context) return pending;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      let settled = false;
      const cleanup = () => { settled = true; clearTimeout(timer); context.signal?.removeEventListener("abort", stop); };
      const stop = () => {
        if (settled) return;
        try { context.assertCurrent(); }
        catch (error) { cleanup(); reject(error); return; }
        timer = setTimeout(stop, Math.max(1, context.deadline - performance.now()));
      };
      context.signal?.addEventListener("abort", stop, { once: true });
      stop();
      pending.then(value => {
        if (settled) return;
        cleanup();
        try { context.assertCurrent(); resolve(value); } catch (error) { reject(error); }
      }, error => { if (!settled) { cleanup(); reject(error); } });
    });
  }

  private release() {
    const next = this.queue.shift(); if (next) next(); else this.active--;
  }

  private async schedule<T>(operation: () => Promise<T>, context?: SidebarRequestContext): Promise<T> {
    if (this.active >= 2) {
      let resume!: () => void;
      const slot = new Promise<void>(resolve => { resume = resolve; this.queue.push(resume); });
      try { await this.wait(slot, context); }
      catch (error) {
        const index = this.queue.indexOf(resume);
        if (index >= 0) this.queue.splice(index, 1); else this.release();
        throw error;
      }
    }
    else this.active++;
    try { context?.assertCurrent(); return await operation(); }
    finally { this.release(); }
  }

  private read(id: string, epoch: string, context?: SidebarRequestContext): Promise<Thread | null> {
    this.checkEpoch(epoch); context?.assertCurrent();
    const request = context?.request ?? this.request;
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { dirty: true, revision: 0, pending: new Map() }; this.entries.set(id, entry);
    }
    const existing = entry.pending.get(request);
    if (existing) return this.wait(existing, context);
    if (!entry.dirty) return Promise.resolve(entry.thread ?? null);
    const current = entry;
    const pending = this.schedule(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        this.checkEpoch(epoch);
        const revision = current.revision;
        let thread: Thread | null;
        try {
          const result = await this.wait(request("thread/read", { threadId: id, includeTurns: false }), context);
          if (!result.thread || result.thread.id !== id) throw new Error("会话摘要 ID 不匹配");
          const { turns: _turns, ...metadata } = result.thread;
          thread = metadata;
        } catch (error: any) {
          if (error?.code === -32600 && error?.message === `thread not loaded: ${id}`) thread = null;
          else throw error;
        }
        this.checkEpoch(epoch); context?.assertCurrent();
        // 读取期间收到状态变化，旧响应不能抹掉新事件。
        if (revision !== current.revision) continue;
        current.thread = thread; current.dirty = false;
        return thread;
      }
      throw new Error("会话摘要状态持续变化，请重试");
    }, context).finally(() => {
      if (current.pending.get(request) === pending) current.pending.delete(request);
      // 有界缓存不截断查询；淘汰后下一轮重新核对。
      if (this.entries.size > 4096) for (const [key, value] of this.entries) {
        if (!value.pending.size && key !== id) this.entries.delete(key);
        if (this.entries.size <= 4096) break;
      }
    });
    current.pending.set(request, pending);
    return pending;
  }

  private loaded(epoch: string, context?: SidebarRequestContext) {
    const request = context?.request ?? this.request;
    const existing = this.discovery.get(request);
    if (existing) return this.wait(existing, context);
    const pending = (async () => {
      const ids = new Set<string>(), cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        this.checkEpoch(epoch); context?.assertCurrent();
        const result: any = await this.wait(request("thread/loaded/list", { limit: 100, ...(cursor ? { cursor } : {}) }), context);
        if (!Array.isArray(result.data)) throw new Error("运行会话目录无效");
        for (const id of result.data) if (typeof id === "string" && id) ids.add(id);
        cursor = result.nextCursor ?? null;
        if (cursor && cursors.has(cursor)) throw new Error("运行会话目录游标重复");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      this.checkEpoch(epoch); context?.assertCurrent();
      return [...ids];
    })().finally(() => { if (this.discovery.get(request) === pending) this.discovery.delete(request); });
    this.discovery.set(request, pending);
    return pending;
  }

  async summaries(params: { threadIds: string[]; includeRunning: boolean }, context?: SidebarRequestContext) {
    const epoch = this.epoch;
    const explicit = new Set(params.threadIds);
    const ids = new Set([...explicit, ...(params.includeRunning ? await this.loaded(epoch, context) : [])]);
    const threads = await Promise.all([...ids].map(id => this.read(id, epoch, context)));
    this.checkEpoch(epoch); context?.assertCurrent();
    return { data: threads.filter((thread): thread is Thread => !!thread && listable(thread) &&
      (explicit.has(thread.id) || running(thread))).sort(compare) };
  }

  async projectless(params: Scope & { cursor?: string | null }, context?: SidebarRequestContext) {
    const epoch = this.epoch;
    this.checkEpoch(epoch); context?.assertCurrent();
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
      threads = (await Promise.all(page.ids.map(id => this.read(id, epoch, context)))).filter(accepted);
    } else {
      const records = await Promise.all(candidates.filter(id => !fixed.has(id)).map(id => this.read(id, epoch, context)));
      threads = records.filter(accepted).sort(compare);
    }
    this.checkEpoch(epoch); context?.assertCurrent();
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
