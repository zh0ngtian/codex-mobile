import { expect, test } from "@playwright/test";

test("commentary 在 final 流式开始时折叠，窄屏大字号仍可展开工具记录", async ({ page }, testInfo) => {
  const turn: Record<string, any> = { id: "phase-turn", status: "inProgress", items: [
    { id: "u", type: "userMessage", text: "检查阶段切换" },
    { id: "c", type: "agentMessage", phase: "commentary", text: "正在检查文件并准备修改" },
    { id: "r", type: "reasoning", text: "内部过程摘要" },
    { id: "cmd", type: "commandExecution", command: "cat src/App.tsx", status: "completed", commandActions: [{ type: "read", name: "App.tsx" }] },
    { id: "edit", type: "fileChange", status: "completed", changes: [{ path: "/tmp/project/src/App.tsx", diff: "@@ -1 +1 @@\n-old\n+new" }] },
  ] };
  const thread = { id: "phase-thread", name: "回复阶段验证", cwd: "/tmp/project", status: { type: "active" }, turns: [turn] };
  let cursor = 0;
  const events: { cursor: number; message: any }[] = [];
  await page.addInitScript(() => localStorage.setItem("codex-mobile:language", "zh-CN"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: ["/tmp/project"], projectlessThreadIds: [] } });
    if (url.pathname === "/api/host") return route.fulfill({ json: { hostId: "phase-host", appServerReady: true, httpPolling: true } });
    if (url.pathname === "/api/events") return route.fulfill({ json: { epoch: "phase", cursor, messages: events.filter(event => event.cursor > Number(url.searchParams.get("after"))).map(event => event.message), requests: [], active: turn.status === "inProgress", updatedAt: Date.now(), reset: false } });
    if (url.pathname !== "/api/rpc") return route.fulfill({ json: {} });
    const { message } = route.request().postDataJSON();
    const responses: Record<string, unknown> = {
      initialize: {},
      "model/list": { data: [{ id: "gpt-test", model: "gpt-test", displayName: "GPT Test", isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] },
      "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] },
      "config/read": { config: { sandbox_mode: "workspace-write" } },
      "thread/list": { data: [thread], nextCursor: null },
      "thread/resume": { thread, initialTurnsPage: { data: thread.turns, nextCursor: null } },
      "thread/read": { thread },
      "thread/turns/list": { data: thread.turns, nextCursor: null },
    };
    return route.fulfill({ json: { id: message.id, result: responses[message.method] ?? {} } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /回复阶段验证/ }).first().click();
  await expect(page.getByText("正在检查文件并准备修改")).toBeVisible();
  await expect(page.getByText("内部过程摘要")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "已读取 App.tsx" })).toHaveCount(0);
  await expect(page.locator(".file-change-activity")).toHaveCount(0);
  const final = { id: "f", type: "agentMessage", phase: "final_answer", text: "文件检查和修改已完成。" };
  turn.items.push(final);
  events.push({ cursor: ++cursor, message: { method: "item/started", params: { threadId: thread.id, turnId: turn.id, item: final } } });
  await expect(page.getByText(final.text)).toBeVisible();
  await expect(page.getByText("正在检查文件并准备修改")).toHaveCount(0);
  const toggle = page.getByRole("button", { name: "之前的 4 条消息" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => document.documentElement.style.setProperty("--app-font-scale", "1.25"));
    await toggle.scrollIntoViewIfNeeded();
    const bounds = await toggle.evaluate(el => ({ height: el.getBoundingClientRect().height, width: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.width).toBeLessThanOrEqual(bounds.viewport);
    await toggle.click();
    await expect(page.getByText("正在检查文件并准备修改")).toBeVisible();
    await page.locator(".tool-activity > summary").click();
    await expect(page.getByRole("button", { name: "已读取 App.tsx" })).toBeVisible();
    await toggle.click();
    await expect(page.getByText("正在检查文件并准备修改")).toHaveCount(0);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await toggle.click();
  await page.locator(".tool-activity > summary").click();
  await page.locator(".file-change-file").click();
  await expect(page.locator(".file-diff-line.deletion")).toContainText("old");
  await page.getByRole("button", { name: "关闭文件修改" }).click();
  await toggle.click();
  await page.locator(".turn-card").screenshot({ path: `.mobile-build/commentary-final-${testInfo.project.name}.png` });
});
