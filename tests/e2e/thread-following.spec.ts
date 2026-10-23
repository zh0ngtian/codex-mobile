import { expect, test, type WebSocketRoute } from "@playwright/test";

test("置顶会话独立展示、折叠状态标记与电脑回合系统通知", async ({ page }, testInfo) => {
  const thread = { id: "desktop-thread", name: "电脑执行会话", cwd: "/tmp/follow-project", turns: [], status: { type: "active" } };
  const other = { ...thread, id: "unread-thread", name: "待阅会话", status: { type: "idle" } };
  const historical = { ...thread, id: "history-thread", name: "搜索历史会话", status: { type: "idle" } };
  const sockets: WebSocketRoute[] = [];
  await page.addInitScript((largeText) => {
    if (largeText) localStorage.setItem("codex-mobile:font-size", "extra-large");
    localStorage.setItem("codex-mobile:language", "zh-CN");
    localStorage.setItem("codex-mobile:transport-mode", "stream");
    localStorage.setItem("codex-mobile:list-backend", "current-origin");
    localStorage.setItem("codex-mobile:unread:current-origin", JSON.stringify(["unread-thread"]));
    (window as any).pushes = [];
    (window as any).webkit = { messageHandlers: { completionNotification: { postMessage(message: any) {
      if (message.action === "show") (window as any).pushes.push(message);
    } } } };
  }, testInfo.project.name === "small-large-text");
  const reply = (message: any) => {
    const results: Record<string, any> = {
      initialize: {},
      "model/list": { data: [{ id: "test", model: "test", isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] },
      "permissionProfile/list": { data: [] }, "config/read": { config: { model: "test" } },
      "thread/loaded/list": { data: [thread.id], nextCursor: null },
      "thread/read": { thread: message.params?.threadId === thread.id ? thread : message.params?.threadId === historical.id ? historical : other },
      "thread/list": { data: [thread, other], nextCursor: null },
      "thread/search": { data: [{ thread: historical, snippet: "历史正文" }], nextCursor: null },
    };
    return { id: message.id, result: results[message.method] ?? {} };
  };
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/host") return route.fulfill({ json: { hostId: "test", displayName: "测试", appServerReady: true, httpPolling: true } });
    if (path === "/api/projects") return route.fulfill({ json: { projects: [thread.cwd], projectlessThreadIds: [] } });
    if (path === "/api/rpc") return route.fulfill({ json: reply(route.request().postDataJSON().message) });
    return route.fulfill({ json: { items: [], saved: true } });
  });
  await page.routeWebSocket("**/ws**", socket => {
    sockets.push(socket);
    socket.onMessage(raw => { const message = JSON.parse(String(raw)); if (message.id != null && message.method) socket.send(JSON.stringify(reply(message))); });
  });
  await page.goto("/");
  const project = page.getByRole("button", { name: /follow-project/ });
  await expect(page.getByRole("button", { name: /电脑执行会话/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "置顶", exact: true })).toHaveCount(0);
  await expect(project.getByLabel("进行中")).toHaveCount(0);
  await project.click();
  await expect(project).toHaveAttribute("aria-expanded", "false");
  await expect(project.getByLabel("进行中")).toBeVisible();
  await expect(project.getByLabel("未读")).toBeVisible();
  await page.screenshot({ path: `/private/tmp/thread-following-collapsed-${testInfo.project.name}.png` });
  await project.click();
  await expect(project.getByLabel("进行中")).toHaveCount(0);
  await page.getByRole("button", { name: /电脑执行会话/ }).dispatchEvent("contextmenu");
  await page.getByRole("button", { name: "置顶", exact: true }).click();
  const followed = page.locator(".thread-section").filter({ has: page.getByRole("heading", { name: "置顶", exact: true }) });
  await expect(followed.getByText("电脑执行会话")).toBeVisible();
  await expect(page.locator(".project-group").getByText("电脑执行会话")).toHaveCount(0);
  await expect(page.getByText("电脑执行会话", { exact: true })).toHaveCount(1);
  const count = () => page.evaluate(() => (window as any).pushes.length);
  const complete = (turnId: string) => {
    sockets[0].send(JSON.stringify({ method: "item/completed", params: { threadId: thread.id, turnId, item: { id: `${turnId}-final`, type: "agentMessage", phase: "final_answer", text: "完成" } } }));
    sockets[0].send(JSON.stringify({ method: "turn/completed", params: { threadId: thread.id, turn: { id: turnId, status: "completed" } } }));
  };
  complete("desktop-followed");
  await expect.poll(count).toBe(1);
  complete("desktop-followed");
  await page.waitForTimeout(100);
  expect(await count()).toBe(1);
  await followed.getByRole("button", { name: /电脑执行会话/ }).dispatchEvent("contextmenu");
  await page.getByRole("button", { name: "取消置顶", exact: true }).click();
  await expect(page.locator(".project-group").getByText("电脑执行会话")).toBeVisible();
  await expect(page.getByRole("heading", { name: "置顶", exact: true })).toHaveCount(0);
  complete("desktop-unfollowed");
  await page.waitForTimeout(150);
  expect(await count()).toBe(1);
  await page.getByPlaceholder("搜索聊天").fill("搜索历史");
  await expect(page.getByRole("button", { name: /搜索历史会话/ })).toBeVisible();
  await page.getByRole("button", { name: /搜索历史会话/ }).dispatchEvent("contextmenu");
  await page.getByRole("button", { name: "置顶", exact: true }).click();
  await page.getByPlaceholder("搜索聊天").fill("");
  await expect(followed.getByText("搜索历史会话")).toBeVisible();
  await page.reload();
  await expect(followed.getByText("搜索历史会话")).toBeVisible();
  await expect(page.locator(".project-group").getByText("搜索历史会话")).toHaveCount(0);
});
