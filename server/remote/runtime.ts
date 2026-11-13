import {
  RemoteRuntimeLifecycle,
  RemoteRuntimeError,
  classifyRemoteRuntimeFailure as classify,
  closeRemoteResource as dispose,
  type RemoteRuntimeFailure,
  type RemoteRuntimeOperation as Operation,
} from './runtime-lifecycle.js';
export { RemoteRuntimeError, type RemoteRuntimeFailure } from './runtime-lifecycle.js';
import { EventEmitter } from 'node:events';
import { RemoteAuthProviderImpl } from './auth.js';
import { type ManagedAuth } from './auth-protocol.js';
import { type RemoteTarget, type RemoteTargetIdentity } from './catalog.js';
import { RemoteController, type RemoteControllerBinding, type RemoteControllerOptions } from './controller.js';
import { SecureEnclaveDeviceKey, type DeviceKeySigner } from './device-key.js';
import {
  RemoteIdentityRegistry,
  type RemoteActiveIdentity,
  type RemoteIdentityCandidate,
} from './identity-registry.js';
import { ManagedAuthLoader, type ManagedAuthIdentity, type ManagedAuthLoaderOptions } from './managed-auth.js';
import { RemoteStepUpOAuth, type RemoteOAuthOptions } from './oauth.js';
import { RemoteCanonicalLogin, type RemoteCanonicalLoginOptions } from './login.js';
import { PrivateStore } from './private-store.js';
import { type RemoteStream } from './relay.js';
import type { RemoteRpcSession } from './rpc-session.js';
import {
  RemoteRuntimeStateStore,
  mergeRemotePending,
  remoteManaged,
  remoteTuple,
  sameRemoteManaged,
  sameRemoteTarget,
  type RemoteRuntimePauseReason,
  type RemoteRuntimeStateRecord,
} from './runtime-state.js';

export interface RemoteRuntimeManagedAuth {
  readonly currentIdentity: Readonly<ManagedAuthIdentity> | undefined;
  load(): Promise<ManagedAuth>;
  verifyIdentity(expected?: ManagedAuthIdentity): Promise<Readonly<ManagedAuthIdentity>>;
  close?(): unknown;
}
export interface RemoteRuntimeProvider extends Pick<
  RemoteAuthProviderImpl,
  'enroll' | 'getEnrollment' | 'verifyBinding' | 'prepareConnection'
