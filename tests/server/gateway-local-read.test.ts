// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import WebSocket, { WebSocketServer } from 'ws';
import { expect, it, vi } from 'vitest';
import { createGateway } from '../../server/gateway.js';
import { OperationScheduler } from '../../server/operation-scheduler.js';
import { GatewayRpc } from '../../server/gateway-rpc.js';
import { PrivateStore } from '../../server/remote/private-store.js';
import { gatewayRemote } from './fixtures/gateway-remote.js';

function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function promptly<T>(promise: Promise<T>): Promise<T> {
  let timer!: NodeJS.Timeout;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('本地读取被共享持久队列阻塞')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}
async function localUpstream(home: string) {
  const http = createServer(); const sockets = new WebSocketServer({ server: http });
  const frames: any[] = [];
  sockets.on('connection', socket => socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString()); frames.push(message);
    if (message.id == null) return;
    socket.send(JSON.stringify({ id: message.id, result: message.method === 'initialize' ? { codexHome: home }
      : message.method === 'thread/turns/list' ? { data: [], nextCursor: null }
      : { thread: { id: message.params?.threadId, status: { type: 'idle' }, turns: [] } } }));
  }));
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  return { frames, url: `ws://127.0.0.1:${(http.address() as any).port}`, async close() {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    await new Promise<void>(resolve => http.close(() => resolve()));
  } };
}

it.each(['HTTP', 'WebSocket'])('%s 本地打开会话不等待 Remote 账本锁，也不新增持久读取记录', async transport => {
  const f = await gatewayRemote(); const upstream = await localUpstream(f.gatewayHome);
  const gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external', upstreamUrl: upstream.url,
    staticDir: null, codexHome: f.gatewayHome, targetResolver: f.resolver });
  const origin = `http://127.0.0.1:${gateway.port}`; const sessionId = randomUUID();
  const pending: Promise<unknown>[] = []; let socket: WebSocket | undefined; let lock: Promise<void> | undefined; let cachedReadId: string | undefined;
  const unlocked = latch(); const entered = latch();
  const post = async (message: unknown, requestId = randomUUID()) => {
    const response = await fetch(`${origin}/api/rpc?sessionId=${sessionId}`, { method: 'POST', body: JSON.stringify({ requestId, message }) });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    if (transport === 'WebSocket') {
      socket = new WebSocket(`ws://127.0.0.1:${gateway.port}/ws`);
      await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject); });
    }
    let next = 0;
    const rpc = (method: string, params: unknown) => {
      const message = { id: ++next, method, params };
      const work = socket ? new Promise<any>((resolve, reject) => {
        const receive = (bytes: WebSocket.RawData) => {
          const response = JSON.parse(bytes.toString()); if (response.id !== message.id) return;
          socket!.off('message', receive); socket!.off('error', reject); resolve({ status: 200, body: response });
        };
        socket!.on('message', receive); socket!.once('error', reject); socket!.send(JSON.stringify(message));
      }) : post(message);
      pending.push(work); return work;
    };
    expect((await rpc('initialize', { clientInfo: { name: 'local-performance-test', version: '1' } })).body.result.codexHome).toBe(f.gatewayHome);
    await f.runtime.close(); // Remote 整体不可用也不能影响本地会话。
    // 同一个真实账本锁可被 Remote 接收、扫描和持久化占用；本地导航不能排在后面。
    const directory = join(f.gatewayHome, 'codex-mobile-operations');
    lock = new PrivateStore(directory).withInitialization('operation-queue', async () => { entered.release(); await unlocked.promise; });
    await entered.promise;
    const before = await readFile(join(directory, 'operations.json'), 'utf8');
    for (const [method, params] of [
      ['thread/read', { threadId: 'thread', includeTurns: false }],
      ['thread/resume', { threadId: 'thread', excludeTurns: true, initialTurnsPage: { limit: 1, itemsView: 'summary' } }],
      ['thread/turns/list', { threadId: 'thread', limit: 1, sortDirection: 'desc', itemsView: 'summary' }],
    ] as const) {
      const response = await promptly(rpc(method, params));
      expect(response.status).toBe(200); expect(response.body.error).toBeUndefined();
    }
    if (transport === 'HTTP') {
      const id = randomUUID(); const message = { id: 99, method: 'thread/read', params: { threadId: 'thread' } };
      cachedReadId = id;
      const readsBefore = upstream.frames.filter(frame => frame.method === 'thread/read').length;
      const read = post(message, id); pending.push(read); expect((await promptly(read)).status).toBe(200);
      const repeat = post(message, id); pending.push(repeat); expect((await promptly(repeat)).status).toBe(200);
      const query = fetch(`${origin}/api/operations?sessionId=${sessionId}&requestId=${id}`); pending.push(query);
      expect(await (await promptly(query)).json()).toMatchObject({ status: 'completed', message: { id: 99 } });
      const conflict = post({ ...message, params: { threadId: 'other' } }, id); pending.push(conflict);
      expect((await promptly(conflict)).status).toBe(409);
      expect(upstream.frames.filter(frame => frame.method === 'thread/read')).toHaveLength(readsBefore + 1);
    }
    expect(await readFile(join(directory, 'operations.json'), 'utf8')).toBe(before);
    expect(f.frames).toHaveLength(0);
    unlocked.release(); await lock;
    if (transport === 'HTTP') {
      // 换 Session 不能读到刚才缓存的原响应。
      const response = await fetch(`${origin}/api/operations?sessionId=${randomUUID()}&requestId=${cachedReadId}`);
      expect(response.status).toBe(404);
    }
  } finally {
    unlocked.release(); await lock; await Promise.allSettled(pending);
    socket?.terminate(); await gateway.close(); await upstream.close();
  }
  await expect(readFile(join(f.gatewayHome, 'codex-mobile-observers', 'index.json'))).rejects.toMatchObject({ code: 'ENOENT' });
}, 20000);

