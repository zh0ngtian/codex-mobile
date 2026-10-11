import { expect, test } from "@playwright/test";

test("排队、编辑和引导消息变化时任务状态不被遮挡，历史阅读不跳到底部", async ({ page }, testInfo) => {
  const thread = { id: "follow-up-layout", name: "追加消息布局", cwd: "/tmp/project", status: { type: "active", activeFlags: [] }, turns: [{
    id: "running-turn", status: "inProgress", items: [
      { id: "user", type: "userMessage", text: "检查布局" },
      { id: "answer", type: "agentMessage", phase: "commentary", text: Array.from({ length: 40 }, (_, i) => `正在检查段落 ${i}`).join("\n\n") },
    ],
  }] };
  await page.addInitScript(() => localStorage.setItem("codex-mobile:language", "zh-CN"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: ["/tmp/project"], projectlessThreadIds: [] } });
    if (url.pathname === "/api/host") return route.fulfill({ json: { hostId: "layout-host", gatewayVersion: "0.2.145", appServerReady: true, httpPolling: true } });
    if (url.pathname === "/api/events") return route.fulfill({ json: { epoch: "layout", cursor: 0, messages: [], requests: [], active: true, updatedAt: Date.now(), reset: false } });
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
      "turn/steer": { turnId: "running-turn" },
    };
    return route.fulfill({ json: { id: message.id, result: responses[message.method] ?? {} } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /追加消息布局/ }).first().click();
  const scroller = page.locator(".conversation-scroll");
  const queue = async (text: string) => {
    await page.getByRole("textbox", { name: "向 Codex 提问" }).fill(text);
    await page.getByRole("button", { name: "排队", exact: true }).click();
  };
  const expectClear = async () => {
    await expect.poll(async () => page.evaluate(() => {
      const progress = document.querySelector(".run-progress")!.getBoundingClientRect();
      const form = document.querySelector(".composer-wrap")!.getBoundingClientRect();
      const stack = document.querySelector(".composer-follow-up-stack")?.getBoundingClientRect();
      return Math.round(progress.bottom - Math.min(form.top, stack?.top ?? form.top));
    })).toBeLessThanOrEqual(-8);
  };
  await expect(page.locator(".run-progress")).toContainText("任务进行中");
  await queue("先检查排队消息布局");
  await expectClear();
  await page.screenshot({ path: `.mobile-build/follow-up-${testInfo.project.name}.png` });
  await queue("再检查引导消息布局");
  await queue("保留第三条排队消息");
  await expectClear();
  await page.getByRole("button", { name: "编辑排队消息", exact: true }).first().click();
  await page.getByRole("textbox", { name: "编辑排队消息内容" }).fill("多行编辑\n第二行内容\n第三行内容\n第四行内容");
  await expectClear();
  await page.getByRole("button", { name: "取消编辑排队消息" }).click();
  await page.getByRole("button", { name: "改为引导" }).first().click();
  await expect(page.getByRole("status", { name: "已发送引导" })).toBeVisible();
  await expectClear();
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 393, height: 852 }]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => document.documentElement.style.setProperty("--app-font-scale", "1.25"));
    // 旋转后重新滚动到最新位置，核对该尺寸下的底部留白。
    await scroller.evaluate(async el => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      el.scrollTop = el.scrollHeight;
    });
    await expectClear();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
  await page.getByRole("button", { name: "最大化输入框" }).click();
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expectClear();
  await page.getByRole("button", { name: "还原输入框" }).click();
  await expectClear();
  // 手动阅读历史时，输入区缩小和增大都不应抢走滚动位置。
  await scroller.evaluate(el => el.scrollTo(0, 300));
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(300);
  await page.getByRole("button", { name: "取消排队消息" }).first().click();
  await queue("阅读历史时新排队");
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(300);
});
