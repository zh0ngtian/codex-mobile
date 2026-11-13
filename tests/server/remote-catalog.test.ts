// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { RemoteCatalog, RemoteCatalogError } from '../../server/remote/catalog.js';
import { RemoteNetworkError, deviceIdentityHash } from '../../server/remote/auth.js';
import { RemoteAuthRequiredError } from '../../server/remote/relay.js';
import type { EnrollmentRecord, ManagedAuth } from '../../server/remote/auth.js';

const NOW = 1794530000000;
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
function fixture(options: Record<string, unknown> = {}) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const identity = { keyId: 'key', algorithm: 'ecdsa_p256_sha256' as const, protectionClass: 'hardware_secure_enclave' as const, publicKeySpkiDerBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  let auth: ManagedAuth = { accessToken: 'secret-access', accountId: 'workspace', accountUserId: 'account-user', userId: 'user' };
  let enrollment: EnrollmentRecord | null = { version: 1, clientId: 'own/client', accountId: auth.accountId, accountUserId: 'user', managedAccountUserId: auth.accountUserId, identityHash: deviceIdentityHash(identity), identity };
  const calls: { url: string; init?: RequestInit }[] = [];
  let handler = async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ items: [target()], cursor: null }));
  const catalog = new RemoteCatalog({ loadManagedAuth: async () => ({ ...auth }), getEnrollment: async () => enrollment, fetch: (async (input, init) => { calls.push({ url: String(input), init }); return handler(String(input), init); }) as typeof fetch, now: () => NOW, requestTimeoutMs: 40, ...options });
  cleanup.push(() => catalog.close());
  return { catalog, calls, setHandler(value: typeof handler) { handler = value; }, setAuth(value: Partial<ManagedAuth>) { auth = { ...auth, ...value }; }, setEnrollment(value: Partial<EnrollmentRecord> | null) { enrollment = value === null ? null : { ...enrollment!, ...value }; } };
}
function target(change: Record<string, unknown> = {}) { return { env_id: 'mac-env', installation_id: 'mac-install', kind: 'single', display_name: '同名 Mac', host_name: null, name: 'Mac', online: false, busy: true, os: 'macos', os_version: null, arch: 'arm64', app_server_version: '1', client_type: null, originator: 'codex', terminal: null, client_name: null, client_version: null, last_seen_at: '2026-11-13T00:00:00Z', ...change }; }

it('只查询自己的client可见分页目录，保留offline/busy和安全主机字段', async () => {
  const f = fixture(); f.setHandler(async url => new Response(JSON.stringify(url.includes('cursor=') ? { items: [target({ env_id: 'other', installation_id: 'install-2', kind: 'future', online: true })], cursor: null } : { items: [target()], cursor: 'next/中文' })));
  const result = await f.catalog.refresh();
  expect(result).toHaveLength(2); expect(result[0]).toMatchObject({ env_id: 'mac-env', installation_id: 'mac-install', online: false, busy: true, host_name: null });
  expect(f.calls.map(call => call.url)).toEqual(['https://chatgpt.com/backend-api/codex/remote/control/clients/own%2Fclient/environments?limit=100', 'https://chatgpt.com/backend-api/codex/remote/control/clients/own%2Fclient/environments?limit=100&cursor=next%2F%E4%B8%AD%E6%96%87']);
  const headers = new Headers(f.calls[0]!.init!.headers); expect(headers.get('Authorization')).toBe('Bearer secret-access'); expect(headers.get('ChatGPT-Account-Id')).toBe('workspace'); expect(headers.get('Accept')).toBe('application/json'); expect(headers.get('originator')).toBeTruthy(); expect(headers.get('User-Agent')).toBeTruthy();
  expect(JSON.stringify(result)).not.toContain('secret-access'); expect(f.catalog.targets).toEqual(result);
});

