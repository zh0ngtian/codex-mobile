import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, pagination = false, hold = false) {
  const user = { id: "u", type: "userMessage", text: "检查历史恢复" };
  const final = { id: "f", type: "agentMessage", phase: "final_answer", text: "历史检查完成" };
  const commentary = [
    { id: "c1", type: "agentMessage", phase: "commentary", text: "先检查历史数据" },
    { id: "c2", type: "agentMessage", phase: "commentary", text: "历史数据已经核对" },
  ];
  const done = { id: "done", status: "completed", itemsView: "summary", items: [user, final] };
  const newest = { id: "newest", status: "completed", itemsView: "summary", items: [
    { id: "new-u", type: "userMessage", text: "查看最近任务" },
    { id: "new-f", type: "agentMessage", phase: "final_answer", text: "最近任务完成" },
  ] };
  const thread = { id: "t", name: "历史过程按钮恢复", cwd: "/tmp/project", status: { type: "idle" }, turns: [pagination ? newest : done] };
  let details = 0, summaries = 0, runningRecovery = 0;
  let release!: () => void;
  const wait = new Promise<void>(resolve => release = resolve);
  await page.addInitScript(() => localStorage.setItem("codex-mobile:language", "zh-CN"));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: ["/tmp/project"], projectlessThreadIds: [] } });
    if (url.pathname === "/api/host") return route.fulfill({ json: { hostId: "test", appServerReady: true, httpPolling: true } });
    if (url.pathname === "/api/events") return route.fulfill({ json: { epoch: "test", cursor: 0, messages: [], requests: [], active: false, updatedAt: Date.now(), reset: false } });
    if (url.pathname !== "/api/rpc") return route.fulfill({ json: {} });
    const { message } = route.request().postDataJSON();
    if (message.method === "mobile/turns/commentary") runningRecovery++;
    if (message.method === "mobile/turns/details") {
      details++;
      if (hold) await wait;
      const target = pagination && !message.params.cursor ? newest : done;
      return route.fulfill({ json: { id: message.id, result: { data: [{ id: target.id, changeStatsUnavailable: true, items: [],
        ...(target.id === "done" ? { commentaryItems: commentary, messageOrder: ["u", "c1", "c2", "f"] } : {}),
      }], nextCursor: null } } });
    }
    if (message.method === "thread/turns/list") summaries++;
    const responses: Record<string, any> = {
      initialize: {}, "model/list": { data: [{ id: "gpt-test", model: "gpt-test", displayName: "GPT Test", isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] },
      "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] }, "config/read": { config: { sandbox_mode: "workspace-write" } },
      "thread/list": { data: [thread], nextCursor: null }, "thread/resume": { thread, initialTurnsPage: { data: thread.turns, nextCursor: pagination ? "older" : null } },
      "thread/read": { thread }, "thread/turns/list": { data: message.params?.cursor ? [done] : thread.turns, nextCursor: null }, "thread/loaded/list": { data: ["t"] },
    };
    return route.fulfill({ json: { id: message.id, result: responses[message.method] ?? {} } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /历史过程按钮恢复/ }).first().click();
  return { release, counts: () => ({ details, summaries, runningRecovery }) };
}

async function verifyToggle(page: Page) {
  const toggle = page.getByRole("button", { name: "之前的 2 条消息" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("先检查历史数据")).toHaveCount(0);
  await toggle.click();
  await expect(page.getByText("先检查历史数据")).toBeVisible();
  await expect(page.getByText("历史数据已经核对")).toBeVisible();
  await expect(page.locator(".tool-activity")).toHaveCount(0);
  const divider = page.locator(".previous-messages .commentary-message + .commentary-message");
  await expect(divider).toHaveCount(1);
  expect(await divider.evaluate(el => getComputedStyle(el).borderTop)).toBe("1px solid rgb(229, 229, 229)");
  await toggle.click();
}

test("完成回合重新打开和刷新后恢复按钮，只复用一次详情读取", async ({ page }) => {
  const f = await setup(page, false, true);
  await expect(page.getByText("历史检查完成")).toBeVisible();
  await expect(page.getByRole("button", { name: /之前的/ })).toHaveCount(0);
  f.release();
  await verifyToggle(page);
  expect(f.counts()).toEqual({ details: 1, summaries: 0, runningRecovery: 0 });
  await page.getByRole("button", { name: "会话操作", exact: true }).click();
  await page.getByRole("button", { name: "刷新会话", exact: true }).click();
  await expect.poll(() => f.counts().details).toBe(2);
  await verifyToggle(page);
  await page.reload();
  await page.getByRole("button", { name: /历史过程按钮恢复/ }).first().click();
  await verifyToggle(page);
  await page.getByRole("button", { name: "之前的 2 条消息" }).click();
  await page.locator(".turn-card").screenshot({ path: `.mobile-build/history-recovered-${test.info().project.name}.png` });
});

test("更早历史页也恢复 commentary 按钮", async ({ page }) => {
  const f = await setup(page, true);
  await page.getByRole("button", { name: "加载更早消息" }).click();
  await expect(page.getByText("历史检查完成")).toBeVisible();
  await verifyToggle(page);
  await expect.poll(() => f.counts().details).toBe(2);
  expect(f.counts().runningRecovery).toBe(0);
});
