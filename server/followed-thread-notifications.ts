import { randomUUID } from "node:crypto";
import type { HttpSessions } from "./http-session.js";
import { isVisibleThread } from "./thread-visibility.js";

type Turn = { id: string; status?: string; error?: unknown; items?: Array<{ type?: string; phase?: string }> };
type Baseline = { initialized: boolean; known: Set<string>; pending: Set<string> };
const running = (turn: Turn) => ["inProgress", "in_progress", "running"].includes(turn.status ?? "");
const validId = (id: unknown): id is string => typeof id === "string" && !!id.trim() && id.length <= 1024;

/** 独立于手机连接的只读观察；启动时已完成的历史只作为基线。 */
export class FollowedThreadNotifications {
  private baselines = new Map<string, Baseline>();
  private job?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private closed = false;
  constructor(private options: {
    sessions: Pick<HttpSessions, "hostedRpc">;
    followedThreadIds: () => ReadonlySet<string>;
    notifyCompletion: (threadId: string, turnId: string) => void;
    rememberThread?: (thread: unknown) => void;
    pollIntervalMs?: number;
  }) {}
  start() {
    if (this.closed || this.timer) return;
    this.timer = setInterval(() => { void this.poll(); }, this.options.pollIntervalMs ?? 3000);
    this.timer.unref();
    void this.poll();
  }
  poll(): Promise<void> {
    if (this.closed) return Promise.resolve();
    const followed = new Set(this.options.followedThreadIds());
    for (const id of this.baselines.keys()) if (!followed.has(id)) this.baselines.delete(id);
    if (this.job) return this.job;
    this.job = this.run().finally(() => { this.job = undefined; });
    return this.job;
  }
  private active(threadId: string, baseline: Baseline) {
    return !this.closed && this.options.followedThreadIds().has(threadId) && this.baselines.get(threadId) === baseline;
  }
  private async run() {
    const followed = new Set(this.options.followedThreadIds());
    for (const id of this.baselines.keys()) if (!followed.has(id)) this.baselines.delete(id);
    for (const threadId of followed) {
      if (this.closed) return;
      let baseline = this.baselines.get(threadId);
      if (!baseline) { baseline = { initialized: false, known: new Set(), pending: new Set() }; this.baselines.set(threadId, baseline); }
      try { await this.inspect(threadId, baseline); } catch { /* 暂时断线与不可读会话留待下次重试，不推进基线。 */ }
    }
  }
  private async inspect(threadId: string, baseline: Baseline) {
    if (!this.active(threadId, baseline)) return;
    const response = await this.options.sessions.hostedRpc({ id: randomUUID(), method: "thread/read", params: { threadId, includeTurns: false } });
    if (!this.active(threadId, baseline)) return;
    const thread = (response.result as any)?.thread;
    if (response.error != null || !thread || thread.id !== threadId) throw new Error("无法读取关注会话");
    this.options.rememberThread?.(thread);
    if (!isVisibleThread(thread)) return;
    const turns: Turn[] = [];
    const visited = new Set<string>();
    const pending = new Set(baseline.pending);
    const unresolved = new Set(pending);
    let latestId: string | undefined;
    let cursor: string | undefined;
    let reachedBaseline = false;
    do {
      if (!this.active(threadId, baseline)) return;
      const page = await this.options.sessions.hostedRpc({ id: randomUUID(), method: "thread/turns/list", params: {
        threadId, limit: 1, sortDirection: "desc", itemsView: "full", ...(cursor ? { cursor } : {}),
      } });
      if (!this.active(threadId, baseline)) return;
      const data = page.result as any;
      if (page.error != null || !Array.isArray(data?.data)) throw new Error("无法读取关注回合");
      for (const turn of data.data as Turn[]) {
        if (!validId(turn?.id)) continue;
        if (latestId === undefined) latestId = turn.id;
        const wasPending = pending.has(turn.id);
        unresolved.delete(turn.id);
        // 启动时正在运行的回合也划定历史边界；该回合本身仍需继续确认。
        if (baseline.known.has(turn.id)) reachedBaseline = true;
        if (!reachedBaseline || wasPending || !baseline.initialized) turns.push(turn);
      }
      const next = data.nextCursor;
      // 首次只建立最新页基线；后续沿页追至基线和已知运行回合。
      if (!baseline.initialized || (reachedBaseline && unresolved.size === 0) || next == null) break;
      if (typeof next !== "string" || !next || visited.has(next)) throw new Error("关注回合分页无效");
      visited.add(next); cursor = next;
    } while (true);
    if (!this.active(threadId, baseline)) return;
    baseline.pending = pending;
    for (const turn of turns.reverse()) {
      if (running(turn)) { baseline.pending.add(turn.id); baseline.known.add(turn.id); continue; }
      const isNew = !baseline.known.has(turn.id) || baseline.pending.has(turn.id);
      const hasFinal = turn.items?.some(item => item.type === "agentMessage" && item.phase === "final_answer");
      baseline.known.add(turn.id);
      if (baseline.initialized && isNew && turn.status === "completed" && turn.error == null && !hasFinal) {
        // 旧待确认回合先读一次：已有 final 正常通知，仍空则结束追查。
        if (turn.id === latestId) baseline.pending.add(turn.id);
        else baseline.pending.delete(turn.id);
        continue;
      }
      baseline.pending.delete(turn.id);
      if (baseline.initialized && isNew && turn.status === "completed" && turn.error == null && hasFinal) {
        this.options.notifyCompletion(threadId, turn.id);
      }
    }
    baseline.initialized = true;
    while (baseline.pending.size > 512) baseline.pending.delete(baseline.pending.values().next().value!);
    while (baseline.known.size > 2048) baseline.known.delete(baseline.known.values().next().value!);
  }
  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    // hostedRpc 生命周期由 HttpSessions 管理；关闭只取消观察资格，随后网关关闭会中止上游等待。
    this.baselines.clear();
  }
}
