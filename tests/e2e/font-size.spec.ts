import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.setTimeout(25_000);

test("四档字号按比例覆盖正文、列表、输入和代码，保持移动布局", async ({ page }) => {
  await page.setContent(`
    <main class="conversation"><h1>中文标题</h1>
      <div class="assistant-message" id="message">中文正文 <strong>强调</strong><pre><code id="code">const value = 1;</code></pre></div>
      <div class="user-bubble" id="user">用户消息</div>
      <time class="message-timestamp" id="time">15:30</time><div class="mermaid-toolbar" id="toolbar">图表源码</div>
      <button class="thread-row" id="thread">会话标题</button>
      <div class="composer"><textarea id="input">输入文字</textarea></div>
    </main>`);
  await page.addStyleTag({ content: readFileSync("src/styles.css", "utf8") });
  await page.addStyleTag({ content: readFileSync("src/features/conversation/timeline-timestamps.css", "utf8") + readFileSync("src/ui/mermaid.css", "utf8") });
  const sizes = () => page.evaluate(() => ["message", "user", "thread", "input", "code", "time", "toolbar"].map(
    (id) => parseFloat(getComputedStyle(document.getElementById(id)!).fontSize),
  ));
  const standard = await sizes();
  for (const scale of [0.875, 1.125, 1.25, 1]) {
    await page.evaluate((value) => document.documentElement.style.setProperty("--app-font-scale", String(value)), scale);
    await expect.poll(sizes).toEqual(standard.map((size) => size * scale));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("真实设置入口立即调整，并在刷新后恢复字号", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    localStorage.setItem("codex-mobile.backend-registry.v1", JSON.stringify({ version: 1, selectedBackendId: "test", backends: [{ id: "test", name: "测试设备", baseUrl: "http://127.0.0.1:4173", token: "", enabled: false, order: 0 }] }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "管理设备", exact: true }).click();
  const standard = await page.getByRole("heading", { name: "管理设备", exact: true }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await page.getByRole("button", { name: "特大", exact: true }).click();
  await expect.poll(() => page.getByRole("heading", { name: "管理设备", exact: true }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(standard * 1.25);
  await page.screenshot({ path: ".mobile-build/font-size-settings.png" });
  await page.reload();
  await page.getByRole("button", { name: "管理设备", exact: true }).click();
  await expect(page.getByRole("button", { name: "特大", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBe(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "标准", exact: true }).click();
  await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBe(16);
});
