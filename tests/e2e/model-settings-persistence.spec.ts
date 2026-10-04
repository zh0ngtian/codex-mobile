import { expect, test } from "@playwright/test";

test("新对话偏好跨冷启动恢复，线程设置即时写回且正常速度显式清除 Fast", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__modelSettingsRpc = [];

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
        (window as any).__modelSettingsRpc.push(request);
        if (request.id == null) return;

        const responses: Record<string, unknown> = {
          initialize: {
            userAgent: "mock-app-server",
            codexHome: "/tmp/codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
          "model/list": {
            data: [
              {
                id: "default",
                model: "gpt-default",
                displayName: "GPT-Default",
                isDefault: true,
                defaultReasoningEffort: "medium",
                supportedReasoningEfforts: [
                  { reasoningEffort: "medium", description: "平衡" },
                ],
                defaultServiceTier: null,
                serviceTiers: [],
              },
              {
                id: "model-a",
                model: "gpt-model-a",
                displayName: "GPT-Model-A",
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
                    description: "1.5 倍速度",
                  },
                ],
              },
            ],
          },
          "permissionProfile/list": {
            data: [{ id: ":workspace", description: "Workspace", allowed: true }],
          },
          "config/read": {
            config: {
              model: "gpt-default",
              model_reasoning_effort: "medium",
              service_tier: null,
              sandbox_mode: "workspace-write",
              approval_policy: "on-request",
              approvals_reviewer: "user",
            },
          },
          "thread/list": { data: [] },
          "thread/start": {
            thread: {
              id: "new-thread",
              preview: "新对话",
              cwd: null,
              turns: [],
            },
            model: "gpt-model-a",
            reasoningEffort: "high",
            serviceTier: request.params?.serviceTier ?? null,
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            activePermissionProfile: { id: ":workspace" },
          },
          "turn/start": {
            turn: { id: "turn-1", status: "inProgress", items: [] },
          },
          "thread/settings/update": {},
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
                  method: "turn/completed",
                  params: {
                    threadId: request.params.threadId,
                    turn: { id: "turn-1", status: "completed", items: [] },
                  },
                }),
              }),
            );
          }, 20);
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
  await page.getByRole("button", { name: "聊天", exact: true }).click();

  const modelSettings = page.getByRole("button", {
    name: "选择模型、智能与速度",
  });
  await modelSettings.click();
  await page.getByRole("button", { name: /模型.*GPT-Default/ }).click();
  await page.getByRole("button", { name: /GPT-Model-A/ }).click();
  await modelSettings.click();
  await page.getByRole("button", { name: /速度.*正常/ }).click();
  await page.getByRole("button", { name: /快速.*1.5 倍速度/ }).click();

  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("检查设置");
  await page.getByRole("button", { name: "发送" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__modelSettingsRpc.some(
          (message: any) => message.method === "turn/start",
        ),
      ),
    )
    .toBe(true);

  await modelSettings.click();
  await page.getByRole("button", { name: /速度.*快速/ }).click();
  await page.getByRole("button", { name: /正常.*默认速度/ }).click();
  await modelSettings.click();
  await page.getByRole("button", { name: /低.*更快响应/ }).click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__modelSettingsRpc
          .filter(
            (message: any) => message.method === "thread/settings/update",
          )
          .map((message: any) => message.params),
      ),
    )
    .toEqual([
      { threadId: "new-thread", serviceTier: null },
      { threadId: "new-thread", effort: "low" },
    ]);

  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  const restoredModelSettings = page.getByRole("button", {
    name: "选择模型、智能与速度",
  });
  await expect(restoredModelSettings).toContainText("GPT-Model-A");
  await expect(restoredModelSettings).toContainText("高");
  await expect(restoredModelSettings).toContainText("⚡");

  await restoredModelSettings.click();
  await page.getByRole("button", { name: /速度.*快速/ }).click();
  await page.getByRole("button", { name: /正常.*默认速度/ }).click();
  await restoredModelSettings.click();
  await page.getByRole("button", { name: /低.*更快响应/ }).click();
  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("检查正常速度");
  await page.getByRole("button", { name: "发送" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const messages = (window as any).__modelSettingsRpc;
        return {
          threadStart: messages.find(
            (message: any) => message.method === "thread/start",
          )?.params.serviceTier,
          turnStart: messages.find(
            (message: any) => message.method === "turn/start",
          )?.params.serviceTier,
        };
      }),
    )
    .toEqual({ threadStart: null, turnStart: null });

  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  const restoredNormalSettings = page.getByRole("button", {
    name: "选择模型、智能与速度",
  });
  await expect(restoredNormalSettings).toContainText("GPT-Model-A");
  await expect(restoredNormalSettings).toContainText("低");
  await expect(restoredNormalSettings).not.toContainText("⚡");
});
