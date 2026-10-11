import { expect, test, type Page, type Locator } from "@playwright/test";

const position = (locator: Locator) => locator.evaluate((element) => element.scrollTop);
async function wheel(page: Page, target: Locator, deltaY: number) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 40));
  await page.mouse.wheel(0, deltaY);
  // 原生合成滚动异步执行，等待其落定后再检查底层位置。
  await page.waitForTimeout(200);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/overlay-scroll.html");
  await page.getByRole("button", { name: "管理设备", exact: true }).click();
});

test("叠加弹层的实际滚轮只滚动顶层，遮罩与边界不改变底层位置", async ({ page }, info) => {
  test.skip(info.project.name === "touch", "移动触控在独立用例中验证");
  const background = page.locator(".conversation-scroll");
  const sidebar = page.locator(".thread-list-page");
  const manager = page.getByRole("dialog", { name: "管理设备" });
  const body = manager.locator(".action-sheet-body");
  await background.evaluate((element) => { element.scrollTop = 180; });
  await sidebar.evaluate((element) => { element.scrollTop = 120; });
  await wheel(page, body, 180);
  await expect.poll(() => position(body)).toBeGreaterThan(0);
  expect(await position(background)).toBe(180);
  expect(await position(sidebar)).toBe(120);
  await page.mouse.move(360, 50);
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(200);
  await wheel(page, manager.locator("header"), 180);
  await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const bottom = await position(body);
  await wheel(page, body, 180);
  expect(await position(body)).toBe(bottom);
  expect(await position(background)).toBe(180);
  expect(await position(sidebar)).toBe(120);
  await body.evaluate((element) => { element.scrollTop = 0; });
  await manager.getByRole("button", { name: "检查更新" }).click();
  const upper = page.getByRole("dialog", { name: "应用更新" });
  await wheel(page, upper.locator(".action-sheet-body"), 180);
  await expect.poll(() => position(upper.locator(".action-sheet-body"))).toBeGreaterThan(0);
  expect(await position(body)).toBe(0);
  await upper.getByRole("button", { name: "关闭", exact: true }).click();
  await wheel(page, body, 120);
  await expect.poll(() => position(body)).toBeGreaterThan(0);
  await manager.getByRole("button", { name: "关闭", exact: true }).click();
  expect(await position(sidebar)).toBe(120);
  await wheel(page, sidebar, 120);
  await expect.poll(() => position(sidebar)).toBeGreaterThan(120);
  expect(await position(background)).toBe(180);
  await page.getByRole("button", { name: "关闭侧栏" }).click({ position: { x: 370, y: 50 } });
  expect(await page.evaluate(() => document.documentElement.style.getPropertyPriority("overflow-y"))).toBe("important");
  await wheel(page, background, 120);
  await expect.poll(() => position(background)).toBeGreaterThan(180);
});

test("真实触摸在弹层内滚动、边界停止，弹层手势不关闭底层侧栏", async ({ page }, info) => {
  test.skip(info.project.name !== "touch", "使用 Chromium 原生触摸注入");
  const client = await page.context().newCDPSession(page);
  async function swipe(x: number, y: number, dx: number, dy: number) {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove", touchPoints: [{ x: x + dx * step / 8, y: y + dy * step / 8 }],
      });
      await page.waitForTimeout(20);
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(250);
  }
  const manager = page.getByRole("dialog", { name: "管理设备" });
  const body = manager.locator(".action-sheet-body");
  const background = page.locator(".conversation-scroll");
  const sidebar = page.locator(".thread-list-page");
  await background.evaluate((element) => { element.scrollTop = 180; });
  await sidebar.evaluate((element) => { element.scrollTop = 120; });
  const box = (await body.boundingBox())!;
  await swipe(190, box.y + 200, 0, -120);
  await expect.poll(() => position(body)).toBeGreaterThan(0);
  await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await swipe(190, box.y + 200, 0, -120);
  await swipe(190, 70, 0, -40);
  await swipe(250, box.y + 200, -140, 5);
  expect(await position(background)).toBe(180);
  expect(await position(sidebar)).toBe(120);
  await expect(page.locator(".conversation-sidebar-layer")).toHaveClass(/open/);
  await page.screenshot({ path: ".mobile-build/overlay-scroll-release/stacked.png" });
  await manager.getByRole("button", { name: "关闭", exact: true }).click();
  expect(await position(sidebar)).toBe(120);
  await swipe(190, 500, 0, -120);
  await expect.poll(() => position(sidebar)).toBeGreaterThan(120);
});
