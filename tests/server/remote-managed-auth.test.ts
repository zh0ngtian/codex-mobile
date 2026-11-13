// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteAuthRequiredError } from '../../server/remote/relay.js';
import { RemoteNetworkError } from '../../server/remote/auth.js';
import { ManagedAuthLoader, readManagedAuthFile } from '../../server/remote/managed-auth.js';

const NOW = 1794530000000; const AUTH = 'https://api.openai.com/auth';
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0; });
function token(change: Record<string, unknown> = {}, identity: Record<string, unknown> = {}) {
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp: NOW / 1000 + 3600, [AUTH]: { chatgpt_account_id: 'workspace', chatgpt_account_user_id: 'account-user', user_id: 'user', ...identity }, ...change })).toString('base64url')}.c2ln`;
}
function auth(accessToken = token(), accountId = 'workspace') { return { auth_mode: 'chatgpt', OPENAI_API_KEY: 'historic-key-never-consumed', tokens: { access_token: accessToken, account_id: accountId, refresh_token: 'canonical-only-refresh' } }; }
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'remote-managed-auth-'))); await chmod(home, 0o700); cleanup.push(() => rm(home, { recursive: true, force: true }));
  const path = join(home, 'auth.json'); await writeFile(path, JSON.stringify(auth()), { mode: 0o600 });
  let now = NOW; let factoryCalls = 0; let initializes = 0; const calls: unknown[] = [];
  let onRead = async () => ({ account: { type: 'chatgpt', email: null, planType: 'pro' }, requiresOpenaiAuth: true });
  const canonical = { async initialize() { initializes++; return { codexHome: home, actualMetadata: true }; }, async call(method: string, params: unknown) { calls.push({ method, params }); return onRead(); }, close() {} };
  const options = { canonicalFactory: async () => { factoryCalls++; return canonical; }, now: () => now, operationTimeoutMs: 100 };
  const loader = new ManagedAuthLoader(options); cleanup.push(() => loader.close());
  return { home, path, loader, options, canonical, calls, factoryCalls: () => factoryCalls, initializes: () => initializes,
    setRead(fn: typeof onRead) { onRead = fn; }, setNow(value: number) { now = value; }, async write(value: unknown) { await writeFile(path, JSON.stringify(value), { mode: 0o600 }); },
    async replace(value: unknown) { const next = join(home, 'auth.next'); await writeFile(next, JSON.stringify(value), { mode: 0o600 }); await rename(next, path); } };
}

it('首次singleflight只让显式canonical刷新一次并使用其codexHome最新tokens，不消费refresh_token或历史API key', async () => {
  const f = await fixture(); const refreshed = token({ exp: NOW / 1000 + 7200 });
  f.setRead(async () => { await f.replace(auth(refreshed)); return { account: { type: 'chatgpt', email: null, planType: 'pro' }, requiresOpenaiAuth: true }; });
  const results = await Promise.all(Array.from({ length: 8 }, () => f.loader.load()));
  expect(results).toEqual(Array.from({ length: 8 }, () => ({ accessToken: refreshed, accountId: 'workspace', accountUserId: 'account-user', userId: 'user' })));
  expect(f.calls).toEqual([{ method: 'account/read', params: { refreshToken: true } }]); expect(f.factoryCalls()).toBe(1); expect(f.initializes()).toBe(1);
  expect(f.loader.currentIdentity).toEqual({ codexHome: f.home, accountId: 'workspace', accountUserId: 'account-user', userId: 'user' });
  expect(JSON.stringify(f.loader.currentIdentity)).not.toContain('accessToken'); expect(await readFile(f.path, 'utf8')).toContain(refreshed);
  await f.loader.load(); await f.loader.verifyIdentity(); expect(f.calls).toHaveLength(1);
});

it('每次load读最新本地文件：未过期也立即拒绝账号/workspace/user变化，verifyIdentity无需网络refresh', async () => {
  const f = await fixture(); await f.loader.load();
  for (const change of [{ chatgpt_account_id: 'other' }, { chatgpt_account_user_id: 'other' }, { user_id: 'other' }]) {
    await f.replace(auth(token({}, change), change.chatgpt_account_id ?? 'workspace'));
    await expect(f.loader.load()).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    await expect(f.loader.verifyIdentity()).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.calls).toHaveLength(1);
  }
});

it('access临期才singleflight canonical refresh，首次refresh后缺失/无效/已过期exp拒绝', async () => {
  const f = await fixture(); await f.loader.load(); f.setNow(NOW + 3571000);
  f.setRead(async () => { await f.replace(auth(token({ exp: NOW / 1000 + 7200 }))); return { account: { type: 'chatgpt', email: null, planType: 'pro' }, requiresOpenaiAuth: true }; });
  await Promise.all(Array.from({ length: 8 }, () => f.loader.load())); expect(f.calls).toHaveLength(2);
  for (const exp of [undefined, null, 'future', NOW / 1000, -1, Number.MAX_SAFE_INTEGER, NOW / 1000 + 1.5]) {
    const g = await fixture(); await g.write(auth(token({ exp })));
    await expect(g.loader.load()).rejects.toBeInstanceOf(RemoteAuthRequiredError); expect(g.calls).toHaveLength(1);
  }
});

it('等待canonical refresh期间切换绑定必须拒绝且不自动采用新账号', async () => {
  const f = await fixture();
  f.setRead(async () => { await f.replace(auth(token({}, { chatgpt_account_id: 'new-workspace' }), 'new-workspace')); return { account: { type: 'chatgpt', email: null, planType: 'pro' }, requiresOpenaiAuth: true }; });
  await expect(f.loader.load()).rejects.toBeInstanceOf(RemoteAuthRequiredError);
  await expect(f.loader.load()).rejects.toBeInstanceOf(RemoteAuthRequiredError); expect(f.calls).toHaveLength(1);
});

it('非ChatGPT canonical账号、缺失codexHome和不安全auth文件均auth-required，没有其他实例或凭据fallback', async () => {
  for (const account of [null, { type: 'apiKey' }, { type: 'chatgptAuthTokens' }]) {
    const f = await fixture(); f.setRead(async () => ({ account, requiresOpenaiAuth: true }) as never);
    await expect(f.loader.load()).rejects.toBeInstanceOf(RemoteAuthRequiredError);
  }
  const invalid = new ManagedAuthLoader({ canonicalFactory: async () => ({ async initialize() { return {}; }, async call() { throw new Error('must not call'); } }) });
  await expect(invalid.load()).rejects.toBeInstanceOf(RemoteAuthRequiredError); invalid.close();
  for (const mutation of ['missing', 'permissions', 'symlink', 'directory', 'oversized', 'malformed'] as const) {
    const f = await fixture();
    if (mutation === 'missing') await rm(f.path);
    if (mutation === 'permissions') await chmod(f.path, 0o644);
    if (mutation === 'symlink') { await rename(f.path, join(f.home, 'other.json')); await symlink(join(f.home, 'other.json'), f.path); }
    if (mutation === 'directory') { await rm(f.path); await symlink(f.home, f.path); }
    if (mutation === 'oversized') await writeFile(f.path, 'x'.repeat(262145));
    if (mutation === 'malformed') await writeFile(f.path, 'invalid');
    await expect(f.loader.load()).rejects.toBeInstanceOf(RemoteAuthRequiredError); expect(f.calls).toHaveLength(0);
  }
});

it('外部canonical/factory/文件loader即使抛已知类型错误也固定脱敏并保持network/auth分类', async () => {
  for (const ErrorType of [RemoteNetworkError, RemoteAuthRequiredError]) {
    for (const source of ['factory', 'initialize', 'call', 'file'] as const) {
      const f = await fixture(); const fail = () => { throw new ErrorType('Bearer synthetic-secret https://private.invalid/auth'); };
      const loader = new ManagedAuthLoader({ ...f.options,
        canonicalFactory: async () => source === 'factory' ? fail() : { ...f.canonical, initialize: async () => source === 'initialize' ? fail() : f.canonical.initialize(), call: async (method, params) => source === 'call' ? fail() : f.canonical.call(method, params) },
        readAuthFile: async home => source === 'file' ? fail() : JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')),
      }); cleanup.push(() => loader.close());
      const error = await loader.load().catch(error => error); expect(error).toBeInstanceOf(ErrorType);
      expect(error.message).not.toContain('synthetic-secret'); expect(error.message).not.toContain('private.invalid'); expect(error.cause).toBeUndefined(); expect(error.stack).not.toContain('synthetic-secret');
    }
  }
});

it('网络不可达/挂起的canonical有界失败，不用仍有效内存token掩盖网络故障，后续可重试', async () => {
  const f = await fixture();
  f.setRead(async () => { throw new Error('network secret'); });
  await expect(f.loader.load()).rejects.toBeInstanceOf(RemoteNetworkError);
  f.setRead(async () => ({ account: { type: 'chatgpt', email: null, planType: 'pro' }, requiresOpenaiAuth: true })); await f.loader.load();
  const stalled = new ManagedAuthLoader({ ...f.options, canonicalFactory: async () => new Promise(() => {}), operationTimeoutMs: 20 }); cleanup.push(() => stalled.close());
  await expect(stalled.load()).rejects.toBeInstanceOf(RemoteNetworkError);
});

it('显式canonical URL真实WS支持loader，空配置拒绝且不会默认本机端口或home', async () => {
  expect(() => new ManagedAuthLoader({})).toThrow();
  const f = await fixture(); const { WebSocketServer } = await import('ws'); const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => wss.once('listening', resolve));
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of wss.clients) socket.terminate(); wss.close(() => resolve()); }));
  const methods: string[] = [];
  wss.on('connection', socket => socket.on('message', raw => { const message = JSON.parse(raw.toString()); methods.push(message.method); if (!message.id) return;
    socket.send(JSON.stringify({ id: message.id, result: message.method === 'initialize' ? { codexHome: f.home } : { account: { type: 'chatgpt', email: null, planType: 'pro' }, requiresOpenaiAuth: true } })); }));
  const loader = new ManagedAuthLoader({ canonicalUrl: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`, now: () => NOW }); cleanup.push(() => loader.close());
  expect((await loader.load()).accountId).toBe('workspace'); expect(methods).toEqual(['initialize', 'initialized', 'account/read']);
});


