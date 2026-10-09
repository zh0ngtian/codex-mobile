import { expect, test, type WebSocketRoute } from "@playwright/test";

for (const scenario of ["reconnect", "overlapping-refresh"] as const) {
  test(`会话最新内容不被旧快照覆盖：${scenario}`, async ({ page }) => {
    const oldTurn = { id: "turn-1", status: "completed", startedAt: 100, items: [
      { id: "u1", type: "userMessage", text: "上一轮问题" },
      { id: "a1", type: "agentMessage", phase: "final_answer", text: "上一轮回复" },
    ] };
    const latestTurn = { id: "turn-2", status: "completed", startedAt: 200, items: [
      { id: "u2", type: "userMessage", text: "最新问题" },
      { id: "a2", type: "agentMessage", phase: "final_answer", text: "完整的最新回复" },
    ] };
    const thread = { id: "refresh-thread", name: "刷新回退验证", cwd: "/tmp/project", status: { type: "idle" }, turns: [] };
    const sockets: WebSocketRoute[] = [];
    const pendingReads: Array<{ socket: WebSocketRoute; id: number }> = [];
    let resumeCount = 0;
    await page.addInitScript(() => {
      localStorage.setItem("codex-mobile:language", "zh-CN");
      localStorage.setItem("codex-mobile:transport-mode", "stream");
    });
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/host") return route.fulfill({ json: { hostId: "refresh-host", displayName: "Test", appServerReady: true, httpPolling: true } });
      if (path === "/api/projects") return route.fulfill({ json: { projects: [thread.cwd], projectlessThreadIds: [] } });
      return route.continue();
    });
    await page.routeWebSocket("**/ws**", (socket) => {
      sockets.push(socket);
      socket.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        if (message.id == null || !message.method) return;
        const responses: Record<string, unknown> = {
          initialize: {},
          "model/list": { data: [{ id: "gpt-test", model: "gpt-test", isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] },
          "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }] },
          "config/read": { config: { model: "gpt-test", sandbox_mode: "workspace-write" } },
          "thread/list": { data: [thread], nextCursor: null },
          "mobile/turns/details": { data: [] },
        };
        if (message.method === "thread/resume") {
          resumeCount++;
          responses[message.method] = { thread, initialTurnsPage: { data: resumeCount === 1 ? [latestTurn, oldTurn] : [oldTurn], nextCursor: null }, model: "gpt-test" };
        }
        if (message.method === "thread/turns/list" && message.params?.itemsView === "summary") {
          pendingReads.push({ socket, id: message.id });
          return;
        }
        socket.send(JSON.stringify({ id: message.id, result: responses[message.method] ?? {} }));
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /刷新回退验证/ }).first().click();
    await expect(page.getByText("完整的最新回复", { exact: true })).toBeVisible();
    if (scenario === "reconnect") {
      await sockets[0].close({ code: 1011, reason: "test reconnect" });
      await expect.poll(() => resumeCount).toBe(2);
      await page.waitForTimeout(100);
      await expect(page.getByText("完整的最新回复", { exact: true })).toBeVisible();
      await expect(page.getByText("最新问题", { exact: true })).toBeVisible();
    } else {
      const reset = () => sockets.at(-1)!.send(JSON.stringify({ method: "mobile/reset", params: {} }));
      reset();
      await expect.poll(() => pendingReads.length).toBe(1);
      reset();
      await expect.poll(() => pendingReads.length).toBe(2);
      const reply = (index: number, text: string) => {
        const request = pendingReads[index];
        request.socket.send(JSON.stringify({ id: request.id, result: { data: [{ ...latestTurn, items: [latestTurn.items[0], { ...latestTurn.items[1], text }] }, oldTurn] } }));
      };
      reply(1, "更新后的回复");
      await expect(page.getByText("更新后的回复", { exact: true })).toBeVisible();
      reply(0, "过期回复");
      await page.waitForTimeout(100);
      await expect(page.getByText("更新后的回复", { exact: true })).toBeVisible();
      await expect(page.getByText("过期回复", { exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  });
}