> {}
export interface RemoteRuntimeOptions {
  canonicalUrl?: string;
  canonicalFactory?: RemoteControllerOptions['canonicalFactory'];
  store?: PrivateStore;
  registry?: RemoteIdentityRegistry;
  fetch?: typeof fetch;
  now?: () => number;
  operationTimeoutMs?: number;
  interactionTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  controllerOptions?: Pick<RemoteControllerOptions, 'monitorIntervalMs' | 'relayOptions' | 'rpcOptions'>;
  oauthOptions?: Omit<RemoteOAuthOptions, 'managedAuth'>;
  loginOptions?: Pick<RemoteCanonicalLoginOptions, 'openBrowser' | 'browserTimeoutMs'>;
  /** 仅可信网关进程/隔离测试注入，不作为 IPC/CLI 配置开放。 */
  createManagedAuth?: (options: ManagedAuthLoaderOptions) => RemoteRuntimeManagedAuth;
  createDeviceKey?: (store: PrivateStore) => DeviceKeySigner & { create(): Promise<unknown> };
  createAuthProvider?: (options: ConstructorParameters<typeof RemoteAuthProviderImpl>[0]) => RemoteRuntimeProvider;
  createOAuth?: (options: RemoteOAuthOptions) => Pick<RemoteStepUpOAuth, 'authorize' | 'close'>;
  createController?: (options: RemoteControllerOptions) => RemoteController;
  createLogin?: (options: RemoteCanonicalLoginOptions) => Pick<RemoteCanonicalLogin, 'login' | 'close'>;
}
export interface RemoteRuntimeStatus {
  state:
    | 'unconfigured'
    | 'preparing'
    | 'paused'
    | 'closed'
    | 'fault'
    | 'idle'
    | 'starting'
    | 'online'
    | 'offline'
    | 'auth-required'
    | 'remote-disabled'
    | 'pairing-required';
  generation?: string;
  managed?: ManagedAuthIdentity;
  local?: RemoteTargetIdentity;
  clientId?: string;
  reason?: RemoteRuntimePauseReason | RemoteRuntimeFailure;
  pendingResume: RemoteTargetIdentity[];
  targets: RemoteTarget[];
}
interface Active {
  snapshot: RemoteActiveIdentity;
  store: PrivateStore;
  state: RemoteRuntimeStateRecord;
  stateStore: RemoteRuntimeStateStore;
}
interface Bundle {
  store: PrivateStore;
  loader: RemoteRuntimeManagedAuth;
  key: DeviceKeySigner & { create(): Promise<unknown> };
  provider: RemoteRuntimeProvider;
  oauth: Pick<RemoteStepUpOAuth, 'authorize' | 'close'>;
  controller: RemoteController;
  remove?: () => void;
}
function duration(value: number | undefined, fallback: number, max: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > max) throw new RemoteRuntimeError('configuration');
  return result;
}
function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
/** 同一已运行网关唯一 Remote 所有者；未授权时没有 key、OAuth、登记或 Relay。 */
export class RemoteRuntime extends EventEmitter<{
  state: [status: RemoteRuntimeStatus];
}> {
  private readonly registry: RemoteIdentityRegistry;
  private readonly lifecycle: RemoteRuntimeLifecycle;
  private get closed(): boolean {
    return this.lifecycle.closed;
  }
  private get operation(): Operation | undefined {
    return this.lifecycle.operation;
  }
  private readonly timeout: number;
  private readonly interactionTimeout: number;
  private readonly cleanupTimeout: number;
  private active?: Active;
  private bundle?: Bundle;
  private preparing = false;
  private fault?: RemoteRuntimeFailure;
  private starting?: Promise<RemoteRuntimeStatus>;
  private storage: Promise<void> = Promise.resolve();
  private draining: Promise<void> = Promise.resolve();
  private committing = false;
  private closing?: Promise<void>;
  private loginFlow?: Pick<RemoteCanonicalLogin, 'login' | 'close'>;
  private readonly options: RemoteRuntimeOptions;
  constructor(options: RemoteRuntimeOptions) {
    super();
    this.options = {
      ...options,
      controllerOptions: options.controllerOptions
        ? {
            ...options.controllerOptions,
            relayOptions: options.controllerOptions.relayOptions
              ? { ...options.controllerOptions.relayOptions }
              : undefined,
            rpcOptions: options.controllerOptions.rpcOptions ? { ...options.controllerOptions.rpcOptions } : undefined,
          }
        : undefined,
      oauthOptions: options.oauthOptions ? { ...options.oauthOptions } : undefined,
      loginOptions: options.loginOptions ? { ...options.loginOptions } : undefined,
    };
    if (
      (options.canonicalUrl === undefined) === (options.canonicalFactory === undefined) ||
      options.canonicalUrl === ''
    )
      throw new RemoteRuntimeError('configuration');
    this.timeout = duration(options.operationTimeoutMs, 20000, 180000);
    this.interactionTimeout = duration(options.interactionTimeoutMs, 600000, 600000);
    this.cleanupTimeout = duration(options.cleanupTimeoutMs, 20000, 60000);
    this.lifecycle = new RemoteRuntimeLifecycle(this.timeout, this.interactionTimeout, this.cleanupTimeout);
    this.registry = options.registry ?? new RemoteIdentityRegistry(options.store ?? new PrivateStore());
  }
  status(): RemoteRuntimeStatus {
    const active = this.active;
    const state = this.closed
      ? 'closed'
      : this.preparing
        ? 'preparing'
        : this.fault
          ? 'fault'
          : !active
            ? 'unconfigured'
            : active.state.paused
              ? 'paused'
              : (this.bundle?.controller.state ?? 'idle');
    return {
      state,
      ...(active
        ? {
            generation: active.snapshot.generation,
            managed: { ...active.snapshot.managed },
            local: { ...active.snapshot.local },
            clientId: active.snapshot.enrollment.clientId,
          }
        : {}),
      ...(this.committing || this.fault
        ? { reason: this.committing ? ('commit-pending' as const) : this.fault }
        : active && (active.state.paused || active.state.pending.length)
          ? { reason: active.state.reason }
          : {}),
      pendingResume: active?.state.pending.map((value) => ({ ...value })) ?? [],
      targets: this.bundle?.controller.targets.map((value) => ({ ...value })) ?? [],
    };
  }
  private publish(): void {
    for (const listener of this.rawListeners('state')) {
      try {
        Reflect.apply(listener, this, [this.status()]);
      } catch {
        /* 坏监听器不阻碍其他监听器与资源清理。 */
      }
    }
  }
  private assert(op: Operation): void {
    this.lifecycle.assert(op);
  }
  private wait<T>(op: Operation, callback: () => Promise<T>, limit = this.timeout): Promise<T> {
    return this.lifecycle.wait(op, callback, limit);
  }
  private boundedCleanup(callback: () => Promise<unknown>): Promise<void> {
    return this.lifecycle.cleanup(callback);
  }
  private run<T>(
    signal: AbortSignal | undefined,
    callback: (op: Operation) => Promise<T>,
    interactive = false,
    query = false,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new RemoteRuntimeError('closed'));
    if (this.committing && !query) return Promise.reject(new RemoteRuntimeError('commit-pending'));
    return this.lifecycle
      .run(
        signal,
        async (op) => {
          await this.wait(op, () => this.storage);
          await this.wait(op, () => this.draining);
          return callback(op);
        },
        interactive,
      )
      .finally(() => this.publish());
  }
  private async binding(op: Operation, active: Active): Promise<RemoteControllerBinding> {
    const raw = (await this.wait(op, () =>
      active.store.readJson('controller-binding.json'),
    )) as RemoteControllerBinding | null;
    try {
      if (
        !raw ||
        raw.version !== 1 ||
        !sameRemoteManaged(remoteManaged(raw.managed), active.snapshot.managed) ||
        !sameRemoteTarget(remoteTuple(raw.local), active.snapshot.local) ||
        !equal(raw.enrollment, active.snapshot.enrollment) ||
        !Array.isArray(raw.targets) ||
        raw.targets.length < 1 ||
        raw.targets.length > 4096
      )
        throw new Error();
      const targets = raw.targets.map(remoteTuple);
      if (
        new Set(targets.map((value) => value.environmentId)).size !== targets.length ||
        !targets.some((value) => sameRemoteTarget(value, active.snapshot.local))
      )
        throw new Error();
      return {
        version: 1,
        managed: remoteManaged(raw.managed),
        enrollment: { ...raw.enrollment },
        local: remoteTuple(raw.local),
        targets,
      };
    } catch {
      throw new RemoteRuntimeError('storage');
    }
  }
  private async load(op: Operation): Promise<Active | undefined> {
    const current = await this.wait(op, () => this.registry.readActive());
    if (!current) {
      await this.stop(op);
      this.active = undefined;
      return undefined;
    }
    if (this.active && equal(current.snapshot, this.active.snapshot)) return this.active;
    await this.stop(op);
    const stateStore = new RemoteRuntimeStateStore(
      current.store,
      current.snapshot.generation,
      current.snapshot.managed,
    );
    const state = await this.wait(op, () => stateStore.read());
    if (!state) throw new RemoteRuntimeError('storage');
    this.active = { ...current, stateStore, state };
    return this.active;
  }
  private save(active: Active, state: RemoteRuntimeStateRecord): Promise<void> {
    const next = this.storage.then(() => active.stateStore.write(state));
    this.storage = next.catch(() => undefined);
    return next.then(() => {
      if (this.active === active) active.state = state;
    });
  }
  private async pause(op: Operation, active: Active, reason: RemoteRuntimePauseReason): Promise<void> {
    const binding = await this.binding(op, active);
    await this.wait(op, () =>
      this.save(active, {
        ...active.state,
        paused: true,
        reason,
        pending: mergeRemotePending(active.state.pending, binding.targets),
      }),
    );
    this.publish();
  }
  private makeBundle(
    store: PrivateStore,
    expectedManaged?: ManagedAuthIdentity,
    expectedLocal?: RemoteTargetIdentity,
  ): Bundle {
    let loader: RemoteRuntimeManagedAuth | undefined;
    let oauth: Bundle['oauth'] | undefined;
    let controller: RemoteController | undefined;
    try {
      loader = (this.options.createManagedAuth ?? ((options) => new ManagedAuthLoader(options)))({
        canonicalUrl: this.options.canonicalUrl,
        canonicalFactory: this.options.canonicalFactory,
        now: this.options.now,
        operationTimeoutMs: this.timeout,
      });
      const key = this.options.createDeviceKey?.(store) ?? new SecureEnclaveDeviceKey({ store });
      const provider = (this.options.createAuthProvider ?? ((options) => new RemoteAuthProviderImpl(options)))({
        store,
        deviceKey: key,
        loadManagedAuth: () => loader!.load(),
        fetch: this.options.fetch,
        now: this.options.now,
        requestTimeoutMs: this.timeout,
        signTimeoutMs: this.timeout,
      });
      oauth = (this.options.createOAuth ?? ((options) => new RemoteStepUpOAuth(options)))({
        ...this.options.oauthOptions,
        managedAuth: loader,
      });
      controller = (this.options.createController ?? ((options) => new RemoteController(options)))({
        ...this.options.controllerOptions,
        store,
        managedAuth: loader,
        authProvider: provider,
        canonicalUrl: this.options.canonicalUrl,
        canonicalFactory: this.options.canonicalFactory,
        fetch: this.options.fetch,
        now: this.options.now,
        operationTimeoutMs: this.timeout,
        expectedManaged,
        expectedLocal,
      });
      return { store, loader, key, provider, oauth, controller };
    } catch {
      void dispose(controller);
      void dispose(oauth);
      void dispose(loader);
      throw new RemoteRuntimeError('unavailable');
    }
  }
  private async destroy(bundle: Bundle): Promise<void> {
    try {
      bundle.remove?.();
    } catch {
      /* 清理继续。 */
    }
    // close 的同步部分先终止 Relay，再并行清理不会阻塞其他资源。
    const controller = dispose(bundle.controller);
    const oauth = dispose(bundle.oauth);
    const loader = dispose(bundle.loader);
    await this.boundedCleanup(() => Promise.all([controller, oauth, loader]));
  }
  private async stop(op: Operation): Promise<void> {
    const bundle = this.bundle;
    this.bundle = undefined;
    if (!bundle) return;
    try {
      bundle.remove?.();
    } catch {
      /* 继续关闭所有资源。 */
    }
    this.draining = dispose(bundle.controller);
    const oauth = dispose(bundle.oauth);
    const loader = dispose(bundle.loader);
    await this.wait(op, () => this.draining, this.cleanupTimeout);
    await this.wait(op, () => Promise.all([oauth, loader]), this.cleanupTimeout);
  }
  private install(bundle: Bundle): void {
    this.bundle = bundle;
    const changed = () => {
      if (this.bundle !== bundle || this.closed) return;
      if (['auth-required', 'paused', 'remote-disabled'].includes(bundle.controller.state) && this.active) {
        const active = this.active;
        const binding = bundle.controller.binding;
        const state = {
          ...active.state,
          paused: true,
          reason: 'auth-required' as const,
          pending: mergeRemotePending(active.state.pending, binding?.targets ?? []),
        };
        active.state = state;
        void this.save(active, state).catch(() => {
          this.fault = 'storage';
          this.publish();
        });
      }
      this.publish();
    };
    bundle.controller.on('state', changed);
    bundle.controller.on('targets', changed);
    bundle.remove = () => {
      bundle.controller.off('state', changed);
      bundle.controller.off('targets', changed);
    };
  }
  private async ready(op: Operation, active: Active): Promise<Bundle> {
    if (!this.bundle) this.install(this.makeBundle(active.store, active.snapshot.managed, active.snapshot.local));
    const bundle = this.bundle!;
    try {
      const identity = await this.wait(op, () => bundle.loader.verifyIdentity(active.snapshot.managed));
      if (!sameRemoteManaged(identity, active.snapshot.managed)) throw new RemoteRuntimeError('identity-changed');
      const enrollment = await this.wait(op, () => bundle.provider.verifyBinding());
      const { version: _version, identity: _identity, ...binding } = enrollment;
      if (!equal(binding, active.snapshot.enrollment)) throw new RemoteRuntimeError('identity-changed');
      return bundle;
    } catch (error) {
      if (classify(error) === 'identity-changed')
        await this.pause(op, active, 'identity-changed').catch(() => {
          this.fault = 'storage';
        });
      await this.stop(op).catch(() => undefined);
      throw error;
    }
  }
  start(): Promise<RemoteRuntimeStatus> {
    if (this.starting) return this.starting;
    const pending = this.run(undefined, async (op) => {
      try {
        const active = await this.load(op);
        this.fault = undefined;
        if (!active || active.state.paused) return this.status();
        const bundle = await this.ready(op, active);
        await this.wait(op, () => bundle.controller.start());
        return this.status();
      } catch (error) {
        this.fault = classify(error);
        await this.stop(op).catch(() => undefined);
        return this.status();
      }
    });
    this.starting = pending;
    void pending
      .finally(() => {
        if (this.starting === pending) this.starting = undefined;
      })
      .catch(() => undefined);
    return pending;
  }
  /** 核对已提交指针，不连接 Remote、不重试授权；提交尚未结束时明确保留待核对分类。 */
  queryStatus(): Promise<RemoteRuntimeStatus> {
    if (this.operation) return Promise.resolve(this.status());
    return this.run(
      undefined,
      async (op) => {
        await this.load(op);
        if (!this.committing) this.fault = undefined;
        else this.fault = 'commit-pending';
        return this.status();
      },
      false,
      true,
    );
  }
  private async expected(op: Operation, bundle: Bundle, managed: ManagedAuthIdentity): Promise<void> {
    const actual = await this.wait(op, () => bundle.loader.verifyIdentity(managed));
    if (!sameRemoteManaged(actual, managed)) throw new RemoteRuntimeError('identity-changed');
  }
  private async commit(
    op: Operation,
    candidate: RemoteIdentityCandidate,
    bundle: Bundle,
    state: RemoteRuntimeStateRecord,
  ): Promise<Active> {
    const binding = bundle.controller.binding;
    if (!binding) throw new RemoteRuntimeError('unavailable');
    const stateStore = new RemoteRuntimeStateStore(candidate.store, candidate.generation, binding.managed);
    await this.wait(op, () => stateStore.write(state));
    await this.expected(op, bundle, binding.managed);
    await this.wait(op, () => bundle.provider.verifyBinding());
    this.assert(op);
    this.committing = true;
    const commit = Promise.resolve().then(() => {
      this.assert(op);
      return this.registry.activate(candidate, binding);
    });
    // 无法撤销原子提交；晚结果只触发下一次查询，不会安装 bundle 或打开 Relay。
    void commit
      .finally(() => {
        this.committing = false;
      })
      .catch(() => undefined);
    try {
      await this.wait(op, () => commit);
    } catch (error) {
      await this.wait(op, async () => {
        const actual = await this.registry.readActive();
        if (actual?.snapshot.generation === candidate.generation) this.active = { ...actual, stateStore, state };
      }).catch(() => undefined);
      this.fault = 'commit-pending';
      throw new RemoteRuntimeError('commit-pending');
    }
    const actual = await this.wait(op, () => this.registry.readActive());
    if (!actual || actual.snapshot.generation !== candidate.generation) throw new RemoteRuntimeError('commit-pending');
    const active = { ...actual, stateStore, state };
    this.active = active;
    return active;
  }
  private async replace(
    op: Operation,
    kind: 'authorize' | 'recover' | 'reassociate',
    previous?: RemoteTargetIdentity,
    next?: RemoteTargetIdentity,
  ): Promise<RemoteRuntimeStatus> {
    const base = await this.load(op);
    if (kind === 'authorize' && base) throw new RemoteRuntimeError('already-configured');
    if (kind !== 'authorize' && !base) throw new RemoteRuntimeError('not-configured');
    if (
      kind === 'reassociate' &&
      (!previous || !next || !sameRemoteTarget(previous, base!.snapshot.local) || sameRemoteTarget(previous, next))
    )
      throw new RemoteRuntimeError('identity-changed');
    let pending: RemoteTargetIdentity[] = [];
    if (base) {
      await this.pause(op, base, kind === 'reassociate' ? 'reassociation' : 'reauthorization');
      pending = base.state.pending;
    }
    await this.stop(op);
    this.preparing = true;
    this.fault = undefined;
    this.publish();
    let bundle: Bundle | undefined;
    let committed: Active | undefined;
    try {
      const candidate = await this.wait(op, () =>
        this.registry.beginCandidate(
          kind === 'reassociate' ? { reassociateLocal: { previous: previous!, next: next! } } : undefined,
        ),
      );
      if (!equal(candidate.expectedActive, base?.snapshot ?? null)) throw new RemoteRuntimeError('identity-changed');
      bundle = this.makeBundle(
        candidate.store,
        base?.snapshot.managed,
        kind === 'reassociate' ? next : base?.snapshot.local,
      );
      const expected =
        base?.snapshot.managed ?? remoteManaged(await this.wait(op, () => bundle!.loader.verifyIdentity()));
      await this.expected(op, bundle, expected);
      if (kind === 'reassociate') {
        for (const name of ['device-key.json', 'enrollment.json']) {
          const value = await this.wait(op, () => base!.store.readJson(name));
          if (!value || !(await this.wait(op, () => candidate.store.createJson(name, value))))
            throw new RemoteRuntimeError('storage');
        }
        await this.wait(op, () => bundle!.provider.verifyBinding());
      } else {
        await this.wait(op, () => bundle!.key.create());
        await this.expected(op, bundle, expected);
        const stepUp = await this.wait(op, () => bundle!.oauth.authorize(op.abort.signal), this.interactionTimeout);
        await this.expected(op, bundle, expected);
        await this.wait(op, () => bundle!.provider.enroll(stepUp));
      }
      await this.expected(op, bundle, expected);
      await this.wait(op, () => bundle!.controller.pairLocal());
      await this.wait(op, () => bundle!.controller.refreshTargets());
      await this.expected(op, bundle, expected);
      await this.wait(op, () => bundle!.provider.verifyBinding());
      const binding = bundle.controller.binding;
      if (
        !binding ||
        !sameRemoteManaged(binding.managed, expected) ||
        (base && !sameRemoteTarget(binding.local, kind === 'reassociate' ? next! : base.snapshot.local)) ||
        (kind === 'reassociate' && !equal(binding.enrollment, base!.snapshot.enrollment))
      )
        throw new RemoteRuntimeError('identity-changed');
      const state: RemoteRuntimeStateRecord = {
        version: 1,
        generation: candidate.generation,
        managed: { ...expected },
        paused: true,
        reason: kind === 'reassociate' ? 'reassociation' : 'reauthorization',
        pending: mergeRemotePending(pending),
      };
      const active = await this.commit(op, candidate, bundle, state);
      committed = active;
      await this.expected(op, bundle, expected);
      await this.wait(op, () => bundle!.provider.verifyBinding());
      await this.wait(op, () => bundle!.controller.refreshTargets());
      await this.wait(op, () => this.save(active, { ...state, paused: false }));
      this.assert(op);
      this.install(bundle);
      bundle = undefined;
      await this.wait(op, () => this.bundle!.controller.start());
      this.preparing = false;
      return this.status();
    } catch (error) {
      this.fault = classify(error);
      if (committed) {
        const active = committed;
        // 已开始的 sidecar 写入不能撤销，按同一队列排入保守暂停，晚结果不会成为重启授权。
        const paused = { ...active.state, paused: true };
        await this.boundedCleanup(() => this.save(active, paused));
        if (this.bundle?.store.directory === active.store.directory) {
          const installed = this.bundle;
          this.bundle = undefined;
          await this.destroy(installed);
        }
      }
      throw error;
    } finally {
      if (bundle) await this.destroy(bundle);
      this.preparing = false;
    }
  }
  authorize(signal?: AbortSignal): Promise<RemoteRuntimeStatus> {
    return this.run(signal, (op) => this.replace(op, 'authorize'), true);
  }
  recover(signal?: AbortSignal): Promise<RemoteRuntimeStatus> {
    return this.run(signal, (op) => this.replace(op, 'recover'), true);
  }
  reauthorize(signal?: AbortSignal): Promise<RemoteRuntimeStatus> {
    return this.recover(signal);
  }
  login(signal?: AbortSignal): Promise<Readonly<ManagedAuthIdentity>> {
    return this.run(
      signal,
      async (op) => {
        const active = await this.load(op);
        if (active) await this.pause(op, active, 'login');
        await this.stop(op);
        const flow = (this.options.createLogin ?? ((options) => new RemoteCanonicalLogin(options)))({
          ...this.options.loginOptions,
          canonicalUrl: this.options.canonicalUrl,
          canonicalFactory: this.options.canonicalFactory,
          timeoutMs: this.interactionTimeout,
          operationTimeoutMs: this.timeout,
          createManagedAuth: () =>
            (this.options.createManagedAuth ?? ((options) => new ManagedAuthLoader(options)))({
              canonicalUrl: this.options.canonicalUrl,
              canonicalFactory: this.options.canonicalFactory,
              now: this.options.now,
              operationTimeoutMs: this.timeout,
            }),
        });
        this.loginFlow = flow;
        try {
          return await this.wait(op, () => flow.login(op.abort.signal), this.interactionTimeout);
        } finally {
          await this.boundedCleanup(() => dispose(flow));
          if (this.loginFlow === flow) this.loginFlow = undefined;
        }
      },
      true,
    );
  }
  private async manage(op: Operation): Promise<{ active: Active; bundle: Bundle }> {
    const active = await this.load(op);
    if (!active) throw new RemoteRuntimeError('not-configured');
    const bundle = await this.ready(op, active);
    return { active, bundle };
  }
  refreshTargets(signal?: AbortSignal): Promise<readonly RemoteTarget[]> {
    return this.run(signal, async (op) => {
      const { bundle } = await this.manage(op);
      return this.wait(op, () => bundle.controller.refreshTargets());
    });
  }
  pairLocal(signal?: AbortSignal): Promise<void> {
    return this.run(signal, async (op) => {
      const { bundle } = await this.manage(op);
      await this.wait(op, () => bundle.controller.pairLocal());
    });
  }
  pairManual(code: string, value: RemoteTargetIdentity, signal?: AbortSignal): Promise<void> {
    const target = remoteTuple(value);
    return this.run(signal, async (op) => {
      const { active, bundle } = await this.manage(op);
      await this.wait(op, () => bundle.controller.refreshTargets());
      mergeRemotePending(active.state.pending, bundle.controller.binding?.targets ?? [], [target]);
      await this.wait(op, () => bundle.controller.pairManual(code, target));
    });
  }
  acceptTarget(value: RemoteTargetIdentity, signal?: AbortSignal): Promise<void> {
    const target = remoteTuple(value);
    return this.run(signal, async (op) => {
      const { active, bundle } = await this.manage(op);
      await this.wait(op, () => bundle.controller.refreshTargets());
      mergeRemotePending(active.state.pending, bundle.controller.binding?.targets ?? [], [target]);
      await this.wait(op, () => bundle.controller.acceptTarget(target));
    });
  }
  resume(value: RemoteTargetIdentity, signal?: AbortSignal): Promise<RemoteRuntimeStatus> {
    const target = remoteTuple(value);
    return this.run(signal, async (op) => {
      const { active, bundle } = await this.manage(op);
      const accepted = await this.binding(op, active);
      if (!accepted.targets.some((value) => sameRemoteTarget(value, target)))
        throw new RemoteRuntimeError('target-unaccepted');
      if (['paused', 'auth-required', 'remote-disabled'].includes(bundle.controller.state))
        await this.wait(op, () => bundle.controller.resume());
      let targets: readonly RemoteTarget[];
      try {
        targets = await this.wait(op, () => bundle.controller.refreshTargets());
      } catch (error) {
        if (!['paused', 'auth-required', 'remote-disabled'].includes(bundle.controller.state)) throw error;
        await this.wait(op, () => bundle.controller.resume());
        targets = await this.wait(op, () => bundle.controller.refreshTargets());
      }
      if (!bundle.controller.binding?.targets.some((value) => sameRemoteTarget(value, target)))
        throw new RemoteRuntimeError('target-unaccepted');
      if (
        !targets.some(
          (value) => value.env_id === target.environmentId && value.installation_id === target.installationId,
        )
      )
        throw new RemoteRuntimeError('target-unavailable');
      await this.expected(op, bundle, active.snapshot.managed);
      await this.wait(op, () => bundle.provider.verifyBinding());
      const before = active.state;
      try {
        await this.wait(op, () =>
          this.save(active, {
            ...before,
            paused: false,
            pending: before.pending.filter((value) => !sameRemoteTarget(value, target)),
          }),
        );
      } catch (error) {
        await this.boundedCleanup(() => this.save(active, before));
        throw error;
      }
      this.fault = undefined;
      await this.wait(op, () => bundle.controller.start());
      return this.status();
    });
  }
  reassociate(
    previousValue: RemoteTargetIdentity,
    nextValue: RemoteTargetIdentity,
    pairingCode?: string,
    signal?: AbortSignal,
  ): Promise<RemoteRuntimeStatus> {
    const previous = remoteTuple(previousValue);
    const next = remoteTuple(nextValue);
    return this.run(
      signal,
      async (op) => {
        const active = await this.load(op);
        if (!active) throw new RemoteRuntimeError('not-configured');
        if (sameRemoteTarget(previous, active.snapshot.local)) {
          if (pairingCode !== undefined) throw new RemoteRuntimeError('configuration');
          return this.replace(op, 'reassociate', previous, next);
        }
        const binding = await this.binding(op, active);
        if (!binding.targets.some((value) => sameRemoteTarget(value, previous)))
          throw new RemoteRuntimeError('target-unaccepted');
        if (
          sameRemoteTarget(previous, next) ||
          binding.targets.some(
            (value) => value.environmentId === next.environmentId && !sameRemoteTarget(value, previous),
          )
        )
          throw new RemoteRuntimeError('identity-changed');
        mergeRemotePending(active.state.pending, binding.targets, [next]);
        await this.wait(op, () =>
          this.save(active, {
            ...active.state,
            reason: 'reassociation',
            pending: mergeRemotePending(active.state.pending, [previous]),
          }),
        );
        if (!this.bundle) this.install(this.makeBundle(active.store, active.snapshot.managed, active.snapshot.local));
        const bundle = this.bundle!;
        await this.wait(op, () => bundle.controller.reassociateTarget(previous, next, pairingCode));
        return this.status();
      },
      true,
    );
  }
  private executable(value: RemoteTargetIdentity): {
    target: RemoteTargetIdentity;
    bundle: Bundle;
  } {
    const target = remoteTuple(value);
    if (this.closed) throw new RemoteRuntimeError('closed');
    if (!this.active) throw new RemoteRuntimeError('not-configured');
    if (this.preparing || this.operation || this.active.state.paused || !this.bundle)
      throw new RemoteRuntimeError('unavailable');
    if (this.active.state.pending.some((value) => sameRemoteTarget(value, target)))
      throw new RemoteRuntimeError('pending-resume');
    return { target, bundle: this.bundle };
  }
  createRawStream(value: RemoteTargetIdentity): RemoteStream {
    const { target, bundle } = this.executable(value);
    try {
      return bundle.controller.createRawStream(target);
    } catch {
      throw new RemoteRuntimeError('unavailable');
    }
  }
  createManagementSession(value: RemoteTargetIdentity, signal?: AbortSignal): Promise<RemoteRpcSession> {
    const { target, bundle } = this.executable(value);
    return this.run(signal, async (op) => {
      let abandoned = false;
      const pending = Promise.resolve().then(() => {
        this.assert(op);
        return bundle.controller.createManagementSession(target);
      });
      void pending.then(
        (session) => {
          if (abandoned) void dispose(session);
        },
        () => undefined,
      );
      try {
        const session = await this.wait(op, () => pending);
        if (
          this.bundle !== bundle ||
          this.active?.state.paused ||
          this.active?.state.pending.some((value) => sameRemoteTarget(value, target))
        ) {
          void dispose(session);
          throw new RemoteRuntimeError('unavailable');
        }
        return session;
      } catch (error) {
        abandoned = true;
        throw error;
      }
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    const pending = this.lifecycle.pending;
    this.lifecycle.close();
    const bundle = this.bundle;
    this.bundle = undefined;
    const login = dispose(this.loginFlow);
    this.closing = this.boundedCleanup(async () => {
      await Promise.all([bundle ? this.destroy(bundle) : Promise.resolve(), login, this.storage, this.draining]);
    });
    this.publish();
    this.removeAllListeners();
    return this.closing;
  }
}
