import { gatewayUrl, transportNamespace } from './gateway-route';
import { gatewayOutbox, type OutboxEntry } from './outbox';
import type { BackendConfig } from './types';
import { t } from '../i18n';
import { transportUuid } from './http-transport';

export type HostedFollowUp = {
  id: string;
  gatewayRpc?: boolean;
  threadId: string;
  inputText: string;
  text: string;
  attachmentCount: number;
  state: 'queued' | 'sending' | 'failed' | 'uncertain';
  revision: number;
  error?: string;
};
type FollowUpActionBody =
  | { action: 'enqueue'; id: string; threadId: string; inputText: string; text: string; attachmentCount: number; extraInput: Record<string, unknown>[]; settings: Record<string, unknown> }
  | { action: 'edit'; id: string; revision: number; inputText: string; text: string; mentions: Record<string, unknown>[] }
  | { action: 'cancel' | 'retry' | 'steer'; id: string; revision: number };
export type FollowUpAction = FollowUpActionBody & { gatewayRpc?: boolean };
export class HostedQueueError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export type GatewayCreation = { id: string; threadId: string; pendingId?: string; state: string; revision: number; cwd?: string };
export type FollowUpResult = { items: HostedFollowUp[]; turnId?: string; creations?: GatewayCreation[] };

/** 独立于对话传输方式，HTTP 和 WebSocket 客户端共用网关队列。 */
export async function followUpRequest(
  backend: BackendConfig,
  action?: FollowUpAction,
  fetcher: typeof fetch = fetch,
): Promise<FollowUpResult> {
  if (backend.gatewayMode === 'remote' && !action) {
    // 恢复仍在原目标上的手机待提交项；已尝试发送的项只查原收据。
    for (const entry of await gatewayOutbox.list()) if (entry.kind === 'follow-up' && transportNamespace(entry.route) === transportNamespace(backend)) {
      await handoffFollowUp(entry, fetcher).catch(() => {});
    }
  }
  if (backend.gatewayMode === 'remote' && action?.action === 'enqueue') {
    let entry = await gatewayOutbox.get(action.id);
    if (entry && (entry.kind !== 'follow-up' || transportNamespace(entry.route) !== transportNamespace(backend) || JSON.stringify(entry.message) !== JSON.stringify(action))) throw new Error(t('待发送操作与原请求不一致'));
    if (!entry) { entry = { id: action.id, kind: 'follow-up', route: structuredClone(backend), state: 'retained', message: action }; await gatewayOutbox.put(entry); }
    await handoffFollowUp(entry, fetcher);
    return followUpRequest(backend, undefined, fetcher);
  }
  const ordinary = action?.gatewayRpc === true;
  const url = gatewayUrl(backend, ordinary ? '/api/queue' : '/api/follow-ups');
  if (backend.token) url.searchParams.set('token', backend.token);
  const response = await fetcher(url.toString(), {
    method: action ? 'POST' : 'GET',
    credentials: 'include',
    cache: 'no-store',
    signal: AbortSignal.timeout(action?.action === 'steer' ? 70_000 : 15_000),
    ...(action ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HostedQueueError(response.status === 404
      ? t('设备网关需要升级以支持托管排队消息')
      : result?.error?.message ?? (response.status === 401 ? t('访问口令不正确') : t('设备网关返回 {status}', { status: response.status })), response.status);
  }
  if (ordinary && response.ok) return followUpRequest(backend, undefined, fetcher);
  if (!Array.isArray(result?.items) || result.items.some((item: any) =>
    typeof item?.id !== 'string' || typeof item.threadId !== 'string' ||
    typeof item.inputText !== 'string' || typeof item.text !== 'string' ||
    !Number.isSafeInteger(item.attachmentCount) || !Number.isSafeInteger(item.revision) ||
    !['queued', 'sending', 'failed', 'uncertain'].includes(item.state))) {
    throw new Error(t('网关排队响应无效'));
  }
  if (backend.gatewayMode === 'remote' || backend.gatewayQueue) {
    const queueUrl = gatewayUrl(backend, '/api/queue');
    const queue = await fetcher(queueUrl.toString(), { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!queue.ok) throw new HostedQueueError(t('共享队列暂时不可用'), queue.status);
    const shared = await queue.json();
    if (!Array.isArray(shared?.items)) throw new Error(t('网关排队响应无效'));
    result.creations = [];
    for (const row of shared.items) {
      if (row.method === 'thread/start' && typeof row.id === 'string' && typeof row.threadId === 'string' && Number.isSafeInteger(row.revision)) {
        result.creations.push({ id: row.id, threadId: row.threadId, pendingId: row.pendingId, state: row.state, revision: row.revision,
          ...(typeof row.params?.cwd === 'string' ? { cwd: row.params.cwd } : {}) });
      }
      if (row.method !== 'turn/start' || !Array.isArray(row.params?.input) || !['queued', 'claimed', 'uncertain', 'failed'].includes(row.state)) continue;
      const inputText = row.params.input.filter((part: any) => part.type === 'text').map((part: any) => String(part.text ?? '')).join('\n');
      result.items.push({ id: row.id, gatewayRpc: true, threadId: row.threadId, inputText, text: inputText || t('附件消息'),
        attachmentCount: row.params.input.filter((part: any) => ['file', 'image', 'localImage'].includes(part.type)).length,
        revision: row.revision, state: row.state === 'claimed' ? 'sending' : row.state });
    }
  }
  return result;
}

const handingOff = new Map<string, Promise<void>>();
function handoffFollowUp(entry: OutboxEntry, fetcher: typeof fetch): Promise<void> {
  const old = handingOff.get(entry.id); if (old) return old;
  const work = submitFollowUp(structuredClone(entry), fetcher); handingOff.set(entry.id, work);
  void work.finally(() => { if (handingOff.get(entry.id) === work) handingOff.delete(entry.id); }).catch(() => {});
  return work;
}
async function submitFollowUp(entry: OutboxEntry, fetcher: typeof fetch): Promise<void> {
  const url = gatewayUrl(entry.route, '/api/follow-ups');
  if (entry.state === 'retained') {
    if (globalThis.navigator?.onLine === false) throw new Error(t('待提交：操作已保存在本机，网络恢复后提交原网关'));
    entry.state = 'submitted'; await gatewayOutbox.put(entry);
    const response = await fetcher(url.toString(), { method: 'POST', credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry.message) });
    if (!response.ok) throw new HostedQueueError(t('请求结果待确认，请刷新会话后检查，勿重复发送'), response.status);
  } else {
    url.searchParams.set('requestId', entry.id);
    const response = await fetcher(url.toString(), { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const receipt = await response.json().catch(() => null);
    if (!response.ok || receipt?.accepted !== true || receipt.operation?.id !== entry.id) throw new HostedQueueError(t('请求结果待确认，请刷新会话后检查，勿重复发送'), response.status);
  }
  await gatewayOutbox.remove(entry.id);
}

type EnqueueFollowUp = Extract<FollowUpAction, { action: 'enqueue' }>;

/** 请求 ACK 丢失时复用已准备的完整输入，附件不再次上传。 */
export class HostedQueueSubmission {
  private pending?: { id: string; signature: string; action: Promise<EnqueueFollowUp> };

  prepare(signature: string, build: () => Promise<Omit<EnqueueFollowUp, 'action' | 'id'>>) {
    if (this.pending?.signature === signature) return this.pending.action;
    const id = transportUuid();
    const action = build().then((payload): EnqueueFollowUp => ({ action: 'enqueue', id, ...payload }));
    const pending = { id, signature, action };
    this.pending = pending;
    void action.catch(() => { if (this.pending === pending) this.pending = undefined; });
    return action;
  }

  get hasPending() { return Boolean(this.pending); }

  confirmed(id: string) {
    if (this.pending?.id !== id) return false;
    this.pending = undefined;
    return true;
  }
}
