import { expect, test, type Page } from "@playwright/test";

const fenced = (source: string) => `\`\`\`mermaid\n${source}\n\`\`\``;

async function show(page: Page, text: string) {
  await page.evaluate(async (text) => {
    const path = "/tests/e2e/fixtures/mermaid.tsx";
    const { showMarkdown } = await import(/* @vite-ignore */ path);
    showMarkdown(text);
  }, text);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("codex-mobile:language", "zh-CN"));
  await page.goto("/tests/e2e/fixtures/mermaid.html");
});

test("真实 Mermaid 渲染中文流程图与时序图，手机布局与源码复制正常", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const flow = "flowchart TD\n A[用户提问] --> B{需要工具?}\n B -->|是| C[调用工具]\n B -->|否| D[生成回复]\n C --> D";
  const sequence = "sequenceDiagram\n participant 用户\n participant Codex\n 用户->>Codex: 修复 Mermaid\n Codex-->>用户: 完成";
  await show(page, "## Mermaid 示例\n\n" + fenced(flow) + "\n\n" + fenced(sequence));
  const diagrams = page.getByRole("img", { name: "Mermaid 图表" });
  await expect(diagrams).toHaveCount(2);
  await expect(diagrams.first().locator("svg")).toBeVisible();
  await expect(diagrams.first()).toContainText("用户提问");
  await expect(diagrams.nth(1)).toContainText("修复 Mermaid");
  expect(await diagrams.evaluateAll((elements) => new Set(elements.map((element) => element.querySelector("svg")!.id)).size)).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/mermaid-mobile.png", fullPage: true });

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "复制代码块" }).first().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(flow);
  await page.getByRole("button", { name: "查看源码" }).first().click();
  await expect(page.locator("pre code").first()).toHaveText(flow);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(diagrams).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("未完整和非法语法保留源码，流式补全自动恢复且不遗留错误 SVG", async ({ page }) => {
  await show(page, fenced("flowchart TD\n A-->"));
  await expect(page.getByText("图表暂时无法渲染，显示源码")).toBeVisible();
  await expect(page.locator("pre code")).toContainText("A-->");
  await expect(page.locator("body > div:not(#root) svg")).toHaveCount(0);
  await show(page, "```mermaid\nflowchart TD\n A[开始] --> B[结束]");
  await expect(page.getByRole("img", { name: "Mermaid 图表" })).toContainText("结束");
  await expect(page.getByText("图表暂时无法渲染，显示源码")).toHaveCount(0);
  await show(page, fenced("flowchart TD\n A[新开始] --> B[新结束]"));
  await expect(page.getByRole("img", { name: "Mermaid 图表" })).toContainText("新结束");
});

test("图表内容不能注入脚本或触发点击回调", async ({ page }) => {
  const alerts: string[] = [];
  page.on("dialog", async (dialog) => { alerts.push(dialog.message()); await dialog.dismiss(); });
  await show(page, fenced('flowchart TD\n A["<img src=x onerror=alert(1)>"] --> B[安全]\n click B call alert("injected")'));
  const diagram = page.getByRole("img", { name: "Mermaid 图表" });
  await expect(diagram).toBeVisible();
  await expect(diagram.locator("script, img, [onerror], [onclick]")).toHaveCount(0);
  await diagram.locator(".clickable").click();
  expect(alerts).toEqual([]);
});
