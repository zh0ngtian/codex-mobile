import { expect, test } from "@playwright/test";

test("附件加号在圆形按钮中水平和垂直居中", async ({ page }) => {
  await page.goto("/tests/fixtures/native-menu/index.html");
  await page.getByRole("button", { name: "打开 Skill 选择验收" }).tap();
  const button = page.getByRole("button", { name: "添加附件" });
  await expect(button.locator("svg")).toBeVisible();
  const geometry = await button.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const svg = el.querySelector("svg")!;
    const bounds = svg.getBBox();
    const center = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(svg.getScreenCTM()!);
    return { width: rect.width, height: rect.height, x: center.x - rect.x - rect.width / 2, y: center.y - rect.y - rect.height / 2 };
  });
  expect(geometry.width).toBe(34);
  expect(geometry.height).toBe(44);
  expect(Math.abs(geometry.x)).toBeLessThan(0.5);
  expect(Math.abs(geometry.y)).toBeLessThan(0.5);
  await page.screenshot({ path: ".mobile-build/web-composer-plus-centered.png" });
});

test("正文自然增高到六行，长输入内部滚动、自动折行和删除缩回", async ({ page }) => {
  await page.goto("/tests/fixtures/native-menu/index.html");
  await page.getByRole("button", { name: "打开 Skill 选择验收" }).tap();
  const input = page.getByRole("textbox", { name: "向 Codex 提问" });
  const height = () => input.evaluate(el => el.getBoundingClientRect().height);
  const initial = await height();
  const tools = page.locator(".composer-tools");
  await expect(page.getByRole("button", { name: "最大化输入框" })).toHaveCount(0);
  await input.fill("第一行\n第二行\n第三行");
  await expect.poll(height).toBeCloseTo(initial * 3, 0);
  await page.screenshot({ path: ".mobile-build/web-composer-three-lines.png" });
  await input.fill("一二三四五六七八九十".repeat(12));
  await expect.poll(height).toBeGreaterThan(initial * 3);
  const longText = Array.from({ length: 15 }, (_, i) => `第 ${i + 1} 行输入`).join("\n");
  await input.fill(longText);
  await expect.poll(height).toBeCloseTo(initial * 6, 0);
  expect(await input.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  const inputBox = (await input.boundingBox())!;
  const toolsBox = (await tools.boundingBox())!;
  expect(inputBox.y + inputBox.height).toBeLessThan(toolsBox.y);
  await input.press("x");
  await expect.poll(() => input.evaluate(el => el.scrollTop + el.clientHeight - el.scrollHeight)).toBeGreaterThanOrEqual(-1);
  await expect(input).toHaveValue(longText + "x");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeInViewport();
  await page.screenshot({ path: ".mobile-build/web-composer-long.png" });
  await input.fill("短输入");
  await expect.poll(height).toBeCloseTo(initial, 0);
  await input.fill("");
  await expect.poll(height).toBeCloseTo(initial, 0);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  // 容器变宽也须重新测量折行，不能只根据换行符或输入事件决定高度。
  await input.fill("自动折行内容".repeat(9));
  const wrapped = await height();
  await page.locator(".composer-wrap").evaluate(el => { el.style.width = "600px"; });
  await expect.poll(height).toBeLessThan(wrapped);
});

test("工具行按原生顺序显示，独立菜单和 Fast 将真实配置交给发送", async ({ page }) => {
  const calls: Array<{ method: string; params: any }> = [];
  await page.addInitScript(() => localStorage.setItem("codex-mobile:language", "zh-CN"));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/host") return route.fulfill({ json: { hostId: "composer", gatewayVersion: "0.3.0", appServerReady: true, httpPolling: true } });
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: ["/fixture"], projectlessThreadIds: [] } });
    if (url.pathname === "/api/events") return route.fulfill({ json: { epoch: "composer", cursor: 0, messages: [], requests: [], active: false, updatedAt: Date.now(), reset: false } });
    if (url.pathname !== "/api/rpc") return route.fulfill({ json: {} });
    const { message } = route.request().postDataJSON();
    calls.push(message);
    if (message.method === "thread/list" && message.params?.sectionId) return route.fulfill({ json: { id: message.id, result: { data: [], nextCursor: null } } });
    const result: Record<string, unknown> = {
      "mobile/sidebar/summaries": { data: [], nextCursor: null },
      "mobile/sidebar/projectless": { data: [], nextCursor: null },
      "threadSection/list": { data: [{ id: "01984de2-8f74-7c91-a3b2-5c5e937cf318" }], nextCursor: null },
      "thread/list": { data: [], nextCursor: null },
      "model/list": { data: [
        { id: "test", model: "test", displayName: "Test", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "平衡" }, { reasoningEffort: "high", description: "深入" }], serviceTiers: [{ id: "priority", name: "Fast", description: "更快" }] },
        { id: "plain", model: "plain", displayName: "Plain", supportedReasoningEfforts: [], serviceTiers: [] },
      ] },
      "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }, { id: ":danger-full-access", allowed: true }] },
      "config/read": { config: { model: "test", sandbox_mode: "workspace-write", model_reasoning_effort: "medium" } },
      "thread/start": { thread: { id: "composer-thread", cwd: "/fixture", status: { type: "idle" }, turns: [] } },
      "turn/start": { turn: { id: "composer-turn", status: "inProgress", items: [] } },
      "thread/turns/list": { data: [], nextCursor: null },
    };
    return route.fulfill({ json: { id: message.id, result: result[message.method] ?? {} } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  const tools = page.locator(".composer-tools");
  await expect(tools.locator("button")).toHaveCount(6);
  expect(await tools.locator("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label"))))
    .toEqual(["添加附件", "选择审批与权限模式", "选择模型", "思考强度", "速度", "发送"]);
  expect(await tools.locator("button:not(.send-button)").evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 44))).toBe(true);
  const model = page.getByRole("button", { name: "选择模型", exact: true });
  const effort = page.getByRole("button", { name: "思考强度", exact: true });
  const speed = page.getByRole("button", { name: "速度", exact: true });
  await model.click();
  const menu = page.getByRole("dialog", { name: "模型", exact: true });
  await expect(menu.locator(".effort-options")).toHaveCount(0);
  await menu.getByRole("button", { name: /Plain/ }).click();
  await expect(effort).toBeDisabled();
  await expect(speed).toBeDisabled();
  await model.click();
  await page.getByRole("dialog").getByRole("button", { name: /Test/ }).click();
  await expect(effort).toBeEnabled();
  await effort.click();
  await page.getByRole("dialog", { name: "思考强度", exact: true }).getByRole("button", { name: /high/ }).click();
  await expect(effort).toHaveText("high");
  await speed.click();
  await expect(speed).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await speed.click();
  await expect(speed).toHaveAttribute("aria-pressed", "false");
  await speed.click();
  await page.getByRole("button", { name: "选择审批与权限模式" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /完全访问/ }).click();
  await model.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const input = page.getByRole("textbox", { name: "向 Codex 提问" });
  await input.fill("多行草稿");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("多行草稿\n");
  await page.screenshot({ path: ".mobile-build/web-composer-tools.png" });
  await input.press("Enter");
  await expect.poll(() => calls.filter(call => call.method === "turn/start").length).toBe(1);
  expect(calls.find(call => call.method === "thread/start")?.params).toMatchObject({ model: "test", serviceTier: "priority", permissions: ":danger-full-access" });
  expect(calls.find(call => call.method === "turn/start")?.params).toMatchObject({ effort: "high", serviceTier: "priority" });
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
});
