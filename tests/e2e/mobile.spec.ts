import { expect, test } from "./http-fixture";
import { test as liveTest } from "@playwright/test";
import { CONVERSATION_TITLE_REQUEST } from "../../src/app-server/conversation-title";

test("发送前旧连接失效时恢复会话并只发送一次", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    (window as any).__reconnectRpc = [];
    (window as any).__reconnectSockets = [];

    class ReconnectSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;
      readonly socketNumber: number;

      constructor() {
        super();
        this.socketNumber = (window as any).__reconnectSockets.push(this);
        setTimeout(() => {
          this.readyState = ReconnectSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        (window as any).__reconnectRpc.push({
          ...request,
          socketNumber: this.socketNumber,
        });
        if (request.id == null) return;
        const thread = {
          id: "thread-reconnect",
          name: "断线恢复会话",
          preview: "断线恢复会话",
          cwd: "/tmp/project",
          status: { type: "idle" },
          turns: [],
        };
        const responses: Record<string, unknown> = {
          initialize: {
            userAgent: "reconnect-mock",
            codexHome: "/tmp/codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
          "model/list": {
            data: [{
              id: "gpt-test",
              model: "gpt-test",
              displayName: "GPT Test",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [
                { reasoningEffort: "medium", description: "平衡" },
              ],
              defaultServiceTier: null,
              serviceTiers: [],
            }],
          },
          "permissionProfile/list": {
            data: [{ id: ":workspace", description: "Workspace", allowed: true }],
          },
          "config/read": {
            config: {
              model: "gpt-test",
              model_reasoning_effort: "medium",
              sandbox_mode: "workspace-write",
              approval_policy: "on-request",
            },
          },
          "account/rateLimits/read": {},
          "thread/list": { data: [thread], nextCursor: null },
          "thread/resume": {
            thread,
            initialTurnsPage: { data: [], nextCursor: null },
            model: "gpt-test",
            reasoningEffort: "medium",
            serviceTier: null,
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            activePermissionProfile: { id: ":workspace" },
          },
          "thread/turns/list": { data: [], nextCursor: null },
          "turn/start": {
            turn: { id: "turn-reconnected", status: "inProgress", items: [] },
          },
        };
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                id: request.id,
                result: responses[request.method] ?? {},
              }),
            }),
          );
        }, 0);
      }

      close(code?: number, reason?: string) {
        if (this.readyState === ReconnectSocket.CLOSED) return;
        this.readyState = ReconnectSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }
    }

    (window as any).WebSocket = ReconnectSocket;
  });

  await page.goto("/");
  await page.getByRole("button", { name: /断线恢复会话/ }).first().click();
  await expect(page.locator(".thread-heading strong")).toHaveText("断线恢复会话");
  await page.evaluate(() => {
    (window as any).__reconnectSockets[0].readyState = 3;
  });

  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("断线后发送");
  await page.getByRole("button", { name: "发送" }).click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__reconnectRpc.filter(
          (message: any) => message.method === "turn/start",
        ),
      ),
    )
    .toEqual([
      expect.objectContaining({
        socketNumber: 2,
        params: expect.objectContaining({ threadId: "thread-reconnect" }),
      }),
    ]);
  await expect(page.getByText("与 app-server 的连接不可用")).toHaveCount(0);
});

test("新会话从首条流式回复生成一次标题并隐藏协议内容", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    (window as any).__titleRpc = [];

    class TitleSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;

      constructor() {
        super();
        setTimeout(() => {
          this.readyState = TitleSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        (window as any).__titleRpc.push(request);
        if (request.id == null) return;
        const responses: Record<string, unknown> = {
          initialize: {
            userAgent: "title-mock",
            codexHome: "/tmp/codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
          "model/list": {
            data: [{
              id: "gpt-test",
              model: "gpt-test",
              displayName: "GPT Test",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [
                { reasoningEffort: "medium", description: "平衡" },
              ],
              defaultServiceTier: null,
              serviceTiers: [],
            }],
          },
          "permissionProfile/list": {
            data: [{ id: ":workspace", description: "Workspace", allowed: true }],
          },
          "config/read": {
            config: {
              model: "gpt-test",
              model_reasoning_effort: "medium",
              sandbox_mode: "workspace-write",
              approval_policy: "on-request",
            },
          },
          "thread/list": { data: [] },
          "thread/start": {
            thread: {
              id: "generated-title-thread",
              preview: "",
              cwd: "/tmp/project",
              turns: [],
            },
            model: "gpt-test",
            reasoningEffort: "medium",
            serviceTier: null,
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            activePermissionProfile: { id: ":workspace" },
          },
          "turn/start": {
            turn: {
              id: "generated-title-turn",
              status: "inProgress",
              items: [],
            },
          },
        };
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                id: request.id,
                result: responses[request.method] ?? {},
              }),
            }),
          );
        }, 0);

        if (request.method === "turn/start") {
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  method: "item/started",
                  params: {
                    threadId: "generated-title-thread",
                    turnId: "generated-title-turn",
                    item: {
                      id: "first-reply",
                      type: "agentMessage",
                      text: "我先检查登录回跳相关代码。\n\n<!-- conversation-title: 修复",
                    },
                  },
                }),
              }),
            );
          }, 20);
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  method: "item/agentMessage/delta",
                  params: {
                    threadId: "generated-title-thread",
                    turnId: "generated-title-turn",
                    itemId: "first-reply",
                    delta: "登录回跳问题 -->\n",
                  },
                }),
              }),
            );
          }, 40);
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  method: "item/started",
                  params: {
                    threadId: "generated-title-thread",
                    turnId: "generated-title-turn",
                    item: {
                      id: "later-reply",
                      type: "agentMessage",
                      text: "继续处理。\n<!-- conversation-title: 不应覆盖标题 -->",
                    },
                  },
                }),
              }),
            );
          }, 80);
        }
      }

      close() {
        this.readyState = TitleSocket.CLOSED;
        this.dispatchEvent(new Event("close"));
      }
    }

    (window as any).WebSocket = TitleSocket;
  });

  await page.goto("/");
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await expect(page.locator(".thread-heading strong")).toHaveText("新对话");
  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill(
    "请修复登录回跳问题",
  );
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.locator(".thread-heading strong")).toHaveText(
    "修复登录回跳问题",
  );
  await expect(page.getByText("我先检查登录回跳相关代码。", { exact: true }))
    .toBeVisible();
  await expect(page.getByText("继续处理。", { exact: true })).toBeVisible();
  await expect(page.locator(".thread-heading strong")).toHaveText(
    "修复登录回跳问题",
  );
  await expect(page.getByText(/conversation-title/)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__titleRpc.filter(
          (message: any) => message.method === "thread/name/set",
        ),
      ),
    )
    .toEqual([
      expect.objectContaining({
        params: {
          threadId: "generated-title-thread",
          name: "修复登录回跳问题",
        },
      }),
    ]);

  const turnStart = await page.evaluate(() =>
    (window as any).__titleRpc.find(
      (message: any) => message.method === "turn/start",
    ),
  );
  expect(turnStart.params.input).toEqual([{
    type: "text",
    text: `请修复登录回跳问题\n\n${CONVERSATION_TITLE_REQUEST}`,
    text_elements: [],
  }]);
});

