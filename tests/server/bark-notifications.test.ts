import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createGateway, type Gateway } from "../../server/gateway.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check: () => boolean) { for (let n = 0; n < 100 && !check(); n++) await wait(); expect(check()).toBe(true); }
const final = { method: "item/completed", params: { threadId: "thread /一", turnId: "turn", item: { id: "final", type: "agentMessage", phase: "final_answer", text: "private output" } } };
async function fixture(failPush: boolean | number = false) {
  const root = await mkdtemp(join(tmpdir(), "codex-bark-")); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const pushes: any[] = [];
  const bark = createServer(async (req, res) => { const parts: Buffer[] = []; for await (const part of req) parts.push(Buffer.from(part)); pushes.push(JSON.parse(Buffer.concat(parts).toString())); res.statusCode = failPush === true || typeof failPush === "number" && pushes.length <= failPush ? 503 : 200; res.end("{}"); });
  await new Promise<void>((resolve) => bark.listen(0, "127.0.0.1", resolve)); cleanup.push(() => new Promise<void>((resolve) => bark.close(() => resolve())));
  const upstreamHttp = createServer(); const upstream = new WebSocketServer({ server: upstreamHttp }); const connections: WebSocket[] = []; const requests: any[] = [];
  let reply = (socket: WebSocket, message: any) => { if (message.id != null && message.method) socket.send(JSON.stringify({ id: message.id, result: message.method === "turn/start" ? { turn: { id: "turn", status: "inProgress" } } : {} })); };
  upstream.on("connection", (socket) => { connections.push(socket); socket.on("message", (raw) => { const message = JSON.parse(raw.toString()); requests.push(message); reply(socket, message); }); });
  await new Promise<void>((resolve) => upstreamHttp.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { for (const socket of connections) socket.terminate(); await new Promise<void>((resolve) => upstream.close(() => resolve())); await new Promise<void>((resolve) => upstreamHttp.close(() => resolve())); });
  const options = { host: "127.0.0.1", port: 0, mode: "external" as const, upstreamUrl: `ws://127.0.0.1:${(upstreamHttp.address() as any).port}`, staticDir: null, codexHome: root, accessToken: "secret", displayName: "办公室 Mac" };
  let gateway: Gateway = await createGateway(options); cleanup.push(() => gateway.close());
  const clientId = randomUUID(); const backendId = "backend /一"; const sessionId = randomUUID();
  const url = (path: string) => `http://127.0.0.1:${gateway.port}/api/${path}?token=secret&sessionId=${sessionId}`;
  const barkUrl = `http://127.0.0.1:${(bark.address() as any).port}/deviceKey`;
  const settings = (body: any = { clientId, backendId, mode: "bark", barkUrl }) => fetch(url("notifications/settings"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const rpc = (message: any) => fetch(url("rpc"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: randomUUID(), message }) });
  const stream = async () => { const previousConnections = connections.length; const client = new WebSocket(`ws://127.0.0.1:${gateway.port}/ws?token=secret`); cleanup.push(async () => { client.terminate(); }); await new Promise<void>((resolve) => client.once("open", resolve)); await eventually(() => connections.length > previousConnections); return client; };
  return { root, pushes, requests, connections, clientId, backendId, barkUrl, settings, rpc, url, stream, send: (message: any, index = connections.length - 1) => connections[index].send(JSON.stringify(message)), respond: (fn: typeof reply) => { reply = fn; }, restart: async () => { await gateway.close(); gateway = await createGateway(options); } };
}

