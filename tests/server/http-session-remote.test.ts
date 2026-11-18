// @vitest-environment node
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { HttpSessions, type HttpSessionRemoteOptions } from '../../server/http-session.js';
import { ResolvedRemoteTarget, TargetResolver } from '../../server/targets.js';
import { localMediaFiles } from '../../server/media-file-source.js';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer } from 'ws';
import { fixture, until } from './remote-session-fixture.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function sessionFixture() {
  const f = await fixture(); await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  const resolver = new TargetResolver({ identity: { version: 1, gatewayId: 'test-gateway', localHostId: 'test-local' }, remoteRuntime: f.runtime });
  const reference = { mode: 'remote' as const, gatewayId: 'test-gateway', account: { accountId: 'workspace', accountUserId: 'account-user', userId: 'user' }, target: { environmentId: 'local-env', installationId: 'local-install' } };
  const target = await resolver.resolve(reference); const context = await resolver.operationContext(reference);
  const projections = {
    changeHistory: { observe() {}, async beforeStart() {}, async cancelStart() {}, async get() { return null; }, async flush() {} },
    images: { async result(value: any) { return value; }, async notification(value: any) { return value; } },
    timestamps: { async result(_id: string, value: any) { return value; }, async notification(value: any) { return value; } },
    webCitations: { async result(_id: string, value: any) { return value; }, async notification(value: any) { return value; } },
  };
  const remote: HttpSessionRemoteOptions = { target, resolver, context, storageNamespace: target.descriptor.transportNamespace, projections,
    sidechatReplay: { files: { ...localMediaFiles, kind: 'remote' as const }, resolveReference: async () => null } };
  const sessions = new HttpSessions({ upstreamUrl: 'ws://127.0.0.1:1', codexHome: f.root, remote });
  cleanup.push(() => sessions.close());
  const http = createServer((request, response) => { void sessions.handle(request, response, new URL(request.url!, 'http://localhost')); });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => http.close(() => resolve())));
  const frames: any[] = []; const sequences = new Map<string, number>();
  const send = (route: any, message: any) => { const seq = (sequences.get(route.stream_id) ?? 0) + 1; sequences.set(route.stream_id, seq);
    f.connections.at(-1)!.send(JSON.stringify({ type: 'server_message', client_id: f.runtime.status().clientId, env_id: route.env_id, stream_id: route.stream_id, seq_id: seq, message })); };
  let respond = (frame: any) => { if (frame.message?.method && frame.message.id != null) send(frame, { id: frame.message.id, result: { method: frame.message.method } }); };
  const attach = () => f.connections.at(-1)!.on('message', raw => { const frame = JSON.parse(raw.toString()); frames.push(frame); respond(frame); }); attach();
  const call = async (sessionId: string, message: any, requestId = randomUUID(), epoch?: string) => {
    const response = await fetch(`http://127.0.0.1:${(http.address() as any).port}/api/rpc?sessionId=${sessionId}`, { method: 'POST', body: JSON.stringify({ requestId, message, epoch }) });
    return { status: response.status, body: await response.json() as any };
  };
  const events = async (sessionId: string) => (await fetch(`http://127.0.0.1:${(http.address() as any).port}/api/events?sessionId=${sessionId}`)).json() as Promise<any>;
  return { ...f, sessions, remote, frames, call, events, send, attach, respond(fn: typeof respond) { respond = fn; },
    init: (id: string) => call(id, { id: 1, method: 'initialize', params: { clientInfo: { name: 'controlled-session', version: '1' } } }) };
}
it('Remote 后台观察用摘要更新真实会话，完整回合只在显式读取时获取', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id);
  const threadId = 'observed'; const turn = { id: 'latest', status: 'inProgress', items: [{ type: 'agentMessage', text: '业务内容' }] };
  f.respond(frame => {
    const m = frame.message; if (!m?.method || m.id == null) return;
    if (m.method === 'thread/turns/list') {
      const items = m.params?.itemsView === 'full' ? [...turn.items, { type: 'commandExecution', aggregatedOutput: 'x'.repeat(450000) }] : turn.items;
      f.send(frame, { id: m.id, result: { data: [{ ...turn, items }] } }); return;
    }
    f.send(frame, { id: m.id, result: { thread: { id: threadId } } });
  });
  for (let pass = 0; pass < 2; pass++) {
    const response = await f.sessions.hostedRpc({ id: randomUUID(), method: 'mobile/thread/observe', params: { threadId } }, randomUUID(), { deadline: performance.now() + 800 });
    expect(response.result).toEqual({ thread: { id: threadId }, data: [turn] });
  }
  const observed = f.frames.map(frame => frame.message).filter(message => message?.method === 'thread/turns/list');
  expect(observed.map(message => message.params)).toEqual(Array(2).fill({ threadId, limit: 1, sortDirection: 'desc', itemsView: 'summary' }));
  expect(f.frames.filter(frame => frame.message?.method === 'thread/resume')).toHaveLength(1);
  expect((await f.call(id, { id: 2, method: 'model/list' })).status).toBe(200);
  expect(f.connections).toHaveLength(1);
  f.respond(frame => {
    const m = frame.message; if (m?.id != null) f.send(frame, { id: m.id, result: { data: [{ ...turn, items: [...turn.items, { type: 'commandExecution', aggregatedOutput: 'details' }] }] } });
  });
  const detail = await f.call(id, { id: 3, method: 'thread/turns/list', params: { threadId, limit: 1, itemsView: 'full' } });
  expect(detail.status).toBe(200);
  expect(f.frames.at(-1)?.message?.params?.itemsView).toBe('full');
});
it('同次会话授权只做一次完整绑定校验，读取与通知仍分别核验', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id);
  const proof = vi.spyOn((f.runtime as any).bundle.provider, 'verifyBinding');
  expect((await f.call(id, { id: 2, method: 'account/read', params: { refreshToken: false } })).status).toBe(200);
  expect(proof).toHaveBeenCalledTimes(5);
  proof.mockClear();
  const route = f.frames.find(frame => frame.message?.method === 'initialize');
  const session = (f.sessions as any).sessions.get(id);
  for (let index = 0; index < 10; index++) f.send(route, { method: 'thread/name/updated', params: { threadId: 'notification', threadName: String(index) } });
  await until(() => session.history.filter((item: any) => item.message?.method === 'thread/name/updated').length === 10);
  await session.notificationQueue;
  expect(proof).toHaveBeenCalledTimes(10);
});
it('合并绑定校验仍拒绝另一Runtime和拼接私有目标或账号的句柄', async () => {
  const f = await sessionFixture(); const foreign = await fixture();
  const descriptor = f.remote.target.descriptor;
  const reference = { mode: 'remote' as const, gatewayId: descriptor.gatewayId, account: descriptor.account, target: descriptor.target };
  for (const target of [
    new ResolvedRemoteTarget(descriptor, foreign.runtime, reference),
    new ResolvedRemoteTarget(descriptor, f.runtime, { ...reference, target: { ...reference.target, installationId: 'other' } }),
    new ResolvedRemoteTarget(descriptor, f.runtime, { ...reference, account: { ...reference.account, accountUserId: 'other' } }),
  ]) await expect(f.remote.resolver.authorizeOperationExecution(f.remote.context, undefined, target)).rejects.toMatchObject({ code: 'identity-changed' });
});
it.each((['summaries', 'projectless', 'projectless-cursor', 'loaded-page'] as const).flatMap(path => (['deadline', 'signal'] as const).map(kind => ({ path, kind }))))('QUALITY sidebar $path内部等待保留原$kind', async ({ path, kind }) => {
  const f = await sessionFixture(); await f.sessions.hostedReady(); const session = [...(f.sessions as any).sessions.values()][0] as any;
  const healthyId = randomUUID(); await f.init(healthyId); let hold = false; let route: any;
  f.respond(frame => {
    const m = frame.message; if (m?.id == null || !m.method) return;
    if (m.method === 'thread/loaded/list') {
      if (hold && m.params?.cursor === 'page-two') { route = frame; return; }
      f.send(frame, { id: m.id, result: { data: [], nextCursor: 'page-two' } }); return;
    }
    if (m.method === 'thread/read') {
      if (hold) { route = frame; return; }
      f.send(frame, { id: m.id, result: { thread: { id: m.params.threadId, recencyAt: Number(m.params.threadId), status: { type: 'idle' } } } }); return;
    }
    f.send(frame, { id: m.id, result: {} });
  });
  const params: any = { threadIds: path === 'projectless-cursor' ? ['0', '1', '2', '3', '4', '5'] : ['slow'], includeRunning: path === 'loaded-page' };
  const method = path.startsWith('projectless') ? 'mobile/sidebar/projectless' : 'mobile/sidebar/summaries';
  if (path === 'projectless-cursor') {
    params.cursor = ((await f.sessions.sidebarRpc({ id: 'prime', method, params })).result as any).nextCursor;
    (f.sessions as any).sidebar.observe({ method: 'thread/name/updated', params: { threadId: '0' } });
  }
  hold = true; const abort = new AbortController(); const deadline = performance.now() + (kind === 'deadline' ? 200 : 2000);
  const exchange = session.exchange.bind(session); const childCalls: any[] = [];
  vi.spyOn(session, 'exchange').mockImplementation(((m: any, socket: any, call: any) => { if (['thread/read', 'thread/loaded/list'].includes(m.method)) childCalls.push(call); return exchange(m, socket, call); }) as any);
  const send = session.socket.send.bind(session.socket); const physical: number[] = [];
  vi.spyOn(session.socket, 'send').mockImplementation(((m: any, value: number) => { if (['thread/read', 'thread/loaded/list'].includes(m.method)) physical.push(value); return send(m, value); }) as any);
  let settled = false; const pending = f.sessions.sidebarRpc({ id: path, method, params }, { deadline, signal: abort.signal }).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  await until(() => route != null); if (kind === 'signal') abort.abort(); await new Promise(resolve => setTimeout(resolve, kind === 'deadline' ? 260 : 60));
  const beforeResponse = settled; const waiting = session.waiting.size;
  f.send(route, { id: route.message.id, result: route.message.method === 'thread/read' ? { thread: { id: route.message.params.threadId, name: 'LATE_SIDEBAR_SECRET' } } : { data: ['LATE_SIDEBAR_SECRET'], nextCursor: null } });
  expect(await pending).toHaveProperty('error'); expect(beforeResponse).toBe(true); expect(waiting).toBe(0);
  expect(childCalls.every(call => call.deadline === deadline && call.signal === abort.signal)).toBe(true); expect(physical.every(value => value === deadline)).toBe(true);
  expect((await f.call(healthyId, { id: 'other-stream', method: 'model/list' })).status).toBe(200); expect(f.connections).toHaveLength(1);
  expect(JSON.stringify([...(f.sessions as any).sidebar.entries.values()])).not.toContain('LATE_SIDEBAR_SECRET');
});
it.each(['deadline', 'signal'] as const)('QUALITY sidebar同id并发%s只结束本caller，另一预算不借用或串号', async kind => {
  const f = await sessionFixture(); await f.sessions.hostedReady(); const routes: any[] = [];
  f.respond(frame => { if (frame.message?.method === 'thread/read') routes.push(frame); else if (frame.message?.id != null && frame.message.method) f.send(frame, { id: frame.message.id, result: {} }); });
  const abort = new AbortController(); const oneDeadline = performance.now() + (kind === 'deadline' ? 180 : 2000); const secondDeadline = performance.now() + 2000;
  const message = { id: 'one', method: 'mobile/sidebar/summaries', params: { threadIds: ['same'], includeRunning: false } };
  let oneDone = false; const one = f.sessions.sidebarRpc(message, { deadline: oneDeadline, signal: abort.signal }).then(value => ({ value }), error => ({ error })).finally(() => { oneDone = true; });
  await until(() => routes.length === 1); let twoDone = false;
  const two = f.sessions.sidebarRpc({ ...message, id: 'two' }, { deadline: secondDeadline }).then(value => ({ value }), error => ({ error })).finally(() => { twoDone = true; });
  await new Promise(resolve => setTimeout(resolve, 40)); if (kind === 'signal') abort.abort(); await new Promise(resolve => setTimeout(resolve, kind === 'deadline' ? 220 : 60));
  const ownSettled = oneDone; const otherStillWaiting = !twoDone; const count = routes.length;
  for (const route of routes) f.send(route, { id: route.message.id, result: { thread: { id: 'same', name: route === routes[0] ? 'FIRST_LATE' : 'SECOND_OK', status: { type: 'idle' } } } });
  expect(await one).toHaveProperty('error'); const second = await two;
  expect(ownSettled).toBe(true); expect(otherStillWaiting).toBe(true); expect(count).toBe(2);
  expect(second).toMatchObject({ value: { id: 'two', result: { data: [expect.objectContaining({ name: 'SECOND_OK' })] } } });
  expect(((await f.sessions.sidebarRpc({ ...message, id: 'cached' })).result as any).data[0].name).toBe('SECOND_OK'); expect(f.connections[0]!.readyState).toBe(1);
});
it.each(['deadline', 'signal'] as const)('QUALITY sidebar排队%s及时移除且零迟到发送，健康active调用继续', async kind => {
  const f = await sessionFixture(); await f.sessions.hostedReady(); const routes: any[] = [];
  f.respond(frame => { if (frame.message?.method === 'thread/read') routes.push(frame); else if (frame.message?.id != null && frame.message.method) f.send(frame, { id: frame.message.id, result: {} }); });
  const active = f.sessions.sidebarRpc({ id: 'active', method: 'mobile/sidebar/summaries', params: { threadIds: ['a', 'b'], includeRunning: false } }, { deadline: performance.now() + 2000 });
  await until(() => routes.length === 2); const abort = new AbortController(); let settled = false;
  const queued = f.sessions.sidebarRpc({ id: 'queued', method: 'mobile/sidebar/summaries', params: { threadIds: ['never'], includeRunning: false } }, { deadline: performance.now() + (kind === 'deadline' ? 150 : 2000), signal: abort.signal }).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 40)); if (kind === 'signal') abort.abort(); await new Promise(resolve => setTimeout(resolve, kind === 'deadline' ? 190 : 60));
  const beforeRelease = settled; const remainingQueue = (f.sessions as any).sidebar.queue.length;
  for (const route of routes) f.send(route, { id: route.message.id, result: { thread: { id: route.message.params.threadId, status: { type: 'idle' } } } });
  expect(((await active).result as any).data).toHaveLength(2); expect(await queued).toHaveProperty('error');
  expect(beforeRelease).toBe(true); expect(remainingQueue).toBe(0); expect(f.frames.some(frame => frame.message?.params?.threadId === 'never')).toBe(false);
});
it('真实Runtime原始stream仅初始化一次并保留字符串数字RPC、通知及审批回复', async () => {
  const f = await sessionFixture(); const id = randomUUID();
  expect((await f.init(id)).status).toBe(200);
  expect((await f.init(id)).status).toBe(200);
  await f.call(id, { method: 'initialized' });
  for (const rpcId of [7, '7']) expect((await f.call(id, { id: rpcId, method: 'model/list' })).body.id).toBe(rpcId);
  const route = f.frames.find(frame => frame.message?.method === 'initialize');
  f.send(route, { method: 'thread/started', params: { thread: { id: 'remote-thread' } } });
  f.send(route, { id: 9, method: 'item/commandExecution/requestApproval', params: { threadId: 'remote-thread' } });
  f.send(route, { id: '9', method: 'item/commandExecution/requestApproval', params: { threadId: 'remote-thread' } });
  await vi.waitFor(async () => expect((await f.events(id)).requests).toHaveLength(2));
  await vi.waitFor(async () => expect(JSON.stringify((await f.events(id)).messages)).toContain('remote-thread'));
  const events = await f.events(id);
  for (const approvalId of [9, '9']) expect((await f.call(id, { id: approvalId, result: { decision: 'accept' } }, randomUUID(), events.epoch)).status).toBe(200);
  expect(f.frames.filter(frame => frame.message?.method === 'initialize')).toHaveLength(1);
  expect(f.frames.filter(frame => frame.message?.id === 9 || frame.message?.id === '9').map(frame => frame.message.id)).toEqual([9, '9']);
  expect(f.connections).toHaveLength(1);
});
it('同物理Relay多个手机session隔离，单session关闭等待本流且保持其他session', async () => {
  const f = await sessionFixture(); const one = randomUUID(); const two = randomUUID();
  expect((await f.init(one)).status).toBe(200); expect((await f.init(two)).status).toBe(200);
  const routes = f.frames.filter(frame => frame.message?.method === 'initialize'); expect(new Set(routes.map(frame => frame.stream_id)).size).toBe(2);
  f.send(routes[0], { id: 'only-one', method: 'item/commandExecution/requestApproval' });
  await vi.waitFor(async () => expect((await f.events(one)).requests).toHaveLength(1)); expect((await f.events(two)).requests).toHaveLength(0);
  await (f.sessions as any).sessions.get(one).close();
  await until(() => f.frames.some(frame => frame.type === 'client_closed' && frame.stream_id === routes[0].stream_id));
  expect((await f.call(two, { id: 'live', method: 'model/list' })).status).toBe(200);
  expect(f.connections).toHaveLength(1); expect(f.connections[0]!.readyState).toBe(1);
});
it('Remote拒绝遗漏可信投影、replay来源或匹配目标的独立存储namespace', async () => {
  const f = await sessionFixture();
  for (const change of [{ projections: undefined }, { sidechatReplay: undefined }, { storageNamespace: 'local' }]) {
    expect(() => new HttpSessions({ upstreamUrl: 'ws://127.0.0.1:1', codexHome: f.root, remote: { ...f.remote, ...change } } as any)).toThrow();
  }
});
it('hosted审批别名对数字和带类型前缀的任意字符串保持互不碰撞', async () => {
  const f = await sessionFixture(); const observed: any[] = []; f.sessions.subscribeHosted(message => observed.push(message));
  await f.sessions.hostedReady(); const route = f.frames.find(frame => frame.message?.method === 'initialize');
  for (const id of [1, '1', 'number:1']) f.send(route, { id, method: 'item/commandExecution/requestApproval', params: { threadId: 'hosted' } });
  await until(() => observed.filter(message => message.method === 'item/commandExecution/requestApproval').length === 3);
  const approvals = observed.filter(message => message.method === 'item/commandExecution/requestApproval');
  expect(new Set(approvals.map(message => message.id)).size).toBe(3);
  for (const approval of approvals) await f.sessions.replyHosted(randomUUID(), { id: approval.id, result: { decision: 'accept' } });
  expect(f.frames.filter(frame => frame.message && !frame.message.method).map(frame => frame.message.id)).toEqual([1, '1', 'number:1']);
});
it('全局撤权后已缓存RPC也拒绝交付且没有任何后续业务发送', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id);
  const requestId = randomUUID(); const message = { id: 'cached', method: 'model/list' };
  expect((await f.call(id, message, requestId)).status).toBe(200);
  f.setManaged({ accountId: 'other-account' }); await f.runtime.readTargetBinding().catch(() => {});
  const sent = f.frames.filter(frame => frame.type === 'client_message').length;
  expect((await f.call(id, message, requestId)).status).toBe(503);
  expect((await f.call(id, { id: 'new', method: 'model/list' })).status).toBe(503);
  expect(f.frames.filter(frame => frame.type === 'client_message')).toHaveLength(sent);
});
it('已物理提交后投影保留原期限和无FS父guard，超时仍保留uncertain WAL', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id);
  const { performance } = await import('node:perf_hooks');
  const { assertRemoteOperation } = await import('../../server/remote/operation-guard.js');
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let guarded = false;
  f.remote.projections.images.result = async value => { entered(); await gate; try { assertRemoteOperation(); } catch { guarded = true; } return value; };
  const session = (f.sessions as any).sessions.get(id); const requestId = randomUUID();
  const pending = session.rpc(requestId, { id: 'slow-projection', method: 'thread/resume', params: { threadId: 't', model: 'explicit-write' } }, undefined, { deadline: performance.now() + 500 });
  const outcome = pending.catch((error: any) => error);
  await started; await new Promise(resolve => setTimeout(resolve, 550)); release(); await outcome;
  expect(guarded).toBe(true); expect((await session.operation(requestId)).status).toBe('uncertain');
  expect(f.frames.filter(frame => frame.message?.method === 'thread/resume')).toHaveLength(1);
});
it('Sidechat replay继承原期限，迟到来源不能继续读取或注入', async () => {
  const f = await sessionFixture(); const { performance } = await import('node:perf_hooks');
  const { assertRemoteOperation } = await import('../../server/remote/operation-guard.js');
  let forked = 0; f.respond(frame => { if (frame.message?.id != null && frame.message.method) f.send(frame, { id: frame.message.id, result: frame.message.method === 'thread/fork' ? { thread: { id: `side-${++forked}`, ephemeral: true, turns: [] } } : {} }); });
  const side = (method: string, params: any, call?: any) => f.sessions.sidechatRpc({ id: 'side', params: { method, params } }, randomUUID(), call);
  await side('thread/fork', { threadId: 'main', lastTurnId: 'base', ephemeral: true, excludeTurns: true });
  const route = f.frames.find(frame => frame.message?.method === 'thread/fork');
  f.send(route, { method: 'turn/completed', params: { threadId: 'side-1', turn: { id: 'keep', status: 'completed', items: [{ type: 'userMessage', content: [{ type: 'localImage', path: '/synthetic/same.png' }] }] } } });
  f.send(route, { method: 'turn/completed', params: { threadId: 'side-1', turn: { id: 'edit', status: 'completed', items: [] } } });
  await until(() => { try { return f.sessions.sidechats.read('side-1').thread.turns.length === 2; } catch { return false; } });
  await side('thread/fork', { threadId: 'side-1', beforeTurnId: 'edit', ephemeral: true, excludeTurns: true });
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let guarded = false;
  f.remote.sidechatReplay.resolveReference = async () => { entered(); await gate; try { assertRemoteOperation(); } catch { guarded = true; } throw new Error('controlled source stop'); };
  const pending = side('replay', { threadId: 'side-2', sourceThreadId: 'side-1', beforeTurnId: 'edit' }, { deadline: performance.now() + 400 });
  await started; await new Promise(resolve => setTimeout(resolve, 450)); release(); await pending;
  expect(guarded).toBe(true); expect(f.frames.some(frame => frame.message?.method === 'thread/inject_items')).toBe(false);
});
it('close监听重入或抛错仍等待client_closed真实物理回调', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id);
  const session = (f.sessions as any).sessions.get(id); const stream = session.socket;
  const socket = (f.runtime as any).bundle.controller.relay.socket; const nativeSend = socket.send.bind(socket);
  let release!: () => void; let held = false;
  vi.spyOn(socket, 'send').mockImplementation(((bytes: string, options: any, callback: (error?: Error) => void) => {
    nativeSend(bytes, options, (error?: Error) => { if (JSON.parse(bytes).type === 'client_closed') { held = true; release = () => callback(error); } else callback(error); });
  }) as any);
  let reentrantSettled = false; stream.once('close', () => { void session.close().then(() => { reentrantSettled = true; }); throw new Error('controlled close listener'); });
  let settled = false; const closing = session.close().then(() => { settled = true; }, () => { settled = true; });
  await until(() => held);
  try { await new Promise(resolve => setTimeout(resolve, 20)); expect(settled).toBe(false); expect(reentrantSettled).toBe(false); }
  finally { release(); await closing; }
  expect(settled).toBe(true); await until(() => reentrantSettled);
  expect(f.connections[0]!.readyState).toBe(1);
});
it('断线失效epoch，真实重连换新stream且不重放业务写；只读按需重新初始化', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id); await f.call(id, { method: 'initialized' });
  const oldEpoch = (await f.events(id)).epoch; const requestId = randomUUID(); const message = { id: 'write', method: 'turn/start', params: { threadId: 'main', input: [] } };
  f.respond(frame => { if (frame.message?.method && frame.message.id != null && frame.message.method !== 'turn/start') f.send(frame, { id: frame.message.id, result: {} }); });
  const pending = f.call(id, message, requestId); await until(() => f.frames.some(frame => frame.message?.method === 'turn/start'));
  f.connections[0]!.terminate(); expect((await pending).status).toBe(503);
  await until(() => f.connections.length === 2 && f.runtime.status().state === 'online'); f.attach();
  expect((await f.events(id)).epoch).not.toBe(oldEpoch);
  expect((await f.call(id, message, requestId)).status).toBe(503);
  expect((await f.call(id, { ...message, id: 'new-write' })).status).toBe(503);
  expect((await f.call(id, { id: 'read', method: 'model/list' })).status).toBe(200);
  expect(f.frames.filter(frame => frame.message?.method === 'turn/start')).toHaveLength(1);
  const init = f.frames.filter(frame => frame.message?.method === 'initialize'); expect(init).toHaveLength(2); expect(init[0].stream_id).not.toBe(init[1].stream_id);
});
it('初始化调用期限退役后新调用使用自己的预算，Remote Session心跳不伪造pong', async () => {
  const f = await sessionFixture(); const id = randomUUID();
  const { performance } = await import('node:perf_hooks');
  expect(await f.sessions.dispatchRpc({ sessionId: id, requestId: randomUUID(), attemptId: randomUUID() }, { id: 'init', method: 'initialize' }, { deadline: performance.now() + 500 })).toHaveProperty('outcome', 'response');
  const session = (f.sessions as any).sessions.get(id);
  await new Promise(resolve => setTimeout(resolve, 550)); session.heartbeat(); session.heartbeat();
  expect((await f.call(id, { id: 'new-budget', method: 'model/list' })).status).toBe(200);
  expect(session.open).toBe(true); expect(f.connections).toHaveLength(1);
});
it('取消及HttpSessions关闭等待迟到rawstream实际收尾且共享Relay保持健康', async () => {
  const f = await sessionFixture(); const id = randomUUID();
  const { ResolvedRemoteTarget } = await import('../../server/targets.js'); const { performance } = await import('node:perf_hooks');
  const original = ResolvedRemoteTarget.prototype.createRawStream;
  let stream: any; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(ResolvedRemoteTarget.prototype, 'createRawStream').mockImplementationOnce(async function (this: any, signal) { stream = await original.call(this, signal); await gate; return stream; });
  const abort = new AbortController(); const outcome = f.sessions.dispatchRpc({ sessionId: id, requestId: randomUUID(), attemptId: randomUUID() }, { id: 'init', method: 'initialize' }, { deadline: performance.now() + 2000, signal: abort.signal });
  await until(() => !!stream); abort.abort(); let settled = false; const closing = f.sessions.close().then(() => { settled = true; });
  try { await new Promise(resolve => setTimeout(resolve, 20)); expect(settled).toBe(false); }
  finally { release(); await outcome; await closing; }
  expect(stream.closed).toBe(true); await until(() => f.frames.some(frame => frame.type === 'client_closed' && frame.stream_id === stream.streamId));
  expect(f.connections[0]!.readyState).toBe(1);
});
it('恢复新代后旧target永拒，旧Session不借恢复证明复用或发送', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id);
  await f.runtime.recover(); await until(() => f.connections.length === 2 && f.runtime.status().state === 'online');
  await f.runtime.resume({ environmentId: 'local-env', installationId: 'local-install' }); f.attach();
  const count = f.frames.filter(frame => frame.type === 'client_message').length;
  expect((await f.init(id)).status).toBe(503); expect((await f.call(id, { id: 'old', method: 'model/list' })).status).toBe(503);
  expect(f.frames.filter(frame => frame.type === 'client_message')).toHaveLength(count);
});
it('Remote图片与rollout使用明确注入来源，网关Local诱饵不会进入RPC或通知投影', async () => {
  const f = await sessionFixture();
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { rolloutRemote } = await import('./fixtures/rollout-remote.js'); const { remoteRollouts } = await import('../../server/rollout-source.js');
  const { MessageTimestamps } = await import('../../server/message-timestamps.js'); const { MessageWebCitations } = await import('../../server/web-citations.js'); const { InlineImages } = await import('../../server/inline-images.js');
  const target = await rolloutRemote(); cleanup.push(() => target.close()); const rollouts = remoteRollouts(target.session, target.commands, 'test-gateway'); cleanup.push(() => rollouts.close());
  const threadId = '01a1260e-bb6b-79c3-abdb-cfdf41878cfc'; const path = `sessions/2026/10/10/rollout-2026-10-10T13-44-22-${threadId}.jsonl`;
  for (const [root, stamp, url] of [[f.root, '1999-01-01T00:00:00Z', 'https://local-bait.invalid'], [target.root, '2026-10-10T13:44:22.123Z', 'https://remote-target.invalid']]) {
    await mkdir(join(root, 'sessions/2026/10/10'), { recursive: true });
    await writeFile(join(root, path), [ { type: 'session_meta', payload: { id: threadId } },
      { type: 'response_item', timestamp: stamp, payload: { type: 'message', role: 'assistant', id: 'answer', content: [] } },
      { type: 'response_item', payload: { type: 'custom_tool_call_output', output: `来源 (${url})\n【turn1view0】 [wordlim: 200]` } } ].map(value => JSON.stringify(value)).join('\n') + '\n');
  }
  const timestamps = new MessageTimestamps(f.root, rollouts); const citations = new MessageWebCitations(f.root, rollouts);
  Object.assign(f.remote.projections.timestamps, { result: timestamps.result.bind(timestamps), notification: timestamps.notification.bind(timestamps) });
  Object.assign(f.remote.projections.webCitations, { result: citations.result.bind(citations), notification: citations.notification.bind(citations) });
  const imagePath = join(f.root, 'same.png'); await writeFile(imagePath, 'LOCAL_IMAGE_BAIT');
  const files = { ...localMediaFiles, kind: 'remote' as const, namespace: 'remote-images', async open(path: string) {
    return { details: { path, type: 'file' as const, size: 12, version: 'remote' }, async *read() { yield Buffer.from('REMOTE_IMAGE'); }, async close() {} };
  } };
  const images = new InlineImages(join(f.root, 'remote-cache', f.remote.storageNamespace), undefined, { files, async reference(reference) {
    expect(reference.source).toBe(files); const file = await reference.source.open(reference.path); const parts = []; try { for await (const bytes of file.read()) parts.push(bytes); } finally { await file.close(); }
    return `trusted-remote:${Buffer.concat(parts).toString()}`;
  } });
  Object.assign(f.remote.projections.images, { result: images.result.bind(images), notification: images.notification.bind(images) });
  const id = randomUUID(); await f.init(id);
  const turn = { id: 'turn', items: [{ id: 'answer', type: 'agentMessage', phase: 'commentary', text: '目标回答 citeturn1view0' }, { id: 'image', type: 'imageGeneration', savedPath: imagePath }] };
  f.respond(frame => { if (frame.message?.id != null && frame.message.method) f.send(frame, { id: frame.message.id, result: { data: [turn] } }); });
  const reply = await f.call(id, { id: 'read', method: 'thread/turns/list', params: { threadId, itemsView: 'full' } }); expect(reply.status).toBe(200);
  const body = JSON.stringify(reply.body); expect(body).toContain('https://remote-target.invalid'); expect(body).toContain('trusted-remote:REMOTE_IMAGE'); expect(body).not.toContain('local-bait'); expect(body).not.toContain('LOCAL_IMAGE_BAIT');
  expect(reply.body.result.data[0].items[0].timestamp).toBe(Date.parse('2026-10-10T13:44:22.123Z') / 1000);
  const route = f.frames.find(frame => frame.message?.method === 'initialize'); f.send(route, { method: 'item/completed', params: { threadId, turnId: 'turn', item: turn.items[0] } });
  await vi.waitFor(async () => expect(JSON.stringify((await f.events(id)).messages)).toContain('https://remote-target.invalid'));
}, 15000);
it('Sidechat wrapper、settings、interrupt、approval和附图replay全部memoryOnly且断线清空', async () => {
  const f = await sessionFixture(); const { writeFile, readdir, readFile } = await import('node:fs/promises');
  const imagePath = join(f.root, 'same-side.png'); await writeFile(imagePath, 'LOCAL_SIDEBAR_BAIT');
  const files = { ...localMediaFiles, kind: 'remote' as const, namespace: 'side-remote', async open(path: string) { return { details: { path, type: 'file' as const, size: 17, version: 'remote' }, async *read() { yield Buffer.from('PRIVATE_SIDE_IMAGE'); }, async close() {} }; } };
  f.remote.sidechatReplay.files = files; f.remote.sidechatReplay.resolveReference = async value => ({ source: files, path: value, origin: 'target' as const });
  let forked = 0; f.respond(frame => { if (frame.message?.id != null && frame.message.method) f.send(frame, { id: frame.message.id, result: frame.message.method === 'thread/fork' ? { thread: { id: `private-side-${++forked}`, ephemeral: true, turns: [] } } : { private: 'SIDE_RESPONSE_SECRET' } }); });
  const id = randomUUID(); await f.init(id); const side = (method: string, params: any) => f.call(id, { id: 'side', method: 'mobile/sidechat/rpc', params: { method, params } });
  expect((await side('thread/fork', { threadId: 'main', lastTurnId: 'base', ephemeral: true, excludeTurns: true, developerInstructions: 'SIDE_INPUT_SECRET' })).body.error).toBeUndefined();
  const route = f.frames.find(frame => frame.message?.method === 'thread/fork');
  f.send(route, { method: 'turn/completed', params: { threadId: 'private-side-1', turn: { id: 'keep', status: 'completed', items: [{ id: 'private-user', type: 'userMessage', content: [{ type: 'text', text: 'SIDE_BODY_SECRET' }, { type: 'localImage', path: imagePath }] }] } } });
  f.send(route, { method: 'turn/completed', params: { threadId: 'private-side-1', turn: { id: 'edit', status: 'completed', items: [] } } });
  await until(() => f.sessions.sidechats.read('private-side-1').thread.turns.length === 2);
  expect((await f.call(id, { id: 'settings', method: 'thread/settings/update', params: { threadId: 'private-side-1', model: 'SIDE_SETTINGS_SECRET' } })).status).toBe(200);
  expect((await f.call(id, { id: 'interrupt', method: 'turn/interrupt', params: { threadId: 'private-side-1', turnId: 'keep' } })).status).toBe(200);
  f.send(route, { id: 'approval-secret', method: 'item/commandExecution/requestApproval', params: { threadId: 'private-side-1', prompt: 'SIDE_APPROVAL_SECRET' } });
  await vi.waitFor(async () => expect((await f.events(id)).requests).toHaveLength(1));
  const approval = (await f.events(id)).requests[0]; expect((await f.call(id, { id: approval.id, result: { decision: 'accept', private: 'SIDE_REPLY_SECRET' } })).status).toBe(200);
  expect((await side('thread/fork', { threadId: 'private-side-1', beforeTurnId: 'edit', ephemeral: true, excludeTurns: true })).body.error).toBeUndefined();
  expect((await side('replay', { threadId: 'private-side-2', sourceThreadId: 'private-side-1', beforeTurnId: 'edit' })).body.error).toBeUndefined();
  const injection = JSON.stringify(f.frames.find(frame => frame.message?.method === 'thread/inject_items').message.params);
  expect(injection).toContain(Buffer.from('PRIVATE_SIDE_IMAGE').toString('base64')); expect(injection).not.toContain(Buffer.from('LOCAL_SIDEBAR_BAIT').toString('base64'));
  const disk = (await readdir(f.root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile() && !entry.name.endsWith('.png'));
  let text = ''; for (const entry of disk) text += await readFile(join(entry.parentPath, entry.name), 'utf8');
  expect(text).not.toMatch(/SIDE_(?:INPUT|RESPONSE|BODY|SETTINGS|APPROVAL|REPLY)_SECRET|PRIVATE_SIDE_IMAGE/);
  expect(await readdir(join(f.root, 'codex-mobile-http', 'remote', f.remote.storageNamespace)).catch(() => [])).toEqual([]);
  f.connections[0]!.terminate(); await until(() => f.sessions.sidechats.size === 0);
  expect(() => f.sessions.sidechats.read('private-side-1')).toThrow('失效');
  const ephemeral = [...(f.sessions as any).sessions.values()].find((session: any) => session.memoryOnly) as any; expect(ephemeral.operations.size).toBe(0);
});
it('迟到投影不越过断线epoch交付或复活缓存', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id);
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  f.remote.projections.images.result = async value => { entered(); await gate; return { ...value, private: 'LATE_PROJECTION' }; };
  const pending = f.call(id, { id: 'read', method: 'thread/read', params: { threadId: 'late' } }); await started;
  const session = (f.sessions as any).sessions.get(id); const epoch = session.epoch; await session.close(); release();
  expect((await pending).status).toBe(503); expect(session.epoch).not.toBe(epoch); expect(JSON.stringify([...session.operations.values()])).not.toContain('LATE_PROJECTION');
});

