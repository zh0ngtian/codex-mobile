import { ResourceSettlement } from './resource-settlement.js';
import { assertRemoteOperation, withRemoteOperation } from './operation-guard.js';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { isAbsolute, normalize } from 'node:path';
import { RemoteNetworkError } from './auth.js';
import { parseEnrollment, type EnrollmentRecord, type ManagedAuth } from './auth-protocol.js';
import { RemoteCatalog, type RemoteCatalogBinding, type RemoteTarget, type RemoteTargetIdentity } from './catalog.js';
import type { ManagedAuthIdentity } from './managed-auth.js';
import { PrivateStore } from './private-store.js';
import { RemoteAuthRequiredError, RemoteRelay, type RemoteAuthProvider, type RemoteRelayOptions, type RemoteStream } from './relay.js';
import { RemoteRpcSession, type RemoteRpcSessionOptions } from './rpc-session.js';
import type { JsonValue, RpcMessage, ServerPong } from './envelope.js';

export type RemoteControllerState = 'idle' | 'starting' | 'online' | 'offline' | 'auth-required' | 'paused' | 'remote-disabled' | 'pairing-required' | 'closed';
export type RemotePauseReason = 'auth-required' | 'enrollment-required' | 'identity-changed' | 'local-identity-changed' | 'account-mode' | 'binding-invalid' | 'remote-disabled';
export type RemoteControllerFailure = RemotePauseReason | 'closed' | 'unavailable' | 'target-unaccepted' | 'target-unavailable' | 'target-changed';
export class RemoteControllerError extends Error {
  constructor(readonly code: RemoteControllerFailure) { super('Remote 控制器身份或目标当前不可执行'); this.name = 'RemoteControllerError'; }
}
export interface RemoteControllerBinding {
  version: 1; managed: ManagedAuthIdentity; enrollment: RemoteCatalogBinding['enrollment'];
  local: RemoteTargetIdentity; targets: RemoteTargetIdentity[];
}
export interface RemoteControllerCanonical {
  initialize(): Promise<Readonly<Record<string, unknown>>>; call(method: string, params?: JsonValue): Promise<unknown>;
  on?(event: 'notification' | 'close' | 'disconnect', listener: (...args: any[]) => void): unknown;
  off?(event: 'notification' | 'close' | 'disconnect', listener: (...args: any[]) => void): unknown;
  close?(): unknown;
  settled?(): Promise<void>;
}
export interface RemoteControllerOptions {
  store: PrivateStore;
  managedAuth: { load(): Promise<ManagedAuth>; verifyIdentity(expected?: ManagedAuthIdentity): Promise<Readonly<ManagedAuthIdentity>>; close?(): unknown; settled?(): Promise<void> };
  authProvider: RemoteAuthProvider & { getEnrollment(): Promise<EnrollmentRecord | null>; verifyBinding(expected?: EnrollmentRecord): Promise<EnrollmentRecord> };
  canonicalUrl?: string; canonicalFactory?: () => Promise<RemoteControllerCanonical>;
  /** 可信 runtime 在候选首次 proof 和配对前固定身份；不向客户端开放。 */
  expectedManaged?: ManagedAuthIdentity; expectedLocal?: RemoteTargetIdentity;
  fetch?: typeof fetch; now?: () => number; monitorIntervalMs?: number; operationTimeoutMs?: number;
  relayOptions?: Omit<RemoteRelayOptions, 'clientId' | 'authProvider'>;
  rpcOptions?: RemoteRpcSessionOptions;
}
interface ControllerEvents {
  state: [state: RemoteControllerState, reason?: RemotePauseReason];
  targets: [targets: readonly RemoteTarget[]]; binding: [binding: RemoteControllerBinding];
}
interface Proof { managed: ManagedAuthIdentity; enrollment: RemoteCatalogBinding['enrollment']; local: RemoteTargetIdentity }
const BINDING = 'controller-binding.json'; const PAUSE = 'controller-pause.json';
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteControllerError('binding-invalid'); return value as Record<string, unknown>; }
function text(value: unknown): string { if (typeof value !== 'string' || !value.length || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new RemoteControllerError('binding-invalid'); return value; }
function exact(value: Record<string, unknown>, keys: string[]): void { if (Object.keys(value).some(key => !keys.includes(key))) throw new RemoteControllerError('binding-invalid'); }
function tuple(value: unknown): RemoteTargetIdentity { const raw = object(value); exact(raw, ['environmentId', 'installationId']); return { environmentId: text(raw.environmentId), installationId: text(raw.installationId) }; }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function sameTarget(a: RemoteTargetIdentity, b: RemoteTargetIdentity): boolean { return a.environmentId === b.environmentId && a.installationId === b.installationId; }
function managed(value: unknown): ManagedAuthIdentity {
  const raw = object(value); exact(raw, ['codexHome', 'accountId', 'accountUserId', 'userId']); const home = text(raw.codexHome);
  if (!isAbsolute(home) || normalize(home) !== home) throw new RemoteControllerError('binding-invalid');
  return { codexHome: home, accountId: text(raw.accountId), accountUserId: text(raw.accountUserId), ...(raw.userId === undefined ? {} : { userId: text(raw.userId) }) };
}
function enrollmentBinding(value: unknown): RemoteCatalogBinding['enrollment'] {
  const raw = object(value); exact(raw, ['clientId', 'accountId', 'accountUserId', 'managedAccountUserId', 'identityHash']);
  return { clientId: text(raw.clientId), accountId: text(raw.accountId), accountUserId: text(raw.accountUserId), managedAccountUserId: text(raw.managedAccountUserId), identityHash: text(raw.identityHash) };
}
function parseBinding(value: unknown): RemoteControllerBinding {
  const raw = object(value); exact(raw, ['version', 'managed', 'enrollment', 'local', 'targets']);
  if (raw.version !== 1 || !Array.isArray(raw.targets) || raw.targets.length < 1 || raw.targets.length > 4096) throw new RemoteControllerError('binding-invalid');
  const binding: RemoteControllerBinding = { version: 1, managed: managed(raw.managed), enrollment: enrollmentBinding(raw.enrollment), local: tuple(raw.local), targets: raw.targets.map(tuple) };
  if (binding.managed.accountId !== binding.enrollment.accountId || binding.managed.accountUserId !== binding.enrollment.managedAccountUserId || (binding.enrollment.accountUserId !== binding.managed.accountUserId && binding.enrollment.accountUserId !== binding.managed.userId) || !binding.targets.some(value => sameTarget(value, binding.local))) throw new RemoteControllerError('binding-invalid');
  const ids = new Set<string>(); for (const target of binding.targets) { if (ids.has(target.environmentId)) throw new RemoteControllerError('binding-invalid'); ids.add(target.environmentId); }
  return binding;
}
function scope(binding: RemoteControllerBinding): string { return createHash('sha256').update(JSON.stringify({ managed: binding.managed, enrollment: binding.enrollment, local: binding.local })).digest('hex'); }
function option(value: number | undefined, fallback: number): number { const number = value ?? fallback; if (!Number.isSafeInteger(number) || number < 1 || number > 180000) throw new RemoteControllerError('unavailable'); return number; }
function dispose(value: { close?(): unknown } | undefined): void { try { void Promise.resolve(value?.close?.()).catch(() => undefined); } catch { /* 只保留固定状态。 */ } }

/** 持有一个账号/工作区的常驻 Relay；canonical 只用于本机管理和证明。 */
export class RemoteController extends EventEmitter<ControllerEvents> {
  private currentState: RemoteControllerState = 'idle';
  private reason?: RemotePauseReason;
  private record?: RemoteControllerBinding;
  private loaded = false;
  private mustResume = false;
  private epoch = 0;
  private abort = new AbortController();
  private started = false;
  private healthy = false;
  private starting?: Promise<void>;
  private checking?: Promise<void>;
  private checkingEpoch = -1;
  private canonical?: RemoteControllerCanonical;
  private canonicalHome?: string;
  private mutating = false;
  private readonly canonicalDisposers: (() => void)[] = [];
  private relay?: RemoteRelay;
  private readonly resources = new ResourceSettlement();
  private readonly streams = new Map<RemoteStream, RemoteTargetIdentity>();
  private catalog: RemoteCatalog;
  private timer?: NodeJS.Timeout;
  private recheckRequested = false;
  private storage: Promise<void> = Promise.resolve();
  private readonly interval: number;
  private readonly timeout: number;
  private readonly factory: () => Promise<RemoteControllerCanonical>;
  private readonly expectedManaged?: ManagedAuthIdentity;
  private readonly expectedLocal?: RemoteTargetIdentity;
  constructor(private readonly options: RemoteControllerOptions) {
    super();
    if ((options.canonicalUrl === undefined) === (options.canonicalFactory === undefined) || options.canonicalUrl === '') throw new RemoteControllerError('unavailable');
    this.expectedManaged = options.expectedManaged === undefined ? undefined : managed(options.expectedManaged);
    this.expectedLocal = options.expectedLocal === undefined ? undefined : tuple(options.expectedLocal);
    this.interval = option(options.monitorIntervalMs, 5000); this.timeout = option(options.operationTimeoutMs, 20000);
    this.factory = options.canonicalFactory ?? (() => RemoteRpcSession.connectCanonical(options.canonicalUrl!, { ...options.rpcOptions, connectTimeoutMs: this.timeout, initializeTimeoutMs: this.timeout, responseTimeoutMs: this.timeout }));
    this.catalog = this.newCatalog();
  }
  get state(): RemoteControllerState { return this.currentState; }
  get pauseReason(): RemotePauseReason | undefined { return this.reason; }
  get binding(): RemoteControllerBinding | undefined { return this.record ? parseBinding(this.record) : undefined; }
  get targets(): readonly RemoteTarget[] { return this.catalog.targets; }
  private newCatalog(): RemoteCatalog { return new RemoteCatalog({ loadManagedAuth: () => this.options.managedAuth.load(), getEnrollment: () => this.options.authProvider.getEnrollment(), fetch: this.options.fetch, now: this.options.now, requestTimeoutMs: this.timeout }); }
  private publish<E extends keyof ControllerEvents>(event: E, ...args: ControllerEvents[E]): void { try { Reflect.apply(this.emit, this, [event, ...args]); } catch { /* 外部监听器不阻碍状态与清理。 */ } }
  private setState(state: RemoteControllerState, reason?: RemotePauseReason): void {
    if (this.currentState === 'closed') return;
    if (this.currentState === state && this.reason === reason) return;
    this.currentState = state; this.reason = reason; this.publish('state', state, reason);
  }
  private assert(epoch: number): void { this.options.store.assertOwnership(); if (this.state === 'closed' || this.epoch !== epoch || this.abort.signal.aborted) throw new RemoteControllerError('closed'); }
  private async external<T>(epoch: number, operation: (assertActive: () => void) => Promise<T>, network = true): Promise<T> {
    const deadline = performance.now() + this.timeout;
    const check = () => {
      if (this.state === 'closed' || this.epoch !== epoch || this.abort.signal.aborted) throw new RemoteControllerError('closed');
      if (performance.now() >= deadline) throw new RemoteNetworkError();
    };
    const active = () => { this.assert(epoch); check(); assertRemoteOperation(); };
    return withRemoteOperation(check, async () => {
      active(); let timer: NodeJS.Timeout | undefined; let aborted: (() => void) | undefined; const signal = this.abort.signal;
      try {
        const result = await Promise.race([Promise.resolve().then(() => { active(); return operation(active); }), new Promise<never>((_resolve, reject) => {
          aborted = () => reject(new RemoteControllerError('closed')); signal.addEventListener('abort', aborted, { once: true });
          timer = setTimeout(() => reject(new RemoteNetworkError()), Math.max(1, Math.ceil(deadline - performance.now())));
        })]); active(); return result;
      } catch (error) {
        if (error instanceof RemoteControllerError) throw new RemoteControllerError(error.code);
        if (error instanceof RemoteAuthRequiredError) throw new RemoteAuthRequiredError();
        if (error instanceof RemoteNetworkError || network) throw new RemoteNetworkError();
        throw new RemoteControllerError('binding-invalid');
      } finally { clearTimeout(timer); if (aborted) signal.removeEventListener('abort', aborted); }
    });
  }
  private async load(epoch: number): Promise<void> {
    if (this.loaded) return;
    try {
      const value = await this.external(epoch, () => this.options.store.readJson(BINDING), false);
      this.record = value === null ? undefined : parseBinding(value);
      const pause = await this.external(epoch, () => this.options.store.readJson(PAUSE), false);
      if (pause !== null) {
        const raw = object(pause); exact(raw, ['version', 'scope', 'paused', 'reason']);
        if (raw.version !== 1 || !this.record || raw.scope !== scope(this.record) || typeof raw.paused !== 'boolean' || (raw.reason !== undefined && !['auth-required', 'enrollment-required', 'identity-changed', 'local-identity-changed', 'account-mode', 'binding-invalid', 'remote-disabled'].includes(String(raw.reason)))) throw new RemoteControllerError('binding-invalid');
        this.mustResume = raw.paused; if (raw.paused) this.reason = raw.reason as RemotePauseReason | undefined;
      }
      this.assert(epoch); this.loaded = true;
    } catch (error) { if (error instanceof RemoteControllerError && error.code === 'closed') throw error; throw new RemoteControllerError('binding-invalid'); }
  }
  private connection(epoch: number): Promise<RemoteControllerCanonical> {
    return this.resources.track(this.connectCanonical(epoch));
  }
  private async connectCanonical(epoch: number): Promise<RemoteControllerCanonical> {
    if (this.canonical) return this.canonical;
    let abandoned = false; let value: RemoteControllerCanonical | undefined; let unclaimed: RemoteControllerCanonical | undefined;
    try {
      value = await this.external(epoch, assertActive => {
        const pending = this.resources.create(() => { assertActive(); return this.factory(); });
        void pending.then(result => { unclaimed = result; if (abandoned) { void this.resources.close(result); unclaimed = undefined; } }, () => undefined);
        return pending;
      }); unclaimed = undefined; const metadata = object(await this.external(epoch, () => value!.initialize()));
      const expected = (this.record?.managed ?? this.expectedManaged)?.codexHome;
      if (!isAbsolute(text(metadata.codexHome)) || (expected !== undefined && metadata.codexHome !== expected)) throw new RemoteControllerError('identity-changed');
      this.assert(epoch); this.canonical = value; this.canonicalHome = text(metadata.codexHome);
      const notification = (message: RpcMessage) => { if (message.method === 'account/updated' || message.method === 'remoteControl/status/changed') { this.recheckRequested = true; void this.monitor(); } };
      const disconnected = () => { if (this.canonical !== value || this.state === 'closed') return; this.detachCanonical(); this.healthy = false; this.setState('offline'); this.recheckRequested = true; void this.monitor(); };
      if (value.on && value.off) {
        value.on('notification', notification); value.on('close', disconnected); value.on('disconnect', disconnected);
        this.canonicalDisposers.push(() => value!.off!('notification', notification), () => value!.off!('close', disconnected), () => value!.off!('disconnect', disconnected));
      }
      return value;
    } catch (error) { abandoned = true; void this.resources.close(value); void this.resources.close(unclaimed); unclaimed = undefined; throw error; }
  }
  private detachRelay(): void {
    const relay = this.relay; this.relay = undefined;
    void this.resources.close(relay);
  }
  private detachCanonical(): void { for (const remove of this.canonicalDisposers.splice(0)) { try { remove(); } catch { /* 坏监听器不阻碍其余资源清理。 */ } } const value = this.canonical; this.canonical = undefined; this.canonicalHome = undefined; void this.resources.close(value); }
  private async proof(epoch: number): Promise<Proof> {
    const auth = await this.external(epoch, () => this.options.managedAuth.load());
    const identity = managed(await this.external(epoch, () => this.options.managedAuth.verifyIdentity(this.record?.managed ?? this.expectedManaged)));
    if ((this.expectedManaged && !same(this.expectedManaged, identity)) || identity.accountId !== auth.accountId || identity.accountUserId !== auth.accountUserId || identity.userId !== auth.userId) throw new RemoteControllerError('identity-changed');
    let enrollment: EnrollmentRecord;
    const value = await this.external(epoch, () => this.options.authProvider.getEnrollment());
    if (value === null) throw new RemoteControllerError('enrollment-required');
    try { enrollment = parseEnrollment(value); } catch { throw new RemoteControllerError('identity-changed'); }
    const own = enrollmentBinding({ clientId: enrollment.clientId, accountId: enrollment.accountId, accountUserId: enrollment.accountUserId, managedAccountUserId: enrollment.managedAccountUserId, identityHash: enrollment.identityHash });
    if (own.accountId !== identity.accountId || own.managedAccountUserId !== identity.accountUserId || (own.accountUserId !== identity.accountUserId && own.accountUserId !== identity.userId) || (this.record && (!same(this.record.managed, identity) || !same(this.record.enrollment, own)))) throw new RemoteControllerError('identity-changed');
    const canonical = await this.connection(epoch);
    if (this.canonicalHome !== identity.codexHome) throw new RemoteControllerError('identity-changed');
    const account = object(await this.external(epoch, () => canonical.call('account/read', { refreshToken: false })));
    if (!account.account || typeof account.account !== 'object' || (account.account as Record<string, unknown>).type !== 'chatgpt') throw new RemoteControllerError('account-mode');
    const status = object(await this.external(epoch, () => canonical.call('remoteControl/status/read', {})));
    if (status.status === 'disabled') throw new RemoteControllerError('remote-disabled');
    if (status.status !== 'connected') throw new RemoteNetworkError();
    const local = { environmentId: text(status.environmentId), installationId: text(status.installationId) };
    if ((this.expectedLocal && !sameTarget(this.expectedLocal, local)) || (this.record && !sameTarget(this.record.local, local))) throw new RemoteControllerError('local-identity-changed');
    // canonical await 之后再次重读，阻止证明期间切换账号或登记。
    await this.external(epoch, () => this.options.managedAuth.verifyIdentity(identity));
    const final = await this.external(epoch, () => this.options.authProvider.verifyBinding(enrollment));
    if (!final || !same(parseEnrollment(final), enrollment)) throw new RemoteControllerError('identity-changed');
    this.assert(epoch); return { managed: identity, enrollment: own, local };
  }
  private queueWrite(operation: () => Promise<void>): Promise<void> { const next = this.storage.then(operation); this.storage = next.catch(() => undefined); return next; }
  private async persist(record: RemoteControllerBinding, epoch: number): Promise<void> {
    await this.queueWrite(async () => {
      this.assert(epoch);
      await this.options.store.withInitialization('controller-binding', async () => {
        this.assert(epoch); const current = await this.options.store.readJson(BINDING); this.assert(epoch);
        if ((this.record === undefined && current !== null) || (this.record !== undefined && !same(parseBinding(current), this.record))) throw new RemoteControllerError('binding-invalid');
        await this.options.store.writeJson(BINDING, record);
      }); this.assert(epoch);
    }); this.assert(epoch); this.record = parseBinding(record); this.publish('binding', this.binding!);
  }
  private writePause(paused: boolean, reason?: RemotePauseReason, epoch = this.epoch): Promise<void> {
    const binding = this.record; if (!binding) return Promise.resolve();
    const previousReason = this.reason ?? 'auth-required';
    return this.queueWrite(async () => {
      if (!paused) this.assert(epoch);
      await this.options.store.writeJson(PAUSE, { version: 1, scope: scope(binding), paused, ...(reason === undefined ? {} : { reason }) });
      if (!paused && (this.state === 'closed' || epoch !== this.epoch)) await this.options.store.writeJson(PAUSE, { version: 1, scope: scope(binding), paused: true, reason: previousReason });
    });
  }
  private suspend(reason: RemotePauseReason): void {
    if (this.state === 'closed') return;
    this.mustResume = true; this.healthy = false; this.epoch++; this.abort.abort(); this.abort = new AbortController(); clearTimeout(this.timer); this.timer = undefined;
    this.setState(reason === 'auth-required' || reason === 'enrollment-required' || reason === 'account-mode' || reason === 'identity-changed' ? 'auth-required' : reason === 'remote-disabled' ? 'remote-disabled' : 'paused', reason);
    this.detachRelay(); this.detachCanonical(); this.catalog.close();
    void this.writePause(true, reason).catch(() => { this.setState('paused', 'binding-invalid'); });
  }
  private handle(error: unknown, epoch: number): void {
    if (epoch !== this.epoch || this.state === 'closed') return;
    if (error instanceof RemoteControllerError && error.code !== 'closed' && error.code !== 'unavailable') this.suspend(error.code as RemotePauseReason);
    else if (error instanceof RemoteAuthRequiredError) this.suspend('auth-required');
    else { this.healthy = false; this.setState('offline'); this.detachCanonical(); }
  }
  private activate(epoch: number): void {
    this.assert(epoch); if (!this.started || this.relay) return;
    const relay = new RemoteRelay({ ...this.options.relayOptions, assertOwnership: () => this.options.store.assertOwnership(), clientId: this.record!.enrollment.clientId, authProvider: this.options.authProvider, reconnectMaxMs: Math.min(this.options.relayOptions?.reconnectMaxMs ?? 2000, 2000) }); this.relay = relay;
    relay.on('state', state => { if (this.relay !== relay || this.state === 'closed') return; if (state === 'auth-required') this.suspend('auth-required'); else if (state === 'online') this.setState(this.healthy ? 'online' : 'offline'); else if (state !== 'closed') this.setState('offline'); });
  }
  private async check(epoch: number, resume = false): Promise<void> {
    await this.load(epoch); if (this.mustResume && !resume) { this.setState('paused', this.reason ?? 'auth-required'); return; }
    const proof = await this.proof(epoch); const targets = await this.external(epoch, () => this.catalog.refresh());
    this.reconcileStreams(targets);
    const verified = await this.proof(epoch);
    if (!same(proof, verified)) throw new RemoteControllerError('local-identity-changed');
    this.assert(epoch);
    const local = targets.find(value => value.env_id === proof.local.environmentId && value.installation_id === proof.local.installationId);
    if (!this.record && !local) { this.setState('pairing-required'); return; }
    if (!this.record) await this.persist({ version: 1, ...proof, targets: [proof.local] }, epoch);
    if (resume && this.mustResume) { await this.writePause(false, undefined, epoch); this.assert(epoch); this.mustResume = false; }
    this.healthy = true; this.activate(epoch); this.setState(this.relay ? (this.relay.state === 'online' ? 'online' : 'offline') : 'idle'); this.publish('targets', this.targets);
  }
  private schedule(): void {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.state === 'closed' || this.mustResume || !this.started) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.monitor(); }, this.recheckRequested ? 0 : this.interval); this.timer.unref();
  }
  private beginCheck(epoch: number, resume = false): Promise<void> {
    if (this.checking && this.checkingEpoch === epoch) return this.checking;
    const flight = this.check(epoch, resume).catch(error => this.handle(error, epoch)).finally(() => {
      if (this.checking === flight) this.checking = undefined;
      if (this.epoch === epoch) this.schedule();
    });
    this.checking = flight; this.checkingEpoch = epoch; return flight;
  }
  private monitor(): Promise<void> {
    if (this.state === 'closed' || this.mustResume || this.starting || this.mutating || !this.started) return Promise.resolve();
    this.recheckRequested = false; return this.beginCheck(this.epoch);
  }
  start(): Promise<void> {
    if (this.state === 'closed') return Promise.reject(new RemoteControllerError('closed'));
    if (this.starting) return this.starting; if (this.mustResume) return Promise.resolve(); if (this.started && this.relay) return Promise.resolve();
    this.started = true; const epoch = this.epoch; this.setState('starting');
    const flight = this.beginCheck(epoch); this.starting = flight;
    void flight.finally(() => { if (this.starting === flight) this.starting = undefined; if (epoch === this.epoch) this.schedule(); }).catch(() => undefined); return flight;
  }
  resume(): Promise<void> {
    if (this.state === 'closed') return Promise.reject(new RemoteControllerError('closed'));
    if (this.starting) return this.starting;
    const epoch = ++this.epoch; this.abort.abort(); this.abort = new AbortController(); this.catalog.close(); this.catalog = this.newCatalog(); this.detachCanonical(); this.started = true;
    const flight = (async () => { await this.storage; this.assert(epoch); await this.beginCheck(epoch, true); })().finally(() => { if (this.starting === flight) this.starting = undefined; if (epoch === this.epoch) this.schedule(); });
    this.starting = flight; return flight;
  }
  async refreshTargets(): Promise<readonly RemoteTarget[]> {
    if (this.state === 'closed') throw new RemoteControllerError('closed'); if (this.mustResume || this.mutating) throw new RemoteControllerError('unavailable');
    if (this.starting) await this.starting;
    await this.beginCheck(this.epoch);
    if (!this.healthy || this.mustResume) throw new RemoteControllerError('unavailable'); return this.targets;
  }
  private async mutate<T>(operation: (epoch: number) => Promise<T>): Promise<T> {
    if (this.state === 'closed' || this.mustResume || this.mutating || this.starting || this.checking) throw new RemoteControllerError('unavailable');
    this.mutating = true; const epoch = this.epoch;
    try { return await operation(epoch); }
    catch (error) {
      if (error instanceof RemoteControllerError) {
        if (['auth-required', 'enrollment-required', 'identity-changed', 'local-identity-changed', 'account-mode', 'binding-invalid', 'remote-disabled'].includes(error.code)) this.suspend(error.code as RemotePauseReason);
        throw new RemoteControllerError(error.code);
      }
      if (error instanceof RemoteAuthRequiredError) this.suspend('auth-required');
      throw new RemoteControllerError('unavailable');
    } finally { this.mutating = false; if (epoch === this.epoch) this.schedule(); }
  }
  private assertAcceptedTuple(target: RemoteTargetIdentity): boolean {
    const previous = this.record?.targets.find(item => item.environmentId === target.environmentId);
    if (previous && !sameTarget(previous, target)) throw new RemoteControllerError('target-changed');
    return previous !== undefined;
  }
  async acceptTarget(value: RemoteTargetIdentity): Promise<void> {
    return this.mutate(async epoch => {
      const target = tuple(value);
      if (!this.healthy || !this.record) throw new RemoteControllerError('unavailable');
      if (this.assertAcceptedTuple(target)) return;
      if (!this.targets.some(item => item.env_id === target.environmentId && item.installation_id === target.installationId)) throw new RemoteControllerError('target-unavailable');
      if (this.record.targets.length >= 4096) throw new RemoteControllerError('unavailable');
      await this.proof(epoch); await this.persist({ ...this.record, targets: [...this.record.targets, target] }, epoch);
    });
  }
  /** 只使用指定 canonical 的本机非手动配对码，不将本机业务流量送给 canonical。 */
  async pairLocal(): Promise<void> {
    return this.mutate(async epoch => {
      await this.load(epoch); if (this.mustResume) throw new RemoteControllerError('unavailable');
      const proof = await this.proof(epoch); const canonical = await this.connection(epoch);
      const raw = object(await this.external(epoch, () => canonical.call('remoteControl/pairing/start', { manualCode: false })));
      const now = (this.options.now ?? Date.now)();
      if (raw.environmentId !== proof.local.environmentId || typeof raw.pairingCode !== 'string' || !raw.pairingCode || (raw.manualPairingCode !== null && typeof raw.manualPairingCode !== 'string') || !Number.isSafeInteger(raw.expiresAt) || !Number.isSafeInteger(now) || now < 0 || (raw.expiresAt as number) <= now / 1000) throw new RemoteControllerError('target-unavailable');
      await this.external(epoch, () => this.catalog.pair({ pairingCode: raw.pairingCode as string, expected: proof.local, expiresAt: raw.expiresAt as number }));
      this.reconcileStreams(this.targets);
      const verified = await this.proof(epoch); if (!same(proof, verified)) throw new RemoteControllerError('identity-changed');
      if (!this.record) await this.persist({ version: 1, ...proof, targets: [proof.local] }, epoch);
      this.healthy = true; this.activate(epoch); this.setState(this.relay ? (this.relay.state === 'online' ? 'online' : 'offline') : 'idle'); this.publish('targets', this.targets);
    });
  }
  /** manual code 的目的主机必须由 Mac 调用方提供完整 env+installation。 */
  async pairManual(pairingCode: string, value: RemoteTargetIdentity): Promise<void> {
    return this.mutate(async epoch => {
      const target = tuple(value); if (!this.record || !this.healthy) throw new RemoteControllerError('unavailable');
      const accepted = this.assertAcceptedTuple(target); const proof = await this.proof(epoch);
      await this.external(epoch, () => this.catalog.pair({ pairingCode, expected: target }));
      this.reconcileStreams(this.targets);
      if (!same(proof, await this.proof(epoch))) throw new RemoteControllerError('identity-changed');
      if (!accepted) { if (this.record.targets.length >= 4096) throw new RemoteControllerError('unavailable'); await this.persist({ ...this.record, targets: [...this.record.targets, target] }, epoch); }
      this.publish('targets', this.targets);
    });
  }
  /** 仅显式重新关联未来访问；调用方须保留旧 tuple 的操作与暂停记录。 */
  async reassociateTarget(
    previousValue: RemoteTargetIdentity,
    nextValue: RemoteTargetIdentity,
    pairingCode?: string,
  ): Promise<void> {
    const previous = tuple(previousValue);
    const next = tuple(nextValue);
    return this.mutate(async (epoch) => {
      await this.load(epoch);
      if (!this.record || !this.record.targets.some((value) => sameTarget(value, previous)))
        throw new RemoteControllerError('target-unaccepted');
      if (
        sameTarget(this.record.local, previous) ||
        sameTarget(previous, next) ||
        this.record.targets.some((value) => value.environmentId === next.environmentId && !sameTarget(value, previous))
      )
        throw new RemoteControllerError('target-changed');
      // 在新 grant 的任何网络操作之前终止旧流，失败也不重新打开旧流。
      for (const [stream, target] of this.streams) if (sameTarget(target, previous)) this.terminateStream(stream);
      const proof = await this.proof(epoch);
      if (pairingCode !== undefined)
        await this.external(epoch, () => this.catalog.pair({ pairingCode, expected: next }));
      else await this.external(epoch, () => this.catalog.refresh());
      this.reconcileStreams(this.targets);
      if (
        !this.targets.some(
          (value) => value.env_id === next.environmentId && value.installation_id === next.installationId,
        )
      )
        throw new RemoteControllerError('target-unavailable');
      if (!same(proof, await this.proof(epoch))) throw new RemoteControllerError('identity-changed');
      await this.persist(
        { ...this.record, targets: this.record.targets.map((value) => (sameTarget(value, previous) ? next : value)) },
        epoch,
      );
      this.publish('targets', this.targets);
    });
  }
  targetStatus(value: RemoteTargetIdentity): { executable: boolean; reason?: RemoteControllerFailure } {
    const target = tuple(value);
    if (this.state === 'closed') return { executable: false, reason: 'closed' };
    if (!this.healthy || this.mustResume || this.state !== 'online' || this.relay?.state !== 'online') return { executable: false, reason: 'unavailable' };
    const accepted = this.record?.targets.find(item => item.environmentId === target.environmentId);
    if (!accepted) return { executable: false, reason: 'target-unaccepted' };
    if (!sameTarget(accepted, target)) return { executable: false, reason: 'target-changed' };
    if (!this.targets.some(item => item.env_id === target.environmentId && item.installation_id === target.installationId && item.online)) return { executable: false, reason: 'target-unavailable' };
    return { executable: true };
  }
  private terminateStream(stream: RemoteStream): void {
    this.streams.delete(stream);
    let closing: Promise<void>;
    try { closing = stream.close(); }
    catch {
      // close 在通知外部监听器之前已固定终态；再次调用只取得同一 Promise，
      // 避免同步监听器异常丢失尚未完成的关闭写入，不会再次发送关闭帧。
      try { closing = stream.close(); } catch { return; }
    }
    void closing.catch(() => undefined);
  }
  private reconcileStreams(targets: readonly RemoteTarget[]): void {
    for (const [stream, identity] of this.streams) {
      const current = targets.find(value => value.env_id === identity.environmentId);
      if (current && current.installation_id !== identity.installationId) this.terminateStream(stream);
    }
  }
  createRawStream(value: RemoteTargetIdentity): RemoteStream {
    const identity = tuple(value); const status = this.targetStatus(identity); if (!status.executable) throw new RemoteControllerError(status.reason!);
    const stream = this.relay!.createStream({ environmentId: identity.environmentId }); this.streams.set(stream, identity);
    const pong = (value: ServerPong) => { if (value.status === 'unknown') this.terminateStream(stream); };
    stream.on('pong', pong); stream.once('close', () => { this.streams.delete(stream); stream.off('pong', pong); }); return stream;
  }
  async createManagementSession(value: RemoteTargetIdentity): Promise<RemoteRpcSession> {
    const epoch = this.epoch; const identity = tuple(value); const stream = this.createRawStream(identity); let session: RemoteRpcSession | undefined;
    try { session = RemoteRpcSession.fromRemoteStream(stream, this.options.rpcOptions); await session.initialize(); this.assert(epoch); if (!this.targetStatus(identity).executable) throw new RemoteControllerError('target-unavailable'); return session; }
    catch (error) { dispose(session); this.terminateStream(stream); if (error instanceof RemoteControllerError) throw error; throw new RemoteNetworkError(); }
  }
  /** 包含已暂停/替换的旧Relay，close仍保持原有storage等待语义。 */
  async settled(): Promise<void> {
    try { await this.close(); }
    finally {
      // storage拒绝也不能跳过已摘除连接的实际close。
      await this.resources.settled();
    }
  }
  async close(): Promise<void> {
    if (this.state !== 'closed') { this.epoch++; this.abort.abort(); this.currentState = 'closed'; this.reason = undefined; clearTimeout(this.timer); this.timer = undefined; this.catalog.close(); this.detachRelay(); this.detachCanonical(); void this.resources.close(this.options.managedAuth); this.publish('state', 'closed'); this.removeAllListeners(); }
    await this.storage;
  }
}
