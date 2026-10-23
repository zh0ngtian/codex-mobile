import type { BackendConfig } from './types';
import { t } from '../i18n';

export class TitleSummaryUnavailableError extends Error {}

export async function summarizeThreadTitle(backend: BackendConfig, threadId: string, fetcher: typeof fetch = fetch): Promise<string> {
  const url = new URL('/api/threads/title-summary', `${backend.baseUrl}/`);
  if (backend.token) url.searchParams.set('token', backend.token);
  const response = await fetcher(url.toString(), { method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId }), signal: AbortSignal.timeout(125_000) });
  if ([404, 405, 501].includes(response.status)) throw new TitleSummaryUnavailableError(t('请升级网关服务器以使用会话名称总结功能'));
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message ?? t('会话标题总结失败，请重试'));
  if (typeof result?.title !== 'string' || !result.title.trim() || /[\r\n]/.test(result.title) || Array.from(result.title.trim()).length > 40) throw new Error(t('网关返回的会话标题无效'));
  return result.title.trim();
}
