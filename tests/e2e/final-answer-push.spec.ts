import { expect, test, type WebSocketRoute } from "@playwright/test";

test("系统推送等待最终回复和成功回合结束，忽略过程、失败与历史", async ({ page }) => {
  const thread = { id: "notification-thread", name: "完成通知会话", cwd: "/tmp/project", turns: [], status: { type: "idle" } };
  const sockets: WebSocketRoute[] = [];
  const reply = (message: any) => {
    const results: Record<string, any> = {
      initialize: {},
      "model/list": { data: [{ id: "gpt-test", model: "gpt-test", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "平衡" }], serviceTiers: [] }] },
      "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] },
      "config/read": { config: { model: "gpt-test", sandbox_mode: "workspace-write" } },
      "thread/list": { data: [thread], nextCursor: null },
    };
    return { id: message.id, result: results[message.method] ?? {} };
  };
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    localStorage.setItem("codex-mobile:transport-mode", "stream");
    (window as any).pushes = [];
    (window as any).webkit = { messageHandlers: { completionNotification: { postMessage: (message: any) => {
      if (message.action === "show") (window as any).pushes.push(message);
    } } } };
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/host") return route.fulfill({ json: { hostId: "test", displayName: "Test", appServerReady: true, httpPolling: true } });
    if (path === "/api/projects") return route.fulfill({ json: { projects: [thread.cwd], projectlessThreadIds: [] } });
    if (path === "/api/events") return route.fulfill({ json: { epoch: "test", cursor: 0, messages: [], requests: [], active: false, reset: false } });
    if (path === "/api/rpc") return route.fulfill({ json: reply(route.request().postDataJSON().message) });
    return route.continue();
  });
  await page.routeWebSocket("**/ws**", (socket) => {
    sockets.push(socket);
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.id != null && message.method) socket.send(JSON.stringify(reply(message)));
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /完成通知会话/ }).first()).toBeVisible();
  await expect.poll(() => sockets.length).toBe(1);
  const send = (method: string, params: any) => sockets[0].send(JSON.stringify({ method, params: { threadId: thread.id, ...params } }));
  const final = (turnId: string, phase = "final_answer") => send("item/completed", { turnId, item: { id: `${turnId}-reply`, type: "agentMessage", phase, text: "完成" } });
  const complete = (turnId: string, status = "completed", items?: any[]) => send("turn/completed", { turn: { id: turnId, status, items } });
  const count = () => page.evaluate(() => (window as any).pushes.length);
  const unchanged = async (expected: number) => { await page.waitForTimeout(150); expect(await count()).toBe(expected); };
  final("first");
  await unchanged(0);
  complete("first");
  await expect.poll(count).toBe(1);
  final("first"); complete("first"); await unchanged(1);
  final("commentary", "commentary"); complete("commentary"); await unchanged(1);
  final("failed"); complete("failed", "failed"); await unchanged(1);
  final("interrupted"); complete("interrupted", "interrupted"); await unchanged(1);
  send("mobile/events/catchup", { active: true });
  final("history"); complete("history");
  send("mobile/events/catchup", { active: false }); await unchanged(1);
  complete("late-final"); await unchanged(1);
  final("late-final"); await expect.poll(count).toBe(2);
  complete("inline-final", "completed", [{ id: "inline", type: "agentMessage", phase: "final_answer", text: "完成" }]);
  await expect.poll(count).toBe(3);
  const pushes = await page.evaluate(() => (window as any).pushes);
  expect(pushes.every((push: any) => push.threadId === thread.id && push.backendId)).toBe(true);
});
