import { randomUUID } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { parseEnrollment } from './auth-protocol.js';
import type { RemoteCatalogBinding, RemoteTargetIdentity } from './catalog.js';
import type { RemoteControllerBinding } from './controller.js';
import type { ManagedAuthIdentity } from './managed-auth.js';
import { PrivateStore } from './private-store.js';

export interface RemoteActiveIdentity {
  version: 1; revision: number; generation: string;
  managed: ManagedAuthIdentity; enrollment: RemoteCatalogBinding['enrollment']; local: RemoteTargetIdentity;
}
export interface RemoteIdentityCandidate {
  readonly generation: string; readonly store: PrivateStore; readonly expectedActive: RemoteActiveIdentity | null;
}
/** 本机重装后的未来访问必须走独立显式意图；普通授权始终保留原 local。 */
export interface RemoteIdentityCandidateOptions { reassociateLocal: { previous: RemoteTargetIdentity; next: RemoteTargetIdentity } }
export type RemoteIdentityRegistryFailure = 'storage-unavailable' | 'record-invalid' | 'legacy-root' | 'candidate-invalid' | 'candidate-unprepared' | 'active-changed' | 'identity-changed';
const MESSAGES: Record<RemoteIdentityRegistryFailure, string> = {
  'storage-unavailable': 'Remote 身份私有存储不可用',
  'record-invalid': 'Remote 活动身份记录损坏，需要显式处理',
  'legacy-root': 'Remote 根目录已有旧身份，不能自动迁移或覆盖',
  'candidate-invalid': 'Remote 候选身份或重新关联意图无效',
  'candidate-unprepared': 'Remote 候选身份尚未完成完整登记与本机配对',
  'active-changed': 'Remote 活动身份已变化，需要重新发起明确授权',
  'identity-changed': 'Remote 候选身份与原账号或本机绑定不一致',
};
export class RemoteIdentityRegistryError extends Error {
  constructor(readonly code: RemoteIdentityRegistryFailure) { super(MESSAGES[code]); this.name = 'RemoteIdentityRegistryError'; }
}
const REGISTRY = 'identity-registry.json'; const ACTIVE = 'active-identity.json';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const GENERATION = /^identity-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
type Intent = { kind: 'authorize' } | { kind: 'reassociate-local'; previous: RemoteTargetIdentity; next: RemoteTargetIdentity };
interface CandidateRecord { version: 1; registryId: string; generation: string; nonce: string; expectedActive: RemoteActiveIdentity | null; intent: Intent }
interface Pointer { registryId: string; snapshot: RemoteActiveIdentity }
function fail(code: RemoteIdentityRegistryFailure = 'record-invalid'): never { throw new RemoteIdentityRegistryError(code); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !keys.includes(key))) fail(); return raw;
}
function text(value: unknown): string { if (typeof value !== 'string' || !value.length || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) fail(); return value; }
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) fail(); return value; }
function generation(value: unknown): string { if (typeof value !== 'string' || !GENERATION.test(value)) fail(); return value; }
function tuple(value: unknown): RemoteTargetIdentity { const raw = object(value, ['environmentId', 'installationId']); return { environmentId: text(raw.environmentId), installationId: text(raw.installationId) }; }
function managed(value: unknown): ManagedAuthIdentity {
  const raw = object(value, ['codexHome', 'accountId', 'accountUserId', 'userId']); const home = text(raw.codexHome);
  if (!isAbsolute(home) || normalize(home) !== home) fail();
  return { codexHome: home, accountId: text(raw.accountId), accountUserId: text(raw.accountUserId), ...(raw.userId === undefined ? {} : { userId: text(raw.userId) }) };
}
function enrollment(value: unknown): RemoteCatalogBinding['enrollment'] {
  const raw = object(value, ['clientId', 'accountId', 'accountUserId', 'managedAccountUserId', 'identityHash']);
  return { clientId: text(raw.clientId), accountId: text(raw.accountId), accountUserId: text(raw.accountUserId), managedAccountUserId: text(raw.managedAccountUserId), identityHash: text(raw.identityHash) };
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function sameTarget(a: RemoteTargetIdentity, b: RemoteTargetIdentity): boolean { return a.environmentId === b.environmentId && a.installationId === b.installationId; }
function bindingFields(value: Record<string, unknown>): Pick<RemoteActiveIdentity, 'managed' | 'enrollment' | 'local'> {
  const result = { managed: managed(value.managed), enrollment: enrollment(value.enrollment), local: tuple(value.local) };
  if (result.managed.accountId !== result.enrollment.accountId || result.managed.accountUserId !== result.enrollment.managedAccountUserId || (result.enrollment.accountUserId !== result.managed.accountUserId && result.enrollment.accountUserId !== result.managed.userId)) fail();
  return result;
}
function snapshot(value: unknown): RemoteActiveIdentity {
  const raw = object(value, ['version', 'revision', 'generation', 'managed', 'enrollment', 'local']);
  if (raw.version !== 1 || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1) fail();
  return { version: 1, revision: raw.revision as number, generation: generation(raw.generation), ...bindingFields(raw) };
}
/** 只复制 controller 的持久记录契约；targets 可随未来显式配对合法更新。 */
function controller(value: unknown): RemoteControllerBinding {
  const raw = object(value, ['version', 'managed', 'enrollment', 'local', 'targets']);
  if (raw.version !== 1 || !Array.isArray(raw.targets) || raw.targets.length < 1 || raw.targets.length > 4096) fail();
  const result: RemoteControllerBinding = { version: 1, ...bindingFields(raw), targets: raw.targets.map(tuple) };
  const ids = new Set<string>();
  for (const target of result.targets) { if (ids.has(target.environmentId)) fail(); ids.add(target.environmentId); }
  if (!result.targets.some(target => sameTarget(target, result.local))) fail(); return result;
}
function intent(value: unknown): Intent {
  const raw = object(value, ['kind', 'previous', 'next']);
  if (raw.kind === 'authorize') { if (Object.keys(raw).length !== 1) fail(); return { kind: 'authorize' }; }
  if (raw.kind !== 'reassociate-local') fail();
  const previous = tuple(raw.previous); const next = tuple(raw.next); if (sameTarget(previous, next)) fail();
  return { kind: 'reassociate-local', previous, next };
}
function candidateRecord(value: unknown): CandidateRecord {
  const raw = object(value, ['version', 'registryId', 'generation', 'nonce', 'expectedActive', 'intent']);
  if (raw.version !== 1) fail();
  const record: CandidateRecord = { version: 1, registryId: uuid(raw.registryId), generation: generation(raw.generation), nonce: uuid(raw.nonce), expectedActive: raw.expectedActive === null ? null : snapshot(raw.expectedActive), intent: intent(raw.intent) };
  if (record.expectedActive?.generation === record.generation) fail();
  if (record.intent.kind === 'reassociate-local' && (!record.expectedActive || !sameTarget(record.intent.previous, record.expectedActive.local))) fail();
  return record;
}
function frozenSnapshot(value: RemoteActiveIdentity): RemoteActiveIdentity {
  const copy = snapshot(value); Object.freeze(copy.managed); Object.freeze(copy.enrollment); Object.freeze(copy.local); return Object.freeze(copy);
}
function stable(value: Pick<RemoteActiveIdentity, 'managed' | 'enrollment' | 'local'>) { return { managed: value.managed, enrollment: value.enrollment, local: value.local }; }
function validateTransition(candidate: CandidateRecord, value: Pick<RemoteActiveIdentity, 'managed' | 'enrollment' | 'local'>): void {
  const base = candidate.expectedActive; if (!base) return;
  if (!same(base.managed, value.managed)) fail('identity-changed');
  if (candidate.intent.kind === 'authorize') { if (!sameTarget(base.local, value.local)) fail('identity-changed'); }
  else if (!sameTarget(candidate.intent.next, value.local) || !same(base.enrollment, value.enrollment)) fail('identity-changed');
}

/** 仅持久化身份切换；不联网、不创建控制器、不处理旧队列或继承目标 grant。 */
export class RemoteIdentityRegistry {
  private readonly store: PrivateStore;
  private readonly directory: string;
  private readonly candidates = new WeakMap<RemoteIdentityCandidate, CandidateRecord>();
  constructor(store = new PrivateStore()) {
    // 不采用调用方之后修改的 store.directory，也不使用 candidate 暴露的 store 作权威路径。
    this.directory = store.directory; this.store = store.fork();
  }
  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try { this.store.assertOwnership(); const value = await operation(); this.store.assertOwnership(); return value; }
    catch (error) {
      if (error instanceof RemoteIdentityRegistryError && Object.hasOwn(MESSAGES, error.code)) throw new RemoteIdentityRegistryError(error.code);
      throw new RemoteIdentityRegistryError('storage-unavailable');
    }
  }
  private async read(store: PrivateStore, name: string): Promise<unknown | null> {
    const value = await store.readJson(name);
    if (value !== null) return value;
    // JSON null 是损坏记录；缺失读取之后可能恰有合法 writer 首次提交，
    // 存在性检查后再读取一次，避免把这一并发窗口误报为损坏。
    try { await lstat(join(store.directory, name)); }
    catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null; throw error; }
    const committed = await store.readJson(name); if (committed !== null) return committed;
    fail();
  }
  private async registryId(): Promise<string | null> {
    const value = await this.read(this.store, REGISTRY); if (value === null) return null;
    const raw = object(value, ['version', 'registryId']); if (raw.version !== 1) fail(); return uuid(raw.registryId);
  }
  private async assertNoLegacyRoot(): Promise<void> {
    for (const name of ['device-key.json', 'enrollment.json', 'controller-binding.json', 'controller-pause.json']) {
      try { await lstat(join(this.directory, name)); }
      catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') continue; throw error; }
      fail('legacy-root');
    }
  }
  private generationStore(name: string): PrivateStore { this.store.assertOwnership(); return this.store.fork(join(this.directory, generation(name))); }
  private async existingStore(name: string): Promise<PrivateStore> {
    const store = this.generationStore(name); const stat = await lstat(store.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) fail();
    return store;
  }
  private async prepared(store: PrivateStore): Promise<RemoteControllerBinding> {
    const binding = controller(await this.read(store, 'controller-binding.json'));
    const rawEnrollment = await this.read(store, 'enrollment.json');
    object(rawEnrollment, ['version', 'clientId', 'accountId', 'accountUserId', 'managedAccountUserId', 'identityHash', 'identity']);
    const own = parseEnrollment(rawEnrollment);
    const ownBinding = enrollment({ clientId: own.clientId, accountId: own.accountId, accountUserId: own.accountUserId, managedAccountUserId: own.managedAccountUserId, identityHash: own.identityHash });
    if (!same(ownBinding, binding.enrollment)) fail();
    const key = object(await this.read(store, 'device-key.json'), ['keyId', 'sealedKeyBase64']);
    if (key.keyId !== own.identity.keyId || typeof key.sealedKeyBase64 !== 'string' || !key.sealedKeyBase64.length || key.sealedKeyBase64.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(key.sealedKeyBase64) || Buffer.from(key.sealedKeyBase64, 'base64').toString('base64') !== key.sealedKeyBase64) fail();
    return binding;
  }
  private async readPointer(): Promise<Pointer | null> {
    const value = await this.read(this.store, ACTIVE); const registryId = await this.registryId();
    if (value === null) { await this.assertNoLegacyRoot(); return null; }
    const raw = object(value, ['version', 'registryId', 'revision', 'generation', 'managed', 'enrollment', 'local']);
    if (!registryId || uuid(raw.registryId) !== registryId) fail();
    const { registryId: _registryId, ...fields } = raw; const current = snapshot(fields);
    const store = await this.existingStore(current.generation);
    const candidate = candidateRecord(await this.read(store, 'candidate.json'));
    if (candidate.registryId !== registryId || candidate.generation !== current.generation || (candidate.expectedActive?.revision ?? 0) + 1 !== current.revision) fail();
    const complete = object(await this.read(store, 'identity.json'), ['version', 'registryId', 'generation', 'managed', 'enrollment', 'local']);
    if (complete.version !== 1 || complete.registryId !== registryId || complete.generation !== current.generation || !same(bindingFields(complete), stable(current))) fail();
    validateTransition(candidate, current);
    if (!same(stable(await this.prepared(store)), stable(current))) fail();
    return { registryId, snapshot: current };
  }
  async readActive(): Promise<{ snapshot: RemoteActiveIdentity; store: PrivateStore } | null> {
    return this.guarded(async () => {
      const current = await this.readPointer();
      return current ? { snapshot: frozenSnapshot(current.snapshot), store: this.generationStore(current.snapshot.generation) } : null;
    });
  }
  async beginCandidate(options?: RemoteIdentityCandidateOptions): Promise<RemoteIdentityCandidate> {
    // 在第一个 await 前冻结显式意图，调用方之后突变不得改变写入内容。
    let requested: Intent;
    try {
      if (options === undefined) requested = { kind: 'authorize' };
      else { const raw = object(options, ['reassociateLocal']); const pair = object(raw.reassociateLocal, ['previous', 'next']); requested = intent({ kind: 'reassociate-local', previous: pair.previous, next: pair.next }); }
    } catch { throw new RemoteIdentityRegistryError('candidate-invalid'); }
    return this.guarded(() => this.store.withInitialization('identity-registry', async () => {
      const current = await this.readPointer();
      if (requested.kind === 'reassociate-local' && (!current || !sameTarget(current.snapshot.local, requested.previous))) fail('candidate-invalid');
      let registryId = await this.registryId();
      if (!registryId) { registryId = randomUUID(); if (!await this.store.createJson(REGISTRY, { version: 1, registryId })) fail(); }
      const name = `identity-${randomUUID()}`; const store = this.generationStore(name);
      // mkdir 无 recursive/复用分支；碰撞或残留目录绝不会被覆盖。
      this.store.assertOwnership(); await mkdir(store.directory, { mode: 0o700 }); this.store.assertOwnership();
      const record: CandidateRecord = { version: 1, registryId, generation: name, nonce: randomUUID(), expectedActive: current?.snapshot ?? null, intent: requested };
      if (!await store.createJson('candidate.json', record)) fail('candidate-invalid');
      const candidate: RemoteIdentityCandidate = Object.freeze({ generation: name, store, expectedActive: record.expectedActive ? frozenSnapshot(record.expectedActive) : null });
      this.candidates.set(candidate, candidateRecord(record)); return candidate;
    }));
  }
  /** verifiedBinding 只接受 runtime 已完成真实登记、硬件和 canonical/REST 双 ID 证明的结果。 */
  async activate(candidate: RemoteIdentityCandidate, verifiedBinding: RemoteControllerBinding): Promise<RemoteActiveIdentity> {
    const expected = this.candidates.get(candidate); if (!expected) throw new RemoteIdentityRegistryError('candidate-invalid');
    let proof: RemoteControllerBinding;
    try { proof = controller(verifiedBinding); } catch { throw new RemoteIdentityRegistryError('candidate-unprepared'); }
    return this.guarded(() => this.store.withInitialization('identity-registry', async () => {
      const current = await this.readPointer();
      if (!same(current?.snapshot ?? null, expected.expectedActive)) fail('active-changed');
      if (await this.registryId() !== expected.registryId) fail('candidate-invalid');
      let store: PrivateStore;
      try {
        store = await this.existingStore(expected.generation);
        if (!same(candidateRecord(await this.read(store, 'candidate.json')), expected)) fail();
      } catch { fail('candidate-invalid'); }
      let binding: RemoteControllerBinding;
      try { binding = await this.prepared(store); if (!same(binding, proof)) fail(); }
      catch { fail('candidate-unprepared'); }
      validateTransition(expected, binding);
      const revision = (expected.expectedActive?.revision ?? 0) + 1; if (!Number.isSafeInteger(revision)) fail();
      const next: RemoteActiveIdentity = { version: 1, revision, generation: expected.generation, ...stable(binding) };
      const complete = { version: 1, registryId: expected.registryId, generation: expected.generation, ...stable(binding) };
      if (!await store.createJson('identity.json', complete) && !same(await this.read(store, 'identity.json'), complete)) fail('candidate-invalid');
      // 唯一提交点；即便 rename 后 fsync 报错，也不删除或假称回滚任何身份。
      await this.store.writeJson(ACTIVE, { ...next, registryId: expected.registryId });
      return frozenSnapshot(next);
    }));
  }
}
