// @vitest-environment node
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RemoteAuthProviderImpl, parseManagedAuthRecord, deviceIdentityHash, type ManagedAuth } from '../../server/remote/auth.js';
import { PrivateStore } from '../../server/remote/private-store.js';
import type { DeviceIdentity, DeviceKeySigner } from '../../server/remote/device-key.js';
import { RemoteAuthRequiredError } from '../../server/remote/relay.js';

const NOW = 1800000000000;
const ACCOUNT = 'workspace-one';
const USER = 'user-one-workspace';
const BASE_USER = 'user-one';
const SCOPE = 'remote_control_controller_websocket';
const AUTH_NS = 'https://api.openai.com/auth';
const roots: string[] = [];
const jwt = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`;
const normalToken = (overrides: object = {}) => jwt({ exp: NOW / 1000 + 3600, [AUTH_NS]: { chatgpt_account_id: ACCOUNT, chatgpt_account_user_id: USER, user_id: BASE_USER }, ...overrides });
const stepUp = (overrides: object = {}) => jwt({ exp: NOW / 1000 + 300, iat: NOW / 1000, pwd_auth_time: NOW, scope: 'codex.remote_control.enroll', [AUTH_NS]: { chatgpt_account_id: ACCOUNT, chatgpt_account_user_id: USER, user_id: BASE_USER }, ...overrides });
function normalAuth(): ManagedAuth { return parseManagedAuthRecord({ tokens: { access_token: normalToken(), account_id: ACCOUNT } }); }
const hash = (text: string) => createHash('sha256').update(text).digest('base64url');
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'remote-auth-test-')); roots.push(root);
  const store = new PrivateStore(join(root, 'owned'));
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const identity: DeviceIdentity = { keyId: 'own-key', algorithm: 'ecdsa_p256_sha256', protectionClass: 'hardware_secure_enclave', publicKeySpkiDerBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  let signed = 0; let auth = normalAuth(); let backendUser = BASE_USER; let clock = NOW;
  let mutateStart = (value: Record<string, unknown>) => value;
  let mutateFinish = (value: Record<string, unknown>) => value;
  let responseStatus = 200;
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const deviceKey: DeviceKeySigner = {
    getIdentity: async () => identity,
    sign: async bytes => { signed++; return sign('sha256', bytes, pair.privateKey).toString('base64'); },
  };
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    calls.push({ url, init: init!, body });
    if (responseStatus !== 200) return new Response('secret response body', { status: responseStatus });
    const operation = url.includes('/enroll/') ? 'enroll' : 'refresh';
    let value: Record<string, unknown>;
    if (url.endsWith('/start')) value = mutateStart({ client_id: 'own-client', account_user_id: backendUser, device_key_challenge: {
      client_id: 'own-client', account_user_id: backendUser, purpose: 'remote_control_client_enrollment', audience: 'remote_control_client_enrollment', target_origin: 'https://chatgpt.com', target_path: `/backend-api/codex/remote/control/client/${operation}/finish`, challenge_expires_at: NOW / 1000 + 120, challenge_id: 'challenge-one', nonce: 'nonce-one', challenge_token: 'challenge-token', ...(operation === 'refresh' ? { device_identity_hash: deviceIdentityHash(identity) } : {}),
    } });
    else value = mutateFinish({ client_id: 'own-client', account_user_id: backendUser, scopes: [SCOPE], expires_at: new Date(NOW + 3600000).toISOString(), remote_control_token: 'remote-session-secret' });
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  };
  const options = { store, deviceKey, loadManagedAuth: async () => auth, fetch: fetcher as typeof fetch, now: () => clock, requestTimeoutMs: 100, signTimeoutMs: 100 };
  const provider = new RemoteAuthProviderImpl(options);
  return { root, store, identity, deviceKey, calls, provider, options, signed: () => signed,
    advance: (milliseconds: number) => { clock += milliseconds; },
    setAuth: (value: ManagedAuth) => { auth = value; }, setBackendUser: (value: string) => { backendUser = value; },
    setStart: (mutate: typeof mutateStart) => { mutateStart = mutate; }, setFinish: (mutate: typeof mutateFinish) => { mutateFinish = mutate; }, setStatus: (status: number) => { responseStatus = status; },
  };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
function challenge(session = 'remote-session-secret') {
  return { type: 'device_key_challenge', clientId: 'own-client', accountUserId: BASE_USER, targetOrigin: 'https://chatgpt.com', targetPath: '/backend-api/codex/remote/control/client', purpose: 'remote_control_client_websocket', audience: 'remote_control_client_websocket', tokenSha256Base64url: hash(session), tokenExpiresAt: NOW / 1000 + 3600, scopes: [SCOPE], nonce: 'ws-nonce', sessionId: 'ws-session' };
}
function mutateChallenge(start: Record<string, unknown>, changes: object) { return { ...start, device_key_challenge: { ...(start.device_key_challenge as object), ...changes } }; }

describe('普通账号令牌归一化', () => {
  it('解析canonical与兼容claim并验证所选workspace', () => {
    expect(normalAuth()).toMatchObject({ accountId: ACCOUNT, accountUserId: USER, userId: BASE_USER });
    const access = normalToken({ [AUTH_NS]: { account_id: ACCOUNT, account_user_id: USER, user_id: BASE_USER } });
    expect(parseManagedAuthRecord({ tokens: { access_token: access, account_id: ACCOUNT, refresh_token: 'never-consumed' } })).toMatchObject({ accessToken: access, accountId: ACCOUNT, accountUserId: USER });
    expect(() => parseManagedAuthRecord({ tokens: { access_token: access, account_id: 'other' } })).toThrow(RemoteAuthRequiredError);
  });
  it('明确active ChatGPT模式只消费完整账号tokens，兼容历史API key字段', () => {
    expect(parseManagedAuthRecord({ auth_mode: 'chatgpt', OPENAI_API_KEY: 'historical-unused-key', tokens: { access_token: normalToken(), account_id: ACCOUNT } })).toEqual(normalAuth());
    expect(() => parseManagedAuthRecord({ auth_mode: 'chatgpt', OPENAI_API_KEY: 'historical-unused-key' })).toThrow(RemoteAuthRequiredError);
  });
  it.each(['apikey', undefined, null, 'unknown'])('active API key或不明确的混合模式 %s 不猜测fallback', auth_mode => {
    expect(() => parseManagedAuthRecord({ ...(auth_mode === undefined ? {} : { auth_mode }), OPENAI_API_KEY: 'historical-unused-key', tokens: { access_token: normalToken(), account_id: ACCOUNT } })).toThrow(RemoteAuthRequiredError);
  });
  it('拒绝API key、不完整JWT与猜测credential fallback', () => {
    for (const value of [{ OPENAI_API_KEY: 'sk-secret' }, { auth_mode: 'apikey', tokens: { access_token: normalToken(), account_id: ACCOUNT } }, { tokens: { access_token: 'bad', account_id: ACCOUNT } }, { access_token: normalToken(), account_id: ACCOUNT }]) expect(() => parseManagedAuthRecord(value)).toThrow(RemoteAuthRequiredError);
  });
});

describe('自己的Remote enrollment', () => {
  it('精确接受JWT base user，按官方字段和顺序签名，只持久化自己的绑定', async () => {
    const f = await fixture();
    const enrollment = await f.provider.enroll(stepUp());
    expect(enrollment).toMatchObject({ clientId: 'own-client', accountId: ACCOUNT, accountUserId: BASE_USER, managedAccountUserId: USER, identityHash: deviceIdentityHash(f.identity) });
    expect(f.signed()).toBe(1);
    const body = f.calls[1]!.body;
    expect(body.step_up_token).toBe(stepUp());
    expect(body.device_identity).toEqual({ key_id: f.identity.keyId, public_key_spki_der_base64: f.identity.publicKeySpkiDerBase64, algorithm: f.identity.algorithm, protection_class: f.identity.protectionClass });
    const proof = body.device_key_proof as Record<string, string>;
    expect(Object.keys(proof)).toEqual(['challenge_token', 'key_id', 'signature_der_base64', 'signed_payload_base64', 'algorithm']);
    const signed = JSON.parse(Buffer.from(proof.signed_payload_base64!, 'base64').toString());
    expect(signed.domain).toBe('codex-device-key-sign-payload/v1');
    expect(Object.keys(signed.payload)).toEqual(['accountUserId', 'audience', 'challengeExpiresAt', 'challengeId', 'clientId', 'deviceIdentitySha256Base64url', 'nonce', 'targetOrigin', 'targetPath', 'type']);
    expect(signed.payload.type).toBe('remoteControlClientEnrollment');
    const persisted = await readFile(join(f.store.directory, 'enrollment.json'), 'utf8');
    expect(persisted).not.toContain('secret'); expect(persisted).not.toContain('step_up');
    for (const call of f.calls) {
      expect(call.url).not.toContain('secret'); expect(call.init.redirect).toBe('error'); expect(call.init.signal).toBeInstanceOf(AbortSignal);
      expect(call.init.headers).toMatchObject({ Authorization: `Bearer ${normalToken()}`, 'ChatGPT-Account-Id': ACCOUNT, Accept: 'application/json', originator: 'Codex Desktop', 'User-Agent': 'CodexMobile-Gateway' });
    }
  });
  it('两个独立provider实例竞争初次注册时只调用一次REST start并拒绝第二个', async () => {
    const f = await fixture(); const second = new RemoteAuthProviderImpl({ ...f.options, store: new PrivateStore(f.store.directory) });
    const results = await Promise.allSettled([f.provider.enroll(stepUp()), second.enroll(stepUp())]);
    const fulfilled = results.filter(result => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(f.calls.filter(call => call.url.endsWith('/start'))).toHaveLength(1);
    const success = fulfilled[0]! as PromiseFulfilledResult<Awaited<ReturnType<typeof f.provider.enroll>>>;
    expect(await f.store.readJson('enrollment.json')).toEqual(success.value);
  });
  it('精确接受canonical account user但不接受prefix或其他用户', async () => {
    const f = await fixture(); f.setBackendUser(USER);
    expect((await f.provider.enroll(stepUp())).accountUserId).toBe(USER);
    const g = await fixture(); g.setBackendUser(BASE_USER + '-unrelated');
    await expect(g.provider.enroll(stepUp())).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(g.signed()).toBe(0); expect(await g.store.readJson('enrollment.json')).toBeNull();
  });
  it.each([
    ['client_id', 'other'], ['account_user_id', 'other'], ['purpose', 'wrong'], ['audience', 'wrong'], ['target_origin', 'https://evil.example'], ['target_path', '/elsewhere'], ['device_identity_hash', 'wrong'], ['challenge_expires_at', NOW / 1000], ['challenge_expires_at', NOW / 1000 + 3600], ['challenge_expires_at', 'future'], ['challenge_id', ''], ['nonce', ''], ['challenge_token', ''],
  ])('绑定校验失败 %s=%s 时不得签名或持久化', async (key, value) => {
    const f = await fixture(); f.setStart(start => mutateChallenge(start, { [key]: value }));
    await expect(f.provider.enroll(stepUp())).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.signed()).toBe(0); expect(await f.store.readJson('enrollment.json')).toBeNull();
  });
  it.each([
    { iat: NOW / 1000 - 301 }, { iat: NOW / 1000 + 1 }, { pwd_auth_time: NOW - 300001 }, { pwd_auth_time: NOW + 1 }, { exp: NOW / 1000 }, { scope: 'codex.remote_control.enroll other' }, { scope: '' }, { [AUTH_NS]: { chatgpt_account_id: 'other', chatgpt_account_user_id: USER } }, { [AUTH_NS]: { chatgpt_account_id: ACCOUNT, chatgpt_account_user_id: BASE_USER } },
  ])('拒绝不新鲜或不属于当前canonical身份的step-up %j', async overrides => {
    const f = await fixture();
    await expect(f.provider.enroll(stepUp(overrides))).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.signed()).toBe(0); expect(f.calls).toEqual([]);
  });
  it('从scope与scp合并精确scope；重复显式enroll不替换现有记录', async () => {
    const f = await fixture();
    await f.provider.enroll(stepUp({ scope: '', scp: ['codex.remote_control.enroll'] }));
    const before = await f.store.readJson('enrollment.json');
    await expect(f.provider.enroll(stepUp())).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(await f.store.readJson('enrollment.json')).toEqual(before); expect(f.calls).toHaveLength(2);
  });
  it.each([{ client_id: 'other' }, { account_user_id: 'other' }, { scopes: [SCOPE, 'extra'] }, { expires_at: 'invalid' }, { expires_at: new Date(NOW).toISOString() }, { remote_control_token: '' }])('拒绝错误finish响应，不持久化 %j', async change => {
    const f = await fixture(); f.setFinish(value => ({ ...value, ...change }));
    await expect(f.provider.enroll(stepUp())).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(await f.store.readJson('enrollment.json')).toBeNull();
  });
});

describe('Remote refresh与WebSocket证明', () => {
  it('重启后singleflight refresh并仅以headers提供令牌，WS证明为one-shot', async () => {
    const f = await fixture(); await f.provider.enroll(stepUp()); f.calls.length = 0;
    const provider = new RemoteAuthProviderImpl(f.options);
    const connections = await Promise.all(Array.from({ length: 8 }, () => provider.prepareConnection()));
    expect(f.calls.map(call => call.url.split('/').at(-2))).toEqual(['refresh', 'refresh']);
    const connection = connections[0]!;
    expect(connection.url).toBe('wss://chatgpt.com/backend-api/codex/remote/control/client');
    expect(connection.headers).toMatchObject({ 'x-codex-client-id': 'own-client', 'x-codex-protocol-version': '3', 'x-codex-client-session-token': 'Bearer remote-session-secret' });
    const before = f.signed();
    const proof = await connection.signChallenge(challenge()) as Record<string, string>;
    expect(Object.keys(proof)).toEqual(['keyId', 'signatureDerBase64', 'signedPayloadBase64', 'algorithm']);
    const payload = JSON.parse(Buffer.from(proof.signedPayloadBase64!, 'base64').toString()).payload;
    expect(Object.keys(payload)).toEqual(['accountUserId', 'audience', 'clientId', 'nonce', 'scopes', 'sessionId', 'targetOrigin', 'targetPath', 'tokenExpiresAt', 'tokenSha256Base64url', 'type']);
    expect(payload.accountUserId).toBe(BASE_USER); expect(payload.type).toBe('remoteControlClientConnection');
    await expect(connection.signChallenge(challenge())).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.signed()).toBe(before + 1);
    expect(await new RemoteAuthProviderImpl(f.options).getEnrollment()).toMatchObject({ accountUserId: BASE_USER });
  });
  it.each([
    ['clientId', 'other'], ['accountUserId', USER], ['targetOrigin', 'https://evil.example'], ['targetPath', '/elsewhere'], ['purpose', 'wrong'], ['audience', 'wrong'], ['tokenSha256Base64url', 'wrong'], ['tokenExpiresAt', NOW / 1000 + 1], ['scopes', [SCOPE, 'extra']], ['nonce', ''], ['sessionId', ''], ['type', 'wrong'],
  ])('WS错误绑定 %s 不签名', async (key, value) => {
    const f = await fixture(); await f.provider.enroll(stepUp()); const connection = await f.provider.prepareConnection(); const before = f.signed();
    await expect(connection.signChallenge({ ...challenge(), [key]: value })).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.signed()).toBe(before);
  });
  it('prepare/REST/sign都重新核对账号和workspace，切换后暂停且保留record', async () => {
    const f = await fixture(); await f.provider.enroll(stepUp()); const connection = await f.provider.prepareConnection(); const before = f.signed(); const stored = await f.store.readJson('enrollment.json');
    f.setAuth({ ...normalAuth(), accountId: 'other' });
    await expect(connection.signChallenge(challenge())).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    await expect(f.provider.prepareConnection()).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.signed()).toBe(before); expect(await f.store.readJson('enrollment.json')).toEqual(stored);
  });
  it('REST start后切换账号时在签名前暂停', async () => {
    const f = await fixture(); await f.provider.enroll(stepUp());
    f.setStart(start => { f.setAuth({ ...normalAuth(), accountUserId: 'other-user' }); return start; });
    const before = f.signed();
    await expect(new RemoteAuthProviderImpl(f.options).prepareConnection()).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.signed()).toBe(before);
  });
  it.each([401, 403, 404, 410])('撤销HTTP %s暂停认证且不覆盖现有绑定', async status => {
    const f = await fixture(); await f.provider.enroll(stepUp()); const stored = await f.store.readJson('enrollment.json'); f.setStatus(status); const before = f.signed();
    await expect(new RemoteAuthProviderImpl(f.options).prepareConnection()).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.signed()).toBe(before); expect(await f.store.readJson('enrollment.json')).toEqual(stored);
  });
  it('refresh必须有自己的identity hash且绑定backend精确account user', async () => {
    const f = await fixture(); await f.provider.enroll(stepUp()); f.setStart(start => mutateChallenge(start, { device_identity_hash: undefined })); const before = f.signed();
    await expect(new RemoteAuthProviderImpl(f.options).prepareConnection()).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.signed()).toBe(before);
  });
  it('网络暂错可重试、错误脱敏且singleflight失败后可重新refresh', async () => {
    const f = await fixture(); await f.provider.enroll(stepUp()); f.setStatus(503); const provider = new RemoteAuthProviderImpl(f.options);
    const first = await provider.prepareConnection().catch(error => error);
    expect(first).not.toBeInstanceOf(RemoteAuthRequiredError); expect(first.message).not.toContain('secret');
    f.setStatus(200); expect((await provider.prepareConnection()).headers['x-codex-client-id']).toBe('own-client');
  });
  it('fetch不响应也会在bounded timeout结束，sign超时和错误proof不提交finish', async () => {
    const f = await fixture(); await f.provider.enroll(stepUp());
    const stalledFetch = new RemoteAuthProviderImpl({ ...f.options, requestTimeoutMs: 20, fetch: (() => new Promise(() => {})) as typeof fetch });
    await expect(stalledFetch.prepareConnection()).rejects.toThrow('超时');
    const before = f.calls.length;
    const stalledSign = new RemoteAuthProviderImpl({ ...f.options, signTimeoutMs: 20, deviceKey: { ...f.deviceKey, sign: async () => new Promise(() => {}) } });
    await expect(stalledSign.prepareConnection()).rejects.toThrow('超时');
    expect(f.calls).toHaveLength(before + 1);
    const invalidSign = new RemoteAuthProviderImpl({ ...f.options, deviceKey: { ...f.deviceKey, sign: async () => 'YmFk' } });
    await expect(invalidSign.prepareConnection()).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.calls).toHaveLength(before + 2);
  });
  it('硬件签名等待期间过期，不提交finish或返回WS证明', async () => {
    const f = await fixture();
    const originalSign = f.deviceKey.sign;
    f.deviceKey.sign = async bytes => { const proof = await originalSign(bytes); f.advance(301000); return proof; };
    await expect(f.provider.enroll(stepUp())).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.calls).toHaveLength(1); expect(await f.store.readJson('enrollment.json')).toBeNull();
    const g = await fixture(); await g.provider.enroll(stepUp()); const connection = await g.provider.prepareConnection();
    const wsSign = g.deviceKey.sign;
    g.deviceKey.sign = async bytes => { const proof = await wsSign(bytes); g.advance(3600001); return proof; };
    await expect(connection.signChallenge(challenge())).rejects.toBeInstanceOf(RemoteAuthRequiredError);
  });
  it.each([
    { clientId: 'replacement-client' }, { accountId: 'replacement-workspace' }, { accountUserId: 'replacement-user' }, { managedAccountUserId: 'replacement-canonical-user' }, null,
  ])('WS签名等待期间替换或删除注册绑定 %j 时不返回旧证明', async change => {
    const f = await fixture(); await f.provider.enroll(stepUp()); const connection = await f.provider.prepareConnection();
    const stored = await f.store.readJson('enrollment.json') as object;
    let entered!: () => void; let resume!: () => void;
    const signing = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { resume = resolve; });
    const originalSign = f.deviceKey.sign;
    f.deviceKey.sign = async bytes => { const proof = await originalSign(bytes); entered(); await gate; return proof; };
    const pending = connection.signChallenge(challenge());
    await signing;
    if (change) await f.store.writeJson('enrollment.json', { ...stored, ...change });
    else await rm(join(f.store.directory, 'enrollment.json'));
    resume();
    await expect(pending).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(await f.store.readJson('enrollment.json')).toEqual(change ? { ...stored, ...change } : null);
  });
  it('WS签名等待期间自己的hardware identity变化时不返回旧证明', async () => {
    const f = await fixture(); await f.provider.enroll(stepUp()); const connection = await f.provider.prepareConnection();
    const replacement = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const originalSign = f.deviceKey.sign;
    f.deviceKey.sign = async bytes => { const proof = await originalSign(bytes); f.deviceKey.getIdentity = async () => ({ ...f.identity, publicKeySpkiDerBase64: replacement }); return proof; };
    await expect(connection.signChallenge(challenge())).rejects.toBeInstanceOf(RemoteAuthRequiredError);
  });
  it('初次enroll签名等待期间自己的hardware identity变化时不得提交finish', async () => {
    const f = await fixture(); const originalSign = f.deviceKey.sign;
    f.deviceKey.sign = async bytes => { const proof = await originalSign(bytes); f.deviceKey.getIdentity = async () => ({ ...f.identity, keyId: 'replacement-key' }); return proof; };
    await expect(f.provider.enroll(stepUp())).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.calls).toHaveLength(1); expect(await f.store.readJson('enrollment.json')).toBeNull();
  });
  it('硬件身份读取错误脱敏', async () => {
    const f = await fixture(); await f.provider.enroll(stepUp());
    const provider = new RemoteAuthProviderImpl({ ...f.options, deviceKey: { ...f.deviceKey, getIdentity: async () => { throw new Error('secret-key-location'); } } });
    const error = await provider.prepareConnection().catch(error => error);
    expect(error).toBeInstanceOf(RemoteAuthRequiredError); expect(error.message).not.toContain('secret');
  });
  it('存储损坏或own key变化时不refresh、不重新enroll', async () => {
    const f = await fixture(); await f.provider.enroll(stepUp());
    const before = f.calls.length;
    const changed = new RemoteAuthProviderImpl({ ...f.options, deviceKey: { ...f.deviceKey, getIdentity: async () => ({ ...f.identity, keyId: 'different-key' }) } });
    await expect(changed.prepareConnection()).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    await f.store.writeJson('enrollment.json', { clientId: 'broken' });
    await expect(f.provider.prepareConnection()).rejects.toBeInstanceOf(RemoteAuthRequiredError);
    expect(f.calls).toHaveLength(before);
  });
});