it.each(['cursor-loop', 'duplicate', 'shape', 'missing-id', 'online', 'oversized', 'pages', 'targets'] as const)('分页%s拒绝完整刷新并保留上次目录', async failure => {
  const f = fixture({ maxPages: 2, maxTargets: 2, maxResponseBytes: 1000 }); await f.catalog.refresh(); const previous = f.catalog.targets;
  f.setHandler(async url => {
    if (failure === 'oversized') return new Response('x'.repeat(1001));
    if (failure === 'shape') return new Response(JSON.stringify({ items: [], cursor: 2 }));
    if (failure === 'missing-id') return new Response(JSON.stringify({ items: [target({ installation_id: null })], cursor: null }));
    if (failure === 'online') return new Response(JSON.stringify({ items: [target({ online: 'yes' })], cursor: null }));
    if (failure === 'targets') return new Response(JSON.stringify({ items: [target(), target({ env_id: 'b', installation_id: 'b' }), target({ env_id: 'c', installation_id: 'c' })], cursor: null }));
    const cursor = failure === 'pages' ? (url.includes('cursor=') ? 'third' : 'second') : 'repeat';
    return new Response(JSON.stringify({ items: failure === 'duplicate' || !url.includes('cursor=') ? [target()] : [], cursor }));
  });
  await expect(f.catalog.refresh()).rejects.toBeInstanceOf(RemoteCatalogError); expect(f.catalog.targets).toEqual(previous);
});

it.each([401, 403, 408, 429, 500, 502])('HTTP %s按认证与临时网络分类且不泄露响应', async status => {
  const f = fixture(); f.setHandler(async () => new Response('Bearer secret-access https://private.invalid', { status }));
  const error = await f.catalog.refresh().catch(error => error); expect(error).toBeInstanceOf(status === 401 || status === 403 ? RemoteAuthRequiredError : RemoteNetworkError);
  expect(error.message).not.toContain('secret-access'); expect(error.stack).not.toContain('private.invalid'); expect(error.cause).toBeUndefined();
});

it('调用后再次核对账号和登记，切换时不发布晚到目录', async () => {
  const f = fixture(); await f.catalog.refresh(); const previous = f.catalog.targets;
  f.setHandler(async () => { f.setAuth({ accountId: 'other' }); return new Response(JSON.stringify({ items: [], cursor: null })); });
  await expect(f.catalog.refresh()).rejects.toBeInstanceOf(RemoteAuthRequiredError); expect(f.catalog.targets).toEqual(previous);
  f.setAuth({ accountId: 'workspace' }); f.setEnrollment({ clientId: 'replacement' });
  await expect(f.catalog.refresh()).rejects.toBeInstanceOf(RemoteAuthRequiredError); expect(f.calls).toHaveLength(2);
});

it('请求与响应流均有界，close取消HTTP且晚响应不能覆盖目录', async () => {
  const f = fixture(); await f.catalog.refresh(); const previous = f.catalog.targets; let finish!: (value: Response) => void;
  f.setHandler(async () => new Promise(resolve => { finish = resolve; }));
  await expect(f.catalog.refresh()).rejects.toBeInstanceOf(RemoteNetworkError);
  const pending = f.catalog.refresh().catch(error => error); await new Promise(resolve => setTimeout(resolve, 0)); f.catalog.close();
  expect(await pending).toBeInstanceOf(RemoteCatalogError); expect(f.calls.at(-1)!.init!.signal!.aborted).toBe(true);
  finish(new Response(JSON.stringify({ items: [], cursor: null }))); await new Promise(resolve => setTimeout(resolve, 0)); expect(f.catalog.targets).toEqual(previous);
});

it('并发refresh单飞，最多一个HTTP，调用方获得同一完整目录', async () => {
  const f = fixture(); let finish!: () => void; let entered!: () => void; const wait = new Promise<void>(resolve => { entered = resolve; });
  f.setHandler(async () => { entered(); await new Promise<void>(resolve => { finish = resolve; }); return new Response(JSON.stringify({ items: [target()], cursor: null })); });
  const pending = Array.from({ length: 40 }, () => f.catalog.refresh()); await wait; expect(f.calls).toHaveLength(1); finish(); const results = await Promise.all(pending); expect(results.every(value => value.length === 1)).toBe(true);
});

