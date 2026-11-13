// @vitest-environment node
import { EventEmitter } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { RemoteController, RemoteControllerError } from '../../server/remote/controller.js';
import { PrivateStore } from '../../server/remote/private-store.js';
import { RemoteNetworkError, deviceIdentityHash, type EnrollmentRecord, type ManagedAuth } from '../../server/remote/auth.js';
import type { ManagedAuthIdentity } from '../../server/remote/managed-auth.js';
import { RemoteAuthRequiredError } from '../../server/remote/relay.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';

const NOW = 1794530000000;
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0; });
async function until(check: () => boolean, timeout = 1500) { const start = Date.now(); while (!check()) { if (Date.now() - start > timeout) throw new Error('等待条件超时'); await new Promise(resolve => setTimeout(resolve, 3)); } }
function target(env = 'local-env', installation = 'local-install', change: Record<string, unknown> = {}) { return { env_id: env, installation_id: installation, kind: 'single', online: true, busy: false, display_name: '同名 Mac', ...change }; }
async function fixture(options: Record<string, unknown> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'remote-controller-'))); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const store = new PrivateStore(join(root, 'private'));
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const identity = { keyId: 'key', algorithm: 'ecdsa_p256_sha256' as const, protectionClass: 'hardware_secure_enclave' as const, publicKeySpkiDerBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  let auth: ManagedAuth = { accessToken: 'private-token', accountId: 'workspace', accountUserId: 'account-user', userId: 'user' };
  let enrollment: EnrollmentRecord | null = { version: 1, clientId: 'own-client', accountId: 'workspace', accountUserId: 'user', managedAccountUserId: 'account-user', identityHash: deviceIdentityHash(identity), identity };
  let home = '/synthetic/codex'; let accountType = 'chatgpt'; let status: unknown = { status: 'connected', serverName: '同名 Mac', environmentId: 'local-env', installationId: 'local-install' };
  let targets = [target(), target('remote-env', 'remote-install')]; let network = false; let reads = 0; let prepares = 0; let initializes = 0;
  let pairing: unknown = { pairingCode: 'private-pair-code', manualPairingCode: null, environmentId: 'local-env', expiresAt: NOW / 1000 + 60 };
  let pairStarts = 0; let actualKeyValid = true; let bindingChecks = 0;
  const methods: { method: string; params: unknown }[] = [];
  const canonicals: EventEmitter[] = [];
  const canonicalFactory = async () => { const value = Object.assign(new EventEmitter(), { async initialize() { initializes++; return { codexHome: home }; }, async call(method: string, params: unknown) { methods.push({ method, params }); if (network) throw new RemoteNetworkError('secret-cause'); if (method === 'account/read') return { account: accountType === 'logged-out' ? null : { type: accountType } }; if (method === 'remoteControl/status/read') return status; if (method === 'remoteControl/pairing/start') { pairStarts++; return pairing; } throw new Error('unexpected method'); }, close() { value.removeAllListeners(); } }); canonicals.push(value); return value; };
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise<void>(resolve => wss.once('listening', resolve));
  const connections: WebSocket[] = []; const frames: Record<string, any>[] = []; const seq = new Map<string, number>();
  wss.on('connection', socket => { connections.push(socket); socket.send(JSON.stringify({ type: 'device_key_challenge' })); socket.on('error', () => {}); socket.on('message', raw => { const frame = JSON.parse(raw.toString()); frames.push(frame); if (frame.type !== 'client_message' || frame.message.id === undefined) return;
    const next = (seq.get(frame.stream_id) ?? 0) + 1; seq.set(frame.stream_id, next); socket.send(JSON.stringify({ type: 'server_message', client_id: 'own-client', env_id: frame.env_id, stream_id: frame.stream_id, seq_id: next, message: { id: frame.message.id, result: frame.message.method === 'initialize' ? { codexHome: `/remote/${frame.env_id}` } : { ok: true } } })); }); });
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of wss.clients) socket.terminate(); wss.close(() => resolve()); }));
  const managedAuth = { get currentIdentity(): ManagedAuthIdentity { return { codexHome: home, accountId: auth.accountId, accountUserId: auth.accountUserId, userId: auth.userId }; }, async load() { if (network) throw new RemoteNetworkError(); return { ...auth }; }, async verifyIdentity(expected?: ManagedAuthIdentity) { reads++; if (network) throw new RemoteNetworkError(); const result = this.currentIdentity; if (expected && JSON.stringify(result) !== JSON.stringify(expected)) throw new RemoteAuthRequiredError('secret-auth'); return result; }, close() {} };
  const authProvider = { async getEnrollment() { return enrollment; }, async verifyBinding(expected?: EnrollmentRecord) { bindingChecks++; if (!actualKeyValid || !enrollment || (expected && JSON.stringify(expected) !== JSON.stringify(enrollment))) throw new RemoteAuthRequiredError('private-key-secret'); return enrollment; }, async prepareConnection() { prepares++; return { url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`, headers: {}, async signChallenge() { return { proof: true }; } }; } };
  let fetcher = async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ items: targets, cursor: null }));
  const config = { store, managedAuth, authProvider, canonicalFactory, fetch: (async (input, init) => fetcher(String(input), init)) as typeof fetch, now: () => NOW, monitorIntervalMs: 10000, operationTimeoutMs: 100, relayOptions: { reconnectMinMs: 10, reconnectMaxMs: 20, nativePingMs: 10000, streamPingMs: 10000 }, ...options };
  const controller = new RemoteController(config); cleanup.push(() => controller.close());
  return { controller, config, store, root, frames, connections, canonicals, methods, prepares: () => prepares, reads: () => reads, initializes: () => initializes, pairStarts: () => pairStarts, bindingChecks: () => bindingChecks, setActualKeyValid(value: boolean) { actualKeyValid = value; }, setPairing(value: unknown) { pairing = value; },
    setAuth(change: Partial<ManagedAuth>) { auth = { ...auth, ...change }; }, setEnrollment(change: Partial<EnrollmentRecord> | null) { enrollment = change === null ? null : { ...enrollment!, ...change }; }, setHome(value: string) { home = value; }, setMode(value: string) { accountType = value; }, setStatus(value: unknown) { status = value; }, setTargets(value: typeof targets) { targets = value; }, setNetwork(value: boolean) { network = value; }, setFetch(value: typeof fetcher) { fetcher = value; } };
}
const local = { environmentId: 'local-env', installationId: 'local-install' }; const remote = { environmentId: 'remote-env', installationId: 'remote-install' };

it('多次start与多目标raw/管理流只持有一个relay，零stream仍保持master，管理流只初始化一次', async () => {
  const f = await fixture(); await Promise.all(Array.from({ length: 6 }, () => f.controller.start())); await until(() => f.controller.state === 'online');
  await f.controller.acceptTarget(remote); const raw = f.controller.createRawStream(local); expect(f.frames.filter(frame => frame.stream_id === raw.streamId)).toHaveLength(0);
  const a = await f.controller.createManagementSession(remote); const b = await f.controller.createManagementSession(local); await a.call('model/list'); await b.call('thread/list');
  expect(f.connections).toHaveLength(1); expect(f.prepares()).toBe(1);
  const initializations = f.frames.filter(frame => frame.message?.method === 'initialize'); expect(initializations).toHaveLength(2); expect(initializations.map(frame => frame.env_id).sort()).toEqual(['local-env', 'remote-env']);
  a.close(); b.close(); await raw.close(); await new Promise(resolve => setTimeout(resolve, 25)); expect(f.controller.state).toBe('online'); expect(f.connections[0]!.readyState).toBe(1); expect(f.connections).toHaveLength(1);
  expect(f.methods.filter(call => call.method === 'account/read').every(call => JSON.stringify(call.params) === JSON.stringify({ refreshToken: false }))).toBe(true);
  expect(f.methods.every(call => ['account/read', 'remoteControl/status/read'].includes(call.method))).toBe(true);
});

it('管理会话构造配置非法也释放raw预算，下一条raw可发送且master保持在线', async () => {
  const f = await fixture({ rpcOptions: { maxPending: 0 }, relayOptions: { maxStreams: 1, nativePingMs: 10000, streamPingMs: 10000 } });
  await f.controller.start(); await until(() => f.controller.state === 'online');
  await expect(f.controller.createManagementSession(local)).rejects.toBeInstanceOf(Error);
  const raw = f.controller.createRawStream(local); await raw.send({ method: 'turn/start' }); await raw.close();
  await until(() => f.frames.filter(frame => frame.type === 'client_closed').length === 2);
  expect(f.frames.filter(frame => frame.message?.method === 'initialize')).toHaveLength(0);
  expect(f.frames.filter(frame => frame.message?.method === 'turn/start')).toHaveLength(1);
  expect(f.controller.state).toBe('online'); expect(f.connections).toHaveLength(1); expect(f.connections[0]!.readyState).toBe(1);
});

it('管理工厂清理session同步异常不跳过raw释放，也不覆盖目标错误分类', async () => {
  const f = await fixture({ relayOptions: { maxStreams: 1, nativePingMs: 10000, streamPingMs: 10000 } });
  await f.controller.start(); await until(() => f.controller.state === 'online');
  const original = RemoteRpcSession.fromRemoteStream; let session!: RemoteRpcSession;
  const factory = vi.spyOn(RemoteRpcSession, 'fromRemoteStream').mockImplementation((stream, options) => {
    session = original(stream, options); const initialize = session.initialize.bind(session);
    session.initialize = async params => { const result = await initialize(params); f.setTargets([target('local-env', 'local-install', { online: false })]); await f.controller.refreshTargets(); return result; };
    session.on('close', () => { throw new Error('listener-secret'); });
    vi.spyOn(session, 'close').mockImplementationOnce(() => { throw new Error('close-secret'); });
    return session;
  });
  try { await expect(f.controller.createManagementSession(local)).rejects.toMatchObject({ code: 'target-unavailable' }); }
  finally { factory.mockRestore(); }
  expect(session.closed).toBe(true); expect(session.eventNames()).toHaveLength(0);
  f.setTargets([target()]); await f.controller.refreshTargets(); const raw = f.controller.createRawStream(local); await raw.send({ method: 'turn/start' }); await raw.close();
  await until(() => f.frames.filter(frame => frame.type === 'client_closed').length === 2);
  expect(f.controller.state).toBe('online'); expect(f.connections).toHaveLength(1); expect(f.connections[0]!.readyState).toBe(1);
});

it('本机证明双ID严格匹配，同名不同installation不伪装为已配对；状态可区分', async () => {
  const f = await fixture(); f.setTargets([target('local-env', 'other-install')]); await f.controller.start(); expect(f.controller.state).toBe('pairing-required'); expect(f.prepares()).toBe(0);
  expect(() => f.controller.createRawStream(local)).toThrow(RemoteControllerError); expect(await f.store.readJson('controller-binding.json')).toBeNull();
  const g = await fixture(); g.setStatus({ status: 'disabled', environmentId: null, installationId: 'local-install' }); await g.controller.start(); expect(g.controller.state).toBe('remote-disabled');
  const h = await fixture(); h.setEnrollment(null); await h.controller.start(); expect(h.controller.state).toBe('auth-required'); expect(h.controller.pauseReason).toBe('enrollment-required');
});

it('持久化完整无token绑定，重启核验原canonicalHome、账号、登记与本机双ID', async () => {
  const f = await fixture(); await f.controller.start(); await until(() => f.controller.state === 'online'); await f.controller.acceptTarget(remote);
  const record = await f.store.readJson('controller-binding.json'); expect(record).toMatchObject({ version: 1, managed: { codexHome: '/synthetic/codex', accountId: 'workspace', accountUserId: 'account-user', userId: 'user' }, local, targets: [local, remote] });
  expect(JSON.stringify(record)).not.toMatch(/private-token|accessToken|refresh/); await f.controller.close();
  const restarted = new RemoteController(f.config); cleanup.push(() => restarted.close()); await restarted.start(); await until(() => restarted.state === 'online'); expect(restarted.binding).toEqual(record);
});

it.each(['account', 'workspace', 'home', 'client', 'key', 'revoked', 'mode', 'logged-out', 'local-install'] as const)('在线%s变化主动暂停并关闭Remote，显式resume只允许原身份', async change => {
  const f = await fixture({ monitorIntervalMs: 15 }); await f.controller.start(); await until(() => f.controller.state === 'online'); const old = f.controller.binding;
  const restore = async () => {
    if (change === 'account') f.setAuth({ accountUserId: 'account-user' });
    if (change === 'workspace') f.setAuth({ accountId: 'workspace' });
    if (change === 'home') f.setHome('/synthetic/codex');
    if (change === 'client') f.setEnrollment({ clientId: 'own-client' });
    if (change === 'key') { const previous = (old as any).enrollment; f.setEnrollment({ identityHash: previous.identityHash }); }
    if (change === 'revoked') { /* 该场景只验证拒绝，完整登记恢复由独立resume测试覆盖。 */ return; }
    if (change === 'mode' || change === 'logged-out') f.setMode('chatgpt');
    if (change === 'local-install') f.setStatus({ status: 'connected', environmentId: 'local-env', installationId: 'local-install' });
  };
  if (change === 'account') f.setAuth({ accountUserId: 'changed' });
  if (change === 'workspace') f.setAuth({ accountId: 'changed' });
  if (change === 'home') f.setHome('/synthetic/other');
  if (change === 'client') f.setEnrollment({ clientId: 'replacement' });
  if (change === 'key') f.setEnrollment({ identityHash: 'replacement' });
  if (change === 'revoked') f.setEnrollment(null);
  if (change === 'mode') f.setMode('apiKey');
  if (change === 'logged-out') f.setMode('logged-out');
  if (change === 'local-install') f.setStatus({ status: 'connected', environmentId: 'local-env', installationId: 'replacement' });
  await until(() => f.controller.state === 'auth-required' || f.controller.state === 'paused'); expect(() => f.controller.createRawStream(local)).toThrow();
  await until(() => f.connections[0]!.readyState === 3); expect(f.controller.binding).toEqual(old); expect(await f.store.readJson('controller-binding.json')).toEqual(old);
  await f.controller.start(); expect(f.connections).toHaveLength(1); await f.controller.resume(); expect(f.connections).toHaveLength(1);
  await restore(); if (change !== 'revoked') { await f.controller.resume(); await until(() => f.controller.state === 'online'); expect(f.connections).toHaveLength(2); }
});

it('普通监控网络故障保留原绑定自动恢复；目录遗漏/重装不清除已接受目标，原tuple回来即可恢复', async () => {
  const f = await fixture({ monitorIntervalMs: 15 }); await f.controller.start(); await until(() => f.controller.state === 'online'); await f.controller.acceptTarget(remote); const old = f.controller.binding;
  f.setNetwork(true); await until(() => f.controller.state === 'offline'); expect(f.controller.binding).toEqual(old); f.setNetwork(false); await until(() => f.controller.state === 'online'); expect(f.prepares()).toBe(1);
  f.setTargets([target()]); await f.controller.refreshTargets(); expect(() => f.controller.createRawStream(remote)).toThrow(); expect(f.controller.binding).toEqual(old);
  f.setTargets([target(), target('remote-env', 'replacement')]); await f.controller.refreshTargets(); expect(() => f.controller.createRawStream(remote)).toThrow(); await expect(f.controller.acceptTarget({ ...remote, installationId: 'replacement' })).rejects.toThrow(); expect(f.controller.binding).toEqual(old);
  f.setTargets([target(), target('remote-env', 'remote-install', { online: false })]); await f.controller.refreshTargets(); expect(() => f.controller.createRawStream(remote)).toThrow();
  f.setTargets([target(), target('remote-env', 'remote-install')]); await f.controller.refreshTargets(); const raw = f.controller.createRawStream(remote); await raw.close();
});

it('account/updated同模式也重查身份，status/changed触发本机证明复核；close清理监听器与监控', async () => {
  const f = await fixture({ monitorIntervalMs: 10000 }); await f.controller.start(); await until(() => f.controller.state === 'online'); const before = f.reads();
  f.setAuth({ accountId: 'other' }); f.canonicals[0]!.emit('notification', { method: 'account/updated', params: { authMode: 'chatgpt' } }); await until(() => f.controller.state === 'auth-required'); expect(f.reads()).toBeGreaterThan(before);
  const g = await fixture({ monitorIntervalMs: 15 }); await g.controller.start(); await until(() => g.controller.state === 'online'); await g.controller.close(); const count = g.reads(); await new Promise(resolve => setTimeout(resolve, 35)); expect(g.reads()).toBe(count); expect(g.canonicals[0]!.listenerCount('notification')).toBe(0); expect(g.controller.state).toBe('closed');
});

it('损坏持久绑定不覆盖、不连接，不把非法内容或token暴露给错误', async () => {
  const f = await fixture(); await f.store.writeJson('controller-binding.json', { version: 1, managed: { accessToken: 'secret' } }); await f.controller.start(); expect(f.controller.state).toBe('paused'); expect(f.controller.pauseReason).toBe('binding-invalid'); expect(f.connections).toHaveLength(0); expect(await readFile(join(f.store.directory, 'controller-binding.json'), 'utf8')).toContain('secret');
});

it('主动检测身份变化的显式恢复要求跨重启保留，恢复原账号后仍须Mac resume', async () => {
  const f = await fixture({ monitorIntervalMs: 15 }); await f.controller.start(); await until(() => f.controller.state === 'online');
  f.setAuth({ accountId: 'replacement' }); await until(() => f.controller.state === 'auth-required'); await f.controller.close(); f.setAuth({ accountId: 'workspace' });
  const restarted = new RemoteController(f.config); cleanup.push(() => restarted.close()); await restarted.start(); expect(restarted.state).toBe('paused'); expect(f.connections).toHaveLength(1);
  await restarted.resume(); await until(() => restarted.state === 'online'); expect(f.connections).toHaveLength(2);
});


it('canonical只初始化一次，未start的目录/配对检查不建立官方物理连接', async () => {
  const f = await fixture(); await f.controller.refreshTargets(); await f.controller.refreshTargets(); expect(f.initializes()).toBe(1); expect(f.connections).toHaveLength(0); expect(f.prepares()).toBe(0);
});

it('本机pair严格使用canonical非manual码，秒级期限和环境核验后claim，双ID入目录才持久化', async () => {
  const f = await fixture(); f.setTargets([]); await f.controller.refreshTargets().catch(() => undefined); expect(f.controller.state).toBe('pairing-required');
  f.setFetch(async (url, init) => {
    if (url.endsWith('/client/pair')) { expect(JSON.parse(init!.body as string)).toEqual({ client_id: 'own-client', pairing_code: 'private-pair-code' }); f.setTargets([target()]); return new Response(JSON.stringify({ client_id: 'own-client', pairing_code: 'private-pair-code', server_id: 'server', environment_id: 'local-env', claimed_at: '2026-11-13T00:00:00Z' })); }
    return new Response(JSON.stringify({ items: [target()], cursor: null }));
  });
  await f.controller.pairLocal(); expect(f.controller.binding?.local).toEqual(local); expect(f.connections).toHaveLength(0); expect(f.methods.find(call => call.method === 'remoteControl/pairing/start')?.params).toEqual({ manualCode: false }); expect(JSON.stringify(f.controller.binding)).not.toContain('private-pair-code');
});

it.each(['expired', 'environment', 'installation'] as const)('本机pair的%s不符不持久化或伪造ready', async failure => {
  const f = await fixture(); f.setTargets([]); let claims = 0;
  f.setPairing({ pairingCode: 'private-pair-code', manualPairingCode: null, environmentId: failure === 'environment' ? 'other' : 'local-env', expiresAt: NOW / 1000 + (failure === 'expired' ? -1 : 60) });
  f.setFetch(async url => { if (url.endsWith('/client/pair')) { claims++; return new Response(JSON.stringify({ client_id: 'own-client', pairing_code: 'private-pair-code', server_id: 'server', environment_id: 'local-env', claimed_at: '2026-11-13T00:00:00Z' })); } return new Response(JSON.stringify({ items: [target('local-env', 'replacement')], cursor: null })); });
  await expect(f.controller.pairLocal()).rejects.toBeInstanceOf(RemoteControllerError); expect(await f.store.readJson('controller-binding.json')).toBeNull(); expect(f.connections).toHaveLength(0); if (failure !== 'installation') expect(claims).toBe(0);
});

it('manual code显式配对双ID目标，不按同名覆盖已接受installation，也不开额外Relay', async () => {
  const f = await fixture(); await f.controller.start(); await until(() => f.controller.state === 'online');
  f.setFetch(async url => new Response(JSON.stringify(url.endsWith('/client/pair') ? { client_id: 'own-client', pairing_code: 'manual-secret', server_id: 'server', environment_id: 'remote-env', claimed_at: '2026-11-13T00:00:00Z' } : { items: [target(), target('remote-env', 'remote-install')], cursor: null })));
  await f.controller.pairManual('manual-secret', remote); expect(f.controller.binding?.targets).toContainEqual(remote); expect(f.connections).toHaveLength(1); expect(f.pairStarts()).toBe(0);
  await expect(f.controller.pairManual('manual-secret', { ...remote, installationId: 'replacement' })).rejects.toBeInstanceOf(RemoteControllerError); expect(f.controller.binding?.targets).toContainEqual(remote);
});

it('canonical connecting临时离线保留身份并自动恢复，disabled须显式恢复', async () => {
  const f = await fixture({ monitorIntervalMs: 15 }); await f.controller.start(); await until(() => f.controller.state === 'online'); const previous = f.controller.binding;
  f.setStatus({ status: 'connecting', environmentId: null, installationId: 'local-install' }); await until(() => f.controller.state === 'offline'); expect(f.controller.binding).toEqual(previous);
  f.setStatus({ status: 'connected', environmentId: 'local-env', installationId: 'local-install' }); await until(() => f.controller.state === 'online'); expect(f.connections).toHaveLength(1);
  f.setStatus({ status: 'disabled', environmentId: null, installationId: 'local-install' }); f.canonicals.at(-1)!.emit('notification', { method: 'remoteControl/status/changed', params: {} }); await until(() => f.controller.state === 'remote-disabled');
  f.setStatus({ status: 'connected', environmentId: 'local-env', installationId: 'local-install' }); await new Promise(resolve => setTimeout(resolve, 35)); expect(f.controller.state).toBe('remote-disabled'); await f.controller.resume(); await until(() => f.controller.state === 'online');
});

it('close取消挂起的REST，晚目录不写新绑定、不发布targets或建relay', async () => {
  const f = await fixture(); let finish!: (value: Response) => void; let entered!: () => void; const wait = new Promise<void>(resolve => { entered = resolve; }); let targetEvents = 0; f.controller.on('targets', () => { targetEvents++; });
  f.setFetch(async () => { entered(); return new Promise(resolve => { finish = resolve; }); }); const pending = f.controller.start(); await wait; await f.controller.close(); finish(new Response(JSON.stringify({ items: [target()], cursor: null }))); await pending; await new Promise(resolve => setTimeout(resolve, 10)); expect(f.controller.state).toBe('closed'); expect(targetEvents).toBe(0); expect(await f.store.readJson('controller-binding.json')).toBeNull(); expect(f.connections).toHaveLength(0);
});

it('物理离线时管理流工厂拒绝，不创建随后误认为initialized的session', async () => {
  const f = await fixture(); await f.controller.start(); await until(() => f.controller.state === 'online'); f.connections[0]!.terminate(); await until(() => f.controller.state === 'offline'); const count = f.frames.filter(frame => frame.message?.method === 'initialize').length;
  await expect(f.controller.createManagementSession(local)).rejects.toBeInstanceOf(RemoteControllerError); expect(f.frames.filter(frame => frame.message?.method === 'initialize')).toHaveLength(count); await until(() => f.controller.state === 'online'); const session = await f.controller.createManagementSession(local); expect(session.ready).toBe(true); session.close();
});

it('目录观察到目标重装立即终止旧tuple已有流，保留旧绑定且不向新installation重放', async () => {
  const f = await fixture(); await f.controller.start(); await until(() => f.controller.state === 'online'); await f.controller.acceptTarget(remote); const raw = f.controller.createRawStream(remote);
  f.setTargets([target(), target('remote-env', 'replacement')]); await f.controller.refreshTargets(); expect(raw.closed).toBe(true); expect(f.controller.binding?.targets).toContainEqual(remote); await expect(raw.send({ method: 'turn/start' })).rejects.toMatchObject({ mayHaveBeenSent: false });
});

it('REST等待期间本机installation变化，首次绑定不能采用过时canonical证明', async () => {
  const f = await fixture(); f.setFetch(async () => { f.setStatus({ status: 'connected', environmentId: 'local-env', installationId: 'replacement' }); return new Response(JSON.stringify({ items: [target()], cursor: null })); });
  await f.controller.start(); expect(f.controller.state).toBe('paused'); expect(await f.store.readJson('controller-binding.json')).toBeNull(); expect(f.connections).toHaveLength(0);
});

it('显式accept期间发现账号变化立即暂停现有Relay并保存暂停，不等待下一周期', async () => {
  const f = await fixture(); await f.controller.start(); await until(() => f.controller.state === 'online'); f.setAuth({ accountId: 'replacement' });
  await expect(f.controller.acceptTarget(remote)).rejects.toBeInstanceOf(RemoteControllerError); expect(f.controller.state).toBe('auth-required'); await until(() => f.connections[0]!.readyState === 3);
});

it('未start的并发目录检查单飞canonical证明和HTTP，不新建多条本地管理连接', async () => {
  let attempts = 0; let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
  const f = await fixture({ canonicalFactory: async () => { attempts++; await gate; return { async initialize() { return { codexHome: '/synthetic/codex' }; }, async call(method: string) { return method === 'account/read' ? { account: { type: 'chatgpt' } } : { status: 'connected', environmentId: 'local-env', installationId: 'local-install' }; }, close() {} }; } });
  const pending = Promise.allSettled(Array.from({ length: 16 }, () => f.controller.refreshTargets())); await until(() => attempts > 0); await new Promise(resolve => setTimeout(resolve, 20)); const observed = attempts; finish(); await pending; expect(observed).toBe(1); expect(f.connections).toHaveLength(0);
});

it('close后晚到canonical工厂结果立即关闭，不初始化、不写盘或连接Remote', async () => {
  let finish!: (value: any) => void; let entered!: () => void; const wait = new Promise<void>(resolve => { entered = resolve; }); let closed = 0; let initialized = 0;
  const f = await fixture({ canonicalFactory: async () => { entered(); return new Promise(resolve => { finish = resolve; }); } }); const pending = f.controller.start(); await wait; await f.controller.close();
  finish({ async initialize() { initialized++; return { codexHome: '/synthetic/codex' }; }, async call() {}, close() { closed++; } }); await pending; await new Promise(resolve => setTimeout(resolve, 5)); expect(closed).toBe(1); expect(initialized).toBe(0); expect(f.connections).toHaveLength(0); expect(await f.store.readJson('controller-binding.json')).toBeNull();
});


it('活动连接实际key失效即主动暂停，即使登记快照完全未改；无新Remote prepare或登记', async () => {
  const f = await fixture({ monitorIntervalMs: 15 }); await f.controller.start(); await until(() => f.controller.state === 'online'); const old = f.controller.binding; const checks = f.bindingChecks(); f.setActualKeyValid(false);
  await until(() => f.controller.state === 'auth-required'); expect(f.bindingChecks()).toBeGreaterThan(checks); expect(f.controller.binding).toEqual(old); expect(f.prepares()).toBe(1); await until(() => f.connections[0]!.readyState === 3);
});

it('两个实例首次绑定竞争不同本机proof时CAS拒绝覆盖先完成的完整绑定', async () => {
  const f = await fixture(); let finish!: () => void; let entered!: () => void; const wait = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { finish = resolve; }); let held = false;
  const write = f.store.writeJson.bind(f.store); f.store.writeJson = async (name, value) => { if (name === 'controller-binding.json' && !held) { held = true; entered(); await gate; } await write(name, value); };
  const first = f.controller.refreshTargets(); await wait;
  const second = new RemoteController({ ...f.config, canonicalFactory: async () => ({ async initialize() { return { codexHome: '/synthetic/codex' }; }, async call(method: string) { return method === 'account/read' ? { account: { type: 'chatgpt' } } : { status: 'connected', environmentId: 'remote-env', installationId: 'remote-install' }; }, close() {} }) }); cleanup.push(() => second.close());
  const competing = second.refreshTargets().catch(error => error); await new Promise(resolve => setTimeout(resolve, 15)); finish(); await first; expect(await competing).toBeInstanceOf(RemoteControllerError); expect((await f.store.readJson('controller-binding.json') as any).local).toEqual(local); expect(f.connections).toHaveLength(0);
});

it('跨实例并发accept以CAS显式冲突，不丢已成功接受tuple或覆盖原proof', async () => {
  const f = await fixture(); const other = { environmentId: 'third-env', installationId: 'third-install' }; f.setTargets([target(), target('remote-env', 'remote-install'), target('third-env', 'third-install')]); await f.controller.refreshTargets();
  const second = new RemoteController(f.config); cleanup.push(() => second.close()); await second.refreshTargets();
  let finish!: () => void; let entered!: () => void; const wait = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { finish = resolve; }); let held = false;
  const write = f.store.writeJson.bind(f.store); f.store.writeJson = async (name, value) => { if (name === 'controller-binding.json' && !held) { held = true; entered(); await gate; } await write(name, value); };
  const pending = Promise.allSettled([f.controller.acceptTarget(remote), second.acceptTarget(other)]); await wait; finish(); const results = await pending; expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const record = await f.store.readJson('controller-binding.json') as any; expect(record.local).toEqual(local); expect(record.targets).toContainEqual(results[0]!.status === 'fulfilled' ? remote : other); expect(record.targets).toHaveLength(2);
});

it('外部状态监听器抛错不阻碍认证暂停与close资源清理', async () => {
  const f = await fixture(); f.controller.on('state', () => { throw new Error('observer-secret'); }); await f.controller.start(); await until(() => f.controller.state === 'online'); await expect(f.controller.close()).resolves.toBeUndefined(); expect(f.controller.state).toBe('closed'); await until(() => f.connections[0]!.readyState === 3);
});

it('显式目标写盘期间同模式account更新不会被mutating吞掉，完成后立即重核验', async () => {
  const f = await fixture({ monitorIntervalMs: 10000 }); await f.controller.start(); await until(() => f.controller.state === 'online');
  let finish!: () => void; let entered!: () => void; const wait = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { finish = resolve; }); const write = f.store.writeJson.bind(f.store);
  f.store.writeJson = async (name, value) => { if (name === 'controller-binding.json') { entered(); await gate; } await write(name, value); };
  const accepting = f.controller.acceptTarget(remote); await wait; f.setAuth({ accountId: 'replacement' }); f.canonicals[0]!.emit('notification', { method: 'account/updated', params: { authMode: 'chatgpt' } }); finish(); await accepting; await until(() => f.controller.state === 'auth-required');
});

it('流工厂只读取一次目标快照，getter变化不能绕过完整tuple核验而路由另一host', async () => {
  const f = await fixture(); await f.controller.start(); await until(() => f.controller.state === 'online'); let reads = 0;
  const input = Object.defineProperty({ installationId: 'local-install' }, 'environmentId', { enumerable: true, get() { reads++; return reads === 1 ? 'local-env' : 'remote-env'; } }) as typeof local;
  const stream = f.controller.createRawStream(input); expect(stream.environmentId).toBe('local-env'); expect(reads).toBe(1); await stream.close();
});

it('真实WS unknown pong立即终止raw流，移除监听器且后续业务绝不发出或重放', async () => {
  const f = await fixture(); await f.controller.start(); await until(() => f.controller.state === 'online'); const raw = f.controller.createRawStream(local);
  const pong = new Promise<void>(resolve => raw.once('pong', () => resolve()));
  f.connections[0]!.send(JSON.stringify({ type: 'pong', client_id: 'own-client', env_id: local.environmentId, stream_id: raw.streamId, seq_id: 0, status: 'unknown' })); await pong;
  expect(raw.closed).toBe(true); expect(raw.eventNames()).toEqual([]); await expect(raw.send({ method: 'turn/start' })).rejects.toMatchObject({ mayHaveBeenSent: false });
  await new Promise(resolve => setTimeout(resolve, 15)); expect(f.frames.filter(frame => frame.stream_id === raw.streamId && frame.type === 'client_message')).toEqual([]); expect(f.controller.state).toBe('online'); expect(f.connections).toHaveLength(1);
});

it('真实WS active pong与物理网络断线恢复保留raw流，不自动重发已发送业务', async () => {
  const f = await fixture(); await f.controller.start(); await until(() => f.controller.state === 'online'); const raw = f.controller.createRawStream(local);
  const pong = new Promise<void>(resolve => raw.once('pong', () => resolve())); f.connections[0]!.send(JSON.stringify({ type: 'pong', client_id: 'own-client', env_id: local.environmentId, stream_id: raw.streamId, seq_id: 1, status: 'active' })); await pong; expect(raw.closed).toBe(false);
  await raw.send({ method: 'turn/start', params: { marker: 'before-disconnect' } }); await until(() => f.frames.some(frame => frame.stream_id === raw.streamId && frame.message?.method === 'turn/start'));
  f.connections[0]!.terminate(); await until(() => f.controller.state === 'offline'); expect(raw.closed).toBe(false); await until(() => f.controller.state === 'online');
  await raw.send({ method: 'thread/read' }); await until(() => f.frames.some(frame => frame.stream_id === raw.streamId && frame.message?.method === 'thread/read'));
  expect(raw.closed).toBe(false); expect(f.frames.filter(frame => frame.stream_id === raw.streamId && frame.message?.method === 'turn/start')).toHaveLength(1); expect(f.connections).toHaveLength(2); await raw.close();
});

it.each(['local', 'manual'] as const)('%s配对刷新全目录后立即终止所有旧安装raw和管理流，close监听器异常不影响目录发布', async operation => {
  const f = await fixture(); await f.controller.start(); await until(() => f.controller.state === 'online'); await f.controller.acceptTarget(remote);
  const first = f.controller.createRawStream(remote); const second = f.controller.createRawStream(remote); const management = await f.controller.createManagementSession(remote); const old = f.controller.binding;
  first.on('close', () => { throw new Error('close-observer-secret'); });
  const third = { environmentId: 'third-env', installationId: 'third-install' }; const pairCode = operation === 'local' ? 'private-pair-code' : 'manual-secret'; const paired = operation === 'local' ? local : third;
  const observed: boolean[][] = []; f.controller.on('targets', () => observed.push([first.closed, second.closed, management.closed]));
  f.setFetch(async url => new Response(JSON.stringify(url.endsWith('/client/pair') ? { client_id: 'own-client', pairing_code: pairCode, server_id: 'server', environment_id: paired.environmentId, claimed_at: '2026-11-13T00:00:00Z' } : { items: [target(), target('remote-env', 'replacement'), target(third.environmentId, third.installationId)], cursor: null })));
  if (operation === 'local') await f.controller.pairLocal(); else await f.controller.pairManual(pairCode, third);
  expect([first.closed, second.closed, management.closed]).toEqual([true, true, true]); expect(observed).toEqual([[true, true, true]]); expect(f.controller.targets).toContainEqual(target('remote-env', 'replacement')); expect(f.controller.binding?.targets).toContainEqual(remote); expect(f.controller.binding?.local).toEqual(old!.local);
  await expect(first.send({ method: 'turn/start' })).rejects.toMatchObject({ mayHaveBeenSent: false }); await expect(second.send({ method: 'turn/start' })).rejects.toMatchObject({ mayHaveBeenSent: false }); await expect(management.call('turn/start')).rejects.toMatchObject({ mayHaveBeenSent: false });
  expect(f.connections).toHaveLength(1); expect(f.controller.state).toBe('online');
});

it('目录检查关闭首条旧安装流时同步监听器抛错，仍关闭其余raw和管理流并公布完整目录', async () => {
  const f = await fixture(); await f.controller.start(); await until(() => f.controller.state === 'online'); await f.controller.acceptTarget(remote);
  const first = f.controller.createRawStream(remote); const second = f.controller.createRawStream(remote); const management = await f.controller.createManagementSession(remote); first.on('close', () => { throw new Error('close-observer-secret'); });
  let published = 0; f.controller.on('targets', () => { published++; }); f.setTargets([target(), target('remote-env', 'replacement')]); const result = await f.controller.refreshTargets().catch(error => error);
  expect([first.closed, second.closed, management.closed]).toEqual([true, true, true]); expect(result).toEqual([target(), target('remote-env', 'replacement')]); expect(published).toBe(1); expect(f.controller.state).toBe('online');
  await expect(second.send({ method: 'turn/start' })).rejects.toMatchObject({ mayHaveBeenSent: false }); await expect(management.call('turn/start')).rejects.toMatchObject({ mayHaveBeenSent: false });
});

it.each(['local', 'manual'] as const)('%s配对目录已证明目标替换时，在后续异步本机复核前就终止旧流', async operation => {
  const f = await fixture(); await f.controller.start(); await until(() => f.controller.state === 'online'); await f.controller.acceptTarget(remote); const raw = f.controller.createRawStream(remote);
  const third = { environmentId: 'third-env', installationId: 'third-install' }; let claimed = false; let held = false; let finish!: () => void; let entered!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; }); const wait = new Promise<void>(resolve => { entered = resolve; }); const verify = f.config.managedAuth.verifyIdentity.bind(f.config.managedAuth);
  f.config.managedAuth.verifyIdentity = async expected => { if (claimed && !held) { held = true; entered(); await gate; } return verify(expected); };
  const code = operation === 'local' ? 'private-pair-code' : 'manual-secret'; const paired = operation === 'local' ? local : third;
  f.setFetch(async url => { if (url.endsWith('/client/pair')) { claimed = true; return new Response(JSON.stringify({ client_id: 'own-client', pairing_code: code, server_id: 'server', environment_id: paired.environmentId, claimed_at: '2026-11-13T00:00:00Z' })); } return new Response(JSON.stringify({ items: [target(), target('remote-env', 'replacement'), target(third.environmentId, third.installationId)], cursor: null })); });
  const pairing = operation === 'local' ? f.controller.pairLocal() : f.controller.pairManual(code, third); await wait; const observedClosed = raw.closed; finish(); await pairing; expect(observedClosed).toBe(true);
});

it('目录单纯缺项保留原tuple绑定与已有流历史，不误当作已证明重装', async () => {
  const f = await fixture(); await f.controller.start(); await until(() => f.controller.state === 'online'); await f.controller.acceptTarget(remote); const raw = f.controller.createRawStream(remote); const management = await f.controller.createManagementSession(remote); const before = f.controller.binding;
  f.setTargets([target()]); await f.controller.refreshTargets(); expect(raw.closed).toBe(false); expect(management.closed).toBe(false); expect(f.controller.binding).toEqual(before); expect(f.controller.targetStatus(remote).executable).toBe(false);
  f.setTargets([target(), target('remote-env', 'remote-install')]); await f.controller.refreshTargets(); expect(f.controller.targetStatus(remote).executable).toBe(true); expect(raw.closed).toBe(false); expect((await management.call('model/list'))).toEqual({ ok: true }); await raw.close(); management.close();
});
