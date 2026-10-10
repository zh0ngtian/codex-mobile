import { describe, expect, it, vi } from "vitest";
import { FinalAnswerCompletionTracker } from "../../server/final-answer-completion";
import {
  AppServerClient,
  AppServerConnectionUnavailableError,
  AppServerRpcError,
} from "../../src/app-server/client";

class FakeSocket extends EventTarget {
  static OPEN = 1;
  readyState = FakeSocket.OPEN;
  sent: string[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];

  send(payload: string) {
    this.sent.push(payload);
  }

  close(code?: number, reason?: string) {
    this.closed.push({ code, reason });
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }

  receive(payload: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(payload) }),
    );
  }
}

describe("AppServerClient", () => {
  it.each([false, true])("移动指令确认事件支持 HTTP 延迟确认=%s，并恢复提前到达的完成", async (delayed) => {
    const socket = new FakeSocket();
    const client = new AppServerClient(socket as unknown as WebSocket);
    const tracker = new FinalAnswerCompletionTracker({ requireMobileOrigin: true });
    const completed: unknown[] = [];
    client.onNotification((message) => {
      const params = message.params as any;
      const result = message.method === "mobile/turn/accepted"
        ? tracker.observeRpc(params.request, params.response) : tracker.observe(message);
      if (result) completed.push(result);
    });
    const finish = (turnId: string) => socket.receive({ method: "turn/completed", params: {
      threadId: "t", turn: { id: turnId, status: "completed", items: [{ type: "agentMessage", phase: "final_answer" }] },
    } });
    finish("desktop");
    const request = { method: "turn/start", params: { threadId: "t", input: [{ type: "text", text: "private prompt" }] } };
    finish("mobile");
    const response = { result: { turn: { id: "mobile" } } };
    if (delayed) socket.receive({ method: "mobile/operation/confirmed", params: { request, response } });
    else {
      const pending = client.request(request.method, request.params);
      socket.receive({ id: JSON.parse(socket.sent.at(-1)!).id, ...response });
      await pending;
    }
    finish("mobile"); finish("next-desktop");
    expect(completed).toEqual([{ threadId: "t", turnId: "mobile" }]);
  });

  it("失败指令不会生成来源事件，来源事件不保留输入正文", async () => {
    const socket = new FakeSocket();
    const client = new AppServerClient(socket as unknown as WebSocket);
    const seen: any[] = [];
    client.onNotification((message) => seen.push(message));
    const pending = client.request("turn/steer", { threadId: "t", expectedTurnId: "turn", input: "private prompt" });
    socket.receive({ id: JSON.parse(socket.sent.at(-1)!).id, result: { turnId: "turn" } });
    await pending;
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain("private prompt");
    const failed = client.request("turn/start", { threadId: "t" }).catch(() => undefined);
    socket.receive({ id: JSON.parse(socket.sent.at(-1)!).id, error: { code: -1, message: "failed" } });
    await failed;
    expect(seen).toHaveLength(1);
  });

  it("thread RPC 摘要在业务 promise 完成前登记，隐藏后仍能识别通知来源", async () => {
    const socket = new FakeSocket();
    const client = new AppServerClient(socket as unknown as WebSocket);
    const seen: any[] = [];
    const off = client.onThreadMetadata((thread) => seen.push(thread));
    const child = { id: "child", threadSource: "subagent" };
    for (const [method, result, expected] of [
      ["thread/list", { data: [child] }, [child]],
      ["thread/read", { thread: child }, [child]],
      ["thread/search", { data: [{ thread: child, snippet: "match" }] }, [child]],
      ["thread/loaded/list", { data: ["child"] }, []],
      ["model/list", { data: [child] }, []],
    ] as const) {
      seen.length = 0;
      const promise = client.request(method, {});
      const sent = JSON.parse(socket.sent.at(-1)!);
      socket.receive({ id: sent.id, result });
      expect(seen).toEqual(expected);
      await expect(promise).resolves.toEqual(result);
    }
    off();
    seen.length = 0;
    const promise = client.request("thread/read", {});
    socket.receive({ id: JSON.parse(socket.sent.at(-1)!).id, result: { thread: child } });
    await promise;
    expect(seen).toEqual([]);
  });

  it("初始化后发送 initialized 并加载线程列表", async () => {
    const socket = new FakeSocket();
    const client = new AppServerClient(socket as unknown as WebSocket);
    const ready = client.initialize();

    const initialize = JSON.parse(socket.sent[0]);
    expect(initialize.method).toBe("initialize");
    expect(initialize.params.capabilities.experimentalApi).toBe(true);

    socket.receive({
      id: initialize.id,
      result: {
        userAgent: "codex-cli/0.144.1",
        codexHome: "/tmp/codex",
        platformFamily: "unix",
        platformOs: "macos",
      },
    });
    await ready;

    expect(JSON.parse(socket.sent[1])).toEqual({
      method: "initialized",
      params: {},
    });

    const list = client.request("thread/list", { limit: 20 });
    const listRequest = JSON.parse(socket.sent[2]);
    socket.receive({
      id: listRequest.id,
      result: { data: [], nextCursor: null },
    });

    await expect(list).resolves.toEqual({ data: [], nextCursor: null });
  });

  it("分发服务器通知", () => {
    const socket = new FakeSocket();
    const client = new AppServerClient(socket as unknown as WebSocket);
    const received: unknown[] = [];
    client.onNotification((notification) => received.push(notification));

    socket.receive({
      method: "thread/status/changed",
      params: { threadId: "thread-1", status: { type: "active" } },
    });

    expect(received).toHaveLength(1);
  });

  it("可以用 JSON-RPC 错误拒绝不支持的服务器请求", () => {
    const socket = new FakeSocket();
    const client = new AppServerClient(socket as unknown as WebSocket);
    client.respondError(9, -32601, "unsupported");
    expect(JSON.parse(socket.sent[0])).toEqual({
      id: 9,
      error: { code: -32601, message: "unsupported" },
    });
  });

  it("服务端请求错误保留 JSON-RPC code 和 data", async () => {
    const socket = new FakeSocket();
    const client = new AppServerClient(socket as unknown as WebSocket);
    const request = client.request("thread/revert", {
      threadId: "thread-1",
      beforeTurnId: "turn-2",
    });
    const sent = JSON.parse(socket.sent[0]);

    socket.receive({
      id: sent.id,
      error: {
        code: -32601,
        message: "Method not found",
        data: { method: "thread/revert" },
      },
    });

    await expect(request).rejects.toMatchObject({
      name: "AppServerRpcError",
      code: -32601,
      message: "Method not found",
      data: { method: "thread/revert" },
    } satisfies Partial<AppServerRpcError>);
  });

  it("普通请求超时后关闭半开连接并拒绝等待中的请求", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const client = new AppServerClient(
      socket as unknown as WebSocket,
      { requestTimeoutMs: 1_000 },
    );

    const request = client.request("thread/list", { limit: 5 });
    const rejection = expect(request).rejects.toThrow(
      "thread/list 请求超时",
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(socket.closed).toEqual([
      { code: 4000, reason: "request timeout" },
    ]);
    vi.useRealTimers();
  });

  it("连接不是打开状态时不会发送请求", async () => {
    const socket = new FakeSocket();
    socket.readyState = WebSocket.CLOSED;
    const client = new AppServerClient(socket as unknown as WebSocket);

    await expect(
      client.request("thread/list", { limit: 5 }),
    ).rejects.toMatchObject({
      name: "AppServerConnectionUnavailableError",
      message: "与 app-server 的连接不可用",
      requestSent: false,
    } satisfies Partial<AppServerConnectionUnavailableError>);
    expect(socket.sent).toHaveLength(0);
  });

  it("图片编码后的请求超过服务端上限时显示实际原因且不发送", async () => {
    const socket = new FakeSocket();
    const client = new AppServerClient(socket as unknown as WebSocket);
    const request = client.request("turn/start", {
      input: [{ type: "image", url: `data:image/png;base64,${"A".repeat(17 * 1024 * 1024)}` }],
    });

    await expect(request).rejects.toThrow(/请求消息.*超过.*16 MiB/);
    expect(socket.sent).toHaveLength(0);
    expect(socket.closed).toHaveLength(0);
  });
});
