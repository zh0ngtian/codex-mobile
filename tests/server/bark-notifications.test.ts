import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createGateway, type Gateway } from "../../server/gateway.js";
import { BarkNotifications } from "../../server/bark-notifications.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check: () => boolean) { for (let n = 0; n < 100 && !check(); n++) await wait(); expect(check()).toBe(true); }
const final = { method: "item/completed", params: { threadId: "thread /一", turnId: "turn", item: { id: "final", type: "agentMessage", phase: "final_answer", text: "private output" } } };
const completed = { method: "turn/completed", params: { threadId: final.params.threadId, turn: { id: "turn", status: "completed" } } };
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
  let activeStream: WebSocket | undefined;
  const stream = async () => { const previousConnections = connections.length; const client = new WebSocket(`ws://127.0.0.1:${gateway.port}/ws?token=secret`); cleanup.push(async () => { client.terminate(); }); await new Promise<void>((resolve) => client.once("open", resolve)); await eventually(() => connections.length > previousConnections); activeStream = client; return client; };
  const start = async (threadId = final.params.threadId) => {
    const previous = reply;
    reply = (socket, message) => socket.send(JSON.stringify({ id: message.id, result: { turn: { id: "turn", status: "inProgress" } } }));
    try {
      if (activeStream?.readyState === WebSocket.OPEN) {
        const id = randomUUID();
        const response = new Promise<void>((resolve) => {
          const listener = (raw: WebSocket.RawData) => {
            if (JSON.parse(raw.toString()).id === id) { activeStream!.off("message", listener); resolve(); }
          };
          activeStream!.on("message", listener);
        });
        activeStream.send(JSON.stringify({ id, method: "turn/start", params: { threadId } }));
        await response;
      } else await rpc({ id: randomUUID(), method: "turn/start", params: { threadId } });
    } finally { reply = previous; }
  };
  return { start, root, pushes, requests, connections, clientId, backendId, barkUrl, settings, rpc, url, stream, send: (message: any, index = connections.length - 1) => connections[index].send(JSON.stringify(message)), respond: (fn: typeof reply) => { reply = fn; }, restart: async () => { await gateway.close(); gateway = await createGateway(options); } };
}

