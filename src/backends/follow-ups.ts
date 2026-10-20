import type { BackendConfig } from './types';
import { t } from '../i18n';
import { transportUuid } from './http-transport';

export type HostedFollowUp = {
  id: string;
  threadId: string;
  inputText: string;
  text: string;
  attachmentCount: number;
  state: 'queued' | 'sending' | 'failed' | 'uncertain';
  revision: number;
  error?: string;
};
export type FollowUpAction =
  | { action: 'enqueue'; id: string; threadId: string; inputText: string; text: string; attachmentCount: number; extraInput: Record<string, unknown>[]; settings: Record<string, unknown> }
  | { action: 'edit'; id: string; revision: number; inputText: string; text: string; mentions: Record<string, unknown>[] }
  | { action: 'cancel' | 'retry' | 'steer'; id: string; revision: number };
export class HostedQueueError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export type FollowUpResult = { items: HostedFollowUp[]; turnId?: string };

/** 独立于对话传输方式，HTTP 和 WebSocket 客户端共用网关队列。 */
export async function followUpRequest(
  backend: BackendConfig,
  action?: FollowUpAction,
  fetcher: typeof fetch = fetch,
): Promise<FollowUpResult> {
  const url = new URL('/api/follow-ups', `${backend.baseUrl}/`);
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
  if (!Array.isArray(result?.items) || result.items.some((item: any) =>
    typeof item?.id !== 'string' || typeof item.threadId !== 'string' ||
    typeof item.inputText !== 'string' || typeof item.text !== 'string' ||
    !Number.isSafeInteger(item.attachmentCount) || !Number.isSafeInteger(item.revision) ||
    !['queued', 'sending', 'failed', 'uncertain'].includes(item.state))) {
    throw new Error(t('网关排队响应无效'));
  }
  return result;
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
