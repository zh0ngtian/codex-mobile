import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServerClient, type AppServerRequestOptions } from "../../src/app-server/client";
import { HttpRpcTransport } from "../../src/backends/http-transport";
import { fetchBackendProjectState } from "../../src/backends/probe";

const transports: HttpRpcTransport[] = [];
afterEach(async () => {
  transports.splice(0).forEach((transport) => transport.close());
  await vi.advanceTimersByTimeAsync(0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function harness() {
  vi.useFakeTimers();
  const calls: { origin: string; method: string; finish: (error?: boolean) => void }[] = [];
  const fetcher = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    if (new URL(String(url)).pathname === "/api/operations") return Promise.resolve(new Response("missing", { status: 404 }));
    const message = init?.body ? JSON.parse(String(init.body)).message : { method: "projects" };
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      calls.push({
        origin: new URL(String(url)).origin,
        method: message.method,
        finish: (error = false) => resolve(new Response(JSON.stringify(error
          ? { error: { code: -32000, message: "resume failed" } }
          : message.method === "projects" ? { projects: ["/project"], projectlessThreadIds: [] }
            : { result: { method: message.method } }))),
      });
    });
  }) as typeof fetch;
  const create = (id: string, origin = "http://priority.test") => {
    const transport = new HttpRpcTransport({ id, baseUrl: origin, token: "test" }, { fetch: fetcher });
    transports.push(transport);
    return { transport, client: new AppServerClient(transport) };
  };
  const request = (client: AppServerClient, method: string, options: AppServerRequestOptions = {}) =>
    client.request(method, { threadId: "existing" }, options).catch((error: Error) => error);
  return { calls, create, request, fetcher };
}

describe("HTTP前台会话优先于后台刷新", () => {
  it("同网关不同设备共用后台名额，打开会话立即发出且刷新最终全部完成", async () => {
    const { calls, create, request } = harness();
    const a = create("device-a"), b = create("device-b");
    await vi.advanceTimersByTimeAsync(0);
    const refreshing = [a, b, a, b].map(({ client }) => request(client, "thread/read", { priority: "background" }));
    expect(calls).toHaveLength(2);
    const opening = request(a.client, "thread/resume");
    expect(calls.map((call) => call.method)).toEqual(["thread/read", "thread/read", "thread/resume"]);
    calls[0].finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(3); // 前台未返回，后台空位也不抢先续发。
    calls[2].finish();
    await opening;
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(4);
    calls[1].finish(); calls[3].finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(5);
    calls[4].finish();
    expect(await Promise.all(refreshing)).toEqual(Array(4).fill({ method: "thread/read" }));
  });

  it("排队时间不消耗网络超时，开始派发后仍执行原超时", async () => {
    const { calls, create, request } = harness();
    const { client } = create("queue-timeout");
    await vi.advanceTimersByTimeAsync(0);
    request(client, "thread/read", { priority: "background" });
    request(client, "thread/read", { priority: "background" });
    let settled = false;
    const queued = request(client, "thread/read", { priority: "background", timeoutMs: 100 }).then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    expect(calls).toHaveLength(2);
    calls[0].finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(101);
    expect(await queued).toBeInstanceOf(Error);
  });

  it("关闭设备取消未派发请求，不能在其他设备释放名额后再发出", async () => {
    const { calls, create, request } = harness();
    const a = create("active-device"), b = create("closing-device");
    await vi.advanceTimersByTimeAsync(0);
    request(a.client, "thread/read", { priority: "background" });
    request(a.client, "thread/read", { priority: "background" });
    const queued = request(b.client, "thread/read", { priority: "background" });
    expect(calls).toHaveLength(2);
    b.transport.close();
    expect(await queued).toBeInstanceOf(Error);
    calls.forEach((call) => call.finish());
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
  });

  it("不同网关独立调度", async () => {
    const { calls, create, request } = harness();
    const a = create("gateway-a"), b = create("gateway-b", "http://other.test");
    await vi.advanceTimersByTimeAsync(0);
    request(a.client, "thread/read", { priority: "background" });
    request(a.client, "thread/read", { priority: "background" });
    request(a.client, "thread/read", { priority: "background" });
    request(b.client, "thread/read", { priority: "background" });
    expect(calls.map((call) => call.origin)).toEqual(["http://priority.test", "http://priority.test", "http://other.test"]);
    const closing = request(b.client, "thread/resume");
    b.transport.close();
    expect(await closing).toBeInstanceOf(Error);
    calls[0].finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((call) => call.origin === "http://priority.test")).toHaveLength(3);
  });

  it("前台恢复失败后后台刷新继续执行", async () => {
    const { calls, create, request } = harness();
    const { client } = create("foreground-error");
    await vi.advanceTimersByTimeAsync(0);
    const refreshing = Array.from({ length: 3 }, () => request(client, "thread/read", { priority: "background" }));
    const opening = request(client, "thread/resume");
    calls[0].finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(3);
    calls[2].finish(true);
    expect(await opening).toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(4);
    calls[1].finish(); calls[3].finish();
    expect(await Promise.all(refreshing)).toEqual(Array(3).fill({ method: "thread/read" }));
  });

  it("项目目录刷新与会话摘要共用后台名额", async () => {
    const { calls, create, request, fetcher } = harness();
    vi.stubGlobal("fetch", fetcher);
    const { client } = create("project-refresh");
    await vi.advanceTimersByTimeAsync(0);
    request(client, "thread/read", { priority: "background" });
    request(client, "thread/read", { priority: "background" });
    const project = fetchBackendProjectState({ id: "project", name: "Mac", baseUrl: "http://priority.test", token: "test", enabled: true, order: 0 }, "background");
    expect(calls).toHaveLength(2);
    calls[0].finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[2].method).toBe("projects");
    calls[2].finish();
    expect(await project).toEqual({ projects: ["/project"], projectlessThreadIds: [] });
  });
});
