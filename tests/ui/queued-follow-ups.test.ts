import { describe, expect, it } from "vitest";
import {
  hasQueuedFollowUpsForThread,
  queuedFollowUpsForThread,
  rebindQueuedFollowUpsToContext,
  removeQueuedFollowUp,
  updateQueuedFollowUpText,
} from "../../src/app-server/queued-follow-ups";

type FollowUp = {
  id: string;
  threadId: string;
  draftContext: number;
  inputText: string;
  text: string;
};

const queued: FollowUp[] = [
  {
    id: "queue-a-1",
    threadId: "thread-a",
    draftContext: 1,
    inputText: "第一条",
    text: "第一条",
  },
  {
    id: "queue-b-1",
    threadId: "thread-b",
    draftContext: 2,
    inputText: "另一会话",
    text: "另一会话",
  },
  {
    id: "queue-a-2",
    threadId: "thread-a",
    draftContext: 1,
    inputText: "第二条",
    text: "第二条",
  },
];

describe("排队消息状态", () => {
  it("按线程保留原顺序筛选并判断是否存在队列", () => {
    expect(queuedFollowUpsForThread(queued, "thread-a").map((item) => item.id))
      .toEqual(["queue-a-1", "queue-a-2"]);
    expect(hasQueuedFollowUpsForThread(queued, "thread-b")).toBe(true);
    expect(hasQueuedFollowUpsForThread(queued, "thread-c")).toBe(false);
  });

  it("只更新目标队列文本且不修改原数组", () => {
    const next = updateQueuedFollowUpText(
      queued,
      "queue-a-1",
      "修改后",
      "修改后 · 1 个附件",
    );

    expect(next).not.toBe(queued);
    expect(next[0]).toMatchObject({
      inputText: "修改后",
      text: "修改后 · 1 个附件",
    });
    expect(queued[0].inputText).toBe("第一条");
    expect(next[1]).toBe(queued[1]);
  });

  it("取消时只移除目标队列", () => {
    expect(removeQueuedFollowUp(queued, "queue-a-1").map((item) => item.id))
      .toEqual(["queue-b-1", "queue-a-2"]);
  });

  it("返回原会话时只重绑该线程的草稿上下文", () => {
    const next = rebindQueuedFollowUpsToContext(queued, "thread-a", 9);

    expect(next.map((item) => item.draftContext)).toEqual([9, 2, 9]);
    expect(next[1]).toBe(queued[1]);
  });
});
