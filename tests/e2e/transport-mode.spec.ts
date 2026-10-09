import { expect, test, type WebSocketRoute } from "@playwright/test";

test("默认 HTTP，切换流式接收连续增量，刷新记忆并能切回 HTTP", async ({ page }) => {
  const thread: any = { id: "transport-thread", name: "传输切换会话", cwd: "/tmp/project", turns: [], status: { type: "idle" } };
  const methods: Array<{ transport: string; method: string }> = [];
  const sockets: WebSocketRoute[] = [];
  let closed = 0;
  let polls = 0;
  const reply = (message: any, transport: string) => {
    methods.push({ transport, method: message.method });
    if (message.method === "turn/start") {
      thread.status = { type: "active" };
      thread.turns = [{ id: "stream-turn", status: "inProgress", items: [] }];
    }
    const responses: Record<string, any> = {
      initialize: {},
      "model/list": { data: [{ id: "gpt-test", model: "gpt-test", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "平衡" }], serviceTiers: [] }] },
      "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] },
      "config/read": { config: { model: "gpt-test", sandbox_mode: "workspace-write" } },
      "thread/list": { data: [thread], nextCursor: null },
      "thread/resume": { thread, initialTurnsPage: { data: thread.turns, nextCursor: null }, model: "gpt-test", reasoningEffort: "medium", approvalPolicy: "on-request" },
      "thread/turns/list": { data: thread.turns, nextCursor: null },
      "mobile/turns/details": { data: thread.turns.map((turn: any) => ({ id: turn.id, loadedChangeStats: { additions: 0, deletions: 0 }, items: [] })) },
      "turn/start": { turn: thread.turns[0] },
    };
    return { id: message.id, result: responses[message.method] ?? {} };
  };
  await page.addInitScript(() => localStorage.setItem("codex-mobile:language", "zh-CN"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/host") return route.fulfill({ json: { hostId: "test", displayName: "Test", appServerReady: true, httpPolling: true } });
    if (path === "/api/projects") return route.fulfill({ json: { projects: [thread.cwd], projectlessThreadIds: [] } });
    if (path === "/api/events") {
      polls++;
      return route.fulfill({ json: { epoch: "test", cursor: 0, messages: [], requests: [], active: false, updatedAt: Date.now(), reset: false } });
    }
    if (path === "/api/rpc") return route.fulfill({ json: reply(route.request().postDataJSON().message, "http") });
    return route.continue();
  });
  await page.routeWebSocket("**/ws**", (socket) => {
    sockets.push(socket);
    socket.onClose(() => { closed++; });
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.id != null && message.method) socket.send(JSON.stringify(reply(message, "stream")));
    });
  });
  const openSettings = async () => {
    if (!(await page.getByRole("button", { name: "管理设备", exact: true }).isVisible())) {
      await page.getByRole("button", { name: "打开会话列表", exact: true }).click();
    }
    await page.getByRole("button", { name: "管理设备", exact: true }).click();
  };
  const closeSettings = async () => {
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    const sidebarClose = page.getByRole("button", { name: "关闭会话列表", exact: true });
    if (await sidebarClose.isVisible()) {
      const bounds = await sidebarClose.boundingBox();
      await sidebarClose.click({ position: { x: bounds!.width - 8, y: 30 } });
    }
  };
  await page.goto("/");
  await expect(page.getByRole("button", { name: /传输切换会话/ }).first()).toBeVisible();
  expect(sockets).toHaveLength(0);
  await expect.poll(() => polls).toBeGreaterThan(0);
  await page.getByRole("button", { name: /传输切换会话/ }).first().click();
  await openSettings();
  await expect(page.getByRole("button", { name: "HTTP", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "流式", exact: true }).click();
  await expect.poll(() => sockets.length).toBe(1);
  await expect.poll(() => methods.some((entry) => entry.transport === "stream" && entry.method === "thread/resume")).toBe(true);
  await page.screenshot({ path: test.info().outputPath("transport-settings.png") });
  await closeSettings();
  const input = page.getByRole("textbox", { name: "向 Codex 提问" });
  await input.fill("测试流式回复");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => methods.filter((entry) => entry.method === "turn/start")).toEqual([{ transport: "stream", method: "turn/start" }]);
  const send = (method: string, params: any) => sockets.at(-1)!.send(JSON.stringify({ method, params: { threadId: thread.id, turnId: "stream-turn", ...params } }));
  send("turn/started", { turn: thread.turns[0] });
  send("item/started", { item: { id: "reply", type: "agentMessage", text: "", phase: "final_answer" } });
  send("item/agentMessage/delta", { itemId: "reply", delta: "逐字" });
  await expect(page.getByText("逐字", { exact: true })).toBeVisible();
  thread.turns[0].items = [{ id: "reply", type: "agentMessage", text: "逐字", phase: "final_answer" }];
  await page.reload();
  await expect.poll(() => sockets.length).toBe(2);
  await page.getByRole("button", { name: /传输切换会话/ }).first().click();
  await expect(page.getByText("逐字", { exact: true })).toBeVisible();
  send("item/agentMessage/delta", { itemId: "reply", delta: "回复完成" });
  await expect(page.getByText("逐字回复完成", { exact: true })).toBeVisible();
  thread.turns[0].status = "completed";
  thread.turns[0].items = [{ id: "reply", type: "agentMessage", text: "逐字回复完成", phase: "final_answer" }];
  thread.status = { type: "idle" };
  send("item/completed", { item: thread.turns[0].items[0] });
  send("turn/completed", { turn: thread.turns[0] });
  await page.reload();
  await expect.poll(() => sockets.length).toBe(3);
  await expect(page.getByRole("button", { name: /传输切换会话/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /传输切换会话/ }).first().click();
  await expect(page.getByText("逐字回复完成", { exact: true })).toBeVisible();
  await openSettings();
  await expect(page.getByRole("button", { name: "流式", exact: true })).toHaveAttribute("aria-pressed", "true");
  const previousPolls = polls;
  await page.getByRole("button", { name: "HTTP", exact: true }).click();
  await expect.poll(() => polls).toBeGreaterThan(previousPolls);
  await expect.poll(() => closed).toBeGreaterThan(0);
  await closeSettings();
  await expect(page.getByText("逐字回复完成", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("codex-mobile:transport-mode"))).toBe("http");
});
