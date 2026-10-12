import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, hold = false, unsupported = false) {
  const user = { id: "u", type: "userMessage", text: "恢复检查" };
  const first = { id: "c1", type: "agentMessage", phase: "commentary", text: "离线时开始检查" };
  const latest = { id: "c2", type: "agentMessage", phase: "commentary", text: "正在检查文件" };
  const turn = { id: "live", status: "inProgress", itemsView: "summary", items: [user, latest] };
  const thread = { id: "t", name: "过程恢复验证", cwd: "/tmp/project", status: { type: "active" }, turns: [turn] };
  const history = [user, first, latest];
  let requests = 0, polls = 0, cursor = 0;
  const events: { cursor: number; message: any }[] = [];
  let release!: () => void;
  const wait = new Promise<void>(resolve => release = resolve);
  await page.addInitScript(() => localStorage.setItem("codex-mobile:language", "zh-CN"));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: ["/tmp/project"], projectlessThreadIds: [] } });
    if (url.pathname === "/api/host") return route.fulfill({ json: { hostId: "test", appServerReady: true, httpPolling: true } });
    if (url.pathname === "/api/events") {
      polls++;
      return route.fulfill({ json: { epoch: "test", cursor, messages: events.filter(event => event.cursor > Number(url.searchParams.get("after"))).map(event => event.message), requests: [], active: true, updatedAt: Date.now(), reset: false } });
    }
    if (url.pathname !== "/api/rpc") return route.fulfill({ json: {} });
    const { message } = route.request().postDataJSON();
    if (message.method === "mobile/turns/commentary") {
      requests++;
      expect(message.params).toEqual({ threadId: "t", turnId: "live" });
      if (hold) await wait;
      return route.fulfill({ json: unsupported ? { id: message.id, error: { code: -32601, message: "Unsupported" } } : { id: message.id, result: { turnId: "live", items: history } } });
    }
    const responses: Record<string, any> = {
      initialize: {}, "model/list": { data: [{ id: "gpt-test", model: "gpt-test", displayName: "GPT Test", isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] },
      "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] }, "config/read": { config: { sandbox_mode: "workspace-write" } },
      "thread/list": { data: [thread], nextCursor: null }, "thread/resume": { thread, initialTurnsPage: { data: thread.turns, nextCursor: null } },
      "thread/read": { thread }, "thread/turns/list": { data: thread.turns, nextCursor: null }, "thread/loaded/list": { data: ["t"] },
    };
    return route.fulfill({ json: { id: message.id, result: responses[message.method] ?? {} } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /过程恢复验证/ }).first().click();
  await expect(page.getByText(latest.text, { exact: true })).toBeVisible();
  return { release, history, count: () => requests, polls: () => polls, send: (method: string, params: any) => events.push({ cursor: ++cursor, message: { method, params } }) };
}

test("重新打开补齐 commentary，轮询不重拉，网络恢复再次补齐，final 默认折叠", async ({ page }) => {
  const f = await setup(page);
  await expect(page.getByText("离线时开始检查")).toBeVisible();
  await expect.poll(f.polls, { timeout: 12_000 }).toBeGreaterThan(2);
  expect(f.count()).toBe(1);
  f.history.push({ id: "c3", type: "agentMessage", phase: "commentary", text: "后台继续检查" });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("后台继续检查")).toBeVisible();
  expect(f.count()).toBe(2);
  f.send("item/started", { threadId: "t", turnId: "live", item: { id: "f", type: "agentMessage", phase: "final_answer", text: "最终检查完成" } });
  await expect(page.getByText("最终检查完成")).toBeVisible();
  await expect(page.getByText("离线时开始检查")).toHaveCount(0);
  await page.getByRole("button", { name: "之前的 3 条消息" }).click();
  await expect(page.getByText("离线时开始检查")).toBeVisible();
  await page.getByRole("button", { name: "之前的 3 条消息" }).click();
  await page.locator(".turn-card").screenshot({ path: `.mobile-build/commentary-backfill-${test.info().project.name}.png` });
});

test("回填期间的实时增量与 final 不被旧快照覆盖", async ({ page }) => {
  const f = await setup(page, true);
  await expect.poll(f.count).toBe(1);
  f.send("item/agentMessage/delta", { threadId: "t", turnId: "live", itemId: "c2", delta: "并完成" });
  await expect(page.getByText("正在检查文件并完成", { exact: true })).toBeVisible();
  f.send("item/started", { threadId: "t", turnId: "live", item: { id: "f", type: "agentMessage", phase: "final_answer", text: "最终检查完成" } });
  await expect(page.getByText("最终检查完成")).toBeVisible();
  f.release();
  const toggle = page.getByRole("button", { name: "之前的 2 条消息" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("离线时开始检查")).toHaveCount(0);
  await toggle.click();
  await expect(page.getByText("离线时开始检查")).toHaveCount(1);
  await expect(page.getByText("正在检查文件并完成", { exact: true })).toHaveCount(1);
});

test("旧网关不支持回填时仍能显示实时文本", async ({ page }) => {
  const f = await setup(page, false, true);
  await expect.poll(f.count).toBe(1);
  f.send("item/agentMessage/delta", { threadId: "t", turnId: "live", itemId: "c2", delta: "并完成" });
  await expect(page.getByText("正在检查文件并完成", { exact: true })).toBeVisible();
  expect(f.count()).toBe(1);
});
