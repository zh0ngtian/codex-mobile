import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createGateway, type Gateway } from "../../server/gateway.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.useRealTimers(); });
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(autoPong = true) {
  const root = await mkdtemp(join(tmpdir(), "codex-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const http = createServer();
  const ws = new WebSocketServer({ server: http, autoPong });
  const received: any[] = [];
  const connections: WebSocket[] = [];
  let responder: (socket: WebSocket, message: any) => void = (socket, message) => {
    if (message.method && message.id != null) socket.send(JSON.stringify({ id: message.id, result: { method: message.method } }));
  };
  ws.on("connection", (socket) => {
    connections.push(socket);
    socket.on("message", (raw) => { const msg = JSON.parse(raw.toString()); received.push(msg); responder(socket, msg); });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const socket of connections) socket.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  const options = { host: "127.0.0.1", port: 0, mode: "external" as const,
    upstreamUrl: `ws://127.0.0.1:${(http.address() as any).port}`, staticDir: null, accessToken: "secret", codexHome: root };
  let gateway: Gateway = await createGateway(options);
  cleanup.push(async () => gateway.close());
  const sessionId = randomUUID();
  const url = (path: string, query = "") => `http://127.0.0.1:${gateway.port}/api/${path}?sessionId=${sessionId}&token=secret${query}`;
  const rpc = (message: any, requestId = randomUUID(), epoch?: string) => fetch(url("rpc"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, message, ...(epoch ? { epoch } : {}) }) });
  const init = () => rpc({ id: 1, method: "initialize", params: { clientInfo: { name: "test", version: "1" } } });
  const events = async (after = 0) => (await fetch(url("events", `&after=${after}`))).json() as Promise<any>;
  const send = (message: any) => connections.at(-1)!.send(JSON.stringify(message));
  return { root, received, connections, url, rpc, init, events, send,
    respond: (fn: typeof responder) => { responder = fn; },
    restart: async () => { await gateway.close(); gateway = await createGateway(options); },
    port: () => gateway.port };
}

describe("HTTP 会话", () => {
  it("同一会话只初始化一次并回显每次调用的 RPC id", async () => {
    const f = await fixture();
    expect((await f.init()).status).toBe(200);
    expect(await (await f.rpc({ id: 99, method: "initialize", params: {} })).json()).toEqual({ id: 99, result: { method: "initialize" } });
    expect(f.received.filter((m) => m.method === "initialize")).toHaveLength(1);
    expect(f.connections).toHaveLength(1);
    expect((await f.events()).epoch).toEqual(expect.any(String));
  });

  it("initialize 必须是有 RPC id 的请求，通知不能让会话提前 ready", async () => {
    const f = await fixture();
    expect((await f.rpc({ method: "initialize", params: {} })).status).toBe(400);
    expect((await fetch(f.url("events"))).status).toBe(503);
  });

  it("同一上游只发送一次 initialized 通知", async () => {
    const f = await fixture(); await f.init();
    const initialized = await Promise.all([f.rpc({ method: "initialized", params: {} }), f.rpc({ method: "initialized", params: {} })]);
    expect(initialized.map((response) => response.status)).toEqual([200, 200]);
    await f.rpc({ id: 2, method: "initialize", params: {} });
    expect((await f.rpc({ method: "initialized", params: {} })).status).toBe(200);
    expect(f.received.filter((m) => m.method === "initialized")).toHaveLength(1);
  });

  it("心跳回收没有 pong 的半开上游", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const f = await fixture(false); await f.init();
    vi.advanceTimersByTime(30_000); await wait();
    expect(f.connections[0].readyState).toBe(WebSocket.OPEN);
    vi.advanceTimersByTime(30_000); await wait();
    expect(f.connections[0].readyState).toBe(WebSocket.CLOSED);
    expect((await fetch(f.url("events"))).status).toBe(503);
  });

  it("空闲会话回收，但正在运行和等待审批的会话仍保留", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const idle = await fixture(); await idle.init();
    const running = await fixture(); await running.init();
    running.send({ method: "turn/started", params: { threadId: "t", turn: { id: "turn" } } });
    const approval = await fixture(); await approval.init();
    approval.send({ id: "approve", method: "item/tool/requestApproval", params: {} }); await wait();
    for (let n = 0; n < 61; n++) { vi.advanceTimersByTime(30_000); await wait(10); }
    expect(idle.connections[0].readyState).toBe(WebSocket.CLOSED);
    expect(running.connections[0].readyState).toBe(WebSocket.OPEN);
    expect(approval.connections[0].readyState).toBe(WebSocket.OPEN);
  });

  it("请求重试执行一次，参数冲突返回 409，代理 RPC 保持原结果", async () => {
    const f = await fixture(); await f.init();
    const requestId = randomUUID();
    const message = { id: 2, method: "turn/start", params: { threadId: "t" } };
    const [a, b] = await Promise.all([f.rpc(message, requestId), f.rpc(message, requestId)]);
    expect(await a.json()).toEqual({ id: 2, result: { method: "turn/start" } });
    expect(await b.json()).toEqual({ id: 2, result: { method: "turn/start" } });
    expect(f.received.filter((m) => m.method === "turn/start")).toHaveLength(1);
    expect((await f.rpc({ ...message, params: { threadId: "other" } }, requestId)).status).toBe(409);
    expect(await (await fetch(f.url("operations", `&requestId=${requestId}`))).json()).toEqual({ status: "completed", message: { id: 2, result: { method: "turn/start" } } });
    expect((await fetch(f.url("operations", `&requestId=${randomUUID()}`))).status).toBe(404);
  });

  it("所有端点鉴权和 CORS/OPTIONS，主机声明 HTTP 能力", async () => {
    const f = await fixture();
    for (const path of ["rpc", "events", "operations"]) {
      expect((await fetch(f.url(path).replace("token=secret", "token=wrong"))).status).toBe(401);
      const response = await fetch(f.url(path), { method: "OPTIONS", headers: { origin: "http://phone" } });
      expect(response.status).toBe(204); expect(response.headers.get("access-control-allow-origin")).toBe("http://phone");
    }
    expect(await (await fetch(f.url("host"))).json()).toMatchObject({ httpPolling: true });
    expect((await fetch(f.url("events"))).status).toBe(503);
    expect((await fetch(f.url("events").replace(f.url("events").split("sessionId=")[1].split("&")[0], "../../bad"))).status).toBe(400);
  });

  it("HTTP 连接退出不会关闭上游，流式 delta 投影中间快照并保留通用通知顺序", async () => {
    const f = await fixture(); await f.init();
    f.send({ method: "turn/started", params: { threadId: "t", turn: { id: "turn", status: "inProgress" } } });
    f.send({ method: "item/started", params: { threadId: "t", turnId: "turn", item: { id: "i", type: "agentMessage", text: "" } } });
    f.send({ method: "item/agentMessage/delta", params: { threadId: "t", turnId: "turn", itemId: "i", delta: "hello" } });
    f.send({ method: "turn/plan/updated", params: { threadId: "t", plan: [{ step: "work", status: "inProgress" }] } });
    await wait();
    const a = await f.events();
    expect(a.active).toBe(true);
    expect(a.messages.map((m: any) => m.method)).toEqual(["turn/started", "item/started", "turn/plan/updated"]);
    expect(a.messages[1].params.item.text).toBe("hello");
    f.send({ method: "item/agentMessage/delta", params: { threadId: "t", turnId: "turn", itemId: "i", delta: " world" } });
    await wait();
    const b = await f.events(a.cursor);
    expect(b.messages[0].params.item.text).toBe("hello world");
    expect(f.connections[0].readyState).toBe(WebSocket.OPEN);
  });

  it("运行中 resume 返回真实 inProgress 回合，没有新通知时也保持 active", async () => {
    const f = await fixture(); await f.init();
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: {
      thread: { id: "t", status: { type: "active" }, turns: [{ id: "turn", status: "inProgress", items: [] }] },
    } })));
    expect((await f.rpc({ id: 2, method: "thread/resume", params: { threadId: "t" } })).status).toBe(200);
    expect((await f.events()).active).toBe(true);
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: {} })));
    await f.rpc({ id: 3, method: "turn/interrupt", params: { threadId: "t", turnId: "turn" } });
    expect((await f.events()).active).toBe(true);
    f.send({ method: "turn/completed", params: { threadId: "t", turn: { id: "turn", status: "interrupted" } } }); await wait();
    expect((await f.events()).active).toBe(false);
  });

  it("turn/start 的真实 inProgress 响应早于通知时首次轮询仍 active", async () => {
    const f = await fixture(); await f.init();
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: { turn: { id: "turn", status: "inProgress", items: [] } } })));
    await f.rpc({ id: 2, method: "turn/start", params: { threadId: "t" } });
    expect((await f.events()).active).toBe(true);
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: { thread: { id: "t", status: { type: "idle" }, turns: [{ id: "turn", status: "completed" }] } } })));
    await f.rpc({ id: 3, method: "thread/read", params: { threadId: "t" } });
    expect((await f.events()).active).toBe(false);
  });

  it("审批请求单独保留，只有成功回复才移除，未知审批不可转发", async () => {
    const f = await fixture(); await f.init();
    f.send({ id: "approval", method: "item/commandExecution/requestApproval", params: { threadId: "t" } });
    await wait();
    expect((await f.events()).requests).toHaveLength(1);
    expect((await f.rpc({ id: "unknown", result: { decision: "accept" } })).status).toBe(409);
    expect((await f.events()).requests).toHaveLength(1);
    expect((await f.rpc({ id: "approval", result: { decision: "accept" } })).status).toBe(409);
    expect((await f.rpc({ id: "approval", result: { decision: "accept" } }, randomUUID(), (await f.events()).epoch)).status).toBe(200);
    expect((await f.events()).requests).toHaveLength(0);
    expect(f.received.at(-1)).toEqual({ id: "approval", result: { decision: "accept" } });
  });

  it("审批带旧 epoch 时返回 409 并继续保留审批", async () => {
    const f = await fixture(); await f.init();
    f.send({ id: 42, method: "item/commandExecution/requestApproval", params: { threadId: "t" } }); await wait();
    const state = await f.events();
    expect((await f.rpc({ id: 42, result: { decision: "accept" } }, randomUUID(), randomUUID())).status).toBe(409);
    expect((await f.events()).requests).toHaveLength(1);
    expect((await f.rpc({ id: 42, result: { decision: "accept" } }, randomUUID(), state.epoch)).status).toBe(200);
  });

  it("上游重连清除旧审批并让只读请求恢复，新 epoch 明确变化", async () => {
    const f = await fixture(); await f.init();
    f.send({ id: 42, method: "item/commandExecution/requestApproval", params: {} }); await wait();
    const before = await f.events();
    f.connections[0].terminate(); await wait();
    expect((await fetch(f.url("events"))).status).toBe(503);
    expect((await f.rpc({ id: 5, method: "thread/read", params: { threadId: "t" } })).status).toBe(200);
    const after = await f.events();
    expect(after.epoch).not.toBe(before.epoch); expect(after.requests).toEqual([]);
    expect(f.received.filter((m) => m.method === "initialize")).toHaveLength(2);
  });

  it("同 requestId initialize 在上游断线后重新初始化当前连接", async () => {
    const f = await fixture(); const requestId = randomUUID();
    const message = { id: 1, method: "initialize", params: {} };
    await f.rpc(message, requestId); const before = await f.events();
    f.connections[0].terminate(); await wait();
    expect((await f.rpc(message, requestId)).status).toBe(200);
    const after = await f.events(); expect(after.epoch).not.toBe(before.epoch);
    expect(f.received.filter((m) => m.method === "initialize")).toHaveLength(2);
  });

  it("审批完整保留用户问题和命令，不静默截断语义", async () => {
    const f = await fixture(); await f.init();
    const question = "完整审批问题".repeat(2000);
    f.send({ id: "question", method: "item/tool/requestUserInput", params: { questions: [{ question }] } }); await wait();
    expect((await f.events()).requests[0].params.questions[0].question).toBe(question);
  });

  it("在途操作可查询 pending，重复 HTTP 请求共用同一上游响应", async () => {
    const f = await fixture(); await f.init();
    let incoming: any;
    f.respond((_socket, message) => { incoming = message; });
    const requestId = randomUUID(); const message = { id: 44, method: "turn/start", params: {} };
    const a = f.rpc(message, requestId); const b = f.rpc(message, requestId);
    for (let n = 0; n < 50 && !incoming; n++) await wait();
    expect(await (await fetch(f.url("operations", `&requestId=${requestId}`))).json()).toEqual({ status: "pending" });
    const directory = join(f.root, "codex-mobile-http", new URL(f.url("rpc")).searchParams.get("sessionId")!);
    expect(JSON.parse(await readFile(join(directory, `${requestId}.json`), "utf8"))).toMatchObject({ requestId, status: "pending" });
    expect(f.received.filter((m) => m.method === "turn/start")).toHaveLength(1);
    f.send({ id: incoming.id, result: { ok: true } });
    expect(await (await a).json()).toEqual({ id: 44, result: { ok: true } });
    expect(await (await b).json()).toEqual({ id: 44, result: { ok: true } });
  });

  it("手机在 RPC 返回前退出仍保留操作结果和上游", async () => {
    const f = await fixture(); await f.init();
    let incoming: any;
    f.respond((_socket, message) => { incoming = message; });
    const controller = new AbortController(); const requestId = randomUUID();
    const submission = fetch(f.url("rpc"), { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, message: { id: 7, method: "turn/start", params: {} } }) }).catch(() => null);
    for (let n = 0; n < 50 && !incoming; n++) await wait();
    controller.abort(); await submission;
    f.send({ id: incoming.id, result: { turn: { id: "turn" } } }); await wait();
    expect(f.connections[0].readyState).toBe(WebSocket.OPEN);
    expect(await (await fetch(f.url("operations", `&requestId=${requestId}`))).json()).toMatchObject({ status: "completed", message: { id: 7 } });
  });

  it("多个语音客户端使用相同 id 时不会串响应", async () => {
    const f = await fixture(); await f.init();
    f.respond((socket, message) => { if (message.method) socket.send(JSON.stringify({ id: message.id, result: message.params })); });
    const voices = [new WebSocket(f.url("realtime").replace("http:", "ws:")), new WebSocket(f.url("realtime").replace("http:", "ws:"))];
    await Promise.all(voices.map((voice) => new Promise<void>((resolve, reject) => { voice.once("open", resolve); voice.once("error", reject); })));
    const results = voices.map((voice, n) => new Promise<any>((resolve) => {
      voice.once("message", (raw) => resolve(JSON.parse(raw.toString())));
      voice.send(JSON.stringify({ id: 1, method: "thread/realtime/start", params: { n } }));
    }));
    expect(await Promise.all(results)).toEqual([{ id: 1, result: { n: 0 } }, { id: 1, result: { n: 1 } }]);
    voices.forEach((voice) => voice.close());
  });

  it("cursor 过旧返回有限快照，工具输出截断且任务完成后 active 关闭", async () => {
    const f = await fixture(); await f.init();
    f.send({ method: "turn/started", params: { threadId: "t", turn: { id: "turn", status: "inProgress" } } });
    f.send({ method: "item/started", params: { threadId: "t", turnId: "turn", item: { id: "cmd", type: "commandExecution", aggregatedOutput: "" } } });
    for (let n = 0; n < 600; n++) f.send({ method: "thread/title/updated", params: { threadId: "t", title: `title ${n}` } });
    f.send({ method: "item/commandExecution/outputDelta", params: { threadId: "t", turnId: "turn", itemId: "cmd", delta: "x".repeat(200_000) } });
    f.send({ method: "turn/completed", params: { threadId: "t", turn: { id: "turn", status: "completed" } } });
    await wait(80);
    const events = await f.events();
    expect(events.reset).toBe(true); expect(events.active).toBe(false);
    expect(JSON.stringify(events).length).toBeLessThan(512_000);
    expect(events.messages.find((m: any) => m.params?.item?.id === "cmd").params.item.aggregatedOutput).toContain("x");
    expect(events.messages.some((m: any) => m.method === "turn/completed")).toBe(true);
  });

  it("断线已发送写入成为 uncertain，重试和网关重启均不重复执行", async () => {
    const f = await fixture(); await f.init();
    f.respond((socket, message) => { if (message.method === "turn/start") socket.terminate(); });
    const requestId = randomUUID(); const message = { id: 5, method: "turn/start", params: { threadId: "t" } };
    const failed = await f.rpc(message, requestId); expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { code: -32004 } });
    expect(await (await fetch(f.url("operations", `&requestId=${requestId}`))).json()).toEqual({ status: "uncertain" });
    expect((await f.rpc(message, requestId)).status).toBe(503);
    expect((await fetch(f.url("events"))).status).toBe(503);
    await f.restart();
    expect((await f.rpc(message, requestId)).status).toBe(503);
    expect(f.received.filter((m) => m.method === "turn/start")).toHaveLength(1);
  });

  it("已完成操作跨重启去重并不在磁盘记录口令", async () => {
    const f = await fixture(); await f.init();
    const requestId = randomUUID(); const message = { id: 7, method: "thread/name/set", params: { threadId: "t", name: "new title" } };
    const expected = await (await f.rpc(message, requestId)).json(); await f.restart();
    expect(await (await f.rpc(message, requestId)).json()).toEqual(expected);
    expect(f.received.filter((m) => m.method === "thread/name/set")).toHaveLength(1);
    const base = join(f.root, "codex-mobile-http");
    const directories = await readdir(base);
    const contents = await Promise.all(directories.map(async (dir) => Promise.all((await readdir(join(base, dir))).map((file) => readFile(join(base, dir, file), "utf8")))));
    expect(JSON.stringify(contents)).not.toContain("secret");
    expect((await f.rpc({ id: 7, method: "thread/read", params: { threadId: "t" } }, requestId)).status).toBe(409);
  });

  it("只读操作和连接初始化不落盘，重启同 initialize ID 仍实际初始化新连接", async () => {
    const f = await fixture(); const requestId = randomUUID();
    const initialize = { id: 1, method: "initialize", params: { clientInfo: { name: "test", version: "1" } } };
    await f.rpc(initialize, requestId); await f.rpc({ method: "initialized", params: {} });
    await f.rpc({ id: 2, method: "thread/turns/list", params: {} });
    expect(await readdir(join(f.root, "codex-mobile-http")).catch(() => [])).toEqual([]);
    await f.restart();
    expect((await f.rpc(initialize, requestId)).status).toBe(200);
    expect((await f.events()).epoch).toEqual(expect.any(String));
    expect(f.received.filter((m) => m.method === "initialize")).toHaveLength(2);
  });

  it("回合详情只返回改动统计与图片引用，完整工具输出不传手机且不落盘", async () => {
    const f = await fixture(); await f.init();
    const inline = "data:image/png;base64," + "a".repeat(300_000);
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: {
      data: [
        { id: "live", liveDiff: "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n+++hunk content", items: [
          { id: "diff", type: "fileChange", changes: [{ diff: "+ignored\n-ignored" }] },
          { id: "tool", type: "commandExecution", aggregatedOutput: "tool output".repeat(100_000) },
          { id: "view", type: "imageView", path: "/tmp/view.png", text: "discard" },
          { id: "saved", type: "imageGeneration", savedPath: "/tmp/saved.png", result: inline, prompt: "discard" },
          { id: "local", type: "imageGeneration", result: "/tmp/local.png" },
          { id: "ignored", type: "imageGeneration", result: "not an image reference" },
        ] },
        { id: "files", loadedChangeStats: { additions: 99, deletions: 99 }, items: [
          { type: "fileChange", changes: [{ diff: "--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b" }, { diff: "+c\n-d" }] },
          { type: "fileChange", changes: [{ diff: "+e" }] },
        ] },
        { id: "fallback", loadedChangeStats: { additions: 7, deletions: 8 }, items: [] },
      ], nextCursor: "older", toolBody: "discard",
    } })));
    const message = { id: "details-original", method: "mobile/turns/details", params: { threadId: "t", cursor: "page", limit: 5, sortDirection: "desc" } };
    const requestId = randomUUID();
    const response = await f.rpc(message, requestId); expect(response.status).toBe(200);
    const reply = await response.json();
    expect(reply).toEqual({ id: "details-original", result: { data: [
      { id: "live", loadedChangeStats: { additions: 2, deletions: 1 }, items: [
        { id: "view", type: "imageView", path: "/tmp/view.png", backfilled: true },
        { id: "saved", type: "imageGeneration", savedPath: "/tmp/saved.png", backfilled: true },
        { id: "local", type: "imageGeneration", result: "/tmp/local.png", backfilled: true },
      ] },
      { id: "files", loadedChangeStats: { additions: 3, deletions: 2 }, items: [] },
      { id: "fallback", loadedChangeStats: { additions: 7, deletions: 8 }, items: [] },
    ], nextCursor: "older" } });
    expect(f.received.at(-1)).toMatchObject({ method: "thread/turns/list", params: { threadId: "t", cursor: "page", limit: 5, sortDirection: "desc", itemsView: "full" } });
    expect(f.received.some((entry) => entry.method === "mobile/turns/details")).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThan(2048);
    expect(await readdir(join(f.root, "codex-mobile-http")).catch(() => [])).toEqual([]);
    expect(await (await fetch(f.url("operations", `&requestId=${requestId}`))).json()).toMatchObject({ status: "completed", message: reply });
  });

  it("回合详情保留没有文件引用的内联图片并将上游分页限制在五回合", async () => {
    const f = await fixture(); await f.init(); const inline = "data:image/png;base64,abc";
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: { data: [
      { id: "image", items: [{ id: "inline", type: "imageGeneration", result: inline }] },
    ], nextCursor: null } })));
    expect(await (await f.rpc({ id: 18, method: "mobile/turns/details", params: { threadId: "t", limit: 100, sortDirection: "desc" } })).json()).toEqual({ id: 18, result: {
      data: [{ id: "image", loadedChangeStats: { additions: 0, deletions: 0 }, items: [{ id: "inline", type: "imageGeneration", result: inline, backfilled: true }] }], nextCursor: null,
    } });
    expect(f.received.at(-1).params).toEqual({ threadId: "t", limit: 5, sortDirection: "desc", itemsView: "full" });
  });

  it("回合详情原样返回上游错误并保留调用方 RPC id", async () => {
    const f = await fixture(); await f.init(); const error = { code: -32602, message: "thread missing", data: { threadId: "missing" } };
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, error })));
    expect(await (await f.rpc({ id: 19, method: "mobile/turns/details", params: { threadId: "missing" } })).json()).toEqual({ id: 19, error });
    expect(f.received.at(-1).method).toBe("thread/turns/list");
  });

  it("回合详情拒绝无 id 或无效分页参数且不发送上游", async () => {
    const f = await fixture(); await f.init();
    const invalid = [undefined, {}, { threadId: "" }, { threadId: 4 }, { threadId: "t", cursor: 4 }, { threadId: "t", limit: 0 }, { threadId: "t", limit: 1.5 }, { threadId: "t", sortDirection: "asc" }];
    for (const params of invalid) expect((await f.rpc({ id: 2, method: "mobile/turns/details", params })).status).toBe(400);
    expect((await f.rpc({ method: "mobile/turns/details", params: { threadId: "t" } })).status).toBe(400);
    expect(f.received).toHaveLength(1);
    expect(await readdir(join(f.root, "codex-mobile-http")).catch(() => [])).toEqual([]);
  });

  it("普通事件每页消息限制 64 KiB 并按游标无遗漏前进，审批保留独立完整预算", async () => {
    const f = await fixture(); await f.init();
    const question = "审批".repeat(100_000);
    f.send({ id: "question", method: "item/tool/requestUserInput", params: { questions: [{ question }] } });
    for (let n = 0; n < 5; n++) f.send({ method: "item/completed", params: { threadId: "t", turnId: "turn", item: { id: `i${n}`, type: "agentMessage", text: "x".repeat(32_000) } } });
    await wait();
    let page = await f.events(); expect(page.reset).toBe(false); expect(page.hasMore).toBe(true);
    const ids: string[] = []; let previous = 0;
    for (let count = 0; count < 5; count++) {
      expect(page.cursor).toBeGreaterThan(previous); expect(page.requests[0].params.questions[0].question).toBe(question);
      expect(Buffer.byteLength(JSON.stringify(page.messages))).toBeLessThanOrEqual(64 * 1024);
      ids.push(...page.messages.map((entry: any) => entry.params.item.id));
      if (!page.hasMore) break;
      previous = page.cursor; page = await f.events(page.cursor);
    }
    expect(page.hasMore).toBe(false); expect(ids).toEqual(["i0", "i1", "i2", "i3", "i4"]);
    expect((await f.events(page.cursor)).messages).toEqual([]);
  });

  it("单个超 64 KiB 事件占用空页且游标继续前进", async () => {
    const f = await fixture(); await f.init();
    f.send({ method: "item/completed", params: { threadId: "t", turnId: "turn", item: { id: "large", type: "mcpToolCall", output: Array.from({ length: 4 }, () => "x".repeat(32_000)) } } });
    f.send({ method: "turn/completed", params: { threadId: "t", turn: { id: "turn", status: "completed" } } }); await wait();
    const first = await f.events();
    expect(first.messages).toHaveLength(1); expect(Buffer.byteLength(JSON.stringify(first.messages[0]))).toBeGreaterThan(64 * 1024);
    expect(first.cursor).toBe(1); expect(first.hasMore).toBe(true);
    const second = await f.events(first.cursor); expect(second.cursor).toBe(2); expect(second.hasMore).toBe(false);
    expect(second.messages.map((message: any) => message.method)).toEqual(["turn/completed"]);
    expect((await f.events(second.cursor)).messages).toEqual([]);
  });

  it("图片读取响应不落盘，旧版误存的图片响应在会话恢复时清理", async () => {
    const f = await fixture(); await f.init();
    const directory = join(f.root, "codex-mobile-http", new URL(f.url("rpc")).searchParams.get("sessionId")!);
    const writeId = randomUUID();
    expect((await f.rpc({ id: 3, method: "thread/name/set", params: { threadId: "t", name: "keep" } }, writeId)).status).toBe(200);
    const imageId = randomUUID();
    await writeFile(join(directory, `${imageId}.json`), JSON.stringify({
      requestId: imageId, signature: "a".repeat(64), status: "completed",
      message: { id: 4, result: { dataBase64: "a".repeat(200_000) } },
    }));
    await f.restart();
    await f.init();
    f.respond((socket, message) => {
      if (message.id != null) socket.send(JSON.stringify({ id: message.id, result: message.method === "fs/readFile" ? { dataBase64: "a".repeat(100_000) } : { method: message.method } }));
    });
    const imageRequestIds = Array.from({ length: 40 }, () => randomUUID());
    for (const [index, requestId] of imageRequestIds.entries()) {
      expect((await f.rpc({ id: index + 5, method: "fs/readFile", params: { path: `/tmp/${index}.png` } }, requestId)).status).toBe(200);
    }
    expect(await readdir(directory)).toEqual([`${writeId}.json`]);
    expect((await fetch(f.url("operations", `&requestId=${imageRequestIds[0]}`))).status).toBe(404);
    expect((await fetch(f.url("operations", `&requestId=${imageRequestIds.at(-1)}`))).status).toBe(200);
  });

  it("长期持久操作逐文件去重，历史超过内存缓存容量仍可提交新写入", async () => {
    const f = await fixture(); await f.init(); const first = randomUUID();
    const message = { id: 7, method: "thread/name/set", params: { threadId: "t", name: "title" } };
    await f.rpc(message, first);
    const directory = join(f.root, "codex-mobile-http", new URL(f.url("rpc")).searchParams.get("sessionId")!);
    const stored = JSON.parse(await readFile(join(directory, `${first}.json`), "utf8"));
    const seeded = Array.from({ length: 2050 }, () => randomUUID());
    await Promise.all(seeded.map((requestId) => writeFile(join(directory, `${requestId}.json`), JSON.stringify({ ...stored, requestId }))));
    await f.restart(); await f.init();
    expect((await f.rpc({ ...message, id: 8, params: { threadId: "t", name: "new" } })).status).toBe(200);
    expect(await (await f.rpc(message, seeded[0])).json()).toEqual({ id: 7, result: { method: "thread/name/set" } });
    expect(f.received.filter((m) => m.method === "thread/name/set")).toHaveLength(2);
  });

  it("reset 使用冻结快照分页，轮询中新增标题不会跳过剩余活动条目", async () => {
    const f = await fixture(); await f.init();
    for (let n = 0; n < 24; n++) {
      f.send({ method: "item/started", params: { threadId: "t", turnId: "turn", item: { id: `i${n}`, type: "agentMessage", text: "x".repeat(32_000) } } });
    }
    for (let n = 0; n < 600; n++) f.send({ method: "thread/title/updated", params: { threadId: "t", title: `title${n}` } });
    f.send({ method: "turn/completed", params: { threadId: "t", turn: { id: "turn", status: "completed" } } }); await wait(80);
    let page = await f.events(); expect(page.reset).toBe(true); expect(page.hasMore).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(page.messages))).toBeLessThanOrEqual(64 * 1024);
    const messages = [...page.messages];
    while (page.hasMore) {
      f.send({ method: "thread/title/updated", params: { threadId: "t", title: `title new ${messages.length}` } }); await wait();
      page = await f.events(page.cursor); expect(page.reset).toBe(false); messages.push(...page.messages);
      expect(Buffer.byteLength(JSON.stringify(page.messages))).toBeLessThanOrEqual(64 * 1024);
    }
    expect(messages.filter((m: any) => m.method === "item/started").map((m: any) => m.params.item.id)).toEqual(Array.from({ length: 24 }, (_, n) => `i${n}`));
    expect(messages.at(-1).method).toBe("turn/completed");
    const subsequent = await f.events(page.cursor);
    expect(subsequent.messages.some((m: any) => m.params?.title?.startsWith("title new"))).toBe(true);
  });

  it("恢复快照消费结束释放分页链，旧分页令牌明确要求重新 bootstrap", async () => {
    const f = await fixture(); await f.init();
    for (let n = 0; n < 20; n++) f.send({ method: "item/started", params: { threadId: "t", turnId: "turn", item: { id: `i${n}`, type: "agentMessage", text: "x".repeat(32_000) } } });
    for (let n = 0; n < 600; n++) f.send({ method: "thread/title/updated", params: { threadId: "t", title: String(n) } }); await wait(50);
    const first = await f.events(); expect(first.hasMore).toBe(true);
    let page = first;
    while (page.hasMore) page = await f.events(page.cursor);
    expect((await fetch(f.url("events", `&after=${first.cursor}`))).status).toBe(503);
  });

  it("恢复快照超过一分钟过期并明确要求重新 bootstrap", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await fixture(); await f.init();
    for (let n = 0; n < 20; n++) f.send({ method: "item/started", params: { threadId: "t", turnId: "turn", item: { id: `i${n}`, type: "agentMessage", text: "x".repeat(32_000) } } });
    for (let n = 0; n < 600; n++) f.send({ method: "thread/title/updated", params: { threadId: "t", title: String(n) } }); await wait(50);
    const first = await f.events(); expect(first.hasMore).toBe(true);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await fetch(f.url("events", `&after=${first.cursor}`))).status).toBe(503);
  });

  it("多轮冻结快照受总字节预算限制，淘汰旧 cursor 不静默跳页", async () => {
    const f = await fixture(); await f.init(); let firstCursor = 0;
    for (let round = 0; round < 32; round++) {
      for (let n = 0; n < 20; n++) f.send({ method: "item/started", params: { threadId: "t", turnId: "turn", item: { id: `i${n}`, type: "agentMessage", text: `${round}:` + "x".repeat(31_995) } } });
      for (let n = 0; n < 600; n++) f.send({ method: "thread/title/updated", params: { threadId: "t", title: `${round}:${n}` } }); await wait(30);
      const page = await f.events(); expect(page.hasMore).toBe(true);
      if (round === 0) firstCursor = page.cursor;
    }
    expect((await fetch(f.url("events", `&after=${firstCursor}`))).status).toBe(503);
  });

  it("实时快照超过冻结预算后仍可有界恢复并抵达回合完成事件", async () => {
    const f = await fixture(); await f.init();
    f.send({ method: "turn/started", params: { threadId: "t", turn: { id: "turn", status: "inProgress" } } });
    for (let n = 0; n < 200; n++) f.send({ method: "item/completed", params: { threadId: "t", turnId: "turn", item: {
      id: `tool${n}`, type: "mcpToolCall", output: Array.from({ length: 4 }, () => "x".repeat(32_000)),
    } } });
    f.send({ method: "turn/completed", params: { threadId: "t", turn: { id: "turn", status: "completed" } } });
    await wait(150);
    const firstResponse = await fetch(f.url("events", "&after=0")); expect(firstResponse.status).toBe(200);
    let page: any = await firstResponse.json(); expect(page.reset).toBe(true);
    const messages = [...page.messages]; let count = 0;
    expect(page.messages).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(page.messages[0]))).toBeGreaterThan(64 * 1024);
    while (page.hasMore && count++ < 512) {
      const cursor = page.cursor;
      page = await f.events(cursor); expect(page.cursor).not.toBe(cursor); expect(page.messages.length).toBeGreaterThan(0);
      messages.push(...page.messages);
    }
    expect(page.hasMore).toBe(false); expect(page.active).toBe(false);
    expect(messages.at(-1).method).toBe("turn/completed");
    expect(messages.filter((message) => message.method === "item/completed").length).toBeGreaterThan(0);
    expect((await f.events(page.cursor)).messages).toEqual([]);
  });

  it("大量需要 JSON 转义的工具输出仍能有限分页前进", async () => {
    const f = await fixture(); await f.init();
    f.send({ method: "item/completed", params: { threadId: "t", turnId: "turn", item: {
      id: "tool", type: "mcpToolCall", output: Array.from({ length: 8 }, () => "\u0000".repeat(30_000)),
    } } }); await wait();
    const events = await f.events();
    expect(events.messages.length).toBeGreaterThan(0); expect(events.hasMore).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(events))).toBeLessThan(512 * 1024);
  });

  it("大型参数先于 method 序列化时也保留通知路由和条目标识", async () => {
    const f = await fixture(); await f.init();
    f.send({ params: { threadId: "t", turnId: "turn", item: {
      id: "tool", type: "mcpToolCall", output: Array.from({ length: 8 }, () => "x".repeat(32_000)),
    } }, method: "item/completed" }); await wait();
    expect((await f.events()).messages[0]).toMatchObject({ method: "item/completed", params: { item: { id: "tool" } } });
  });

  it("语音与文字共用上游，限定 realtime RPC 并按语音客户端 id 返回", async () => {
    const f = await fixture(); await f.init();
    const voice = new WebSocket(f.url("realtime").replace("http:", "ws:"));
    await new Promise<void>((resolve, reject) => { voice.once("open", resolve); voice.once("error", reject); });
    const response = () => new Promise<any>((resolve) => voice.once("message", (raw) => resolve(JSON.parse(raw.toString()))));
    const reply = response(); voice.send(JSON.stringify({ id: 1, method: "thread/realtime/start", params: { threadId: "t" } }));
    expect(await reply).toEqual({ id: 1, result: { method: "thread/realtime/start" } });
    const denied = response(); voice.send(JSON.stringify({ id: 2, method: "turn/start", params: {} }));
    expect(await denied).toMatchObject({ id: 2, error: { code: -32601 } });
    const notification = response(); f.send({ method: "thread/realtime/audio/output", params: { audio: "abc" } });
    expect((await notification).method).toBe("thread/realtime/audio/output");
    expect((await f.events()).messages).toHaveLength(0);
    voice.close(); await wait();
    expect(f.connections).toHaveLength(1); expect(f.connections[0].readyState).toBe(WebSocket.OPEN);
    expect((await f.rpc({ id: 8, method: "thread/list", params: {} })).status).toBe(200);
  });
});