test("历史消息编辑会回退后保留附件重发", async ({ page }) => {
  await page.addInitScript(() => {
    const now = Math.floor(Date.now() / 1000);
    const turns = [
      {
        id: "turn-a",
        status: "completed",
        items: [
          {
            id: "user-a",
            type: "userMessage",
            content: [
              { type: "text", text: "原消息" },
              { type: "localImage", path: "/tmp/original.png" },
            ],
          },
          {
            id: "agent-a",
            type: "agentMessage",
            phase: "final_answer",
            text: "旧回复",
          },
        ],
      },
      {
        id: "turn-b",
        status: "completed",
        items: [
          { id: "user-b", type: "userMessage", text: "后续消息" },
          {
            id: "agent-b",
            type: "agentMessage",
            phase: "final_answer",
            text: "后续回复",
          },
        ],
      },
    ];
    (window as any).__historyEditRpc = [];
    class HistoryEditSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;

      constructor() {
        super();
        setTimeout(() => {
          this.readyState = HistoryEditSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        (window as any).__historyEditRpc.push(request);
        if (request.id == null) return;
        const responses: Record<string, unknown> = {
          initialize: {
            userAgent: "history-edit-mock",
            codexHome: "/tmp/codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
          "model/list": {
            data: [
              {
                id: "gpt-test",
                model: "gpt-test",
                displayName: "GPT Test",
                isDefault: true,
                defaultReasoningEffort: "medium",
                supportedReasoningEfforts: [
                  { reasoningEffort: "medium", description: "平衡" },
                ],
                defaultServiceTier: null,
                serviceTiers: [],
              },
            ],
          },
          "permissionProfile/list": {
            data: [
              { id: ":workspace", description: "Workspace", allowed: true },
            ],
          },
          "config/read": {
            config: {
              model: "gpt-test",
              model_reasoning_effort: "medium",
              service_tier: null,
              sandbox_mode: "workspace-write",
              approval_policy: "on-request",
              approvals_reviewer: "user",
            },
          },
          "thread/list": {
            data: [
              {
                id: "thread-edit",
                preview: "历史编辑会话",
                cwd: "/tmp/project",
                updatedAt: now,
                status: { type: "idle" },
              },
            ],
          },
          "thread/resume": {
            thread: {
              id: "thread-edit",
              preview: "历史编辑会话",
              cwd: "/tmp/project",
              turns,
            },
            model: "gpt-test",
            reasoningEffort: "medium",
            serviceTier: null,
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            activePermissionProfile: { id: ":workspace" },
          },
          "thread/revert": {
            thread: {
              id: "thread-edit",
              preview: "历史编辑会话",
              cwd: "/tmp/project",
              turns: [],
            },
            turnsBackwardsCursor: null,
            itemsBackwardsCursor: null,
          },
          "turn/start": {
            turn: { id: "turn-new", status: "inProgress", items: [] },
          },
        };
        setTimeout(
          () =>
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  id: request.id,
                  result: responses[request.method] ?? {},
                }),
              }),
            ),
          0,
        );
      }

      close() {
        this.readyState = HistoryEditSocket.CLOSED;
        this.dispatchEvent(new Event("close"));
      }
    }
    (window as any).WebSocket = HistoryEditSocket;
  });

  await page.goto("/");
  await page.getByRole("button", { name: /历史编辑会话/ }).first().click();
  await expect(page.getByText("原消息", { exact: true })).toBeVisible();
  await expect(page.getByText("后续消息", { exact: true })).toBeVisible();

  const targetTurn = page.locator(".turn-card").first();
  const composer = page.getByRole("textbox", { name: "向 Codex 提问" });
  await composer.fill("未发送的底部草稿");
  await targetTurn.getByRole("button", { name: "编辑历史消息" }).click();
  await expect(targetTurn).toContainText(
    "原消息的 1 个附件会保留",
  );

  const inlineEditor = targetTurn.getByRole("textbox", {
    name: "编辑历史消息内容",
  });
  await expect(inlineEditor).toHaveValue("原消息");
  await expect(composer).toHaveValue("未发送的底部草稿");
  await inlineEditor.fill("修改后的消息");
  await targetTurn.getByRole("button", { name: "保存并重发" }).click();

  const confirmation = targetTurn.getByRole("status", {
    name: "确认删除后续对话",
  });
  await expect(confirmation).toContainText(
    "文件修改、已执行命令和远端操作不会撤销。",
  );
  await expect(page.getByRole("dialog", { name: "删除后续对话并重发？" })).toHaveCount(0);
  await confirmation
    .getByRole("button", { name: "删除后续并重发" })
    .click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__historyEditRpc.filter(
          (message: any) =>
            message.method === "thread/revert" ||
            message.method === "turn/start",
        ),
      ),
    )
    .toHaveLength(2);
  const requests = await page.evaluate(() =>
    (window as any).__historyEditRpc.filter(
      (message: any) =>
        message.method === "thread/revert" || message.method === "turn/start",
    ),
  );
  expect(requests.map((request: any) => request.method)).toEqual([
    "thread/revert",
    "turn/start",
  ]);
  expect(requests[0].params).toEqual({
    threadId: "thread-edit",
    beforeTurnId: "turn-a",
  });
  expect(requests[1].params).toEqual({
    threadId: "thread-edit",
    input: [
      { type: "text", text: "修改后的消息", text_elements: [] },
      { type: "localImage", path: "/tmp/original.png" },
    ],
    model: "gpt-test",
    effort: "medium",
    serviceTier: null,
    permissions: ":workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
  });
});

