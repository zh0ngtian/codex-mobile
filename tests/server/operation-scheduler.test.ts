// @vitest-environment node
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
const schedulerModule = await import('../../server/operation-scheduler.js').catch(() => ({} as typeof import('../../server/operation-scheduler.js')));
import { HttpSessions, HOSTED_SESSION_ID } from '../../server/http-session.js';
import { TargetResolver } from '../../server/targets.js';
import { OperationQueue, type OperationContext } from '../../server/operation-queue.js';
import { localMediaFiles } from '../../server/media-file-source.js';
import { rpcSignatureInput } from '../../server/rpc-replay.js';
import { withRemoteOperation } from '../../server/remote/operation-guard.js';
import { fixture, until } from './remote-session-fixture.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const local = { environmentId: 'local-env', installationId: 'local-install' };
const other = { environmentId: 'remote-env', installationId: 'remote-install' };
const target = (value: typeof local, online = true) => ({ env_id: value.environmentId, installation_id: value.installationId, kind: 'single', online, busy: false });
const identity = { version: 1 as const, gatewayId: 'scheduler-gateway', localHostId: 'scheduler-local' };
async function setup() {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const resolver = new TargetResolver({ identity, remoteRuntime: f.runtime });
  const reference = { mode: 'remote' as const, gatewayId: identity.gatewayId, account: { accountId: 'workspace', accountUserId: 'account-user', userId: 'user' }, target: local };
  const remoteContext = await resolver.operationContext(reference); const localContext = await resolver.operationContext();
  const remoteMessages: any[] = []; const localMessages: any[] = []; const frames: any[] = [];
  let respond = (_mode: string, message: any) => ({ id: message.id, result: { ok: true } });
  const connected = new Set<any>(); const streamFrames: any[] = []; const sequence = new Map<string, number>();
  const sendRemote = (message: any) => { const frame = streamFrames.at(-1); const next = (sequence.get(frame.stream_id) ?? 0) + 1; sequence.set(frame.stream_id, next); f.connections.at(-1)!.send(JSON.stringify({ type: 'server_message', client_id: f.runtime.status().clientId, env_id: frame.env_id, stream_id: frame.stream_id, seq_id: next, message })); };
  const attach = () => { for (const socket of f.connections) { if (connected.has(socket)) continue; connected.add(socket); const seq = sequence; socket.on('message', bytes => {
    const frame = JSON.parse(bytes.toString()); frames.push(frame);
    if (frame.type !== 'client_message') return; streamFrames.push(frame); remoteMessages.push(frame.message); if (!frame.message?.method) return;
    if (frame.message.id == null) return;
    const response = respond('remote', frame.message); if (response === undefined) return;
    const next = (seq.get(frame.stream_id) ?? 0) + 1; seq.set(frame.stream_id, next);
    socket.send(JSON.stringify({ type: 'server_message', client_id: f.runtime.status().clientId, env_id: frame.env_id, stream_id: frame.stream_id, seq_id: next, message: response }));
  }); } }; attach();
  const http = createServer(); const wss = new WebSocketServer({ server: http });
  wss.on('connection', socket => socket.on('message', bytes => { const message = JSON.parse(bytes.toString()); localMessages.push(message); if (message.id != null && message.method) { const response = respond('local', message); if (response !== undefined) socket.send(JSON.stringify(response)); } }));
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { for (const socket of wss.clients) socket.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); await new Promise<void>(resolve => http.close(() => resolve())); });
  const options = { directory: join(f.root, 'queue'), gatewayId: identity.gatewayId, gatewayCodexHome: f.root, resolver,
    upstreamUrl: `ws://127.0.0.1:${(http.address() as any).port}`, attemptTimeoutMs: 1000, scanIntervalMs: 20,
    remoteConsumers: () => ({ projections: { changeHistory: { observe() {}, async beforeStart() {}, async cancelStart() {}, async get() { return null; }, async flush() {} }, images: { async result(value: any) { return value; }, async notification(value: any) { return value; } }, timestamps: { async result(_id: any, value: any) { return value; }, async notification(value: any) { return value; } }, webCitations: { async result(_id: any, value: any) { return value; }, async notification(value: any) { return value; } } },
      sidechatReplay: { files: { ...localMediaFiles, kind: 'remote' as const }, resolveReference: async () => null } }),
  };
  function create() { expect(schedulerModule).toHaveProperty('OperationScheduler', expect.any(Function)); const value = new schedulerModule.OperationScheduler(options); cleanup.push(() => value.close()); return value; }
  const input = (context: OperationContext = remoteContext, conversationId = 'thread', method = 'turn/start') => ({ id: randomUUID(), context, conversationId, sessionId: HOSTED_SESSION_ID, requestId: randomUUID(),
    message: { id: randomUUID(), method, params: { threadId: conversationId, input: [{ type: 'text', text: 'original' }] } }, settings: { model: 'snapshot-model' }, attachmentRefs: ['original-attachment'] });
  const queue = () => new OperationQueue({ directory: options.directory, gatewayId: identity.gatewayId, authorize: (context, action) => resolver.authorizeOperation(context as OperationContext, action) });
  return { ...f, resolver, reference, remoteContext, localContext, remoteMessages, localMessages, frames, options, create, input, queue, attach, sendRemote, localSockets: () => [...wss.clients], respond(fn: typeof respond) { respond = fn; } };
}
// 缺入口的第一轮为显式能力断言；动态import允许保存真实RED而非模块解析错误。
it('离线接收先耐久完整原输入再ACK，恢复后真实Relay执行并写原WAL', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input();
  f.setTargets([target(local, false), target(other)]); await f.runtime.refreshTargets();
  const receipt = await scheduler.submit(input); expect(receipt.state).toBe('queued');
  const disk = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8')); const saved = disk.records[0];
  expect(saved).toMatchObject({ id: input.id, context: input.context, settings: input.settings, attachmentRefs: input.attachmentRefs, body: { sessionId: input.sessionId, requestId: input.requestId, message: input.message } });
  input.message.params.input[0]!.text = 'mutated'; await scheduler.runOnce(); expect(f.remoteMessages).toEqual([]); expect(f.localMessages).toEqual([]);
  f.setTargets([target(local), target(other)]); await f.runtime.refreshTargets(); await scheduler.runOnce();
  expect((await f.queue().read(input.id)).state).toBe('succeeded');
  expect(f.remoteMessages.filter(m => m.method === 'turn/start')).toHaveLength(1); expect(f.remoteMessages.find(m => m.method === 'turn/start').params.input[0].text).toBe('original');
  expect(f.localMessages).toEqual([]); expect(f.connections).toHaveLength(1);
  const namespace = createHash('sha256').update(JSON.stringify(['transport-v1', 'remote', input.context.authorizationKey])).digest('hex');
  expect(JSON.parse(await readFile(join(f.root, 'codex-mobile-http', 'remote', namespace, input.sessionId, `${input.requestId}.json`), 'utf8'))).toMatchObject({ status: 'completed', requestId: input.requestId });
  expect(await scheduler.result(input.id)).toMatchObject({ outcome: 'response', message: { result: { ok: true } } });
});
it('同Mac两mode同会话严格FIFO，离线Remote阻后Local但其他会话继续', async () => {
  const f = await setup(); const scheduler = f.create(); const first = f.input(); const later = f.input(f.localContext); const independent = f.input(f.localContext, 'other-thread');
  expect(first.context.businessKey).toBe(later.context.businessKey);
  await scheduler.submit(first); await scheduler.submit(later); await scheduler.submit(independent);
  f.setTargets([target(local, false), target(other)]); await f.runtime.refreshTargets(); await scheduler.runOnce();
  expect((await f.queue().read(independent.id)).state).toBe('succeeded'); expect((await f.queue().read(later.id)).state).toBe('queued');
  expect(f.localMessages.filter(m => m.method === 'turn/start').map(m => m.params.threadId)).toEqual(['other-thread']);
  f.setTargets([target(local), target(other)]); await f.runtime.refreshTargets(); await scheduler.runOnce();
  expect((await f.queue().read(first.id)).state).toBe('succeeded'); expect((await f.queue().read(later.id)).state).toBe('succeeded');
});
it('关闭重开无需手机重交原项，原generation显式resume后只沿当前同Runtime handle发送', async () => {
  const f = await setup(); const one = f.create(); const input = f.input(); await one.submit(input); await one.close();
  await f.runtime.recover(); await until(() => f.runtime.status().state === 'online'); f.attach(); const two = f.create();
  await two.runOnce(); expect(f.remoteMessages.filter(m => m.method === 'turn/start')).toHaveLength(0);
  await f.runtime.resume(local); await two.runOnce(); expect((await f.queue().read(input.id)).state).toBe('succeeded');
  expect(f.remoteMessages.filter(m => m.method === 'turn/start')).toHaveLength(1); expect(f.localMessages).toHaveLength(0);
});
it('成功终态只留最小原WAL定位，重启仅凭原UUID授权查询且不重新发送', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(); await scheduler.submit(input); await scheduler.runOnce(); await scheduler.close();
  const stored = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8')).records[0];
  expect(stored).toMatchObject({ state: 'succeeded', rpcReceipt: { sessionId: input.sessionId, requestId: input.requestId } });
  expect(stored).not.toHaveProperty('body'); expect(stored).not.toHaveProperty('settings'); expect(stored).not.toHaveProperty('attachmentRefs');
  const restarted = f.create(); expect(await restarted.result(input.id)).toMatchObject({ outcome: 'response', message: { result: { ok: true } } });
  expect(f.remoteMessages.filter(m => m.method === 'turn/start')).toHaveLength(1);
});
it('未知写阻后写但可信读不被屏障阻死，settings resume和client readOnly仍为写', async () => {
  const f = await setup(); f.options.attemptTimeoutMs = 1000; const scheduler = f.create();
  f.respond((_mode, message) => message.method === 'turn/start' ? undefined as any : ({ id: message.id, result: { ok: true } }));
  const first = f.input(f.localContext); const later = f.input(f.localContext); const read = f.input(f.localContext, 'thread', 'thread/read');
  const resume = f.input(f.localContext, 'thread', 'thread/resume'); (resume.message.params as any).model = 'override'; (resume.message as any).readOnly = true;
  for (const input of [first, later, read, resume]) await scheduler.submit(input);
  await scheduler.runOnce();
  expect((await f.queue().read(first.id)).state).toBe('uncertain'); expect((await f.queue().read(later.id)).state).toBe('queued'); expect((await f.queue().read(read.id)).state).toBe('succeeded'); expect((await f.queue().read(resume.id)).state).toBe('queued');
  expect(f.localMessages.filter(m => m.method === 'turn/start')).toHaveLength(1); expect(f.localMessages.filter(m => m.method === 'thread/read')).toHaveLength(1);
  await scheduler.runOnce(); expect(f.localMessages.filter(m => m.method === 'turn/start')).toHaveLength(1);
}, 10000);
it('实际RPC错误仍failed且阻后写，调用方取得原error而非伪成功', async () => {
  const f = await setup(); const scheduler = f.create(); f.respond((_mode, message) => ({ id: message.id, ...(message.method === 'turn/start' ? { error: { code: -1, message: 'real-failure' } } : { result: { ok: true } }) } as any));
  const first = f.input(f.localContext); const later = f.input(f.localContext); await scheduler.submit(first); await scheduler.submit(later); await scheduler.runOnce();
  expect((await f.queue().read(first.id)).state).toBe('failed'); expect((await f.queue().read(later.id)).state).toBe('queued');
  expect(await scheduler.result(first.id)).toMatchObject({ outcome: 'response', message: { error: { message: 'real-failure' } } });
});
it('指定导航UUID取消只影响该调用，已ACK写及别人的原导航保留', async () => {
  const f = await setup(); const scheduler = f.create(); const one = f.input(f.localContext, 'thread', 'thread/resume'); one.message.params = { threadId: 'thread' } as any;
  const two = { ...structuredClone(one), id: randomUUID(), requestId: randomUUID() }; const write = f.input(f.localContext);
  const a = await scheduler.submit(one); await scheduler.submit(two); const b = await scheduler.submit(write);
  await scheduler.cancelNavigation(one.id, a.revision, one.context); await expect(scheduler.cancelNavigation(write.id, b.revision, write.context)).rejects.toThrow();
  expect((await f.queue().read(one.id)).state).toBe('cancelled'); expect((await f.queue().read(two.id)).state).toBe('queued'); expect((await f.queue().read(write.id)).state).toBe('queued');
});
it('Sidechat和初始化在ledger前拒绝，没有耐久正文或新Session', async () => {
  const f = await setup(); const scheduler = f.create();
  for (const method of ['mobile/sidechat/rpc', 'initialize', 'initialized']) await expect(scheduler.submit(f.input(f.localContext, 'thread', method))).rejects.toThrow();
  const sidechat = f.input(f.localContext); sidechat.sessionId = 'c0dec000-0000-4000-8000-000000000002'; await expect(scheduler.submit(sidechat)).rejects.toThrow();
  await expect(readFile(join(f.options.directory, 'operations.json'))).rejects.toMatchObject({ code: 'ENOENT' }); expect(f.localMessages).toEqual([]); expect(f.remoteMessages).toEqual([]);
});
it('一个原context授权恢复停顿不持ledger锁，其他会话在其预算耗尽前真实发送', async () => {
  const f = await setup(); f.options.attemptTimeoutMs = 800; const scheduler = f.create(); const blocked = f.input(); const independent = f.input(f.localContext, 'independent'); await scheduler.submit(blocked); await scheduler.submit(independent);
  const authorize = f.resolver.authorizeOperation.bind(f.resolver); let entered = false; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(() => release());
  vi.spyOn(f.resolver, 'authorizeOperation').mockImplementation(async (...args) => {
    if (args[0].mode === 'remote' && args[1] === 'claim') { entered = true; await gate; }
    return authorize(...args);
  });
  const run = scheduler.runOnce(); await until(() => entered);
  try { await until(() => f.localMessages.some(m => m.method === 'turn/start'), 500); } finally { release(); }
  await run; expect((await f.queue().read(independent.id)).state).toBe('succeeded');
});
it('Remote consumer装配缺失明确失败且绝不回退Local canonical', async () => {
  const f = await setup(); f.options.remoteConsumers = (() => undefined) as any; const scheduler = f.create(); const input = f.input(); await scheduler.submit(input); await scheduler.runOnce();
  expect(f.localMessages).toEqual([]); expect(f.remoteMessages).toEqual([]); expect((await f.queue().read(input.id)).state).toBe('queued');
});
it('普通写等待响应时原turn控制先执行，同会话过期控制不发送', async () => {
  const f = await setup(); const scheduler = f.create(); f.respond((_mode, message) => message.method === 'turn/start' ? undefined as any : ({ id: message.id, result: { ok: true } }));
  const write = f.input(f.localContext); await scheduler.submit(write); const run = scheduler.runOnce(); await until(() => f.localMessages.some(m => m.method === 'turn/start'));
  const stop = { ...f.input(f.localContext, 'thread', 'turn/interrupt'), control: { kind: 'stop' as const, turnId: 'turn-original', expiresAt: Date.now() + 5000 } }; stop.message.params = { threadId: 'thread', turnId: 'turn-original' } as any;
  const expired = { ...f.input(f.localContext, 'thread', 'turn/interrupt'), control: { kind: 'stop' as const, turnId: 'old-turn', expiresAt: Date.now() - 1 } };
  expired.message.params = { threadId: 'thread', turnId: 'old-turn' } as any;
  await scheduler.submit(stop); await scheduler.submit(expired); const wake = scheduler.runOnce();
  await until(() => f.localMessages.some(m => m.method === 'turn/interrupt'), 500); await Promise.all([run, wake]);
  expect((await f.queue().read(stop.id)).state).toBe('succeeded'); expect((await f.queue().read(expired.id))).toMatchObject({ state: 'failed', failure: 'control-expired' });
  expect(f.localMessages.filter(m => m.method === 'turn/interrupt')).toHaveLength(1);
});
it('RPC queued edit不能改原Session/request或丢失RPC信封，旧body仍兼容且默认写', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(f.localContext); const receipt = await scheduler.submit(input); const queue = f.queue(); const stored = await queue.read(input.id);
  for (const patch of [{ body: { ...(stored.body as any), requestId: randomUUID() } }, { body: { plain: 'lost' } }]) await expect(queue.edit(input.id, receipt.revision, patch)).rejects.toBeDefined();
  const old = { id: randomUUID(), context: f.localContext, conversationId: 'old', body: { readOnly: true }, settings: {}, attachmentRefs: [] }; await queue.submit(old); await scheduler.runOnce(); expect((await queue.read(old.id)).state).toBe('queued');
});
it('原WAL实际completed而ledger结算失败时保留unknown，离线重启只对账不重发', async () => {
  const f = await setup(); const one = f.create(); const first = f.input(); const later = f.input(f.localContext); await one.submit(first); await one.submit(later);
  const settle = vi.spyOn(OperationQueue.prototype, 'settle').mockRejectedValue(new Error('controlled ledger settlement interruption'));
  await one.runOnce(); expect((await f.queue().read(first.id)).state).toBe('uncertain'); expect(f.remoteMessages.filter(m => m.method === 'turn/start')).toHaveLength(1);
  settle.mockRestore(); await one.close(); f.setTargets([target(local, false), target(other)]); await f.runtime.refreshTargets();
  const two = f.create(); await two.runOnce(); expect((await f.queue().read(first.id)).state).toBe('succeeded'); expect((await f.queue().read(later.id)).state).toBe('succeeded'); expect(f.remoteMessages.filter(m => m.method === 'turn/start')).toHaveLength(1);
});
it('真实Session容量零发送证明绑定原claim返回queued，本轮不忙重试', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(f.localContext); await scheduler.submit(input);
  const ready = (HttpSessions.prototype as any).hostedReady;
  vi.spyOn(HttpSessions.prototype as any, 'hostedReady').mockImplementation(async function (this: any, ...args: any[]) { const result = await ready.apply(this, args); this.session(HOSTED_SESSION_ID).storedOperations = 65_536; return result; });
  const dispatch = vi.spyOn(HttpSessions.prototype, 'dispatchRpc'); const proof = vi.spyOn(HttpSessions.prototype, 'provesNeverSent');
  await scheduler.runOnce(); expect(dispatch).toHaveBeenCalledTimes(1); expect(proof).toHaveBeenCalledTimes(1);
  expect((await f.queue().read(input.id)).state).toBe('queued'); expect(f.localMessages.filter(m => m.method === 'turn/start')).toHaveLength(0);
});
it('markPotentialSend未耐久成功则真实dispatch零调用并释放未发送claim', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(f.localContext); await scheduler.submit(input);
  vi.spyOn(OperationQueue.prototype, 'markPotentialSend').mockRejectedValue(new Error('controlled mark failure')); const dispatch = vi.spyOn(HttpSessions.prototype, 'dispatchRpc');
  await scheduler.runOnce(); expect(dispatch).not.toHaveBeenCalled(); expect((await f.queue().read(input.id)).state).toBe('queued'); expect(f.localMessages).toEqual([]);
});
it('两实例并发CAS只派发一次，同实例scan不重入', async () => {
  const f = await setup(); const one = f.create(); const two = f.create(); const input = f.input(f.localContext); await one.submit(input);
  const pending = one.runOnce(); expect(one.runOnce()).toBe(pending); await Promise.all([pending, two.runOnce()]); expect((await f.queue().read(input.id)).state).toBe('succeeded'); expect(f.localMessages.filter(m => m.method === 'turn/start')).toHaveLength(1);
});
it('ACK后原提交取消或父guard失效不删除写，后续执行使用独立真实预算', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(f.localContext); const abort = new AbortController(); let live = true;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let inherited!: Promise<void>;
  await expect(withRemoteOperation(() => { if (!live) throw new Error('original parent expired'); }, async () => {
    await scheduler.submit(input, { deadline: performance.now() + 5000, signal: abort.signal });
    inherited = gate.then(() => scheduler.runOnce()); // 异步任务实际继承本次原父ALS。
    live = false; abort.abort();
  })).rejects.toThrow('original parent expired');
  release(); await inherited; expect((await f.queue().read(input.id)).state).toBe('succeeded'); expect(f.localMessages.filter(m => m.method === 'turn/start')).toHaveLength(1);
});
it('close在claim后未mark时等待实际收尾，原未发送项可在同进程重建后继续', async () => {
  const f = await setup(); const one = f.create(); const input = f.input(f.localContext); await one.submit(input);
  const actual = f.resolver.authorizeOperationExecution.bind(f.resolver); let entered = false; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(() => release());
  const hold = vi.spyOn(f.resolver, 'authorizeOperationExecution').mockImplementation(async (...args) => { entered = true; await gate; return actual(...args); });
  const run = one.runOnce().catch(() => {}); await until(() => entered); let ended = false; const close = one.close().then(() => { ended = true; }); await new Promise(resolve => setTimeout(resolve, 20)); expect(ended).toBe(false);
  release(); await Promise.all([close, run]); hold.mockRestore(); expect(f.localMessages).toEqual([]); expect((await f.queue().read(input.id)).state).toBe('queued');
  const two = f.create(); await two.runOnce(); expect((await f.queue().read(input.id)).state).toBe('succeeded');
});
it.each(['submit', 'cancel'] as const)('%s末次ledger fence后的微任务撤权不交付ACK或取消收据', async action => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(); if (action === 'cancel') { input.message.method = 'thread/resume'; input.message.params = { threadId: 'thread' } as any; }
  const receipt = action === 'cancel' ? await scheduler.submit(input) : undefined;
  const actual = f.resolver.authorizeOperation.bind(f.resolver); let checks = 0; let queued = false;
  vi.spyOn(f.resolver, 'authorizeOperation').mockImplementation(async (...args) => { const fence = await actual(...args); if (args[1] !== action) return fence; return () => { fence(); if (++checks === 2 && !queued) { queued = true; queueMicrotask(() => { (f.runtime as any).active.state.paused = true; }); } }; });
  await expect(action === 'submit' ? scheduler.submit(input) : scheduler.cancelNavigation(input.id, receipt!.revision, input.context)).rejects.toThrow(); expect(queued).toBe(true);
});
it('任意普通RPC不能伪造control越过写屏障，原turn/request必须匹配', async () => {
  const f = await setup(); const scheduler = f.create();
  const fake = { ...f.input(f.localContext), control: { kind: 'stop' as const, turnId: 'turn', expiresAt: Date.now() + 5000 } }; await expect(scheduler.submit(fake)).rejects.toThrow();
  const stop = { ...f.input(f.localContext, 'thread', 'turn/interrupt'), control: { kind: 'stop' as const, turnId: 'turn', expiresAt: Date.now() + 5000 } }; stop.message.params = { threadId: 'thread', turnId: 'other-turn' } as any; await expect(scheduler.submit(stop)).rejects.toThrow();
  const approval = { ...f.input(f.localContext), message: { id: 'request-other', result: {} }, control: { kind: 'approval' as const, turnId: 'turn', requestId: 'request-original', expiresAt: Date.now() + 5000 } }; await expect(scheduler.submit(approval as any)).rejects.toThrow();
  await expect(readFile(join(f.options.directory, 'operations.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it.each([{ mode: 'local', requestId: 'approval-original' }, { mode: 'remote', requestId: 'approval-original' }, { mode: 'local', requestId: 42 }, { mode: 'remote', requestId: 42 }] as const)('普通$mode Session真实协议初始化→业务→原epoch审批($requestId)，同Session原请求并且协议不入业务ledger', async ({ mode, requestId }) => {
  const f = await setup(); const scheduler = f.create(); const context = mode === 'local' ? f.localContext : f.remoteContext; const sessionId = randomUUID();
  const init = { id: 'init-phone', method: 'initialize', params: { clientInfo: { name: 'scheduler-phone', version: '1' } } };
  expect(scheduler).toHaveProperty('protocol', expect.any(Function));
  const protocol = await scheduler.protocol({ context, sessionId, requestId: randomUUID(), message: init }); expect(protocol).toMatchObject({ outcome: 'response' });
  await scheduler.protocol({ context, sessionId, requestId: randomUUID(), message: { method: 'initialized', params: {} } });
  const input = { ...f.input(context), sessionId }; await scheduler.submit(input); await scheduler.runOnce(); expect((await f.queue().read(input.id)).state).toBe('succeeded');
  const pending = { id: requestId, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'turn-original' } };
  if (mode === 'local') for (const socket of (f as any).localSockets()) socket.send(JSON.stringify(pending));
  else f.sendRemote(pending);
  let events = await scheduler.events(context, sessionId, 0); await vi.waitFor(async () => { events = await scheduler.events(context, sessionId, 0); expect(events.requests).toContainEqual(pending); });
  const reply = { ...f.input(context), sessionId, epoch: events.epoch, message: { id: pending.id, result: { decision: 'accept' } }, control: { kind: 'approval' as const, turnId: 'turn-original', requestId: typeof pending.id === 'number' ? `request:${events.epoch}:${JSON.stringify(pending.id)}` : pending.id, expiresAt: Date.now() + 5000 } };
  if (typeof pending.id === 'number') await expect(scheduler.submit({ ...reply, id: randomUUID(), control: { ...reply.control, requestId: String(pending.id) } })).rejects.toThrow();
  await scheduler.submit(reply); await scheduler.runOnce(); expect((await f.queue().read(reply.id)).state).toBe('succeeded');
  const messages = mode === 'local' ? f.localMessages : f.remoteMessages; expect(messages).toContainEqual(reply.message);
  const disk = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8')); expect(disk.records).toHaveLength(2);
});
it('普通Session业务ACK丢失后close重建幂等，恢复自原协议快照无需手机且不同业务仍409', async () => {
  const f = await setup(); const one = f.create(); expect(one).toHaveProperty('protocol', expect.any(Function)); const sessionId = randomUUID();
  const protocol = { context: f.localContext, sessionId, requestId: randomUUID(), message: { id: 'original-init', method: 'initialize', params: { clientInfo: { name: 'original-phone', version: '1' } } } };
  await one.protocol(protocol); await one.protocol({ ...protocol, requestId: randomUUID(), message: { method: 'initialized', params: {} } } as any);
  const input = { ...f.input(f.localContext), sessionId }; const first = await one.submit(input); await one.close();
  const two = f.create(); expect(await two.submit(input)).toEqual(first); await expect(two.submit({ ...input, settings: { model: 'changed' } })).rejects.toMatchObject({ status: 409 });
  await two.runOnce(); expect((await f.queue().read(input.id)).state).toBe('succeeded'); expect(f.localMessages.filter(m => m.method === 'turn/start')).toHaveLength(1);
  const inits = f.localMessages.filter(m => m.method === 'initialize'); expect(inits).toHaveLength(2); expect(inits[1].params.clientInfo.name).toBe('original-phone');
});
it('原Session/request被不同业务输入复用时旧completed WAL不能误结算或返回他次正文', async () => {
  const f = await setup(); const scheduler = f.create(); const first = f.input(f.localContext); await scheduler.submit(first); await scheduler.runOnce();
  const conflicting = { ...structuredClone(first), id: randomUUID(), message: { ...first.message, params: { ...first.message.params, input: [{ type: 'text', text: 'different-original' }] } } }; await scheduler.submit(conflicting); await scheduler.runOnce();
  expect((await f.queue().read(conflicting.id)).state).toBe('uncertain'); await expect(scheduler.result(conflicting.id)).rejects.toMatchObject({ status: 409 }); expect(f.localMessages.filter(m => m.method === 'turn/start')).toHaveLength(1);
});
it('重新initialize只改变传输恢复快照仍幂等，重交不覆盖原落盘协议', async () => {
  const f = await setup(); const scheduler = f.create(); const sessionId = randomUUID(); const protocol = { context: f.localContext, sessionId, requestId: randomUUID(), message: { id: 'old-init', method: 'initialize', params: { clientInfo: { name: 'old-phone', version: '1' } } } };
  await scheduler.protocol(protocol); const input = { ...f.input(f.localContext), sessionId }; const one = await scheduler.submit(input); const before = await readFile(join(f.options.directory, 'operations.json'));
  await scheduler.protocol({ ...protocol, requestId: randomUUID(), message: { ...protocol.message, id: 'new-init', params: { clientInfo: { name: 'new-phone', version: '2' } } } });
  expect(await scheduler.submit(input)).toEqual(one); expect(await readFile(join(f.options.directory, 'operations.json'))).toEqual(before);
  await expect(scheduler.submit({ ...input, message: { ...input.message, params: { threadId: 'other' } } })).rejects.toMatchObject({ status: 409 });
});
it('坏ledger明确失败不当空，failed原WAL错误对账不反复revision/fsync忙扫', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(f.localContext); f.respond((_mode, message) => ({ id: message.id, ...(message.method === 'turn/start' ? { error: { code: -1 } } : { result: { ok: true } }) } as any));
  await scheduler.submit(input); await scheduler.runOnce(); const failed = await f.queue().read(input.id); await scheduler.runOnce(); expect((await f.queue().read(input.id)).revision).toBe(failed.revision);
  await writeFile(join(f.options.directory, 'operations.json'), '{broken'); await expect(scheduler.runOnce()).rejects.toMatchObject({ code: 'storage' });
});
it('终态原WAL被删除后同request新业务写入，旧UUID结果拒绝新正文', async () => {
  const f = await setup(); const one = f.create(); const first = f.input(f.localContext); await one.submit(first); await one.runOnce(); await one.close();
  const { unlink } = await import('node:fs/promises'); await unlink(join(f.root, 'codex-mobile-http', first.sessionId, `${first.requestId}.json`));
  const two = f.create(); const later = { ...structuredClone(first), id: randomUUID(), message: { ...first.message, params: { threadId: 'thread', input: [{ type: 'text', text: 'replacement' }] } } }; await two.submit(later); await two.runOnce(); expect((await f.queue().read(later.id)).state).toBe('succeeded');
  await expect(two.result(first.id)).rejects.toMatchObject({ status: 409 }); expect(await two.result(later.id)).toMatchObject({ outcome: 'response' });
});
it('queued CAS改文更新实际WAL指纹，原输入幂等并从终态原WAL读取编辑后结果', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(f.localContext); const initial = await scheduler.submit(input); const stored = await f.queue().read(input.id);
  const changed = { ...(stored.body as any), message: { ...input.message, params: { threadId: 'thread', input: [{ type: 'text', text: 'edited' }] } } };
  const edited = await f.queue().edit(input.id, initial.revision, { body: changed }); expect(await scheduler.submit(input)).toEqual(edited);
  await scheduler.runOnce(); expect(f.localMessages.find(m => m.method === 'turn/start').params.input[0].text).toBe('edited'); expect(await scheduler.result(input.id)).toMatchObject({ outcome: 'response' });
  expect((await f.queue().read(input.id)).rpcReceipt).toHaveProperty('signature');
});

