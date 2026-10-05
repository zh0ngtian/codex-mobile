import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRpcTransport } from "../../src/backends/http-transport";
import { AppServerClient } from "../../src/app-server/client";

const transports: HttpRpcTransport[] = [];
afterEach(() => {
  transports.splice(0).forEach((transport) => transport.close());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(fetcher: typeof fetch, id = "test") {
  const transport = new HttpRpcTransport({ baseUrl: "http://device.test", token: "test", id }, {
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
  it("首轮历史事件由 catch-up 边界包裹，供通知层抑制重放", async () => {
    vi.useFakeTimers();
    const historicalFinal = {
      method: "item/completed",
      params: {
        threadId: "thread",
        turnId: "old-turn",
        item: {
          id: "old-final",
          type: "agentMessage",
          phase: "final_answer",
          text: "历史回复",
        },
      },
    };
    const transport = setup((async (url) => {
      if (String(url).includes("/api/events")) {
        return events({
          active: false,
          messages: [historicalFinal],
        });
      }
      return new Response(JSON.stringify({ result: {} }));
    }) as typeof fetch, "initial-catch-up");
    const messages: any[] = [];
    transport.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data));
    });

    await vi.advanceTimersByTimeAsync(0);
    await new AppServerClient(transport).initialize();
    await vi.advanceTimersByTimeAsync(0);

    expect(
      messages
        .filter((message) =>
          message.method === "mobile/events/catchup" ||
          message.method === "item/completed",
        )
        .map((message) => [message.method, message.params?.active]),
    ).toEqual([
      ["mobile/events/catchup", true],
      ["item/completed", undefined],
      ["mobile/events/catchup", false],
    ]);
  });

  it("持续只读请求不能推迟待确认操作的已安排对账期限", async () => {
    vi.useFakeTimers();
    let completed = false;
    let posts = 0;
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/events")) return events({ active: false });
      if (String(url).includes("/api/operations")) return new Response(JSON.stringify(completed
        ? { status: "completed", message: { result: { accepted: true } } } : { status: "uncertain" }));
      if (JSON.parse(String(init?.body)).message.method === "turn/start") { posts++; throw new TypeError("ACK lost"); }
      return new Response(JSON.stringify({ result: {} }));
    }) as typeof fetch, "read-starvation");
    const messages: any[] = [];
    transport.addEventListener("message", (event) => messages.push(JSON.parse((event as MessageEvent).data)));
    await vi.advanceTimersByTimeAsync(0);
    const client = new AppServerClient(transport);
    await client.initialize();
    await vi.advanceTimersByTimeAsync(0); // 先安排空闲 15 秒，新增待确认项必须提前期限。
    await expect(client.request("turn/start", {})).rejects.toThrow("请求结果待确认");
    for (let elapsed = 500; elapsed <= 8_000; elapsed += 500) {
      await vi.advanceTimersByTimeAsync(500);
      if (elapsed === 4_000) completed = true;
      await client.request("thread/read", { threadId: "busy-read" });
    }
    expect(messages.filter((message) => message.method === "mobile/operation/confirmed")).toHaveLength(1);
    expect(posts).toBe(1);
    expect(JSON.parse(localStorage.getItem("codex-mobile:http-writes:read-starvation:12345678-1234-4234-8234-123456789abc")!)).toEqual([]);
  });

  it("旧网关明确不支持轻量详情时用新 UUID 回退原完整读取并缓存能力", async () => {
    const bodies: any[] = [];
    const result = { data: [{ id: "turn", items: [{ type: "imageGeneration", images: [{ path: "/tmp/native.png" }] }], loadedChangeStats: { files: 1, additions: 2, deletions: 0 } }], nextCursor: null };
    const transport = setup((async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return new Response(JSON.stringify(body.message.method === "mobile/turns/details"
        ? { error: { code: -32601, message: "method not found" } } : { result }));
    }) as typeof fetch, "legacy-details");
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    const client = new AppServerClient(transport);
    const params = { threadId: "detail", itemsView: "full", limit: 1 };
    await expect(client.request("thread/turns/list", params)).resolves.toEqual(result);
    await expect(client.request("thread/turns/list", params)).resolves.toEqual(result);
    expect(bodies.map((body) => body.message.method)).toEqual(["mobile/turns/details", "thread/turns/list", "thread/turns/list"]);
    expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
    expect(bodies[1].message.params).toEqual(params);
  });

  it("轻量详情普通 RPC 错误不能回退或缓存为不支持", async () => {
    const methods: string[] = [];
    const transport = setup((async (_url, init) => {
      methods.push(JSON.parse(String(init?.body)).message.method);
      return new Response(JSON.stringify({ error: { code: -32602, message: "invalid params" } }));
    }) as typeof fetch, "details-error");
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    const client = new AppServerClient(transport);
    for (let index = 0; index < 2; index++) await expect(client.request("thread/turns/list", { itemsView: "full" })).rejects.toThrow("invalid params");
    expect(methods).toEqual(["mobile/turns/details", "mobile/turns/details"]);
  });

  it("轻量详情网络未知不会触发原协议回退", async () => {
    const methods: string[] = [];
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/operations")) return new Response(JSON.stringify({ status: "uncertain" }));
      methods.push(JSON.parse(String(init?.body)).message.method);
      if (methods.length === 1) throw new TypeError("offline");
      return new Response(JSON.stringify({ result: { data: [] } }));
    }) as typeof fetch, "details-offline");
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    const client = new AppServerClient(transport);
    await expect(client.request("thread/turns/list", { itemsView: "full" })).rejects.toThrow("offline");
    await expect(client.request("thread/turns/list", { itemsView: "full" })).resolves.toEqual({ data: [] });
    expect(methods).toEqual(["mobile/turns/details", "mobile/turns/details"]);
  });

  it("旧协议回退的 ACK 丢失后只对账新只读 UUID", async () => {
    const bodies: any[] = [];
    const queries: string[] = [];
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/operations")) {
        queries.push(new URL(String(url)).searchParams.get("requestId")!);
        return new Response(JSON.stringify({ status: "completed", message: { result: { data: [{ id: "legacy-turn" }] } } }));
      }
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.message.method === "mobile/turns/details") return new Response(JSON.stringify({ error: { code: -32601, message: "method not found" } }));
      throw new TypeError("fallback ACK lost");
    }) as typeof fetch, "legacy-details-ack");
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    await expect(new AppServerClient(transport).request("thread/turns/list", { itemsView: "full" })).resolves.toEqual({ data: [{ id: "legacy-turn" }] });
    expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
    expect(queries).toEqual([bodies[1].requestId]);
  });

  it("轻量详情的明确不支持响应由对账找回时仍可回退", async () => {
    const bodies: any[] = [];
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/operations")) return new Response(JSON.stringify({ status: "completed", message: { error: { code: -32601, message: "method not found" } } }));
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.message.method === "mobile/turns/details") throw new TypeError("ACK lost");
      return new Response(JSON.stringify({ result: { data: [{ id: "legacy" }] } }));
    }) as typeof fetch, "details-unsupported-ack");
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    await expect(new AppServerClient(transport).request("thread/turns/list", { itemsView: "full" })).resolves.toEqual({ data: [{ id: "legacy" }] });
    expect(bodies.map((body) => body.message.method)).toEqual(["mobile/turns/details", "thread/turns/list"]);
    expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
  });

  it("旧 epoch 的审批确认不能抑制新审批或作为当前审批确认", async () => {
    vi.useFakeTimers();
    localStorage.setItem("codex-mobile:http-writes:stale-approval:12345678-1234-4234-8234-123456789abc", JSON.stringify([["old", { requestId: "old-approval", epoch: "old", message: { id: "approval", result: { decision: "accept" } } }]]));
    const transport = setup((async (url) => String(url).includes("/api/events")
      ? events({ requests: [{ id: "approval", method: "item/commandExecution/requestApproval", params: {} }] })
      : String(url).includes("/api/operations") ? new Response(JSON.stringify({ status: "completed", message: { result: null } })) : new Response("{}")) as typeof fetch, "stale-approval");
    const messages: any[] = [];
    transport.addEventListener("message", (event) => messages.push(JSON.parse((event as MessageEvent).data)));
    await vi.advanceTimersByTimeAsync(0);
    await new AppServerClient(transport).initialize();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(messages.filter((message) => message.method === "mobile/requests").at(-1).params.requests).toHaveLength(1);
    expect(messages.find((message) => message.method === "mobile/operation/confirmed").params.staleApproval).toBe(true);
  });
  it("首个 POST 响应丢失后同轮重试拒绝不能清理可能已受理的操作", async () => {
    vi.useFakeTimers();
    let posts = 0;
    const transport = setup((async (url) => {
      if (String(url).includes("/api/operations")) return new Response("unknown", { status: 404 });
      if (++posts === 1) throw new TypeError("ACK lost");
      return new Response("denied", { status: 401 });
    }) as typeof fetch, "retry-denied");
    await vi.advanceTimersByTimeAsync(0);
    const sending = new AppServerClient(transport).request("turn/start", {}).catch((reason) => reason);
    await vi.advanceTimersByTimeAsync(300);
    const failure: any = await sending;
    expect(failure.name).toBe("HttpOperationPendingError");
    expect(JSON.parse(localStorage.getItem("codex-mobile:http-writes:retry-denied:12345678-1234-4234-8234-123456789abc")!)).toHaveLength(1);
  });
  it("连接在写入 ACK 前关闭时客户端仍收到结构化待确认错误", async () => {
    const transport = setup((async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("closed", "AbortError")));
    })) as typeof fetch, "close-send");
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    const sending = new AppServerClient(transport).request("turn/start", {}).catch((reason) => reason);
    transport.close();
    const failure: any = await sending;
    expect(failure).toHaveProperty("requestId");
    expect(failure.name).toBe("HttpOperationPendingError");
  });
  it("后台确认审批立即更新请求面板并防止旧在途快照复活", async () => {
    vi.useFakeTimers();
    const approval = { id: "auto-approval", method: "item/commandExecution/requestApproval", params: {} };
    let polls = 0;
    let finishPoll!: (response: Response) => void;
    let confirmed = false;
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/events")) {
        if (++polls === 1) return events({ requests: [approval] });
        return new Promise<Response>((resolve) => { finishPoll = resolve; });
      }
      if (String(url).includes("/api/operations")) return new Response(JSON.stringify(confirmed ? { status: "completed", message: { result: null } } : { status: "uncertain" }));
      if (JSON.parse(String(init?.body)).message.id === approval.id) throw new TypeError("ACK lost");
      return new Response("{}");
    }) as typeof fetch, "auto-approval");
    const messages: any[] = [];
    transport.addEventListener("message", (event) => messages.push(JSON.parse((event as MessageEvent).data)));
    await vi.advanceTimersByTimeAsync(0);
    const client = new AppServerClient(transport);
    await client.initialize();
    await vi.advanceTimersByTimeAsync(0);
    await expect(client.respond(approval.id, { decision: "accept" })).rejects.toThrow("请求结果待确认");
    await vi.advanceTimersByTimeAsync(3_000);
    confirmed = true;
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(messages.filter((message) => message.method === "mobile/requests").at(-1)?.params.requests).toEqual([]);
    finishPoll(events({ requests: [approval] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(messages.filter((message) => message.id === approval.id)).toHaveLength(1);
  });
  it("后台确认关闭后的晚结果不删除持久化操作，也不发通知", async () => {
    vi.useFakeTimers();
    let query = 0;
    let finish!: (response: Response) => void;
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/events")) return events();
      if (String(url).includes("/api/operations")) {
        if (++query === 1) return new Response(JSON.stringify({ status: "uncertain" }));
        return new Promise<Response>((resolve) => { finish = resolve; });
      }
      if (JSON.parse(String(init?.body)).message.method === "turn/start") throw new TypeError("offline");
      return new Response("{}");
    }) as typeof fetch, "late-confirm");
    const messages: any[] = [];
    transport.addEventListener("message", (event) => messages.push(JSON.parse((event as MessageEvent).data)));
    await vi.advanceTimersByTimeAsync(0);
    const client = new AppServerClient(transport);
    await client.initialize();
    await expect(client.request("turn/start", {})).rejects.toThrow("请求结果待确认");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(query).toBe(2);
    transport.close();
    finish(new Response(JSON.stringify({ status: "completed", message: { result: {} } })));
    await vi.advanceTimersByTimeAsync(0);
    expect(messages.filter((message) => message.method === "mobile/operation/confirmed")).toEqual([]);
    expect(JSON.parse(localStorage.getItem("codex-mobile:http-writes:late-confirm:12345678-1234-4234-8234-123456789abc")!)).toHaveLength(1);
  });

  it("事件页挂起时后台定时仍确认写入，发送在途时不提前通知", async () => {
    vi.useFakeTimers();
    let completed = false;
    let posts = 0;
    let release!: () => void;
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/events")) return new Promise<Response>(() => {});
      if (String(url).includes("/api/operations")) return new Response(JSON.stringify(completed ? { status: "completed", message: { result: { accepted: true } } } : { status: "uncertain" }));
      if (JSON.parse(String(init?.body)).message.method === "turn/start") {
        posts++;
        await new Promise<void>((resolve) => { release = resolve; });
        throw new TypeError("ACK lost");
      }
      return new Response("{}");
    }) as typeof fetch, "independent-timer");
    const messages: any[] = [];
    transport.addEventListener("message", (event) => messages.push(JSON.parse((event as MessageEvent).data)));
    await vi.advanceTimersByTimeAsync(0);
    const client = new AppServerClient(transport);
    await client.initialize();
    const sending = client.request("turn/start", {}).catch((reason) => reason);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(messages.filter((message) => message.method === "mobile/operation/confirmed")).toEqual([]);
    release();
    await sending;
    completed = true;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(messages.filter((message) => message.method === "mobile/operation/confirmed")).toHaveLength(1);
    expect(posts).toBe(1);
  });

  it("已有未知项遇到新 POST 拒绝仍保留原 UUID，而新拒绝项释放配额", async () => {
    let rejected = false;
    const bodies: any[] = [];
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/operations")) return new Response(JSON.stringify({ status: "uncertain" }));
      bodies.push(JSON.parse(String(init?.body)));
      if (!rejected) throw new TypeError("lost");
      return new Response("denied", { status: 401 });
    }) as typeof fetch, "rejected-write");
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    const client = new AppServerClient(transport);
    await expect(client.request("turn/start", { threadId: "unknown" })).rejects.toThrow("请求结果待确认");
    rejected = true;
    await expect(client.request("turn/start", { threadId: "unknown" })).rejects.toThrow("请求结果待确认");
    await expect(client.request("turn/start", { threadId: "new" })).rejects.toThrow("访问口令");
    const writes = JSON.parse(localStorage.getItem("codex-mobile:http-writes:rejected-write:12345678-1234-4234-8234-123456789abc")!);
    expect(writes).toHaveLength(1);
    expect(bodies[1]).toEqual(bodies[0]);
  });
  it("初始化不等待永远未返回的首个事件页", async () => {
    vi.useFakeTimers();
    const transport = setup((async (url) => String(url).includes("/api/events")
      ? new Promise<Response>(() => {}) : new Response("{}")) as typeof fetch);
    await vi.advanceTimersByTimeAsync(0);
    let initialized = false;
    void new AppServerClient(transport).initialize().then(() => { initialized = true; });
    await vi.advanceTimersByTimeAsync(20);
    expect(initialized).toBe(true);
  });

  it("HTTP 完整回合仅请求网关轻量详情并保留指定一回合", async () => {
    const bodies: any[] = [];
    const transport = setup((async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ result: { data: [] } }));
    }) as typeof fetch);
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    await new AppServerClient(transport).request("thread/turns/list", { threadId: "detail", itemsView: "full", limit: 1 });
    expect(bodies[0].message).toMatchObject({ method: "mobile/turns/details", params: { threadId: "detail", limit: 1, sortDirection: "desc" } });
    expect(bodies[0].message.params).not.toHaveProperty("itemsView");
  });

  it("未确认写入通过在线恢复自动查询原 ID 并通知，绝不重发 POST", async () => {
    vi.useFakeTimers();
    const bodies: any[] = [];
    const queries: string[] = [];
    let recovered = false;
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/events")) return events();
      if (String(url).includes("/api/operations")) {
        queries.push(new URL(String(url)).searchParams.get("requestId")!);
        return new Response(JSON.stringify(recovered ? { status: "completed", message: { error: { code: -1, message: "denied" } } } : { status: "uncertain" }));
      }
      const body = JSON.parse(String(init?.body));
      if (body.message.method === "turn/start") { bodies.push(body); throw new TypeError("ACK lost"); }
      return new Response("{}");
    }) as typeof fetch);
    const messages: any[] = [];
    transport.addEventListener("message", (event) => messages.push(JSON.parse((event as MessageEvent).data)));
    await vi.advanceTimersByTimeAsync(0);
    const client = new AppServerClient(transport);
    await client.initialize();
    const error: any = await client.request("turn/start", { threadId: "auto-reconcile" }).catch((reason) => reason);
    expect(error.requestId).toBe(bodies[0].requestId);
    recovered = true;
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(bodies).toHaveLength(1);
    expect(queries.every((id) => id === bodies[0].requestId)).toBe(true);
    expect(messages.find((message) => message.method === "mobile/operation/confirmed")?.params).toMatchObject({ requestId: bodies[0].requestId, response: { error: { message: "denied" } } });
    expect(JSON.parse(localStorage.getItem("codex-mobile:http-writes:test:12345678-1234-4234-8234-123456789abc") ?? "[]")).toEqual([]);
  });
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
    const confirmed: any[] = [];
    const transport = setup((async (url, init) => {
      if (String(url).includes("/api/operations")) return new Response(JSON.stringify({ status: "uncertain" }));
      ids.push(JSON.parse(String(init?.body)).requestId);
      rpcMessages.push(JSON.parse(String(init?.body)).message);
      if (ids.length === 1) throw new TypeError("offline");
      return new Response(JSON.stringify({ result: { accepted: true } }));
    }) as typeof fetch);
    await new Promise<void>((resolve) => transport.addEventListener("open", () => resolve()));
    transport.addEventListener("message", (event) => {
      const message = JSON.parse((event as MessageEvent).data);
      if (message.method === "mobile/operation/confirmed") confirmed.push(message.params);
    });
    const client = new AppServerClient(transport);
    await expect(client.request("turn/start", { threadId: "retry-thread" })).rejects.toThrow("请求结果待确认");
    await expect(client.request("turn/start", { threadId: "retry-thread" })).resolves.toEqual({ accepted: true });
    expect(ids[1]).toBe(ids[0]);
    expect(rpcMessages[1]).toEqual(rpcMessages[0]);
    expect(confirmed).toMatchObject([{ requestId: ids[0], request: rpcMessages[0], response: { result: { accepted: true } } }]);
  });
});