it('最终WAL await期间逻辑session关闭后不交付已投影结果', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id); const session = (f.sessions as any).sessions.get(id);
  const original = session.save.bind(session); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(session, 'save').mockImplementation(async (operation: any) => { await original(operation); if (operation.status === 'completed') { entered(); await gate; } });
  const pending = f.call(id, { id: 'write', method: 'turn/start', params: { threadId: 'main' } }); await started; await session.close(); release();
  expect((await pending).status).toBe(503);
});

it('物理send回调hold期间超时或断线仍保留uncertain且不重放写', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id); const session = (f.sessions as any).sessions.get(id);
  const { performance } = await import('node:perf_hooks'); const socket = (f.runtime as any).bundle.controller.relay.socket; const nativeSend = socket.send.bind(socket);
  let release!: () => void; let held = false; f.respond(() => {});
  vi.spyOn(socket, 'send').mockImplementation(((bytes: string, options: any, callback: (error?: Error) => void) => {
    nativeSend(bytes, options, (error?: Error) => { if (JSON.parse(bytes).message?.method === 'turn/start') { held = true; release = () => callback(error); } else callback(error); });
  }) as any);
  const requestId = randomUUID(); const message = { id: 'held', method: 'turn/start', params: { threadId: 'main' } };
  const pending = session.rpc(requestId, message, undefined, { deadline: performance.now() + 350 }).catch((error: any) => error);
  await until(() => held); try { await pending; expect((await session.operation(requestId)).status).toBe('uncertain'); } finally { release(); }
  f.connections[0]!.terminate(); await until(() => f.connections.length === 2 && f.runtime.status().state === 'online'); f.attach();
  expect((await f.call(id, message, requestId)).status).toBe(503); expect(f.frames.filter(frame => frame.message?.method === 'turn/start')).toHaveLength(1);
});
it('物理send回调hold而业务响应先到后期限耗尽，不能把已发送写当neverSent删除', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id); const session = (f.sessions as any).sessions.get(id);
  const { performance } = await import('node:perf_hooks'); const socket = (f.runtime as any).bundle.controller.relay.socket; const nativeSend = socket.send.bind(socket);
  let release!: () => void; let held = false;
  vi.spyOn(socket, 'send').mockImplementation(((bytes: string, options: any, callback: (error?: Error) => void) => {
    nativeSend(bytes, options, (error?: Error) => { if (JSON.parse(bytes).message?.method === 'thread/resume') { held = true; release = () => callback(error); } else callback(error); });
  }) as any);
  f.remote.projections.images.result = async value => { await new Promise(resolve => setTimeout(resolve, 450)); return value; };
  const requestId = randomUUID(); const pending = session.rpc(requestId, { id: 'held-response', method: 'thread/resume', params: { threadId: 'main', model: 'write' } }, undefined, { deadline: performance.now() + 350 }).catch((error: any) => error);
  await until(() => held); try { await pending; expect((await session.operation(requestId))?.status).toBe('uncertain'); } finally { release(); }
});

