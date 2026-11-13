import { TextDecoder } from 'node:util';
import { RemoteNetworkError } from './auth.js';
import { parseEnrollment, type EnrollmentRecord, type ManagedAuth } from './auth-protocol.js';
import { RemoteAuthRequiredError } from './relay.js';

export type RemoteCatalogFailure = 'protocol' | 'capacity' | 'stale' | 'closed' | 'pairing';
export class RemoteCatalogError extends RemoteNetworkError {
  constructor(readonly code: RemoteCatalogFailure) { super('Remote 目录或配对操作未完成'); this.name = 'RemoteCatalogError'; }
}
export interface RemoteTargetIdentity { environmentId: string; installationId: string }
export interface RemoteTarget {
  env_id: string; installation_id: string; kind: string; online: boolean; busy: boolean;
  display_name?: string | null; host_name?: string | null; name?: string | null; os?: string | null;
  os_version?: string | null; arch?: string | null; app_server_version?: string | null;
  client_type?: string | null; originator?: string | null; terminal?: string | null;
  client_name?: string | null; client_version?: string | null; last_seen_at?: string | null;
}
export interface RemoteCatalogBinding {
  accountId: string; accountUserId: string; userId?: string;
  enrollment: { clientId: string; accountId: string; accountUserId: string; managedAccountUserId: string; identityHash: string };
}
export interface RemoteCatalogOptions {
  loadManagedAuth: () => Promise<ManagedAuth>; getEnrollment: () => Promise<EnrollmentRecord | null>;
  fetch?: typeof fetch; now?: () => number; requestTimeoutMs?: number;
  maxPages?: number; maxTargets?: number; maxResponseBytes?: number;
}
const ORIGIN = 'https://chatgpt.com';
const META = ['display_name', 'host_name', 'name', 'os', 'os_version', 'arch', 'app_server_version', 'client_type', 'originator', 'terminal', 'client_name', 'client_version', 'last_seen_at'] as const;
function authFailure(): RemoteAuthRequiredError { return new RemoteAuthRequiredError('Remote 账号或自己的登记绑定已变化，需要在 Mac 重新认证'); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteCatalogError('protocol'); return value as Record<string, unknown>; }
function text(value: unknown, max = 1024): string { if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new RemoteCatalogError('protocol'); return value; }
function option(value: number | undefined, fallback: number, max: number): number { const result = value ?? fallback; if (!Number.isSafeInteger(result) || result < 1 || result > max) throw new RemoteCatalogError('capacity'); return result; }
function cloneBinding(value: RemoteCatalogBinding): RemoteCatalogBinding { return { ...value, enrollment: { ...value.enrollment } }; }
/** 只保留有协议意义的公开字段，绝不向调用方返回原始响应。 */
function target(value: unknown): RemoteTarget {
  const raw = object(value);
  if (typeof raw.online !== 'boolean' || typeof raw.busy !== 'boolean') throw new RemoteCatalogError('protocol');
  const result: RemoteTarget = { env_id: text(raw.env_id), installation_id: text(raw.installation_id), kind: text(raw.kind), online: raw.online, busy: raw.busy };
  for (const key of META) if (raw[key] !== undefined) {
    const value = raw[key];
    if (value !== null && (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value))) throw new RemoteCatalogError('protocol');
    result[key] = value as string | null;
  }
  return result;
}
interface Context { auth: ManagedAuth; binding: RemoteCatalogBinding }
interface Operation { generation: number; abort: AbortController }