it('零发送证明等待真实恢复时不持ledger锁阻塞其他会话耐久接收', async () => {
  const f = await setup(); const scheduler = f.create(); await scheduler.submit(f.input(f.localContext));
  const ready = (HttpSessions.prototype as any).hostedReady;
  vi.spyOn(HttpSessions.prototype as any, 'hostedReady').mockImplementation(async function (this: any, ...args: any[]) { const value = await ready.apply(this, args); this.session(HOSTED_SESSION_ID).storedOperations = 65_536; return value; });
  const original = HttpSessions.prototype.provesNeverSent; let release!: () => void; let entered = false;
  const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(() => release());
  vi.spyOn(HttpSessions.prototype, 'provesNeverSent').mockImplementation(async function (this: HttpSessions, ...args) { entered = true; await gate; return original.apply(this, args); });
  const run = scheduler.runOnce(); await until(() => entered);
  const accepted = scheduler.submit(f.input(f.localContext, 'independent-conversation'));
  const beforeRelease = await Promise.race([accepted.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 200))]);
  release(); await Promise.all([run, accepted]); expect(beforeRelease).toBe(true);
});
it('锁外零发送证明后attempt对象变更在CAS内仍拒绝，未知写绝不回queued', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(f.localContext); await scheduler.submit(input);
  const ready = (HttpSessions.prototype as any).hostedReady;
  vi.spyOn(HttpSessions.prototype as any, 'hostedReady').mockImplementation(async function (this: any, ...args: any[]) { const value = await ready.apply(this, args); this.session(HOSTED_SESSION_ID).storedOperations = 65_536; return value; });
  const original = HttpSessions.prototype.provesNeverSent;
  vi.spyOn(HttpSessions.prototype, 'provesNeverSent').mockImplementation(async function (this: HttpSessions, result, attempt, ...rest) { const valid = await original.call(this, result, attempt, ...rest); attempt.attemptId = randomUUID(); return valid; });
  await scheduler.runOnce(); expect((await f.queue().read(input.id)).state).toBe('uncertain'); expect(f.localMessages.filter(m => m.method === 'turn/start')).toHaveLength(0);
});