describe("Bark 通知", () => {
  it.each(["http", "stream"])("%s 模型提问立即推送且跨连接重复请求不重发，完成通知独立", async (transport) => {
    const f = await fixture(); await f.settings();
    if (transport === "stream") await f.stream();
    else await f.rpc({ id: 0, method: "initialize", params: {} });
    const question = { id: "ask", method: "item/tool/requestUserInput", params: {
      threadId: final.params.threadId, turnId: "turn", itemId: "question-item",
      questions: [{ id: "q", header: "方案", question: "私密问题正文", options: null }],
    } };
    f.send(question); await eventually(() => f.pushes.length === 1);
    expect(f.pushes[0]).toMatchObject({ title: "Codex 需要你回答", body: "新对话" });
    expect(f.pushes[0].url).toContain(encodeURIComponent(final.params.threadId));
    expect(JSON.stringify(f.pushes)).not.toContain("私密问题正文");
    f.send({ ...question, id: "another-connection" }); await wait(100);
    expect(f.pushes).toHaveLength(1);
    await f.start(); f.send(final); f.send(completed);
    await eventually(() => f.pushes.length === 2);
    expect(f.pushes[1].title).toBe("Codex 运行结束");
  });
  it.each(["http", "stream"])("%s 只推送移动端具体指令，同会话查看与电脑后续回合静默", async (transport) => {
    const f = await fixture(); await f.settings();
    if (transport === "stream") await f.stream();
    else await f.rpc({ id: 0, method: "initialize", params: {} });
    f.send(final); f.send(completed); await wait(100);
    expect(f.pushes).toHaveLength(0);
    // 确认返回较晚，已经收到实时 final 与完成证据也必须正常推送。
    await f.start(); await eventually(() => f.pushes.length === 1);
    f.send({ ...final, params: { ...final.params, turnId: "desktop-next" } });
    f.send({ ...completed, params: { ...completed.params, turn: { id: "desktop-next", status: "completed" } } });
    f.send(final); f.send(completed); await wait(100);
    expect(f.pushes).toHaveLength(1);
  });

  it.each(["http", "stream"])("%s 仅收到完成事件时按本机真实子 Agent 元数据静默", async (transport) => {
    const f = await fixture(); await f.settings();
    if (transport === "stream") await f.stream();
    else await f.rpc({ id: 0, method: "initialize", params: {} });
    await f.start();
    const threadId = "01a12457-49bd-79c3-abdb-cfdf41878cfc";
    const directory = join(f.root, "sessions", "2026", "10", "10");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `rollout-2026-10-10T13-44-22-${threadId}.jsonl`), JSON.stringify({
      type: "session_meta", payload: { id: threadId, parent_thread_id: "parent",
        source: { subagent: { thread_spawn: { parent_thread_id: "parent" } } }, thread_source: "subagent" },
    }) + "\n");
    await f.start(threadId);
    f.send({ ...final, params: { ...final.params, threadId } });
    f.send({ ...completed, params: { ...completed.params, threadId } });
    // 后续普通完成必须送达，确保队列已处理过子 Agent 的分类补查。
    f.send(final); f.send(completed); await eventually(() => f.pushes.length > 0); await wait(100);
    expect(f.pushes).toHaveLength(1);
    expect(f.pushes[0].url).toContain(encodeURIComponent(final.params.threadId));
  });

  it.each([
    { threadSource: "subagent" }, { threadSource: "memory_consolidation" },
    { sourceKind: "subAgentReview" }, { ephemeral: true }, { source: { internal: "title" } },
  ])("列表隐藏分类 %j 经摘要登记后不发送 Bark", async (metadata) => {
    const f = await fixture(); await f.settings();
    await f.rpc({ id: 0, method: "initialize", params: {} }); await f.start();
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id,
      result: { thread: { id: final.params.threadId, ...metadata } } })));
    await f.rpc({ id: 1, method: "thread/read", params: { threadId: final.params.threadId } });
    f.send(final); f.send(completed); await wait(100);
    expect(f.pushes).toHaveLength(0);
    await f.start("main");
    f.send({ ...final, params: { ...final.params, threadId: "main" } });
    f.send({ ...completed, params: { ...completed.params, threadId: "main" } });
    await eventually(() => f.pushes.length === 1);
    expect(f.pushes[0].url).toContain("threadId=main");
  });

  it.each(["started", "thread/read", "thread/resume", "thread/list", "stream"])("无标题子会话经 %s 登记后不推送，普通会话继续推送", async (method) => {
    const f = await fixture(); await f.settings();
    const thread = { id: final.params.threadId, source: { subAgent: { thread_spawn: { parent_thread_id: "main" } } } };
    if (method === "stream") {
      const client = await f.stream(); await f.start();
      f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: { thread } })));
      client.send(JSON.stringify({ id: 2, method: "thread/read", params: { threadId: thread.id } }));
      await eventually(() => f.requests.some((request) => request.method === "thread/read")); await wait(30);
    } else {
      await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start();
      if (method === "started") f.send({ method: "thread/started", params: { thread } });
      else {
        f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: method === "thread/list" ? { data: [thread] } : { thread } })));
        await f.rpc({ id: 2, method, params: { threadId: thread.id } });
      }
    }
    f.send({ method: "thread/name/updated", params: { threadId: thread.id, threadName: "签名子任务" } });
    f.send(final); f.send(completed); await wait(100); expect(f.pushes).toHaveLength(0);
    await f.start("main");
    f.send({ ...final, params: { ...final.params, threadId: "main" } });
    f.send({ ...completed, params: { ...completed.params, threadId: "main" } });
    await eventually(() => f.pushes.length === 1);
    expect(f.pushes[0].url).toContain("threadId=main");
  });

  it("实时新会话的标题作为正文，其他会话不串用", async () => {
    const f = await fixture(); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start();
    f.send({ method: "thread/started", params: { thread: { id: final.params.threadId, name: "修复推送时机", preview: "首条需求" } } });
    f.send({ method: "thread/started", params: { thread: { id: "other", name: "其他会话" } } });
    f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1);
    expect(f.pushes[0].body).toBe("修复推送时机");
    expect(JSON.stringify(f.pushes)).not.toContain("private output");
  });

  it.each(["thread/resume", "thread/list"])("HTTP %s 的标题用于退出后的完成通知，历史本身不触发", async (method) => {
    const f = await fixture(); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start();
    const thread = { id: final.params.threadId, name: "检查会话标题", turns: [{ id: "old", status: "completed", items: [final.params.item] }] };
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: method === "thread/list" ? { data: [thread, { id: "other", name: "其他会话" }] } : { thread } })));
    await f.rpc({ id: 2, method, params: { threadId: final.params.threadId } });
    await wait(50); expect(f.pushes).toHaveLength(0);
    f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1);
    expect(f.pushes[0].body).toBe("检查会话标题");
  });

  it.each([true, false])("HTTP 重命名成功=%s，只采用已保存的标题", async (success) => {
    const f = await fixture(); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start();
    f.send({ method: "thread/started", params: { thread: { id: final.params.threadId, name: "原会话标题" } } });
    await wait(30);
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, ...(success ? { result: {} } : { error: { code: -1, message: "rename failed" } }) })));
    await f.rpc({ id: 2, method: "thread/name/set", params: { threadId: final.params.threadId, name: "新会话标题" } });
    f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1);
    expect(f.pushes[0].body).toBe(success ? "新会话标题" : "原会话标题");
  });

  it("流式 RPC 标题在 App 断开后仍可用，实时改名采用最新标题", async () => {
    const f = await fixture(); await f.settings(); const client = await f.stream(); await f.start();
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: message.method === "thread/resume" ? { thread: { id: final.params.threadId, name: "初始标题" } } : { turn: { id: "turn", status: "inProgress" } } })));
    client.send(JSON.stringify({ id: 1, method: "thread/resume", params: { threadId: final.params.threadId } }));
    await eventually(() => f.requests.some((request) => request.method === "thread/resume")); await wait(30);
    client.send(JSON.stringify({ id: 2, method: "turn/start", params: { threadId: final.params.threadId } }));
    await eventually(() => f.requests.some((request) => request.method === "turn/start")); await wait(30);
    client.close(); await wait(30);
    f.send({ method: "thread/name/updated", params: { threadId: final.params.threadId, threadName: "最终会话标题" } });
    f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1);
    expect(f.pushes[0].body).toBe("最终会话标题");
  });

  it("流式成功 RPC 提供会话标题，空名称使用会话预览", async () => {
    const f = await fixture(); await f.settings(); const client = await f.stream(); await f.start();
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: { thread: { id: final.params.threadId, name: "", preview: "未命名会话的首条需求" } } })));
    client.send(JSON.stringify({ id: 1, method: "thread/read", params: { threadId: final.params.threadId } }));
    await eventually(() => f.requests.some((request) => request.method === "thread/read")); await wait(30);
    f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1);
    expect(f.pushes[0].body).toBe("未命名会话的首条需求");
  });

  it("final 消息结束时仍等待整个回合成功结束，重复事件只发一次", async () => {
    const f = await fixture(); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start();
    f.send(final); await wait(100); expect(f.pushes).toHaveLength(0);
    f.send({ method: "item/completed", params: { ...final.params, item: { id: "tool", type: "commandExecution" } } });
    await wait(50); expect(f.pushes).toHaveLength(0);
    f.send(completed); await eventually(() => f.pushes.length === 1);
    f.send(final); f.send(completed); await wait(100); expect(f.pushes).toHaveLength(1);
  });

  it.each(["failed", "interrupted"])("final 后回合 %s 时不通知完成", async (status) => {
    const f = await fixture(); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start();
    f.send(final); f.send({ ...completed, params: { ...completed.params, turn: { ...completed.params.turn, status } } });
    await wait(100); expect(f.pushes).toHaveLength(0);
  });

  it("只有过程回复的成功回合不推送，其他回合完成也不触发未完成 final", async () => {
    const f = await fixture(); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start();
    f.send({ ...final, params: { ...final.params, item: { ...final.params.item, phase: "commentary" } } }); f.send(completed);
    await wait(100); expect(f.pushes).toHaveLength(0);
    f.send({ ...final, params: { ...final.params, turnId: "still-running" } });
    f.send({ ...completed, params: { ...completed.params, turn: { id: "other-turn", status: "completed" } } });
    await wait(100); expect(f.pushes).toHaveLength(0);
  });

  it("成功回合完成事件直接携带 final 时发送一次", async () => {
    const f = await fixture(); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start();
    f.send({ ...completed, params: { ...completed.params, turn: { ...completed.params.turn, items: [final.params.item] } } });
    await eventually(() => f.pushes.length === 1);
  });

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
    const f = await fixture(); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start();
    f.send({ ...final, params: { ...final.params, item: { ...final.params.item, phase: "commentary" } } }); f.send({ ...final, params: { ...final.params, item: { ...final.params.item, type: "reasoning" } } }); await wait(80); expect(f.pushes).toHaveLength(0);
    f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1);
    expect(f.pushes[0]).toMatchObject({ title: "Codex 运行结束", body: "新对话", group: "办公室 Mac", url: `codexmobile://thread?backendId=${encodeURIComponent(f.backendId)}&threadId=${encodeURIComponent(final.params.threadId)}`, id: expect.any(String) }); expect(JSON.stringify(f.pushes)).not.toContain("private output");
    const client = await f.stream(); await f.start(); f.send(final); f.send(completed); await wait(80); expect(f.pushes).toHaveLength(1); client.close();
    expect((await stat(join(f.root, "codex-mobile-notifications"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(f.root, "codex-mobile-notifications", "state.json"))).mode & 0o777).toBe(0o600);
    await f.restart(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start(); f.send(final); f.send(completed); await wait(80); expect(f.pushes).toHaveLength(1);
    await f.settings({ clientId: f.clientId, backendId: f.backendId, mode: "system" }); f.send({ ...final, params: { ...final.params, turnId: "another" } }); f.send({ ...completed, params: { ...completed.params, turn: { id: "another", status: "completed" } } }); await wait(80); expect(f.pushes).toHaveLength(1);
    expect(await readFile(join(f.root, "codex-mobile-notifications", "state.json"), "utf8")).not.toContain(f.barkUrl);
  });

  it.each(["http", "stream"])("%s 相同接收地址的不同安装和后端只通知一次", async (transport) => {
    const f = await fixture(); await f.settings();
    const latest = { clientId: randomUUID(), backendId: "reinstalled-backend", mode: "bark", barkUrl: f.barkUrl + "/" };
    await f.settings(latest);
    if (transport === "stream") await f.stream();
    else await f.rpc({ id: 1, method: "initialize", params: {} });
    await f.start(); f.send(final); f.send(completed);
    await eventually(() => f.pushes.length > 0); await wait(100);
    expect(f.pushes).toHaveLength(1);
    expect(f.pushes[0].url).toContain("backendId=reinstalled-backend");
    const state = JSON.parse(await readFile(join(f.root, "codex-mobile-notifications", "state.json"), "utf8"));
    expect(state.subscriptions).toHaveLength(2);
    expect(state.delivered).toHaveLength(1);
  });

  it("不同接收地址各自通知，同安装的重复后端按地址合并", async () => {
    const f = await fixture(); await f.settings();
    await f.settings({ clientId: f.clientId, backendId: "alias", mode: "bark", barkUrl: f.barkUrl });
    await f.settings({ clientId: randomUUID(), backendId: "other-phone", mode: "bark", barkUrl: f.barkUrl.replace("deviceKey", "otherKey") });
    await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start(); f.send(final); f.send(completed);
    await eventually(() => f.pushes.length >= 2); await wait(100);
    expect(f.pushes).toHaveLength(2);
    expect(new Set(f.pushes.map((push) => push.id)).size).toBe(2);
  });

  it("接收地址去重跨重启与安装 ID 变更保留，注销互不影响", async () => {
    const f = await fixture(); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start(); f.send(final); f.send(completed);
    await eventually(() => f.pushes.length === 1);
    await f.restart();
    const replacement = { clientId: randomUUID(), backendId: "replacement", mode: "bark", barkUrl: f.barkUrl };
    await f.settings(replacement);
    await f.settings({ clientId: f.clientId, backendId: f.backendId, mode: "system" });
    await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start(); f.send(final); f.send(completed); await wait(100);
    expect(f.pushes).toHaveLength(1);
    await f.settings({ clientId: f.clientId, backendId: f.backendId, mode: "bark", barkUrl: f.barkUrl });
    await f.settings({ ...replacement, mode: "system" });
    const threadId = "next-task";
    await f.start(threadId);
    f.send({ ...final, params: { ...final.params, threadId } });
    f.send({ ...completed, params: { ...completed.params, threadId } });
    await eventually(() => f.pushes.length === 2);
    expect(f.pushes[1].url).toContain(`backendId=${encodeURIComponent(f.backendId)}`);
  });

  it("旧安装的已发送记录阻止同接收地址的新订阅补发", async () => {
    const f = await fixture(); await f.settings();
    const path = join(f.root, "codex-mobile-notifications", "state.json");
    const state = JSON.parse(await readFile(path, "utf8"));
    state.delivered = [createHash("sha256").update(JSON.stringify([f.clientId, f.backendId, final.params.threadId, "turn"])).digest("hex")];
    await writeFile(path, JSON.stringify(state)); await f.restart();
    await f.settings({ clientId: randomUUID(), backendId: "new-install", mode: "bark", barkUrl: f.barkUrl });
    await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start(); f.send(final); f.send(completed);
    // 后续独立任务必须到达，证明通知队列已经处理旧回合。
    const threadId = "fresh-task";
    await f.start(threadId);
    f.send({ ...final, params: { ...final.params, threadId } });
    f.send({ ...completed, params: { ...completed.params, threadId } });
    await eventually(() => f.pushes.length > 0); await wait(100);
    expect(f.pushes).toHaveLength(1);
    expect(f.pushes[0].url).toContain("threadId=fresh-task");
    await f.settings({ clientId: f.clientId, backendId: f.backendId, mode: "system" });
    await f.restart(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start(); f.send(final); f.send(completed); await wait(100);
    expect(f.pushes).toHaveLength(1);
  });

  it("真实 HTTP 推送失败不改变 RPC，重试有界", async () => {
    const f = await fixture(true); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start(); f.send(final); f.send(completed);
    expect((await f.rpc({ id: 2, method: "thread/read", params: { threadId: "t" } })).status).toBe(200);
    await eventually(() => f.pushes.length === 3); await wait(100); expect(f.pushes).toHaveLength(3);
  });

  it("重复同步相同订阅不取消首次失败后的成功重试", async () => {
    const f = await fixture(1); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start(); f.send(final); f.send(completed);
    await eventually(() => f.pushes.length === 1); expect((await f.settings()).status).toBe(200);
    await eventually(() => f.pushes.length === 2); await wait(600); expect(f.pushes).toHaveLength(2); expect(f.pushes[1].id).toBe(f.pushes[0].id);
  });

  it("流式退出后稀疏 completed 继承 started 的 final phase", async () => {
    const f = await fixture(); await f.settings(); const client = await f.stream(); await f.start();
    client.send(JSON.stringify({ id: 1, method: "turn/start", params: { threadId: final.params.threadId } })); await eventually(() => f.requests.some((m) => m.method === "turn/start"));
    f.send({ ...final, method: "item/started" }); await wait(50); client.close(); await wait(50);
    f.send({ ...final, params: { ...final.params, item: { id: "final", type: "agentMessage" } } });
    f.send({ method: "turn/completed", params: { threadId: final.params.threadId, turn: { id: "turn", status: "completed" } } });
    await eventually(() => f.pushes.length === 1); await eventually(() => f.connections[0].readyState === WebSocket.CLOSED);
  });

  it("流式 phase 按连接、thread、turn、item 隔离", async () => {
    const f = await fixture(); await f.settings(); await f.stream(); await f.start(); f.send({ ...final, method: "item/started" });
    f.send({ ...final, params: { ...final.params, turnId: "other-turn", item: { id: "final", type: "agentMessage" } } });
    f.send({ ...final, params: { ...final.params, threadId: "other-thread", item: { id: "final", type: "agentMessage" } } });
    f.send({ ...final, params: { ...final.params, item: { id: "other-item", type: "agentMessage" } } }); await wait(50); expect(f.pushes).toHaveLength(0);
    await f.stream(); await f.start(); f.send({ ...final, params: { ...final.params, item: { id: "final", type: "agentMessage" } } }); await wait(50); expect(f.pushes).toHaveLength(0);
    f.send({ ...final, params: { ...final.params, item: { id: "final", type: "agentMessage" } } }, 0); f.send(completed, 0); await eventually(() => f.pushes.length === 1);
  });

  it("流式 phase 最多保留512项分类 metadata", async () => {
    const f = await fixture(); await f.settings(); await f.stream(); await f.start();
    for (let n = 0; n <= 512; n++) f.send({ ...final, method: "item/started", params: { ...final.params, item: { id: `item-${n}`, type: "agentMessage", phase: "final_answer", text: "不缓存正文" } } });
    f.send({ ...final, params: { ...final.params, item: { id: "item-0", type: "agentMessage" } } }); f.send(completed); await wait(50); expect(f.pushes).toHaveLength(0);
    f.send({ ...final, params: { ...final.params, item: { id: "item-512", type: "agentMessage" } } }); f.send(completed); await eventually(() => f.pushes.length === 1);
  });

  it("流式审批解决后释放保留连接，数字和字符串请求 ID 相互独立", async () => {
    const f = await fixture(); await f.settings();
    const client = await f.stream();
    const messages: any[] = [];
    client.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    f.send({ id: 1, method: "item/commandExecution/requestApproval", params: { threadId: "t" } });
    f.send({ id: "1", method: "item/tool/requestUserInput", params: { threadId: "t" } });
    await eventually(() => messages.length === 2);
    const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    client.close(); await closed;
    f.send({ method: "serverRequest/resolved", params: { threadId: "t", requestId: 1 } });
    f.send({ method: "serverRequest/resolved", params: { threadId: "wrong-thread", requestId: "1" } });
    await wait(1100);
    expect(f.connections[0].readyState).toBe(WebSocket.OPEN);
    f.send({ method: "serverRequest/resolved", params: { threadId: "t", requestId: "1" } });
    await eventually(() => f.connections[0].readyState === WebSocket.CLOSED);
  });

  it("注销 Bark 后释放已断开的流式上游", async () => {
    const f = await fixture(); await f.settings(); const client = await f.stream(); await f.start();
    client.send(JSON.stringify({ id: 1, method: "turn/start", params: { threadId: final.params.threadId } })); await eventually(() => f.requests.some((m) => m.method === "turn/start")); client.close(); await wait(50); expect(f.connections[0].readyState).toBe(WebSocket.OPEN);
    await f.settings({ clientId: f.clientId, backendId: f.backendId, mode: "system" }); await eventually(() => f.connections[0].readyState === WebSocket.CLOSED);
  });

  it("turn/completed 先于客户端断开时仍接收迟到的 final", async () => {
    const f = await fixture(); await f.settings(); const client = await f.stream(); await f.start();
    client.send(JSON.stringify({ id: 1, method: "turn/start", params: { threadId: final.params.threadId } })); await eventually(() => f.requests.some((m) => m.method === "turn/start"));
    f.send({ method: "turn/completed", params: { threadId: final.params.threadId, turn: { id: "turn", status: "completed" } } }); await wait(50); client.close(); await wait(50);
    expect(f.connections[0].readyState).toBe(WebSocket.OPEN); f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1); await eventually(() => f.connections[0].readyState === WebSocket.CLOSED);
  });

  it("历史 RPC 结果不补发，HTTP 稀疏 completed 在 item 合并后判断 final", async () => {
    const f = await fixture(); await f.settings(); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start();
    f.respond((socket, message) => socket.send(JSON.stringify({ id: message.id, result: { thread: { id: final.params.threadId, turns: [{ id: "old", status: "completed", items: [final.params.item] }] } } })));
    await f.rpc({ id: 2, method: "thread/read", params: { threadId: final.params.threadId } }); await wait(50); expect(f.pushes).toHaveLength(0);
    f.send({ ...final, method: "item/started" }); f.send({ ...final, params: { ...final.params, item: { id: "final", type: "agentMessage" } } }); f.send(completed); await eventually(() => f.pushes.length === 1);
  });

  it("pending turn/start 断开后仍接收 RPC 结果与完成事件", async () => {
    const f = await fixture(); await f.settings(); f.respond(() => {}); const client = await f.stream();
    client.send(JSON.stringify({ id: 42, method: "turn/start", params: { threadId: final.params.threadId } })); await eventually(() => f.requests.some((m) => m.id === 42)); client.close(); await wait(50); expect(f.connections[0].readyState).toBe(WebSocket.OPEN);
    f.send({ method: "turn/completed", params: { threadId: final.params.threadId, turn: { id: "turn", status: "completed" } } });
    f.send({ id: 42, result: { turn: { id: "turn", status: "inProgress" } } }); f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1); await eventually(() => f.connections[0].readyState === WebSocket.CLOSED);
  });

  it("流式客户端退出后保留运行中连接，完成与 final 竞态仍推送并释放", async () => {
    const f = await fixture(); await f.settings(); const client = await f.stream(); await f.start();
    client.send(JSON.stringify({ id: 1, method: "turn/start", params: { threadId: final.params.threadId } })); await eventually(() => f.requests.some((m) => m.method === "turn/start")); client.close(); await wait(80); expect(f.connections[0].readyState).toBe(WebSocket.OPEN);
    f.send({ method: "turn/completed", params: { threadId: final.params.threadId, turn: { id: "turn", status: "completed" } } }); f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1); await eventually(() => f.connections[0].readyState === WebSocket.CLOSED);
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

describe("Bark 关注订阅", () => {
  it.each(["http", "stream"])("%s 电脑完成只通知关注手机，同地址合并、取消与重启去重", async transport => {
    const f = await fixture();
    const followed = { clientId: f.clientId, backendId: f.backendId, mode: "bark", barkUrl: f.barkUrl, followedThreadIds: [final.params.threadId] };
    await f.settings(followed);
    await f.settings({ ...followed, clientId: randomUUID(), backendId: "alias" });
    await f.settings({ ...followed, clientId: randomUUID(), backendId: "other", barkUrl: f.barkUrl.replace("deviceKey", "otherKey"), followedThreadIds: [] });
    if (transport === "stream") await f.stream(); else await f.rpc({ id: 0, method: "initialize", params: {} });
    f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1);
    expect(f.pushes[0].url).not.toContain("backendId=other");
    await f.restart(); await f.rpc({ id: 0, method: "initialize", params: {} });
    f.send(final); f.send(completed); await wait(100); expect(f.pushes).toHaveLength(1);
    await f.settings({ ...followed, followedThreadIds: [] });
    // alias 仍关注，先取消别名后电脑下一轮应静默。
    const state = JSON.parse(await readFile(join(f.root, "codex-mobile-notifications/state.json"), "utf8"));
    for (const entry of state.subscriptions) await f.settings({ ...entry, mode: "bark", followedThreadIds: [] });
    f.send({ ...final, params: { ...final.params, turnId: "next" } });
    f.send({ ...completed, params: { ...completed.params, turn: { id: "next", status: "completed" } } });
    await wait(100); expect(f.pushes).toHaveLength(1);
  });
  it("移动确认迟到：先通知关注地址，再向其余地址投递同回合且不重复", async () => {
    const f = await fixture();
    await f.settings({ clientId: f.clientId, backendId: f.backendId, mode: "bark", barkUrl: f.barkUrl, followedThreadIds: [final.params.threadId] });
    await f.settings({ clientId: randomUUID(), backendId: "other", mode: "bark", barkUrl: f.barkUrl.replace("deviceKey", "otherKey") });
    await f.rpc({ id: 0, method: "initialize", params: {} });
    f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1);
    await f.start(); await eventually(() => f.pushes.length === 2);
    f.send(final); f.send(completed); await wait(50); expect(f.pushes).toHaveLength(2);
  });
  it("同 Bark 地址变更关注会保存，旧设置缺失为空且无效列表拒绝", async () => {
    const f = await fixture(); await f.settings();
    const body = { clientId: f.clientId, backendId: f.backendId, mode: "bark", barkUrl: f.barkUrl };
    await f.settings({ ...body, followedThreadIds: ["a", "a", "b"] });
    const path = join(f.root, "codex-mobile-notifications/state.json");
    expect(JSON.parse(await readFile(path, "utf8")).subscriptions[0].followedThreadIds).toEqual(["a", "b"]);
    for (const ids of [null, "a", [""], [" "], ["bad\n"], [1], ["x".repeat(1025)], Array.from({ length: 513 }, (_, n) => String(n))]) {
      expect((await f.settings({ ...body, followedThreadIds: ids })).status).toBe(400);
    }
    await f.settings(body); expect(JSON.parse(await readFile(path, "utf8")).subscriptions[0].followedThreadIds).toEqual([]);
  });
});

