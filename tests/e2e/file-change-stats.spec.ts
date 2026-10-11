import { expect, test } from "./http-fixture";

test("编辑卡片默认显示逐文件统计并支持窄屏与 Diff 定位", async ({ page }) => {
  await page.addInitScript(() => {
    const thread = { id: "file-stats", preview: "逐文件统计", status: { type: "idle" }, turns: [{
      id: "edit-turn", status: "completed", items: [
        { id: "user", type: "userMessage", text: "修改这两个文件" },
        { id: "edit", type: "fileChange", status: "completed", changes: [
          { path: "/tmp/project/very-long-directory-name/another-long-directory/src/App.tsx", diff: "@@ -1 +1,2 @@\n-old\n+new\n+extra" },
          { path: "/tmp/project/docs/mobile-diff-design.md", diff: "@@ -0,0 +1 @@\n+# 移动端 Diff" },
        ] },
        { id: "final", type: "agentMessage", phase: "final_answer", text: "修改完成" },
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
  await page.getByRole("button", { name: /逐文件统计/ }).click();
  const editFiles = page.locator(".file-change-file");
  await expect(editFiles).toHaveCount(2);
  await expect(editFiles.first()).toContainText("+2-1");
  await expect(editFiles.nth(1)).toContainText("+1-0");
  await expect(editFiles.first()).toBeVisible();
  const originalViewport = page.viewportSize()!;
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }]) {
    await page.setViewportSize(viewport);
    const dimensions = await editFiles.first().evaluate((element) => {
      const stats = element.querySelector(".file-change-stats")!.getBoundingClientRect();
      const row = element.getBoundingClientRect();
      return { height: row.height, right: stats.right, viewport: innerWidth, scroll: document.documentElement.scrollWidth };
    });
    expect(dimensions.height).toBeGreaterThanOrEqual(44);
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await editFiles.first().scrollIntoViewIfNeeded();
  await page.locator(".file-change-activity").screenshot({ path: ".mobile-build/per-file-edits.png" });
  await page.setViewportSize(originalViewport);
  await editFiles.nth(1).click();
  await expect(page.locator(".file-diff-heading").nth(1)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".file-diff-heading").first()).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "关闭文件修改" }).click();
  await expect(page.locator(".turn-change-summary")).toContainText("本次代码改动 4 行");
  await expect(page.locator(".file-change-file")).toHaveCount(2);
});