it.each(['turn/start', 'thread/resume'])('本地 %s 携 client readOnly 标记仍先持久入队', async method => {
  const f = await gatewayRemote(); const upstream = await localUpstream(f.gatewayHome);
  const scheduler = new OperationScheduler({ directory: join(f.gatewayHome, 'ledger'), gatewayId: 'gateway', gatewayCodexHome: f.gatewayHome,
    resolver: f.resolver, upstreamUrl: upstream.url, remoteConsumers: () => { throw new Error('不应使用 Remote'); } });
  const rpc = new GatewayRpc(f.resolver, scheduler); const context = await f.resolver.operationContext(); const sessionId = randomUUID();
  const call = () => ({ deadline: performance.now() + 10000 }); const id = randomUUID();
  const submit = vi.spyOn(scheduler, 'submit');
  try {
    await rpc.dispatch(context, sessionId, { requestId: randomUUID(), message: { id: 1, method: 'initialize', params: {} } }, call());
    const message = { id: 2, method, readOnly: true,
      params: { threadId: 'thread', ...(method === 'thread/resume' ? { model: 'changed-model' } : { input: [{ type: 'text', text: 'test' }] }) } };
    const response = await rpc.dispatch(context, sessionId, { requestId: id, message }, call());
    expect(submit).toHaveBeenCalledOnce(); expect([200, 202]).toContain(response.status);
    const ledger = JSON.parse(await readFile(join(f.gatewayHome, 'ledger', 'operations.json'), 'utf8'));
    expect(ledger.records.find((record: any) => record.id === id)).toBeDefined();
  } finally { await scheduler.close(); await upstream.close(); }
}, 15000);

it('本地后台刷新绕过持久队列，导航观察登记不阻塞响应且关闭等待登记结束', async () => {
  const f = await gatewayRemote(); const upstream = await localUpstream(f.gatewayHome);
  const observed = latch(); const finishObservation = latch(); const unlocked = latch(); const entered = latch();
  const onResponse = vi.fn(async () => { observed.release(); await finishObservation.promise; });
  const scheduler = new OperationScheduler({ directory: join(f.gatewayHome, 'ledger'), gatewayId: 'gateway', gatewayCodexHome: f.gatewayHome,
    resolver: f.resolver, upstreamUrl: upstream.url, remoteConsumers: () => { throw new Error('本地不应创建远程消费者'); }, onResponse });
  const rpc = new GatewayRpc(f.resolver, scheduler); const context = await f.resolver.operationContext(); const sessionId = randomUUID();
  const call = () => ({ deadline: performance.now() + 10000 });
  let lock: Promise<void> | undefined; const pending: Promise<unknown>[] = [];
  try {
    await rpc.dispatch(context, sessionId, { requestId: randomUUID(), message: { id: 1, method: 'initialize', params: {} } }, call());
    lock = new PrivateStore(join(f.gatewayHome, 'ledger')).withInitialization('operation-queue', async () => { entered.release(); await unlocked.promise; });
    await entered.promise;
    const refresh = scheduler.hostedRpc(context, { id: 2, method: 'thread/read', params: { threadId: 'thread' } }, call()); pending.push(refresh);
    expect((await promptly(refresh)).result).toHaveProperty('thread.id', 'thread');
    const navigation = rpc.dispatch(context, sessionId, { requestId: randomUUID(), message: { id: 3, method: 'thread/resume', params: { threadId: 'thread' } } }, call()); pending.push(navigation);
    expect((await promptly(navigation)).status).toBe(200); await promptly(observed.promise);
    expect(onResponse).toHaveBeenCalledWith(context, expect.objectContaining({ method: 'thread/resume' }), expect.objectContaining({ id: 3 }), sessionId);
    let closed = false; const closing = scheduler.close().then(() => { closed = true; }); pending.push(closing);
    await new Promise(resolve => setTimeout(resolve, 30)); expect(closed).toBe(false);
    finishObservation.release(); await promptly(closing);
  } finally {
    unlocked.release(); finishObservation.release(); await lock; await Promise.allSettled(pending);
    await scheduler.close(); await upstream.close();
  }
}, 20000);