it.each(['factory', 'initialize', 'call', 'file'] as const)('挂起%s有界失败且close/timeout后晚到结果不会发布token或留下canonical连接', async source => {
  const f = await fixture(); let closed = 0;
  for (const action of ['timeout', 'close'] as const) {
    let finish!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    const canonical = { ...f.canonical, close() { closed++; },
      async initialize() { if (source === 'initialize') { entered(); await gate; } return f.canonical.initialize(); },
      async call(method: string, params: unknown) { if (source === 'call') { entered(); await gate; } return f.canonical.call(method, params); },
    };
    const loader = new ManagedAuthLoader({ ...f.options, operationTimeoutMs: 20,
      canonicalFactory: async () => { if (source === 'factory') { entered(); await gate; } return canonical; },
      readAuthFile: async home => { if (source === 'file') { entered(); await gate; } return JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')); },
    }); cleanup.push(() => loader.close());
    const pending = loader.load().catch(error => error); await started;
    if (action === 'close') loader.close();
    const error = await pending; expect(error).toBeInstanceOf(RemoteNetworkError); loader.close();
    finish(); await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect(closed).toBeGreaterThanOrEqual(2);
});

it('真实reader拒绝home符号链接、宽松权限和硬链接，不修改文件权限或内容', async () => {
  const f = await fixture(); const { link } = await import('node:fs/promises');
  const before = await readFile(f.path, 'utf8');
  await chmod(f.path, 0o644); await expect(readManagedAuthFile(f.home)).rejects.toBeInstanceOf(RemoteAuthRequiredError);
  const { stat } = await import('node:fs/promises'); expect((await stat(f.path)).mode & 0o777).toBe(0o644); expect(await readFile(f.path, 'utf8')).toBe(before);
  await chmod(f.path, 0o600); await link(f.path, join(f.home, 'hard-link'));
  await expect(readManagedAuthFile(f.home)).rejects.toBeInstanceOf(RemoteAuthRequiredError); await rm(join(f.home, 'hard-link'));
  const alias = f.home + '-alias'; await symlink(f.home, alias); cleanup.push(() => rm(alias));
  await expect(readManagedAuthFile(alias)).rejects.toBeInstanceOf(RemoteAuthRequiredError);
});


it.each(['metadata', 'account'] as const)('canonical返回%s的异常getter也不透传secret或同类型错误文本', async source => {
  const f = await fixture();
  for (const ErrorType of [Error, RemoteAuthRequiredError, RemoteNetworkError]) {
    const fail = () => { throw new ErrorType('Bearer getter-secret https://private.invalid'); };
    const metadata = Object.defineProperty({}, 'codexHome', { get: fail });
    const result = Object.defineProperty({}, 'account', { get: fail });
    const loader = new ManagedAuthLoader({ ...f.options, canonicalFactory: async () => ({ ...f.canonical,
      initialize: async () => source === 'metadata' ? metadata : f.canonical.initialize(),
      call: async () => source === 'account' ? result : f.canonical.call('account/read', { refreshToken: true }),
    }) }); cleanup.push(() => loader.close());
    const error = await loader.load().catch(error => error);
    expect(error.message).not.toContain('getter-secret'); expect(error.message).not.toContain('private.invalid');
    expect(error).toBeInstanceOf(ErrorType === RemoteNetworkError ? RemoteNetworkError : RemoteAuthRequiredError);
  }
});


it('文件读取超时立即关闭关联canonical；恢复时重连、保留绑定且不采用晚到文件结果', async () => {
  const f = await fixture(); let blocked = false; let resume!: (value: unknown) => void; let record: unknown = auth();
  const sessions: { closed: number; initialize: number; calls: number }[] = [];
  const loader = new ManagedAuthLoader({ now: () => NOW, operationTimeoutMs: 20,
    canonicalFactory: async () => {
      const state = { closed: 0, initialize: 0, calls: 0 }; sessions.push(state);
      return { async initialize() { state.initialize++; return { codexHome: f.home }; }, async call() { state.calls++; return { account: { type: 'chatgpt' } }; }, close() { state.closed++; } };
    },
    readAuthFile: async () => blocked ? new Promise(resolve => { resume = resolve; }) : record,
  }); cleanup.push(() => loader.close());
  await loader.load(); const identity = loader.currentIdentity; blocked = true;
  await expect(loader.load()).rejects.toBeInstanceOf(RemoteNetworkError);
  expect(sessions[0]!.closed).toBe(1); expect(loader.currentIdentity).toEqual(identity);
  blocked = false; expect((await loader.load()).accountId).toBe('workspace');
  expect(sessions).toHaveLength(2); expect(sessions[1]).toEqual({ closed: 0, initialize: 1, calls: 1 });
  resume(auth(token({}, { chatgpt_account_id: 'late-other' }), 'late-other'));
  await new Promise(resolve => setTimeout(resolve, 5)); expect(loader.currentIdentity).toEqual(identity); expect(sessions[1]!.closed).toBe(0);
  record = auth(token({}, { chatgpt_account_id: 'new-workspace' }), 'new-workspace');
  await expect(loader.load()).rejects.toBeInstanceOf(RemoteAuthRequiredError); expect(loader.currentIdentity).toEqual(identity);
});

it.each(['timeout', 'result'] as const)('旧canonical文件读取晚到%s只影响旧会话，不关闭恢复后的新会话或发布旧token', async outcome => {
  const f = await fixture(); let mode: 'normal' | 'pending' | 'failure' = 'normal'; let entered!: () => void; let resume!: (value: unknown) => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; }); const sessions: { closed: number }[] = [];
  const loader = new ManagedAuthLoader({ now: () => NOW, operationTimeoutMs: 50,
    canonicalFactory: async () => { const state = { closed: 0 }; sessions.push(state); return { async initialize() { return { codexHome: f.home }; }, async call() { return { account: { type: 'chatgpt' } }; }, close() { state.closed++; } }; },
    readAuthFile: async () => { if (mode === 'failure') throw new RemoteNetworkError('synthetic-secret'); if (mode === 'pending') return new Promise(resolve => { resume = resolve; entered(); }); return auth(); },
  }); cleanup.push(() => loader.close());
  await loader.load(); mode = 'pending'; const old = loader.load().catch(error => error); await waiting;
  mode = 'failure'; await expect(loader.load()).rejects.toBeInstanceOf(RemoteNetworkError); expect(sessions[0]!.closed).toBe(1);
  mode = 'normal'; await loader.load(); expect(sessions).toHaveLength(2);
  if (outcome === 'result') resume(auth());
  expect(await old).toBeInstanceOf(RemoteNetworkError); expect(sessions[1]!.closed).toBe(0); expect(sessions[0]!.closed).toBe(1);
  if (outcome === 'timeout') resume(auth());
  await new Promise(resolve => setTimeout(resolve, 5)); expect(sessions[1]!.closed).toBe(0);
});

