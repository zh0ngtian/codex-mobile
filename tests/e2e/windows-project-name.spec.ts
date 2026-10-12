import { expect, test } from "@playwright/test";

const projects = [
  "C:\\Users\\Fanding\\Projects\\codex-mobile\\",
  String.raw`\\server\share\mobile-demo`,
  "D:\\Work/mixed-app\\/",
  "/Users/me/unix-app/",
];
const names = ["codex-mobile", "mobile-demo", "mixed-app", "unix-app"];

test("Windows 项目显示短名称，新聊天继续使用完整工作目录", async ({ page }) => {
  const startedCwds: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    localStorage.setItem("codex-mobile:list-backend", "test");
    localStorage.setItem("codex-mobile.backend-registry.v1", JSON.stringify({
      version: 1, selectedBackendId: "test",
      backends: [{ id: "test", name: "Windows", baseUrl: location.origin, token: "", enabled: true, order: 0 }],
    }));
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/host") return route.fulfill({ json: { hostId: "test", displayName: "Windows", hostname: "windows", gatewayVersion: "0.2.0", appServerReady: true, httpPolling: true } });
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects, projectlessThreadIds: [] } });
    if (url.pathname === "/api/events") return route.fulfill({ json: { epoch: "project-name-test", cursor: 0, messages: [], requests: [], active: false, reset: false, updatedAt: Date.now() } });
    if (url.pathname !== "/api/rpc") return route.fulfill({ json: {} });
    const { message } = route.request().postDataJSON();
    if (message.method === "thread/start") startedCwds.push(message.params.cwd);
    const responses: Record<string, unknown> = {
      "thread/list": { data: [], nextCursor: null },
      "thread/start": { thread: { id: "created-thread", cwd: message.params?.cwd, turns: [], status: { type: "idle" } }, model: "test", approvalPolicy: "on-request", approvalsReviewer: "user" },
      "turn/start": { turn: { id: "test-turn", status: "inProgress", items: [] } },
      "model/list": { data: [{ id: "test", model: "test", displayName: "Test", isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] },
      "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] },
      "config/read": { config: { model: "test", sandbox_mode: "workspace-write" } },
    };
    return route.fulfill({ json: { id: message.id, result: responses[message.method] ?? {} } });
  });
  await page.goto("/");
  await expect(page.locator(".project-heading span")).toHaveText(names);
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  const projectSelector = page.getByLabel("选择项目");
  await expect(projectSelector.locator("option")).toHaveText(["无项目", ...names]);
  await projectSelector.selectOption(projects[1]);
  await expect(projectSelector).toHaveValue(projects[1]);
  await expect(page.locator(".thread-heading span")).toHaveText("Windows · mobile-demo · 已连接");
  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("测试项目目录");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => startedCwds).toEqual([projects[1]]);
  await expect(page.locator(".thread-heading span")).toHaveText("Windows · mobile-demo · 已连接");
});
