// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import * as httpSession from '../../server/http-session.js';
import { localMediaFiles } from '../../server/media-file-source.js';
import { TargetResolver } from '../../server/targets.js';
import type { OperationContext } from '../../server/operation-queue.js';
import { withRemoteOperation } from '../../server/remote/operation-guard.js';
import { PrivateStore } from '../../server/remote/private-store.js';
import { fixture, until } from './remote-session-fixture.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const local = { environmentId: 'local-env', installationId: 'local-install' };
const remote = { environmentId: 'remote-env', installationId: 'remote-install' };
const target = (value: typeof local, online = true) => ({ env_id: value.environmentId, installation_id: value.installationId, kind: 'single', online, busy: false });
const identity = { version: 1 as const, gatewayId: 'receipt-gateway', localHostId: 'receipt-local' };
async function setup() {
  const f = await fixture({ createLogin: () => ({ async login() { throw new Error('controlled-login-cancel'); }, async close() {} }) }); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const resolver = new TargetResolver({ identity, remoteRuntime: f.runtime });
  const reference = { mode: 'remote' as const, gatewayId: identity.gatewayId, account: { accountId: 'workspace', accountUserId: 'account-user', userId: 'user' }, target: local };
  const context = await resolver.operationContext(reference);
  const localContext = await resolver.operationContext();
  const frames: any[] = []; f.connections[0]!.on('message', bytes => frames.push(JSON.parse(bytes.toString())));
  const input = (value: OperationContext = context, sessionId: string = randomUUID(), requestId: string = randomUUID()) => ({ gatewayCodexHome: f.root, resolver, context: value, sessionId, requestId, call: { deadline: performance.now() + 5000 } as httpSession.SessionCallOptions });
  return { ...f, resolver, reference, context, localContext, frames, input };
}
type Input = ReturnType<Awaited<ReturnType<typeof setup>>['input']>;
const pathFor = (input: Input) => join(input.gatewayCodexHome, 'codex-mobile-http', ...(input.context.mode === 'remote' ? ['remote', createHash('sha256').update(JSON.stringify(['transport-v1', 'remote', input.context.authorizationKey])).digest('hex')] : []), input.sessionId, `${input.requestId}.json`);
async function store(input: Input, status = 'completed', message: any = { id: 'original', result: { text: 'ORIGINAL_SECRET' } }) {
  const path = pathFor(input); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify({ requestId: input.requestId, signature: 'a'.repeat(64), status, ...(message ? { message } : {}) })); return path;
}
function read(input: Input): Promise<{ status: string; message?: httpSession.RpcMessage }> {
  // 缺少真实内部能力必须是行为RED，不能以导入或TypeError冒充。
  expect(httpSession).toHaveProperty('readOriginalOperation', expect.any(Function));
  return (httpSession as any).readOriginalOperation(input);
}
it('原Local和同机Remote共享businessKey仍只读各自单条WAL，Sidechat不落盘且不扫描图片记录', async () => {
  const f = await setup(); expect(f.context.businessKey).toBe(f.localContext.businessKey);
  const remoteInput = f.input(); const localInput = { ...remoteInput, context: f.localContext };
  const remotePath = await store(remoteInput); const localPath = await store(localInput, 'completed', { result: { text: 'LOCAL_ONLY' } });
  const imageInput = f.input(f.context, remoteInput.sessionId); const imagePath = await store(imageInput, 'completed', { result: { dataBase64: 'historical-image' } });
  const canonicalCount = f.canonicals.length;
  const before = await Promise.all([remotePath, localPath, imagePath].map(async path => ({ path, bytes: await readFile(path), metadata: await stat(path) })));
  expect(await read(remoteInput)).toMatchObject({ status: 'completed', message: { result: { text: 'ORIGINAL_SECRET' } } });
  expect(await read(localInput)).toMatchObject({ status: 'completed', message: { result: { text: 'LOCAL_ONLY' } } });
  for (const item of before) { expect(await readFile(item.path)).toEqual(item.bytes); const after = await stat(item.path); expect([after.ino, after.mode, after.mtimeMs, after.ctimeMs]).toEqual([item.metadata.ino, item.metadata.mode, item.metadata.mtimeMs, item.metadata.ctimeMs]); }
  expect(f.frames).toEqual([]); expect(f.connections).toHaveLength(1); expect(f.canonicals).toHaveLength(canonicalCount);
});
it.each(['local', 'remote'] as const)('真实%s Session生成的hosted收据沿原FollowUps operationId读取，不创建当前Session或RPC', async mode => {
  const f = await setup(); const messages: any[] = []; const http = createServer(); const wss = new WebSocketServer({ server: http });
  wss.on('connection', socket => socket.on('message', bytes => { const message = JSON.parse(bytes.toString()); messages.push(message); if (message.id != null && message.method) socket.send(JSON.stringify({ id: message.id, result: { ok: true } })); }));
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { for (const socket of wss.clients) socket.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); await new Promise<void>(resolve => http.close(() => resolve())); });
  const context = mode === 'local' ? f.localContext : f.context;
  // 真实Session实际派发后关闭，再以原冻结身份独立读取。
  const input = f.input(context, httpSession.HOSTED_SESSION_ID); const operationId = input.requestId; const publicId = randomUUID(); expect(operationId).not.toBe(publicId);
  if (mode === 'local') {
    const sessions = new httpSession.HttpSessions({ codexHome: f.root, upstreamUrl: `ws://127.0.0.1:${(http.address() as any).port}` });
    cleanup.push(() => sessions.close());
    expect(await sessions.dispatchRpc({ sessionId: input.sessionId, requestId: operationId, attemptId: randomUUID() }, { id: operationId, method: 'turn/start', params: { threadId: 't' } })).toMatchObject({ outcome: 'response' });
    await sessions.close();
  } else {
    let sequence = 0;
    f.connections[0]!.on('message', bytes => { const frame = JSON.parse(bytes.toString()); if (frame.type === 'client_message' && frame.message?.id != null && frame.message.method) f.connections[0]!.send(JSON.stringify({ type: 'server_message', client_id: f.runtime.status().clientId, env_id: frame.env_id, stream_id: frame.stream_id, seq_id: ++sequence, message: { id: frame.message.id, result: { ok: true } } })); });
    const handle = await f.resolver.resolve(f.reference);
    const sessions = new httpSession.HttpSessions({ codexHome: f.root, upstreamUrl: 'ws://127.0.0.1:1', remote: { target: handle, resolver: f.resolver, context, storageNamespace: handle.descriptor.transportNamespace,
      projections: { changeHistory: { observe() {}, async beforeStart() {}, async cancelStart() {}, async get() { return null; }, async flush() {} }, images: { async result(value) { return value; }, async notification(value) { return value; } }, timestamps: { async result(_id, value) { return value; }, async notification(value) { return value; } }, webCitations: { async result(_id, value) { return value; }, async notification(value) { return value; } } },
      sidechatReplay: { files: { ...localMediaFiles, kind: 'remote' }, resolveReference: async () => null } } });
    cleanup.push(() => sessions.close());
    expect(await sessions.dispatchRpc({ sessionId: input.sessionId, requestId: operationId, attemptId: randomUUID() }, { id: operationId, method: 'turn/start', params: { threadId: 't' } })).toMatchObject({ outcome: 'response' }); await sessions.close(); await until(() => f.frames.some(frame => frame.type === 'client_closed'));
  }
  const count = messages.length; const frameCount = f.frames.length;
  expect(await read(input)).toMatchObject({ status: 'completed', message: { id: operationId, result: { ok: true } } });
  await expect(read({ ...input, requestId: publicId })).rejects.toMatchObject({ status: 404 });
  expect(messages).toHaveLength(count); expect(f.frames).toHaveLength(frameCount);
});
it('同代目标offline允许读本地WAL，不需要原ResolvedTarget在线也不连接上游', async () => {
  const f = await setup(); const input = f.input(); await store(input);
  f.setTargets([target(local, false), target(remote)]); await f.runtime.refreshTargets();
  await expect(f.resolver.authorizeOperationExecution(f.context)).rejects.toThrow();
  expect(await read(input)).toHaveProperty('status', 'completed'); expect(f.frames).toEqual([]); expect(f.connections).toHaveLength(1);
});
it('多代显式持久resume后只读原namespace，当前namespace为空且旧handle仍失效', async () => {
  const f = await setup(); const handle = await f.resolver.resolve(f.reference); const input = f.input(); const path = await store(input); const before = await readFile(path);
  for (let i = 0; i < 2; i++) { await f.runtime.recover(); await until(() => f.runtime.status().state === 'online'); }
  await expect(read(input)).rejects.toThrow(); await f.runtime.resume(local);
  const current = await f.resolver.operationContext(f.reference); expect(current.authorizationKey).not.toBe(f.context.authorizationKey);
  await expect(read({ ...input, context: current })).rejects.toMatchObject({ status: 404 });
  f.setTargets([target(local, false), target(remote)]); await f.runtime.refreshTargets();
  expect(await read(input)).toHaveProperty('status', 'completed'); expect(await readFile(path)).toEqual(before);
  await expect(handle.assertCurrent()).rejects.toMatchObject({ code: 'identity-changed' });
});
it.each(['unresumed', 'paused', 'reinstalled', 'missing', 'account', 'accountUser', 'user', 'user-presence', 'home', 'bad-chain'] as const)('跨代%s拒绝原正文，不借用相同businessKey或当前命名空间', async kind => {
  const f = await setup(); const input = f.input(); await store(input); const original = await f.registry.readActive();
  await f.runtime.recover(); await until(() => f.runtime.status().state === 'online');
  if (kind !== 'unresumed') await f.runtime.resume(local);
  if (kind === 'paused') { f.setKey(false); await expect(f.runtime.login()).rejects.toThrow(); expect(f.runtime.status().state).toBe('paused'); }
  if (kind === 'reinstalled') { f.setTargets([target({ ...local, installationId: 'reinstalled' })]); await f.runtime.refreshTargets(); }
  if (kind === 'missing') { f.setTargets([target(remote)]); await f.runtime.refreshTargets(); }
  if (kind === 'account') f.setManaged({ accountId: 'other' });
  if (kind === 'accountUser') f.setManaged({ accountUserId: 'other' });
  if (kind === 'user') f.setManaged({ userId: 'other' });
  if (kind === 'user-presence') f.setManaged({ userId: undefined } as any);
  if (kind === 'home' && input.context.mode === 'remote') input.context = { ...input.context, managed: { ...input.context.managed, codexHome: '/synthetic/other' } };
  if (kind === 'bad-chain') await rename(join(original!.store.directory, 'candidate.json'), join(original!.store.directory, 'candidate.kept'));
  await expect(read(input)).rejects.toThrow();
});
it.each(['pending', 'uncertain', 'completed'] as const)('单条原WAL %s语义保留，pending仅返回uncertain不改写', async status => {
  const f = await setup(); const input = f.input(); const path = await store(input, status, status === 'completed' ? { result: { ok: true } } : null); const before = await readFile(path);
  expect((await read(input)).status).toBe(status === 'pending' ? 'uncertain' : status); expect(await readFile(path)).toEqual(before);
});
it.each(['missing', 'json', 'null', 'signature', 'requestId', 'status', 'io'] as const)('原WAL %s只在真正ENOENT返回404，坏记录和实际IO保留失败', async kind => {
  const f = await setup(); const input = f.input(); const path = pathFor(input);
  if (kind !== 'missing') {
    await mkdir(dirname(path), { recursive: true });
    if (kind === 'io') await mkdir(path);
    else { const record: any = { requestId: input.requestId, signature: 'a'.repeat(64), status: 'completed' }; if (['signature', 'requestId', 'status'].includes(kind)) record[kind] = 'bad'; await writeFile(path, kind === 'json' ? '{' : kind === 'null' ? 'null' : JSON.stringify(record)); }
  }
  const result = await read(input).then(value => ({ value }), error => ({ error })); expect(result).toHaveProperty('error');
  if ('error' in result) { if (kind === 'missing') expect(result.error).toHaveProperty('status', 404); else expect(result.error.status).not.toBe(404); }
});
it.each((['completed', 'missing'] as const).flatMap(status => (['signal', 'deadline', 'parent', 'revoke'] as const).map(kind => ({ status, kind }))))('末次真实授权await期间$kind失效后不交付$status正文或伪装404', async ({ status, kind }) => {
  const f = await setup(); const input = f.input(); if (status === 'completed') await store(input); const abort = new AbortController(); input.call.signal = abort.signal; if (kind === 'deadline') input.call.deadline = performance.now() + 200;
  let valid = true; let calls = 0; let entered = false; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const original = f.resolver.authorizeOperation.bind(f.resolver);
  vi.spyOn(f.resolver, 'authorizeOperation').mockImplementation(async (...args) => { expect(args[1]).toBe('read'); expect(args[2]).toBe(abort.signal); const fence = await original(...args); if (++calls === 2) { entered = true; await gate; } return fence; });
  let delivered = false; const pending = withRemoteOperation(() => { if (!valid) throw new Error('parent-ended'); }, async () => { const value = await read(input); delivered = true; return value; });
  const outcome = pending.then(value => ({ value }), error => ({ error })); await until(() => entered);
  if (kind === 'signal') abort.abort(); if (kind === 'deadline') await new Promise(resolve => setTimeout(resolve, 220));
  if (kind === 'parent') valid = false;
  if (kind === 'revoke') { f.setManaged({ accountId: 'other' }); await f.runtime.readTargetBinding().catch(() => {}); }
  release(); const result = await outcome; expect(result).toHaveProperty('error'); if ('error' in result) expect(result.error.status).not.toBe(404); expect(delivered).toBe(false); expect(calls).toBe(2);
});
it('原deadline在最后同步ownership proof中到期也不能交付正文，不续用调用者修改的预算', async () => {
  const f = await setup(); const input = f.input(); await store(input); input.call.deadline = performance.now() + 500;
  let final = false; let calls = 0; const original = f.resolver.authorizeOperation.bind(f.resolver); const proof = PrivateStore.prototype.assertOwnership;
  vi.spyOn(f.resolver, 'authorizeOperation').mockImplementation(async (...args) => { const fence = await original(...args); if (++calls === 2) { input.call.deadline = Infinity; final = true; } return fence; });
  vi.spyOn(PrivateStore.prototype, 'assertOwnership').mockImplementation(function (this: PrivateStore) { proof.call(this); if (final) { final = false; const end = performance.now() + 550; while (performance.now() < end) { /* 真实同步FS之后耗尽原预算 */ } } });
  await expect(read(input)).rejects.toThrow(); expect(calls).toBe(2);
});
it('输入context和原Session/request/网关目录同步快照，异步修改不能换绑', async () => {
  const f = await setup(); const input = f.input(structuredClone(f.context)); await store(input); const before = JSON.stringify(f.context);
  let entered = false; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const original = f.resolver.authorizeOperation.bind(f.resolver); let calls = 0;
  vi.spyOn(f.resolver, 'authorizeOperation').mockImplementation(async (...args) => { if (++calls === 1) { entered = true; await gate; } return original(...args); });
  const pending = read(input); await until(() => entered);
  input.gatewayCodexHome += '/wrong'; input.sessionId = randomUUID(); input.requestId = randomUUID(); input.context.authorizationKey = 'wrong';
  if (input.context.mode === 'remote') { input.context.managed.accountId = 'wrong'; input.context.target.installationId = 'wrong'; input.context.generation = 'wrong'; }
  release(); expect(await pending).toMatchObject({ message: { result: { text: 'ORIGINAL_SECRET' } } }); expect(JSON.stringify(f.context)).toBe(before);
});
it.each(['sidechat', 'bad-session', 'bad-request', 'no-home'] as const)('原收据%s无耐久读取能力，禁止路径越界或隐式网关目录', async kind => {
  const f = await setup(); const input = f.input(); await store(input);
  if (kind === 'sidechat') { input.sessionId = 'c0dec000-0000-4000-8000-000000000002'; await store(input); }
  if (kind === 'bad-session') input.sessionId = '../other'; if (kind === 'bad-request') input.requestId = '../other'; if (kind === 'no-home') input.gatewayCodexHome = '';
  await expect(read(input)).rejects.toBeInstanceOf(TypeError); expect(f.frames).toEqual([]);
});

