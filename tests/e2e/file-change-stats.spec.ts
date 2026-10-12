import { expect, test } from "./http-fixture";

test("编辑过程只显示总改动并支持窄屏与原 Diff 入口", async ({ page }) => {
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
  await expect(page.locator(".turn-change-summary")).toContainText("本次代码改动 4 行");
  await expect(page.locator(".turn-change-summary")).toContainText("+3-1");
  await expect(page.locator(".file-change-file")).toHaveCount(0);
  await page.getByRole("button", { name: "之前的 1 条消息" }).click();
  await expect(page.locator(".file-change-activity")).toHaveCount(0);
  const activity = page.locator(".tool-activity");
  await expect(activity.locator("summary")).toContainText("已更改 2 个文件");
  await expect(activity.locator("summary")).toContainText("+3-1");
  await activity.locator("summary").click();
  await page.getByRole("button", { name: "已编辑 2 个文件", exact: true }).click();
  await expect(page.locator(".file-diff-heading")).toHaveCount(2);
  await expect(page.locator(".file-diff-heading").first()).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "关闭文件修改" }).click();
  await page.getByRole("button", { name: "之前的 1 条消息" }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator(".turn-change-summary").scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".mobile-build/total-only.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
