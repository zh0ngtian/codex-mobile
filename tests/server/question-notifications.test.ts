import { describe, expect, it } from "vitest";
import { QuestionNotificationTracker } from "../../server/question-notifications.js";
const question = (itemId = "item", id: string | number = 1) => ({ id, method: "item/tool/requestUserInput", params: { threadId: "thread", turnId: "turn", itemId, questions: [{ id: "q", question: "选择方案？" }] } });
describe("模型提问通知", () => {
  it("问题立即通知，同一 item 的多个连接请求只通知一次，不同问题分别通知", () => {
    const tracker = new QuestionNotificationTracker();
    expect(tracker.observe(question())).toEqual({ threadId: "thread", turnId: "turn", questionId: "item" });
    expect(tracker.observe(question("item", "other-connection"))).toBeNull();
    expect(tracker.observe(question("next"))).toMatchObject({ questionId: "next" });
  });
  it("初始追赶登记但不推送，重连不重发；新问题仍推送", () => {
    const tracker = new QuestionNotificationTracker();
    expect(tracker.observe(question(), true)).toBeNull();
    expect(tracker.observe(question())).toBeNull();
    expect(tracker.observe(question("next"))).not.toBeNull();
  });
  it("隐藏来源持续静默，普通会话和非问题审批分别处理", () => {
    const tracker = new QuestionNotificationTracker();
    tracker.rememberThread({ id: "thread", sourceKind: "subAgentReview" });
    tracker.rememberThread({ id: "thread", name: "改名" });
    expect(tracker.observe(question())).toBeNull();
    expect(tracker.observe({ ...question(), method: "item/commandExecution/requestApproval" })).toBeNull();
    expect(new QuestionNotificationTracker().observe({ ...question(), id: undefined })).toBeNull();
  });
});