/** 当前网关自己的 client 可见目录；不调用账号全局主机 API。 */
export class RemoteCatalog {
  private readonly timeout: number;
  private readonly maxPages: number;
  private readonly maxTargets: number;
  private readonly maxBytes: number;
  private readonly fetcher: typeof fetch;
  private binding?: RemoteCatalogBinding;
  private snapshot: RemoteTarget[] = [];
  private generation = 0;
  private listing?: Promise<readonly RemoteTarget[]>;
  private pairing = false;
  private closed = false;
  private readonly operations = new Set<Operation>();
  constructor(private readonly options: RemoteCatalogOptions) {
    this.timeout = option(options.requestTimeoutMs, 20000, 180000);
    this.maxPages = option(options.maxPages, 100, 1000);
    this.maxTargets = option(options.maxTargets, 10000, 100000);
    this.maxBytes = option(options.maxResponseBytes, 2 * 1024 * 1024, 16 * 1024 * 1024);
    this.fetcher = options.fetch ?? globalThis.fetch;
  }
  get targets(): readonly RemoteTarget[] { return this.snapshot.map(value => ({ ...value })); }
  get currentBinding(): RemoteCatalogBinding | undefined { return this.binding ? cloneBinding(this.binding) : undefined; }
  private assert(op: Operation): void {
    if (this.closed) throw new RemoteCatalogError('closed');
    if (op.abort.signal.aborted || op.generation !== this.generation) throw new RemoteCatalogError('stale');
  }
  private async run<T>(operation: (op: Operation) => Promise<T>): Promise<T> {
    if (this.closed) throw new RemoteCatalogError('closed');
    const op: Operation = { generation: ++this.generation, abort: new AbortController() }; this.operations.add(op);
    let timer: NodeJS.Timeout | undefined; let aborted: (() => void) | undefined;
    try {
      return await Promise.race([Promise.resolve().then(() => operation(op)), new Promise<never>((_resolve, reject) => {
        aborted = () => reject(this.closed ? new RemoteCatalogError('closed') : new RemoteNetworkError());
        op.abort.signal.addEventListener('abort', aborted, { once: true });
        timer = setTimeout(() => op.abort.abort(), this.timeout);
      })]);
    } catch (error) {
      if (error instanceof RemoteAuthRequiredError) throw authFailure();
      if (error instanceof RemoteCatalogError) throw new RemoteCatalogError(error.code);
      throw new RemoteNetworkError();
    } finally { clearTimeout(timer); if (aborted) op.abort.signal.removeEventListener('abort', aborted); op.abort.abort(); this.operations.delete(op); }
  }
  private async context(op: Operation): Promise<Context> {
    this.assert(op);
    let auth: ManagedAuth; let enrollment: EnrollmentRecord;
    try {
      const loaded = await this.options.loadManagedAuth(); this.assert(op);
      auth = { accessToken: text(loaded.accessToken, 65536), accountId: text(loaded.accountId), accountUserId: text(loaded.accountUserId), ...(loaded.userId === undefined ? {} : { userId: text(loaded.userId) }) };
      const value = await this.options.getEnrollment(); this.assert(op); enrollment = parseEnrollment(value);
    } catch (error) {
      if (error instanceof RemoteNetworkError) throw error;
      throw authFailure();
    }
    if (enrollment.accountId !== auth.accountId || enrollment.managedAccountUserId !== auth.accountUserId || (enrollment.accountUserId !== auth.accountUserId && enrollment.accountUserId !== auth.userId)) throw authFailure();
    const binding: RemoteCatalogBinding = { accountId: auth.accountId, accountUserId: auth.accountUserId, ...(auth.userId === undefined ? {} : { userId: auth.userId }), enrollment: { clientId: enrollment.clientId, accountId: enrollment.accountId, accountUserId: enrollment.accountUserId, managedAccountUserId: enrollment.managedAccountUserId, identityHash: enrollment.identityHash } };
    if (this.binding && JSON.stringify(this.binding) !== JSON.stringify(binding)) throw authFailure();
    this.assert(op); this.binding ??= binding; return { auth, binding };
  }
  private async request(path: string, context: Context, op: Operation, body?: object): Promise<unknown> {
    this.assert(op);
    const pending = Promise.resolve().then(() => this.fetcher(`${ORIGIN}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${context.auth.accessToken}`, 'ChatGPT-Account-Id': context.auth.accountId, Accept: 'application/json', originator: 'Codex Desktop', 'User-Agent': 'CodexMobile-Gateway', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: op.abort.signal }));
    void pending.then(response => { if (op.abort.signal.aborted) void response.body?.cancel().catch(() => undefined); }, () => undefined);
    const response = await pending; this.assert(op);
    if (response.status === 401 || response.status === 403) { void response.body?.cancel().catch(() => undefined); throw authFailure(); }
    if (response.status === 408 || response.status === 429 || response.status >= 500) { void response.body?.cancel().catch(() => undefined); throw new RemoteNetworkError(); }
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new RemoteCatalogError('protocol'); }
    const length = response.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > this.maxBytes)) { void response.body?.cancel().catch(() => undefined); throw new RemoteCatalogError('capacity'); }
    const reader = response.body?.getReader(); if (!reader) throw new RemoteCatalogError('protocol');
    const cancel = () => { void reader.cancel().catch(() => undefined); }; op.abort.signal.addEventListener('abort', cancel, { once: true });
    let bytes = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) { const part = await reader.read(); this.assert(op); if (part.done) break; bytes += part.value.byteLength; if (bytes > this.maxBytes) throw new RemoteCatalogError('capacity'); chunks.push(part.value); }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), (key, value: unknown) => { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new RemoteCatalogError('protocol'); return value; }) as unknown; }
      catch { throw new RemoteCatalogError('protocol'); }
    } finally { op.abort.signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
  }
  private async readTargets(context: Context, op: Operation): Promise<RemoteTarget[]> {
    const values: RemoteTarget[] = []; const cursors = new Set<string>(); const ids = new Set<string>(); let cursor: string | null = null;
    for (let page = 0; ; page++) {
      if (page >= this.maxPages) throw new RemoteCatalogError('capacity');
      const path = `/backend-api/codex/remote/control/clients/${encodeURIComponent(context.binding.enrollment.clientId)}/environments?limit=100${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
      const raw = object(await this.request(path, context, op));
      if (!Array.isArray(raw.items) || (raw.cursor !== null && typeof raw.cursor !== 'string')) throw new RemoteCatalogError('protocol');
      if (raw.items.length > this.maxTargets - values.length) throw new RemoteCatalogError('capacity');
      for (const item of raw.items) { const value = target(item); if (ids.has(value.env_id)) throw new RemoteCatalogError('protocol'); ids.add(value.env_id); values.push(value); }
      cursor = raw.cursor === null ? null : text(raw.cursor, 4096);
      if (cursor === null) break;
      if (cursors.has(cursor)) throw new RemoteCatalogError('protocol'); cursors.add(cursor);
    }
    await this.context(op); this.assert(op); return values;
  }
  /** 配对显式双 ID 目标；manual code 不推断主机，已发送的 claim 不重试。 */
  async pair(request: { pairingCode: string; expected: RemoteTargetIdentity; expiresAt?: number }): Promise<RemoteTarget> {
    if (this.listing || this.pairing) throw new RemoteCatalogError('capacity');
    this.pairing = true;
    try {
      return await this.run(async op => {
        const code = text(request.pairingCode, 4096); const environment = text(request.expected.environmentId); const installation = text(request.expected.installationId);
        if (request.expiresAt !== undefined) {
          const now = (this.options.now ?? Date.now)();
          if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(request.expiresAt) || request.expiresAt <= now / 1000) throw new RemoteCatalogError('pairing');
        }
        const context = await this.context(op);
        // 身份读取也可能耗时；发送配对码前再次确认秒级期限。
        if (request.expiresAt !== undefined && request.expiresAt <= (this.options.now ?? Date.now)() / 1000) throw new RemoteCatalogError('pairing');
        const raw = object(await this.request('/backend-api/wham/remote/control/client/pair', context, op, { client_id: context.binding.enrollment.clientId, pairing_code: code }));
        if (raw.pairing_code !== code || raw.client_id !== context.binding.enrollment.clientId || raw.environment_id !== environment || !text(raw.server_id) || typeof raw.claimed_at !== 'string' || !Number.isFinite(Date.parse(raw.claimed_at))) throw new RemoteCatalogError('pairing');
        await this.context(op);
        const values = await this.readTargets(context, op); const paired = values.find(value => value.env_id === environment && value.installation_id === installation);
        if (!paired) throw new RemoteCatalogError('pairing');
        this.assert(op); this.snapshot = values; return { ...paired };
      });
    } finally { this.pairing = false; }
  }
  refresh(): Promise<readonly RemoteTarget[]> {
    if (this.listing) return this.listing;
    if (this.pairing) return Promise.reject(new RemoteCatalogError('capacity'));
    const listing = this.run(async op => {
      const context = await this.context(op); const values = await this.readTargets(context, op);
      this.assert(op); this.snapshot = values; return this.targets;
    });
    this.listing = listing;
    void listing.finally(() => { if (this.listing === listing) this.listing = undefined; }).catch(() => undefined);
    return listing;
  }
  close(): void { if (this.closed) return; this.closed = true; this.generation++; for (const op of this.operations) op.abort.abort(); }
}
