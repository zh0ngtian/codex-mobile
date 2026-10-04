import { test as base, expect } from "@playwright/test";

/** 旧业务场景的协议模拟器经 HTTP 暴露，生产客户端仍只发 HTTP。 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("**/api/projects**", async (route) => {
      const mocked = await page.evaluate(() => !Function.prototype.toString.call(WebSocket).includes("[native code]"));
      if (!mocked) return route.continue();
      const state = await page.evaluate((url) => (window as any).__httpFixtureProjectState(url), route.request().url());
      return route.fulfill({ json: state });
    });
    await page.addInitScript(() => {
      localStorage.setItem("codex-mobile:language", "zh-CN");
      const browserTimeout = window.setTimeout.bind(window);
      // 旧业务场景压缩模拟轮询时钟；真实 HTTP 用例单独验证 3s/15s 节奏。
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
        const mocked = !Function.prototype.toString.call(WebSocket).includes("[native code]");
        return browserTimeout(handler, mocked && timeout === 3_000 ? 500 : mocked && timeout === 15_000 ? 3_000 : timeout, ...args);
      }) as typeof window.setTimeout;
      const browserFetch = window.fetch.bind(window);
      const sessions = new Map<string, any>();
      (window as any).__httpFixtureProjectState = async (url: string) => {
        const session = [...sessions.values()].find((candidate) => candidate.origin === new URL(url).origin);
        if (!session) return { projects: [], projectlessThreadIds: [] };
        const id = -Date.now();
        const response: any = await new Promise((resolve) => {
          session.waiters.set(String(id), resolve);
          session.socket.send(JSON.stringify({ id, method: "thread/list", params: { limit: 50 } }));
        });
        const threads = response.result?.data ?? [];
        return { projects: [...new Set(threads.map((thread: any) => thread.cwd).filter(Boolean))], projectlessThreadIds: threads.filter((thread: any) => !thread.cwd).map((thread: any) => thread.id) };
      };
      window.fetch = async (input, init) => {
        const url = new URL(String(input), location.href);
        if (url.pathname === "/api/host") {
          const response = await browserFetch(input, init);
          if (!response.ok) return response;
          return new Response(JSON.stringify({ ...await response.json(), httpPolling: true }), { status: response.status });
        }
        if (!["/api/rpc", "/api/events", "/api/operations"].includes(url.pathname)) return browserFetch(input, init);
        if (Function.prototype.toString.call(WebSocket).includes("[native code]")) return browserFetch(input, init);
        const key = url.searchParams.get("sessionId")!;
        let session = sessions.get(key);
        if (!session || session.socket.readyState === 3) {
          const socketUrl = new URL("/ws", url);
          socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
          socketUrl.search = url.search;
          const socket = new WebSocket(socketUrl);
          session = { socket, origin: url.origin, cursor: 0, messages: [], requests: new Map(), waiters: new Map(), results: new Map() };
          const captured = session;
          socket.addEventListener("message", (event) => {
            const message = JSON.parse(String(event.data));
            if (message.id != null && !message.method) captured.waiters.get(String(message.id))?.(message);
            else if (message.id != null) captured.requests.set(String(message.id), message);
            else captured.messages.push({ cursor: ++captured.cursor, message });
          });
          sessions.set(key, session);
        }
        if (session.socket.readyState === 0) await new Promise<void>((resolve) => session.socket.addEventListener("open", resolve, { once: true }));
        if (url.pathname === "/api/events") {
          return new Response(JSON.stringify({ epoch: "test", cursor: session.cursor, messages: session.messages.filter((entry: any) => entry.cursor > Number(url.searchParams.get("after"))).map((entry: any) => entry.message), requests: [...session.requests.values()], active: true, reset: false, updatedAt: Date.now() }));
        }
        if (url.pathname === "/api/operations") {
          const message = session.results.get(url.searchParams.get("requestId"));
          return new Response(JSON.stringify({ status: message ? "completed" : "pending", message }));
        }
        const { requestId, message } = JSON.parse(String(init?.body));
        if (session.results.has(requestId)) return new Response(JSON.stringify(session.results.get(requestId)));
        let result = {};
        if (message.method && message.id != null) {
          result = await new Promise((resolve) => {
            session.waiters.set(String(message.id), resolve);
            session.socket.send(JSON.stringify(message));
          });
        } else {
          session.socket.send(JSON.stringify(message));
          if (message.id != null) session.requests.delete(String(message.id));
        }
        session.results.set(requestId, result);
        return new Response(JSON.stringify(result));
      };
    });
    await use(page);
  },
});
export { expect };