test("移动端选择器、线程恢复、Markdown、折叠与吸顶", async ({ page }) => {
  const expectSheetHeaderFlush = async (sheetSelector: string) => {
    const offset = await page.locator(sheetSelector).evaluate((sheet) => {
      const header = sheet.querySelector(":scope > header");
      if (!header) return Number.POSITIVE_INFINITY;
      return Math.abs(
        header.getBoundingClientRect().top - sheet.getBoundingClientRect().top,
      );
    });
    expect(offset).toBeLessThanOrEqual(1);
  };

  await page.addInitScript(() => {
    const now = Math.floor(Date.now() / 1000);
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: {
              latitude: 31.230416,
              longitude: 121.473701,
              accuracy: 12.4,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
              toJSON: () => ({}),
            },
            timestamp: Date.now(),
            toJSON: () => ({}),
          });
        },
      },
    });
    const longUserText =
      "# 用户标题\n\n**用户粗体**\n\n- 用户列表\n\n" +
      "请检查这个移动端界面，并参考附件中的视觉细节。\n".repeat(10);
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: any[]
    ) =>
      nativeSetInterval(
        handler,
        timeout === 60_000 ? 250 : timeout,
        ...args,
      )) as typeof window.setInterval;
    (window as any).__rpcMessages = [];
    class MockSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;

      constructor() {
        super();
        setTimeout(() => {
          this.readyState = MockSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        (window as any).__rpcMessages.push(request);
        if (request.id == null) return;
        const responses: Record<string, unknown> = {
          initialize: {
            userAgent: "mock-app-server",
            codexHome: "/tmp/codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
          "fs/readFile": request.params?.path?.endsWith(".png")
            ? {
                dataBase64:
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
              }
            : {
                dataBase64: btoa(
                  "import type { DraftImage } from './types';\n" +
                    "export const remoteFile = true;\n" +
                    "export const maxImages = 4;\n",
                ),
              },
          "model/list": {
            data: [
              {
                id: "terra-standard",
                model: "gpt-5.6-terra",
                displayName: "GPT-5.6-Terra",
                description: "均衡模型",
                isDefault: true,
                defaultReasoningEffort: "medium",
                supportedReasoningEfforts: [
                  { reasoningEffort: "low", description: "更快响应" },
                  { reasoningEffort: "medium", description: "平衡速度与质量" },
                  { reasoningEffort: "high", description: "更深入思考" },
                ],
                defaultServiceTier: null,
                serviceTiers: [],
              },
              {
                id: "terra-priority",
                model: "gpt-5.6-terra-priority",
                displayName: "GPT-5.6-Terra Priority",
                description: "低延迟通道",
                defaultReasoningEffort: "high",
                supportedReasoningEfforts: [
                  { reasoningEffort: "low", description: "更快响应" },
                  { reasoningEffort: "high", description: "更深入思考" },
                ],
                defaultServiceTier: null,
                serviceTiers: [
                  {
                    id: "priority",
                    name: "快速",
                    description: "1.5 倍速度，用量增加",
                  },
                ],
                additionalSpeedTiers: ["fast"],
              },
            ],
          },
          "permissionProfile/list": {
            data: [
              { id: ":workspace", description: "Workspace", allowed: true },
              { id: ":read-only", description: "Read only", allowed: true },
              {
                id: ":danger-full-access",
                description: "Full access",
                allowed: true,
              },
            ],
          },
          "config/read": {
            config: {
              model: "gpt-5.6-terra",
              model_reasoning_effort: "medium",
              service_tier: null,
              sandbox_mode: "workspace-write",
              approval_policy: "on-request",
              approvals_reviewer: "user",
            },
          },
          "thread/list": {
            data: [
              {
                id: "existing-thread",
                preview: "Markdown 会话",
                cwd: "/tmp/project",
                updatedAt: now - 120,
                status: { type: "active", activeFlags: [] },
              },
              {
                id: "idle-thread",
                preview: "空闲会话",
                cwd: "/tmp/project",
                updatedAt: now - 120,
                status: { type: "idle" },
              },
              ...Array.from({ length: 18 }, (_, index) => ({
                id: `history-${index}`,
                preview: `历史会话 ${index + 1}`,
                cwd: "/tmp/project",
                updatedAt: now - 3_600 - index * 60,
                status: { type: "idle" },
              })),
            ],
          },
          "thread/read": {
            thread: {
              id: "existing-thread",
              preview: "Markdown 会话",
              cwd: "/tmp/project",
              updatedAt: now - 120,
              status: { type: "active", activeFlags: [] },
            },
          },
          "thread/resume": {
            thread: {
              id: "existing-thread",
              preview: "Markdown 会话",
              cwd: "/tmp/project",
              turns: [
                ...Array.from({ length: 8 }, (_, index) => ({
                  id: `history-turn-${index}`,
                  status: "completed",
                  items: [
                    {
                      id: `history-user-${index}`,
                      type: "userMessage",
                      text: `历史问题 ${index + 1}`,
                    },
                    {
                      id: `history-agent-${index}`,
                      type: "agentMessage",
                      phase: "final_answer",
                      text: `历史回复 ${index + 1}`,
                    },
                  ],
                })),
                {
                  id: "turn-1",
                  status: "completed",
                  items: [
                    {
                      id: "u-1",
                      type: "userMessage",
                      content: [
                        { type: "text", text: longUserText },
                        { type: "localImage", path: "/tmp/user.png" },
                      ],
                    },
                    {
                      id: "a-0",
                      type: "agentMessage",
                      text: "我先检查界面和协议事件。",
                    },
                    {
                      id: "c-1",
                      type: "commandExecution",
                      status: "completed",
                      command: "sed -n '1,20p' src/App.tsx",
                      commandActions: [
                        {
                          type: "read",
                          name: "App.tsx",
                          path: "/tmp/project/src/App.tsx",
                        },
                      ],
                      cwd: "/tmp/project",
                      aggregatedOutput: Array.from(
                        { length: 80 },
                        (_, index) => `${index + 1}: test output`,
                      ).join("\n"),
                      exitCode: 0,
                    },
                    {
                      id: "f-1",
                      type: "fileChange",
                      status: "completed",
                      changes: [
                        {
                          path: "/tmp/project/src/App.tsx",
                          kind: "update",
                          diff:
                            "@@ -138,2 +138,3 @@\n turns: [\n+  ...historyTurns,\n-  oldTurn,\n+  currentTurn,",
                        },
                        {
                          path:
                            "/tmp/project/docs/plans/mobile-diff-design.md",
                          kind: "add",
                          diff: "@@ -0,0 +1 @@\n+# 移动端 Diff",
                        },
                      ],
                    },
                    {
                      id: "image-1",
                      type: "imageView",
                      path: "/tmp/ai.png",
                    },
                    {
                      id: "a-1",
                      type: "agentMessage",
                      phase: "final_answer",
                      text:
                        "**加粗内容**\n\n- 列表项\n\n`inline-code`\n\n" +
                        "[attachments.ts](/tmp/project/src/ui/attachments.ts:2) " +
                        "[OpenAI](https://openai.com)",
                    },
                  ],
                },
              ],
            },
            model: "gpt-5.6-terra",
            reasoningEffort: "medium",
            serviceTier: null,
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            activePermissionProfile: { id: ":workspace" },
          },
          "thread/start": {
            thread: {
              id: "new-thread",
              preview: "新对话",
              cwd: "/tmp/project",
              turns: [],
            },
            model: "gpt-5.6-terra-priority",
            reasoningEffort: "high",
            serviceTier: "priority",
            approvalPolicy: "on-request",
            approvalsReviewer: "auto_review",
            activePermissionProfile: { id: ":workspace" },
          },
          "turn/start": {
            turn: {
              id: "new-turn",
              status: "inProgress",
              items: [{ id: "u-new", type: "userMessage", text: "协议检查" }],
            },
          },
        };
        const responseDelay = request.method === "thread/list" ? 350 : 0;
        setTimeout(
          () =>
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  id: request.id,
                  result: responses[request.method] ?? {},
                }),
              }),
            ),
          responseDelay,
        );
        if (request.method === "turn/start") {
          const threadId = request.params.threadId;
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  method: "turn/started",
                  params: {
                    threadId,
                    turn: {
                      id: "new-turn",
                      status: "inProgress",
                      items: [],
                    },
                  },
                }),
              }),
            );
          }, 20);
          setTimeout(() => {
            for (const item of [
              {
                id: "live-agent",
                type: "agentMessage",
                text:
                  "正在检查实时过程。\n\n<!-- conversation-title: 移动端",
              },
              {
                id: "live-command",
                type: "commandExecution",
                status: "inProgress",
                command: "npm test",
              },
              {
                id: "live-final",
                type: "agentMessage",
                phase: "final_answer",
                text: "实时任务最终回复",
              },
            ]) {
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: JSON.stringify({
                    method: "item/started",
                    params: { threadId, turnId: "new-turn", item },
                  }),
                }),
              );
            }
          }, 40);
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  method: "item/agentMessage/delta",
                  params: {
                    threadId,
                    turnId: "new-turn",
                    itemId: "live-agent",
                    delta: "协议检查 -->\n",
                  },
                }),
              }),
            );
          }, 60);
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  method: "item/completed",
                  params: {
                    threadId,
                    turnId: "new-turn",
                    item: {
                      id: "live-command",
                      type: "commandExecution",
                      status: "completed",
                      command: "npm test",
                    },
                  },
                }),
              }),
            );
          }, 1_500);
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  method: "turn/completed",
                  params: {
                    threadId,
                    turn: {
                      id: "new-turn",
                      status: "completed",
                      items: [
                        {
                          id: "live-final",
                          type: "agentMessage",
                          phase: "final_answer",
                          text: "实时任务最终回复",
                        },
                      ],
                    },
                  },
                }),
              }),
            );
          }, 2_500);
        }
      }

      close() {
        this.readyState = MockSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    (window as any).WebSocket = MockSocket;
  });

  await page.goto("/");
  await expect(page.getByLabel("正在加载会话")).toBeVisible();
  await expect(page.getByText("暂无对话", { exact: true })).toHaveCount(0);
  await expect(page.getByText("2 分钟", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("正在加载会话")).toHaveCount(0);
  await expect(page.getByLabel("进行中", { exact: true }).first()).toBeVisible();
  const markdownThreadRow = page.getByRole("button", {
    name: /Markdown 会话/,
  }).first();
  await markdownThreadRow.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 40,
    clientY: 180,
  });
  await page.waitForTimeout(550);
  await markdownThreadRow.dispatchEvent("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 40,
    clientY: 180,
  });
  await markdownThreadRow.dispatchEvent("click");
  await expect(page.getByLabel("会话操作", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新会话", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "复制会话 ID" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重命名" })).toBeVisible();
  await expect(page.getByRole("button", { name: "归档" })).toBeVisible();
  await page.getByRole("button", { name: "刷新会话", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__rpcMessages.some(
          (message: any) =>
            message.method === "thread/read" &&
            message.params?.threadId === "existing-thread" &&
            message.params?.includeTurns === false,
        ),
      ),
    )
    .toBe(true);
  await expect(page.getByLabel("会话操作", { exact: true })).toHaveCount(0);
  const listHeader = page.locator(".list-header");
  const listSticky = page.locator(".thread-list-sticky");
  await expect(listSticky).toHaveCSS("position", "sticky");
  await expect(listSticky).toHaveCSS("top", "0px");
  await expect(listHeader).toHaveCSS("position", "static");
  await page.locator(".thread-list-page").evaluate((element) => {
    element.scrollTop = 520;
  });
  await expect
    .poll(async () => Math.round((await listSticky.boundingBox())?.y ?? -1))
    .toBe(0);
  await expect(listSticky.locator(".backend-switcher")).toBeVisible();
  await expect(listHeader.locator("h1")).toHaveCSS("font-size", "20px");
  await expect(page.locator(".thread-row").first()).toHaveCSS(
    "font-size",
    "15px",
  );
  await expect(page.locator(".thread-row").first()).toHaveCSS(
    "line-height",
    "20.25px",
  );
  await expect(page.locator(".thread-row").first()).toHaveCSS(
    "min-height",
    "54px",
  );
  await expect(page.locator(".list-header .round-button").first()).toHaveCSS(
    "width",
    "44px",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__rpcMessages.filter(
            (message: any) => message.method === "thread/list",
          ).length,
      ),
    )
    .toBeGreaterThan(1);
  await markdownThreadRow.click();
  await expect
    .poll(() =>
      page.locator(".conversation-scroll").evaluate(
        (element) =>
          Math.round(
            element.scrollHeight -
              element.scrollTop -
              element.clientHeight,
          ),
      ),
    )
    .toBeLessThanOrEqual(1);

  await expect(page.locator(".assistant-message .markdown-body strong"))
    .toHaveText("加粗内容");
  await expect(page.locator(".assistant-message .markdown-body li"))
    .toHaveText("列表项");
  await expect(page.locator(".assistant-message .markdown-body code"))
    .toContainText("inline-code");
  const remoteFileLink = page.getByRole("link", { name: "attachments.ts" });
  await expect(remoteFileLink).toHaveAttribute(
    "href",
    "/tmp/project/src/ui/attachments.ts:2",
  );
  await remoteFileLink.click();
  await expect(page).toHaveURL(/http:\/\/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByRole("heading", { name: "远程文件" })).toBeVisible();
  await expect(
    page.locator(
      ".remote-text-sheet .sheet-handle, .remote-text-sheet .sheet-handle-button",
    ),
  ).toHaveCount(0);
  await expect(
    page.locator(".remote-text-sheet > header").getByRole("button", {
      name: "关闭远程文件",
    }),
  ).toBeVisible();
  await expect(page.locator(".remote-text-sheet > header")).toHaveCSS(
    "position",
    "sticky",
  );
  await expect(page.locator(".remote-text-sheet > header")).toHaveCSS(
    "top",
    "0px",
  );
  await expectSheetHeaderFlush(".remote-text-sheet");
  await expect(page.getByText("export const remoteFile = true;", { exact: true }))
    .toBeVisible();
  await expect(page.locator(".remote-text-line.target")).toContainText(
    "export const remoteFile = true;",
  );
  await expect(
    page.getByText("/tmp/project/src/ui/attachments.ts:2", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".remote-text-sheet > footer .remote-file-path"),
  ).toHaveCSS("font-size", "11px");
  const remoteFileName = page.locator(".remote-text-file-name");
  await expect(remoteFileName).toContainText("attachments.ts");
  await expect(remoteFileName).toHaveCSS("font-size", "13px");
  const remoteFileNameBox = await remoteFileName.boundingBox();
  const remoteFileContentBox = await page
    .locator(".remote-text-content")
    .boundingBox();
  expect(remoteFileNameBox!.y + remoteFileNameBox!.height).toBeLessThanOrEqual(
    remoteFileContentBox!.y,
  );
  await expect(page.locator(".remote-text-sheet > footer strong")).toHaveCount(
    0,
  );
  const downloadFile = page.getByRole("link", { name: "下载文件" });
  await expect(downloadFile.locator("svg")).toBeVisible();
  await expect(downloadFile).not.toContainText("↓");
  await expect(
    page.locator('.remote-text-sheet button.sheet-close'),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__rpcMessages.some(
          (message: any) =>
            message.method === "fs/readFile" &&
            message.params.path === "/tmp/project/src/ui/attachments.ts",
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "关闭远程文件" }).click();
  await expect(page.getByRole("link", { name: "OpenAI" })).toHaveAttribute(
    "href",
    "https://openai.com",
  );
  await expect(page.locator(".user-bubble .user-markdown h1")).toHaveText(
    "用户标题",
  );
  await expect(page.locator(".user-bubble .user-markdown strong")).toHaveText(
    "用户粗体",
  );
  await expect(page.locator(".user-bubble .user-markdown li")).toHaveText(
    "用户列表",
  );
  await expect(page.getByRole("button", { name: /展开更多/ })).toBeVisible();
  await page.getByRole("button", { name: /展开更多/ }).click();
  await expect(page.getByRole("button", { name: /收起/ })).toBeVisible();
  await expect(page.getByRole("img", { name: "user.png" })).toBeVisible();
  await expect(page.getByRole("img", { name: "ai.png" })).toHaveCount(0);
  await expect(page.getByText("我先检查界面和协议事件。")).toHaveCount(0);
  await page.getByRole("button", { name: "查看图片 user.png" }).click();
  await expect(page.getByRole("heading", { name: "图片预览" })).toBeVisible();
  await expect(
    page.locator(
      ".image-preview-sheet .sheet-handle, .image-preview-sheet .sheet-handle-button",
    ),
  ).toHaveCount(0);
  await expect(page.locator(".image-preview-sheet > header")).toHaveCSS(
    "position",
    "sticky",
  );
  await expect(page.locator(".image-preview-sheet > header")).toHaveCSS(
    "top",
    "0px",
  );
  await expectSheetHeaderFlush(".image-preview-sheet");
  await expect(page.locator(".image-preview-sheet")).toContainText("user.png");
  await expect(page.getByText("100%")).toBeVisible();
  await page.getByRole("button", { name: "放大图片" }).click();
  await expect(page.getByText("125%")).toBeVisible();
  await page.getByRole("button", { name: "关闭图片预览" }).click();
  const previousMessages = page.getByRole("button", {
    name: /之前的 4 条消息/,
  });
  const previousChevron = previousMessages.locator(".chevron-icon");
  await expect(previousMessages).toHaveAttribute("aria-expanded", "false");
  await expect(previousChevron).toHaveClass(/direction-right/);
  const sharedChevronPath = await previousChevron.locator("path").getAttribute("d");
  await previousMessages.click();
  await expect(previousMessages).toHaveAttribute("aria-expanded", "true");
  await expect(previousChevron).toHaveClass(/direction-down/);
  await expect(previousChevron.locator("path")).toHaveAttribute(
    "d",
    sharedChevronPath!,
  );
  await expect(page.getByText("我先检查界面和协议事件。")).toBeVisible();
  await expect(page.getByRole("img", { name: "ai.png" })).toBeVisible();
  const activitySummary = page.locator(".tool-activity > summary");
  await expect(activitySummary).toContainText("已更改 2 个文件，已运行 1 个命令");
  await activitySummary.click();
  await page.getByRole("button", { name: "已读取 App.tsx", exact: true }).click();
  await expect(page.getByRole("heading", { name: "命令执行" })).toBeVisible();
  await expect(
    page.locator(
      ".tool-detail-sheet .sheet-handle, .tool-detail-sheet .sheet-handle-button",
    ),
  ).toHaveCount(0);
  const toolDetailClose = page.getByRole("button", {
    name: "关闭工具详情",
  });
  await expect(toolDetailClose).toHaveCSS("width", "44px");
  await expect(toolDetailClose).toHaveCSS("height", "44px");
  await expect(page.getByText("/tmp/project", { exact: true })).toBeVisible();
  const toolDetailHeader = page.locator(".tool-detail-sheet > header");
  const toolDetailSheet = page.locator(".tool-detail-sheet");
  await expect(toolDetailHeader).toHaveCSS("position", "sticky");
  await expect(toolDetailHeader).toHaveCSS("top", "0px");
  await expectSheetHeaderFlush(".tool-detail-sheet");
  await toolDetailSheet.evaluate((element) => {
    element.scrollTop = 160;
  });
  await page.waitForTimeout(50);
  const toolHeaderTop = Math.round(
    (await toolDetailHeader.boundingBox())?.y ?? -1,
  );
  await toolDetailSheet.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () =>
      Math.round((await toolDetailHeader.boundingBox())?.y ?? -1),
    )
    .toBe(toolHeaderTop);
  await toolDetailClose.click();
  await page
    .getByRole("button", { name: "已编辑 2 个文件", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "已更改 2 个文件" }))
    .toBeVisible();
  await expect(
    page.locator(
      ".file-diff-sheet .sheet-handle, .file-diff-sheet .sheet-handle-button",
    ),
  ).toHaveCount(0);
  await expect(page.locator(".file-diff-sheet > header")).toHaveCSS(
    "position",
    "sticky",
  );
  await expect(page.locator(".file-diff-sheet > header")).toHaveCSS(
    "top",
    "0px",
  );
  await expectSheetHeaderFlush(".file-diff-sheet");
  const appDiff = page.getByRole("button", { name: /App\.tsx.*\+2.*-1/ });
  await expect(appDiff).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".file-diff-line.addition")).toHaveCount(2);
  await expect(page.locator(".file-diff-line.deletion")).toHaveCount(1);
  await expect(page.getByText("138", { exact: true }).first()).toBeVisible();
  const designDiff = page.getByRole("button", {
    name: /mobile-diff-design\.md.*\+1/,
  });
  await expect(designDiff).toHaveAttribute("aria-expanded", "false");
  await designDiff.click();
  await expect(designDiff).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("# 移动端 Diff", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭文件修改" }).click();
  const conversationWidths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(conversationWidths.document).toBeLessThanOrEqual(
    conversationWidths.viewport,
  );
  expect(conversationWidths.body).toBeLessThanOrEqual(
    conversationWidths.viewport,
  );
  await expect(page.getByRole("button", { name: "选择审批与权限模式" }))
    .toContainText("默认权限");
  await expect(page.locator(".conversation-header")).toHaveCSS("position", "sticky");
  await expect(page.locator(".conversation-header")).toHaveCSS("top", "0px");

  const viewport = page.viewportSize()!;
  const composerShell = page.locator(".composer");
  const normalComposerBox = await composerShell.boundingBox();
  expect(normalComposerBox!.x).toBeLessThanOrEqual(12);
  expect(
    viewport.width - normalComposerBox!.x - normalComposerBox!.width,
  ).toBeLessThanOrEqual(12);
  await page.getByRole("button", { name: "最大化输入框" }).click();
  const expandedComposer = page.locator(".composer-wrap-maximized");
  await expect(expandedComposer).toBeVisible();
  const expandedPanelBox = await expandedComposer.boundingBox();
  const expandedComposerBox = await composerShell.boundingBox();
  expect(expandedPanelBox!.height).toBeGreaterThanOrEqual(viewport.height * .48);
  expect(expandedPanelBox!.height).toBeLessThanOrEqual(viewport.height * .54);
  expect(expandedPanelBox!.y).toBeGreaterThan(viewport.height * .4);
  expect(expandedComposerBox!.x).toBeLessThanOrEqual(6);
  expect(
    viewport.width - expandedComposerBox!.x - expandedComposerBox!.width,
  ).toBeLessThanOrEqual(6);
  await page.getByRole("button", { name: "还原输入框" }).click();
  await expect(expandedComposer).toHaveCount(0);

  await previousMessages.click();
  await expect(previousMessages).toHaveAttribute("aria-expanded", "false");
  await expect(previousChevron).toHaveClass(/direction-right/);
  await expect(page.getByRole("img", { name: "ai.png" })).toHaveCount(0);
  await expect(page.locator(".assistant-message .markdown-body strong"))
    .toHaveText("加粗内容");

  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("继续检查");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("正在检查实时过程。")).toBeVisible();
  await expect(page.getByText("实时任务最终回复")).toBeVisible();
  await expect(page.getByText(/正在运行 1 个命令/)).toBeVisible();
  await expect(previousMessages).toHaveAttribute("aria-expanded", "false");
  const completedLiveMessages = page.getByRole("button", {
    name: /之前的 2 条消息/,
  });
  await expect(completedLiveMessages).toBeVisible();
  await expect(page.getByText("实时任务最终回复")).toBeVisible();
  await expect(page.getByText("正在检查实时过程。")).toHaveCount(0);
  await expect(previousMessages).toHaveAttribute("aria-expanded", "false");

  const detailScrollY = await page
    .locator(".conversation-scroll")
    .evaluate((element) => Math.round(element.scrollTop));
  await page.getByRole("button", { name: "打开会话列表" }).click();
  await expect
    .poll(() =>
      page
        .locator(".conversation-scroll")
        .evaluate((element) => Math.round(element.scrollTop)),
    )
    .toBe(detailScrollY);
  await expect(
    page.getByRole("button", { name: /Markdown 会话/ }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "聊天", exact: true }).click();

  const modelSettingsButton = page.getByRole("button", {
    name: "选择模型、智能与速度",
  });
  await expect(modelSettingsButton).not.toContainText("⚡");
  await modelSettingsButton.click();
  await expect(page.getByText("智能", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /高.*更深入思考/ })).toBeVisible();
  await expect(page.getByText("超高", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /高.*更深入思考/ }).click();

  await page.getByRole("button", { name: "选择模型、智能与速度" }).click();
  await page.getByRole("button", { name: /模型.*GPT-5.6-Terra/ }).click();
  await page.getByRole("button", { name: /GPT-5.6-Terra Priority/ }).click();

  await modelSettingsButton.click();
  await page.getByRole("button", { name: /速度.*正常/ }).click();
  await page.getByRole("button", { name: /快速.*1.5 倍速度/ }).click();
  await expect(modelSettingsButton).toContainText("⚡");

  await page.getByRole("button", { name: "选择审批与权限模式" }).click();
  await expect(page.getByRole("button", { name: /默认权限/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /自动审核/ })).toBeVisible();
  await expect(page.getByText(/自定义/)).toHaveCount(0);
  await page.getByRole("button", { name: /自动审核/ }).click();

  const addAttachment = page.getByRole("button", { name: "添加附件" });
  await addAttachment.click();
  await expect(addAttachment).toHaveAttribute("aria-expanded", "true");
  const attachmentMenu = page.getByRole("menu", { name: "附件菜单" });
  await expect(attachmentMenu).toBeVisible();
  await expect(attachmentMenu.getByRole("menuitem", { name: "图片" })).toBeVisible();
  await expect(attachmentMenu.getByRole("menuitem", { name: "文件" })).toBeVisible();
  await expect(attachmentMenu.getByRole("menuitem", { name: "当前位置" })).toBeVisible();

  const imageInput = page.getByLabel("选择图片", { exact: true });
  const fileInput = page.getByLabel("选择文件", { exact: true });
  await expect(imageInput).toHaveAttribute(
    "accept",
    "image/png,image/jpeg,image/webp,image/gif",
  );
  await expect(fileInput).toHaveAttribute("accept", "*/*");

  await attachmentMenu.getByRole("menuitem", { name: "当前位置" }).click();
  const composerInput = page.getByRole("textbox", { name: "向 Codex 提问" });
  await expect(composerInput).toHaveValue(
    "我的当前位置：[31.230416, 121.473701](https://maps.google.com/?q=31.230416,121.473701)（精度约 12 米）",
  );
  await expect(attachmentMenu).toHaveCount(0);
  await composerInput.fill("");

  await imageInput.setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByRole("img", { name: "待发送 tiny.png" })).toBeVisible();
  const removeImage = page.getByRole("button", { name: "移除 tiny.png" });
  const removeImageBox = await removeImage.boundingBox();
  expect(removeImageBox?.width).toBeGreaterThanOrEqual(44);
  expect(removeImageBox?.height).toBeGreaterThanOrEqual(44);
  await removeImage.click();
  await expect(page.getByRole("img", { name: "待发送 tiny.png" })).toHaveCount(0);
  await imageInput.setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("协议检查");
  await page.getByRole("button", { name: "发送" }).click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__rpcMessages.some(
          (message: any) =>
            message.method === "turn/start" &&
            message.params.threadId === "new-thread",
        ),
      ),
    )
    .toBe(true);
  const sent = await page.evaluate(() => (window as any).__rpcMessages);
  const threadStart = sent.find((message: any) => message.method === "thread/start");
  const turnStart = sent.find(
    (message: any) =>
      message.method === "turn/start" &&
      message.params.threadId === "new-thread",
  );
  expect(threadStart.params).toMatchObject({
    model: "gpt-5.6-terra-priority",
    serviceTier: "priority",
    permissions: ":workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
  });
  expect(threadStart.params).not.toHaveProperty("effort");
  expect(turnStart.params).toMatchObject({
    model: "gpt-5.6-terra-priority",
    effort: "high",
    serviceTier: "priority",
    permissions: ":workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
  });
  expect(turnStart.params.input).toEqual([
    {
      type: "text",
      text: `协议检查\n\n${CONVERSATION_TITLE_REQUEST}`,
      text_elements: [],
    },
    {
      type: "image",
      url: expect.stringMatching(/^data:image\/png;base64,/),
    },
  ]);
  await expect(page.locator(".thread-heading strong")).toHaveText(
    "移动端协议检查",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__rpcMessages.filter(
          (message: any) => message.method === "thread/name/set",
        ),
      ),
    )
    .toEqual([
      expect.objectContaining({
        params: {
          threadId: "new-thread",
          name: "移动端协议检查",
        },
      }),
    ]);
  await expect(page.getByText(/conversation-title/)).toHaveCount(0);
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
});