describe("Bark 通知", () => {
  it("设置接口鉴权、CORS、校验并声明主机能力", async () => {
    const f = await fixture();
    expect((await fetch(f.url("notifications/settings").replace("secret", "wrong"), { method: "POST" })).status).toBe(401);
    const options = await fetch(f.url("notifications/settings"), { method: "OPTIONS", headers: { origin: "capacitor://localhost" } }); expect(options.status).toBe(204); expect(options.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(await (await fetch(f.url("host"))).json()).toMatchObject({ barkPush: true });
    for (const body of [{}, { clientId: "bad", backendId: "b", mode: "system" }, { clientId: f.clientId, backendId: "", mode: "system" }, { clientId: f.clientId, backendId: "b", mode: "bad" }, { clientId: f.clientId, backendId: "b", mode: "bark", barkUrl: "https://api.day.app/push" }]) expect((await f.settings(body)).status).toBe(400);
    expect(await (await f.settings()).json()).toEqual({ saved: true });
    expect((await f.settings({ clientId: f.clientId, backendId: f.backendId, mode: "system" })).status).toBe(200);
  });

  it("HTTP 客户端退出后仍推送 final，跨会话与重启去重，system 注销", async () => {
    const f = await fixture(); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} });
    f.send({ ...final, params: { ...final.params, item: { ...final.params.item, phase: "commentary" } } }); f.send({ ...final, params: { ...final.params, item: { ...final.params.item, type: "reasoning" } } }); await wait(80); expect(f.pushes).toHaveLength(0);
    f.send(final); await eventually(() => f.pushes.length === 1);
    expect(f.pushes[0]).toMatchObject({ title: "Codex 运行结束", body: "任务已完成，点击查看会话", group: "办公室 Mac", url: `codexmobile://thread?backendId=${encodeURIComponent(f.backendId)}&threadId=${encodeURIComponent(final.params.threadId)}`, id: expect.any(String) }); expect(JSON.stringify(f.pushes)).not.toContain("private output");
    const client = await f.stream(); f.send(final); await wait(80); expect(f.pushes).toHaveLength(1); client.close();
    expect((await stat(join(f.root, "codex-mobile-notifications"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(f.root, "codex-mobile-notifications", "state.json"))).mode & 0o777).toBe(0o600);
    await f.restart(); await f.rpc({ id: 1, method: "initialize", params: {} }); f.send(final); await wait(80); expect(f.pushes).toHaveLength(1);
    await f.settings({ clientId: f.clientId, backendId: f.backendId, mode: "system" }); f.send({ ...final, params: { ...final.params, turnId: "another" } }); await wait(80); expect(f.pushes).toHaveLength(1);
    expect(await readFile(join(f.root, "codex-mobile-notifications", "state.json"), "utf8")).not.toContain(f.barkUrl);
  });

  it("真实 HTTP 推送失败不改变 RPC，重试有界", async () => {
    const f = await fixture(true); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); f.send(final);
    expect((await f.rpc({ id: 2, method: "thread/read", params: { threadId: "t" } })).status).toBe(200);
    await eventually(() => f.pushes.length === 3); await wait(100); expect(f.pushes).toHaveLength(3);
  });

  it("重复同步相同订阅不取消首次失败后的成功重试", async () => {
    const f = await fixture(1); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); f.send(final);
    await eventually(() => f.pushes.length === 1); expect((await f.settings()).status).toBe(200);
    await eventually(() => f.pushes.length === 2); await wait(600); expect(f.pushes).toHaveLength(2); expect(f.pushes[1].id).toBe(f.pushes[0].id);
  });

  it("流式退出后稀疏 completed 继承 started 的 final phase", async () => {
    const f = await fixture(); await f.settings(); const client = await f.stream();
    client.send(JSON.stringify({ id: 1, method: "turn/start", params: { threadId: final.params.threadId } })); await eventually(() => f.requests.some((m) => m.method === "turn/start"));
    f.send({ ...final, method: "item/started" }); await wait(50); client.close(); await wait(50);
    f.send({ ...final, params: { ...final.params, item: { id: "final", type: "agentMessage" } } });
    f.send({ method: "turn/completed", params: { threadId: final.params.threadId, turn: { id: "turn", status: "completed" } } });
    await eventually(() => f.pushes.length === 1); await eventually(() => f.connections[0].readyState === WebSocket.CLOSED);
  });

  it("流式 phase 按连接、thread、turn、item 隔离", async () => {
    const f = await fixture(); await f.settings(); await f.stream(); f.send({ ...final, method: "item/started" });
    f.send({ ...final, params: { ...final.params, turnId: "other-turn", item: { id: "final", type: "agentMessage" } } });
    f.send({ ...final, params: { ...final.params, threadId: "other-thread", item: { id: "final", type: "agentMessage" } } });
    f.send({ ...final, params: { ...final.params, item: { id: "other-item", type: "agentMessage" } } }); await wait(50); expect(f.pushes).toHaveLength(0);
    await f.stream(); f.send({ ...final, params: { ...final.params, item: { id: "final", type: "agentMessage" } } }); await wait(50); expect(f.pushes).toHaveLength(0);
    f.send({ ...final, params: { ...final.params, item: { id: "final", type: "agentMessage" } } }, 0); await eventually(() => f.pushes.length === 1);
  });

  it("流式 phase 最多保留512项分类 metadata", async () => {
    const f = await fixture(); await f.settings(); await f.stream();
    for (let n = 0; n <= 512; n++) f.send({ ...final, method: "item/started", params: { ...final.params, item: { id: `item-${n}`, type: "agentMessage", phase: "final_answer", text: "不缓存正文" } } });
    f.send({ ...final, params: { ...final.params, item: { id: "item-0", type: "agentMessage" } } }); await wait(50); expect(f.pushes).toHaveLength(0);
    f.send({ ...final, params: { ...final.params, item: { id: "item-512", type: "agentMessage" } } }); await eventually(() => f.pushes.length === 1);
  });

  it("注销 Bark 后释放已断开的流式上游", async () => {
    const f = await fixture(); await f.settings(); const client = await f.stream();
    client.send(JSON.stringify({ id: 1, method: "turn/start", params: { threadId: final.params.threadId } })); await eventually(() => f.requests.some((m) => m.method === "turn/start")); client.close(); await wait(50); expect(f.connections[0].readyState).toBe(WebSocket.OPEN);
    await f.settings({ clientId: f.clientId, backendId: f.backendId, mode: "system" }); await eventually(() => f.connections[0].readyState === WebSocket.CLOSED);
  });

  it("turn/completed 先于客户端断开时仍接收迟到的 final", async () => {
    const f = await fixture(); await f.settings(); const client = await f.stream();
    client.send(JSON.stringify({ id: 1, method: "turn/start", params: { threadId: final.params.threadId } })); await eventually(() => f.requests.some((m) => m.method === "turn/start"));
    f.send({ method: "turn/completed", params: { threadId: final.params.threadId, turn: { id: "turn", status: "completed" } } }); await wait(50); client.close(); await wait(50);
    expect(f.connections[0].readyState).toBe(WebSocket.OPEN); f.send(final); await eventually(() => f.pushes.length === 1); await eventually(() => f.connections[0].readyState === WebSocket.CLOSED);
  });

  it("历史 RPC 结果不补发，HTTP 稀疏 completed 在 item 合并后判断 final", async () => {
    const f = await fixture(); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} });
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: { thread: { id: final.params.threadId, turns: [{ id: "old", status: "completed", items: [final.params.item] }] } } })));
    await f.rpc({ id: 2, method: "thread/read", params: { threadId: final.params.threadId } }); await wait(50); expect(f.pushes).toHaveLength(0);
    f.send({ ...final, method: "item/started" }); f.send({ ...final, params: { ...final.params, item: { id: "final", type: "agentMessage" } } }); await eventually(() => f.pushes.length === 1);
  });

  it("pending turn/start 断开后仍接收 RPC 结果与完成事件", async () => {
    const f = await fixture(); await f.settings(); f.respond(() => {}); const client = await f.stream();
    client.send(JSON.stringify({ id: 42, method: "turn/start", params: { threadId: final.params.threadId } })); await eventually(() => f.requests.some((m) => m.id === 42)); client.close(); await wait(50); expect(f.connections[0].readyState).toBe(WebSocket.OPEN);
    f.send({ method: "turn/completed", params: { threadId: final.params.threadId, turn: { id: "turn", status: "completed" } } });
    f.send({ id: 42, result: { turn: { id: "turn", status: "inProgress" } } }); f.send(final); await eventually(() => f.pushes.length === 1); await eventually(() => f.connections[0].readyState === WebSocket.CLOSED);
  });

  it("流式客户端退出后保留运行中连接，完成与 final 竞态仍推送并释放", async () => {
    const f = await fixture(); await f.settings(); const client = await f.stream();
    client.send(JSON.stringify({ id: 1, method: "turn/start", params: { threadId: final.params.threadId } })); await eventually(() => f.requests.some((m) => m.method === "turn/start")); client.close(); await wait(80); expect(f.connections[0].readyState).toBe(WebSocket.OPEN);
    f.send({ method: "turn/completed", params: { threadId: final.params.threadId, turn: { id: "turn", status: "completed" } } }); f.send(final); await eventually(() => f.pushes.length === 1); await eventually(() => f.connections[0].readyState === WebSocket.CLOSED);
  });
});

it("推送 URL 只接受 HTTP(S) 单个设备 Key，支持自建路径前缀", async () => {
  const path = "../../server/notification-settings.js";
  const module = await import(/* @vite-ignore */ path).catch(() => null);
  expect(module).not.toBeNull();
  const parse = module!.parseBarkPushUrl;
  expect(parse(" https://api.day.app/DeviceKey123/ ")).toBe("https://api.day.app/DeviceKey123");
  expect(parse("http://localhost:8080/bark/device_key-1/")).toBe("http://localhost:8080/bark/device_key-1");
  for (const value of ["", "ftp://host/key", "https://api.day.app", "https://api.day.app/key/title", "https://host/push", "https://host/register", "https://host/ping", "https://user:pass@host/key", "https://host/key?x=1", "https://host/key#fragment", "https://host/a b", "https://host/key\n", "https://host/%2f", "https://host/%70ush", "https://host/a//key"]) expect(() => parse(value)).toThrow(/[\u4e00-\u9fff]/);
});
