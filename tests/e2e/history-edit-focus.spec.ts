import { expect, test } from "@playwright/test";

test("历史编辑聚焦、页面无横向滚动、取消后侧栏恢复", async ({ page }, testInfo) => {
  const thread = { id: "history-focus", name: "历史编辑焦点", cwd: "/tmp/project", status: { type: "idle" }, turns: [{
    id: "old-turn", status: "completed", items: [
      { id: "old-user", type: "userMessage", text: "历史原文" },
      { id: "old-answer", type: "agentMessage", phase: "final_answer", text: Array.from({ length: 60 }, (_, i) => `旧回复段落 ${i}`).join("\n\n") },
    ],
  }] };
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    window.addEventListener("click", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[aria-label="编辑历史消息"]')) return;
      (window as any).__historyEditFocusAtClickEnd = document.activeElement?.getAttribute("aria-label");
    });
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: ["/tmp/project"], projectlessThreadIds: [] } });
    if (url.pathname === "/api/host") return route.fulfill({ json: { hostId: "focus-host", gatewayVersion: "0.2.147", appServerReady: true, httpPolling: true } });
    if (url.pathname === "/api/events") return route.fulfill({ json: { epoch: "focus", cursor: 0, messages: [], requests: [], active: false, updatedAt: Date.now(), reset: false } });
    if (url.pathname !== "/api/rpc") return route.fulfill({ json: {} });
    const { message } = route.request().postDataJSON();
    const responses: Record<string, unknown> = {
      initialize: {},
      "model/list": { data: [{ id: "gpt-test", model: "gpt-test", displayName: "GPT Test", isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] },
      "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] },
      "config/read": { config: { sandbox_mode: "workspace-write" } },
      "thread/list": { data: [thread], nextCursor: null },
      "thread/resume": { thread, initialTurnsPage: { data: thread.turns, nextCursor: null } },
      "thread/turns/list": { data: thread.turns, nextCursor: null },
    };
    return route.fulfill({ json: { id: message.id, result: responses[message.method] ?? {} } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /历史编辑焦点/ }).first().click();
  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("保留底部草稿");
  await page.getByRole("button", { name: "编辑历史消息", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "编辑历史消息内容" });
  expect(await page.evaluate(() => (window as any).__historyEditFocusAtClickEnd)).toBe("编辑历史消息内容");
  await expect(editor).toBeFocused();
  await page.keyboard.insertText("追加");
  await expect(editor).toHaveValue("历史原文追加");
  for (const width of [280, 320, 393]) {
    await page.setViewportSize({ width, height: 812 });
    await page.evaluate(() => document.documentElement.style.setProperty("--app-font-scale", "1.25"));
    const bounds = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>(".conversation-scroll")!;
      const root = document.documentElement;
      return { pageWidth: root.scrollWidth, viewport: innerWidth,
        scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth,
        rootOverflow: getComputedStyle(root).overflowX,
        overscroll: getComputedStyle(root).overscrollBehaviorX };
    });
    expect(bounds.pageWidth).toBeLessThanOrEqual(bounds.viewport);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
    expect(bounds.overscroll).toBe("none");
    expect(["clip", "hidden"]).toContain(bounds.rootOverflow);
  }
  await page.setViewportSize({ width: 393, height: 812 });
  const scroller = page.locator(".conversation-scroll");
  await scroller.evaluate(el => el.scrollTo(0, 0));
  // Playwright 的 mobile WebKit 不支持 wheel；真实触摸由 iOS XCUITest 验证。
  if (testInfo.project.name !== "webkit-mobile") {
    const scrollBounds = (await scroller.boundingBox())!;
    await page.mouse.move(scrollBounds.x + scrollBounds.width / 2, scrollBounds.y + scrollBounds.height / 2);
    for (const direction of [-1, 1]) {
      await page.mouse.wheel(direction * 300, 0);
      expect(await scroller.evaluate(el => el.scrollLeft)).toBe(0);
      expect(await page.evaluate(() => scrollX)).toBe(0);
    }
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  }
  await scroller.evaluate(el => el.scrollTo(0, 0));
  const swipe = async (from: number, to: number) => {
    await page.locator(".conversation-header").evaluate((target, points) => {
      for (const [type, x] of [["touchstart", points[0]], ["touchmove", points[1]], ["touchend", points[1]]] as const) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: 100 }] });
        target.dispatchEvent(event);
      }
    }, [from, to]);
  };
  await swipe(40, 240);
  await expect(page.locator(".conversation-sidebar-layer")).not.toHaveClass(/open|dragging/);
  await swipe(240, 40);
  await expect(page.locator(".conversation-sidebar-layer")).not.toHaveClass(/open|dragging/);
  await expect(editor).toBeFocused();
  await page.getByRole("button", { name: "取消编辑历史消息" }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "向 Codex 提问" })).toHaveValue("保留底部草稿");
  await swipe(40, 240);
  await expect(page.locator(".conversation-sidebar-layer")).toHaveClass(/open/);
});