test("多设备同时连接、切换、缓存并路由后台审批", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("codex-mobile.backend-registry.v1")) {
      localStorage.setItem(
        "codex-mobile.backend-registry.v1",
        JSON.stringify({
        version: 1,
        selectedBackendId: "mini",
        backends: [
          {
            id: "mini",
            name: "Mac mini",
            baseUrl: "http://mini.test:4173",
            token: "mini-token",
            enabled: true,
            order: 0,
          },
          {
            id: "macbook",
            name: "MacBook",
            baseUrl: "http://macbook.test:4173",
            token: "macbook-token",
            enabled: true,
            order: 1,
          },
        ],
        }),
      );
    }
    (window as any).__backendMessages = [];
    (window as any).__backendSockets = [];
    (window as any).__backendSocketInstances = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (url.hostname.endsWith(".test") && url.pathname === "/api/host") {
        const hostId = url.hostname.replace(".test", "");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              hostId,
              displayName: hostId,
              hostname: url.hostname,
              gatewayVersion: "0.2.0",
              appServerReady: true,
              httpPolling: true,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      return nativeFetch(input, init);
    }) as typeof window.fetch;
    class MultiBackendSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;
      host: string;

      constructor(rawUrl: string) {
        super();
        this.host = new URL(rawUrl).hostname;
        (window as any).__backendSockets.push(this.host);
        (window as any).__backendSocketInstances.push(this);
        setTimeout(() => {
          this.readyState = MultiBackendSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        (window as any).__backendMessages.push({
          host: this.host,
          message: request,
        });
        if (request.id == null) return;
        const prefix = this.host === "mini.test" ? "Mini" : "MacBook";
        const responses: Record<string, unknown> = {
          initialize: {
            userAgent: `${prefix}-mock`,
            codexHome: "/tmp/codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
          "model/list": {
            data: [
              {
                id: "default",
                model: "gpt-test",
                displayName: "GPT Test",
                isDefault: true,
                supportedReasoningEfforts: [],
                serviceTiers: [],
              },
            ],
          },
          "permissionProfile/list": {
            data: [{ id: ":workspace", allowed: true }],
          },
          "config/read": {
            config: {
              model: "gpt-test",
              sandbox_mode: "workspace-write",
            },
          },
          "thread/list": {
            data: [
              {
                id: `${prefix.toLowerCase()}-thread`,
                preview: `${prefix} 任务`,
                updatedAt: Math.floor(Date.now() / 1000),
                status:
                  this.host === "mini.test"
                    ? { type: "active", activeFlags: ["waitingOnApproval"] }
                    : { type: "idle" },
              },
            ],
          },
        };
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                id: request.id,
                result: responses[request.method] ?? {},
              }),
            }),
          );
        }, 0);
        if (
          this.host === "macbook.test" &&
          request.method === "thread/list"
        ) {
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  id: "approval-1",
                  method: "item/commandExecution/requestApproval",
                  params: { command: "npm test" },
                }),
              }),
            );
          }, 80);
        }
      }

      close() {
        this.readyState = MultiBackendSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    (window as any).WebSocket = MultiBackendSocket;
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /Mini 任务.*进行中/ }))
    .toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => new Set((window as any).__backendSockets).size,
      ),
    )
    .toBe(2);
  await expect(page.getByRole("button", { name: /Mini 任务/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "MacBook 有 1 个待审批" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "MacBook 有 1 个待审批" }).click();
  await expect(page.getByRole("button", { name: /MacBook.*1 个待审批/ }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /MacBook 任务/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "允许运行此操作？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "允许", exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const responses = (window as any).__backendMessages.filter(
          (entry: any) => entry.message.id === "approval-1",
        );
        return responses.map((entry: any) => entry.host);
      }),
    )
    .toEqual(["macbook.test"]);

  await page.getByRole("button", { name: "管理设备", exact: true }).click();
  await page.getByRole("button", { name: "添加设备" }).click();
  await page.getByLabel("设备名称").fill("Studio Mac");
  await page
    .getByLabel("网关地址")
    .fill("http://studio.test:4173/?token=studio-token");
  await page.getByRole("button", { name: "测试并保存" }).click();
  await expect(page.getByRole("heading", { name: "管理设备" })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("button", { name: /Studio Mac.*已连接/ }))
    .toBeVisible();

  await page.evaluate(() => {
    const miniSocket = (window as any).__backendSocketInstances.find(
      (socket: any) =>
        socket.host === "mini.test" &&
        socket.readyState === (window as any).WebSocket.OPEN,
    );
    miniSocket.close();
  });
  await expect(page.getByRole("button", { name: /MacBook 任务/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /MacBook.*已连接/ }))
    .toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__backendSockets.filter(
            (host: string) => host === "mini.test",
          ).length,
      ),
    )
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: /Mac mini.*已连接/ }).click();
  await expect(page.getByRole("button", { name: /Mini 任务/ })).toBeVisible();
  await page.getByRole("button", { name: /MacBook.*已连接/ }).click();

  await page.reload();
  await expect(page.getByRole("button", { name: /MacBook 任务/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /MacBook.*已连接/ }))
    .toHaveAttribute("aria-pressed", "true");
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
});