it('合法stop的CAS编辑不能换普通写或原turn，原control优先绑定不被编辑绕过', async () => {
  const f = await setup(); const scheduler = f.create();
  const input = { ...f.input(f.localContext, 'thread', 'turn/interrupt'), control: { kind: 'stop' as const, turnId: 'original-turn', expiresAt: Date.now() + 60_000 } };
  input.message.params = { threadId: 'thread', turnId: 'original-turn' } as any;
  const receipt = await scheduler.submit(input); const saved = await f.queue().read(input.id);
  for (const message of [{ id: 'illegal-write', method: 'turn/start', params: { threadId: 'thread' } }, { ...input.message, params: { threadId: 'thread', turnId: 'other-turn' } }]) {
    await expect(f.queue().edit(input.id, receipt.revision, { body: { ...(saved.body as any), message } })).rejects.toBeDefined();
  }
  expect(await f.queue().read(input.id)).toEqual(saved);
  const disk = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8'));
  disk.records[0].body.message = { id: 'illegal-write', method: 'turn/start', params: { threadId: 'thread' } };
  disk.records[0].rpcReceipt.signature = createHash('sha256').update(rpcSignatureInput(disk.records[0].body.message)).digest('hex');
  await writeFile(join(f.options.directory, 'operations.json'), JSON.stringify(disk));
  await expect(f.queue().inventory()).rejects.toBeDefined();
});
it('rpcReceipt严格校验WAL签名及协议快照，Sidechat正文和坏盘均明确拒绝', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(f.localContext); await scheduler.submit(input); const stored = await f.queue().read(input.id);
  const base = { context: stored.context, conversationId: stored.conversationId, body: stored.body, settings: stored.settings, attachmentRefs: stored.attachmentRefs!, rpcReceipt: stored.rpcReceipt! };
  for (const patch of [
    { rpcReceipt: { ...base.rpcReceipt, signature: 'missing' } },
    { rpcReceipt: { ...base.rpcReceipt, signature: '0'.repeat(64) } },
    { rpcReceipt: { ...base.rpcReceipt, sessionId: 'c0dec000-0000-4000-8000-000000000002' } },
    { body: { ...(base.body as any), initialization: { message: { id: 1, method: 'thread/read' } } } },
    { body: { ...(base.body as any), message: { id: 1, method: 'mobile/sidechat/rpc' } }, rpcReceipt: { ...base.rpcReceipt, signature: createHash('sha256').update(rpcSignatureInput({ id: 1, method: 'mobile/sidechat/rpc' } as any)).digest('hex') } },
  ]) await expect(f.queue().submit({ id: randomUUID(), ...base, ...patch } as any)).rejects.toBeDefined();
  const ledger = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8')); ledger.records[0].rpcReceipt.signature = 'wrong';
  await writeFile(join(f.options.directory, 'operations.json'), JSON.stringify(ledger)); await expect(f.queue().inventory()).rejects.toBeDefined();
});