it('真实物理零发送背压拒绝保持neverSent并删除WAL，不伪造uncertain', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id); const session = (f.sessions as any).sessions.get(id);
  const relay = (f.runtime as any).bundle.controller.relay; const previousBudget = relay.maxBufferedBytes; relay.maxBufferedBytes = 0;
  const requestId = randomUUID(); const seq = session.socket.lastSentSeqId;
  try {
    const error = await session.rpc(requestId, { id: 'zero-send', method: 'turn/start', params: { threadId: 'main' } }).catch((value: any) => value);
    expect(error.mayHaveBeenSent).toBe(false); expect(session.socket.lastSentSeqId).toBe(seq);
    await expect(session.operation(requestId)).rejects.toMatchObject({ status: 404 });
    expect(f.frames.some(frame => frame.message?.method === 'turn/start')).toBe(false);
  } finally { relay.maxBufferedBytes = previousBudget; }
});

it('Remote拒绝不完整consumer和与target不匹配的原context', async () => {
  const f = await sessionFixture();
  for (const change of [{ projections: { ...f.remote.projections, images: {} } }, { context: { ...f.remote.context, generation: 'wrong-generation' } }, { context: { ...f.remote.context, target: { environmentId: 'other', installationId: 'other' } } }]) {
    expect(() => new HttpSessions({ upstreamUrl: 'ws://127.0.0.1:1', codexHome: f.root, remote: { ...f.remote, ...change } } as any)).toThrow();
  }
});

