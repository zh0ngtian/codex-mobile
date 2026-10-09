import { describe, expect, it } from "vitest";
import { FinalAnswerCompletionTracker } from "../../server/final-answer-completion.js";
const final = (threadId = "thread", turnId = "turn") => ({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", phase: "final_answer" } } });
const complete = (threadId = "thread", turnId = "turn", status = "completed") => ({ method: "turn/completed", params: { threadId, turn: { id: turnId, status } } });

describe("最终回复完成判定", () => {
  it.each([
    { source: { subAgent: { thread_spawn: { parent_thread_id: "parent" } } } },
    { source: { subagent: "review" } },
    { parentThreadId: "parent" },
    { threadSource: "subAgentThreadSpawn" },
    { threadSource: "subagent" },
    { threadSource: "memory_consolidation" },
    { sourceKind: "subAgentReview" },
    { source: "subAgentCompact" },
    { source: { internal: "title" } },
    { ephemeral: true },
  ])("实时子会话来源 %j 不通知，普通无名会话照常通知", (metadata) => {
    const tracker = new FinalAnswerCompletionTracker();
    tracker.observe({ method: "thread/started", params: { thread: { id: "child", ...metadata } } });
    tracker.observe({ method: "thread/name/updated", params: { threadId: "child", threadName: "有标题的子任务" } });
    tracker.rememberThread({ id: "child", name: "改名后稀疏摘要" });
    tracker.observe(final("child"));
    expect(tracker.observe(complete("child"))).toBeNull();
    tracker.observe(final("main"));
    expect(tracker.observe(complete("main"))).toEqual({ threadId: "main", turnId: "turn" });
  });

  it("主任务的子 Agent 活动只屏蔽子会话，不屏蔽主任务与普通 fork", () => {
    const tracker = new FinalAnswerCompletionTracker();
    tracker.observe({ method: "item/started", params: { threadId: "main", turnId: "turn", item: { type: "subAgentActivity", agentThreadId: "child", kind: "spawned" } } });
    tracker.observe(final("child"));
    expect(tracker.observe(complete("child"))).toBeNull();
    tracker.observe({ method: "thread/started", params: { thread: { id: "fork", source: "appServer", forkedFromId: "main" } } });
    tracker.rememberThread({ id: "automation", threadSource: "automation" });
    for (const id of ["main", "fork", "automation"]) {
      tracker.observe(final(id));
      expect(tracker.observe(complete(id))).toEqual({ threadId: id, turnId: "turn" });
    }
  });

  it.each([true, false])("兼容事件反序=%s，只通知一次", (reverse) => {
    const tracker = new FinalAnswerCompletionTracker();
    const messages = reverse ? [complete(), final()] : [final(), complete()];
    expect(tracker.observe(messages[0])).toBeNull();
    expect(tracker.observe(messages[1])).toEqual({ threadId: "thread", turnId: "turn" });
    for (const message of messages) expect(tracker.observe(message)).toBeNull();
  });
  it.each(["failed", "interrupted", "inProgress", undefined])("非成功状态 %s 不通知迟到 final", (status) => {
    const tracker = new FinalAnswerCompletionTracker();
    expect(tracker.observe({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status } } })).toBeNull();
    expect(tracker.observe(final())).toBeNull();
  });
  it("成功状态携带错误也不通知", () => {
    const tracker = new FinalAnswerCompletionTracker();
    tracker.observe(final());
    expect(tracker.observe({ ...complete(), params: { threadId: "thread", turn: { id: "turn", status: "completed", error: { message: "错误" } } } })).toBeNull();
  });
  it("跨线程和回合不混用证据，RPC 和无明确 final 的消息不算完成", () => {
    const tracker = new FinalAnswerCompletionTracker();
    tracker.observe(final("a", "a"));
    expect(tracker.observe(complete("b", "a"))).toBeNull();
    expect(tracker.observe(complete("a", "b"))).toBeNull();
    expect(tracker.observe({ ...final("b", "a"), id: 42 })).toBeNull();
    for (const item of [{ type: "agentMessage" }, { type: "agentMessage", phase: "commentary" }, { type: "commandExecution", phase: "final_answer" }]) {
      expect(tracker.observe({ method: "item/completed", params: { threadId: "b", turnId: "a", item } })).toBeNull();
    }
    expect(tracker.observe(complete("a", "a"))).toEqual({ threadId: "a", turnId: "a" });
  });
  it("成功 turn 的 items 可提供 final，拒绝无效 ID", () => {
    const tracker = new FinalAnswerCompletionTracker();
    expect(tracker.observe({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed", items: [final().params.item] } } })).toEqual({ threadId: "thread", turnId: "turn" });
    for (const id of ["", "x".repeat(1025), 12, null]) expect(tracker.observe({ ...final(), params: { ...final().params, threadId: id } })).toBeNull();
  });
  it("有界缓存淘汰旧证据", () => {
    const tracker = new FinalAnswerCompletionTracker();
    tracker.observe(final());
    for (let index = 0; index < 512; index++) tracker.observe(final("thread", String(index)));
    expect(tracker.observe(complete())).toBeNull();
  });
});