it('close等待尚无Session的原submit真实授权收尾，abort监听重入只用同一关闭Promise且无迟到ACK', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(f.localContext); const actual = f.resolver.authorizeOperation.bind(f.resolver);
  let release!: () => void; let entered = false; let reentrant: Promise<void> | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(() => release());
  vi.spyOn(f.resolver, 'authorizeOperation').mockImplementation(async (...args) => {
    if (args[1] === 'submit') { entered = true; args[2]?.addEventListener('abort', () => { reentrant = scheduler.close(); }, { once: true }); await gate; }
    return actual(...args);
  });
  let ack = false; const pending = scheduler.submit(input).then(() => { ack = true; return undefined; }, error => error);
  await until(() => entered); let ended = false; const close = scheduler.close(); void close.then(() => { ended = true; });
  await new Promise(resolve => setTimeout(resolve, 20)); const endedBeforeRelease = ended;
  release(); await Promise.all([close, pending, scheduler.settled()]); expect(endedBeforeRelease).toBe(false); expect(reentrant).toBe(close); expect(ack).toBe(false); expect(f.localMessages).toEqual([]);
});
it('close在mark后真实dispatch等待中先停止发送并等待自有任务，保留unknown且共享Relay继续健康', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(); await scheduler.submit(input);
  const original = HttpSessions.prototype.dispatchRpc; let entered = false; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(() => release());
  vi.spyOn(HttpSessions.prototype, 'dispatchRpc').mockImplementation(async function (this: HttpSessions, ...args) { entered = true; await gate; return original.apply(this, args); });
  const run = scheduler.runOnce().catch(() => {}); await until(() => entered); expect((await f.queue().read(input.id)).state).toBe('uncertain');
  let ended = false; const close = scheduler.close().then(() => { ended = true; }); await new Promise(resolve => setTimeout(resolve, 20)); expect(ended).toBe(false);
  release(); await Promise.all([run, close, scheduler.settled()]); expect((await f.queue().read(input.id)).state).toBe('uncertain'); expect(f.remoteMessages.filter(m => m.method === 'turn/start')).toEqual([]); expect(f.runtime.status().state).toBe('online');
});

