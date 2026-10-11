import { expect, test } from "./http-fixture";

test("最终回答显示短回合用时并适配窄屏大字号", async ({ page }) => {
  await page.addInitScript(() => {
    const thread = { id: "file-stats", preview: "最终回答用时", status: { type: "idle" }, turns: [{
      id: "edit-turn", status: "completed", startedAt: 1791673200, completedAt: 1791673223, items: [
        { id: "user", type: "userMessage", text: "检查用时" },
        { id: "final", type: "agentMessage", phase: "final_answer", text: "任务已完成。" },
      ],
    }] };
    class FileStatsSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;
      constructor() {
        super();
        setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }, 0);
      }
      send(raw: string) {
        const request = JSON.parse(raw);
        if (request.id == null) return;
        const responses: Record<string, unknown> = {
          initialize: {},
          "model/list": { data: [{ model: "gpt-test", displayName: "GPT Test", isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] },
          "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] },
          "config/read": { config: { sandbox_mode: "workspace-write" } },
          "thread/list": { data: [thread] },
          "thread/resume": { thread },
          "thread/read": { thread },
          "thread/turns/list": { data: thread.turns, nextCursor: null },
        };
        setTimeout(() => this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify({ id: request.id, result: responses[request.method] ?? {} }),
        })), 0);
      }
      close() { this.readyState = 3; this.dispatchEvent(new CloseEvent("close")); }
    }
    (window as any).WebSocket = FileStatsSocket;
  });
  await page.goto("/");
  await page.getByRole("button", { name: /最终回答用时/ }).click();
  const duration = page.locator(".final-answer-duration");
  await expect(duration).toHaveText("用时 23秒");
  await expect(page.locator(".final-answer-timestamp")).toBeVisible();
  for (const width of [320, 375, 412]) {
    await page.setViewportSize({ width, height: 812 });
    await page.evaluate(() => document.documentElement.style.setProperty("--app-font-scale", "1.25"));
    await duration.scrollIntoViewIfNeeded();
    await expect(duration).toBeVisible();
    const bounds = await duration.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { right: box.right, left: box.left, viewport: innerWidth, scroll: document.documentElement.scrollWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.viewport);
  }
  await page.locator(".turn-card").screenshot({ path: ".mobile-build/final-answer-duration.png" });
  await expect(page.getByRole("button", { name: "复制本回合 AI 消息" })).toBeVisible();
});
