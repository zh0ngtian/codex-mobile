import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRpcTransport } from "../../src/backends/http-transport";
import { AppServerClient } from "../../src/app-server/client";

const transports: HttpRpcTransport[] = [];
afterEach(() => {
  transports.splice(0).forEach((transport) => transport.close());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(fetcher: typeof fetch) {
  const transport = new HttpRpcTransport({ baseUrl: "http://device.test", token: "test", id: "test" }, {
    fetch: fetcher, sessionId: "12345678-1234-4234-8234-123456789abc",
  });
  transports.push(transport);
  return transport;
}
const events = (overrides = {}) => new Response(JSON.stringify({
  epoch: "first", cursor: 1, messages: [], requests: [], active: true,
  updatedAt: Date.now(), reset: false, ...overrides,
}));

describe("HTTP 文字传输", () => {
  it("图片读取失败不会占用待确认写入配额", async () => {
    const writesKey = "codex-mobile:http-writes:image-reads:12345678-1234-4234-8234-123456789abd";
    localStorage.setItem(writesKey, JSON.stringify([["legacy", { requestId: "old", message: { id: 1, method: "fs/readFile", params: { path: "/tmp/old.png" } } }]]));
    const transport = new HttpRpcTransport({ baseUrl: "http://device.test", token: "test", id: "image-reads" }, {
      fetch: (async () => new Response("unavailable", { status: 400 })) as typeof fetch,
      sessionId: "12345678-1234-4234-8234-123456789abd",
    });
    transports.push(transport);
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    for (let index = 0; index < 33; index++) {
      await expect(transport.send(JSON.stringify({ id: index, method: "fs/readFile", params: { path: `/tmp/${index}.png` } }))).rejects.toThrow("400");
    }
    expect(JSON.parse(localStorage.getItem(writesKey) ?? "[]")).toEqual([]);
  });
  it("用 HTTP 初始化与提交任务，不建立 WebSocket", async () => {
    const socket = vi.spyOn(globalThis, "WebSocket");
    const calls: Array<{ url: string; body: any }> = [];
    const transport = setup((async (url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: String(url), body });
      if (String(url).includes("/api/events")) return events();
      return new Response(JSON.stringify({ id: body.message.id, result: { turn: { id: "turn" } } }));
    }) as typeof fetch);
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    const client = new AppServerClient(transport);
    await client.initialize();
    await expect(client.request("turn/start", { threadId: "thread" })).resolves.toMatchObject({ turn: { id: "turn" } });
    expect(calls.some((call) => call.url.includes("/api/rpc") && call.body?.message.method === "turn/start")).toBe(true);
    expect(socket).not.toHaveBeenCalled();
  });

  it("HTTP 响应丢失时使用相同请求 ID 对账，不能重复提交新操作", async () => {
    const bodies: any[] = [];
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/operations")) return new Response(JSON.stringify({ status: "completed", message: { result: { turn: { id: "accepted" } } } }));
      bodies.push(JSON.parse(String(init?.body)));
      throw new TypeError("network lost");
    }) as typeof fetch);
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    const client = new AppServerClient(transport);
    await expect(client.request("turn/start", { threadId: "thread" })).resolves.toEqual({ turn: { id: "accepted" } });
    expect(bodies).toHaveLength(1);
  });

  it("每轮完成后调度，后台暂停，回前台立即拉取且审批只出现一次", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let pulls = 0;
    const transport = setup((async (url) => {
      if (!String(url).includes("/api/events")) return new Response("{}");
      pulls++;
      return events({ requests: [{ id: "approve", method: "item/commandExecution/requestApproval", params: {} }] });
    }) as typeof fetch);
    const requests: any[] = [];
    transport.addEventListener("message", (event) => {
      const message = JSON.parse((event as MessageEvent).data);
      if (message.id) requests.push(message);
    });
    await vi.advanceTimersByTimeAsync(0);
    await transport.send(JSON.stringify({ method: "initialized", params: {} }));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(pulls).toBe(2);
    expect(requests).toHaveLength(1);
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(pulls).toBe(2);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(pulls).toBe(3);
  });

  it("拉取失败保留连接与最近状态，退避后恢复", async () => {
    vi.useFakeTimers();
    let pulls = 0;
    const transport = setup((async (url) => {
      if (!String(url).includes("/api/events")) return new Response("{}");
      if (++pulls === 2) throw new TypeError("offline");
      return events();
    }) as typeof fetch);
    const states: any[] = [];
    transport.addEventListener("sync", (event) => states.push((event as CustomEvent).detail));
    await vi.advanceTimersByTimeAsync(0);
    await transport.send(JSON.stringify({ method: "initialized", params: {} }));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(transport.readyState).toBe(1);
    expect(states.at(-1)).toMatchObject({ stale: true });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(states.at(-1)).toMatchObject({ stale: false });
  });

  it("审批回复失败会抛错，调用方可以保留审批", async () => {
    const transport = setup((async (url) => {
      if (String(url).includes("/api/operations")) return new Response("{}", { status: 404 });
      return new Response("upstream unavailable", { status: 503 });
    }) as typeof fetch);
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    const client = new AppServerClient(transport);
    await expect(client.respond("approval", { decision: "accept" })).rejects.toThrow();
  });

  it("POST 超时后仍能查询已接受的操作，不先关闭 HTTP 会话", async () => {
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/operations")) return new Response(JSON.stringify({ status: "completed", message: { result: { accepted: true } } }));
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }) as typeof fetch);
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    const client = new AppServerClient(transport, { requestTimeoutMs: 40 });
    await expect(client.request("turn/start", {})).resolves.toEqual({ accepted: true });
    expect(transport.readyState).toBe(1);
  });

  it("审批成功后不会被在途旧轮询快照重新弹出", async () => {
    vi.useFakeTimers();
    const approval = { id: "approval", method: "item/commandExecution/requestApproval", params: {} };
    let resolvePull!: (response: Response) => void;
    let pulls = 0;
    const transport = setup((async (url) => {
      if (!String(url).includes("/api/events")) return new Response("{}");
      if (++pulls === 1) return events({ requests: [approval] });
      return new Promise<Response>((resolve) => { resolvePull = resolve; });
    }) as typeof fetch);
    const messages: any[] = [];
    transport.addEventListener("message", (event) => messages.push(JSON.parse((event as MessageEvent).data)));
    await vi.advanceTimersByTimeAsync(0);
    await transport.send(JSON.stringify({ method: "initialized" }));
    await vi.advanceTimersByTimeAsync(3_000);
    await transport.send(JSON.stringify({ id: "approval", result: { decision: "accept" } }));
    resolvePull(events({ requests: [approval] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(messages.filter((message) => message.id === "approval")).toHaveLength(1);
    expect(messages.filter((message) => message.method === "mobile/requests").at(-1).params.requests).toEqual([]);
  });

  it("结果待确认后用户重试相同写入仍使用原操作 ID", async () => {
    const ids: string[] = [];
    const rpcMessages: unknown[] = [];
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/operations")) return new Response(JSON.stringify({ status: "uncertain" }));
      ids.push(JSON.parse(String(init?.body)).requestId);
      rpcMessages.push(JSON.parse(String(init?.body)).message);
      if (ids.length === 1) throw new TypeError("offline");
      return new Response(JSON.stringify({ result: { accepted: true } }));
    }) as typeof fetch);
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    const client = new AppServerClient(transport);
    await expect(client.request("turn/start", { threadId: "retry-thread" })).rejects.toThrow("请求结果待确认");
    await expect(client.request("turn/start", { threadId: "retry-thread" })).resolves.toEqual({ accepted: true });
    expect(ids[1]).toBe(ids[0]);
    expect(rpcMessages[1]).toEqual(rpcMessages[0]);
  });
});