it('响应流挂起也超时并取消，不继续消耗无界body', async () => {
  const f = fixture(); let canceled = false;
  f.setHandler(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { canceled = true; } })));
  await expect(f.catalog.refresh()).rejects.toBeInstanceOf(RemoteNetworkError); expect(canceled).toBe(true); expect(f.catalog.targets).toEqual([]);
});

it('官方pair响应核对自己的client/code/env，刷新目录双ID匹配后才发布配对结果', async () => {
  const f = fixture(); f.setHandler(async (url, init) => {
    if (url.endsWith('/client/pair')) { expect(init?.method).toBe('POST'); expect(JSON.parse(init!.body as string)).toEqual({ client_id: 'own/client', pairing_code: 'private-pairing-code' }); return new Response(JSON.stringify({ pairing_code: 'private-pairing-code', client_id: 'own/client', server_id: 'server', environment_id: 'mac-env', claimed_at: '2026-11-13T00:00:00Z' })); }
    return new Response(JSON.stringify({ items: [target()], cursor: null }));
  });
  const result = await f.catalog.pair({ pairingCode: 'private-pairing-code', expected: { environmentId: 'mac-env', installationId: 'mac-install' }, expiresAt: NOW / 1000 + 60 });
  expect(result).toMatchObject({ env_id: 'mac-env', installation_id: 'mac-install' }); expect(f.calls[0]!.url).toBe('https://chatgpt.com/backend-api/wham/remote/control/client/pair'); expect(JSON.stringify(result)).not.toContain('private-pairing-code');
});

it.each(['expired', 'client', 'code', 'environment', 'installation', 'claimed-at'] as const)('pair %s失败保持原目录，不日志/透传pairing code', async failure => {
  const f = fixture(); await f.catalog.refresh(); const previous = f.catalog.targets;
  f.setHandler(async url => new Response(JSON.stringify(url.endsWith('/client/pair') ? { pairing_code: failure === 'code' ? 'wrong' : 'private-pairing-code', client_id: failure === 'client' ? 'wrong' : 'own/client', server_id: 'server', environment_id: failure === 'environment' ? 'wrong' : 'mac-env', claimed_at: failure === 'claimed-at' ? 123 : '2026-11-13T00:00:00Z' } : { items: [target({ installation_id: failure === 'installation' ? 'replacement' : 'mac-install' })], cursor: null })));
  const error = await f.catalog.pair({ pairingCode: 'private-pairing-code', expected: { environmentId: 'mac-env', installationId: 'mac-install' }, expiresAt: NOW / 1000 + (failure === 'expired' ? -1 : 60) }).catch(error => error);
  expect(error).toBeInstanceOf(RemoteCatalogError); expect(error.message).not.toContain('private-pairing-code'); expect(f.catalog.targets).toEqual(previous); if (failure === 'expired') expect(f.calls).toHaveLength(1);
});

it('refresh正在进行时pair有界拒绝，close后不存在晚发布或新的HTTP', async () => {
  const f = fixture(); let finish!: (response: Response) => void; let entered!: () => void; const wait = new Promise<void>(resolve => { entered = resolve; });
  f.setHandler(async () => { entered(); return new Promise(resolve => { finish = resolve; }); }); const pending = f.catalog.refresh().catch(error => error); await wait;
  await expect(f.catalog.pair({ pairingCode: 'private-pairing-code', expected: { environmentId: 'mac-env', installationId: 'mac-install' } })).rejects.toBeInstanceOf(RemoteCatalogError);
  expect(f.calls).toHaveLength(1); f.catalog.close(); await pending; finish(new Response(JSON.stringify({ items: [target()], cursor: null }))); await new Promise(resolve => setTimeout(resolve, 0)); expect(f.catalog.targets).toEqual([]);
});

it('可选展示字段允许空字符串与null，不把展示字段当身份', async () => {
  const f = fixture(); f.setHandler(async () => new Response(JSON.stringify({ items: [target({ display_name: '', host_name: '', terminal: '', client_name: null })], cursor: null })));
  expect((await f.catalog.refresh())[0]).toMatchObject({ display_name: '', host_name: '', terminal: '', client_name: null });
});
