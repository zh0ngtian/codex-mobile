import { describe, expect, it } from "vitest";
import {
  buildEditedHistoryInput,
  createHistoricalMessageEditTarget,
  revertHistoricalMessage,
} from "../../src/app-server/history-edit";
import { AppServerRpcError } from "../../src/app-server/client";
import { CONVERSATION_TITLE_REQUEST } from "../../src/app-server/conversation-title";

describe("历史消息编辑", () => {
  const turns = [
    {
      id: "turn-a",
      status: "completed",
      items: [
        {
          id: "user-a",
          type: "userMessage",
          content: [
            {
              type: "text",
              text: "修复旧问题",
              text_elements: [{ byteRange: { start: 0, end: 2 } }],
            },
            { type: "image", url: "data:image/png;base64,AAAA" },
            {
              type: "text",
              text: "已上传文件：[需求.pdf](/tmp/需求.pdf)\n本机路径：`/tmp/需求.pdf`",
            },
            { type: "localImage", path: "/tmp/screenshot.png" },
            { type: "audio", url: "data:audio/wav;base64,BBBB" },
            { type: "skill", name: "review", path: "/tmp/review" },
            { type: "mention", name: "App.tsx", path: "/tmp/App.tsx" },
          ],
        },
        { id: "assistant-a", type: "agentMessage", text: "旧回复" },
      ],
    },
    {
      id: "turn-b",
      status: "completed",
      items: [
        { id: "user-b", type: "userMessage", text: "继续检查" },
        { id: "assistant-b", type: "agentMessage", text: "后续回复" },
      ],
    },
  ];

  it("定位只有一条用户消息的目标轮次并计算回退范围", () => {
    const target = createHistoricalMessageEditTarget(turns, "turn-a");

    expect(target).toMatchObject({
      turnId: "turn-a",
      messageId: "user-a",
      text: "修复旧问题",
      rollbackTurnCount: 2,
      hasLaterTurns: true,
      attachmentCount: 4,
    });
  });

  it("只替换主文本并完整保留原消息附件", () => {
    const target = createHistoricalMessageEditTarget(turns, "turn-a");
    expect(target).not.toBeNull();

    expect(buildEditedHistoryInput(target!, "修复新问题")).toEqual([
      { type: "text", text: "修复新问题", text_elements: [] },
      { type: "image", url: "data:image/png;base64,AAAA" },
      {
        type: "text",
        text: "已上传文件：[需求.pdf](/tmp/需求.pdf)\n本机路径：`/tmp/需求.pdf`",
        text_elements: [],
      },
      { type: "localImage", path: "/tmp/screenshot.png" },
      { type: "audio", url: "data:audio/wav;base64,BBBB" },
      { type: "skill", name: "review", path: "/tmp/review" },
      { type: "mention", name: "App.tsx", path: "/tmp/App.tsx" },
    ]);
  });

  it("编辑首条历史消息时隐藏且不重发内部标题请求", () => {
    const target = createHistoricalMessageEditTarget(
      [{
        id: "turn-title",
        status: "completed",
        items: [{
          id: "user-title",
          type: "userMessage",
          content: [{
            type: "text",
            text: `修复登录回跳问题\n\n${CONVERSATION_TITLE_REQUEST}`,
          }],
        }],
      }],
      "turn-title",
    );

    expect(target?.text).toBe("修复登录回跳问题");
    expect(buildEditedHistoryInput(target!, "调整登录回跳问题")).toEqual([
      { type: "text", text: "调整登录回跳问题", text_elements: [] },
    ]);
  });

  it("文件是唯一文本输入时将它视作附件并在前面插入编辑文本", () => {
    const target = createHistoricalMessageEditTarget(
      [{
        id: "turn-file",
        status: "completed",
        items: [{
          id: "user-file",
          type: "userMessage",
          content: [{
            type: "text",
            text: "Uploaded file: [brief.pdf](/tmp/brief.pdf)\nHost path: `/tmp/brief.pdf`",
          }],
        }],
      }],
      "turn-file",
    );

    expect(target?.text).toBe("");
    expect(target?.attachmentCount).toBe(1);
    expect(buildEditedHistoryInput(target!, "阅读附件")).toEqual([
      { type: "text", text: "阅读附件", text_elements: [] },
      {
        type: "text",
        text: "Uploaded file: [brief.pdf](/tmp/brief.pdf)\nHost path: `/tmp/brief.pdf`",
        text_elements: [],
      },
    ]);
  });

  it("拒绝包含多条用户消息或不稳定 ID 的轮次", () => {
    expect(
      createHistoricalMessageEditTarget(
        [{
          id: "turn-steered",
          status: "completed",
          items: [
            { id: "user-1", type: "userMessage", text: "先做一版" },
            { id: "user-2", type: "userMessage", text: "再调整" },
          ],
        }],
        "turn-steered",
      ),
    ).toBeNull();
    expect(
      createHistoricalMessageEditTarget(
        [{
          id: "pending-1",
          status: "completed",
          items: [{ id: "user", type: "userMessage", text: "临时消息" }],
        }],
        "pending-1",
      ),
    ).toBeNull();
  });

  it("优先按目标 turn ID 调用 thread/revert", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const requester = {
      request: async (method: string, params: unknown) => {
        calls.push({ method, params });
        return { thread: { id: "thread-1", turns: [] } };
      },
    };
    const target = createHistoricalMessageEditTarget(turns, "turn-a")!;

    await expect(
      revertHistoricalMessage(requester, "thread-1", target),
    ).resolves.toMatchObject({ method: "thread/revert" });
    expect(calls).toEqual([{
      method: "thread/revert",
      params: { threadId: "thread-1", beforeTurnId: "turn-a" },
    }]);
  });

  it("只有方法不存在时才回退到旧版 thread/rollback", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const requester = {
      request: async (method: string, params: unknown) => {
        calls.push({ method, params });
        if (method === "thread/revert") {
          throw new AppServerRpcError("Method not found", -32601);
        }
        return { thread: { id: "thread-1", turns: [] } };
      },
    };
    const target = createHistoricalMessageEditTarget(turns, "turn-a")!;

    await expect(
      revertHistoricalMessage(requester, "thread-1", target),
    ).resolves.toMatchObject({ method: "thread/rollback" });
    expect(calls).toEqual([
      {
        method: "thread/revert",
        params: { threadId: "thread-1", beforeTurnId: "turn-a" },
      },
      {
        method: "thread/rollback",
        params: { threadId: "thread-1", numTurns: 2 },
      },
    ]);
  });

  it("thread/revert 的业务错误不会触发第二次破坏性请求", async () => {
    const calls: string[] = [];
    const failure = new AppServerRpcError("thread is active", -32602);
    const requester = {
      request: async (method: string) => {
        calls.push(method);
        throw failure;
      },
    };

    await expect(
      revertHistoricalMessage(
        requester,
        "thread-1",
        createHistoricalMessageEditTarget(turns, "turn-a")!,
      ),
    ).rejects.toBe(failure);
    expect(calls).toEqual(["thread/revert"]);
  });
});
