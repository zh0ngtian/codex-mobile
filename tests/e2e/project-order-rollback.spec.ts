import { expect, test } from "./http-fixture";

test("回退项目拖动排序后忽略旧缓存并恢复新聊天顺序", async ({ page }) => {
  test.setTimeout(30_000);
  await page.route("**/api/projects*", (route) => route.fulfill({ json: {
    projects: ["/tmp/alpha", "/tmp/beta", "/tmp/gamma"], projectlessThreadIds: [],
  } }));
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:list-backend", "current-origin");
    localStorage.setItem("codex-mobile:project-order", JSON.stringify({ "current-origin": ["/tmp/gamma", "/tmp/alpha", "/tmp/beta"] }));
    class ProjectOrderSocket extends EventTarget {
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
          initialize: {}, "thread/list": { data: [], nextCursor: null },
          "model/list": { data: [{ model: "gpt-test", displayName: "GPT Test", isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] },
          "config/read": { config: { sandbox_mode: "workspace-write" } },
          "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] },
          "account/rateLimits/read": {}, "skills/list": { data: [] }, "plugin/installed": { marketplaces: [] },
        };
        setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: request.id, result: responses[request.method] ?? {} }) })), 0);
      }
      close() { this.readyState = 3; this.dispatchEvent(new CloseEvent("close")); }
    }
    (window as any).WebSocket = ProjectOrderSocket;
  });
  await page.goto("/");
  await expect(page.locator(".project-heading span")).toHaveText(["alpha", "beta", "gamma"]);
  await expect(page.getByRole("button", { name: "调整项目顺序" })).toHaveCount(0);
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await expect(page.getByLabel("选择项目").locator("option")).toHaveText(["无项目", "alpha", "beta", "gamma"]);
  await page.reload();
  await expect(page.locator(".project-heading span")).toHaveText(["alpha", "beta", "gamma"]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
