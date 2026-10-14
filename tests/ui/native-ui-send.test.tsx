import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';
const boundary = vi.hoisted(() => ({ requests: [] as Array<{ method: string; params: any }>, options: null as any, client: null as any, release: null as null | (() => void), failSend: false }));
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
 constructor(private options: any) { boundary.options = options; }
 client() { return boundary.client; } socket() { return null; } close() {} reconnect() {}
 sync(backends: any[]) {
  if (!backends.length) return;
  const client = { onNotification() { return () => {}; }, onThreadMetadata() { return () => {}; }, request: async (method: string, params: any) => {
   boundary.requests.push({ method, params });
   if (method === 'model/list') return { data: [{ model: 'gpt', displayName: 'GPT', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] }] };
   if (method === 'permissionProfile/list') return { data: [{ id: ':workspace', allowed: true }] };
   if (method === 'config/read') return { config: { model: 'gpt', sandbox_mode: 'workspace-write', model_reasoning_effort: 'high' } };
   if (method === 'thread/start') return { thread: { id: 'sent-thread', cwd: null, turns: [] }, model: 'gpt' };
   if (method === 'turn/start') { if (boundary.failSend) throw new Error('真实发送失败'); return new Promise(resolve => { boundary.release = () => resolve({ turn: { id: 'turn-live', status: 'inProgress', items: [] } }); }); }
   if (method === 'thread/turns/list') return { data: [], nextCursor: null };
   return { data: [], items: [], marketplaces: [], nextCursor: null };
  } };
  boundary.client = client;
  queueMicrotask(() => { this.options.onConnection(backends[0].id, 'online'); this.options.onReady(backends[0].id, client); });
 }
} }));
const posts: any[] = []; let queueItems: any[] = [];
function command(id: string, name: string, params: Record<string, unknown> = {}) { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } })); }
afterEach(() => { cleanup(); boundary.requests = []; boundary.client = null; boundary.options = null; boundary.release = null; boundary.failSend = false; queueItems = []; posts.length = 0; localStorage.clear(); delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).webkit; delete (window as any).codexMobilePublishNativeSnapshot; vi.unstubAllGlobals(); });
async function setup() {
 Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (s: unknown) => posts.push(s) });
 vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
  if (String(url).includes('/api/follow-ups')) {
   if (options?.body) { const action = JSON.parse(String(options.body)); if (action.action === 'enqueue') queueItems.push({ ...action, revision: 1, state: 'queued' }); }
   return new Response(JSON.stringify({ items: queueItems }));
  }
  return new Response(JSON.stringify({ projects: [], projectlessThreadIds: [] }));
 }));
 render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: 'a', backends: [{ id: 'a', hostId: 'host', name: 'Mac', enabled: true, order: 0, baseUrl: 'https://gateway.invalid', token: 'SECRET' }] }} />);
 await waitFor(() => expect(posts.at(-1)?.models?.[0]?.value).toBe('gpt'));
 return posts.at(-1).contextId as string;
}
it('原生命令进入现有send与托管队列，慢发送不阻塞停止和继续输入，final立即进入快照', async () => {
 const contextId = await setup();
 await act(async () => { command('draft1', 'draft.set', { contextId, value: '原生第一条', revision: 1 }); command('send1', 'message.send', { contextId }); command('send1', 'message.send', { contextId }); });
 await waitFor(() => expect(boundary.release).toBeTypeOf('function'));
 expect(boundary.requests.filter(r => r.method === 'turn/start')).toHaveLength(1);
 expect(boundary.requests.find(r => r.method === 'turn/start')?.params.input[0].text).toContain('原生第一条');
 await act(async () => { command('stop', 'turn.stop', { contextId }); command('draft2', 'draft.set', { contextId, value: '忙时仍可排队', revision: 2 }); command('send2', 'message.send', { contextId }); });
 await waitFor(() => expect(queueItems[0]?.inputText).toBe('忙时仍可排队'));
 expect(boundary.requests.some(r => r.method === 'turn/interrupt')).toBe(true);
 expect(queueItems[0].id).toMatch(/^[0-9a-f-]{36}$/i);
 await act(async () => { boundary.release!(); });
 await act(async () => boundary.options.onNotification('a', { method: 'item/completed', params: { threadId: 'sent-thread', turnId: 'turn-live', item: { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '最终正文' } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.messages.some((m: any) => m.text === '最终正文')).toBe(true));
 expect(posts.at(-1).busy).toBe(true);
});
it('发送失败保留原输入可恢复且原生命令返回关联错误', async () => {
 const contextId = await setup(); boundary.failSend = true;
 await act(async () => { command('draft-fail', 'draft.set', { contextId, value: '失败保留', revision: 1 }); });
 await waitFor(() => expect(posts.at(-1)?.draft).toBe('失败保留'));
 await act(async () => { command('send-fail', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((r: any) => r.id === 'send-fail' && r.ok === false)).toBe(true));
 expect(posts.at(-1).draft === '失败保留' || posts.at(-1).queued.some((q: any) => q.title.includes('失败保留'))).toBe(true);
 expect(posts.at(-1).error).toBeTruthy();
});