it('普通Session初始化恢复正文沿原64MiB容量计费，超额提交不ACK且不覆盖原盘', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(f.localContext); await scheduler.submit(input);
  const stored = await f.queue().read(input.id); const before = await readFile(join(f.options.directory, 'operations.json'), 'utf8');
  const body = { ...(stored.body as any), initialization: { message: { id: 'real-shape', method: 'initialize', params: { payload: 'x'.repeat(64 * 1024 * 1024) } } } };
  await expect(f.queue().submit({ id: randomUUID(), context: stored.context, conversationId: 'other', body, settings: {}, attachmentRefs: [], rpcReceipt: stored.rpcReceipt })).rejects.toMatchObject({ code: 'capacity' });
  expect(await readFile(join(f.options.directory, 'operations.json'), 'utf8')).toBe(before);
});

it.each([NaN, Infinity, -Infinity])('原deadline %s在任何真实授权或耐久前明确拒绝', async deadline => {
  const f = await setup(); const scheduler = f.create(); const authorize = vi.spyOn(f.resolver, 'authorizeOperation');
  await expect(scheduler.submit(f.input(f.localContext), { deadline })).rejects.toBeInstanceOf(TypeError);
  expect(authorize).not.toHaveBeenCalled(); await expect(readFile(join(f.options.directory, 'operations.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('既有Session WAL原序列化字节与SHA保持，旧确定结果可经原UUID读取', async () => {
  const f = await setup(); const one = f.create(); const input = { ...f.input(f.localContext), message: { id: 'legacy-static', method: 'turn/start', params: { threadId: 'thread' } } };
  await one.submit(input); await one.runOnce(); await one.close();
  const path = join(f.root, 'codex-mobile-http', input.sessionId, `${input.requestId}.json`); const entry = JSON.parse(await readFile(path, 'utf8'));
  // 固定原Session canonical字节（对象不输出闭括号），不以当前共享helper自证兼容。
  const legacyHash = '2b41c7190cb63b9726ca1870583cd183de2c0136b3798d634e523c3c4d2b2d0b';
  expect(entry.signature).toBe(legacyHash);
  entry.signature = legacyHash; await writeFile(path, JSON.stringify(entry));
  const two = f.create(); expect(await two.result(input.id)).toMatchObject({ outcome: 'response', message: { result: { ok: true } } });
  const sameOriginal = { ...input, id: randomUUID() }; await two.submit(sameOriginal); await two.runOnce();
  expect((await f.queue().read(sameOriginal.id)).state).toBe('succeeded');
  expect(f.localMessages.filter(m => m.method === 'turn/start')).toHaveLength(1);
});

it('真实prove回调后的微任务改attempt在最后transition授权后仍拒绝回queued', async () => {
  const f = await setup(); const scheduler = f.create(); const input = f.input(f.localContext); await scheduler.submit(input);
  const ready = (HttpSessions.prototype as any).hostedReady;
  vi.spyOn(HttpSessions.prototype as any, 'hostedReady').mockImplementation(async function (this: any, ...args: any[]) { const value = await ready.apply(this, args); this.session(HOSTED_SESSION_ID).storedOperations = 65_536; return value; });
  let attempt: any; const dispatch = HttpSessions.prototype.dispatchRpc;
  vi.spyOn(HttpSessions.prototype, 'dispatchRpc').mockImplementation(function (this: HttpSessions, ...args) { attempt = args[0]; return dispatch.apply(this, args); });
  const confirm = OperationQueue.prototype.confirmNeverSent; let changed = false;
  vi.spyOn(OperationQueue.prototype, 'confirmNeverSent').mockImplementation(function (this: OperationQueue, id, revision, token, prove) {
    return confirm.call(this, id, revision, token, record => {
      const valid = prove(record);
      if (!changed) { changed = true; queueMicrotask(() => { attempt.attemptId = randomUUID(); }); }
      return valid;
    });
  });
  await scheduler.runOnce(); expect(changed).toBe(true); expect((await f.queue().read(input.id)).state).toBe('uncertain'); expect(f.localMessages.filter(m => m.method === 'turn/start')).toEqual([]);
});

it.each((['local', 'remote'] as const).flatMap(mode => (['stop', 'approval'] as const).flatMap(kind =>
  (['wal', 'send', 'clock', 'settle'] as const).map(wait => ({ mode, kind, wait })))))(
  '$mode $kind控制在mark后$wait真实等待跨过expiresAt：未发送拒绝迟发，已有确定原WAL仍结算', async ({ mode, kind, wait }) => {
    const f = await setup(); f.options.attemptTimeoutMs = 6000; const scheduler = f.create();
    const context = mode === 'local' ? f.localContext : f.remoteContext; const sessionId = randomUUID();
    await scheduler.protocol({ context, sessionId, requestId: randomUUID(), message: { id: 'expiry-init', method: 'initialize', params: { clientInfo: { name: 'expiry-phone', version: '1' } } } });
    await scheduler.protocol({ context, sessionId, requestId: randomUUID(), message: { method: 'initialized', params: {} } });
    let epoch: string | undefined;
    if (kind === 'approval') {
      const pending = { id: 42, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'original-turn' } };
      if (mode === 'local') for (const socket of f.localSockets()) socket.send(JSON.stringify(pending)); else f.sendRemote(pending);
      await vi.waitFor(async () => { const events = await scheduler.events(context, sessionId, 0); expect(events.requests).toContainEqual(pending); epoch = events.epoch; });
    }
    const expiresAt = Date.now() + 900;
    const input = { ...f.input(context), sessionId, ...(epoch ? { epoch } : {}),
      message: kind === 'stop' ? { id: 'expiry-stop', method: 'turn/interrupt', params: { threadId: 'thread', turnId: 'original-turn' } } : { id: 42, result: { decision: 'accept' } },
      control: kind === 'stop' ? { kind: 'stop' as const, turnId: 'original-turn', expiresAt } : { kind: 'approval' as const, turnId: 'original-turn', requestId: `request:${epoch}:42`, expiresAt } };
    await scheduler.submit(input);
    let entered = false; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(() => release());
    const actualDispatch = HttpSessions.prototype.dispatchRpc; let dispatchDeadline = Infinity;
    if (wait !== 'settle') vi.spyOn(HttpSessions.prototype, 'dispatchRpc').mockImplementation(function (this: HttpSessions, ...args) {
      if (args[0].requestId === input.requestId) {
        dispatchDeadline = args[2]!.deadline;
        const session = (this as any).session(sessionId); const method = wait === 'wal' ? 'save' : 'send'; const actual = session[method];
        vi.spyOn(session, method).mockImplementation(async (...values: any[]) => {
          if (method === 'save') {
            const result = await actual.apply(session, values);
            if (values[0].requestId === input.requestId && values[0].status === 'pending') { entered = true; await gate; }
            return result;
          }
          entered = true; await gate; return actual.apply(session, values);
        });
      }
      return actualDispatch.apply(this, args);
    });
    else {
      const actual = OperationQueue.prototype.settle;
      vi.spyOn(OperationQueue.prototype, 'settle').mockImplementation(async function (this: OperationQueue, ...args) {
        if (args[0] === input.id && !entered) { entered = true; await gate; }
        return actual.apply(this, args);
      });
    }
    const running = scheduler.runOnce(); await until(() => entered);
    expect((await f.queue().read(input.id)).state).toBe('uncertain');
    const namespace = createHash('sha256').update(JSON.stringify(['transport-v1', 'remote', context.authorizationKey])).digest('hex');
    const wal = join(f.root, 'codex-mobile-http', ...(mode === 'remote' ? ['remote', namespace] : []), sessionId, `${input.requestId}.json`);
    expect(JSON.parse(await readFile(wal, 'utf8')).status).toBe(wait === 'settle' ? 'completed' : 'pending');
    const clock = wait === 'clock' ? vi.spyOn(Date, 'now').mockReturnValue(expiresAt + 1) : undefined;
    if (clock) expect(performance.now()).toBeLessThan(dispatchDeadline);
    else await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt - Date.now() + 40)));
    release(); try { await running; } finally { clock?.mockRestore(); }
    const messages = mode === 'local' ? f.localMessages : f.remoteMessages;
    const sent = () => messages.filter(message => kind === 'stop' ? message.method === 'turn/interrupt' : message.id === 42 && !message.method);
    expect(sent()).toHaveLength(wait === 'settle' ? 1 : 0);
    expect((await f.queue().read(input.id)).state).toBe(wait === 'settle' ? 'succeeded' : 'uncertain');
    await scheduler.runOnce(); expect(sent()).toHaveLength(wait === 'settle' ? 1 : 0);
    expect((await f.queue().read(input.id)).state).toBe(wait === 'settle' ? 'succeeded' : 'uncertain');
    expect(f.runtime.status().state).toBe('online');
  });

