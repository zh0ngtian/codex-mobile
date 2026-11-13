import { ResourceSettlement } from './resource-settlement.js';
import { assertRemoteOperation, withRemoteOperation } from './operation-guard.js';
import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { TextDecoder } from 'node:util';
import { performance } from 'node:perf_hooks';
import { RemoteNetworkError } from './auth.js';
import { parseManagedAuthRecord, type ManagedAuth } from './auth-protocol.js';
import { RemoteAuthRequiredError } from './relay.js';
import { RemoteRpcSession } from './rpc-session.js';
import type { JsonValue } from './envelope.js';

export interface ManagedAuthCanonical {
  initialize(): Promise<Readonly<Record<string, unknown>>>;
  call(method: string, params?: JsonValue): Promise<unknown>;
  close?(): unknown;
  settled?(): Promise<void>;
}
interface CanonicalConnection { session: ManagedAuthCanonical; home: string; refreshed: boolean; generation: number }
interface CanonicalRefresh { connection: CanonicalConnection; promise: Promise<void> }
export interface ManagedAuthIdentity { codexHome: string; accountId: string; accountUserId: string; userId?: string }
export interface ManagedAuthLoaderOptions {
  assertOwnership?: () => void;
  /** 必须且只能显式提供 canonicalUrl 或 canonicalFactory。 */
  canonicalUrl?: string; canonicalFactory?: () => Promise<ManagedAuthCanonical>;
  now?: () => number; refreshMarginMs?: number; operationTimeoutMs?: number;
  /** 注入边界仍经过相同解析、绑定校验和错误脱敏。 */
  readAuthFile?: (codexHome: string) => Promise<unknown>;
}
const MAX_AUTH_BYTES = 256 * 1024;
const AUTH_MESSAGE = '本机受管账号不可用或绑定已变化，需要重新认证';
function authFailure(): RemoteAuthRequiredError { return new RemoteAuthRequiredError(AUTH_MESSAGE); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function option(value: number | undefined, fallback: number, max: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > max) throw authFailure(); return result;
}
function homePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value) || !isAbsolute(value)) throw authFailure();
  return normalize(value);
}
function owned(stat: Stats): boolean { return typeof process.getuid !== 'function' || stat.uid === process.getuid(); }
function sameFile(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function privateFile(stat: Stats): boolean { return stat.isFile() && owned(stat) && stat.nlink === 1 && (stat.mode & 0o077) === 0 && stat.size > 0 && stat.size <= MAX_AUTH_BYTES; }
/** 只读 canonical auth.json；允许合法原子 rename，不修改权限或凭据。 */
export async function readManagedAuthFile(codexHome: string): Promise<unknown> {
  try {
    const home = homePath(codexHome); const path = join(home, 'auth.json');
    for (let attempt = 0; attempt < 3; attempt++) {
      const directory = await lstat(home);
      if (!directory.isDirectory() || directory.isSymbolicLink() || !owned(directory) || (directory.mode & 0o022) !== 0 || await realpath(home) !== home) throw authFailure();
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let bytes: Buffer; let initial: Stats; let final: Stats;
      try {
        initial = await handle.stat(); if (!privateFile(initial)) throw authFailure();
        const buffer = Buffer.alloc(MAX_AUTH_BYTES + 1); let count = 0;
        while (count < buffer.length) {
          const result = await handle.read(buffer, count, buffer.length - count, count);
          if (result.bytesRead === 0) break; count += result.bytesRead;
        }
        if (count > MAX_AUTH_BYTES) throw authFailure();
        bytes = buffer.subarray(0, count); final = await handle.stat();
      } finally { await handle.close(); }
      const currentDirectory = await lstat(home); const current = await lstat(path);
      if (!sameFile(directory, currentDirectory) || !currentDirectory.isDirectory() || !owned(currentDirectory) || (currentDirectory.mode & 0o022) !== 0 || await realpath(home) !== home || current.isSymbolicLink()) throw authFailure();
      if (!sameFile(initial, current) || !sameFile(initial, final) || initial.size !== final.size || initial.mtimeMs !== final.mtimeMs || initial.ctimeMs !== final.ctimeMs) continue;
      if (!privateFile(current) || !privateFile(final) || bytes.length !== final.size) throw authFailure();
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes), (key, value: unknown) => {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw authFailure(); return value;
      }) as unknown;
    }
    throw authFailure();
  } catch { throw authFailure(); }
}
function expiration(auth: ManagedAuth): number | undefined {
  // 只解析本地 JWT exp，不宣称验证签名。毫秒转换也必须保持安全整数。
  try {
    const claims: unknown = JSON.parse(Buffer.from(auth.accessToken.split('.')[1]!, 'base64url').toString('utf8'));
    const exp = object(claims) ? claims.exp : undefined;
    return typeof exp === 'number' && Number.isSafeInteger(exp) && exp > 0 && exp <= Math.floor(Number.MAX_SAFE_INTEGER / 1000) ? exp * 1000 : undefined;
  } catch { return undefined; }
}
function sameIdentity(a: ManagedAuthIdentity, b: ManagedAuthIdentity): boolean { return a.codexHome === b.codexHome && a.accountId === b.accountId && a.accountUserId === b.accountUserId && a.userId === b.userId; }


