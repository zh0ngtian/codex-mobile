import { RemoteRuntimeError, type RemoteRuntimeFailure } from './runtime-lifecycle.js';
import type { RemoteTargetIdentity } from './catalog.js';
export const ADMIN_VERSION = 1;
export const ADMIN_REQUEST_BYTES = 64 * 1024;
export const ADMIN_RESPONSE_BYTES = 8 * 1024 * 1024;
export const ADMIN_METHODS = ['status', 'queryStatus', 'login', 'authorize', 'recover', 'reauthorize', 'targets', 'pair-local', 'pair', 'accept', 'resume', 'reassociate', 'url'] as const;
export type AdminMethod = typeof ADMIN_METHODS[number];
export type AdminParams = {
  target?: RemoteTargetIdentity;
  previous?: RemoteTargetIdentity;
  next?: RemoteTargetIdentity;
  code?: string;
};
export interface AdminMetadata {
  version: 1;
  pid: number;
  instance: string;
  nonce: string;
}
export interface AdminRequest {
  version: 1;
  instance: string;
  nonce: string;
  method: AdminMethod;
  params: AdminParams;
}
const ERRORS = {
  unavailable: 'Remote 管理通道不可用', protocol: 'Remote 管理请求无效', timeout: 'Remote 管理操作已超时', cancelled: 'Remote 管理操作已取消', busy: 'Remote 管理操作正在进行', limit: 'Remote 管理通道超过资源上限',
} as const;
export type AdminErrorCode = keyof typeof ERRORS | RemoteRuntimeFailure;
export const ADMIN_ERROR_CODES: readonly AdminErrorCode[] = ['configuration', 'closed', 'busy', 'not-configured', 'already-configured', 'unavailable', 'identity-changed', 'target-unaccepted', 'target-unavailable', 'pending-resume', 'storage', 'timeout', 'cancelled', 'commit-pending', 'protocol', 'limit'];
export class RemoteAdminError extends Error {
  constructor(readonly code: AdminErrorCode) {
    super(Object.hasOwn(ERRORS, code) ? ERRORS[code as keyof typeof ERRORS] : new RemoteRuntimeError(code as RemoteRuntimeFailure).message);
    this.name = 'RemoteAdminError';
  }
}
export function adminFailure(error: unknown): RemoteAdminError {
  if ((error instanceof RemoteAdminError || error instanceof RemoteRuntimeError) && ADMIN_ERROR_CODES.includes(error.code)) {
    return new RemoteAdminError(error.code);
  }
  return new RemoteAdminError('unavailable');
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
export function metadata(value: unknown): AdminMetadata {
  if (!object(value) || !exact(value, ['version', 'pid', 'instance', 'nonce']) || value.version !== 1 || !Number.isSafeInteger(value.pid) || (value.pid as number) < 1 || !uuid(value.instance) || !uuid(value.nonce)) {
    throw new RemoteAdminError('protocol');
  }
  return { version: 1, pid: value.pid as number, instance: value.instance, nonce: value.nonce };
}
function tuple(value: unknown): RemoteTargetIdentity {
  if (!object(value) || !exact(value, ['environmentId', 'installationId']) || ![value.environmentId, value.installationId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\x00-\x20\x7f]/.test(v))) {
    throw new RemoteAdminError('protocol');
  }
  return { environmentId: value.environmentId as string, installationId: value.installationId as string };
}
export function parameters(method: unknown, value: unknown): {
  method: AdminMethod;
  params: AdminParams;
} {
  if (!ADMIN_METHODS.includes(method as AdminMethod) || !object(value)) {
    throw new RemoteAdminError('protocol');
  }
  const name = method as AdminMethod;
  let keys: string[] = [];
  if (['accept', 'resume'].includes(name)) {
    keys = ['target'];
  }
  if (name === 'pair') {
    keys = ['target', 'code'];
  }
  if (name === 'reassociate') {
    keys = ['previous', 'next', ...(Object.hasOwn(value, 'code') ? ['code'] : [])];
  }
  if (!exact(value, keys)) {
    throw new RemoteAdminError('protocol');
  }
  const params: AdminParams = {};
  for (const key of ['target', 'previous', 'next'] as const) {
    if (Object.hasOwn(value, key)) {
      params[key] = tuple(value[key]);
    }
  }
  if (Object.hasOwn(value, 'code')) {
    if (typeof value.code !== 'string' || value.code.length < 1 || value.code.length > 1024 || /[\x00-\x20\x7f]/.test(value.code)) {
      throw new RemoteAdminError('protocol');
    }
    params.code = value.code;
  }
  return { method: name, params };
}
export function request(value: unknown, expected: AdminMetadata): {
  method: AdminMethod;
  params: AdminParams;
} {
  if (!object(value) || !exact(value, ['version', 'instance', 'nonce', 'method', 'params']) || value.version !== 1 || value.instance !== expected.instance || value.nonce !== expected.nonce) {
    throw new RemoteAdminError('protocol');
  }
  return parameters(value.method, value.params);
}
export function operationLimit(method: AdminMethod): number {
  return ['login', 'authorize', 'recover', 'reauthorize', 'reassociate', 'pair', 'pair-local'].includes(method) ? 610000 : 25000;
}
