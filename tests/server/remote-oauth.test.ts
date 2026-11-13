// @vitest-environment node
import { createHash } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import { createConnection, type AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { RemoteStepUpOAuth, type RemoteOAuthOptions } from '../../server/remote/oauth.js';
import type { ManagedAuthIdentity } from '../../server/remote/managed-auth.js';

const NOW = 1800000000000;
const AUTH = 'https://api.openai.com/auth';
const IDENTITY: ManagedAuthIdentity = { codexHome: '/isolated/oauth-home', accountId: 'workspace', accountUserId: 'account-user', userId: 'user' };
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const jwt = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`;
const identityClaims = { chatgpt_account_id: 'workspace', chatgpt_account_user_id: 'account-user', user_id: 'user' };
const normal = { accessToken: jwt({ exp: NOW / 1000 + 3600, [AUTH]: identityClaims }), accountId: 'workspace', accountUserId: 'account-user', userId: 'user' };
const stepUp = (changes: object = {}) => jwt({ exp: NOW / 1000 + 300, iat: NOW / 1000, pwd_auth_time: NOW, scope: 'codex.remote_control.enroll', [AUTH]: identityClaims, ...changes });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function http(server: Server, path: string, options: { method?: string; host?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path, method: options.method ?? 'GET', headers: { Host: options.host ?? 'localhost:1455', Connection: 'close', ...options.headers } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', value => { body += value; });
      response.on('end', () => resolve({ status: response.statusCode!, body, headers: response.headers }));
    }); req.on('error', reject); req.end();
  });
}
function fixture(change: Partial<RemoteOAuthOptions> = {}) {
  let identity = { ...IDENTITY }; const opened = deferred<URL>(); const servers: Server[] = [];
  const calls: { url: string; init: RequestInit }[] = []; const ports: number[] = [];
  let onOpen = async (_url: URL) => {};
  let onFetch = async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ access_token: stepUp(), token_type: 'Bearer' }));
  const options: RemoteOAuthOptions = {
    managedAuth: { async load() { return normal; }, get currentIdentity() { return { ...identity }; }, async verifyIdentity() { return { ...identity }; } },
    now: () => NOW, timeoutMs: 1000, browserTimeoutMs: 200, exchangeTimeoutMs: 200,
    async bindListener(server, binding) {
      ports.push(binding.port); servers.push(server);
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
    },
    async openBrowser(value) { const url = new URL(value); opened.resolve(url); await onOpen(url); },
    async fetch(input, init) { calls.push({ url: String(input), init: init! }); return onFetch(input, init); },
    ...change,
  };
  const oauth = new RemoteStepUpOAuth(options); cleanup.push(() => oauth.close());
  return { oauth, options, opened: opened.promise, servers, calls, ports,
    setIdentity(value: ManagedAuthIdentity) { identity = value; }, setOpen(value: typeof onOpen) { onOpen = value; }, setFetch(value: typeof onFetch) { onFetch = value; },
    async callback(url: URL, query = `code=synthetic-code&state=${url.searchParams.get('state')}`) { return http(servers.at(-1)!, `/auth/callback?${query}`, { host: new URL(url.searchParams.get('redirect_uri')!).host }); },
  };
}
async function start(f: ReturnType<typeof fixture>, signal?: AbortSignal) {
  const result = f.oauth.authorize(signal);
  const outcome = result.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  const url = await Promise.race([f.opened, outcome.then(() => { throw new Error('应先打开隔离浏览器边界'); })]);
  return { result, outcome, url };
}
function safeError(error: unknown, code: string) {
  expect(error).toMatchObject({ name: 'RemoteOAuthError', code });
  expect(String(error)).not.toMatch(/synthetic|secret|private\.invalid|Bearer/);
  expect((error as Error).cause).toBeUndefined(); expect(Object.keys(error as object).sort()).toEqual(['code', 'name']);
}

it('固定authorize参数和PKCE，通过真实隔离HTTP回调单次换取核验后的短期token', async () => {
  const f = fixture(); const callback = deferred<Awaited<ReturnType<typeof http>>>();
  f.setOpen(async url => { void f.callback(url).then(callback.resolve, callback.reject); });
  await expect(f.oauth.authorize()).resolves.toBe(stepUp());
  const url = await f.opened;
  expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', client_id: 'app_EMoamEEZ73f0CkXaXp7hrann', redirect_uri: 'http://localhost:1455/auth/callback', scope: 'codex.remote_control.enroll', code_challenge_method: 'S256', originator: 'Codex Mobile Gateway', reauth: 'remote_control', max_age: '0', codex_cli_simplified_flow: 'true', allowed_workspace_id: 'workspace', current_workspace_id: 'workspace' });
  const response = await callback.promise;
  expect(response.status).toBe(200); expect(response.body).toContain('授权成功');
  expect(response.headers).toMatchObject({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  expect(f.calls).toHaveLength(1); expect(f.calls[0]!.url).toBe('https://auth.openai.com/oauth/token');
  const init = f.calls[0]!.init; const body = new URLSearchParams(init.body as string);
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  expect(Object.fromEntries(body)).toMatchObject({ grant_type: 'authorization_code', code: 'synthetic-code', redirect_uri: 'http://localhost:1455/auth/callback', client_id: 'app_EMoamEEZ73f0CkXaXp7hrann' });
  const verifier = body.get('code_verifier')!; const state = url.searchParams.get('state')!;
  expect(Buffer.from(verifier, 'base64url').length).toBeGreaterThanOrEqual(32); expect(Buffer.from(state, 'base64url').length).toBeGreaterThanOrEqual(32); expect(state).not.toBe(verifier);
  expect(createHash('sha256').update(verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
  expect(f.servers.every(server => !server.listening)).toBe(true);
});

it('同实例并发authorize共享一次browser/listener/交换，完成后显式重试使用新state', async () => {
  const f = fixture(); const first = f.oauth.authorize(); const second = f.oauth.authorize();
  const caught = first.catch(() => undefined); void second.catch(() => undefined); expect(second).toBe(first);
  const url = await Promise.race([f.opened, caught.then(() => { throw new Error('flow提前结束'); })]);
  const callback = f.callback(url); await expect(first).resolves.toBe(stepUp()); await callback;
  expect(f.ports).toEqual([1455]); expect(f.calls).toHaveLength(1);
  const again = deferred<URL>(); f.setOpen(async value => { again.resolve(value); });
  const next = f.oauth.authorize(); const nextOutcome = next.catch(error => error); const newUrl = await again.promise;
  expect(newUrl.searchParams.get('state')).not.toBe(url.searchParams.get('state'));
  expect((await f.callback(newUrl, `code=old-code&state=${url.searchParams.get('state')}`)).status).toBe(400);
  const valid = f.callback(newUrl); expect(await nextOutcome).toBe(stepUp()); await valid; expect(f.calls).toHaveLength(2);
});

it.each([
  ['错误state', 'code=synthetic-secret&state=wrong'],
  ['非ASCII state', 'code=synthetic-secret&state=%E4%B8%AD%E6%96%87'],
  ['重复state', 'code=synthetic-secret&state=$STATE&state=$STATE'],
  ['重复code', 'code=synthetic-secret&code=another&state=$STATE'],
  ['code与error混合', 'code=synthetic-secret&error=denied&state=$STATE'],
  ['重复error', 'error=denied&error=other&state=$STATE'],
  ['无code/error', 'state=$STATE'],
  ['超长code', `code=${'s'.repeat(4097)}&state=$STATE`],
  ['无效百分号UTF8', 'code=%FF&state=$STATE'],
])('%s拒绝且不反射输入，随后合法回调仍可完成', async (_name, query) => {
  const f = fixture(); const run = await start(f);
  const response = await f.callback(run.url, query.replaceAll('$STATE', run.url.searchParams.get('state')!));
  expect(response.status).toBe(400); expect(response.body).not.toContain('synthetic-secret'); expect(response.body).not.toContain('中文'); expect(f.calls).toHaveLength(0);
  const valid = f.callback(run.url); await expect(run.result).resolves.toBe(stepUp()); await valid;
});

it.each([
  ['/wrong?code=synthetic-secret&state=$STATE', {}],
  ['/auth/callback/next?code=synthetic-secret&state=$STATE', {}],
  ['/auth/callback?code=synthetic-secret&state=$STATE', { host: 'evil.invalid:1455' }],
  ['/auth/callback?code=synthetic-secret&state=$STATE', { host: 'localhost:1457' }],
  ['/auth/callback?code=synthetic-secret&state=$STATE', { method: 'POST' }],
  ['/auth/callback?code=synthetic-secret&state=$STATE', { headers: { 'X-Padding': 's'.repeat(9000) } }],
])('真实HTTP拒绝路径/Host/方法/headers不符 %#', async (path, options) => {
  const f = fixture(); const run = await start(f);
  const response = await http(f.servers.at(-1)!, path.replace('$STATE', run.url.searchParams.get('state')!), options);
  expect(response.status).toBeGreaterThanOrEqual(400); expect(response.body).not.toContain('synthetic-secret'); expect(f.calls).toHaveLength(0);
  f.oauth.close(); safeError((await run.outcome).error, 'closed');
});

it('合法error只分类denied且不反射error_description', async () => {
  const f = fixture(); const run = await start(f);
  const response = await f.callback(run.url, `error=synthetic-secret&error_description=%3Cscript%3Esynthetic-secret%3C%2Fscript%3E&state=${run.url.searchParams.get('state')}`);
  safeError((await run.outcome).error, 'denied'); expect(response.status).toBe(400); expect(response.body).not.toContain('synthetic-secret'); expect(f.calls).toHaveLength(0);
});

it('首次正确callback消费后重复callback不能再次请求token', async () => {
  const f = fixture(); const exchange = deferred<Response>(); const called = deferred<void>();
  f.setFetch(async () => { called.resolve(); return exchange.promise; });
  const run = await start(f); const callback = f.callback(run.url); await called.promise;
  expect((await f.callback(run.url)).status).toBe(409); expect(f.calls).toHaveLength(1);
  exchange.resolve(new Response(JSON.stringify({ access_token: stepUp() })));
  await expect(run.result).resolves.toBe(stepUp()); expect((await callback).status).toBe(200);
});

it.each([
  { scope: 'ordinary' }, { scope: 'codex.remote_control.enroll other' }, { iat: NOW / 1000 - 301 }, { iat: NOW / 1000 + 1 },
  { pwd_auth_time: NOW - 300001 }, { pwd_auth_time: NOW + 1 }, { exp: NOW / 1000 },
  { [AUTH]: { ...identityClaims, chatgpt_account_id: 'other' } }, { [AUTH]: { ...identityClaims, chatgpt_account_user_id: 'other' } },
])('复用step-up校验拒绝错误scope/新鲜度/身份 %j', async changes => {
  const f = fixture(); f.setFetch(async () => new Response(JSON.stringify({ access_token: stepUp(changes) })));
  const run = await start(f); const response = f.callback(run.url);
  safeError((await run.outcome).error, 'response-invalid'); expect((await response).status).toBe(400);
});

it.each(['codexHome', 'accountId', 'accountUserId', 'userId'] as const)('browser等待期间%s变化拒绝且不交换', async key => {
  const f = fixture(); const gate = deferred<void>(); f.setOpen(async () => gate.promise);
  const run = await start(f); f.setIdentity({ ...IDENTITY, [key]: 'changed' }); gate.resolve();
  safeError((await run.outcome).error, 'identity-changed'); expect(f.calls).toHaveLength(0); expect(f.servers.every(server => !server.listening)).toBe(true);
});

it.each(['codexHome', 'accountId', 'accountUserId', 'userId'] as const)('exchange等待期间%s变化丢弃step-up', async key => {
  const f = fixture(); const exchange = deferred<Response>(); const called = deferred<void>();
  f.setFetch(async () => { called.resolve(); return exchange.promise; });
  const run = await start(f); const callback = f.callback(run.url); await called.promise;
  f.setIdentity({ ...IDENTITY, [key]: 'changed' }); exchange.resolve(new Response(JSON.stringify({ access_token: stepUp() })));
  safeError((await run.outcome).error, 'identity-changed'); expect((await callback).status).toBe(400);
});

it('外部loader伪造普通token或返回与currentIdentity不符的证明时在browser前拒绝', async () => {
  for (const managedAuth of [
    { async load() { return { ...normal, accountId: 'other' }; }, currentIdentity: IDENTITY, async verifyIdentity() { return IDENTITY; } },
    { async load() { return normal; }, currentIdentity: { ...IDENTITY, codexHome: '/other' }, async verifyIdentity() { return IDENTITY; } },
  ]) {
    let opened = false; const f = fixture({ managedAuth, async openBrowser() { opened = true; } });
    safeError(await f.oauth.authorize().catch(error => error), 'auth-required'); expect(opened).toBe(false); expect(f.calls).toHaveLength(0);
  }
});

it('真实EADDRINUSE只尝试另一个固定端口，close不触碰外部listener', async () => {
  const foreign = createServer(); await new Promise<void>(resolve => foreign.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => foreign.close(() => resolve())));
  const attempted: number[] = []; const owned: Server[] = [];
  const f = fixture({ async bindListener(server, binding) {
    attempted.push(binding.port); owned.push(server);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(binding.port === 1455 ? (foreign.address() as AddressInfo).port : 0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  } });
  const run = await start(f); expect(attempted).toEqual([1455, 1457]); expect(run.url.searchParams.get('redirect_uri')).toBe('http://localhost:1457/auth/callback');
  const response = http(owned.at(-1)!, `/auth/callback?code=synthetic-code&state=${run.url.searchParams.get('state')}`, { host: 'localhost:1457' });
  await expect(run.result).resolves.toBe(stepUp()); await response;
  expect(foreign.listening).toBe(true); expect(owned.every(server => !server.listening)).toBe(true);
});

it('两个固定端口均被占用明确报错，其他bind错误不继续猜测', async () => {
  for (const code of ['EADDRINUSE', 'EACCES']) {
    const ports: number[] = []; const f = fixture({ async bindListener(_server, binding) { ports.push(binding.port); throw Object.assign(new Error('synthetic-secret'), { code }); } });
    safeError(await f.oauth.authorize().catch(error => error), code === 'EADDRINUSE' ? 'ports-unavailable' : 'network'); expect(ports).toEqual(code === 'EADDRINUSE' ? [1455, 1457] : [1455]);
  }
});

it.each(['cancel', 'close', 'deadline'] as const)('%s取消callback等待并关闭所有owned sockets', async mode => {
  const abort = new AbortController(); const f = fixture({ timeoutMs: 40 }); const run = await start(f, abort.signal);
  if (mode === 'cancel') abort.abort('synthetic-secret'); if (mode === 'close') f.oauth.close();
  safeError((await run.outcome).error, mode === 'cancel' ? 'cancelled' : mode === 'close' ? 'closed' : 'timeout');
  expect(f.servers.every(server => !server.listening)).toBe(true); expect(f.calls).toHaveLength(0);
  if (mode === 'close') safeError(await f.oauth.authorize().catch(error => error), 'closed');
});

it.each(['load', 'verify', 'bind', 'browser'] as const)('deadline终止挂起%s，晚到结果不能复活flow或交换', async stage => {
  const gate = deferred<void>(); const f = fixture({ timeoutMs: 30, browserTimeoutMs: 20 });
  if (stage === 'load') f.options.managedAuth.load = async () => { await gate.promise; return normal; };
  if (stage === 'verify') f.options.managedAuth.verifyIdentity = async () => { await gate.promise; return IDENTITY; };
  if (stage === 'browser') f.setOpen(async () => gate.promise);
  if (stage === 'bind') f.options.bindListener = async server => { f.servers.push(server); await gate.promise; await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); };
  const result = f.oauth.authorize().catch(error => error); safeError(await result, 'timeout');
  gate.resolve(); await new Promise(resolve => setTimeout(resolve, 20));
  expect(f.servers.every(server => !server.listening)).toBe(true); expect(f.calls).toHaveLength(0);
});

it('browser失败固定脱敏且关闭listener，不读取外部message/cause/code', async () => {
  const f = fixture(); f.setOpen(async () => { throw Object.assign(new Error('synthetic-secret https://private.invalid/'), { cause: 'Bearer secret', code: 'synthetic-secret' }); });
  safeError(await f.oauth.authorize().catch(error => error), 'browser'); expect(f.servers.every(server => !server.listening)).toBe(true); expect(f.calls).toHaveLength(0);
});

it.each([401, 403, 400, 500])('HTTP %s拒绝与网络失败分开，响应正文被丢弃', async status => {
  const f = fixture(); let cancelled = false;
  f.setFetch(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status }));
  const run = await start(f); const callback = f.callback(run.url);
  safeError((await run.outcome).error, [401, 403].includes(status) ? 'denied' : 'http-rejected'); await callback; expect(cancelled).toBe(true);
});

it.each(['fetch-error', 'read-error', 'fetch-hang', 'read-hang', 'bad-response', 'invalid-json', 'invalid-utf8', 'oversized', 'oversized-chunk', 'oversized-token'] as const)('%s安全失败并中止fetch/reader/listener', async kind => {
  const f = fixture({ exchangeTimeoutMs: 30 }); let signal: AbortSignal | undefined; let cancelled = false;
  const late = deferred<Response>();
  f.setFetch(async (_url, init) => {
    signal = init!.signal!;
    if (kind === 'fetch-error') throw new Error('synthetic-secret');
    if (kind === 'fetch-hang') return late.promise;
    if (kind === 'bad-response') return {} as Response;
    if (kind === 'invalid-json') return new Response('synthetic-secret');
    if (kind === 'invalid-utf8') return new Response(new Uint8Array([0xff]));
    if (kind === 'oversized-token') return new Response(JSON.stringify({ access_token: 's'.repeat(65537) }));
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        if (kind === 'read-error') controller.error(new Error('synthetic-secret'));
        if (kind === 'oversized-chunk') controller.enqueue(new Uint8Array(131073));
        if (kind === 'oversized') { controller.enqueue(new Uint8Array(65536)); controller.enqueue(new Uint8Array(65536)); controller.enqueue(new Uint8Array(1)); }
      }, cancel() { cancelled = true; },
    }), { headers: { 'Content-Length': '1' } });
  });
  const run = await start(f); const callback = f.callback(run.url);
  safeError((await run.outcome).error, kind.endsWith('hang') ? 'timeout' : kind.endsWith('error') ? 'network' : 'response-invalid');
  await callback; expect(signal?.aborted).toBe(true); expect(f.servers.every(server => !server.listening)).toBe(true);
  if (kind === 'fetch-hang') { late.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } }))); await new Promise(resolve => setTimeout(resolve, 10)); }
  if (['read-hang', 'oversized', 'oversized-chunk', 'fetch-hang'].includes(kind)) expect(cancelled).toBe(true);
});

it('已取消signal不加载身份，不同并发调用者的取消结束共享flow', async () => {
  let loads = 0; const f = fixture(); const load = f.options.managedAuth.load; f.options.managedAuth.load = async () => { loads++; return load(); };
  const abort = new AbortController(); abort.abort('synthetic-secret'); safeError(await f.oauth.authorize(abort.signal).catch(error => error), 'cancelled'); expect(loads).toBe(0);
  const run = await start(f); const join = new AbortController(); expect(f.oauth.authorize(join.signal)).toBe(run.result); join.abort();
  safeError((await run.outcome).error, 'cancelled'); expect(f.servers.every(server => !server.listening)).toBe(true);
});

it('fetch响应已到但身份复核失败时仍取消未读取body', async () => {
  const f = fixture(); let cancelled = false;
  f.setFetch(async () => {
    f.setIdentity({ ...IDENTITY, codexHome: '/changed' });
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  });
  const run = await start(f); const callback = f.callback(run.url);
  safeError((await run.outcome).error, 'identity-changed'); await callback; expect(cancelled).toBe(true);
});

it.each(['cancel', 'close'] as const)('callback响应flush期间%s仍不得返回token', async mode => {
  const abort = new AbortController(); const f = fixture(); const run = await start(f, abort.signal);
  f.servers[0]!.on('request', (_request, response) => {
    response.once('finish', () => { if (mode === 'close') f.oauth.close(); else abort.abort(); });
  });
  const callback = f.callback(run.url); safeError((await run.outcome).error, mode === 'close' ? 'closed' : 'cancelled'); await callback;
});

it.each(['cancel', 'close'] as const)('%s中断忽略abort的fetch及reader，并忽略晚到拒绝', async mode => {
  for (const stage of ['fetch', 'reader']) {
    const f = fixture(); const entered = deferred<void>(); const late = deferred<Response>(); const abort = new AbortController();
    let cancelled = false; let signal: AbortSignal | undefined;
    f.setFetch(async (_url, init) => {
      signal = init!.signal!; entered.resolve();
      if (stage === 'fetch') return late.promise;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    });
    const run = await start(f, abort.signal); const callback = f.callback(run.url); await entered.promise;
    await new Promise(resolve => setImmediate(resolve));
    if (mode === 'close') f.oauth.close(); else abort.abort();
    safeError((await run.outcome).error, mode === 'close' ? 'closed' : 'cancelled'); await callback;
    expect(signal?.aborted).toBe(true); expect(f.servers.every(server => !server.listening)).toBe(true);
    if (stage === 'reader') expect(cancelled).toBe(true);
    else { late.reject(new Error('synthetic-secret')); await new Promise(resolve => setImmediate(resolve)); }
  }
});

it('读取token正文期间身份变化也必须拒绝', async () => {
  const f = fixture(); const reading = deferred<ReadableStreamDefaultController<Uint8Array>>();
  f.setFetch(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { reading.resolve(controller); } })));
  const run = await start(f); const callback = f.callback(run.url); const controller = await reading.promise;
  await new Promise(resolve => setImmediate(resolve)); f.setIdentity({ ...IDENTITY, accountUserId: 'changed' });
  controller.enqueue(Buffer.from(JSON.stringify({ access_token: stepUp() }))); controller.close();
  safeError((await run.outcome).error, 'identity-changed'); await callback;
});

it('callback后身份证明变化立即拒绝，绝不开始exchange', async () => {
  const f = fixture(); const run = await start(f); await new Promise(resolve => setImmediate(resolve));
  f.options.managedAuth.verifyIdentity = async () => ({ ...IDENTITY, accountId: 'changed' });
  const callback = f.callback(run.url); safeError((await run.outcome).error, 'identity-changed'); await callback; expect(f.calls).toHaveLength(0);
});

it('连接数有界，close销毁真实空闲owned sockets', async () => {
  const f = fixture(); const run = await start(f); const address = f.servers[0]!.address() as AddressInfo;
  const sockets = await Promise.all(Array.from({ length: 5 }, () => new Promise<ReturnType<typeof createConnection>>(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: address.port }, () => resolve(socket)); socket.on('error', () => undefined);
  })));
  cleanup.push(() => { for (const socket of sockets) socket.destroy(); });
  await new Promise(resolve => setTimeout(resolve, 10)); expect(sockets.filter(socket => !socket.destroyed).length).toBeLessThanOrEqual(4);
  f.oauth.close(); safeError((await run.outcome).error, 'closed'); await new Promise(resolve => setImmediate(resolve));
  expect(sockets.every(socket => socket.destroyed)).toBe(true);
});

it.each([0, -1, NaN, Infinity, 600001, 1.5])('拒绝无效总deadline %s', timeoutMs => {
  expect(() => fixture({ timeoutMs })).toThrow('Remote 授权配置无效');
});

it('cleanup期间并发加入flow的signal监听器也会移除', async () => {
  const f = fixture(); const run = await start(f); let added = 0; let removed = 0;
  const join = new AbortController(); const add = join.signal.addEventListener.bind(join.signal); const remove = join.signal.removeEventListener.bind(join.signal);
  join.signal.addEventListener = (...args) => { added++; return add(...args); };
  join.signal.removeEventListener = (...args) => { removed++; return remove(...args); };
  f.servers[0]!.on('request', (_request, response) => { response.once('finish', () => { expect(f.oauth.authorize(join.signal)).toBe(run.result); }); });
  const callback = f.callback(run.url); await expect(run.result).resolves.toBe(stepUp()); await callback;
  expect(added).toBe(1); expect(removed).toBe(1);
});

it.each(['complete', 'hanging-cancel'] as const)('%s时reader释放锁且不等待挂起cancel', async kind => {
  const f = fixture({ exchangeTimeoutMs: 30 }); let body: ReadableStream<Uint8Array> | undefined;
  f.setFetch(async () => {
    const response = kind === 'complete' ? new Response(JSON.stringify({ access_token: stepUp() })) : new Response(new ReadableStream({ cancel() { return new Promise(() => {}); } }));
    body = response.body!; return response;
  });
  const run = await start(f); const callback = f.callback(run.url); const outcome = await run.outcome; await callback;
  if (kind === 'complete') expect(outcome.value).toBe(stepUp()); else safeError(outcome.error, 'timeout');
  expect(body?.locked).toBe(false);
});

it('坏response的status无效时仍回收其已到body', async () => {
  const f = fixture(); let cancelled = false;
  f.setFetch(async () => ({ status: 0, body: new ReadableStream({ cancel() { cancelled = true; } }) }) as Response);
  const run = await start(f); const callback = f.callback(run.url);
  safeError((await run.outcome).error, 'response-invalid'); await callback; expect(cancelled).toBe(true);
});