it('最后授权fence后包装Promise的微任务撤权仍不能交付正文', async () => {
  const f = await setup(); const input = f.input(); await store(input); let calls = 0; let queued = false;
  const original = f.resolver.authorizeOperation.bind(f.resolver);
  vi.spyOn(f.resolver, 'authorizeOperation').mockImplementation(async (...args) => {
    const fence = await original(...args);
    if (++calls !== 2) return fence;
    return () => { fence(); if (!queued) { queued = true; queueMicrotask(() => { (f.runtime as any).active.state.paused = true; }); } };
  });
  await expect(read(input)).rejects.toThrow(); expect(queued).toBe(true);
});
it('Remote原namespace缺失时不回退相同businessKey的Local WAL', async () => {
  const f = await setup(); const input = f.input(); await store({ ...input, context: f.localContext });
  await expect(read(input)).rejects.toMatchObject({ status: 404 });
});
it.each(['gatewayId', 'localHostId', 'businessKey', 'authorizationKey'] as const)('Local冻结原绑定%s改变即拒绝正文', async field => {
  const f = await setup(); const input = f.input(f.localContext); await store(input);
  input.context = { ...input.context, [field]: 'changed' };
  await expect(read(input)).rejects.toThrow();
});
it.each(['gateway', 'generation', 'target', 'undefined-user'] as const)('Remote原绑定%s不能被重算或忽略', async kind => {
  const f = await setup(); const input = f.input(structuredClone(f.context)); await store(input);
  if (input.context.mode !== 'remote') throw new Error('remote fixture');
  if (kind === 'gateway') input.context.gatewayId = 'changed';
  if (kind === 'generation') input.context.generation = 'changed';
  if (kind === 'target') input.context.target.installationId = 'changed';
  if (kind === 'undefined-user') input.context.managed.userId = undefined;
  await expect(read(input)).rejects.toThrow();
});