it('独立SPEC probe：控制在mark之后dispatch等待跨过expiresAt不可迟发', async () => {
  const f = await setup(); f.options.attemptTimeoutMs = 2000; const scheduler = f.create();
  const stop = { ...f.input(f.localContext, 'thread', 'turn/interrupt'), control: { kind: 'stop' as const, turnId: 'original-turn', expiresAt: Date.now() + 900 } };
  stop.message.params = { threadId: 'thread', turnId: 'original-turn' } as any;
  await scheduler.submit(stop);
  const dispatch = HttpSessions.prototype.dispatchRpc;
  let markSeen = false;
  vi.spyOn(HttpSessions.prototype, 'dispatchRpc').mockImplementation(async function (this: HttpSessions, ...args) {
    if (args[1].method === 'turn/interrupt') {
      markSeen = (await f.queue().read(stop.id)).state === 'uncertain';
      await new Promise(resolve => setTimeout(resolve, Math.max(0, stop.control.expiresAt - Date.now() + 40)));
    }
    return dispatch.apply(this, args);
  });
  await scheduler.runOnce();
  console.log('SPEC_EXPIRY_OBSERVATION', JSON.stringify({ markSeen, expired: Date.now() >= stop.control.expiresAt, sent: f.localMessages.filter(m => m.method === 'turn/interrupt'), state: (await f.queue().read(stop.id)).state }));
  expect(markSeen).toBe(true);
  expect(f.localMessages.filter(m => m.method === 'turn/interrupt')).toEqual([]);
});


it('QUALITY probe：真实claim耐久后预算到期，close同进程重建仍应恢复未发送项', async () => {
  const f = await setup(); f.options.attemptTimeoutMs = 100; const one = f.create();
  const input = f.input(f.localContext); await one.submit(input);
  const proto = OperationQueue.prototype as any;
  const original = proto.syncDirectories; let held = false;
  const hold = vi.spyOn(proto, 'syncDirectories').mockImplementation(async function (this: any, ...args: any[]) {
    await original.apply(this, args);
    const disk = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8'));
    if (!held && disk.records.find((record: any) => record.id === input.id)?.state === 'claimed') {
      held = true;
      await new Promise(resolve => setTimeout(resolve, 180));
    }
  });
  await one.runOnce(); hold.mockRestore();
  const before = await f.queue().read(input.id); await one.close();
  f.options.attemptTimeoutMs = 1000; const two = f.create(); await two.runOnce();
  const after = await f.queue().read(input.id);
  console.log('QUALITY_CLAIM_FINAL_FENCE', JSON.stringify({ held, before, after, pid: process.pid, sent: f.localMessages.filter(message => message.method === 'turn/start'), lastError: String(one.lastError) }));
  expect(held).toBe(true); expect(after.state).toBe('succeeded');
});


