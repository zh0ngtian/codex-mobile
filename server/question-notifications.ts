import { isVisibleThread } from "./thread-visibility.js";

type Message = { id?: unknown; method?: string; params?: unknown };
export type PendingQuestion = { threadId: string; turnId: string; questionId: string };
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024;

/** 问题只保留身份和来源，历史追赶登记去重但不补发通知。 */
export class QuestionNotificationTracker {
  private seen = new Set<string>();
  private silent = new Set<string>();
  rememberThread(thread: any) {
    if (!validId(thread?.id) || isVisibleThread(thread)) return;
    this.silent.add(thread.id);
    while (this.silent.size > 2048) this.silent.delete(this.silent.values().next().value!);
  }
  observe(message: Message, catchingUp = false): PendingQuestion | null {
    const params = message.params as Record<string, any> | undefined;
    if (message.method === "thread/started") this.rememberThread(params?.thread);
    if (["item/started", "item/completed"].includes(message.method ?? "") && params?.item?.type === "subAgentActivity") {
      this.rememberThread({ id: params.item.agentThreadId, threadSource: "subagent" });
    }
    if (message.method !== "item/tool/requestUserInput" || message.id == null ||
      !validId(params?.threadId) || !Array.isArray(params.questions) || !params.questions.length || this.silent.has(params.threadId)) return null;
    const threadId = params.threadId;
    const turnId = validId(params.turnId) ? params.turnId : "";
    const questionId = validId(params.itemId) ? params.itemId : `${typeof message.id}:${message.id}`;
    const key = JSON.stringify([threadId, turnId, questionId]);
    if (this.seen.has(key)) return null;
    this.seen.add(key);
    while (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value!);
    return catchingUp ? null : { threadId, turnId, questionId };
  }
}