liveTest("移动端可连接真实 app-server 并校验新聊天目标", async ({ page }) => {
  liveTest.setTimeout(130_000);
  await page.addInitScript(() => localStorage.setItem("codex-mobile:language", "zh-CN"));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Codex Mobile" }),
  ).toBeVisible();
  await expect(page.getByText("已连接", { exact: false })).toBeVisible();
  await expect(page.getByPlaceholder("搜索聊天")).toBeVisible();

  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "向 Codex 提问" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "选择审批与权限模式" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "选择机器" })).toBeVisible();
  await expect(page.getByRole("option", { name: "无项目" })).toBeAttached();
  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill(
    "只回复 E2E_OK，不要调用任何工具。",
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("E2E_OK", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
});

test("多个协议 turn 在同一用户任务中只显示一个统一折叠区", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class SplitTurnSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;

      constructor() {
        super();
        setTimeout(() => {
          this.readyState = SplitTurnSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        if (request.id == null) return;
        const responses: Record<string, unknown> = {
          initialize: {},
          "model/list": {
            data: [
              {
                model: "gpt-test",
                displayName: "GPT Test",
                isDefault: true,
                supportedReasoningEfforts: [],
                serviceTiers: [],
              },
            ],
          },
          "permissionProfile/list": {
            data: [{ id: ":workspace", allowed: true }],
          },
          "config/read": { config: { sandbox_mode: "workspace-write" } },
          "thread/list": {
            data: [
              {
                id: "split-thread",
                preview: "拆分协议回合",
                updatedAt: Math.floor(Date.now() / 1000),
                status: { type: "idle" },
              },
            ],
          },
          "thread/resume": {
            thread: {
              id: "split-thread",
              preview: "拆分协议回合",
              turns: [
                {
                  id: "turn-user",
                  status: "completed",
                  items: [
                    {
                      id: "u1",
                      type: "userMessage",
                      text: "检查并修复",
                    },
                    {
                      id: "a1",
                      type: "agentMessage",
                      text: "开始检查",
                    },
                  ],
                },
                {
                  id: "turn-process",
                  status: "completed",
                  items: [
                    {
                      id: "r1",
                      type: "reasoning",
                      text: "分析问题",
                    },
                    {
                      id: "c1",
                      type: "commandExecution",
                      status: "completed",
                      command: "npm test",
                    },
                  ],
                },
                {
                  id: "turn-final",
                  status: "completed",
                  items: [
                    {
                      id: "a2",
                      type: "agentMessage",
                      phase: "final_answer",
                      text: "修复完成",
                    },
                  ],
                },
                {
                  id: "turn-next-user",
                  status: "completed",
                  items: [
                    {
                      id: "u2",
                      type: "userMessage",
                      text: "继续确认",
                    },
                    {
                      id: "a3",
                      type: "agentMessage",
                      phase: "final_answer",
                      text: "确认完成",
                    },
                  ],
                },
              ],
            },
          },
        };
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                id: request.id,
                result: responses[request.method] ?? {},
              }),
            }),
          );
        }, 0);
      }

      close() {
        this.readyState = SplitTurnSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    (window as any).WebSocket = SplitTurnSocket;
  });

  await page.goto("/");
  await page.getByRole("button", { name: /拆分协议回合/ }).click();

  const previousMessages = page.getByRole("button", {
    name: "之前的 3 条消息",
  });
  await expect(previousMessages).toHaveCount(1);
  await expect(page.getByRole("button", { name: /之前的 \d+ 条消息/ }))
    .toHaveCount(1);
  await expect(page.getByText("修复完成", { exact: true })).toBeVisible();
  await expect(page.getByText("确认完成", { exact: true })).toBeVisible();
  await expect(page.getByText("开始检查", { exact: true })).toHaveCount(0);
  await expect(page.getByText("分析问题", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Codex 回合", { exact: true })).toHaveCount(0);

  await previousMessages.click();
  await expect(page.getByText("开始检查", { exact: true })).toBeVisible();
  await expect(page.getByText("分析问题", { exact: true })).toBeVisible();
});