it('恢复后的canonical独立刷新，旧会话晚到的refresh不能复用、覆盖或清理新刷新', async () => {
  const f = await fixture(); let now = NOW; let fileFailure = false; let fresh = false;
  let entered!: () => void; let resume!: (value: unknown) => void; const waiting = new Promise<void>(resolve => { entered = resolve; });
  let enteredNew!: () => void; let resumeNew!: () => void; const waitingNew = new Promise<void>(resolve => { enteredNew = resolve; });
  const sessions: { closed: number; calls: number }[] = [];
  const loader = new ManagedAuthLoader({ now: () => now, operationTimeoutMs: 200,
    canonicalFactory: async () => {
      const state = { closed: 0, calls: 0 }; sessions.push(state); const index = sessions.length;
      return { async initialize() { return { codexHome: f.home }; }, async call() {
        state.calls++;
        if (index === 1 && state.calls === 2) return new Promise(resolve => { resume = resolve; entered(); });
        if (index > 1) { enteredNew(); await new Promise<void>(resolve => { resumeNew = resolve; }); fresh = true; }
        return { account: { type: 'chatgpt' } };
      }, close() { state.closed++; } };
    },
    readAuthFile: async () => { if (fileFailure) throw new RemoteNetworkError(); return auth(token({ exp: NOW / 1000 + (fresh ? 7200 : 3600) })); },
  }); cleanup.push(() => loader.close());
  await loader.load(); now += 3571000; const old = loader.load().catch(error => error); await waiting;
  fileFailure = true; await expect(loader.verifyIdentity()).rejects.toBeInstanceOf(RemoteNetworkError); fileFailure = false;
  const next = loader.load(); await waitingNew; expect(sessions).toHaveLength(2); expect(sessions[1]).toEqual({ closed: 0, calls: 1 });
  resume({ account: { type: 'chatgpt' } }); expect(await old).toBeInstanceOf(RemoteNetworkError);
  const concurrent = loader.load(); await new Promise(resolve => setTimeout(resolve, 5)); expect(sessions[1]!.calls).toBe(1);
  resumeNew(); expect((await next).accountId).toBe('workspace'); expect((await concurrent).accountId).toBe('workspace');
  await loader.load(); expect(sessions[1]).toEqual({ closed: 0, calls: 1 });
});
