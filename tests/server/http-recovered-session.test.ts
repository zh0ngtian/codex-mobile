// @vitest-environment node
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, it, vi } from 'vitest';
import { HttpSessions, HOSTED_SESSION_ID, type HttpSessionRemoteOptions } from '../../server/http-session.js';
import { TargetResolver } from '../../server/targets.js';
import { localMediaFiles } from '../../server/media-file-source.js';
import { withRemoteOperation } from '../../server/remote/operation-guard.js';
import { fixture, until } from './remote-session-fixture.js';

const io = vi.hoisted(() => ({ afterReadDirectory: undefined as undefined | ((path: unknown) => Promise<void>) }));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, readdir: async (...args: any[]) => { const result = await (actual.readdir as any)(...args); await io.afterReadDirectory?.(args[0]); return result; } };
});

const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); io.afterReadDirectory = undefined; });
const tuple = { environmentId: 'local-env', installationId: 'local-install' };
const grant = (value = tuple) => ({ env_id: value.environmentId, installation_id: value.installationId, kind: 'single', online: true, busy: false });
const namespace = (key: string) => createHash('sha256').update(JSON.stringify(['transport-v1', 'remote', key])).digest('hex');
async function setup(recover: boolean | number = true) {
  const f = await fixture({ createLogin: () => ({ async login() { throw new Error('controlled-login-cancel'); }, async close() {} }) });
  await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const identity = { version: 1 as const, gatewayId: 'recovered-gateway', localHostId: 'recovered-local' };
  const resolver = new TargetResolver({ identity, remoteRuntime: f.runtime });
  const reference = { mode: 'remote' as const, gatewayId: identity.gatewayId, account: { accountId: 'workspace', accountUserId: 'account-user', userId: 'user' }, target: tuple };
  const old = await resolver.resolve(reference); const context = await resolver.operationContext(reference); const bytes = JSON.stringify(context);
  const ancestor = await f.registry.readActive();
  if (recover) { for (let index = 0; index < (typeof recover === 'number' ? recover : 1); index++) { await f.runtime.recover(); await until(() => f.runtime.status().state === 'online'); } await f.runtime.resume(tuple); }
  const current = await resolver.resolve(reference);
  const frames: any[] = []; const seq = new Map<string, number>();
  f.connections.at(-1)!.on('message', raw => { const frame = JSON.parse(raw.toString()); frames.push(frame); if (frame.message?.method && frame.message.id != null) send(frame, { id: frame.message.id, result: { ok: true } }); });
  function send(frame: any, message: any) { const next = (seq.get(frame.stream_id) ?? 0) + 1; seq.set(frame.stream_id, next); f.connections.at(-1)!.send(JSON.stringify({ type: 'server_message', client_id: f.runtime.status().clientId, env_id: frame.env_id, stream_id: frame.stream_id, seq_id: next, message })); }
  const remote: HttpSessionRemoteOptions = { target: current, resolver, context, storageNamespace: namespace(context.authorizationKey),
    projections: { changeHistory: { observe() {}, async beforeStart() {}, async cancelStart() {}, async get() { return null; }, async flush() {} }, images: { async result(value) { return value; }, async notification(value) { return value; } }, timestamps: { async result(_id, value) { return value; }, async notification(value) { return value; } }, webCitations: { async result(_id, value) { return value; }, async notification(value) { return value; } } },
    sidechatReplay: { files: { ...localMediaFiles, kind: 'remote' }, resolveReference: async () => null } };
  const sessions = (change: Partial<HttpSessionRemoteOptions> = {}) => { const value = new HttpSessions({ codexHome: f.root, upstreamUrl: 'ws://127.0.0.1:1', remote: { ...remote, ...change } }); cleanup.push(() => value.close()); return value; };
  const path = (sessionId: string, requestId: string) => join(f.root, 'codex-mobile-http', 'remote', remote.storageNamespace, sessionId, `${requestId}.json`);
  return { ...f, resolver, identity, reference, context, bytes, old, current, remote, sessions, frames, path, ancestor, send };
}
it.each([1, 2])('原context跨%i代显式恢复后使用当前真实handle和原namespace，仅一次执行原UUID且旧handle永拒', async generations => {
  const f = await setup(generations); const sessions = f.sessions(); const sessionId = randomUUID(); const requestId = randomUUID();
  expect(f.current.descriptor.transportNamespace).not.toBe(f.remote.storageNamespace);
  expect(await sessions.dispatchRpc({ sessionId, requestId: randomUUID(), attemptId: randomUUID() }, { id: 'original-initialize', method: 'initialize' })).toHaveProperty('outcome', 'response');
  const attempt = { sessionId, requestId, attemptId: randomUUID() }; const message = { id: requestId, method: 'turn/start', params: { threadId: 'original' } };
  expect(await sessions.dispatchRpc(attempt, message)).toMatchObject({ outcome: 'response', message: { id: requestId, result: { ok: true } } });
  expect(await sessions.dispatchRpc({ ...attempt, attemptId: randomUUID() }, message)).toHaveProperty('outcome', 'response');
  expect(f.frames.filter(frame => frame.message?.method === 'turn/start')).toHaveLength(1);
  expect(JSON.parse(await readFile(f.path(sessionId, requestId), 'utf8'))).toMatchObject({ requestId, status: 'completed', message: { id: requestId } });
  expect(await readdir(join(f.root, 'codex-mobile-http', 'remote', f.current.descriptor.transportNamespace)).catch(() => [])).toEqual([]);
  expect(JSON.stringify(f.context)).toBe(f.bytes); await expect(f.old.assertCurrent()).rejects.toThrow();
  const rejected = f.sessions({ target: f.old });
  expect(await rejected.dispatchRpc({ sessionId, requestId: randomUUID(), attemptId: randomUUID() }, message)).toHaveProperty('outcome', 'unknown');
  expect((rejected as any).sessions.size).toBe(0);
});
it.each(['completed', 'pending', 'uncertain'] as const)('跨代原%s只依据原WAL，不因当前namespace为空重发', async status => {
  const f = await setup(false); const original = f.sessions(); const sessionId = HOSTED_SESSION_ID; const requestId = randomUUID();
  const message = { id: requestId, method: 'turn/start', params: { threadId: 'frozen' } };
  expect(await original.dispatchRpc({ sessionId, requestId, attemptId: randomUUID() }, message)).toHaveProperty('outcome', 'response'); await original.close();
  const path = f.path(sessionId, requestId); const entry = JSON.parse(await readFile(path, 'utf8')); entry.status = status; if (status !== 'completed') delete entry.message; await writeFile(path, JSON.stringify(entry));
  const before = await readFile(path); await f.runtime.recover(); await until(() => f.runtime.status().state === 'online'); await f.runtime.resume(tuple);
  const current = await f.resolver.resolve(f.reference); const sessions = f.sessions({ target: current }); const frames: any[] = []; let seq = 0;
  f.connections.at(-1)!.on('message', raw => { const frame = JSON.parse(raw.toString()); frames.push(frame); if (frame.message?.method && frame.message.id != null) f.connections.at(-1)!.send(JSON.stringify({ type: 'server_message', client_id: f.runtime.status().clientId, env_id: frame.env_id, stream_id: frame.stream_id, seq_id: ++seq, message: { id: frame.message.id, result: { ok: true } } })); });
  const result = await sessions.dispatchRpc({ sessionId, requestId, attemptId: randomUUID() }, message);
  expect(result).toMatchObject(status === 'completed' ? { outcome: 'response', message: { result: { ok: true } } } : { outcome: 'unknown' });
  expect(frames.filter(frame => frame.message?.method === 'turn/start')).toEqual([]);
  expect(await readFile(path)).toEqual(before);
});
it.each(['unresumed', 'paused', 'reinstalled', 'missing', 'account', 'accountUser', 'user', 'user-presence', 'home', 'bad-chain', 'expired-handle', 'old-handle'] as const)('跨代%s在取得Session及扫描原WAL前拒绝', async kind => {
  const f = await setup(); const sessions = f.sessions(kind === 'old-handle' ? { target: f.old } : kind === 'home' && f.context.mode === 'remote' ? { context: { ...f.context, managed: { ...f.context.managed, codexHome: '/synthetic/other-home' } } } : {});
  const sessionId = randomUUID(); const requestId = randomUUID(); const image = f.path(sessionId, randomUUID());
  await mkdir(dirname(image), { recursive: true }); await writeFile(image, JSON.stringify({ status: 'completed', message: { result: { dataBase64: 'keep-image' } } }));
  if (kind === 'unresumed' || kind === 'expired-handle') { await f.runtime.recover(); await until(() => f.runtime.status().state === 'online'); if (kind === 'expired-handle') await f.runtime.resume(tuple); }
  if (kind === 'paused') { f.setKey(false); await expect(f.runtime.login()).rejects.toThrow(); }
  if (kind === 'reinstalled') { f.setTargets([grant({ ...tuple, installationId: 'reinstalled' })]); await f.runtime.refreshTargets(); }
  if (kind === 'missing') { f.setTargets([]); await f.runtime.refreshTargets(); }
  if (kind === 'account') f.setManaged({ accountId: 'changed' });
  if (kind === 'accountUser') f.setManaged({ accountUserId: 'changed' });
  if (kind === 'user') f.setManaged({ userId: 'changed' });
  if (kind === 'user-presence') f.setManaged({ userId: undefined } as any);
  if (kind === 'bad-chain') await rename(join(f.ancestor!.store.directory, 'candidate.json'), join(f.ancestor!.store.directory, 'candidate.kept'));
  expect(await sessions.dispatchRpc({ sessionId, requestId, attemptId: randomUUID() }, { id: requestId, method: 'turn/start' })).toHaveProperty('outcome', 'unknown');
  expect((sessions as any).sessions.size).toBe(0); expect(await readFile(image, 'utf8')).toContain('keep-image');
  expect(f.frames.filter(frame => frame.type === 'client_message')).toEqual([]);
});
it.each(['signal', 'deadline', 'parent'] as const)('原%s不续期且零Session/原WAL清理', async kind => {
  const f = await setup(); const sessions = f.sessions(); const abort = new AbortController(); let expired = false;
  const call = { deadline: performance.now() + (kind === 'deadline' ? -1 : 5000), signal: abort.signal };
  if (kind === 'signal') abort.abort(); if (kind === 'parent') expired = true;
  const result = await withRemoteOperation(() => { if (expired) throw new Error('original-parent-ended'); }, () => sessions.dispatchRpc({ sessionId: randomUUID(), requestId: randomUUID(), attemptId: randomUUID() }, { id: 'write', method: 'turn/start' }, call)).catch(() => ({ outcome: 'unknown' }));
  expect(result).toHaveProperty('outcome', 'unknown'); expect((sessions as any).sessions.size).toBe(0); expect(f.frames).toEqual([]);
});
it('同代严格namespace/key/generation及双ID不因跨代路径放宽', async () => {
  const f = await setup(false);
  for (const change of [{ storageNamespace: 'a'.repeat(64) }, { context: { ...f.context, generation: 'altered' } }, { context: { ...f.context, authorizationKey: 'b'.repeat(64) } }, { context: { ...f.context, target: { ...tuple, installationId: 'other' } } }]) expect(() => f.sessions(change as any)).toThrow();
});
it('构造后更换调用者options/context容器不能换绑原WAL和当前handle', async () => {
  const f = await setup(); const context = structuredClone(f.context); const remote = { ...f.remote, context };
  const options = { codexHome: f.root, upstreamUrl: 'ws://127.0.0.1:1', remote };
  const sessions = new HttpSessions(options); cleanup.push(() => sessions.close());
  if (context.mode !== 'remote') throw new Error('remote fixture');
  context.authorizationKey = 'a'.repeat(64); context.managed.codexHome = '/synthetic/wrong'; context.target.installationId = 'wrong';
  remote.target = f.old; remote.storageNamespace = 'b'.repeat(64); remote.resolver = new TargetResolver({ identity: { ...f.identity, gatewayId: 'wrong' } });
  options.remote = remote; options.codexHome = '/synthetic/wrong';
  const requestId = randomUUID(); expect(await sessions.dispatchRpc({ sessionId: HOSTED_SESSION_ID, requestId, attemptId: randomUUID() }, { id: requestId, method: 'turn/start', params: { threadId: 'frozen' } })).toHaveProperty('outcome', 'response');
  expect(JSON.parse(await readFile(f.path(HOSTED_SESSION_ID, requestId), 'utf8'))).toHaveProperty('status', 'completed');
});