test("新会话启动期间返回列表不会被迟到响应重新拉回且任务保持进行中", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    const now = Math.floor(Date.now() / 1000);
    class DelayedStartSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;

      constructor() {
        super();
        setTimeout(() => {
          this.readyState = DelayedStartSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        if (request.id == null) return;
        const responses: Record<string, unknown> = {
          initialize: {},
          "model/list": {
            data: [
              {
                model: "gpt-test",
                displayName: "GPT Test",
                isDefault: true,
                supportedReasoningEfforts: [],
                serviceTiers: [],
              },
            ],
          },
          "permissionProfile/list": {
            data: [
              { id: ":workspace", allowed: true },
              { id: ":danger-full-access", allowed: true },
            ],
          },
          "config/read": { config: { sandbox_mode: "workspace-write" } },
          "thread/list": {
            data: [
              {
                id: "existing",
                preview: "已有会话",
                cwd: "/tmp/project",
                updatedAt: now,
                status: { type: "idle" },
              },
            ],
          },
          "thread/start": {
            thread: {
              id: "delayed-thread",
              preview: "延迟启动的任务",
              cwd: "/tmp/project",
              updatedAt: now + 1,
              turns: [],
            },
          },
          "turn/start": {
            turn: {
              id: "delayed-turn",
              status: "inProgress",
              items: [],
            },
          },
        };
        const delay = request.method === "thread/start" ? 180 : 0;
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                id: request.id,
                result: responses[request.method] ?? {},
              }),
            }),
          );
        }, delay);
        if (request.method === "turn/start") {
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  method: "turn/started",
                  params: {
                    threadId: "delayed-thread",
                    turn: {
                      id: "delayed-turn",
                      status: "inProgress",
                      items: [],
                    },
                  },
                }),
              }),
            );
          }, 20);
        }
      }

      close() {
        this.readyState = DelayedStartSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    (window as any).WebSocket = DelayedStartSocket;
  });

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "已有会话" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("开始任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "打开会话列表" }).click();

  await expect(page.getByPlaceholder("搜索聊天")).toBeVisible();
  const delayedThread = page.getByRole("button", {
    name: /延迟启动的任务.*进行中/,
  });
  await expect(delayedThread).toBeVisible();
  await page.waitForTimeout(250);
  await expect(page.getByPlaceholder("搜索聊天")).toBeVisible();
  await expect(delayedThread).toBeVisible();

  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("并行新任务");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "选择审批与权限模式" }),
  ).toContainText("完全访问权限");
});

