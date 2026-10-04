import { expect, test } from "@playwright/test";

test("HTTP 提交、执行活动、弱网恢复与审批确认", async ({ page }) => {
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  const thread: any = { id: "http-thread", name: "HTTP 执行会话", preview: "HTTP 执行会话", cwd: "/tmp/project", turns: [], status: { type: "idle" } };
  const messages: any[] = [];
  let cursor = 0;
  let pulls = 0;
  let starts = 0;
  let offline = false;
  let failApproval = false;
  let pending: any[] = [];
  let accepted = 0;
  const append = (method: string, params: any) => messages.push({ cursor: ++cursor, message: { method, params } });
  await page.addInitScript(() => localStorage.setItem("codex-mobile:language", "zh-CN"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (offline && ["/api/events", "/api/rpc", "/api/operations"].includes(url.pathname)) return route.abort("internetdisconnected");
    let body: any = {};
    if (url.pathname === "/api/projects") body = { projects: ["/tmp/project"], projectlessThreadIds: [] };
    if (url.pathname === "/api/host") body = { hostId: "http-host", displayName: "HTTP Host", hostname: "device", gatewayVersion: "0.2.69", appServerReady: true, httpPolling: true };
    if (url.pathname === "/api/operations") return route.fulfill({ status: 404, body: "not found" });
    if (url.pathname === "/api/events") {
      pulls++;
      body = { epoch: "test", cursor, messages: messages.filter((entry) => entry.cursor > Number(url.searchParams.get("after"))).map((entry) => entry.message), requests: pending, active: thread.status.type === "active", updatedAt: Date.now(), reset: false };
    }
    if (url.pathname === "/api/rpc") {
      const { message } = route.request().postDataJSON();
      if (!message.method && message.id === "approval") {
        if (failApproval) return route.fulfill({ status: 503, body: "unavailable" });
        accepted++;
        pending = [];
        thread.status = { type: "active" };
        body = { id: message.id, result: null };
      } else {
        const responses: Record<string, any> = {
          initialize: {},
          "model/list": { data: [{ id: "gpt-test", model: "gpt-test", displayName: "GPT Test", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "平衡" }], serviceTiers: [] }] },
          "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] },
          "config/read": { config: { model: "gpt-test", sandbox_mode: "workspace-write" } },
          "thread/list": { data: [thread], nextCursor: null },
          "thread/resume": { thread, initialTurnsPage: { data: thread.turns, nextCursor: null }, model: "gpt-test", reasoningEffort: "medium", approvalPolicy: "on-request", approvalsReviewer: "user", activePermissionProfile: { id: ":workspace" } },
          "thread/turns/list": { data: thread.turns, nextCursor: null },
        };
        if (message.method === "turn/start") {
          starts++;
          const turn = { id: "http-turn", status: "inProgress", items: [] };
          thread.turns = [turn];
          thread.status = { type: "active" };
          append("turn/started", { threadId: thread.id, turn });
          append("item/started", { threadId: thread.id, turnId: turn.id, item: { id: "command", type: "commandExecution", command: "npm test", status: "inProgress", aggregatedOutput: "Tests running" } });
          append("turn/plan/updated", { threadId: thread.id, turnId: turn.id, plan: [{ step: "运行验证", status: "inProgress" }] });
          responses["turn/start"] = { turn };
        }
        body = { ...(message.id == null ? {} : { id: message.id }), result: responses[message.method] ?? {} };
      }
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /HTTP 执行会话/ }).first().click();
  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("执行任务");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".run-progress")).toContainText("正在执行命令");
  await expect(page.locator(".run-progress")).toContainText("运行验证");
  expect(starts).toBe(1);
  expect(sockets).toHaveLength(0);
  await page.screenshot({ path: "test-results/http-progress.png" });
  offline = true;
  await expect(page.locator(".run-progress")).toContainText("连接暂时不可用", { timeout: 10_000 });
  await expect(page.locator(".run-progress")).toContainText("npm test");
  offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".run-progress")).not.toContainText("连接暂时不可用");
  pending = [{ id: "approval", method: "item/commandExecution/requestApproval", params: { threadId: thread.id, turnId: "http-turn", command: "npm test" } }];
  failApproval = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByRole("button", { name: "允许", exact: true }).click();
  await expect(page.getByRole("button", { name: "允许", exact: true })).toBeEnabled({ timeout: 10_000 });
  expect(accepted).toBe(0);
  failApproval = false;
  await page.getByRole("button", { name: "允许", exact: true }).click();
  await expect(page.getByRole("button", { name: "允许", exact: true })).toHaveCount(0);
  expect(accepted).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  const previousPulls = pulls;
  await page.waitForTimeout(3_200);
  expect(pulls).toBe(previousPulls);
  const finished = { id: "http-turn", status: "completed", items: [{ id: "reply", type: "agentMessage", text: "任务验证已完成" }] };
  thread.turns = [finished]; thread.status = { type: "idle" };
  append("item/completed", { threadId: thread.id, turnId: finished.id, item: { id: "reply", type: "agentMessage", text: "[truncated]" } });
  append("turn/completed", { threadId: thread.id, turn: { ...finished, items: [] } });
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByText("任务验证已完成", { exact: true })).toBeVisible();
  await expect(page.locator(".run-progress")).toHaveCount(0);
  expect(starts).toBe(1);
});
