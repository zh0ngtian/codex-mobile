import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const audit = ".mobile-build/web-ui-audit/screenshots";
const answer = `## 让对话更容易阅读\n\n正文保持足够字号和留白，短消息自然收拢。**清晰的层级**有助于连续阅读。\n\n| 方案 | 阅读体验 | 输入与键盘 | 长表格内容 |\n| --- | --- | --- | --- |\n| 原生界面 | 系统排版 | 系统控件 | 局部滚动 |\n| 网页界面 | 同样清晰 | 浏览器输入 | 局部滚动 |\n\n\`\`\`swift\nlet message = "保留同一段草稿，随时切换比较体验"\n\`\`\`\n\n这是一段较长的回答，用来检查内容宽度、滚动与输入框之间的关系。`;
const thread: any = { id: "web-comparison", name: "对比原生和网页体验", preview: "对比原生和网页体验", cwd: "/tmp/design-project", createdAt: 1700000000, updatedAt: 1800000000, status: { type: "idle" }, turns: [{ id: "turn-one", status: "completed", items: [{ id: "user-one", type: "userMessage", content: [{ type: "text", text: "你好" }] }, { id: "answer-one", type: "agentMessage", phase: "final_answer", text: answer }] }] };

async function fixture(page: Page, options: { retryFailure?: boolean } = {}) {
  let searches = 0;
  let failProjects = false;
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    localStorage.setItem("codex-mobile:interface-mode", "web");
    localStorage.setItem("codex-mobile.backend-registry.v1", JSON.stringify({ version: 1, selectedBackendId: "web-audit", backends: [{ id: "web-audit", name: "Mac Studio", baseUrl: location.origin, token: "", enabled: true, order: 0 }] }));
  });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/host") return route.fulfill({ json: { hostId: "web-audit", displayName: "Mac Studio", gatewayVersion: "0.2.133", appServerReady: true, httpPolling: true } });
    if (url.pathname === "/api/projects") return route.fulfill(failProjects ? { status: 503, json: { error: "暂时无法刷新项目" } } : { json: { projects: [thread.cwd], projectlessThreadIds: [] } });
    if (url.pathname === "/api/events") return route.fulfill({ json: { epoch: "web-audit", cursor: 0, messages: [], requests: [], active: false, updatedAt: Date.now(), reset: false } });
    if (url.pathname !== "/api/rpc") return route.fulfill({ status: 404, json: {} });
    const { message } = route.request().postDataJSON();
    if (message.method === "thread/search") {
      searches++;
      if (options.retryFailure && searches === 1) {
        failProjects = true;
        return route.fulfill({ json: { id: message.id, error: { code: -1, message: "搜索暂时失败" } } });
      }
      return route.fulfill({ json: { id: message.id, result: { data: message.params.searchTerm === "不存在" ? [] : [{ thread, snippet: "比较两种界面的阅读和输入体验" }], nextCursor: null } } });
    }
    const responses: Record<string, any> = {
      initialize: {}, "model/list": { data: [{ id: "gpt-test", model: "gpt-test", displayName: "GPT Test", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "平衡" }], serviceTiers: [] }] },
      "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] }, "config/read": { config: { model: "gpt-test", sandbox_mode: "workspace-write" } },
      "thread/list": { data: [thread], nextCursor: null }, "thread/resume": { thread, initialTurnsPage: { data: thread.turns, nextCursor: null }, model: "gpt-test", approvalPolicy: "on-request", approvalsReviewer: "user" },
      "thread/turns/list": { data: thread.turns, nextCursor: null }, "mobile/turns/details": { data: thread.turns, nextCursor: null },
    };
    // 此夹具不允许向真实网关发送或修改会话。
    if (["thread/start", "turn/start", "thread/archive"].includes(message.method)) throw new Error(`Unexpected write: ${message.method}`);
    return route.fulfill({ json: { id: message.id, result: responses[message.method] ?? {} } });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /对比原生和网页体验/ }).first()).toBeVisible();
  return { searches: () => searches };
}

async function capture(page: Page, name: string) {
  await mkdir(audit, { recursive: true });
  await page.screenshot({ path: `${audit}/${name}.png` });
}