/** canonical 管理普通账号的刷新；本 loader 从不消费 refresh_token 或写 auth.json。 */
export class ManagedAuthLoader {
  private readonly operationTimeoutMs: number;
  private readonly refreshMarginMs: number;
  private readonly factory: () => Promise<ManagedAuthCanonical>;
  private readonly abort = new AbortController();
  private readonly resources = new ResourceSettlement();
  private canonical?: CanonicalConnection;
  private connecting?: Promise<CanonicalConnection>;
  private refreshing?: CanonicalRefresh;
  private binding?: Readonly<ManagedAuthIdentity>;
  constructor(private readonly options: ManagedAuthLoaderOptions) {
    if ((options.canonicalUrl === undefined) === (options.canonicalFactory === undefined) || (options.canonicalUrl !== undefined && !options.canonicalUrl)) throw authFailure();
    this.operationTimeoutMs = option(options.operationTimeoutMs, 20000, 180000);
    this.refreshMarginMs = option(options.refreshMarginMs, 30000, 300000);
    this.factory = options.canonicalFactory ?? (() => RemoteRpcSession.connectCanonical(options.canonicalUrl!, { connectTimeoutMs: this.operationTimeoutMs, initializeTimeoutMs: this.operationTimeoutMs, responseTimeoutMs: this.operationTimeoutMs }));
  }
  get currentIdentity(): Readonly<ManagedAuthIdentity> | undefined { return this.binding ? { ...this.binding } : undefined; }
  private now(): number {
    try { const value = (this.options.now ?? Date.now)(); if (!Number.isSafeInteger(value) || value < 0) throw authFailure(); return value; }
    catch { throw authFailure(); }
  }
  /** 外部回调即使抛出本项目同类型错误也仅保留分类。 */
  private async external<T>(operation: (assertActive: () => void) => Promise<T>, network: boolean): Promise<T> {
    const deadline = performance.now() + this.operationTimeoutMs;
    const check = () => {
      if (this.abort.signal.aborted || performance.now() >= deadline) throw new RemoteNetworkError();
    };
    const active = () => {
      this.options.assertOwnership?.();
      check();
      assertRemoteOperation();
    };
    return withRemoteOperation(check, async () => {
      active();
      let timer: NodeJS.Timeout | undefined; let abort: (() => void) | undefined;
      try {
        const value = await Promise.race([Promise.resolve().then(() => { active(); return operation(active); }), new Promise<never>((_resolve, reject) => {
          abort = () => reject(new RemoteNetworkError());
          this.abort.signal.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => reject(new RemoteNetworkError('Remote 受管账号操作超时')), Math.max(1, Math.ceil(deadline - performance.now())));
        })]);
        active(); return value;
      } catch (error) {
        if (error instanceof RemoteNetworkError || (network && !(error instanceof RemoteAuthRequiredError))) throw new RemoteNetworkError();
        throw authFailure();
      } finally { clearTimeout(timer); if (abort) this.abort.signal.removeEventListener('abort', abort); }
    });
  }
  private connection(): Promise<CanonicalConnection> {
    if (this.abort.signal.aborted) return Promise.reject(new RemoteNetworkError());
    if (this.canonical) return Promise.resolve(this.canonical);
    if (this.connecting) return this.connecting;
    this.connecting = this.resources.track((async () => {
      let session: ManagedAuthCanonical | undefined; let abandoned = false; let unclaimed: ManagedAuthCanonical | undefined;
      try {
        session = await this.external(assertActive => {
          const created = this.resources.create(() => { assertActive(); return this.factory(); });
          void created.then(value => { unclaimed = value; if (abandoned) { void this.resources.close(value); unclaimed = undefined; } }, () => undefined);
          return created;
        }, true); unclaimed = undefined;
        const metadata = await this.external(() => session!.initialize(), true);
        if (!object(metadata)) throw authFailure();
        const home = homePath(metadata.codexHome);
        if (this.binding && this.binding.codexHome !== home) throw authFailure();
        if (this.abort.signal.aborted) throw new RemoteNetworkError();
        this.canonical = { session, home, refreshed: false, generation: 0 }; return this.canonical;
      } catch (error) { abandoned = true; void this.resources.close(session); void this.resources.close(unclaimed); unclaimed = undefined; throw error instanceof RemoteNetworkError ? new RemoteNetworkError() : authFailure(); }
      finally { this.connecting = undefined; }
    })());
    return this.connecting;
  }
  private assertCurrent(connection: CanonicalConnection): void {
    if (this.abort.signal.aborted || this.canonical !== connection) throw new RemoteNetworkError();
  }
  private invalidate(connection: CanonicalConnection): void {
    // 旧操作的晚超时不能清理已经替换的新会话；原绑定始终保留。
    if (this.canonical !== connection) return;
    this.canonical = undefined; void this.resources.close(connection.session);
  }
  private async read(connection: CanonicalConnection): Promise<ManagedAuth> {
    this.assertCurrent(connection);
    let value: unknown;
    try { value = await this.external(() => (this.options.readAuthFile ?? readManagedAuthFile)(connection.home), false); }
    catch (error) { if (error instanceof RemoteNetworkError) this.invalidate(connection); throw error; }
    this.assertCurrent(connection);
    let auth: ManagedAuth;
    try { auth = parseManagedAuthRecord(value); } catch { throw authFailure(); }
    this.assertCurrent(connection);
    const identity: ManagedAuthIdentity = { codexHome: connection.home, accountId: auth.accountId, accountUserId: auth.accountUserId, ...(auth.userId === undefined ? {} : { userId: auth.userId }) };
    if (this.binding && !sameIdentity(this.binding, identity)) throw authFailure();
    this.binding ??= Object.freeze(identity); return auth;
  }
  private refresh(connection: CanonicalConnection): Promise<void> {
    this.assertCurrent(connection);
    if (this.refreshing?.connection === connection) return this.refreshing.promise;
    let refreshing!: CanonicalRefresh;
    const promise = (async () => {
      try {
        const result = await this.external(() => connection.session.call('account/read', { refreshToken: true }), true);
        this.assertCurrent(connection);
        if (!object(result) || !object(result.account) || result.account.type !== 'chatgpt') throw authFailure();
        this.assertCurrent(connection);
        connection.refreshed = true; connection.generation++;
      } catch (error) {
        if (error instanceof RemoteNetworkError) this.invalidate(connection);
        throw error instanceof RemoteNetworkError ? new RemoteNetworkError() : authFailure();
      } finally { if (this.refreshing === refreshing) this.refreshing = undefined; }
    })();
    refreshing = { connection, promise }; this.refreshing = refreshing; return promise;
  }
  async load(): Promise<ManagedAuth> {
    const connection = await this.connection(); const generation = connection.generation;
    let auth = await this.read(connection); const expiresAt = expiration(auth);
    const refreshing = this.refreshing?.connection === connection ? this.refreshing.promise : undefined;
    if (refreshing || generation !== connection.generation || !connection.refreshed || expiresAt === undefined || expiresAt <= this.now() + this.refreshMarginMs) {
      if (refreshing) await refreshing;
      else if (generation === connection.generation) await this.refresh(connection);
      auth = await this.read(connection);
    }
    const currentExpiry = expiration(auth);
    if (currentExpiry === undefined || currentExpiry <= this.now()) throw authFailure();
    this.assertCurrent(connection); return auth;
  }
  /** 主动绑定监控：读取最新文件并核对既有身份，不调用 account/read 刷新。 */
  async verifyIdentity(expected?: ManagedAuthIdentity): Promise<Readonly<ManagedAuthIdentity>> {
    const connection = await this.connection(); await this.read(connection);
    const identity = this.currentIdentity!;
    if (expected && !sameIdentity(expected, identity)) throw authFailure(); this.assertCurrent(connection); return identity;
  }
  close(): void { this.abort.abort(); if (this.canonical) void this.resources.close(this.canonical.session); this.canonical = undefined; }
  async settled(): Promise<void> { this.close(); await this.resources.settled(); }
}