it("关注订阅在无手机连接与网关重启后只读观察运行回合，旧历史不补发", async () => {
  const f = await fixture(); let status = "inProgress";
  f.respond((socket, message) => {
    if (message.id == null) return;
    const turns = [{ id: "background", status, items: status === "completed" ? [final.params.item] : [] }, { id: "historical", status: "completed", items: [final.params.item] }];
    const offset = Number(message.params?.cursor ?? "0"), limit = message.params?.limit ?? 1;
    const result = message.method === "thread/read" ? { thread: { id: final.params.threadId, name: "后台任务", status: { type: status === "inProgress" ? "active" : "idle" } } } : message.method === "thread/turns/list" ? {
      data: turns.slice(offset, offset + limit), nextCursor: offset + limit < turns.length ? String(offset + limit) : null,
    } : {};
    socket.send(JSON.stringify({ id: message.id, result }));
  });
  const until = async (check: () => boolean) => { for (let n = 0; n < 120 && !check(); n++) await wait(50); expect(check()).toBe(true); };
  await f.settings({ clientId: f.clientId, backendId: f.backendId, mode: "bark", barkUrl: f.barkUrl, followedThreadIds: [final.params.threadId] });
  await until(() => f.requests.some(request => request.method === "thread/turns/list")); expect(f.pushes).toHaveLength(0);
  // 网关重启时仍运行；之后完成应送达，客户端完全没有连接。
  await f.restart(); const count = f.requests.filter(request => request.method === "thread/turns/list").length;
  await until(() => f.requests.filter(request => request.method === "thread/turns/list").length > count);
  status = "completed"; await until(() => f.pushes.length === 1);
  expect(f.pushes[0].body).toBe("后台任务"); expect(f.requests.some(request => ["thread/resume", "turn/start", "turn/steer"].includes(request.method))).toBe(false);
  await f.restart(); await wait(150); expect(f.pushes).toHaveLength(1);
  await f.settings({ clientId: f.clientId, backendId: f.backendId, mode: "bark", barkUrl: f.barkUrl, followedThreadIds: [] });
  const canceled = f.requests.length; await wait(3100); expect(f.requests).toHaveLength(canceled);
}, 15_000);

