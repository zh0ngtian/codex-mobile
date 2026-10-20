import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/native-menu/index.html");
  await page.getByRole("button", { name: "打开 Skill 选择验收" }).tap();
});

test("触摸选择 Skill 保留草稿并插入调用标记", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "向 Codex 提问" });
  await input.fill("请用 @pdf");
  await page.getByRole("option").tap();
  await expect(input).toHaveValue("请用 $pdf ");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("中文紧邻 @ 可以打开并选择 Skill", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "向 Codex 提问" });
  await input.fill("请用@pdf");
  await expect(page.getByRole("option")).toBeVisible();
  await page.getByRole("option").tap();
  await expect(input).toHaveValue("请用$pdf ");
});

test("滚动候选列表后仍可选择 Skill", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "向 Codex 提问" });
  await input.fill("@");
  const list = page.getByRole("listbox");
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.getByRole("option").last().tap();
  await expect(input).toHaveValue("$skill-7 ");
});

test("最大化输入框支持触摸选择 Skill", async ({ page }) => {
  await page.getByRole("button", { name: "最大化输入框" }).tap();
  const input = page.getByRole("textbox", { name: "向 Codex 提问" });
  await input.fill("@pdf");
  await page.getByRole("option").tap();
  await expect(input).toHaveValue("$pdf ");
});
