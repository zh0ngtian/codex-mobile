import { createHash } from 'node:crypto';
import type { OperationContext, OperationAuthorizationFence } from './operation-queue.js';
import { sameRemoteManaged } from './remote/runtime-state.js';
import type { GatewayIdentity } from './gateway-identity.js';
import { RemoteRuntime, RemoteRuntimeError, type RemoteRuntimeTargetBinding } from './remote/runtime.js';
import { remoteTuple, sameRemoteTarget } from './remote/runtime-state.js';
import type { RemoteTargetIdentity } from './remote/catalog.js';
import type { RemoteRpcSessionOptions } from './remote/rpc-session.js';

export type TargetFailure = 'invalid-reference' | 'gateway-mismatch' | 'not-configured' | 'identity-changed' | 'target-unaccepted' |
  'target-changed' | 'target-missing' | 'target-offline' | 'pending-resume' | 'paused' | 'closed' | 'busy' | 'unavailable';
export class TargetResolutionError extends Error {
  constructor(readonly code: TargetFailure) { super('目标身份不可用或授权状态已变化'); this.name = 'TargetResolutionError'; }
}
export interface TargetAccount { readonly accountId: string; readonly accountUserId: string; readonly userId?: string }
export interface RemoteTargetReference {
  readonly mode: 'remote'; readonly gatewayId: string; readonly account: TargetAccount; readonly target: Readonly<RemoteTargetIdentity>;
}
interface BaseDescriptor {
  readonly mode: 'local' | 'remote'; readonly gatewayId: string;
  /** 仅用于业务归组，绝不能作为Remote数据可见性或发送授权。 */
  readonly businessKey: string;
  readonly authorizationKey: string;
  readonly transportNamespace: string;
}
export interface LocalTargetDescriptor extends BaseDescriptor { readonly mode: 'local'; readonly localHostId: string }
export interface RemoteTargetDescriptor extends BaseDescriptor {
  readonly mode: 'remote'; readonly account: Readonly<TargetAccount>; readonly target: Readonly<RemoteTargetIdentity>;
  readonly generation: string; readonly online: boolean;
}
function hash(parts: unknown[]): string { return createHash('sha256').update(JSON.stringify(parts)).digest('hex'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key)) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(item => !('value' in item))) throw new TargetResolutionError('invalid-reference');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new TargetResolutionError('invalid-reference');
  return value;
}
function account(value: unknown): Readonly<TargetAccount> {
  const raw = object(value, ['accountId', 'accountUserId', 'userId']);
  return Object.freeze({ accountId: text(raw.accountId), accountUserId: text(raw.accountUserId),
    ...(Object.hasOwn(raw, 'userId') ? { userId: text(raw.userId) } : {}) });
}
function parse(value: unknown): RemoteTargetReference | undefined {
  if (value === undefined) return;
  const raw = object(value, ['mode', 'gatewayId', 'account', 'target']);
  if (raw.mode === undefined || raw.mode === 'local') {
    if (Reflect.ownKeys(raw).some(key => key !== 'mode')) throw new TargetResolutionError('invalid-reference');
    return;
  }
  if (raw.mode !== 'remote') throw new TargetResolutionError('invalid-reference');
  try {
    object(raw.target, ['environmentId', 'installationId']);
    return Object.freeze({ mode: 'remote', gatewayId: text(raw.gatewayId), account: account(raw.account), target: Object.freeze(remoteTuple(raw.target)) });
  } catch { throw new TargetResolutionError('invalid-reference'); }
}
function failure(error: unknown): never {
  if (error instanceof TargetResolutionError) throw error;
  if (error instanceof RemoteRuntimeError && ['not-configured', 'identity-changed', 'pending-resume', 'closed', 'busy'].includes(error.code))
    throw new TargetResolutionError(error.code as TargetFailure);
  throw new TargetResolutionError('unavailable');
}
function authorization(gateway: string, binding: RemoteRuntimeTargetBinding, target: Readonly<RemoteTargetIdentity>): string {
  // 完整managed含可信codexHome与userId存在性，generation拒绝旧授权handle；公开descriptor不暴露home。
  return hash(['remote-authorization-v1', gateway, binding.generation, binding.managed, target]);
}
function check(reference: RemoteTargetReference, binding: RemoteRuntimeTargetBinding, execute: boolean): boolean {
  const expected = reference.account; const current = binding.managed;
  if (expected.accountId !== current.accountId || expected.accountUserId !== current.accountUserId ||
    Object.hasOwn(expected, 'userId') !== Object.hasOwn(current, 'userId') || expected.userId !== current.userId)
    throw new TargetResolutionError('identity-changed');
  const accepted = binding.acceptedTargets.find(value => value.environmentId === reference.target.environmentId);
  if (!accepted) throw new TargetResolutionError('target-unaccepted');
  if (!sameRemoteTarget(accepted, reference.target)) throw new TargetResolutionError('target-changed');
  if (binding.pendingResume.some(value => sameRemoteTarget(value, reference.target))) throw new TargetResolutionError('pending-resume');
  const visible = binding.targets.find(value => value.env_id === reference.target.environmentId);
  if (!visible) throw new TargetResolutionError('target-missing');
  if (visible.installation_id !== reference.target.installationId) throw new TargetResolutionError('target-changed');
  const online = binding.state === 'online' && visible.online;
  if (execute && !online) throw new TargetResolutionError('target-offline');
  return online;
}
export class ResolvedLocalTarget {
  constructor(readonly descriptor: Readonly<LocalTargetDescriptor>) { Object.freeze(this); }
  async assertCurrent(): Promise<void> { /* Local始终由原canonical路径执行，不要求Remote身份。 */ }
}
export class ResolvedRemoteTarget {
  readonly #runtime: RemoteRuntime;
  readonly #reference: RemoteTargetReference;
  constructor(readonly descriptor: Readonly<RemoteTargetDescriptor>, runtime: RemoteRuntime, reference: RemoteTargetReference) {
    this.#runtime = runtime; this.#reference = reference; Object.freeze(this);
  }
  /** 仅比较可信句柄的实际Runtime归属；持久描述相同不代表同一运行实例。 */
  sharesRuntime(other: ResolvedRemoteTarget): boolean { return this.#runtime === other.#runtime; }
  private async binding(execute: boolean, signal?: AbortSignal): Promise<RemoteRuntimeTargetBinding> {
    try {
      const status = this.#runtime.status();
      if (status.state === 'closed') throw new TargetResolutionError('closed');
      if (status.state === 'paused') throw new TargetResolutionError('paused');
      const binding = await this.#runtime.readTargetBinding(signal);
      if (authorization(this.descriptor.gatewayId, binding, this.#reference.target) !== this.descriptor.authorizationKey)
        throw new TargetResolutionError('identity-changed');
      check(this.#reference, binding, execute);
      return binding;
    } catch (error) { return failure(error); }
  }
  async assertCurrent(signal?: AbortSignal): Promise<void> { await this.binding(false, signal); }
  /** 只供可信消费者装配Commands/Files，不能作为公开host信息。 */
  async remoteScope(signal?: AbortSignal) {
    const binding = await this.binding(false, signal);
    return Object.freeze({ managed: binding.managed, target: this.#reference.target });
  }
  async createRawStream(signal?: AbortSignal) {
    try {
      const status = this.#runtime.status();
      if (status.state === 'closed') throw new TargetResolutionError('closed');
      if (status.state === 'paused') throw new TargetResolutionError('paused');
      return await this.#runtime.createRawStreamWithBinding(this.#reference.target, binding => {
        if (authorization(this.descriptor.gatewayId, binding, this.#reference.target) !== this.descriptor.authorizationKey)
          throw new TargetResolutionError('identity-changed');
        check(this.#reference, binding, true);
      }, signal);
    } catch (error) { return failure(error); }
  }
  async createManagementSession(signal?: AbortSignal, options?: RemoteRpcSessionOptions) {
    await this.binding(true, signal);
    try {
      const session = await this.#runtime.createManagementSession(this.#reference.target, signal, options);
      try { await this.binding(true, signal); return session; }
      catch (error) { await session.settled(); throw error; }
    } catch (error) { return failure(error); }
  }
}
/** 进程内身份边界；尚未接入公开HTTP/WS路由。 */
export class TargetResolver {
  private readonly identity: Readonly<GatewayIdentity>;
  private readonly local: Readonly<LocalTargetDescriptor>;
  readonly #runtime?: RemoteRuntime;
  constructor(options: { identity: Readonly<GatewayIdentity>; remoteRuntime?: RemoteRuntime }) {
    const identity = options.identity; this.#runtime = options.remoteRuntime;
    if (identity.version !== 1 || !identity.gatewayId || !identity.localHostId) throw new TargetResolutionError('invalid-reference');
    this.identity = Object.freeze({ ...identity });
    const businessKey = hash(['gateway-local-v1', identity.gatewayId, identity.localHostId]);
    this.local = Object.freeze({ mode: 'local', gatewayId: identity.gatewayId, localHostId: identity.localHostId,
      businessKey, authorizationKey: businessKey, transportNamespace: hash(['transport-v1', 'local', businessKey]) });
  }
  /** 可信进程构造完整冻结context；公开account不能代替managed证明。 */
  async operationContext(value?: unknown, signal?: AbortSignal): Promise<OperationContext> {
    const handle = await this.resolve(value, signal);
    const descriptor = handle.descriptor;
    if (descriptor.mode === 'local') return Object.freeze({ mode: 'local', gatewayId: descriptor.gatewayId,
      localHostId: descriptor.localHostId, businessKey: descriptor.businessKey, authorizationKey: descriptor.authorizationKey });
    const scope = await (handle as ResolvedRemoteTarget).remoteScope(signal);
    return Object.freeze({ mode: 'remote', gatewayId: descriptor.gatewayId, businessKey: descriptor.businessKey,
      authorizationKey: descriptor.authorizationKey, managed: scope.managed, target: scope.target, generation: descriptor.generation });
  }
  /** queue动作含离线结果落盘；只有claim和单独执行入口要求真实在线。 */
  async authorizeOperation(context: OperationContext, action: 'submit' | 'read' | 'edit' | 'cancel' | 'claim' | 'transition', signal?: AbortSignal): Promise<OperationAuthorizationFence> {
    return (await this.operationAuthorization(context, action === 'claim', signal)).assertCurrent;
  }
  /** 后续可信scheduler在最后await后交付正文用assertCurrent；传输组合只能使用无FS assertLive。 */
  authorizeOperationExecution(context: OperationContext, signal?: AbortSignal) {
    return this.operationAuthorization(context, true, signal);
  }
  private async operationAuthorization(context: OperationContext, execute: boolean, signal?: AbortSignal): Promise<{
    assertCurrent: OperationAuthorizationFence; assertLive: OperationAuthorizationFence;
  }> {
    if (context.mode === 'local') {
      object(context, ['mode', 'gatewayId', 'localHostId', 'businessKey', 'authorizationKey']);
      if (context.gatewayId !== this.identity.gatewayId || context.localHostId !== this.local.localHostId ||
        context.businessKey !== this.local.businessKey || context.authorizationKey !== this.local.authorizationKey)
        throw new TargetResolutionError('identity-changed');
      const assertCurrent = () => { /* 真实Local固定身份，不依赖Remote所有者。 */ };
      return { assertCurrent, assertLive: assertCurrent };
    }
    object(context, ['mode', 'gatewayId', 'businessKey', 'authorizationKey', 'managed', 'target', 'generation']);
    if (context.mode !== 'remote') throw new TargetResolutionError('invalid-reference');
    object(context.managed, ['codexHome', 'accountId', 'accountUserId', 'userId']);
    if (context.gatewayId !== this.identity.gatewayId) throw new TargetResolutionError('gateway-mismatch');
    const runtime = this.#runtime;
    if (!runtime) throw new TargetResolutionError('not-configured');
    try {
      if (runtime.status().state === 'paused') throw new TargetResolutionError('paused');
      const binding = await runtime.readTargetBinding(signal);
      if (!sameRemoteManaged(context.managed, binding.managed) ||
        Object.hasOwn(context.managed, 'userId') !== Object.hasOwn(binding.managed, 'userId'))
        throw new TargetResolutionError('identity-changed');
      if (context.generation !== binding.generation) await runtime.proveOperationRecovery(context.generation, context.managed, context.target, signal);
      const reference = parse({ mode: 'remote', gatewayId: context.gatewayId, account: {
        accountId: context.managed.accountId, accountUserId: context.managed.accountUserId,
        ...(Object.hasOwn(context.managed, 'userId') ? { userId: context.managed.userId } : {}) }, target: context.target })!;
      check(reference, binding, execute);
      const businessKey = sameRemoteTarget(binding.local, context.target) ? this.local.businessKey :
        hash(['gateway-remote-v1', this.identity.gatewayId, binding.managed, context.target]);
      if (context.businessKey !== businessKey || context.authorizationKey !== authorization(this.identity.gatewayId, { ...binding, generation: context.generation }, context.target))
        throw new TargetResolutionError('identity-changed');
      return { assertCurrent: () => binding.assertCurrent(reference.target, execute), assertLive: () => binding.assertLive(reference.target, execute) };
    } catch (error) { return failure(error); }
  }
  async resolve(value: RemoteTargetReference, signal?: AbortSignal): Promise<ResolvedRemoteTarget>;
  async resolve(value?: unknown, signal?: AbortSignal): Promise<ResolvedLocalTarget | ResolvedRemoteTarget>;
  async resolve(value?: unknown, signal?: AbortSignal): Promise<ResolvedLocalTarget | ResolvedRemoteTarget> {
    const reference = parse(value);
    if (!reference) return new ResolvedLocalTarget(this.local);
    if (reference.gatewayId !== this.identity.gatewayId) throw new TargetResolutionError('gateway-mismatch');
    const runtime = this.#runtime;
    if (!runtime) throw new TargetResolutionError('not-configured');
    try {
      if (runtime.status().state === 'paused') throw new TargetResolutionError('paused');
      const binding = await runtime.readTargetBinding(signal);
      const online = check(reference, binding, false);
      const businessKey = sameRemoteTarget(binding.local, reference.target) ? this.local.businessKey :
        hash(['gateway-remote-v1', this.identity.gatewayId, binding.managed, reference.target]);
      const authorizationKey = authorization(this.identity.gatewayId, binding, reference.target);
      const descriptor = Object.freeze({ mode: 'remote' as const, gatewayId: this.identity.gatewayId, businessKey, authorizationKey,
        transportNamespace: hash(['transport-v1', 'remote', authorizationKey]), account: reference.account, target: reference.target, generation: binding.generation, online });
      return new ResolvedRemoteTarget(descriptor, runtime, reference);
    } catch (error) { return failure(error); }
  }
}