it('通知迟到投影在receive及hosted广播前检查原期限', async () => {
  const f = await sessionFixture(); await f.sessions.hostedReady(); const observed: any[] = []; f.sessions.subscribeHosted(message => observed.push(message));
  const session = [...(f.sessions as any).sessions.values()][0] as any; const route = f.frames.find(frame => frame.message?.method === 'initialize');
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  f.remote.projections.images.notification = async value => { entered(); await gate; return value; };
  f.send(route, { method: 'thread/started', params: { thread: { id: 'EXPIRED_NOTIFICATION' } } }); await started;
  const { performance } = await import('node:perf_hooks'); const clock = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 61_000);
  try { release(); await session.notificationQueue; expect(JSON.stringify(observed)).not.toContain('EXPIRED_NOTIFICATION'); } finally { clock.mockRestore(); }
});
it('真实身份已变更时服务端审批在实际hosted交付前拒绝', async () => {
  const f = await sessionFixture(); await f.sessions.hostedReady(); const observed: any[] = []; f.sessions.subscribeHosted(message => observed.push(message));
  const session = [...(f.sessions as any).sessions.values()][0] as any; const route = f.frames.find(frame => frame.message?.method === 'initialize');
  f.setManaged({ accountId: 'revoked-account' }); f.send(route, { id: 'STALE_APPROVAL', method: 'item/commandExecution/requestApproval' });
  await new Promise(resolve => setTimeout(resolve, 60)); await session.notificationQueue;
  expect(JSON.stringify(observed)).not.toContain('STALE_APPROVAL'); expect(f.runtime.status().reason).toBe('identity-changed');
});
it('subscribeHosted缓存审批回放先复核真实身份并遵守取消订阅', async () => {
  const f = await sessionFixture(); await f.sessions.hostedReady(); const route = f.frames.find(frame => frame.message?.method === 'initialize');
  f.send(route, { id: 'CACHED_APPROVAL', method: 'item/commandExecution/requestApproval' }); await until(() => (f.sessions as any).hostedRequests.size === 1);
  f.setManaged({ accountId: 'revoked-account' }); const observed: any[] = []; f.sessions.subscribeHosted(message => observed.push(message)); const stop = f.sessions.subscribeHosted(message => observed.push(message)); stop();
  await new Promise(resolve => setTimeout(resolve, 60)); expect(JSON.stringify(observed)).not.toContain('CACHED_APPROVAL');
});
it('嵌套hosted审批真实提交事实传回原手机调用，外层超时不删除WAL', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id); await f.sessions.hostedReady();
  const route = f.frames.filter(frame => frame.message?.method === 'initialize').at(-1); f.send(route, { id: 'hosted-write', method: 'item/commandExecution/requestApproval' });
  const session = (f.sessions as any).sessions.get(id); await until(() => session.pending.size === 1); const approval = [...session.pending.values()][0] as any;
  const original = session.save.bind(session); vi.spyOn(session, 'save').mockImplementation(async (operation: any) => { await original(operation); if (operation.status === 'completed') await new Promise(resolve => setTimeout(resolve, 450)); });
  const { performance } = await import('node:perf_hooks'); const requestId = randomUUID();
  await session.rpc(requestId, { id: approval.id, result: { decision: 'accept' } }, session.epoch, { deadline: performance.now() + 350 }).catch(() => {});
  expect((await session.operation(requestId)).status).toBe('uncertain'); expect(f.frames.filter(frame => frame.message?.id === 'hosted-write')).toHaveLength(1);
});

