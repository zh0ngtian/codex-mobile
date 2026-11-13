import { PrivateStore } from './private-store.js';
import { validateDeviceIdentity, verifyDeviceSignature, type DeviceIdentity, type DeviceKeySigner } from './device-key.js';
import { RemoteAuthRequiredError, type RemoteAuthProvider, type RemoteConnectionAuth } from './relay.js';
import {
  REMOTE_CLIENT_PATH, REMOTE_ORIGIN, assertAccount, deviceIdentityHash, invalid, parseEnrollment,
  validateManagedAuth, validateRestStart, validateSession, validateStepUp, websocketPayload,
  type EnrollmentRecord, type ManagedAuth, type RemoteSession, type RestChallenge,
} from './auth-protocol.js';
export { parseManagedAuthRecord, deviceIdentityHash } from './auth-protocol.js';
export type { ManagedAuth, EnrollmentRecord } from './auth-protocol.js';

export class RemoteNetworkError extends Error {
  constructor(message = 'Remote 网络暂时不可用') { super(message); this.name = 'RemoteNetworkError'; }
}
interface AuthOptions {
  store: PrivateStore; deviceKey: DeviceKeySigner; loadManagedAuth: () => Promise<ManagedAuth>;
  fetch?: typeof fetch; now?: () => number; requestTimeoutMs?: number; signTimeoutMs?: number;
}
type Binding = { accountId: string; managedAccountUserId: string; accountUserId?: string };
interface DeviceProof { keyId: string; signatureDerBase64: string; signedPayloadBase64: string; algorithm: 'ecdsa_p256_sha256' }
function timeoutValue(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > 180000) throw new Error('Remote 超时配置无效');
  return result;
}
async function bounded<T>(promise: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { onTimeout?.(); reject(new RemoteNetworkError('Remote 操作超时')); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
/** 外部回调可能自行抛出同类型错误；仅采用分类，不采用其文本或 cause。 */
async function external<T>(operation: () => Promise<T>, authMessage: string, defaultNetwork = false): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof RemoteNetworkError || (defaultNetwork && !(error instanceof RemoteAuthRequiredError))) throw new RemoteNetworkError();
    throw new RemoteAuthRequiredError(authMessage);
  }
}

