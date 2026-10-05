import { beforeEach, describe, expect, it } from "vitest";
import {
  finalAnswerAttentionAction,
  readUnreadThreadIds,
  shouldMarkThreadUnread,
  writeUnreadThreadIds,
} from "../../src/features/threads/thread-unread";

describe("会话未读状态", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("按照机器保存和恢复未读会话", () => {
    writeUnreadThreadIds(
      window.localStorage,
      "mini",
      new Set(["thread-1", "thread-2"]),
    );
    expect(readUnreadThreadIds(window.localStorage, "mini")).toEqual(
      new Set(["thread-1", "thread-2"]),
    );
    expect(readUnreadThreadIds(window.localStorage, "macbook")).toEqual(
      new Set(),
    );
  });

  it("只在会话没有被当前可见页面查看时标记未读", () => {
    expect(
      shouldMarkThreadUnread({
        threadId: "thread-1",
        activeThreadId: "thread-1",
        conversationVisible: true,
        documentVisible: true,
      }),
    ).toBe(false);
    expect(
      shouldMarkThreadUnread({
        threadId: "thread-1",
        activeThreadId: "thread-1",
        conversationVisible: false,
        documentVisible: true,
      }),
    ).toBe(true);
    expect(
      shouldMarkThreadUnread({
        threadId: "thread-1",
        activeThreadId: "thread-1",
        conversationVisible: true,
        documentVisible: false,
      }),
    ).toBe(true);
    expect(
      shouldMarkThreadUnread({
        threadId: "thread-1",
        activeThreadId: "thread-2",
        conversationVisible: true,
        documentVisible: true,
      }),
    ).toBe(true);
  });

  it("只用实时 final answer 更新未读状态", () => {
    const finalAnswer = {
      id: "final",
      type: "agentMessage",
      phase: "final_answer",
      text: "完成",
    };
    const base = {
      item: finalAnswer,
      catchingUp: false,
      hasQueuedFollowUp: false,
      threadId: "thread-2",
      activeThreadId: "thread-1",
      conversationVisible: true,
      documentVisible: true,
    };

    expect(finalAnswerAttentionAction(base)).toBe("mark-unread");
    expect(
      finalAnswerAttentionAction({
        ...base,
        threadId: "thread-1",
      }),
    ).toBe("mark-read");
    expect(
      finalAnswerAttentionAction({
        ...base,
        item: {
          id: "commentary",
          type: "agentMessage",
          phase: "commentary",
          text: "处理中",
        },
      }),
    ).toBe("preserve");
    expect(
      finalAnswerAttentionAction({
        ...base,
        item: { id: "legacy", type: "agentMessage", text: "旧协议回复" },
      }),
    ).toBe("preserve");
    expect(
      finalAnswerAttentionAction({ ...base, catchingUp: true }),
    ).toBe("preserve");
    expect(
      finalAnswerAttentionAction({ ...base, hasQueuedFollowUp: true }),
    ).toBe("preserve");
  });
});