it('同Relay两个逻辑stream同时入站通知不因只读授权busy丢弃或关闭健康流', async () => {
  const f = await sessionFixture(); const one = randomUUID(); const two = randomUUID(); await f.init(one); await f.init(two);
  const routes = f.frames.filter(frame => frame.message?.method === 'initialize');
  f.send(routes[0], { method: 'thread/started', params: { thread: { id: 'concurrent-one' } } });
  f.send(routes[1], { method: 'thread/started', params: { thread: { id: 'concurrent-two' } } });
  await new Promise(resolve => setTimeout(resolve, 80)); const sessions = [(f.sessions as any).sessions.get(one), (f.sessions as any).sessions.get(two)]; await Promise.all(sessions.map(session => session.notificationQueue));
  expect(sessions.map(session => session.open)).toEqual([true, true]); expect(JSON.stringify(sessions.map(session => session.history))).toContain('concurrent-two');
  expect(f.connections).toHaveLength(1);
});

it('同Runtime多Resolver与多HttpSessions并发核验、创建和业务各自独立完成', async () => {
  const f = await sessionFixture(); const one = randomUUID(); await f.init(one);
  const resolver = new TargetResolver({ identity: { version: 1, gatewayId: 'test-gateway', localHostId: 'test-local' }, remoteRuntime: f.runtime });
  const reference = { mode: 'remote' as const, gatewayId: 'test-gateway', account: f.remote.target.descriptor.account, target: f.remote.target.descriptor.target };
  const target = await resolver.resolve(reference); const context = await resolver.operationContext(reference);
  const other = new HttpSessions({ upstreamUrl: 'ws://127.0.0.1:1', codexHome: f.root, remote: { ...f.remote, target, resolver, context } }); cleanup.push(() => other.close());
  const result = await Promise.all([f.call(one, { id: 'first', method: 'model/list' }), other.hostedRpc({ id: 'second', method: 'model/list' })]);
  expect(result[0].status).toBe(200); expect(result[1].id).toBe('second');
  const routes = f.frames.filter(frame => frame.message?.method === 'initialize'); const observed: any[] = []; other.subscribeHosted(message => observed.push(message));
  f.send(routes[0], { method: 'thread/started', params: { thread: { id: 'multi-one' } } }); f.send(routes[1], { method: 'thread/started', params: { thread: { id: 'multi-two' } } });
  await until(() => JSON.stringify(observed).includes('multi-two')); expect((await f.events(one)).messages).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'thread/started' })]));
  expect(f.connections).toHaveLength(1); expect((f.sessions as any).sessions.get(one).open).toBe(true);
});
it('下一真实proof挂起时前项逻辑stream已在同一read lane同步创建', async () => {
  const f = await sessionFixture(); const provider = (f.runtime as any).bundle.provider; const original = provider.verifyBinding.bind(provider);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let queued!: Promise<unknown>; let count = 0;
  vi.spyOn(provider, 'verifyBinding').mockImplementation(async () => {
    count++; if (count === 1) queued = f.runtime.readTargetBinding();
    if (count === 2) { entered(); await gate; }
    return original();
  });
  const created = f.remote.target.createRawStream().then(stream => ({ stream }), error => ({ error }));
  await started;
  try {
    expect((f.runtime as any).operation.authorizationReadOnly).toBe(true);
    const result = await created;
    expect('error' in result ? { code: result.error.code, readonly: (f.runtime as any).operation.authorizationReadOnly } : { created: true }).toEqual({ created: true });
    if ('stream' in result) await result.stream.close();
  } finally { release(); await queued; }
  expect(count).toBe(2); expect(f.connections).toHaveLength(1);
});
it.each(['sync', 'microtask', 'parentguard'] as const)('read lane注册stream后%s取消仍等待实际close且共享Relay健康', async timing => {
  const f = await sessionFixture(); const abort = new AbortController(); const create = f.runtime.createRawStream.bind(f.runtime); let stream: any;
  const socket = (f.runtime as any).bundle.controller.relay.socket; const send = socket.send.bind(socket); let release: (() => void) | undefined;
  const sendSpy = vi.spyOn(socket, 'send').mockImplementation(((bytes: string, options: any, callback: (error?: Error) => void) => {
    send(bytes, options, (error?: Error) => { if (JSON.parse(bytes).type === 'client_closed') release = () => callback(error); else callback(error); });
  }) as any);
  let expired = false; const { withRemoteOperation } = await import('../../server/remote/operation-guard.js');
  vi.spyOn(f.runtime, 'createRawStream').mockImplementation(value => { stream = create(value); if (timing === 'parentguard') expired = true; else if (timing === 'sync') abort.abort(); else queueMicrotask(() => abort.abort()); return stream; });
  let settled = false; const pending = withRemoteOperation(() => { if (expired) throw new Error('original-parent-expired'); }, () => f.remote.target.createRawStream(abort.signal)).catch(error => error).finally(() => { settled = true; });
  try {
    await until(() => stream != null); await new Promise(resolve => setTimeout(resolve, 20));
    expect(stream.closed).toBe(true); expect(release).toBeTypeOf('function'); expect(settled).toBe(false);
  } finally { release?.(); sendSpy.mockRestore(); }
  expect((await pending).code).toBe('unavailable'); expect(f.connections[0]!.readyState).toBe(1);
});
it.each(['cancelled', 'revoke', 'close', 'deadline'] as const)('排队逻辑创建遇%s零注册且不延长原guard', async action => {
  const f = await sessionFixture(); const provider = (f.runtime as any).bundle.provider; const verify = provider.verifyBinding.bind(provider);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  vi.spyOn(provider, 'verifyBinding').mockImplementation(async () => { entered(); await gate; return verify(); });
  const first = f.runtime.readTargetBinding().catch(error => error); await started;
  const create = vi.spyOn(f.runtime, 'createRawStream'); const abort = new AbortController(); let expired = false;
  const { withRemoteOperation } = await import('../../server/remote/operation-guard.js');
  const pending = withRemoteOperation(() => { if (expired) throw new Error('original-parent-expired'); }, () => f.remote.target.createRawStream(abort.signal)).catch(error => error);
  if (action === 'cancelled') { abort.abort(); expect((await pending).code).toBe('unavailable'); }
  if (action === 'revoke') f.setManaged({ accountId: 'revoked-before-create' });
  if (action === 'deadline') expired = true;
  const closing = action === 'close' ? f.runtime.close() : undefined; release();
  expect(await pending).toBeInstanceOf(Error); await first; await closing; expect(create).not.toHaveBeenCalled();
});
it('真实query运行期间逻辑创建与mutation仍busy，原同步executable仍拒绝', async () => {
  const f = await sessionFixture(); const runtime = f.runtime as any; const load = runtime.load.bind(runtime);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  vi.spyOn(runtime, 'load').mockImplementation(async (...args: unknown[]) => { entered(); await gate; return load(...args); });
  const query = f.runtime.queryStatus(); await started;
  try {
    expect(runtime.operation.authorizationReadOnly).toBe(true);
    expect(() => f.runtime.createRawStream(f.remote.target.descriptor.target)).toThrow();
    await expect(f.runtime.readTargetBinding()).rejects.toMatchObject({ code: 'busy' });
    await expect(f.remote.target.createRawStream()).rejects.toMatchObject({ code: 'busy' });
    await expect(f.runtime.recover()).rejects.toMatchObject({ code: 'busy' });
  } finally { release(); await query; }
});
it('Runtime排队取消及时返回且零核验，原父期限不延长，后项继续真实核验', async () => {
  const f = await sessionFixture(); const provider = (f.runtime as any).bundle.provider; const original = provider.verifyBinding.bind(provider);
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  vi.spyOn(provider, 'verifyBinding').mockImplementation(async () => { calls++; if (calls === 1) { entered(); await gate; } return original(); });
  const head = f.runtime.readTargetBinding(); await started;
  const abort = new AbortController(); const cancelled = f.runtime.readTargetBinding(abort.signal).catch((error: any) => error); abort.abort();
  const { performance } = await import('node:perf_hooks'); const { withRemoteOperation } = await import('../../server/remote/operation-guard.js'); const deadline = performance.now() + 50;
  const expired = withRemoteOperation(() => { if (performance.now() >= deadline) throw new Error('original-parent-expired'); }, () => f.runtime.readTargetBinding()).catch((error: any) => error);
  const after = f.runtime.readTargetBinding().catch((error: any) => error);
  try { expect((await cancelled).code).toBe('cancelled'); await new Promise(resolve => setTimeout(resolve, 80)); } finally { release(); }
  await head; expect((await expired).message).toBe('original-parent-expired'); expect((await after).generation).toBe(f.remote.target.descriptor.generation); expect(calls).toBe(2);
});

