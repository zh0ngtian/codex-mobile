import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// 使用项目真实 CSS，独立验证原生设置变化后的实际渲染字重。
test("iOS 系统粗体文本覆盖正文和显式字重，并能反复恢复", async ({ page }) => {
  await page.setContent(`
    <p id="body">中文正文 Body <strong id="strong">强调文字</strong></p>
    <button id="button" class="new-chat">新聊天</button>
    <input id="input" value="输入文字" />
    <textarea id="textarea">消息内容</textarea>
    <div class="tool-activity-rows"><button><strong id="tool">工具标题</strong></button></div>
    <h1 id="heading">标题</h1>
    <pre><code id="code">const value = 1;</code></pre>
  `);
  await page.addStyleTag({ content: readFileSync("src/styles.css", "utf8") });
  const weights = () => page.evaluate(() =>
    ["body", "strong", "button", "input", "textarea", "tool", "heading", "code"].map(
      (id) => Number(getComputedStyle(document.getElementById(id)!).fontWeight),
    ),
  );
  const normal = [400, 700, 650, 400, 400, 450, 700, 400];
  await expect.poll(weights).toEqual(normal);
  for (let i = 0; i < 2; i += 1) {
    await page.evaluate(() => document.documentElement.setAttribute("data-ios-bold-text", "true"));
    await expect.poll(weights).toEqual(normal.map((weight) => Math.min(900, weight + 200)));
    await page.evaluate(() => document.documentElement.setAttribute("data-ios-bold-text", "false"));
    await expect.poll(weights).toEqual(normal);
  }
});