/** 官方 Remote 协议只使用网关自己的注册身份；普通账号刷新由调用方管理。 */
export class RemoteAuthProviderImpl implements RemoteAuthProvider {
  private readonly requestTimeoutMs: number;
  private readonly signTimeoutMs: number;
  private readonly now: () => number;
  private readonly fetcher: typeof fetch;
  private session?: { record: string; value: RemoteSession };
  private refreshing?: Promise<RemoteSession>;
  private enrolling = false;
  constructor(private readonly options: AuthOptions) {
    this.requestTimeoutMs = timeoutValue(options.requestTimeoutMs, 20000);
    this.signTimeoutMs = timeoutValue(options.signTimeoutMs, 10000);
    this.now = options.now ?? Date.now;
    this.fetcher = options.fetch ?? globalThis.fetch;
  }
  async getEnrollment(): Promise<EnrollmentRecord | null> {
    try {
      const value = await this.options.store.readJson('enrollment.json');
      return value === null ? null : parseEnrollment(value);
    } catch { throw new RemoteAuthRequiredError('Remote 注册记录不可用，需要重新认证'); }
  }
  private async loadAuth(binding?: Binding): Promise<ManagedAuth> {
    let auth: ManagedAuth;
    try { auth = validateManagedAuth(await bounded(external(() => this.options.loadManagedAuth(), '普通账号认证不可用'), this.requestTimeoutMs)); }
    catch (error) { if (error instanceof RemoteNetworkError || error instanceof RemoteAuthRequiredError) throw error; throw new RemoteAuthRequiredError('普通账号认证不可用'); }
    if (binding) assertAccount(auth, binding);
    return auth;
  }
  private async identity(record?: EnrollmentRecord): Promise<DeviceIdentity> {
    let identity: DeviceIdentity;
    try { identity = validateDeviceIdentity(await bounded(external(() => this.options.deviceKey.getIdentity(), '自己的 Remote 硬件身份不可用'), this.signTimeoutMs)); }
    catch (error) { if (error instanceof RemoteNetworkError) throw error; throw new RemoteAuthRequiredError('自己的 Remote 硬件身份不可用'); }
    if (record && (deviceIdentityHash(identity) !== record.identityHash || JSON.stringify(identity) !== JSON.stringify(record.identity))) invalid();
    return identity;
  }
  private async recheck(record: EnrollmentRecord): Promise<void> {
    // 硬件 helper 是最慢的 await；其后再读取账号和注册记录，不能让
    // helper 等待期间已完成的绑定变化落在最终复核之外。
    await this.identity(record);
    await this.loadAuth(record);
    const current = await this.getEnrollment();
    if (!current || JSON.stringify(current) !== JSON.stringify(record)) invalid();
  }
  async enroll(stepUpToken: string): Promise<EnrollmentRecord> {
    if (this.enrolling) invalid();
    this.enrolling = true;
    try {
      return await this.options.store.withInitialization('enrollment', async () => {
        if (await this.getEnrollment()) invalid();
        const auth = await this.loadAuth();
        validateStepUp(stepUpToken, auth, this.now());
        const identity = await this.identity();
        const binding = { accountId: auth.accountId, managedAccountUserId: auth.accountUserId };
        const start = validateRestStart(await this.post('enroll/start', {}, binding), { operation: 'enroll', identityHash: deviceIdentityHash(identity), auth }, this.now());
        const ownBinding = { ...binding, accountUserId: start.accountUserId };
        await this.loadAuth(ownBinding); validateStepUp(stepUpToken, auth, this.now());
        const proof = await this.sign(start.challenge.payload, identity, ownBinding);
        validateStepUp(stepUpToken, await this.loadAuth(ownBinding), this.now());
        const result = await this.post('enroll/finish', { client_id: start.clientId, step_up_token: stepUpToken,
          device_identity: { key_id: identity.keyId, public_key_spki_der_base64: identity.publicKeySpkiDerBase64, algorithm: identity.algorithm, protection_class: identity.protectionClass },
          device_key_proof: this.restProof(start.challenge, proof) }, ownBinding);
        const session = validateSession(result, start, this.now());
        if (deviceIdentityHash(await this.identity()) !== deviceIdentityHash(identity)) invalid();
        await this.loadAuth(ownBinding);
        if (await this.getEnrollment()) invalid();
        const record: EnrollmentRecord = { version: 1, clientId: start.clientId, accountId: auth.accountId, accountUserId: start.accountUserId, managedAccountUserId: auth.accountUserId, identityHash: deviceIdentityHash(identity), identity };
        if (!await this.options.store.createJson('enrollment.json', record)) invalid();
        const authoritative = await this.getEnrollment();
        if (!authoritative || JSON.stringify(authoritative) !== JSON.stringify(record)) invalid();
        this.session = { record: JSON.stringify(authoritative), value: session };
        return authoritative;
      });
    } finally { this.enrolling = false; }
  }
  async prepareConnection(): Promise<RemoteConnectionAuth> {
    const record = await this.getEnrollment();
    if (!record) throw new RemoteAuthRequiredError('网关尚未注册自己的 Remote 身份');
    await this.recheck(record);
    let session = this.session?.record === JSON.stringify(record) ? this.session.value : undefined;
    if (!session || session.expiresAt <= this.now() + 30000) {
      this.refreshing ??= this.refresh(record).finally(() => { this.refreshing = undefined; });
      session = await this.refreshing;
    }
    const auth = await this.loadAuth(record);
    const activeSession = session;
    let used = false;
    return {
      url: `wss://chatgpt.com${REMOTE_CLIENT_PATH}`,
      headers: { ...this.headers(auth), 'x-codex-client-id': record.clientId, 'x-codex-protocol-version': '3', 'x-codex-client-session-token': `Bearer ${activeSession.token}` },
      signChallenge: async challenge => {
        if (used) invalid(); used = true;
        const payload = websocketPayload(challenge, record, activeSession, this.now());
        await this.recheck(record);
        // 再次检查有效期，避免认证读取/硬件操作等待期间过期。
        websocketPayload(challenge, record, activeSession, this.now());
        return this.sign(payload, record.identity, record, record);
      },
    };
  }
  private async refresh(record: EnrollmentRecord): Promise<RemoteSession> {
    await this.recheck(record);
    const auth = await this.loadAuth(record);
    const start = validateRestStart(await this.post('refresh/start', { client_id: record.clientId }, record, record), { operation: 'refresh', clientId: record.clientId, accountUserId: record.accountUserId, identityHash: record.identityHash, auth }, this.now());
    const proof = await this.sign(start.challenge.payload, record.identity, record, record);
    const result = await this.post('refresh/finish', { client_id: record.clientId, device_key_proof: this.restProof(start.challenge, proof) }, record, record);
    const session = validateSession(result, record, this.now());
    await this.recheck(record);
    this.session = { record: JSON.stringify(record), value: session };
    return session;
  }
  private async sign(payload: Record<string, unknown>, identity: DeviceIdentity, binding: Binding, record?: EnrollmentRecord): Promise<DeviceProof> {
    if (record) await this.recheck(record);
    await this.loadAuth(binding);
    if (deviceIdentityHash(await this.identity(record)) !== deviceIdentityHash(identity)) invalid();
    if (typeof payload.challengeExpiresAt === 'number' && payload.challengeExpiresAt <= this.now() / 1000) invalid();
    if (typeof payload.tokenExpiresAt === 'number' && payload.tokenExpiresAt <= this.now() / 1000) invalid();
    const bytes = Buffer.from(JSON.stringify({ domain: 'codex-device-key-sign-payload/v1', payload }));
    let signature: string;
    try { signature = await bounded(external(() => this.options.deviceKey.sign(bytes), 'Remote 硬件签名失败'), this.signTimeoutMs); }
    catch (error) { if (error instanceof RemoteNetworkError) throw error; throw new RemoteAuthRequiredError('Remote 硬件签名失败'); }
    if (!verifyDeviceSignature(identity, bytes, signature)) invalid();
    // 硬件签名可能等待：证明离开 provider 前重新读取全部持久化绑定与自己的密钥。
    if (record) await this.recheck(record);
    else {
      if (deviceIdentityHash(await this.identity()) !== deviceIdentityHash(identity)) invalid();
      await this.loadAuth(binding);
      if (await this.getEnrollment()) invalid();
    }
    if (typeof payload.challengeExpiresAt === 'number' && payload.challengeExpiresAt <= this.now() / 1000) invalid();
    if (typeof payload.tokenExpiresAt === 'number' && payload.tokenExpiresAt <= this.now() / 1000) invalid();
    return { keyId: identity.keyId, signatureDerBase64: signature, signedPayloadBase64: bytes.toString('base64'), algorithm: identity.algorithm };
  }
  private restProof(challenge: RestChallenge, proof: DeviceProof): object {
    return { challenge_token: challenge.token, key_id: proof.keyId, signature_der_base64: proof.signatureDerBase64, signed_payload_base64: proof.signedPayloadBase64, algorithm: proof.algorithm };
  }
  private headers(auth: ManagedAuth): Record<string, string> {
    return { Authorization: `Bearer ${auth.accessToken}`, 'ChatGPT-Account-Id': auth.accountId, Accept: 'application/json', originator: 'Codex Desktop', 'User-Agent': 'CodexMobile-Gateway' };
  }
  private async post(route: string, body: object, binding: Binding, record?: EnrollmentRecord): Promise<unknown> {
    if (record) await this.recheck(record);
    const auth = await this.loadAuth(binding);
    const controller = new AbortController();
    try {
      // fetch 返回后的响应流仍是外部输入；与 fetch 本身共用脱敏边界。
      // bounded 位于其外，保留 provider 自己产生的超时提示。
      return await bounded(external(async () => {
        const response = await this.fetcher(`${REMOTE_ORIGIN}${REMOTE_CLIENT_PATH}/${route}`, { method: 'POST', headers: { ...this.headers(auth), 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: controller.signal });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) throw new RemoteAuthRequiredError('Remote 认证已失效或被拒绝');
          throw new RemoteNetworkError();
        }
        const reader = response.body?.getReader();
        if (!reader) invalid();
        let size = 0; const chunks: Uint8Array[] = [];
        try {
          while (true) {
            const next = await reader.read(); if (next.done) break;
            size += next.value.byteLength;
            if (size > 128 * 1024) { void reader.cancel().catch(() => undefined); invalid(); }
            chunks.push(next.value);
          }
          try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { return invalid(); }
        } finally { reader.releaseLock(); }
      }, 'Remote 认证已失效或被拒绝', true), this.requestTimeoutMs, () => controller.abort());
    } catch (error) {
      if (error instanceof RemoteAuthRequiredError || error instanceof RemoteNetworkError) throw error;
      throw new RemoteNetworkError();
    }
  }
}