it('Runtime默认预算从read入队计时，排队等待不能重新取得完整预算', async () => {
  const f = await fixture({ operationTimeoutMs: 500 }); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const provider = (f.runtime as any).bundle.provider; const original = provider.verifyBinding.bind(provider);
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let enteredSecond!: () => void; const secondStarted = new Promise<void>(resolve => { enteredSecond = resolve; }); let releaseSecond!: () => void; const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; }); let count = 0;
  vi.spyOn(provider, 'verifyBinding').mockImplementation(async () => { count++; if (count === 1) { entered(); await gate; } else if (count === 2) { enteredSecond(); await secondGate; } return original(); });
  const first = f.runtime.readTargetBinding(); await started; const { performance } = await import('node:perf_hooks'); const began = performance.now(); const pending = f.runtime.readTargetBinding().catch((error: any) => error);
  await new Promise(resolve => setTimeout(resolve, 300)); release(); await first; await secondStarted;
  try { expect((await pending).code).toBe('timeout'); expect(performance.now() - began).toBeLessThan(680); } finally { releaseSecond(); }
});
it('Runtime排队核验遇真实撤权或close后不取得新授权', async () => {
  for (const action of ['revoke', 'close']) {
    const f = await sessionFixture(); const provider = (f.runtime as any).bundle.provider; const original = provider.verifyBinding.bind(provider);
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let count = 0;
    vi.spyOn(provider, 'verifyBinding').mockImplementation(async () => { count++; if (count === 1) { entered(); await gate; } return original(); });
    const first = f.runtime.readTargetBinding().catch((error: any) => error); await started; const queued = f.runtime.readTargetBinding().catch((error: any) => error);
    if (action === 'revoke') { f.setManaged({ accountId: 'revoked-during-queue' }); release(); }
    else { const closing = f.runtime.close(); release(); await closing; }
    expect(await queued).toBeInstanceOf(Error); await first; expect(count).toBe(1);
  }
});