test("搜索失败后保留查询并重试，即使项目刷新失败", async ({ page }) => {
  const state = await fixture(page, { retryFailure: true });
  await page.getByPlaceholder("搜索聊天").fill("比较");
  await expect(page.getByText("搜索暂时失败", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect.poll(state.searches, { timeout: 4000 }).toBe(2);
  await expect(page.getByRole("button", { name: /对比原生和网页体验/ }).first()).toBeVisible();
});

for (const view of [
  { name: "phone-light", width: 375, height: 812, dark: false, scale: 1 },
  { name: "phone-dark", width: 375, height: 812, dark: true, scale: 1 },
  { name: "tablet", width: 1024, height: 768, dark: false, scale: 1 },
  { name: "accessibility", width: 393, height: 852, dark: false, scale: 53 / 17 },
  { name: "short-viewport", width: 375, height: 450, dark: false, scale: 1 },
]) {
  test(`网页边栏与对话可操作：${view.name}`, async ({ page }) => {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.emulateMedia({ colorScheme: view.dark ? "dark" : "light", reducedMotion: "reduce" });
    await fixture(page);
    if (view.scale > 1) await page.evaluate(scale => {
      document.documentElement.style.setProperty("--native-type-scale", String(scale));
      document.documentElement.dataset.iosAccessibilityText = "true";
    }, view.scale);
    const geometry = await page.evaluate(() => {
      const sidebar = document.querySelector('.conversation-sidebar')!.getBoundingClientRect();
      const list = document.querySelector('.web-sidebar .thread-list')!.getBoundingClientRect();
      const footer = document.querySelector('.web-sidebar .list-actions')!.getBoundingClientRect();
      const search = document.querySelector('.sidebar-search input')!.getBoundingClientRect();
      return { width: sidebar.width, listHeight: list.height, listBottom: list.bottom, footerTop: footer.top, searchBottom: search.bottom, listTop: list.top, scrollWidth: document.documentElement.scrollWidth, screenWidth: innerWidth };
    });
    expect(geometry.width).toBeLessThanOrEqual(420);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.screenWidth);
    expect(geometry.listHeight).toBeGreaterThanOrEqual(view.scale > 1 ? 130 : 120);
    expect(geometry.listBottom).toBeLessThanOrEqual(geometry.footerTop + 1);
    expect(geometry.searchBottom).toBeLessThanOrEqual(geometry.listTop + 1);
    const contrast = await page.evaluate(() => {
      const luminance = (color: string) => {
        const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const ratio = (text: string, background: string) => { const a = luminance(text), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
      const background = getComputedStyle(document.querySelector('.web-sidebar')!).backgroundColor;
      return [ratio(getComputedStyle(document.querySelector('.thread-row-title')!).color, background), ratio(getComputedStyle(document.querySelector('.thread-source')!).color, background)];
    });
    for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
    await capture(page, `${view.name}-sidebar`);
    await page.getByRole("button", { name: /对比原生和网页体验/ }).first().click();
    const input = page.getByRole("textbox", { name: "向 Codex 提问" });
    await expect(input).toBeVisible();
    await expect(page.locator('.assistant-message')).toContainText("让对话更容易阅读");
    await page.locator('.conversation-scroll').evaluate(node => { node.scrollTop = 0; });
    await capture(page, `${view.name}-conversation`);
    const conversation = await page.evaluate(() => {
      const bubble = document.querySelector('.user-bubble')!.getBoundingClientRect();
      const composer = document.querySelector('.composer')!.getBoundingClientRect();
      const input = document.querySelector('.composer textarea')!.getBoundingClientRect();
      const send = document.querySelector('.send-button')!.getBoundingClientRect();
      const markdown = document.querySelector('.assistant-message')!;
      return { bubbleWidth: bubble.width, composerWidth: composer.width, inputWidth: input.width, sendHeight: send.height, font: parseFloat(getComputedStyle(markdown).fontSize), overflow: document.documentElement.scrollWidth - innerWidth };
    });
    expect(conversation.sendHeight).toBeGreaterThanOrEqual(44);
    expect(conversation.inputWidth).toBeGreaterThanOrEqual(view.width >= 700 ? 500 : 180);
    expect(conversation.font).toBeGreaterThanOrEqual(17 * view.scale - .1);
    expect(conversation.overflow).toBeLessThanOrEqual(0);
    if (view.scale === 1) expect(conversation.bubbleWidth).toBeLessThan(conversation.composerWidth / 2);
    await input.fill("共同草稿\n继续输入第二行\n第三行\n第四行\n第五行");
    await expect(page.getByRole("button", { name: "最大化输入框" })).toBeVisible();
    await page.getByRole("button", { name: "最大化输入框" }).click();
    await input.press("Escape");
    await expect(input).toHaveValue("共同草稿\n继续输入第二行\n第三行\n第四行\n第五行");
    await page.locator('.conversation-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
    const tail = await page.evaluate(() => {
      const timeline = document.querySelector('.timeline')!;
      const composer = document.querySelector('.composer-wrap')!.getBoundingClientRect();
      return { padding: parseFloat(getComputedStyle(timeline).paddingBottom), height: composer.height };
    });
    expect(tail.padding).toBeGreaterThan(tail.height);
  });
}

test("搜索无结果可以清除，侧边栏关闭后保留草稿", async ({ page }) => {
  await fixture(page);
  await page.getByRole("textbox", { name: "搜索聊天" }).fill("不存在");
  await expect(page.getByText("没有匹配的对话", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清除搜索", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "搜索聊天" })).toHaveValue("");
  await page.getByRole("button", { name: /对比原生和网页体验/ }).first().click();
  const input = page.getByRole("textbox", { name: "向 Codex 提问" });
  await input.fill("不发送的比较草稿");
  await page.getByRole("button", { name: "打开会话列表" }).click();
  await page.getByRole("textbox", { name: "搜索聊天" }).fill("比较");
  await page.locator('.sidebar-close').click();
  await expect(input).toHaveValue("不发送的比较草稿");
  await page.getByRole("button", { name: "打开会话列表" }).click();
  await expect(page.getByRole("textbox", { name: "搜索聊天" })).toHaveValue("");
});

test("边栏管理只显示一个弹层，Tab循环与Escape关闭恢复焦点", async ({ page }) => {
  await fixture(page);
  const manage = page.getByRole("button", { name: "会话详情操作" }).first();
  await manage.click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toContainText("对比原生和网页体验");
  await capture(page, "sidebar-management");
  const dialog = page.getByRole("dialog");
  const actions = dialog.getByRole("button");
  await actions.last().focus();
  await page.keyboard.press("Tab");
  await expect(actions.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(manage).toBeFocused();
});
