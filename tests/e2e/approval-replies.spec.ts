import { expect, test } from "@playwright/test";

test("HTTP 请求队列保留失败草稿，下一条相同问题独立回答，并发送准确审批决策", async ({ page }) => {
  const question = (id: string) => ({ id, method: "item/tool/requestUserInput", params: { threadId: "thread", questions: [{ id: "same-question", header: "方案", question: "选择方案", isOther: true, isSecret: false, options: [{ label: "快速", description: "减少等待时间" }] }] } });
  const amendment = { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "example.com", action: "allow" } } };
  let requests: any[] = [question("first"), question("second"), { id: "command", method: "item/commandExecution/requestApproval", params: { threadId: "thread", command: "curl https://example.com", cwd: "/work/app", reason: "读取文档", availableDecisions: ["decline", amendment] } }];
  const replies: any[] = [];
  let firstFailure = true;
  let loaded = false;
  await page.addInitScript(() => {
    localStorage.setItem("codex-mobile:language", "zh-CN");
    localStorage.setItem("codex-mobile.backend-registry.v1", JSON.stringify({ version: 1, selectedBackendId: "test", backends: [{ id: "test", name: "测试设备", baseUrl: location.origin, token: "", enabled: true, order: 0 }] }));
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/host") return route.fulfill({ json: { hostId: "test", gatewayVersion: "0.2.0", appServerReady: true, httpPolling: true } });
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [], projectlessThreadIds: [] } });
    if (url.pathname === "/api/events") return route.fulfill({ json: { epoch: "approval-test", cursor: 0, messages: [], requests: loaded ? requests : [], active: true, updatedAt: Date.now(), reset: false } });
    if (url.pathname !== "/api/rpc") return route.fulfill({ json: {} });
    const { message } = route.request().postDataJSON();
    if (!message.method && message.id != null) {
      replies.push(message);
      if (firstFailure) { firstFailure = false; return route.fulfill({ json: { id: message.id, error: { code: -1, message: "审批暂时失败，请重试" } } }); }
      requests = requests.filter((entry) => entry.id !== message.id);
      return route.fulfill({ json: { id: message.id, result: null } });
    }
    if (message.method === "thread/list") loaded = true;
    const responses: Record<string, unknown> = {
      "thread/list": { data: [], nextCursor: null },
      "model/list": { data: [{ id: "test", model: "test", displayName: "Test", isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] },
      "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] },
      "config/read": { config: { model: "test", sandbox_mode: "workspace-write" } },
    };
    return route.fulfill({ json: { id: message.id, result: responses[message.method] ?? {} } });
  });
  await page.goto("/");
  await expect(page.getByText("减少等待时间")).toBeVisible();
  await page.getByRole("radio", { name: /其他/ }).check();
  await page.getByLabel("自定义回答：方案").fill("第一条自定义");
  await page.getByRole("button", { name: "提交回答" }).click();
  await expect(page.getByRole("alert")).toHaveText("审批暂时失败，请重试");
  await expect(page.getByLabel("自定义回答：方案")).toHaveValue("第一条自定义");
  await page.getByRole("button", { name: "提交回答" }).click();
  await expect(page.getByRole("button", { name: "提交回答" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: /快速/ })).not.toBeChecked();
  await page.getByRole("radio", { name: /快速/ }).check();
  await page.getByRole("button", { name: "提交回答" }).click();
  await expect(page.getByText("curl https://example.com")).toBeVisible();
  await expect(page.getByText("/work/app")).toBeVisible();
  await expect(page.getByRole("button", { name: "允许", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "允许并记住主机：example.com" }).click();
  await expect(page.getByRole("dialog", { name: "允许运行此操作？" })).toHaveCount(0);
  expect(replies).toEqual([
    { id: "first", result: { answers: { "same-question": { answers: ["第一条自定义"] } } } },
    { id: "first", result: { answers: { "same-question": { answers: ["第一条自定义"] } } } },
    { id: "second", result: { answers: { "same-question": { answers: ["快速"] } } } },
    { id: "command", result: { decision: amendment } },
  ]);
});