it('QUALITY corrected close probe：claim耐久后close须清理，关闭前零发送且重建后只发送一次', async () => {
  const f = await setup(); f.options.attemptTimeoutMs = 2000; const one = f.create();
  const input = f.input(f.localContext); await one.submit(input);
  const proto = OperationQueue.prototype as any; const original = proto.syncDirectories;
  const mark = vi.spyOn(OperationQueue.prototype, 'markPotentialSend'); const dispatch = vi.spyOn(HttpSessions.prototype, 'dispatchRpc');
  let entered = false; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(() => release());
  const hold = vi.spyOn(proto, 'syncDirectories').mockImplementation(async function (this: any, ...args: any[]) {
    await original.apply(this, args);
    const disk = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8'));
    if (!entered && disk.records.find((record: any) => record.id === input.id)?.state === 'claimed') { entered = true; await gate; }
  });
  const running = one.runOnce().catch(error => String(error)); await until(() => entered);
  const durable = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8')).records[0];
  const closing = one.close(); release(); await Promise.all([running, closing]); hold.mockRestore();
  const before = await f.queue().read(input.id);
  const walPath = join(f.root, 'codex-mobile-http', input.sessionId, `${input.requestId}.json`);
  let preWal = 'exists'; try { await readFile(walPath); } catch (error: any) { preWal = error.code; }
  const pre = { entered, durable, record: before, pid: process.pid, samePid: durable.claimPid === process.pid,
    markCalls: mark.mock.calls.length, dispatchCalls: dispatch.mock.calls.length,
    sent: structuredClone(f.localMessages.filter(message => message.method === 'turn/start')), wal: preWal, lastError: String(one.lastError) };
  await writeFile(join(process.env.HOME!, 'probe-before-restart.json'), JSON.stringify(pre, null, 2));
  console.log('QUALITY_CORRECTED_CLOSE_PRE_RESTART', JSON.stringify(pre));
  // 此时新scheduler尚未构造，所有零发送断言仅针对关闭的原实例。
  expect(pre.entered).toBe(true); expect(pre.durable.state).toBe('claimed'); expect(pre.samePid).toBe(true);
  expect(pre.markCalls).toBe(0); expect(pre.dispatchCalls).toBe(0); expect(pre.sent).toEqual([]); expect(pre.wal).toBe('ENOENT');
  const two = f.create(); await two.runOnce(); const after = await f.queue().read(input.id);
  let postWal: unknown = 'missing'; try { postWal = JSON.parse(await readFile(walPath, 'utf8')); } catch (error: any) { postWal = error.code; }
  const post = { record: after, pid: process.pid, markCalls: mark.mock.calls.length, dispatchCalls: dispatch.mock.calls.length,
    sent: structuredClone(f.localMessages.filter(message => message.method === 'turn/start')), wal: postWal };
  await writeFile(join(process.env.HOME!, 'probe-after-restart.json'), JSON.stringify(post, null, 2));
  console.log('QUALITY_CORRECTED_CLOSE_POST_RESTART', JSON.stringify(post));
  expect(after.state).toBe('succeeded');
  expect(post.markCalls).toBe(1); expect(post.dispatchCalls).toBe(1); expect(post.sent).toHaveLength(1);
  expect(post.wal).toMatchObject({ requestId: input.requestId, status: 'completed' });
});

