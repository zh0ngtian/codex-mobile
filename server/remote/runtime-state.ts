import { isAbsolute, normalize } from 'node:path';
import type { ManagedAuthIdentity } from './managed-auth.js';
import type { RemoteTargetIdentity } from './catalog.js';
import { PrivateStore } from './private-store.js';
export type RemoteRuntimePauseReason =
  | 'manual'
  | 'reauthorization'
  | 'reassociation'
  | 'login'
  | 'auth-required'
  | 'identity-changed'
  | 'binding-invalid'
  | 'network';
export interface RemoteRuntimeStateRecord {
  version: 1;
  generation: string;
  managed: ManagedAuthIdentity;
  paused: boolean;
  reason: RemoteRuntimePauseReason;
  pending: RemoteTargetIdentity[];
}
export const MAX_REMOTE_PENDING = 4096;
const REASONS: readonly string[] = [
  'manual',
  'reauthorization',
  'reassociation',
  'login',
  'auth-required',
  'identity-changed',
  'binding-invalid',
  'network',
];
function fail(): never {
  throw new Error('Remote 运行暂停记录不可用');
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) fail();
  return value;
}
export function remoteTuple(value: unknown): RemoteTargetIdentity {
  const raw = object(value, ['environmentId', 'installationId']);
  return {
    environmentId: text(raw.environmentId),
    installationId: text(raw.installationId),
  };
}
export function remoteManaged(value: unknown): ManagedAuthIdentity {
  const raw = object(value, ['codexHome', 'accountId', 'accountUserId', 'userId']);
  const home = text(raw.codexHome);
  if (!isAbsolute(home) || normalize(home) !== home) fail();
  return {
    codexHome: home,
    accountId: text(raw.accountId),
    accountUserId: text(raw.accountUserId),
    ...(raw.userId === undefined ? {} : { userId: text(raw.userId) }),
  };
}
export function sameRemoteTarget(a: RemoteTargetIdentity, b: RemoteTargetIdentity): boolean {
  return a.environmentId === b.environmentId && a.installationId === b.installationId;
}
export function sameRemoteManaged(a: ManagedAuthIdentity, b: ManagedAuthIdentity): boolean {
  return (
    a.codexHome === b.codexHome &&
    a.accountId === b.accountId &&
    a.accountUserId === b.accountUserId &&
    a.userId === b.userId
  );
}
export function mergeRemotePending(...lists: readonly RemoteTargetIdentity[][]): RemoteTargetIdentity[] {
  const result: RemoteTargetIdentity[] = [];
  for (const values of lists)
    for (const raw of values) {
      const value = remoteTuple(raw);
      if (result.some((item) => sameRemoteTarget(item, value))) continue;
      if (result.length >= MAX_REMOTE_PENDING) fail();
      result.push(value);
    }
  return result;
}
/** 每个 generation 的暂停名单；旧 installation 始终保留为独立 tuple，不做迁移或淘汰。 */
export class RemoteRuntimeStateStore {
  private readonly managed: ManagedAuthIdentity;
  private readonly store: PrivateStore;
  constructor(
    store: PrivateStore,
    private readonly generation: string,
    managed: ManagedAuthIdentity,
  ) {
    this.store = new PrivateStore(store.directory);
    this.managed = remoteManaged(managed);
    text(generation);
  }
  private parse(value: unknown): RemoteRuntimeStateRecord {
    const raw = object(value, ['version', 'generation', 'managed', 'paused', 'reason', 'pending']);
    if (
      raw.version !== 1 ||
      raw.generation !== this.generation ||
      typeof raw.paused !== 'boolean' ||
      !REASONS.includes(String(raw.reason)) ||
      !Array.isArray(raw.pending) ||
      raw.pending.length > MAX_REMOTE_PENDING
    )
      fail();
    const managed = remoteManaged(raw.managed);
    if (!sameRemoteManaged(managed, this.managed)) fail();
    const pending = raw.pending.map(remoteTuple);
    if (mergeRemotePending(pending).length !== pending.length) fail();
    return {
      version: 1,
      generation: this.generation,
      managed,
      paused: raw.paused,
      reason: raw.reason as RemoteRuntimePauseReason,
      pending,
    };
  }
  async read(): Promise<RemoteRuntimeStateRecord | null> {
    try {
      const raw = await this.store.readJson('runtime-state.json');
      return raw === null ? null : this.parse(raw);
    } catch {
      return fail();
    }
  }
  async write(value: RemoteRuntimeStateRecord): Promise<void> {
    try {
      const record = this.parse(value);
      await this.store.writeJson('runtime-state.json', record);
    } catch {
      fail();
    }
  }
}
