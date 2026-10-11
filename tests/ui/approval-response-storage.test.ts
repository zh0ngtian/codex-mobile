import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../../src/app-server/client";
import { HttpRpcTransport } from "../../src/backends/http-transport";
const sessionId = "12345678-1234-4234-8234-123456789abc";
const transports: HttpRpcTransport[] = [];
const events = () => new Response(JSON.stringify({ epoch: "first", cursor: 0, requests: [], messages: [], active: false, reset: false }));
function create(id: string, fetcher: typeof fetch) {
  const transport = new HttpRpcTransport({ id, baseUrl: "http://device.test", token: "test" }, { sessionId, fetch: fetcher });
  transports.push(transport);
  return transport;
}
afterEach(() => { transports.splice(0).forEach((transport) => transport.close()); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("问题回复持久化边界", () => {
  it("保密答案只进入 POST 和内存重试，任何持久化写入都只保存恢复查询元数据", async () => {
    vi.useFakeTimers();
    const secret = "private-answer-please-never-save";
    const stored: string[] = [];
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) { stored.push(value); setItem.call(this, key, value); });
    const posts: any[] = [];
    const transport = create("secret-storage", (async (url, init) => {
      if (String(url).includes("/api/events")) return events();
      if (String(url).includes("/api/operations")) return new Response(JSON.stringify({ status: "uncertain" }));
      const body = JSON.parse(String(init?.body));
      if (!body.message.method) { posts.push(body); throw new TypeError("ACK lost"); }
      return new Response("{}");
    }) as typeof fetch);
    await vi.advanceTimersByTimeAsync(0);
    const client = new AppServerClient(transport);
    await client.initialize();
    const answer = { answers: { q: { answers: [secret] } } };
    await expect(client.respond("secret-question", answer)).rejects.toMatchObject({ name: "HttpOperationPendingError" });
    await expect(client.respond("secret-question", answer)).rejects.toMatchObject({ name: "HttpOperationPendingError" });
    expect(posts).toHaveLength(2);
    expect(posts[1].requestId).toBe(posts[0].requestId);
    expect(posts[0].message.result).toEqual(answer);
    expect(stored.some((value) => value.includes(secret))).toBe(false);
    const saved = JSON.parse(localStorage.getItem(`codex-mobile:http-writes:secret-storage:${sessionId}`)!);
    expect(saved[0][1]).toEqual({ requestId: posts[0].requestId, epoch: "first", message: { id: "secret-question" }, queryOnly: true });
  });
  it("重启后只查询原 UUID，用户重新输入也不能把删去正文的记录重发或产生新操作", async () => {
    vi.useFakeTimers();
    const key = `codex-mobile:http-writes:secret-reload:${sessionId}`;
    localStorage.setItem(key, JSON.stringify([[JSON.stringify({ id: "secret-question", epoch: "first" }), { requestId: "original-uuid", epoch: "first", message: { id: "secret-question" }, queryOnly: true }]]));
    const posts: any[] = [];
    const queries: string[] = [];
    let completed = false;
    const transport = create("secret-reload", (async (url, init) => {
      if (String(url).includes("/api/events")) return events();
      if (String(url).includes("/api/operations")) { queries.push(new URL(String(url)).searchParams.get("requestId")!); return new Response(JSON.stringify(completed ? { status: "completed", message: { result: null } } : { status: "uncertain" })); }
      const body = JSON.parse(String(init?.body));
      if (!body.message.method) posts.push(body);
      return new Response("{}");
    }) as typeof fetch);
    const messages: any[] = [];
    transport.addEventListener("message", (event) => messages.push(JSON.parse((event as MessageEvent).data)));
    await vi.advanceTimersByTimeAsync(0);
    const client = new AppServerClient(transport);
    await client.initialize();
    await expect(client.respond("secret-question", { answers: { q: { answers: ["reentered"] } } })).rejects.toMatchObject({ name: "HttpOperationPendingError", requestId: "original-uuid" });
    expect(posts).toEqual([]);
    completed = true;
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((id) => id === "original-uuid")).toBe(true);
    expect(messages.some((m) => m.method === "mobile/operation/confirmed" && m.params.requestId === "original-uuid")).toBe(true);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([]);
  });
  it("加载旧版本残留时立即移除答案和包含答案的签名，仅保留原 UUID 查询", () => {
    const key = `codex-mobile:http-writes:secret-legacy:${sessionId}`;
    const message = { id: "secret-question", result: { answers: { q: { answers: ["old-plaintext"] } } } };
    localStorage.setItem(key, JSON.stringify([[JSON.stringify({ ...message, epoch: "first" }), { requestId: "legacy-uuid", epoch: "first", message }]]));
    create("secret-legacy", vi.fn());
    expect(localStorage.getItem(key)).not.toContain("old-plaintext");
    expect(JSON.parse(localStorage.getItem(key)!)[0][1]).toEqual({ requestId: "legacy-uuid", epoch: "first", message: { id: "secret-question" }, queryOnly: true });
  });
});
