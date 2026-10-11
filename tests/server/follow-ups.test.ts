import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { FinalAnswerCompletionTracker } from "../../server/final-answer-completion.js";
import { createGateway, type Gateway } from "../../server/gateway.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const sleep = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>) { for (let i = 0; i < 100; i++) { if (await check()) return; await sleep(); } throw new Error("等待队列状态超时"); }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-follow-ups-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const http = createServer(); const ws = new WebSocketServer({ server: http });
  const received: any[] = []; const sockets: WebSocket[] = []; const active = new Map<string, string>();
  let failure = false; let disconnect = false; let approval = false; let inspectDelay = 0; let missing = false; let completeBeforeAck = false;
  const replies: Array<{ socket: WebSocket; message: any }> = [];
  ws.on("connection", (socket) => { sockets.push(socket); socket.on("message", (raw) => {
    const m = JSON.parse(raw.toString()); received.push(m); if (!m.method) { replies.push({ socket, message: m }); return; } if (m.id == null) return;
    const threadId = m.params?.threadId;
    if (missing && ["thread/read", "thread/resume"].includes(m.method)) { socket.send(JSON.stringify({ id: m.id, error: { code: -32600, message: "Thread not found" } })); return; }
    const turnId = active.get(threadId);
    let result: any = {};
    if (m.method === "thread/resume" || m.method === "thread/read") result = { thread: { id: threadId, status: { type: turnId ? "active" : "idle" }, turns: turnId ? [{ id: turnId, status: "inProgress" }] : [] } };
    if (m.method === "thread/turns/list") result = { data: turnId ? [{ id: turnId, status: "inProgress" }] : [], nextCursor: null };
    if (m.method === "turn/start" || m.method === "turn/steer") {
      if (disconnect) { socket.terminate(); return; }
      if (failure) { socket.send(JSON.stringify({ id: m.id, error: { code: -1, message: "拒绝发送" } })); return; }
      const id = m.method === "turn/steer" ? turnId : randomUUID(); active.set(threadId, id!); if (approval) socket.send(JSON.stringify({ id: 77, method: "item/commandExecution/requestApproval", params: { threadId, turnId: id, itemId: "command" } })); result = { turn: { id, status: "inProgress" }, turnId: id };
    }
    if (completeBeforeAck && ["turn/start", "turn/steer"].includes(m.method)) {
      const id = active.get(threadId); active.delete(threadId);
      for (const connection of sockets) if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ method: "turn/completed", params: { threadId, turn: { id, status: "completed", items: [{ id: "final", type: "agentMessage", phase: "final_answer", text: "完成" }] } } }));
    }
    if (m.method === "thread/turns/list" && inspectDelay) { setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: m.id, result })); }, inspectDelay); return; }
    socket.send(JSON.stringify({ id: m.id, result }));
  }); });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { sockets.forEach((s) => s.terminate()); await new Promise<void>((r) => ws.close(() => r())); await new Promise<void>((r) => http.close(() => r())); });
  const options = { host: "127.0.0.1", port: 0, mode: "external" as const, upstreamUrl: `ws://127.0.0.1:${(http.address() as any).port}`, staticDir: null, accessToken: "secret", codexHome: root };
  let gateway: Gateway = await createGateway(options); cleanup.push(() => gateway.close());
  const url = (token = "secret") => `http://127.0.0.1:${gateway.port}/api/follow-ups?token=${token}`;
  const post = (body: any) => fetch(url(), { method: "POST", headers: { "content-type": "application/json", origin: "http://mobile.local" }, body: JSON.stringify(body) });
  const list = async () => ((await (await fetch(url())).json()) as any).items as any[];
  const enqueue = (threadId: string, inputText = "继续", extra: any = {}) => ({ action: "enqueue", id: randomUUID(), threadId, inputText, text: inputText, attachmentCount: 0, extraInput: [], settings: {}, ...extra });
  const starts = () => received.filter((m) => m.method === "turn/start");
  const complete = (threadId: string) => { const id = active.get(threadId); active.delete(threadId); for (const s of sockets) if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ method: "turn/completed", params: { threadId, turn: { id, status: "completed" } } })); };
  return { root, post, list, enqueue, starts, received, active, sockets, url, complete, replies,
    setApproval: () => { approval = true; }, setInspectDelay: (ms: number) => { inspectDelay = ms; }, setMissing: () => { missing = true; }, setCompleteBeforeAck: () => { completeBeforeAck = true; },
    setFailure: (value: boolean) => { failure = value; }, setDisconnect: (value: boolean) => { disconnect = value; },
    restart: async () => { await gateway.close(); gateway = await createGateway(options); },
    stop: () => gateway.close() };
}

