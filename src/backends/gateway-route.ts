import type { BackendConfig, GatewayTarget } from './types';
import { t } from '../i18n';

export type GatewayRoute = Pick<BackendConfig, 'baseUrl' | 'token' | 'gatewayMode' | 'remoteTarget'>;
/** 用户输入仍是 origin + token；模式/完整目标仅由已验证配置加入实际请求。 */
export function gatewayUrl(backend: GatewayRoute, path: string): URL {
  const url = new URL(path, `${backend.baseUrl}/`);
  if (backend.token) url.searchParams.set('token', backend.token);
  if (backend.gatewayMode === 'remote') {
    url.searchParams.set('mode', 'remote');
    if (backend.remoteTarget) url.searchParams.set('target', JSON.stringify(backend.remoteTarget));
    else if (path !== '/api/host') throw new Error(t('尚未选择远程机器，请检查网关连接'));
  }
  return url;
}
export function transportNamespace(backend: Pick<BackendConfig, 'id' | 'gatewayMode' | 'remoteTarget'>): string {
  return backend.gatewayMode === 'remote' ? `${backend.id}:remote:${JSON.stringify(backend.remoteTarget ?? null)}` : backend.id;
}
export function targetBackendId(gateway: BackendConfig, target: GatewayTarget): string {
  if (target.isGatewayHost) return gateway.id;
  const ref = target.reference;
  return `${gateway.id}:remote:${encodeURIComponent(JSON.stringify([ref.gatewayId, ref.account.accountId, ref.account.accountUserId, Object.hasOwn(ref.account, 'userId') ? ['present', ref.account.userId] : ['absent'], ref.target.environmentId, ref.target.installationId]))}`;
}
export function gatewayBackends(backends: BackendConfig[]): BackendConfig[] {
  return backends.flatMap(gateway => gateway.gatewayMode !== 'remote' || !gateway.remoteTargets?.length ? [gateway] : gateway.remoteTargets.map(target => ({
    ...gateway, id: targetBackendId(gateway, target), gatewayId: target.isGatewayHost ? undefined : gateway.id, remoteTarget: target.reference,
    name: target.isGatewayHost ? gateway.name : `${gateway.name} · ${target.name}`,
  })));
}

export function readGatewayTargets(value: unknown): GatewayTarget[] {
  if (!Array.isArray(value)) throw new Error(t('远程机器目录无效'));
  const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value);
  const targets: GatewayTarget[] = []; const seen = new Set<string>();
  for (const item of value) {
    const ref = item?.reference; const account = ref?.account; const target = ref?.target;
    if (ref?.mode !== 'remote' || !text(ref.gatewayId) || !account || !text(account.accountId) || !text(account.accountUserId) ||
      Object.hasOwn(account, 'userId') && !text(account.userId) || !target || !text(target.environmentId) || !text(target.installationId) ||
      !text(item.name) || !['online', 'busy', 'isGatewayHost'].every(key => typeof item[key] === 'boolean')) throw new Error(t('远程机器目录无效'));
    const reference: GatewayTarget['reference'] = { mode: 'remote', gatewayId: ref.gatewayId, account: { accountId: account.accountId, accountUserId: account.accountUserId,
      ...(Object.hasOwn(account, 'userId') ? { userId: account.userId } : {}) }, target: { environmentId: target.environmentId, installationId: target.installationId } };
    const key = JSON.stringify(reference); if (seen.has(key)) throw new Error(t('远程机器目录重复')); seen.add(key);
    targets.push({ reference, name: item.name, online: item.online, busy: item.busy, isGatewayHost: item.isGatewayHost });
  }
  return targets;
}
/** 消失的原目标保留离线占位；新身份不能接管原机器的选中项或草稿。 */
export function refreshGatewayTargets(old: GatewayTarget[], fresh: GatewayTarget[]): GatewayTarget[] {
  const same = (a: GatewayTarget, b: GatewayTarget) => JSON.stringify(a.reference) === JSON.stringify(b.reference);
  const anchor = old.find(target => target.isGatewayHost);
  const merged = old.map(target => fresh.find(item => same(target, item)) ?? { ...target, online: false, busy: false });
  for (const target of fresh) if (!old.some(item => same(item, target))) merged.push({ ...target, isGatewayHost: target.isGatewayHost && !anchor });
  return merged;
}