it.each([false, true])('原Remote claim最终真实授权失效，cleanup暂拒绝后显式resume由%s重建实例恢复精确未发送项', async rebuild => {
  const f = await setup(); f.options.attemptTimeoutMs = 3000; const one = f.create(); const input = f.input(); await one.submit(input);
  const proto = OperationQueue.prototype as any; const actual = proto.syncDirectories; let revoked = false;
  const hold = vi.spyOn(proto, 'syncDirectories').mockImplementation(async function (this: any, ...args: any[]) {
    await actual.apply(this, args); const disk = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8'));
    if (!revoked && disk.records.find((record: any) => record.id === input.id)?.state === 'claimed') {
      revoked = true; await f.runtime.recover(); await until(() => f.runtime.status().state === 'online'); f.attach();
    }
  });
  await one.runOnce(); hold.mockRestore();
  const disk = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8')); expect(revoked).toBe(true); expect(disk.records[0]).toMatchObject({ state: 'claimed', claimPid: process.pid });
  await expect(f.queue().read(input.id)).rejects.toBeDefined(); expect(f.remoteMessages.filter(message => message.method === 'turn/start')).toEqual([]);
  const operation = rebuild ? (await one.close(), f.create()) : one;
  await operation.runOnce(); expect(JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8')).records[0].state).toBe('claimed');
  await f.runtime.resume(local); await operation.runOnce();
  expect((await f.queue().read(input.id)).state).toBe('succeeded'); expect(f.remoteMessages.filter(message => message.method === 'turn/start')).toHaveLength(1); expect(f.localMessages).toEqual([]);
});
it('另一活owner在claimed执行等待时不被新scheduler清理或偷领，原owner最终只发送一次', async () => {
  const f = await setup(); const one = f.create(); const input = f.input(f.localContext); await one.submit(input);
  const actual = OperationQueue.prototype.markPotentialSend; let entered = false; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(() => release());
  vi.spyOn(OperationQueue.prototype, 'markPotentialSend').mockImplementation(async function (this: OperationQueue, ...args) { if (args[0] === input.id && !entered) { entered = true; await gate; } return actual.apply(this, args); });
  const running = one.runOnce(); await until(() => entered); const claimed = await f.queue().read(input.id); expect(claimed.state).toBe('claimed');
  const two = f.create(); await two.runOnce(); expect(await f.queue().read(input.id)).toEqual(claimed); expect(f.localMessages.filter(message => message.method === 'turn/start')).toEqual([]);
  release(); await running; await two.runOnce(); expect((await f.queue().read(input.id)).state).toBe('succeeded'); expect(f.localMessages.filter(message => message.method === 'turn/start')).toHaveLength(1);
});
it('mark已耐久uncertain而最终真实授权拒绝时旧claim清理只丢弃失配责任，恢复后绝不重排或发送', async () => {
  const f = await setup(); f.options.attemptTimeoutMs = 3000; const one = f.create(); const input = f.input(); const later = f.input(); await one.submit(input); await one.submit(later);
  const proto = OperationQueue.prototype as any; const actual = proto.syncDirectories; let revoked = false; const dispatch = vi.spyOn(HttpSessions.prototype, 'dispatchRpc');
  const hold = vi.spyOn(proto, 'syncDirectories').mockImplementation(async function (this: any, ...args: any[]) {
    await actual.apply(this, args); const disk = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8'));
    if (!revoked && disk.records.find((record: any) => record.id === input.id)?.state === 'uncertain') { revoked = true; await f.runtime.recover(); await until(() => f.runtime.status().state === 'online'); f.attach(); }
  });
  await one.runOnce(); hold.mockRestore(); await one.close(); const two = f.create(); await f.runtime.resume(local); await two.runOnce(); await two.runOnce();
  expect(revoked).toBe(true); expect((await f.queue().read(input.id)).state).toBe('uncertain'); expect((await f.queue().read(later.id)).state).toBe('queued'); expect(dispatch).not.toHaveBeenCalled();
  expect(f.remoteMessages.filter(message => message.method === 'turn/start')).toEqual([]); expect(f.localMessages).toEqual([]);
});
it('精确claim清理遇暂时IO故障保留责任，close后新实例重试原CAS而非丢弃或重收其他项', async () => {
  const f = await setup(); f.options.attemptTimeoutMs = 100; const one = f.create(); const input = f.input(f.localContext); await one.submit(input);
  const proto = OperationQueue.prototype as any; const actual = proto.syncDirectories; let delayed = false;
  const hold = vi.spyOn(proto, 'syncDirectories').mockImplementation(async function (this: any, ...args: any[]) {
    await actual.apply(this, args); const disk = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8'));
    if (!delayed && disk.records[0]?.state === 'claimed') { delayed = true; await new Promise(resolve => setTimeout(resolve, 180)); }
  });
  const release = vi.spyOn(OperationQueue.prototype, 'releaseClaim').mockRejectedValue(new Error('injected cleanup IO failure'));
  await one.runOnce(); expect(release).toHaveBeenCalled(); expect((await f.queue().read(input.id)).state).toBe('claimed'); await one.close(); hold.mockRestore(); release.mockRestore();
  f.options.attemptTimeoutMs = 1000; const two = f.create(); const three = f.create(); await Promise.all([two.runOnce(), three.runOnce()]);
  expect((await f.queue().read(input.id)).state).toBe('succeeded'); expect(f.localMessages.filter(message => message.method === 'turn/start')).toHaveLength(1);
});
it('领取最终失败后的真实cleanup等待属于close收尾，关闭不能迟到mark或dispatch', async () => {
  const f = await setup(); f.options.attemptTimeoutMs = 100; const one = f.create(); const input = f.input(f.localContext); await one.submit(input);
  const proto = OperationQueue.prototype as any; const sync = proto.syncDirectories; let delayed = false;
  const hold = vi.spyOn(proto, 'syncDirectories').mockImplementation(async function (this: any, ...args: any[]) {
    await sync.apply(this, args); const disk = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8'));
    if (!delayed && disk.records[0]?.state === 'claimed') { delayed = true; await new Promise(resolve => setTimeout(resolve, 180)); }
  });
  const actual = OperationQueue.prototype.releaseClaim; let entered = false; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(() => release());
  vi.spyOn(OperationQueue.prototype, 'releaseClaim').mockImplementation(async function (this: OperationQueue, ...args) { entered = true; await gate; return actual.apply(this, args); });
  const mark = vi.spyOn(OperationQueue.prototype, 'markPotentialSend'); const dispatch = vi.spyOn(HttpSessions.prototype, 'dispatchRpc');
  const running = one.runOnce().catch(error => String(error)); await until(() => entered); let ended = false; const closing = one.close().then(() => { ended = true; });
  await new Promise(resolve => setTimeout(resolve, 20)); expect(ended).toBe(false); release(); await Promise.all([running, closing, one.settled()]); hold.mockRestore();
  expect(mark).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled(); expect(f.localMessages).toEqual([]);
  f.options.attemptTimeoutMs = 1000; const two = f.create(); await two.runOnce(); expect((await f.queue().read(input.id)).state).toBe('succeeded'); expect(f.localMessages.filter(message => message.method === 'turn/start')).toHaveLength(1);
});

it('cleanup已完成而inventory仍交付旧claimed快照时，同次runOnce重读并真实执行且空闲不忙扫', async () => {
  const f = await setup(); f.options.attemptTimeoutMs = 100; const one = f.create(); const input = f.input(f.localContext); await one.submit(input);
  const proto = OperationQueue.prototype as any; const sync = proto.syncDirectories; let delayed = false;
  const hold = vi.spyOn(proto, 'syncDirectories').mockImplementation(async function (this: any, ...args: any[]) {
    await sync.apply(this, args); const disk = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8'));
    if (!delayed && disk.records[0]?.state === 'claimed') { delayed = true; await new Promise(resolve => setTimeout(resolve, 180)); }
  });
  const failed = vi.spyOn(OperationQueue.prototype, 'releaseClaim').mockRejectedValue(new Error('injected cleanup unavailable'));
  await one.runOnce(); await one.close(); failed.mockRestore(); hold.mockRestore(); expect((await f.queue().read(input.id)).state).toBe('claimed');
  f.options.attemptTimeoutMs = 2000; const two = f.create();
  let snapshotReady!: () => void; const snapshot = new Promise<void>(resolve => { snapshotReady = resolve; });
  let cleaned!: () => void; const done = new Promise<void>(resolve => { cleaned = resolve; }); cleanup.push(() => { snapshotReady(); cleaned(); });
  const actualRelease = OperationQueue.prototype.releaseClaim; let cleanupEntered = false;
  vi.spyOn(OperationQueue.prototype, 'releaseClaim').mockImplementation(async function (this: OperationQueue, ...args) {
    cleanupEntered = true; await snapshot; const value = await actualRelease.apply(this, args); cleaned(); return value;
  });
  const actualInventory = OperationQueue.prototype.inventory; let calls = 0; let stale = false;
  vi.spyOn(OperationQueue.prototype, 'inventory').mockImplementation(async function (this: OperationQueue, ...args) {
    const value = await actualInventory.apply(this, args); calls++;
    if (cleanupEntered && !stale) {
      stale = value.some(group => group.operations.some(receipt => receipt.id === input.id && receipt.state === 'claimed'));
      snapshotReady(); await done; await new Promise<void>(resolve => setImmediate(resolve)); // 真实cleanup Promise先完成，再交付旧快照。
    }
    return value;
  });
  await two.runOnce(); expect(stale).toBe(true); expect((await f.queue().read(input.id)).state).toBe('succeeded'); expect(f.localMessages.filter(message => message.method === 'turn/start')).toHaveLength(1);
  const before = calls; await two.runOnce(); expect(calls - before).toBe(1);
});

it('持续claim最终预算失效在单次scan仅耐久领取一次，恢复后下一次只真实发送一次', async () => {
  const f = await setup(); f.options.attemptTimeoutMs = 1000; const one = f.create(); const input = f.input(f.localContext); await one.submit(input);
  const proto = OperationQueue.prototype as any; const actual = proto.syncDirectories; const claims = new Set<string>(); let forcedClose = false;
  const mark = vi.spyOn(OperationQueue.prototype, 'markPotentialSend'); const dispatch = vi.spyOn(HttpSessions.prototype, 'dispatchRpc');
  const hold = vi.spyOn(proto, 'syncDirectories').mockImplementation(async function (this: any, ...args: any[]) {
    await actual.apply(this, args); const disk = JSON.parse(await readFile(join(f.options.directory, 'operations.json'), 'utf8'));
    const record = disk.records[0]; const binding = JSON.stringify([record?.claimToken, record?.revision]);
    if (record?.state === 'claimed' && !claims.has(binding)) {
      claims.add(binding); if (claims.size === 1) await new Promise(resolve => setTimeout(resolve, 1100));
      if (claims.size === 2) { forcedClose = true; void one.close(); } // 反例的第二次真实领取后有界停机，不靠测试超时结束。
    }
  });
  await one.runOnce().catch(error => String(error)); hold.mockRestore();
  expect(claims.size).toBe(1); expect(forcedClose).toBe(false); expect(mark).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled(); expect(f.localMessages).toEqual([]); expect((await f.queue().read(input.id)).state).toBe('queued');
  await one.runOnce(); expect((await f.queue().read(input.id)).state).toBe('succeeded'); expect(f.localMessages.filter(message => message.method === 'turn/start')).toHaveLength(1);
});

for (const mode of ['local', 'remote'] as const) for (const method of ['thread/read', 'turn/start']) {
  it(`${mode} ${method}真实派发等待回复时公开pending，原磁盘uncertain不提前终止客户端`, async () => {
    const f = await setup(); f.options.attemptTimeoutMs = 5000; const scheduler = f.create();
    f.respond((_mode, message) => message.method === method ? undefined as any : ({ id: message.id, result: { ok: true } }));
    const input = f.input(mode === 'local' ? f.localContext : f.remoteContext, 'thread', method); input.requestId = input.id;
    await scheduler.submit(input); const run = scheduler.runOnce();
    const messages = mode === 'local' ? f.localMessages : f.remoteMessages;
    await until(() => messages.some(message => message.method === method));
    try {
      expect((await f.queue().read(input.id)).state).toBe('uncertain');
      expect(await scheduler.operation(input.id, input.context, input.sessionId)).toMatchObject({ status: 'pending', operation: { state: 'uncertain' } });
    } finally {
      const reply = { id: messages.find(message => message.method === method).id, result: { ok: true } };
      if (mode === 'local') for (const socket of f.localSockets()) socket.send(JSON.stringify(reply)); else f.sendRemote(reply);
      await run;
    }
    expect(await scheduler.operation(input.id, input.context, input.sessionId)).toMatchObject({ status: 'completed', message: { result: { ok: true } } });
  }, 15000);
}
it('原派发超时后公开uncertain，不因其他原项仍在执行变pending且绝不重发', async () => {
  const f = await setup(); f.options.attemptTimeoutMs = 2000; const scheduler = f.create();
  f.respond((_mode, message) => ['turn/start', 'thread/read'].includes(message.method) ? undefined as any : ({ id: message.id, result: { ok: true } }));
  const first = f.input(f.localContext); first.requestId = first.id; await scheduler.submit(first); await scheduler.runOnce();
  expect(await scheduler.operation(first.id, first.context, first.sessionId)).toMatchObject({ status: 'uncertain' });
  const other = f.input(f.localContext, 'other-thread', 'thread/read'); other.requestId = other.id; await scheduler.submit(other); const run = scheduler.runOnce();
  await until(() => f.localMessages.some(message => message.method === 'thread/read'));
  try {
    expect(await scheduler.operation(other.id, other.context, other.sessionId)).toMatchObject({ status: 'pending' });
    expect(await scheduler.operation(first.id, first.context, first.sessionId)).toMatchObject({ status: 'uncertain' });
  } finally { await run; }
  await scheduler.runOnce(); expect(f.localMessages.filter(message => message.method === 'turn/start')).toHaveLength(1);
}, 15000);
it('原回复在公开查询最后授权等待期间完成时，不把先前在途快照误报uncertain', async () => {
  const f = await setup(); f.options.attemptTimeoutMs = 2000; const scheduler = f.create();
  f.respond((_mode, message) => message.method === 'thread/read' ? undefined as any : ({ id: message.id, result: { ok: true } }));
  const input = f.input(f.localContext, 'thread', 'thread/read'); input.requestId = input.id;
  await scheduler.submit(input); const run = scheduler.runOnce(); await until(() => f.localMessages.some(message => message.method === 'thread/read'));
  const authorize = f.resolver.authorizeOperation.bind(f.resolver); let count = 0; let entered = false; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(release);
  vi.spyOn(f.resolver, 'authorizeOperation').mockImplementation(async (...args) => {
    const fence = await authorize(...args);
    if (args[1] === 'read' && ++count === 2) { entered = true; await gate; }
    return fence;
  });
  const query = scheduler.operation(input.id, input.context, input.sessionId);
  await until(() => entered);
  const reply = { id: f.localMessages.find(message => message.method === 'thread/read').id, result: { ok: true } };
  for (const socket of f.localSockets()) socket.send(JSON.stringify(reply)); await run; release();
  expect((await query).status).not.toBe('uncertain');
  expect(await scheduler.operation(input.id, input.context, input.sessionId)).toMatchObject({ status: 'completed' });
});
