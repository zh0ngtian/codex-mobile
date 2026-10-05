import { expect, test } from "@playwright/test";

for (const scenario of ["turn-success", "turn-error", "thread-start", "approval", "steer"] as const) {
test(`ACK 丢失后自动确认原发送并保留输入：${scenario}`, async ({ page }) => {
  const thread: any = { id: "ack-thread", name: "ACK 会话", cwd: "/tmp/project", turns: [], status: { type: "idle" } };
  if (scenario === "steer") { thread.status = { type: "active" }; thread.turns = [{ id: "accepted-turn", status: "inProgress", items: [] }]; }
  let accepted: any;
  let starts = 0;
  let offline = false;
  let approvalReady = false;
  const queryIds: string[] = [];
  const uploadedNames: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    (window as any).__fileUrls = [];
    (window as any).__revokedUrls = [];
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof File) (window as any).__fileUrls.push({ name: blob.name, url });
      return url;
    };
    URL.revokeObjectURL = (url) => { (window as any).__revokedUrls.push(url); revoke(url); };
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (offline && ["/api/rpc", "/api/events", "/api/operations"].includes(url.pathname)) return route.abort("internetdisconnected");
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: ["/tmp/project"], projectlessThreadIds: [] } });
    if (url.pathname === "/api/host") return route.fulfill({ json: { hostId: "ack-host", gatewayVersion: "0.2.69", appServerReady: true, httpPolling: true } });
    if (url.pathname === "/api/uploads/file") {
      const name = decodeURIComponent(route.request().headers()["x-codex-file-name"]);
      uploadedNames.push(name);
      return route.fulfill({ json: { name, path: `/tmp/${name}`, type: "text/plain", size: 3 } });
    }
    if (url.pathname === "/api/events") return route.fulfill({ json: { epoch: "ack", cursor: 0, messages: [], requests: scenario === "approval" && approvalReady ? [{ id: "approval-lost", method: "item/commandExecution/requestApproval", params: { threadId: thread.id, command: "npm test" } }] : [], active: false, updatedAt: Date.now(), reset: false } });
    if (url.pathname === "/api/operations") {
      queryIds.push(url.searchParams.get("requestId")!);
      const message = scenario === "turn-error" ? { error: { code: -1, message: "明确发送失败" } }
        : scenario === "thread-start" ? { result: { thread } }
        : scenario === "approval" ? { result: null }
        : { result: { turn: { id: "accepted-turn", status: "inProgress", items: [] } } };
      return route.fulfill({ json: { status: "completed", message } });
    }
    if (url.pathname !== "/api/rpc") return route.continue();
    const operation = route.request().postDataJSON();
    const { message } = operation;
    if (message.method === "thread/resume") approvalReady = true;
    if (message.method === (scenario === "thread-start" ? "thread/start" : scenario === "steer" ? "turn/steer" : "turn/start") || message.id === "approval-lost") {
      starts++;
      accepted = operation;
      if (scenario === "turn-error" && starts === 2) return route.fulfill({ json: { id: message.id, error: { code: -1, message: "明确发送失败" } } });
      if (scenario === "turn-success" || scenario === "steer") thread.turns = [{ id: "accepted-turn", status: "completed", itemsView: "summary", items: [
        { id: "user", type: "userMessage", content: [{ type: "text", text: "原始发送" }] },
        { id: "answer", type: "agentMessage", text: "确认后的结果" },
      ] }];
      thread.status = { type: "idle" };
      offline = true;
      return route.abort("internetdisconnected");
    }
    const responses: Record<string, any> = {
      initialize: {},
      "model/list": { data: [{ id: "gpt-test", model: "gpt-test", displayName: "GPT Test", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "平衡" }], serviceTiers: [] }] },
      "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] },
      "config/read": { config: { model: "gpt-test", sandbox_mode: "workspace-write" } },
      "thread/list": { data: [thread], nextCursor: null },
      "thread/resume": { thread, initialTurnsPage: { data: thread.turns, nextCursor: null }, model: "gpt-test", approvalPolicy: "on-request", approvalsReviewer: "user" },
      "thread/turns/list": { data: thread.turns, nextCursor: null },
      "mobile/turns/details": { data: [{ id: "accepted-turn", loadedChangeStats: { additions: 0, deletions: 0 }, items: [{ id: "image", type: "imageView", path: "/tmp/result.png" }] }], nextCursor: null },
      "fs/readFile": { dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=" },
    };
    return route.fulfill({ json: { id: message.id, result: responses[message.method] ?? {} } });
  });
  await page.goto("/");
  if (scenario === "thread-start") await page.getByRole("button", { name: "聊天", exact: true }).click();
  else await page.getByRole("button", { name: /ACK 会话/ }).first().click();
  if (scenario === "approval") await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const input = page.getByRole("textbox", { name: "向 Codex 提问" });
  if (scenario === "turn-error") await page.locator('input[type="file"]').setInputFiles({ name: "old.txt", mimeType: "text/plain", buffer: Buffer.from("old") });
  if (scenario === "approval") await page.getByRole("button", { name: "允许", exact: true }).click();
  else {
    await input.fill("原始发送");
    await page.getByRole("button", { name: scenario === "steer" ? "排队" : "发送", exact: true }).click();
    if (scenario === "steer") await page.getByRole("button", { name: "改为引导", exact: true }).click();
  }
  await expect(page.getByText("发送状态确认中", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("");
  if (scenario !== "thread-start") await input.fill("后续新输入");
  if (scenario === "turn-error") await page.locator('input[type="file"]').setInputFiles({ name: "new.txt", mimeType: "text/plain", buffer: Buffer.from("new") });
  offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("发送状态确认中", { exact: true })).toHaveCount(0);
  if (scenario === "turn-success") await expect(page.getByText("确认后的结果", { exact: true })).toBeVisible();
  if (scenario === "turn-success") {
    await expect(page.getByRole("img", { name: "result.png", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "result.png", exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "查看图片 result.png", exact: true }).click();
    await expect(page.getByRole("heading", { name: "图片预览" })).toBeVisible();
    await page.getByRole("button", { name: "关闭图片预览" }).click();
  }
  if (scenario === "approval") await expect(page.getByRole("button", { name: "允许", exact: true })).toHaveCount(0);
  if (scenario === "turn-error") await expect(page.getByRole("alert").getByText("明确发送失败", { exact: true })).toBeVisible();
  if (scenario === "turn-error") {
    await expect(page.getByRole("status", { name: "排队消息" })).toContainText("原始发送");
    await expect(page.getByText("new.txt", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => {
      const oldUrl = (window as any).__fileUrls.find((file: any) => file.name === "old.txt")?.url;
      return Boolean(oldUrl) && !(window as any).__revokedUrls.includes(oldUrl);
    })).toBe(true);
    await expect(page.getByRole("status", { name: "排队消息" }).getByRole("button", { name: "重试", exact: true })).toBeEnabled();
  }
  await expect(input).toHaveValue(scenario === "thread-start" ? "原始发送" : "后续新输入");
  await expect(page.getByText(/请求结果待确认/)).toHaveCount(0);
  expect(starts).toBe(1);
  expect(queryIds).toEqual([accepted.requestId]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("codex-mobile:http-writes:")).map((key) => JSON.parse(localStorage.getItem(key)!)))).toEqual([[]]);
  if (scenario === "turn-error") {
    await page.getByRole("status", { name: "排队消息" }).getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => starts).toBe(2);
    expect(uploadedNames).toEqual(["old.txt", "old.txt"]);
    expect(JSON.stringify(accepted.message.params.input)).toContain("/tmp/old.txt");
    await expect(input).toHaveValue("后续新输入");
    await expect(page.getByText("new.txt", { exact: true })).toBeVisible();
  }
});
}

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
          "mobile/turns/details": { data: thread.turns, nextCursor: null },
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