it.each(['signal', 'deadline', 'parent', 'handle'] as const)('跨代原WAL扫描await期间原%s失效，不继续读取或清理旧图片记录', async kind => {
  const f = await setup(); const sessions = f.sessions(); const sessionId = randomUUID(); const image = f.path(sessionId, randomUUID());
  await mkdir(dirname(image), { recursive: true }); await writeFile(image, JSON.stringify({ status: 'completed', message: { result: { dataBase64: 'protected-image' } } }));
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  io.afterReadDirectory = async path => { if (path === dirname(image)) { entered(); await gate; } };
  const abort = new AbortController(); let expired = false; const call = { deadline: performance.now() + 5000, signal: abort.signal };
  const pending = withRemoteOperation(() => { if (expired) throw new Error('original-parent-ended'); }, () => sessions.dispatchRpc({ sessionId, requestId: randomUUID(), attemptId: randomUUID() }, { id: 'write', method: 'turn/start' }, call)).catch(error => ({ outcome: 'unknown', error }));
  await started; if (kind === 'signal') abort.abort(); if (kind === 'deadline') vi.spyOn(performance, 'now').mockReturnValue(call.deadline + 1); if (kind === 'parent') expired = true; if (kind === 'handle') (f.runtime as any).active.state.paused = true; release(); expect(await pending).toHaveProperty('outcome', 'unknown'); await [...(sessions as any).sessions.values()][0].loadPromise.catch(() => {});
  expect(await readFile(image, 'utf8')).toContain('protected-image'); expect(f.frames).toEqual([]);
});
it('不同真实Runtime的当前handle即使同gateway/managed/双ID也不能借原resolver恢复证明发送', async () => {
  const f = await setup(); const other = await fixture(); await other.runtime.authorize(); await until(() => other.runtime.status().state === 'online');
  const otherResolver = new TargetResolver({ identity: f.identity, remoteRuntime: other.runtime }); const otherTarget = await otherResolver.resolve(f.reference);
  expect(otherTarget.descriptor.generation).not.toBe(f.current.descriptor.generation);
  const sessions = f.sessions({ target: otherTarget });
  const frames: any[] = []; let sequence = 0; other.connections.at(-1)!.on('message', bytes => { const frame = JSON.parse(bytes.toString()); frames.push(frame); if (frame.message?.method && frame.message.id != null) other.connections.at(-1)!.send(JSON.stringify({ type: 'server_message', client_id: other.runtime.status().clientId, env_id: frame.env_id, stream_id: frame.stream_id, seq_id: ++sequence, message: { id: frame.message.id, result: { ok: true } } })); });
  expect(await sessions.dispatchRpc({ sessionId: HOSTED_SESSION_ID, requestId: randomUUID(), attemptId: randomUUID() }, { id: 'foreign-runtime', method: 'turn/start' })).toHaveProperty('outcome', 'unknown');
  expect((sessions as any).sessions.size).toBe(0); expect(frames.filter(frame => frame.type === 'client_message')).toEqual([]);
});
it.each(['dispatch', 'hosted', 'helper'] as const)('跨代%s最后包装Promise微任务撤权不交付已完成正文', async kind => {
  const f = await setup(); const sessions = f.sessions(); const requestId = randomUUID(); const message = { id: requestId, method: 'turn/start', params: { threadId: 'frozen' } };
  expect(await sessions.dispatchRpc({ sessionId: HOSTED_SESSION_ID, requestId, attemptId: randomUUID() }, message)).toHaveProperty('outcome', 'response');
  const actual = f.resolver.authorizeOperationExecution.bind(f.resolver); let calls = 0; let checks = 0; let queued = false;
  vi.spyOn(f.resolver, 'authorizeOperationExecution').mockImplementation(async (...args) => {
    const fence = await actual(...args); if (++calls !== 1) return fence;
    return { assertCurrent: () => { fence.assertCurrent(); checks++; }, assertLive: () => { fence.assertLive(); if (checks >= 2 && !queued) { queued = true; queueMicrotask(() => { (f.runtime as any).active.state.paused = true; }); } } };
  });
  const result = kind === 'dispatch' ? await sessions.dispatchRpc({ sessionId: HOSTED_SESSION_ID, requestId, attemptId: randomUUID() }, message) : await (kind === 'hosted' ? sessions.hostedRpc(message, requestId) : sessions.hostedOperation(requestId)).then(value => ({ outcome: 'response', value }), error => ({ outcome: 'unknown', error }));
  expect(queued).toBe(true); expect(result).toHaveProperty('outcome', 'unknown'); expect(result).not.toHaveProperty('message');
});
it.each(['deadline', 'revoked'] as const)('跨代hostedOperation原%s失效时先拒绝再取得Session', async kind => {
  const f = await setup(); const sessions = f.sessions(); if (kind === 'revoked') { f.setManaged({ accountId: 'revoked-before-helper' }); await f.runtime.readTargetBinding().catch(() => {}); }
  await expect(sessions.hostedOperation(randomUUID(), { deadline: performance.now() + (kind === 'deadline' ? -1 : 5000) })).rejects.toThrow();
  expect((sessions as any).sessions.size).toBe(0); expect(f.frames).toEqual([]);
});
it('跨代hosted/helper授权await期间调用者修改call不替换原signal/期限', async () => {
  const f = await setup(); const sessions = f.sessions(); const abort = new AbortController(); const call: { deadline: number; signal?: AbortSignal } = { deadline: performance.now() + 5000, signal: abort.signal };
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const actual = f.resolver.authorizeOperationExecution.bind(f.resolver); let once = true;
  vi.spyOn(f.resolver, 'authorizeOperationExecution').mockImplementation(async (...args) => { const fence = await actual(...args); if (once) { once = false; entered(); await gate; } return fence; });
  const pending = sessions.hostedRpc({ id: 'original', method: 'turn/start', params: { threadId: 't' } }, randomUUID(), call).then(value => ({ value }), error => ({ error }));
  await started; abort.abort(); call.signal = undefined; call.deadline += 10000; release();
  expect(await pending).toHaveProperty('error'); expect((sessions as any).sessions.size).toBe(0); expect(f.frames).toEqual([]);
});