it("后台完成入口沿用隐藏子会话分类，稀疏摘要不能恢复推送资格", async () => {
  const f = await fixture(); await f.settings({ clientId: f.clientId, backendId: f.backendId, mode: "bark", barkUrl: f.barkUrl, followedThreadIds: [final.params.threadId] });
  const notifications = new BarkNotifications({ codexHome: f.root, displayName: "测试" });
  try {
    await notifications.initialized();
    notifications.observeRpc({ method: "thread/read" }, { result: { thread: { id: final.params.threadId, threadSource: "subagent" } } });
    notifications.observeRpc({ method: "thread/read" }, { result: { thread: { id: final.params.threadId, name: "稀疏摘要" } } });
    notifications.notifyFollowedCompletion(final.params.threadId, "background-hidden");
    await wait(100); expect(f.pushes).toHaveLength(0);
  } finally { await notifications.close(); }
});

it("只读观察器发现已有手机来源的完成时，未关注订阅仍保留原完成通知", async () => {
  const f = await fixture(); const body = { clientId: f.clientId, backendId: f.backendId, mode: "bark", barkUrl: f.barkUrl, followedThreadIds: [final.params.threadId] };
  await f.settings(body); await f.settings({ ...body, clientId: randomUUID(), backendId: "other", barkUrl: f.barkUrl.replace("deviceKey", "otherKey"), followedThreadIds: [] });
  const notifications = new BarkNotifications({ codexHome: f.root, displayName: "测试" });
  try {
    await notifications.initialized();
    notifications.observeRpc({ method: "turn/start", params: { threadId: final.params.threadId } }, { result: { turn: { id: "background-mobile" } } });
    notifications.notifyFollowedCompletion(final.params.threadId, "background-mobile");
    await eventually(() => f.pushes.length === 2);
  } finally { await notifications.close(); }
});