it('缓存RPC本次storedOperation await期间关闭逻辑流后不交付旧缓存', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id); const session = (f.sessions as any).sessions.get(id);
  const requestId = randomUUID(); const message = { id: 'cached-after-close', method: 'model/list' }; expect((await f.call(id, message, requestId)).status).toBe(200);
  const original = session.storedOperation.bind(session); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(session, 'storedOperation').mockImplementationOnce(async (...args: any[]) => { entered(); await gate; return original(...args); });
  const pending = f.call(id, message, requestId); await started; await session.close(); release(); expect((await pending).status).toBe(503);
});

it('SPEC直接hostedOperation在真实撤权后拒绝已完成缓存', async () => {
  const f = await sessionFixture(); const requestId = randomUUID();
  await f.sessions.hostedRpc({ id: 'receipt', method: 'model/list' }, requestId);
  f.setManaged({ accountId: 'revoked-receipt' });
  await expect(f.runtime.readTargetBinding()).rejects.toMatchObject({ code: 'identity-changed' });
  await expect(f.sessions.hostedOperation(requestId)).rejects.toBeDefined();
});
it.each(['closed', 'deadline', 'cancelled'] as const)('SPEC直接hostedOperation本次读取await后仍检查%s', async failure => {
  const f = await sessionFixture(); const requestId = randomUUID();
  await f.sessions.hostedRpc({ id: 'receipt', method: 'turn/start', params: { threadId: 't' } }, requestId);
  const session = [...(f.sessions as any).sessions.values()][0] as any;
  const original = session.storedOperation.bind(session);
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(session, 'storedOperation').mockImplementationOnce(async (...args: unknown[]) => { entered(); await gate; return original(...args); });
  // 丢掉进程内副本，实际走同一WAL读取路径。
  session.operations.delete(requestId);
  const abort = new AbortController();
  const result = f.sessions.hostedOperation(requestId, { deadline: performance.now() + 350, signal: abort.signal }).then(value => ({ value }), error => ({ error }));
  await started;
  try {
    if (failure === 'closed') await session.close();
    else if (failure === 'cancelled') abort.abort();
    else await new Promise(resolve => setTimeout(resolve, 450));
  } finally { release(); }
  expect(await result).toHaveProperty('error');
  expect(f.frames.filter(frame => frame.message?.method === 'turn/start')).toHaveLength(1);
});
it('SPEC历史完成hosted收据在新逻辑epoch仍可授权读取且不重放业务', async () => {
  const f = await sessionFixture(); const requestId = randomUUID();
  await f.sessions.hostedRpc({ id: 'receipt', method: 'model/list' }, requestId);
  const session = [...(f.sessions as any).sessions.values()][0] as any; const epoch = session.epoch;
  await session.socket.close(); await f.sessions.hostedReady();
  expect(session.epoch).not.toBe(epoch);
  expect(await f.sessions.hostedOperation(requestId)).toMatchObject({ status: 'completed', message: { id: 'receipt' } });
  expect(f.frames.filter(frame => frame.message?.method === 'model/list')).toHaveLength(1);
});
it('SPEC真实RPC响应撤权后不进入hosted、Bark或history的任何observer输入', async () => {
  const f = await sessionFixture(); const hosted: any[] = []; const bark: any[] = []; const history: any[] = [];
  f.sessions.subscribeHosted(message => hosted.push(message));
  (f.sessions as any).options.notifications = { observeRpc: (...args: any[]) => bark.push(args) };
  f.remote.projections.changeHistory.observe = message => history.push(message);
  await f.sessions.hostedReady(); hosted.length = 0; bark.length = 0; history.length = 0;
  f.respond(frame => { if (frame.message?.method === 'turn/start') { f.setManaged({ accountId: 'revoked-before-response' }); f.send(frame, { id: frame.message.id, result: { turn: { id: 'SPEC_RESPONSE_SECRET' } } }); } });
  const requestId = randomUUID();
  await expect(f.sessions.hostedRpc({ id: 'start', method: 'turn/start', params: { threadId: 't' } }, requestId)).rejects.toBeDefined();
  for (const observer of [hosted, bark, history]) expect(JSON.stringify(observer)).not.toContain('SPEC_RESPONSE_SECRET');
  const session = [...(f.sessions as any).sessions.values()][0] as any;
  expect(session.operations.get(requestId)?.status).toBe('uncertain');
});
it('SPEC最终WAL await完成前不输出RPC observer，await后真实撤权也零输入', async () => {
  const f = await sessionFixture(); const hosted: any[] = []; const bark: any[] = []; const history: any[] = [];
  f.sessions.subscribeHosted(message => hosted.push(message));
  (f.sessions as any).options.notifications = { observeRpc: (...args: any[]) => bark.push(args) };
  f.remote.projections.changeHistory.observe = message => history.push(message);
  await f.sessions.hostedReady(); hosted.length = 0; bark.length = 0; history.length = 0;
  const session = [...(f.sessions as any).sessions.values()][0] as any; const requestId = randomUUID();
  const original = session.save.bind(session);
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(session, 'save').mockImplementation(async (operation: any) => { await original(operation); if (operation.requestId === requestId && operation.status === 'completed') { entered(); await gate; } });
  f.respond(frame => { if (frame.message?.method === 'turn/start') f.send(frame, { id: frame.message.id, result: { turn: { id: 'SPEC_WAL_SECRET' } } }); });
  const result = f.sessions.hostedRpc({ id: 'start', method: 'turn/start', params: { threadId: 't' } }, requestId).then(value => ({ value }), error => ({ error }));
  await started;
  try { for (const observer of [hosted, bark, history]) expect(JSON.stringify(observer)).not.toContain('SPEC_WAL_SECRET'); }
  finally { f.setManaged({ accountId: 'revoked-during-final-wal' }); release(); await result; }
  expect(await result).toHaveProperty('error');
  for (const observer of [hosted, bark, history]) expect(JSON.stringify(observer)).not.toContain('SPEC_WAL_SECRET');
  expect(session.operations.get(requestId)?.status).toBe('uncertain');
});
async function voiceClient(f: Awaited<ReturnType<typeof sessionFixture>>, id: string) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise<void>(resolve => wss.once('listening', resolve));
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of wss.clients) socket.terminate(); wss.close(() => resolve()); }));
  wss.on('connection', socket => f.sessions.realtime(id, socket));
  const client = new WebSocket(`ws://127.0.0.1:${(wss.address() as any).port}`); client.on('error', () => {}); cleanup.push(() => client.terminate());
  await new Promise<void>(resolve => client.once('open', resolve)); const received: any[] = [];
  client.on('message', raw => received.push(JSON.parse(raw.toString())));
  return { client, received };
}
it('SPEC真实voice客户端正常响应兼容，响应前真实撤权则关闭或报错且不交付正文', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id); const { client, received } = await voiceClient(f, id);
  client.send(JSON.stringify({ id: 'healthy', method: 'thread/realtime/start', params: { threadId: 't' } }));
  await until(() => received.length === 1); expect(received[0]).toEqual({ id: 'healthy', result: { method: 'thread/realtime/start' } });
  f.respond(frame => { if (frame.message?.method === 'thread/realtime/start') { f.setManaged({ accountId: 'revoked-voice' }); f.send(frame, { id: frame.message.id, result: { private: 'SPEC_VOICE_SECRET' } }); } });
  client.send(JSON.stringify({ id: 'revoked', method: 'thread/realtime/start', params: { threadId: 't' } }));
  await until(() => received.length > 1 || client.readyState !== WebSocket.OPEN);
  expect(JSON.stringify(received)).not.toContain('SPEC_VOICE_SECRET');
  await expect(f.runtime.readTargetBinding()).rejects.toMatchObject({ code: 'identity-changed' });
});
it('SPEC真实voice响应仍受本次原60秒预算约束，受控推进61秒不会交付正文', async () => {
  const f = await sessionFixture(); const id = randomUUID(); await f.init(id); const { client, received } = await voiceClient(f, id);
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  f.respond(frame => { if (frame.message?.method === 'thread/realtime/start') { clock = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 61_000); f.send(frame, { id: frame.message.id, result: { private: 'SPEC_EXPIRED_VOICE' } }); } });
  try {
    client.send(JSON.stringify({ id: 'expired', method: 'thread/realtime/start', params: { threadId: 't' } }));
    await until(() => received.length > 0 || client.readyState !== WebSocket.OPEN);
    expect(JSON.stringify(received)).not.toContain('SPEC_EXPIRED_VOICE');
  } finally { clock?.mockRestore(); }
});