describe("网关托管追问队列", () => {
  it("无需手机连接，按会话 FIFO 调度，并允许其他会话独立发送", async () => {
    const f = await fixture(); f.active.set("a", "desktop-turn");
    const a = f.enqueue("a", "第一条"), b = f.enqueue("a", "第二条"), c = f.enqueue("b", "另一会话");
    expect((await f.post(a)).status).toBe(200); await f.post(b); await f.post(c);
    await until(() => f.starts().length === 1); expect(f.starts()[0].params.threadId).toBe("b");
    f.complete("a"); await until(() => f.starts().length === 2);
    expect(f.starts()[1].params.input[0].text).toBe("第一条"); await sleep(300); expect(f.starts()).toHaveLength(2);
    f.complete("a"); await until(() => f.starts().length === 3); expect(f.starts()[2].params.input[0].text).toBe("第二条");
    expect(f.received.find((m) => m.method === "initialize").params.capabilities.experimentalApi).toBe(true);
  });
  it("确认入队前落盘，重启及断线时自动恢复订阅和调度", async () => {
    const f = await fixture(); f.active.set("a", "busy"); const body = f.enqueue("a");
    expect((await f.post(body)).status).toBe(200);
    const path = join(f.root, "codex-mobile-follow-ups", "queue.json");
    expect(await readFile(path, "utf8")).toContain(body.id); expect((await stat(path)).mode & 0o777).toBe(0o600);
    await f.restart(); expect(await f.list()).toMatchObject([{ id: body.id, state: "queued" }]);
    await until(() => f.sockets.some((s) => s.readyState === WebSocket.OPEN)); f.sockets.forEach((s) => s.terminate());
    f.active.delete("a"); await until(async () => f.starts().length === 1 && (await f.list()).length === 0); expect(await f.list()).toEqual([]);
  });
  it("同一入队 ID 即便已发送仍幂等，冲突内容拒绝", async () => {
    const f = await fixture(); const body = f.enqueue("a"); await f.post(body); await until(() => f.starts().length === 1);
    await f.restart(); expect((await f.post(body)).status).toBe(200); await sleep(300); expect(f.starts()).toHaveLength(1);
    expect((await f.post({ ...body, inputText: "different", text: "different" })).status).toBe(409);
  });
  it("编辑保留附件、替换 mention，并拒绝过期 revision；取消不发送", async () => {
    const f = await fixture(); f.active.set("a", "busy");
    const image = { type: "image", url: "data:image/png;base64,AAAA" }, file = { type: "text", text: "[附件] /tmp/a.pdf", text_elements: [] };
    const body = f.enqueue("a", "正文", { extraInput: [image, file, { type: "skill", name: "old", path: "/old" }], attachmentCount: 2 }); await f.post(body);
    const item = (await f.list())[0]; expect(item.attachmentCount).toBe(2); expect(item.extraInput).toBeUndefined(); expect(item.settings).toBeUndefined();
    expect((await f.post({ action: "edit", id: body.id, revision: item.revision, inputText: "改写", text: "改写", mentions: [{ type: "mention", name: "new", path: "plugin://new" }] })).status).toBe(200);
    expect((await f.post({ action: "cancel", id: body.id, revision: item.revision })).status).toBe(409);
    f.complete("a"); await until(() => f.starts().length === 1); expect(f.starts()[0].params.input).toEqual([{ type: "text", text: "改写", text_elements: [] }, image, file, { type: "mention", name: "new", path: "plugin://new" }]);
    f.active.set("b", "busy"); const cancel = f.enqueue("b"); await f.post(cancel); const next = (await f.list()).find((entry) => entry.id === cancel.id); expect((await f.post({ action: "cancel", id: cancel.id, revision: next.revision })).status).toBe(200); f.complete("b"); await sleep(300); expect(f.starts()).toHaveLength(1);
  });
  it("失败阻塞当前会话，显式 retry 后继续，steer 自动查找运行 turn", async () => {
    const f = await fixture(); f.setFailure(true); const body = f.enqueue("a"); await f.post(body);
    await until(async () => (await f.list())[0]?.state === "failed"); const later = f.enqueue("a", "later"); await f.post(later); await sleep(300); expect(f.starts()).toHaveLength(1);
    f.setFailure(false); let item = (await f.list())[0]; await f.post({ action: "retry", id: body.id, revision: item.revision });
    await until(async () => {
      const items = await f.list();
      return f.starts().length === 2 && !items.some((entry) => entry.id === body.id) && items.find((entry) => entry.id === later.id)?.state === "queued";
    });
    item = (await f.list()).find((entry) => entry.id === later.id); const response = await f.post({ action: "steer", id: item.id, revision: item.revision }); expect(response.status).toBe(200);
    expect(((await response.json()) as any).turnId).toBe(f.active.get("a")); expect(f.received.find((m) => m.method === "turn/steer").params.expectedTurnId).toBe(f.active.get("a"));
  });
  it("发送后断线标记 uncertain，重启不重发且禁止修改或 retry", async () => {
    const f = await fixture(); f.setDisconnect(true); const body = f.enqueue("a"); await f.post(body);
    await until(async () => (await f.list())[0]?.state === "uncertain"); await f.restart(); await sleep(300); expect(f.starts()).toHaveLength(1);
    const item = (await f.list())[0]; for (const action of ["retry", "edit", "steer"]) expect((await f.post({ action, id: body.id, revision: item.revision, inputText: "edit", text: "edit", mentions: [] })).status).toBe(409);
  });
  it("崩溃后的 sending 从持久化 operation 确认已发送，不重复执行", async () => {
    const f = await fixture(); const body = f.enqueue("a"); await f.post(body); await until(async () => f.starts().length === 1 && (await f.list()).length === 0); await f.stop();
    const path = join(f.root, "codex-mobile-follow-ups", "queue.json"); const data = JSON.parse(await readFile(path, "utf8"));
    const record = data.records.find((r: any) => r.id === body.id); record.state = "sending"; Object.assign(record, { inputText: body.inputText, text: body.text, threadId: body.threadId, attachmentCount: 0, extraInput: [], settings: {} }); await writeFile(path, JSON.stringify(data));
    await f.restart(); await until(async () => (await f.list()).length === 0); expect(f.starts()).toHaveLength(1);
  });
  it("uncertain 可显式移除，后续条目仍等待真实运行状态", async () => {
    const f = await fixture(); f.setDisconnect(true); const first = f.enqueue("a"); await f.post(first); await until(async () => (await f.list())[0]?.state === "uncertain");
    f.setDisconnect(false); f.active.set("a", "possibly-accepted"); await f.post(f.enqueue("a", "后续"));
    const item = (await f.list())[0]; expect((await f.post({ action: "cancel", id: item.id, revision: item.revision })).status).toBe(200);
    await sleep(400); expect(f.starts()).toHaveLength(1); f.complete("a"); await until(() => f.starts().length === 2);
  });
  it("sending 崩溃恢复时仅 operation 明确不存在才重新发送", async () => {
    const f = await fixture(); f.active.set("a", "busy"); const body = f.enqueue("a"); await f.post(body); await f.stop();
    const path = join(f.root, "codex-mobile-follow-ups", "queue.json"); const data = JSON.parse(await readFile(path, "utf8"));
    data.records[0].state = "sending"; await writeFile(path, JSON.stringify(data)); f.active.delete("a"); await f.restart();
    await until(() => f.starts().length === 1); expect(f.starts()[0].params.input[0].text).toBe("继续");
  });
  it("sending 崩溃恢复遇到 pending operation 时暂停且不重发", async () => {
    const f = await fixture(); f.active.set("a", "busy"); const body = f.enqueue("a"); await f.post(body); await f.stop();
    const path = join(f.root, "codex-mobile-follow-ups", "queue.json"); const data = JSON.parse(await readFile(path, "utf8"));
    data.records[0].state = "sending"; await writeFile(path, JSON.stringify(data));
    const directory = join(f.root, "codex-mobile-http", "c0dec000-0000-4000-8000-000000000001"); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${data.records[0].operationId}.json`), JSON.stringify({ requestId: data.records[0].operationId, signature: "a".repeat(64), status: "pending" }));
    await f.restart(); await until(async () => (await f.list())[0]?.state === "uncertain"); expect(f.starts()).toHaveLength(0);
  });
  it("等待中的长会话查询有界，重复轮询不会持续 resume 或读取完整历史", async () => {
    const f = await fixture(); f.active.set("a", "busy"); await f.post(f.enqueue("a")); await sleep(1100);
    const reads = f.received.filter((m) => m.method === "thread/read");
    expect(reads.length).toBeGreaterThan(0); expect(reads.length).toBeLessThanOrEqual(1); expect(reads.every((m) => m.params.includeTurns === false)).toBe(true);
    expect(f.received.filter((m) => m.method === "thread/resume")).toHaveLength(1);
  });
  it("steer 无运行回合恢复原 failed 状态，编辑不能把纯文本追问清空", async () => {
    const f = await fixture(); f.setFailure(true); const body = f.enqueue("a"); await f.post(body); await until(async () => (await f.list())[0]?.state === "failed");
    const item = (await f.list())[0]; expect((await f.post({ action: "steer", id: item.id, revision: item.revision })).status).toBe(409);
    expect((await f.list())[0].state).toBe("failed");
    const current = (await f.list())[0]; expect((await f.post({ action: "edit", id: current.id, revision: current.revision, inputText: "", text: "", mentions: [] })).status).toBe(400);
  });
  it("steer 正在查找 active turn 时保持 sending，后台恢复不能抢占", async () => {
    const f = await fixture(); f.active.set("a", "busy"); await f.post(f.enqueue("a")); const item = (await f.list())[0]; f.setInspectDelay(650);
    const request = f.post({ action: "steer", id: item.id, revision: item.revision });
    await sleep(400); expect((await f.list())[0].state).toBe("sending"); expect((await request).status).toBe(200);
  });
  it("首次 durable WAL 的父目录 fsync 失败时禁止向 app-server 发送", async () => {
    const f = await fixture(); const directory = join(f.root, "codex-mobile-http"); await mkdir(directory, { recursive: true });
    const probe = await open(directory, "r"); const target = await probe.stat(); const prototype = Object.getPrototypeOf(probe); const original = prototype.sync; await probe.close();
    let faults = 0;
    const failure = vi.spyOn(prototype, "sync").mockImplementation(async function(this: any) {
      const info = await this.stat(); if (info.ino === target.ino && info.dev === target.dev) { faults++; throw new Error("WAL parent fsync failed"); }
      return original.call(this);
    });
    try { await f.post(f.enqueue("a")); await sleep(700); expect(faults).toBeGreaterThan(0); expect(f.starts()).toHaveLength(0); }
    finally { failure.mockRestore(); }

  });
  it("steer 崩溃且 operation 尚不存在时恢复原 failed 状态", async () => {
    const f = await fixture(); f.active.set("a", "busy"); await f.post(f.enqueue("a")); await f.stop();
    const path = join(f.root, "codex-mobile-follow-ups", "queue.json"); const data = JSON.parse(await readFile(path, "utf8"));
    Object.assign(data.records[0], { state: "sending", method: "turn/steer", restoreState: "failed" }); await writeFile(path, JSON.stringify(data)); f.active.delete("a"); await f.restart();
    await until(async () => (await f.list())[0]?.state !== "sending"); expect((await f.list())[0].state).toBe("failed"); expect(f.starts()).toHaveLength(0);
  });
  it("明确不存在的会话标记 failed，显示错误而非静默永久等待", async () => {
    const f = await fixture(); f.setMissing(); await f.post(f.enqueue("a"));
    await until(async () => (await f.list())[0]?.state === "failed"); expect((await f.list())[0].error).toContain("not found"); expect(f.starts()).toHaveLength(0);
  });
  it("HTTP 手机会话自身断线后重新 initialize，后台未决审批仍可补发", async () => {
    const f = await fixture(); f.setApproval(); await f.post(f.enqueue("a")); await until(() => f.starts().length === 1);
    const sessionId = randomUUID(); const base = f.url().replace("follow-ups?", `rpc?sessionId=${sessionId}&`);
    const init = () => fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: randomUUID(), message: { id: 1, method: "initialize", params: { clientInfo: { name: "mobile", version: "1" } } } }) });
    await init(); f.sockets.at(-1)!.terminate(); await sleep(50); await init();
    const events = await (await fetch(base.replace("/rpc?", "/events?"))).json() as any; expect(events.requests).toHaveLength(1);
  });
  it("HTTP 托管 start 成功授权完成通知，即使 completed 先到也只通知一次", async () => {
    const f = await fixture(); f.setCompleteBeforeAck(); const sessionId = randomUUID();
    const rpcUrl = f.url().replace("follow-ups?", `rpc?sessionId=${sessionId}&`);
    await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: randomUUID(), message: { id: 1, method: "initialize", params: { clientInfo: { name: "mobile", version: "1" } } } }) });
    const bootstrap = await (await fetch(rpcUrl.replace("/rpc?", "/events?"))).json() as any;
    const body = f.enqueue("a", "私密指令"); await f.post(body); await until(async () => f.starts().length === 1 && (await f.list()).length === 0);
    const events = await (await fetch(rpcUrl.replace("/rpc?", "/events?") + `&after=${bootstrap.cursor}`)).json() as any;
    const acceptance = events.messages.find((m: any) => m.method === "mobile/turn/accepted");
    const turnId = events.messages.find((m: any) => m.method === "turn/completed").params.turn.id;
    expect(acceptance).toEqual({ method: "mobile/turn/accepted", params: { request: { method: "turn/start", params: { threadId: "a" } }, response: { result: { turn: { id: turnId }, turnId } } } });
    expect(JSON.stringify(acceptance)).not.toContain("私密指令");
    const tracker = new FinalAnswerCompletionTracker({ requireMobileOrigin: true }); const completed: any[] = [];
    for (const message of events.messages) { const result = message.method === "mobile/turn/accepted" ? tracker.observeRpc(message.params.request, message.params.response) : tracker.observe(message); if (result) completed.push(result); }
    expect(completed).toHaveLength(1);
  });
  it("WS 托管 steer 成功广播当前回合授权，新连接不回放历史授权", async () => {
    const f = await fixture(); f.active.set("a", "active-turn"); const socket = new WebSocket(f.url().replace("http:", "ws:").replace("/api/follow-ups?", "/ws?"));
    const messages: any[] = []; socket.on("message", (raw) => messages.push(JSON.parse(raw.toString()))); await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "mobile", version: "1" } } })); await until(() => messages.some((m) => m.id === 1 && m.result));
    await f.post(f.enqueue("a", "私密插入")); const item = (await f.list())[0]; expect((await f.post({ action: "steer", id: item.id, revision: item.revision })).status).toBe(200);
    await until(() => messages.some((m) => m.method === "mobile/turn/accepted"));
    expect(messages.find((m) => m.method === "mobile/turn/accepted")).toEqual({ method: "mobile/turn/accepted", params: { request: { method: "turn/steer", params: { threadId: "a", expectedTurnId: "active-turn" } }, response: { result: { turn: { id: "active-turn" }, turnId: "active-turn" } } } });
    socket.terminate(); const reconnect = new WebSocket(f.url().replace("http:", "ws:").replace("/api/follow-ups?", "/ws?")); const replay: any[] = []; reconnect.on("message", (raw) => replay.push(JSON.parse(raw.toString()))); await new Promise<void>((resolve) => reconnect.once("open", resolve));
    reconnect.send(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "mobile", version: "1" } } })); await until(() => replay.some((m) => m.id === 1 && m.result)); await sleep(50); expect(replay.some((m) => m.method === "mobile/turn/accepted")).toBe(false); reconnect.terminate();
  });
  it("手机的独立 HTTP 会话可见并回复后台审批，过期 epoch 不能批准", async () => {
    const f = await fixture(); f.setApproval(); await f.post(f.enqueue("a")); await until(() => f.starts().length === 1);
    const sessionId = randomUUID(); const base = f.url().replace("follow-ups?", `rpc?sessionId=${sessionId}&`);
    const rpc = (message: any, epoch?: string) => fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: randomUUID(), message, epoch }) });
    await rpc({ id: 1, method: "initialize", params: { clientInfo: { name: "mobile", version: "1" } } });
    const events = await (await fetch(base.replace("/rpc?", "/events?"))).json() as any;
    expect(events.requests).toHaveLength(1); expect(events.requests[0].params.threadId).toBe("a");
    expect((await rpc({ id: events.requests[0].id, result: { decision: "accept" } }, randomUUID())).status).toBe(409);
    expect((await rpc({ id: events.requests[0].id, result: { decision: "accept" } }, events.epoch)).status).toBe(200);
    await until(() => f.replies.length === 1); expect(f.replies[0].socket).toBe(f.sockets[0]); expect(f.replies[0].message.id).toBe(77);
  });
  it("WebSocket 手机重连仍收到待审批，回复只交给后台原连接", async () => {
    const f = await fixture(); f.setApproval(); await f.post(f.enqueue("a")); await until(() => f.starts().length === 1);
    const wsUrl = f.url().replace("http:", "ws:").replace("/api/follow-ups?", "/ws?");
    const connect = async () => { const socket = new WebSocket(wsUrl); const messages: any[] = []; socket.on("message", (raw) => messages.push(JSON.parse(raw.toString()))); await new Promise<void>((resolve) => socket.once("open", resolve)); socket.send(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "mobile", version: "1" } } })); return { socket, messages }; };
    const first = await connect(); await until(() => first.messages.some((m) => m.method === "item/commandExecution/requestApproval")); first.socket.terminate();
    const next = await connect(); await until(() => next.messages.some((m) => m.method === "item/commandExecution/requestApproval"));
    const request = next.messages.find((m) => m.method === "item/commandExecution/requestApproval"); next.socket.send(JSON.stringify({ id: request.id, result: { decision: "accept" } }));
    await until(() => f.replies.length === 1); expect(f.replies[0].socket).toBe(f.sockets[0]); expect(f.replies[0].message.id).toBe(77); next.socket.terminate();
  });
  it("鉴权、CORS、服务器附件计数及总条数/字节上限不可绕过", async () => {
    const f = await fixture(); expect((await fetch(f.url("wrong"))).status).toBe(401);
    const options = await fetch(f.url(), { method: "OPTIONS", headers: { origin: "http://mobile.local" } }); expect(options.status).toBe(204); expect(options.headers.get("access-control-allow-origin")).toBe("http://mobile.local");
    expect((await f.post(f.enqueue("a", "x", { settings: { arbitrary: true } }))).status).toBe(400);
    expect((await f.post(f.enqueue("a", "x", { extraInput: [{ type: "image", url: "x" }], attachmentCount: 0 }))).status).toBe(400);
    expect((await f.post(f.enqueue("a", "x", { extraInput: [{ type: "image", url: "x".repeat(17 * 1024 * 1024) }], attachmentCount: 1 }))).status).toBe(413);
    f.active.set("a", "busy"); for (let i = 0; i < 128; i++) expect((await f.post(f.enqueue("a"))).status).toBe(200);
    expect((await f.post(f.enqueue("a"))).status).toBe(429);
  }, 20_000);
});
