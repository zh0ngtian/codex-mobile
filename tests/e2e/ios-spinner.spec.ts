import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`加载和运行图标持续旋转，减少动态效果=${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setContent(`
      <div style="padding: 30px; display: flex; gap: 24px; align-items: center">
        <span><i id="action" class="action-spinner"></i></span>
        <button class="backend-pill"><i id="backend" class="action-spinner backend-loading"></i></button>
        <button class="project-more"><i id="project" class="action-spinner"></i></button>
        <span class="thread-running"><i id="running" class="running-spinner"></i></span>
        <i id="refresh" class="sidebar-refresh-spinner"></i>
        <i id="stream" class="stream-character-spinner"></i>
        <button id="send" class="send-button send-button-running"></button>
      </div>
      <div class="thread-row-skeleton"><i id="skeleton"></i></div>
    `);
    await page.addStyleTag({ content: readFileSync("src/styles.css", "utf8") });
    // 包含普通行内父元素，避免 flex/grid 自动 blockify 掩盖不可变换的 i。
    if (reducedMotion === "no-preference") {
      expect(await page.locator("#action").evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(18);
    }
    const states = () => page.evaluate(() =>
      ["action", "backend", "project", "running", "refresh", "stream", "send"].map((id) => {
        const style = getComputedStyle(document.getElementById(id)!, id === "send" ? "::before" : null);
        return { id, animation: style.animationName, transform: style.transform, duration: parseFloat(style.animationDuration) };
      }),
    );
    const before = await states();
    for (const state of before) {
      expect(state.animation, state.id).not.toBe("none");
    }
    for (const state of before) {
      if (reducedMotion === "reduce") expect(state.duration, state.id).toBeGreaterThanOrEqual(1.6);
    }
    await expect.poll(async () => (await states()).map((state, index) =>
      state.transform !== "none" && state.transform !== before[index].transform,
    )).toEqual(before.map(() => true));
    // 验证 WebKit 的渐变、mask 与 transform 组合确实更新像素。
    const firstFrame = await page.screenshot({ clip: { x: 0, y: 0, width: 400, height: 120 }, animations: "allow" });
    await expect.poll(async () => !firstFrame.equals(await page.screenshot({
      clip: { x: 0, y: 0, width: 400, height: 120 }, animations: "allow",
    }))).toBe(true);
    if (reducedMotion === "reduce") {
      expect(await page.locator("#skeleton").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    }
  });
}
