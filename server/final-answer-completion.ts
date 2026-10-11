import { isVisibleThread } from "./thread-visibility.js";

type Notification = { method?: string; params?: unknown; id?: unknown };
export type CompletedFinalAnswer = { threadId: string; turnId: string };
type TurnState = { final: boolean; completed: boolean; blocked: boolean; emitted: boolean; mobile?: boolean };
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024;
const isFinal = (item: any) => item?.type === "agentMessage" && item.phase === "final_answer";

/** 仅登记实时分类证据，最终回复和成功回合结束都到达后才通知一次。 */
export class FinalAnswerCompletionTracker {
  private turns = new Map<string, TurnState>();
  private silentThreads = new Set<string>();
  constructor(private options: { requireMobileOrigin?: boolean } = {}) {}
  /** 仅成功提交的移动端 RPC 授权对应回合；历史/恢复结果不能授权。 */
  observeRpc(request: { method?: string; params?: unknown }, response: { error?: unknown; result?: unknown }): CompletedFinalAnswer | null {
    if (response.error != null || !["turn/start", "turn/steer"].includes(request.method ?? "")) return null;
    const params = request.params as Record<string, any> | undefined;
    const result = response.result as Record<string, any> | undefined;
    const threadId = params?.threadId;
    const turnId = request.method === "turn/start" ? result?.turn?.id : result?.turnId;
    if (!validId(threadId) || !validId(turnId) || this.silentThreads.has(threadId)) return null;
    if (request.method === "turn/steer" && params?.expectedTurnId !== turnId) return null;
    const key = JSON.stringify([threadId, turnId]);
    const state = this.turns.get(key) ?? { final: false, completed: false, blocked: false, emitted: false };
    state.mobile = true;
    return this.finish(threadId, turnId, state);
  }
  private finish(threadId: string, turnId: string, state: TurnState): CompletedFinalAnswer | null {
    this.turns.set(JSON.stringify([threadId, turnId]), state);
    while (this.turns.size > 512) this.turns.delete(this.turns.keys().next().value!);
    if (!state.final || !state.completed || state.blocked || state.emitted ||
      (this.options.requireMobileOrigin && !state.mobile)) return null;
    state.emitted = true;
    return { threadId, turnId };
  }
  /** 来源只用于分类；无标题、改名或后续稀疏 metadata 都不改变子会话身份。 */
  rememberThread(thread: any) {
    if (!validId(thread?.id)) return;
    if (!isVisibleThread(thread)) this.rememberSilentThread(thread.id);
  }
  private rememberSilentThread(threadId: unknown) {
    if (!validId(threadId)) return;
    this.silentThreads.delete(threadId); this.silentThreads.add(threadId);
    while (this.silentThreads.size > 2048) this.silentThreads.delete(this.silentThreads.values().next().value!);
  }
  observe(message: Notification): CompletedFinalAnswer | null {
    if (message.id != null) return null;
    const params = message.params as Record<string, any> | undefined;
    if (message.method === "thread/started") this.rememberThread(params?.thread);
    if (["item/started", "item/completed"].includes(message.method ?? "") && params?.item?.type === "subAgentActivity") {
      this.rememberSilentThread(params.item.agentThreadId);
    }
    if (!["item/completed", "turn/completed"].includes(message.method ?? "")) return null;
    const threadId = params?.threadId;
    const turnId = message.method === "turn/completed" ? params?.turn?.id ?? params?.turnId : params?.turnId;
    if (!validId(threadId) || !validId(turnId) || this.silentThreads.has(threadId)) return null;
    const key = JSON.stringify([threadId, turnId]);
    const state = this.turns.get(key) ?? { final: false, completed: false, blocked: false, emitted: false };
    if (message.method === "item/completed") {
      if (!isFinal(params?.item)) return null;
      state.final = true;
    } else {
      // 未明确成功或携带错误的终止事件，不应被后到的 final 误当成完成。
      if (params?.turn?.status !== "completed" || params.turn.error != null) state.blocked = true;
      else state.completed = true;
      if (Array.isArray(params?.turn?.items) && params.turn.items.some(isFinal)) state.final = true;
    }
    return this.finish(threadId, turnId, state);
  }
}