test("点击会话立即进入详情，失败后可以在骨架屏中重试", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class DelayedResumeSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;
      resumeCount = 0;

      constructor() {
        super();
        setTimeout(() => {
          this.readyState = DelayedResumeSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        if (request.id == null) return;
        const responses: Record<string, unknown> = {
          initialize: {},
          "model/list": {
            data: [
              {
                model: "gpt-test",
                displayName: "GPT Test",
                isDefault: true,
                supportedReasoningEfforts: [],
                serviceTiers: [],
              },
            ],
          },
          "permissionProfile/list": {
            data: [{ id: ":workspace", allowed: true }],
          },
          "config/read": { config: { sandbox_mode: "workspace-write" } },
          "thread/list": {
            data: [
              {
                id: "retry-thread",
                preview: "失败后可重试",
                cwd: "/tmp/retry-project",
                updatedAt: Math.floor(Date.now() / 1000),
                status: { type: "idle" },
              },
            ],
          },
        };

        if (request.method === "thread/resume") {
          this.resumeCount += 1;
          const attempt = this.resumeCount;
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify(
                  attempt === 1
                    ? {
                        id: request.id,
                        error: { code: -32000, message: "会话读取失败" },
                      }
                    : {
                        id: request.id,
                        result: {
                          thread: {
                            id: "retry-thread",
                            preview: "失败后可重试",
                            cwd: "/tmp/retry-project",
                            turns: [
                              {
                                id: "retry-turn",
                                status: "completed",
                                items: [
                                  {
                                    id: "retry-user",
                                    type: "userMessage",
                                    text: "重新读取",
                                  },
                                  {
                                    id: "retry-agent",
                                    type: "agentMessage",
                                    phase: "final_answer",
                                    text: "重试成功",
                                  },
                                ],
                              },
                            ],
                          },
                        },
                      },
                ),
              }),
            );
          }, 180);
          return;
        }

        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                id: request.id,
                result: responses[request.method] ?? {},
              }),
            }),
          );
        }, 0);
      }

      close() {
        this.readyState = DelayedResumeSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    (window as any).WebSocket = DelayedResumeSocket;
  });

  await page.goto("/");
  await page.getByRole("button", { name: /失败后可重试/ }).click();

  await expect(
    page.getByRole("strong").filter({ hasText: "失败后可重试" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "正在加载会话详情" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "向 Codex 提问" }))
    .toBeDisabled();

  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(
    page.getByRole("status", { name: "正在加载会话详情" }),
  ).toBeVisible();
  await expect(page.getByText("重试成功", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status", { name: "正在加载会话详情" }),
  ).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "向 Codex 提问" }))
    .toBeEnabled();
});

test("会话加载中返回并打开其他会话后忽略旧详情响应", async ({ page }) => {
  await page.addInitScript(() => {
    class CancelResumeSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;

      constructor() {
        super();
        setTimeout(() => {
          this.readyState = CancelResumeSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        if (request.id == null) return;
        const responses: Record<string, unknown> = {
          initialize: {},
          "model/list": {
            data: [
              {
                model: "gpt-test",
                displayName: "GPT Test",
                isDefault: true,
                supportedReasoningEfforts: [],
                serviceTiers: [],
              },
            ],
          },
          "permissionProfile/list": {
            data: [{ id: ":workspace", allowed: true }],
          },
          "config/read": { config: { sandbox_mode: "workspace-write" } },
          "thread/list": {
            data: [
              {
                id: "cancel-thread",
                preview: "可取消加载",
                updatedAt: Math.floor(Date.now() / 1000),
                status: { type: "idle" },
              },
              {
                id: "next-thread",
                preview: "新的目标会话",
                updatedAt: Math.floor(Date.now() / 1000) - 1,
                status: { type: "idle" },
              },
            ],
          },
        };
        const isResume = request.method === "thread/resume";
        const isCancelledThread =
          isResume && request.params.threadId === "cancel-thread";
        const result = isResume
          ? {
              thread: {
                id: isCancelledThread ? "cancel-thread" : "next-thread",
                preview: isCancelledThread ? "可取消加载" : "新的目标会话",
                turns: [
                  {
                    id: isCancelledThread ? "late-turn" : "next-turn",
                    status: "completed",
                    items: [
                      {
                        id: isCancelledThread ? "late-agent" : "next-agent",
                        type: "agentMessage",
                        phase: "final_answer",
                        text: isCancelledThread ? "不应重新出现" : "正确的新内容",
                      },
                    ],
                  },
                ],
              },
            }
          : responses[request.method] ?? {};
        const delay = isCancelledThread ? 240 : isResume ? 60 : 0;
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                id: request.id,
                result,
              }),
            }),
          );
        }, delay);
      }

      close() {
        this.readyState = CancelResumeSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    (window as any).WebSocket = CancelResumeSocket;
  });

  await page.goto("/");
  await page.getByRole("button", { name: /可取消加载/ }).click();
  await expect(
    page.getByRole("status", { name: "正在加载会话详情" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "打开会话列表" }).click();
  await expect(page.getByPlaceholder("搜索聊天")).toBeVisible();
  await expect(page.getByRole("button", { name: /可取消加载/ }))
    .toBeEnabled();
  await page.getByRole("button", { name: /新的目标会话/ }).click();
  await expect(
    page.getByRole("status", { name: "正在加载会话详情" }),
  ).toBeVisible();
  await expect(page.getByText("正确的新内容", { exact: true })).toBeVisible();
  await page.waitForTimeout(320);
  await expect(page.locator(".thread-heading strong"))
    .toHaveText("新的目标会话");
  await expect(page.getByText("正确的新内容", { exact: true })).toBeVisible();
  await expect(page.getByText("不应重新出现", { exact: true })).toHaveCount(0);
});

test("排队消息可编辑取消、跨会话保留并同步服务端标题", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    (window as any).__followUpRequests = [];
    class FollowUpSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;

      constructor() {
        super();
        (window as any).__completeRunningTurn = () => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                method: "turn/completed",
                params: {
                  threadId: "running-thread",
                  turn: {
                    id: "running-turn",
                    status: "completed",
                    items: [
                      {
                        id: "running-final",
                        type: "agentMessage",
                        phase: "final_answer",
                        text: "当前任务完成",
                      },
                    ],
                  },
                },
              }),
            }),
          );
        };
        (window as any).__renameRunningThread = (threadName: string | null) => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                method: "thread/name/updated",
                params: { threadId: "running-thread", threadName },
              }),
            }),
          );
        };
        setTimeout(() => {
          this.readyState = FollowUpSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        if (["turn/start", "turn/steer"].includes(request.method)) {
          (window as any).__followUpRequests.push(request);
        }
        if (request.id == null) return;
        const resumedThread = request.params?.threadId === "other-thread"
          ? {
              thread: {
                id: "other-thread",
                preview: "其他会话",
                cwd: "/tmp/project",
                turns: [],
              },
            }
          : {
              thread: {
                id: "running-thread",
                preview: "追加消息队列",
                cwd: "/tmp/project",
                turns: [
                  {
                    id: "running-turn",
                    status: "inProgress",
                    items: [
                      {
                        id: "running-user",
                        type: "userMessage",
                        text: "执行当前任务",
                      },
                    ],
                  },
                ],
              },
            };
        const responses: Record<string, unknown> = {
          initialize: {},
          "model/list": {
            data: [
              {
                model: "gpt-test",
                displayName: "GPT Test",
                isDefault: true,
                supportedReasoningEfforts: [],
                serviceTiers: [],
              },
            ],
          },
          "permissionProfile/list": {
            data: [{ id: ":workspace", allowed: true }],
          },
          "config/read": { config: { sandbox_mode: "workspace-write" } },
          "thread/list": {
            data: [
              {
                id: "running-thread",
                preview: "追加消息队列",
                cwd: "/tmp/project",
                updatedAt: Math.floor(Date.now() / 1000),
                status: { type: "active", activeFlags: [] },
              },
              {
                id: "other-thread",
                preview: "其他会话",
                cwd: "/tmp/project",
                updatedAt: Math.floor(Date.now() / 1000) - 1,
                status: { type: "idle", activeFlags: [] },
              },
            ],
          },
          "thread/resume": resumedThread,
          "turn/start": {
            turn: {
              id: "queued-turn",
              status: "inProgress",
              items: [],
            },
          },
          "turn/steer": { turnId: "queued-turn" },
        };
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                id: request.id,
                result: responses[request.method] ?? {},
              }),
            }),
          );
        }, 0);
      }

      close() {
        this.readyState = FollowUpSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    (window as any).WebSocket = FollowUpSocket;
  });

  await page.goto("/");
  await page.getByRole("button", { name: /追加消息队列/ }).first().click();
  const composer = page.getByRole("textbox", { name: "向 Codex 提问" });
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();

  await composer.fill("等当前任务完成后继续");
  await page.getByRole("button", { name: "排队" }).click();
  await expect(page.getByRole("status", { name: "排队消息" }))
    .toContainText("等当前任务完成后继续");
  expect(
    await page.evaluate(() => (window as any).__followUpRequests),
  ).toEqual([]);

  await page.getByRole("button", { name: "打开会话列表" }).click();
  await page.getByRole("button", { name: /其他会话/ }).first().click();
  await expect(page.getByRole("status", { name: "排队消息" })).toHaveCount(0);
  await page.getByRole("button", { name: "打开会话列表" }).click();
  await page.getByRole("button", { name: /追加消息队列/ }).first().click();
  await expect(page.getByRole("status", { name: "排队消息" }))
    .toContainText("等当前任务完成后继续");

  await page.getByRole("button", { name: "编辑排队消息" }).click();
  await page.getByRole("textbox", { name: "编辑排队消息内容" })
    .fill("修改后的排队内容");
  await page.getByRole("button", { name: "保存排队消息" }).click();
  await expect(page.getByRole("status", { name: "排队消息" }))
    .toContainText("修改后的排队内容");

  await page.evaluate(() =>
    (window as any).__renameRunningThread("服务端实时名称")
  );
  await expect(page.locator(".thread-heading strong"))
    .toHaveText("服务端实时名称");
  await page.getByRole("button", { name: "打开会话列表" }).click();
  await expect(page.getByRole("button", { name: /服务端实时名称/ }).first())
    .toBeVisible();
  await page.getByRole("button", { name: /服务端实时名称/ }).first().click();

  await page.evaluate(() => (window as any).__completeRunningTurn());
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__followUpRequests.filter(
          (request: any) => request.method === "turn/start",
        ),
      ),
    )
    .toHaveLength(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__followUpRequests.find(
          (request: any) => request.method === "turn/start",
        )?.params.input,
      ),
    )
    .toEqual([
      { type: "text", text: "修改后的排队内容", text_elements: [] },
    ]);
  await expect(page.getByRole("status", { name: "排队消息" }))
    .toHaveCount(0);

  await composer.fill("这条消息将取消");
  await page.getByRole("button", { name: "排队" }).click();
  await page.getByRole("button", { name: "取消排队消息" }).click();
  await expect(page.getByRole("status", { name: "排队消息" }))
    .toHaveCount(0);

  await composer.fill("立即调整执行方向");
  await page.getByRole("button", { name: "排队" }).click();
  await page.getByRole("button", { name: "改为引导" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__followUpRequests.find(
          (request: any) => request.method === "turn/steer",
        )?.params.input,
      ),
    )
    .toEqual([
      { type: "text", text: "立即调整执行方向", text_elements: [] },
    ]);
});