describe("Bark 重试按当前地址与资格判断", () => {
  it.each(["mobile", "followed"])("%s 完成首次503后改关注无关会话仍成功重试", async origin => {
    const f = await fixture(1);
    const body = { clientId: f.clientId, backendId: f.backendId, mode: "bark", barkUrl: f.barkUrl, followedThreadIds: [final.params.threadId] };
    await f.settings(body); await f.rpc({ id: 1, method: "initialize", params: {} }); if (origin === "mobile") await f.start();
    f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1);
    await f.settings({ ...body, followedThreadIds: [final.params.threadId, "unrelated"] });
    await eventually(() => f.pushes.length === 2); expect(f.pushes[1].id).toBe(f.pushes[0].id);
  });
  it.each(["mobile", "followed"])("%s 完成首次503后取消当前关注，仅手机来源继续重试", async origin => {
    const f = await fixture(1);
    const body = { clientId: f.clientId, backendId: f.backendId, mode: "bark", barkUrl: f.barkUrl, followedThreadIds: [final.params.threadId] };
    await f.settings(body); await f.rpc({ id: 1, method: "initialize", params: {} }); if (origin === "mobile") await f.start();
    f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1);
    await f.settings({ ...body, followedThreadIds: [] });
    if (origin === "mobile") await eventually(() => f.pushes.length === 2);
    else { await wait(850); expect(f.pushes).toHaveLength(1); }
  });
  it("同地址选中订阅注销后，其他有效关注订阅接续重试并更新跳转后端", async () => {
    const f = await fixture(1); const body = { clientId: f.clientId, backendId: f.backendId, mode: "bark", barkUrl: f.barkUrl, followedThreadIds: [final.params.threadId] };
    await f.settings(body); const alias = { ...body, clientId: randomUUID(), backendId: "alias" }; await f.settings(alias);
    await f.rpc({ id: 1, method: "initialize", params: {} }); f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1);
    expect(f.pushes[0].url).toContain("backendId=alias"); await f.settings({ ...alias, mode: "system" });
    await eventually(() => f.pushes.length === 2); expect(f.pushes[1].url).toContain(`backendId=${encodeURIComponent(f.backendId)}`); expect(f.pushes[1].id).toBe(f.pushes[0].id);
  });
  it.each(["unsubscribe", "url"])("首次503后 %s 导致旧地址失效，旧推送不再重试", async action => {
    const f = await fixture(1); const body = { clientId: f.clientId, backendId: f.backendId, mode: "bark", barkUrl: f.barkUrl, followedThreadIds: [final.params.threadId] };
    await f.settings(body); await f.rpc({ id: 1, method: "initialize", params: {} }); await f.start(); f.send(final); f.send(completed); await eventually(() => f.pushes.length === 1);
    await f.settings(action === "unsubscribe" ? { ...body, mode: "system" } : { ...body, barkUrl: f.barkUrl.replace("deviceKey", "replacement") });
    await wait(850); expect(f.pushes).toHaveLength(1);
  });
});