it('跨代本地统计helper先返回后原deadline失效，后台load保留原预算不清理旧WAL图片', async () => {
  const f = await setup(); const sessions = f.sessions(); const sessionId = randomUUID(); const image = f.path(sessionId, randomUUID());
  await mkdir(dirname(image), { recursive: true }); await writeFile(image, JSON.stringify({ status: 'completed', message: { result: { dataBase64: 'background-protected' } } }));
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(() => release());
  io.afterReadDirectory = async path => { if (path === dirname(image)) { entered(); await gate; } };
  const server = createServer((request, response) => { void sessions.handle(request, response, new URL(request.url!, 'http://localhost')); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const pending = fetch(`http://127.0.0.1:${(server.address() as any).port}/api/rpc?sessionId=${sessionId}`, { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), message: { id: 'usage', method: 'mobile/uploadUsage/read', params: { threadId: 't' } } }) }); await started;
  expect((await pending).status).toBe(200); vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 61000); release();
  await [...(sessions as any).sessions.values()][0].loadPromise.catch(() => {});
  expect(await readFile(image, 'utf8')).toContain('background-protected');
});

it('跨代真实stream零发送证明仍绑定原attempt/namespace，原未发送项仅一次正常执行', async () => {
  const f = await setup(); const sessions = f.sessions(); await sessions.hostedReady();
  const session = (sessions as any).sessions.get(HOSTED_SESSION_ID); const relay = (f.runtime as any).bundle.controller.relay; const budget = relay.maxBufferedBytes; const sequence = session.socket.lastSentSeqId;
  const attempt = { sessionId: HOSTED_SESSION_ID, requestId: randomUUID(), attemptId: randomUUID() }; const message = { id: attempt.requestId, method: 'turn/start', params: { threadId: 'original' } }; let zero: any;
  try { relay.maxBufferedBytes = 0; zero = await sessions.dispatchRpc(attempt, message); } finally { relay.maxBufferedBytes = budget; }
  expect(zero.outcome).toBe('neverSent'); expect(session.socket.lastSentSeqId).toBe(sequence); expect(await sessions.provesNeverSent(zero, attempt)).toBe(true);
  expect(await sessions.provesNeverSent(zero, { ...attempt })).toBe(false); expect(await f.sessions().provesNeverSent(zero, attempt)).toBe(false);
  expect(await sessions.dispatchRpc(attempt, message)).toHaveProperty('outcome', 'response'); expect(await sessions.provesNeverSent(zero, attempt)).toBe(false);
  expect(f.frames.filter(frame => frame.message?.method === 'turn/start')).toHaveLength(1); expect(JSON.parse(await readFile(f.path(HOSTED_SESSION_ID, attempt.requestId), 'utf8'))).toHaveProperty('status', 'completed');
});
it('dispatch自身最后await仍同步核验原真实执行fence，不只核验Session和预算', async () => {
  const f = await setup(); const sessions = f.sessions(); const requestId = randomUUID(); const message = { id: requestId, method: 'turn/start', params: { threadId: 'cached' } };
  expect(await sessions.dispatchRpc({ sessionId: HOSTED_SESSION_ID, requestId, attemptId: randomUUID() }, message)).toHaveProperty('outcome', 'response');
  const actual = f.resolver.authorizeOperationExecution.bind(f.resolver); let calls = 0; let checks = 0; let queued = false;
  vi.spyOn(f.resolver, 'authorizeOperationExecution').mockImplementation(async (...args) => { const fence = await actual(...args); if (++calls !== 1) return fence; return { ...fence, assertCurrent: () => { fence.assertCurrent(); if (++checks === 3) { queued = true; queueMicrotask(() => { (f.runtime as any).active.state.paused = true; }); } } }; });
  const result = await sessions.dispatchRpc({ sessionId: HOSTED_SESSION_ID, requestId, attemptId: randomUUID() }, message);
  expect(queued).toBe(true); expect(result).toHaveProperty('outcome', 'unknown'); expect(result).not.toHaveProperty('message');
});
it.each(['result', 'proof'] as const)('跨代neverSent %s自身最后await保留真实原身份fence', async kind => {
  const f = await setup(); const sessions = f.sessions(); await sessions.hostedReady(); const attempt = { sessionId: HOSTED_SESSION_ID, requestId: randomUUID(), attemptId: randomUUID() }; const relay = (f.runtime as any).bundle.controller.relay; const budget = relay.maxBufferedBytes;
  let result: any; if (kind === 'proof') { try { relay.maxBufferedBytes = 0; result = await sessions.dispatchRpc(attempt, { id: 'proof', method: 'turn/start' }); } finally { relay.maxBufferedBytes = budget; } expect(result.outcome).toBe('neverSent'); }
  const actual = f.resolver.authorizeOperation.bind(f.resolver); let checks = 0; let queued = false;
  vi.spyOn(f.resolver, 'authorizeOperation').mockImplementation(async (...args) => { const fence = await actual(...args); return () => { fence(); if (++checks === 2) { queued = true; queueMicrotask(() => { (f.runtime as any).active.state.paused = true; }); } }; });
  if (kind === 'result') { try { relay.maxBufferedBytes = 0; result = await sessions.dispatchRpc(attempt, { id: 'proof', method: 'turn/start' }); } finally { relay.maxBufferedBytes = budget; } expect(result).toHaveProperty('outcome', 'unknown'); }
  else expect(await sessions.provesNeverSent(result, attempt)).toBe(false);
  expect(queued).toBe(true);
});
it('跨代真实HTTP在handle自身最后await后核验同次fence，迟到缓存正文不进入response.end', async () => {
  const f = await setup(); const sessions = f.sessions(); const sessionId = randomUUID(); const requestId = randomUUID(); const message = { id: 'HTTP_ORIGINAL_BODY', method: 'turn/start', params: { threadId: 't' } };
  expect(await sessions.dispatchRpc({ sessionId, requestId: randomUUID(), attemptId: randomUUID() }, { id: 'init', method: 'initialize' })).toHaveProperty('outcome', 'response');
  expect(await sessions.dispatchRpc({ sessionId, requestId, attemptId: randomUUID() }, message)).toHaveProperty('outcome', 'response');
  const actual = f.resolver.authorizeOperationExecution.bind(f.resolver); let calls = 0; let checks = 0; let queued = false;
  vi.spyOn(f.resolver, 'authorizeOperationExecution').mockImplementation(async (...args) => { const fence = await actual(...args); if (++calls !== 1) return fence; return { ...fence, assertCurrent: () => { fence.assertCurrent(); if (++checks === 3) { queued = true; queueMicrotask(() => { (f.runtime as any).active.state.paused = true; }); } } }; });
  const server = createServer((request, response) => { void sessions.handle(request, response, new URL(request.url!, 'http://localhost')); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/rpc?sessionId=${sessionId}`, { method: 'POST', body: JSON.stringify({ requestId, message }) });
  const body = await response.text(); expect(queued).toBe(true); expect(response.status).toBe(503); expect(body).not.toContain('HTTP_ORIGINAL_BODY');
});
