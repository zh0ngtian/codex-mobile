import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';
import { HttpOperationPendingError } from '../../src/backends/http-transport';

const bridge = vi.hoisted(() => ({ options: null as any, client: null as any, responses: [] as Array<{ resolve: () => void; reject: (error: Error) => void; id: unknown; result: unknown }> }));
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
  constructor(private options: any) { bridge.options = options; }
  client() { return bridge.client; } socket() { return null; } close() {} reconnect() {}
  sync(backends: any[]) {
    if (!backends.length) return;
    const client = { onNotification() { return () => {}; }, onThreadMetadata() { return () => {}; }, request: async (method: string) => {
      if (method === 'threadSection/list') return { data: [{ id: '01984de2-8f74-7c91-a3b2-5c5e937cf318', name: 'Pinned' }], nextCursor: null };
      if (method === 'model/list') return { data: [{ model: 'model', isDefault: true, supportedReasoningEfforts: [] }] };
      if (method === 'config/read') return { config: { model: 'model', sandbox_mode: 'workspace-write' } };
      return { data: [], items: [], marketplaces: [], nextCursor: null };
    }, respond: (id: unknown, result: unknown) => new Promise<void>((resolve, reject) => bridge.responses.push({ resolve, reject, id, result })) };
    bridge.client = client;
    queueMicrotask(() => { this.options.onConnection(backends[0].id, 'online'); this.options.onReady(backends[0].id, client); });
  }
} }));

const posts: any[] = [];
afterEach(() => { cleanup(); bridge.responses = []; bridge.options = null; bridge.client = null; posts.length = 0; vi.unstubAllGlobals(); localStorage.clear(); delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).webkit; delete (window as any).codexMobilePublishNativeSnapshot; });
const send = (id: string, name: string, params: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } }));
const question = { id: 9, method: 'item/tool/requestUserInput', params: { threadId: 'thread', questions: [{ id: 'q', header: '问题', question: '保留回答？', options: null, isOther: true, isSecret: false }] } };
async function setup(request = question) {
  Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (value: unknown) => posts.push(value) });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], projects: [], projectlessThreadIds: [] }))));
  render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: 'b', backends: [{ id: 'b', hostId: 'h', name: '设备', enabled: true, order: 0, baseUrl: 'https://gateway.invalid', token: 'PRIVATE' }] }} />);
  await waitFor(() => expect(posts.at(-1)?.models?.[0]?.value).toBe('model'));
  await act(async () => { bridge.options.onRequest('b', request, bridge.client); });
  await waitFor(() => expect(posts.at(-1)?.approvalPanel?.id).toBe('approval:number:9'));
  const contextId = posts.at(-1).contextId;
  if (request.method === question.method) {
    await act(async () => { send('answer', 'approval.answer', { contextId, requestKey: 'number:9', questionId: 'q', value: '不能丢失的答案' }); });
    await waitFor(() => expect(posts.at(-1)?.approvalPanel?.items[0]?.id).toBeTruthy());
  }
  return { contextId, requestKey: 'number:9' };
}

it('真实App等待回答网络结果，失败ACK保留答案并允许稍后恢复与重试', async () => {
  const params = await setup();
  await act(async () => { send('submit', 'approval.submit', params); });
  await waitFor(() => expect(bridge.responses).toHaveLength(1));
  await waitFor(() => expect(posts.at(-1)?.approvalPanel?.items.some((item: any) => item.id === 'approval-pending')).toBe(true));
  expect(posts.at(-1).commandResults.some((result: any) => result.id === 'submit')).toBe(false);
  await act(async () => { bridge.responses[0].reject(new Error('真实响应失败')); });
  await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'submit')).toMatchObject({ ok: false, error: '真实响应失败' }));
  expect(JSON.stringify(posts.at(-1).approvalPanel)).toContain('不能丢失的答案');
  await act(async () => { send('dismiss', 'approval.dismiss', params); });
  await waitFor(() => expect(posts.at(-1)?.approvalPanel).toBeUndefined());
  await act(async () => { send('reopen', 'approval.reopen', { contextId: params.contextId }); });
  await waitFor(() => expect(JSON.stringify(posts.at(-1)?.approvalPanel)).toContain('不能丢失的答案'));
  await act(async () => { send('retry', 'approval.submit', params); });
  await waitFor(() => expect(bridge.responses).toHaveLength(2));
  await act(async () => { bridge.responses[1].resolve(); });
  await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'retry')?.ok).toBe(true));
  expect(posts.at(-1).approvalCount).toBe(0);
});

it('HTTP待确认不是成功ACK，失败确认后同一回答仍可恢复重试', async () => {
  const params = await setup();
  await act(async () => { send('pending-submit', 'approval.submit', params); });
  await waitFor(() => expect(bridge.responses).toHaveLength(1));
  await act(async () => { bridge.responses[0].reject(new HttpOperationPendingError('answer-operation', { id: 9, result: bridge.responses[0].result })); });
  await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'pending-submit')?.ok).toBe(false));
  expect(JSON.stringify(posts.at(-1).approvalPanel)).toContain('不能丢失的答案');
  expect(posts.at(-1).approvalPanel.items.some((item: any) => item.id === 'approval-pending')).toBe(true);
  await act(async () => { bridge.options.onNotification('b', { method: 'mobile/operation/confirmed', params: { requestId: 'answer-operation', response: { error: { code: -1, message: '待确认操作失败' } } } }, bridge.client); });
  await waitFor(() => expect(posts.at(-1)?.approvalPanel?.items.find((item: any) => item.id === 'approval-submit')?.disabled).toBe(false));
  expect(JSON.stringify(posts.at(-1).approvalPanel)).toContain('不能丢失的答案');
  await act(async () => { send('retry-pending', 'approval.submit', params); });
  await waitFor(() => expect(bridge.responses).toHaveLength(2));
  await act(async () => { bridge.responses[1].resolve(); });
  await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'retry-pending')?.ok).toBe(true));
});

it('操作审批decision同样等待真实响应，拒绝不生成成功回执', async () => {
  const params = await setup({ id: 9, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', command: 'ls', availableDecisions: ['accept', 'decline'] } } as any);
  await act(async () => { send('decide', 'approval.decide', { ...params, index: 0 }); });
  await waitFor(() => expect(bridge.responses).toHaveLength(1));
  await waitFor(() => expect(posts.at(-1)?.approvalPanel?.items.some((item: any) => item.id === 'approval-pending')).toBe(true));
  expect(posts.at(-1).commandResults.some((result: any) => result.id === 'decide')).toBe(false);
  await act(async () => { bridge.responses[0].reject(new Error('审批响应失败')); });
  await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'decide')).toMatchObject({ ok: false, error: '审批响应失败' }));
  expect(posts.at(-1).approvalCount).toBe(1);
});
