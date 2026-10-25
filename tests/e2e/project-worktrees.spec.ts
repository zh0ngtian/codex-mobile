import { expect, test } from "@playwright/test";

test("worktree会话在原项目中分页、刷新和搜索，打开仍使用原会话", async ({ page }) => {
  const root = "/projects/codex-mobile", worktree = "/worktrees/task/checkout";
  const records = Array.from({ length: 7 }, (_, i) => ({
    id: `thread-${i}`, name: i === 0 ? "上传字节数" : `项目会话 ${i}`,
    cwd: i === 0 || i > 4 ? worktree : root, recencyAt: 100 - i,
    status: { type: i === 0 ? "active" : "idle" }, turns: [],
  }));
  const lists: any[] = [], opened: string[] = [];
  let catalogFailure = false;
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    localStorage.setItem("codex-mobile:transport-mode", "stream");
    localStorage.setItem("codex-mobile:list-backend", "current-origin");
  });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/host") return route.fulfill({ json: { hostId: "test", displayName: "Mac", appServerReady: true, httpPolling: true } });
    if (path === "/api/projects") return catalogFailure ? route.fulfill({ status: 500 }) : route.fulfill({ json: { projects: [root], projectlessThreadIds: [], projectWorktrees: { [root]: [worktree] } } });
    return route.fulfill({ json: { items: [] } });
  });
  await page.routeWebSocket("**/ws**", socket => socket.onMessage(raw => {
    const message = JSON.parse(String(raw));
    if (message.id == null || !message.method) return;
    let result: any = {};
    if (message.method === "threadSection/list") result = { data: [{ id: '01984de2-8f74-7c91-a3b2-5c5e937cf318' }], nextCursor: null };
    else if (message.method === "thread/list" && message.params.sectionId) result = { data: [], nextCursor: null };
    else if (message.method === "thread/list") {
      lists.push(message.params);
      const directories = Array.isArray(message.params.cwd) ? message.params.cwd : [message.params.cwd];
      const filtered = records.filter(thread => (!message.params.cwd || directories.includes(thread.cwd)) && (!message.params.searchTerm || thread.name.includes(message.params.searchTerm)));
      const offset = Number(message.params.cursor ?? 0), end = offset + message.params.limit;
      result = { data: filtered.slice(offset, end), nextCursor: end < filtered.length ? String(end) : null };
    } else if (message.method === "mobile/sidebar/summaries") result = { data: [records[0]] };
    else if (message.method === "thread/search") result = { data: [{ thread: records[0], snippet: "上传字节数" }], nextCursor: null };
    else if (message.method === "thread/resume") {
      opened.push(message.params.threadId);
      result = { thread: records.find(thread => thread.id === message.params.threadId), initialTurnsPage: { data: [], nextCursor: null } };
    } else if (message.method === "model/list") result = { data: [{ id: "test", model: "test", isDefault: true, supportedReasoningEfforts: [] }] };
    else if (message.method === "permissionProfile/list") result = { data: [] };
    else if (message.method === "config/read") result = { config: { model: "test" } };
    socket.send(JSON.stringify({ id: message.id, result }));
  }));
  await page.goto("/");
  const project = page.locator(".project-group");
  await expect(project).toHaveCount(1);
  const heading = project.getByRole("button", { name: /^codex-mobile/ });
  if (await heading.getAttribute("aria-expanded") === "false") await heading.click();
  await expect(project.getByRole("button", { name: /上传字节数/ })).toBeVisible();
  await expect(project.getByText("项目会话 4", { exact: true })).toBeVisible();
  await expect(project.getByText("项目会话 5", { exact: true })).toHaveCount(0);
  expect(lists.some(params => JSON.stringify(params.cwd) === JSON.stringify([root, worktree]) && params.limit === 5)).toBe(true);
  await project.getByRole("button", { name: "更多", exact: true }).click();
  await expect(project.getByText("项目会话 6", { exact: true })).toBeVisible();
  expect(lists.some(params => params.cursor === "5" && JSON.stringify(params.cwd) === JSON.stringify([root, worktree]))).toBe(true);
  await page.reload();
  await expect(project).toHaveCount(1);
  await expect(project.getByRole("button", { name: /上传字节数/ })).toBeVisible();
  catalogFailure = true;
  await page.getByRole("button", { name: "刷新会话列表", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("项目目录接口返回 500");
  await expect(project.getByRole("button", { name: /上传字节数/ })).toBeVisible();
  catalogFailure = false;
  await page.getByPlaceholder("搜索聊天").fill("上传字节数");
  await expect(page.getByRole("button", { name: /上传字节数/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /checkout/ })).toHaveCount(0);
  await page.getByRole("button", { name: /上传字节数/ }).click();
  await expect.poll(() => opened).toEqual(["thread-0"]);
});