it('可信派发Remote物理零发送证明绑定原namespace/UUID/attempt且不能跨HttpSessions', async () => {
  const f = await sessionFixture(); const sessionId = randomUUID(); await f.init(sessionId); const session = (f.sessions as any).sessions.get(sessionId);
  const attempt = { sessionId, requestId: randomUUID(), attemptId: randomUUID() }; const relay = (f.runtime as any).bundle.controller.relay; const budget = relay.maxBufferedBytes; const seq = session.socket.lastSentSeqId;
  relay.maxBufferedBytes = 0;
  let result: any;
  try { result = await f.sessions.dispatchRpc(attempt, { id: 'zero', method: 'turn/start', params: { threadId: 't' } }); } finally { relay.maxBufferedBytes = budget; }
  expect(result.outcome).toBe('neverSent'); expect(session.socket.lastSentSeqId).toBe(seq); expect(await f.sessions.provesNeverSent(result, attempt)).toBe(true);
  const other = new HttpSessions({ upstreamUrl: 'ws://127.0.0.1:1', codexHome: f.root, remote: f.remote }); cleanup.push(() => other.close());
  expect(await other.provesNeverSent(result, attempt)).toBe(false);
  expect(f.frames.some(frame => frame.message?.method === 'turn/start')).toBe(false); expect((await f.call(sessionId, { id: 'healthy', method: 'model/list' })).status).toBe(200);
});
it.each(['held', 'response-first', 'callback-failure', 'callback-only'] as const)('可信派发Remote%s物理已发送不能证明neverSent', async kind => {
  const f = await sessionFixture(); const sessionId = randomUUID(); await f.init(sessionId); const socket = (f.runtime as any).bundle.controller.relay.socket; const native = socket.send.bind(socket); let release: (() => void) | undefined;
  if (kind === 'held' || kind === 'callback-only') f.respond(() => {});
  vi.spyOn(socket, 'send').mockImplementation(((bytes: string, options: any, callback: (error?: Error) => void) => {
    native(bytes, options, (error?: Error) => { if (JSON.parse(bytes).message?.method === 'thread/resume') { release = () => callback(kind === 'callback-failure' ? new Error('failed') : error); if (kind === 'callback-failure' || kind === 'callback-only') release(); } else callback(error); });
  }) as any);
  if (kind === 'response-first') f.remote.projections.images.result = async value => { await new Promise(resolve => setTimeout(resolve, 200)); return value; };
  const attempt = { sessionId, requestId: randomUUID(), attemptId: randomUUID() };
  const result = await f.sessions.dispatchRpc(attempt, { id: 'submitted', method: 'thread/resume', params: { threadId: 't', model: 'write' } }, { deadline: performance.now() + 120 }); release?.();
  expect(result.outcome).toBe('unknown'); expect(await f.sessions.provesNeverSent(result, attempt)).toBe(false); expect((await (f.sessions as any).sessions.get(sessionId).operation(attempt.requestId)).status).toBe('uncertain');
});
it('可信派发Remote最终授权拒绝cached正文且已产生零发送证明撤权后不可使用', async () => {
  const f = await sessionFixture(); const sessionId = randomUUID(); await f.init(sessionId); const attempt = { sessionId, requestId: randomUUID(), attemptId: randomUUID() }; const message = { id: 'cached', method: 'turn/start', params: { threadId: 't' } };
  expect((await f.sessions.dispatchRpc(attempt, message)).outcome).toBe('response');
  const relay = (f.runtime as any).bundle.controller.relay; const budget = relay.maxBufferedBytes; relay.maxBufferedBytes = 0;
  const zeroAttempt = { ...attempt, requestId: randomUUID(), attemptId: randomUUID() }; let zero: any;
  try { zero = await f.sessions.dispatchRpc(zeroAttempt, message); } finally { relay.maxBufferedBytes = budget; }
  expect(zero.outcome).toBe('neverSent'); f.setManaged({ accountId: 'revoked' }); await f.runtime.readTargetBinding().catch(() => {});
  const result = await f.sessions.dispatchRpc({ ...attempt, attemptId: randomUUID() }, message); expect(result.outcome).toBe('unknown'); expect(result).not.toHaveProperty('message'); expect(await f.sessions.provesNeverSent(zero, zeroAttempt)).toBe(false);
});
it.each(['before-result', 'after-result'] as const)('可信派发Remote已证明零发送%s真实断线后仍可同代离线验明neverSent', async timing => {
  const f = await sessionFixture(); const sessionId = randomUUID(); await f.init(sessionId); const session = (f.sessions as any).sessions.get(sessionId);
  const attempt = { sessionId, requestId: randomUUID(), attemptId: randomUUID() }; const relay = (f.runtime as any).bundle.controller.relay; const budget = relay.maxBufferedBytes; const seq = session.socket.lastSentSeqId;
  const disconnect = async () => { f.connections[0]!.terminate(); await until(() => f.runtime.status().state === 'offline'); };
  if (timing === 'before-result') { const discard = session.discard.bind(session); vi.spyOn(session, 'discard').mockImplementation(async (operation: any) => { await discard(operation); await disconnect(); }); }
  relay.maxBufferedBytes = 0; let result: any;
  try { result = await f.sessions.dispatchRpc(attempt, { id: 'zero-offline', method: 'turn/start', params: { threadId: 't' } }, { deadline: performance.now() + 4000 }); } finally { relay.maxBufferedBytes = budget; }
  expect(result.outcome).toBe('neverSent'); if (timing === 'after-result') await disconnect();
  expect(await f.sessions.provesNeverSent(result, attempt)).toBe(true); expect(session.socket.lastSentSeqId).toBe(seq);
  expect(f.frames.some(frame => frame.message?.method === 'turn/start')).toBe(false);
});
it('可信派发Remote证明最后授权await期间原attempt变更不得借给另一UUID', async () => {
  const f = await sessionFixture(); const sessionId = randomUUID(); await f.init(sessionId); const attempt = { sessionId, requestId: randomUUID(), attemptId: randomUUID() };
  const relay = (f.runtime as any).bundle.controller.relay; const budget = relay.maxBufferedBytes; relay.maxBufferedBytes = 0; let result: any;
  try { result = await f.sessions.dispatchRpc(attempt, { id: 'identity', method: 'turn/start', params: { threadId: 't' } }); } finally { relay.maxBufferedBytes = budget; }
  expect(result.outcome).toBe('neverSent'); const authorize = f.remote.resolver.authorizeOperation.bind(f.remote.resolver);
  vi.spyOn(f.remote.resolver, 'authorizeOperation').mockImplementation(async (...args) => { const fence = await authorize(...args); attempt.requestId = randomUUID(); return fence; });
  expect(await f.sessions.provesNeverSent(result, attempt)).toBe(false);
});
it.each(['deadline', 'revoked'] as const)('可信派发Remote新Session原%s已失效时零创建或WAL读取', async kind => {
  const f = await sessionFixture(); const attempt = { sessionId: randomUUID(), requestId: randomUUID(), attemptId: randomUUID() };
  if (kind === 'revoked') { f.setManaged({ accountId: 'revoked-before-session' }); await f.runtime.readTargetBinding().catch(() => {}); }
  const result = await f.sessions.dispatchRpc(attempt, { id: 'invalid', method: 'turn/start', params: { threadId: 't' } }, { deadline: performance.now() + (kind === 'deadline' ? -1 : 2000) });
  expect(result.outcome).toBe('unknown'); expect((f.sessions as any).sessions.size).toBe(0); expect(f.frames.filter(frame => frame.type === 'client_message')).toHaveLength(0);
});