test("查看旧会话后刷新列表和搜索保持排序，新任务正常前移", async ({ page }) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    const history = { id: "viewed-history", preview: "任务旧会话", cwd: "/tmp/project", recencyAt: 10, updatedAt: 10, status: { type: "idle" }, turns: [] };
    const recent = { ...history, id: "recent-task", preview: "任务新会话", recencyAt: 20, updatedAt: 20 };
    (window as any).__recencyHistory = history;
    (window as any).__recencyRequests = [];
    class RecencySocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;
      constructor() {
        super();
        setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }, 0);
      }
      send(raw: string) {
        const request = JSON.parse(raw);
        (window as any).__recencyRequests.push(request);
        if (request.id == null) return;
        if (request.method === "thread/resume") history.updatedAt = 100;
        const responses: Record<string, unknown> = {
          initialize: {},
          "model/list": { data: [] },
          "config/read": { config: {} },
          "permissionProfile/list": { data: [] },
          "thread/list": { data: [history, recent], nextCursor: null },
          "thread/search": { data: [history, recent].map((thread) => ({ thread, snippet: thread.preview })), nextCursor: null },
          "thread/resume": { thread: history, initialTurnsPage: { data: [], nextCursor: null } },
          "thread/turns/list": { data: [], nextCursor: null },
        };
        const result = JSON.stringify({ id: request.id, result: responses[request.method] ?? {} });
        setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: result })), 0);
      }
      close() { this.readyState = 3; this.dispatchEvent(new CloseEvent("close")); }
    }
    (window as any).WebSocket = RecencySocket;
  });
  await page.goto("/");
  const rows = page.locator(".thread-row-title");
  await expect(rows).toHaveText(["任务新会话", "任务旧会话"]);
  await page.getByRole("button", { name: /任务旧会话/ }).click();
  await expect(page.locator(".thread-heading strong")).toHaveText("任务旧会话");
  await page.getByRole("button", { name: "打开会话列表" }).click();
  await page.getByRole("button", { name: "刷新会话列表" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__recencyHistory.updatedAt)).toBe(100);
  await expect(rows).toHaveText(["任务新会话", "任务旧会话"]);
  await page.getByPlaceholder("搜索聊天").fill("任务");
  await expect.poll(() => page.evaluate(() => (window as any).__recencyRequests.some((request: any) => request.method === "thread/search"))).toBe(true);
  await expect(rows).toHaveText(["任务新会话", "任务旧会话"]);
  await page.getByPlaceholder("搜索聊天").fill("");
  await page.evaluate(() => { (window as any).__recencyHistory.recencyAt = 30; });
  await page.getByRole("button", { name: "刷新会话列表" }).click();
  await expect(rows).toHaveText(["任务旧会话", "任务新会话"]);
});

test("会话搜索在一个结果列表中展示服务端全文命中", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    (window as any).__searchRequests = [];

    class SearchSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;

      constructor() {
        super();
        setTimeout(() => {
          this.readyState = SearchSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        (window as any).__searchRequests.push(request);
        if (request.id == null) return;
        const now = Math.floor(Date.now() / 1000);
        const responses: Record<string, unknown> = {
          initialize: {
            userAgent: "search-mock",
            codexHome: "/tmp/codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
          "model/list": { data: [] },
          "permissionProfile/list": { data: [] },
          "config/read": { config: {} },
          "account/rateLimits/read": {},
          "skills/list": { data: [] },
          "plugin/list": { data: [] },
          "thread/list": {
            data: [
              {
                id: "ordinary-thread",
                preview: "普通标题",
                cwd: "/tmp/project",
                updatedAt: now,
                status: { type: "idle" },
              },
            ],
            nextCursor: null,
          },
          "thread/search": {
            data: [
              {
                thread: {
                  id: "content-match",
                  preview: "标题没有关键词",
                  cwd: "/tmp/project",
                  updatedAt: now - 1,
                  status: { type: "idle" },
                },
                snippet: "正文里的部署失败需要重新排查",
              },
            ],
            nextCursor: null,
            backwardsCursor: null,
          },
        };
        const delay = request.method === "thread/search" ? 120 : 0;
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                id: request.id,
                result: responses[request.method] ?? {},
              }),
            }),
          );
        }, delay);
      }

      close() {
        this.readyState = SearchSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    (window as any).WebSocket = SearchSocket;
  });

  await page.goto("/");
  const search = page.getByPlaceholder("搜索聊天");
  await expect(search).toBeVisible();
  await search.fill("部署失败");

  await expect(page.getByRole("status", { name: "正在搜索会话" }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: /标题没有关键词/ }))
    .toBeVisible();
  await expect(page.getByText("正文里的部署失败需要重新排查"))
    .toBeVisible();
  await expect(page.getByText("没有匹配的对话")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__searchRequests.find(
          (request: any) => request.method === "thread/search",
        )?.params,
      ),
    )
    .toEqual({
      searchTerm: "部署失败",
      limit: 50,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
});

test("冷启动列表不等待额度查询且用户点入后不会重复恢复", async ({ page }) => {
  await page.route("**/api/projects*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        projects: ["/tmp/fast-project", "/tmp/slow-project"],
        projectlessThreadIds: [],
      }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    (window as any).__coldStartupRequests = [];

    class ColdStartupSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;

      constructor() {
        super();
        setTimeout(() => {
          this.readyState = ColdStartupSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        (window as any).__coldStartupRequests.push(request);
        if (request.id == null) return;
        const turn = {
          id: "cold-turn",
          status: "completed",
          items: [
            { id: "cold-user", type: "userMessage", text: "冷启动问题" },
            {
              id: "cold-agent",
              type: "agentMessage",
              phase: "final_answer",
              text: "冷启动会话已加载",
            },
          ],
        };
        const responses: Record<string, unknown> = {
          initialize: {},
          "model/list": {
            data: [{
              model: "gpt-test",
              displayName: "GPT Test",
              isDefault: true,
              supportedReasoningEfforts: [],
              serviceTiers: [],
            }],
          },
          "permissionProfile/list": {
            data: [{ id: ":workspace", allowed: true }],
          },
          "config/read": { config: { sandbox_mode: "workspace-write" } },
          "account/rateLimits/read": { rateLimits: {} },
          "thread/resume": {
            thread: {
              id: "cold-thread",
              preview: "冷启动长会话",
              cwd: "/tmp/fast-project",
              turns: [],
            },
            initialTurnsPage: { data: [turn], nextCursor: null },
          },
          "skills/list": { data: [] },
          "plugin/installed": { marketplaces: [] },
        };
        let result = responses[request.method] ?? {};
        let delay = request.method === "account/rateLimits/read" ? 1_200 : 0;
        if (request.method === "thread/list") {
          const fast = request.params?.cwd === "/tmp/fast-project";
          result = {
            data: fast
              ? [{
                  id: "cold-thread",
                  preview: "冷启动长会话",
                  cwd: "/tmp/fast-project",
                  updatedAt: Math.floor(Date.now() / 1000),
                  status: { type: "idle" },
                }]
              : [],
            nextCursor: null,
          };
          delay = fast ? 0 : 700;
        }
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ id: request.id, result }),
            }),
          );
        }, delay);
      }

      close() {
        this.readyState = ColdStartupSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    (window as any).WebSocket = ColdStartupSocket;
  });

  await page.goto("/");
  const thread = page.getByRole("button", { name: /冷启动长会话/ });
  await expect(thread).toBeVisible({ timeout: 900 });
  await thread.click();
  await expect(page.getByText("冷启动会话已加载", { exact: true }))
    .toBeVisible();
  await page.waitForTimeout(1_300);

  const resumeCount = await page.evaluate(() =>
    (window as any).__coldStartupRequests.filter(
      (request: any) => request.method === "thread/resume",
    ).length,
  );
  expect(resumeCount).toBe(1);
});
