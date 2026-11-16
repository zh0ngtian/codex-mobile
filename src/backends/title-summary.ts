import { gatewayUrl, transportNamespace } from './gateway-route';
import { gatewayOutbox, type OutboxEntry } from './outbox';
import { transportUuid } from './http-transport';
import type { BackendConfig } from './types';
import { t } from '../i18n';

export class TitleSummaryUnavailableError extends Error {}

export async function summarizeThreadTitle(backend: BackendConfig, threadId: string, options: { automatic?: boolean } = {}, fetcher: typeof fetch = fetch): Promise<string> {
  let operation: OutboxEntry | undefined;
  if (backend.gatewayMode === 'remote') {
    const sourceId = JSON.stringify([threadId, options.automatic === true]);
    operation = (await gatewayOutbox.list()).find(entry => entry.kind === 'title' && entry.sourceId === sourceId && transportNamespace(entry.route) === transportNamespace(backend));
    if (!operation) {
      operation = { id: transportUuid(), kind: 'title', route: { ...backend }, sourceId, state: 'retained', message: { threadId, automatic: options.automatic === true } };
      await gatewayOutbox.put(operation);
    }
  }
  const url = gatewayUrl(operation?.route ?? backend, '/api/threads/title-summary');
  const query = async () => {
    const endpoint = new URL(url); endpoint.searchParams.set('requestId', operation!.id); endpoint.searchParams.set('threadId', threadId); endpoint.searchParams.set('automatic', String(options.automatic === true));
    return fetcher(endpoint.toString(), { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  };
  let response: Response;
  if (operation?.state === 'submitted') response = await query();
  else {
    if (operation && globalThis.navigator?.onLine === false) throw new Error(t('待提交：标题总结请求已保存在本机，请在网络恢复后重试'));
    if (operation) { operation.state = 'submitted'; await gatewayOutbox.put(operation); }
    response = await fetcher(url.toString(), { method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'content-type': 'application/json', ...(operation ? { 'x-codex-operation-id': operation.id } : {}) }, body: JSON.stringify({ threadId, ...(options.automatic ? { automatic: true } : {}) }), signal: AbortSignal.timeout(125_000) });
  }
  if (operation && response.status === 202) {
    const until = Date.now() + 125000;
    do { await new Promise(resolve => setTimeout(resolve, 1000)); response = await query(); } while (response.status === 202 && Date.now() < until);
    if (response.status === 202) throw new Error(t('标题总结已排队，连接恢复后处理，请稍后查看'));
  }
  if ([404, 405, 501].includes(response.status)) throw new TitleSummaryUnavailableError(t('请升级网关服务器以使用会话名称总结功能'));
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.error) {
    if (operation && response.ok && result?.error) await gatewayOutbox.remove(operation.id);
    throw new Error(result?.error?.message ?? t('会话标题总结失败，请重试'));
  }
  if (typeof result?.title !== 'string' || !result.title.trim() || /[\r\n]/.test(result.title) || Array.from(result.title.trim()).length > 40) throw new Error(t('网关返回的会话标题无效'));
  if (operation) await gatewayOutbox.remove(operation.id);
  return result.title.trim();
}
