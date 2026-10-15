import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';
const boundary = vi.hoisted(() => ({ requests: [] as Array<{ method: string; params: any }>, options: null as any, client: null as any, release: null as null | (() => void), failSend: false, immediateSend: false }));
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
   if (method === 'turn/start') { if (boundary.failSend) throw new Error('真实发送失败'); if (boundary.immediateSend) return { turn: { id: 'turn-live', status: 'inProgress', items: [] } }; return new Promise(resolve => { boundary.release = () => resolve({ turn: { id: 'turn-live', status: 'inProgress', items: [] } }); }); }
   if (method === 'thread/turns/list') return { data: [], nextCursor: null };
   return { data: [], items: [], marketplaces: [], nextCursor: null };
  } };
  boundary.client = client;
  queueMicrotask(() => { this.options.onConnection(backends[0].id, 'online'); this.options.onReady(backends[0].id, client); });
 }
} }));
const posts: any[] = []; let queueItems: any[] = [];
function command(id: string, name: string, params: Record<string, unknown> = {}) { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } })); }
afterEach(() => { cleanup(); boundary.requests = []; boundary.client = null; boundary.options = null; boundary.release = null; boundary.failSend = false; boundary.immediateSend = false; queueItems = []; posts.length = 0; localStorage.clear(); delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).webkit; delete (window as any).codexMobilePublishNativeSnapshot; vi.unstubAllGlobals(); });
async function setup(native = true, projectState = { projects: [] as string[], projectlessThreadIds: [] as string[] }) {
 if (native) Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (s: unknown) => posts.push(s) });
 vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
  if (String(url).includes('/api/follow-ups')) {
   if (options?.body) { const action = JSON.parse(String(options.body)); if (action.action === 'enqueue') queueItems.push({ ...action, revision: 1, state: 'queued' }); }
   return new Response(JSON.stringify({ items: queueItems }));
  }
  return new Response(JSON.stringify(projectState));
 }));
 render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: 'a', backends: [{ id: 'a', hostId: 'host', name: 'Mac', enabled: true, order: 0, baseUrl: 'https://gateway.invalid', token: 'SECRET' }] }} />);
 if (native) await waitFor(() => expect(posts.at(-1)?.models?.[0]?.value).toBe('gpt'));
 else await waitFor(() => expect(boundary.requests.some(request => request.method === 'model/list')).toBe(true));
 return posts.at(-1)?.contextId as string;
}
it('项目新对话沿真实App命令路由，点击不启动thread，无项目空串覆盖保存目录，无参保留旧默认目录', async () => {
 localStorage.setItem('codex-mobile:new-chat-project:a', '/saved');
 await setup(true, { projects: ['/saved', '/target'], projectlessThreadIds: ['unloaded'] });
 await waitFor(() => expect(posts.at(-1)?.groups.some((group: any) => group.newCommand?.params.cwd === '/target')).toBe(true));
 const initialContext = posts.at(-1).contextId;
 const target = posts.at(-1).groups.find((group: any) => group.newCommand?.params.cwd === '/target').newCommand;
 await act(async () => { command('project-new', target.name, target.params); });
 await waitFor(() => expect(posts.at(-1)?.projectName).toBe('target'));
 expect(posts.at(-1).contextId).not.toBe(initialContext);
 expect(boundary.requests.some(request => request.method === 'thread/start')).toBe(false);
 const targetContext = posts.at(-1).contextId;
 await act(async () => { command('new-invalid', 'thread.new', { backendId: 'a', cwd: '/removed' }); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'new-invalid' && !result.ok)).toBe(true));
 expect(posts.at(-1).contextId).toBe(targetContext);
 const projectless = posts.at(-1).groups.find((group: any) => group.newCommand?.params.cwd === '').newCommand;
 await act(async () => { command('new-projectless', projectless.name, projectless.params); });
 await waitFor(() => expect(posts.at(-1)?.projectName).toBe('无项目'));
 expect(posts.at(-1).contextId).not.toBe(targetContext);
 // 显式项目路由不覆盖旧保存选择；无参仍使用原有保存目录策略。
 await act(async () => { command('new-legacy-default', 'thread.new'); });
 await waitFor(() => expect(posts.at(-1)?.projectName).toBe('saved'));
 expect(boundary.requests.some(request => request.method === 'thread/start')).toBe(false);
});
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

it('同一React flush中的不同请求UUID只消费一次草稿，不重复创建会话或turn', async () => {
 const contextId = await setup();
 await act(async () => {
  command('draft-double', 'draft.set', { contextId, value: '同一份草稿', revision: 1 });
  command('11111111-1111-4111-8111-111111111111', 'message.send', { contextId });
  command('22222222-2222-4222-8222-222222222222', 'message.send', { contextId });
 });
 await waitFor(() => expect(boundary.release).toBeTypeOf('function'));
 expect(boundary.requests.filter(request => request.method === 'thread/start')).toHaveLength(1);
 expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(1);
 await act(async () => { boundary.release!(); });
});
it('新会话首次发送仍在等待时保留同一flush继续输入的新草稿，不再创建第二个会话', async () => {
 const contextId = await setup();
 await act(async () => {
  command('draft-initial', 'draft.set', { contextId, value: '首次发送', revision: 1 });
  command('send-initial', 'message.send', { contextId });
  command('draft-next', 'draft.set', { contextId, value: '等待期间继续输入', revision: 2 });
  command('send-before-thread', 'message.send', { contextId });
 });
 await waitFor(() => expect(boundary.release).toBeTypeOf('function'));
 expect(boundary.requests.filter(request => request.method === 'thread/start')).toHaveLength(1);
 await waitFor(() => expect(posts.at(-1)?.draft).toBe('等待期间继续输入'));
 await act(async () => { command('send-after-thread', 'message.send', { contextId }); });
 await waitFor(() => expect(queueItems[0]?.inputText).toBe('等待期间继续输入'));
 await act(async () => { boundary.release!(); });
});
it('已有会话在同一flush发送后输入的新消息走托管队列，不能并发再开turn', async () => {
 const contextId = await setup();
 await act(async () => { command('initial-draft', 'draft.set', { contextId, value: '建立会话', revision: 1 }); command('initial-send', 'message.send', { contextId }); });
 await waitFor(() => expect(boundary.release).toBeTypeOf('function'));
 await act(async () => { boundary.release!(); });
 await act(async () => boundary.options.onNotification('a', { method: 'turn/completed', params: { threadId: 'sent-thread', turn: { id: 'turn-live', status: 'completed', items: [] } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.busy).toBe(false));
 boundary.release = null;
 await act(async () => {
  command('draft-current', 'draft.set', { contextId, value: '直接发送', revision: 2 });
  command('send-current', 'message.send', { contextId });
  command('draft-queue', 'draft.set', { contextId, value: '随后排队', revision: 3 });
  command('send-queue', 'message.send', { contextId });
 });
 await waitFor(() => expect(boundary.release).toBeTypeOf('function'));
 expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(2);
 await waitFor(() => expect(queueItems[0]?.inputText).toBe('随后排队'));
 await act(async () => { boundary.release!(); });
});
it('原发送失败时保留期间新输入，并将失败的原输入留在现有恢复队列', async () => {
 const contextId = await setup(); boundary.failSend = true;
 await act(async () => {
  command('draft-original-fail', 'draft.set', { contextId, value: '失败的原输入', revision: 1 });
  command('send-original-fail', 'message.send', { contextId });
  command('draft-during-fail', 'draft.set', { contextId, value: '期间的新输入', revision: 2 });
 });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'send-original-fail' && !result.ok)).toBe(true));
 expect(posts.at(-1).draft).toBe('期间的新输入');
 expect(posts.at(-1).queued.some((item: any) => item.title.includes('失败的原输入'))).toBe(true);
});

it('默认网页表单同一flush重复submit也只发送一次，继续输入保持可编辑', async () => {
 await setup(false);
 fireEvent.click(screen.getByRole('button', { name: '聊天' }));
 const input = screen.getByRole('textbox', { name: '向 Codex 提问' });
 fireEvent.change(input, { target: { value: '网页第一份草稿' } });
 const form = input.closest('form')!;
 await act(async () => {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
 });
 await waitFor(() => expect(boundary.release).toBeTypeOf('function'));
 expect(boundary.requests.filter(request => request.method === 'thread/start')).toHaveLength(1);
 expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(1);
 fireEvent.change(input, { target: { value: '网页继续输入' } });
 await act(async () => { boundary.release!(); });
 expect(input).toHaveValue('网页继续输入');
 expect(posts).toHaveLength(0);
});

it('快速网络ACK先于React提交时仍按实时busy状态排队，不并发启动第二个turn', async () => {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => {
  command('draft-fast', 'draft.set', { contextId, value: '快速ACK的第一条', revision: 1 });
  command('send-fast', 'message.send', { contextId });
  for (let index = 0; index < 20; index++) await Promise.resolve();
  command('draft-after-ack', 'draft.set', { contextId, value: 'ACK后立即输入', revision: 2 });
  command('send-after-ack', 'message.send', { contextId });
 });
 expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(1);
 await waitFor(() => expect(queueItems[0]?.inputText).toBe('ACK后立即输入'));
});
it('历史编辑连续change与submit消费最新文本并同步占用提交状态', async () => {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => { command('hist-draft', 'draft.set', { contextId, value: '原历史', revision: 1 }); command('hist-send', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async () => boundary.options.onNotification('a', { method: 'turn/completed', params: { threadId: 'sent-thread', turn: { id: 'turn-live', status: 'completed', items: [{ id: 'history-user', type: 'userMessage', content: [{ type: 'text', text: '原历史' }] }] } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.busy).toBe(false));
 await act(async () => { command('hist-edit', 'message.edit', { contextId, turnId: 'turn-live', messageId: 'history-user' }); });
 await waitFor(() => expect(posts.at(-1)?.panel?.id).toContain('history-edit:'));
 const editKey = 'sent-thread:turn-live:history-user';
 await act(async () => {
  command('hist-change', 'history.change', { contextId, editKey, value: '最新历史正文' });
  command('hist-submit1', 'history.submit', { contextId, editKey });
  command('hist-submit2', 'history.submit', { contextId, editKey });
 });
 await waitFor(() => expect(boundary.requests.filter(r => r.method === 'turn/start')).toHaveLength(2));
 expect(boundary.requests.filter(r => r.method === 'turn/start')[1].params.input[0].text).toContain('最新历史正文');
 expect(boundary.requests.filter(r => r.method === 'thread/revert')).toHaveLength(1);
});
it('新对话连续输入与保存草稿使用同一实时草稿且不会发送消息', async () => {
 const { newChatDraftStore } = await import('../../src/features/drafts/new-chat-drafts');
 const save = vi.spyOn(newChatDraftStore, 'save').mockImplementation(async input => ({ ...input, id: 'draft-native', revision: '1', updatedAt: Date.now(), files: [] }));
 const contextId = await setup();
 await act(async () => { command('save-input', 'draft.set', { contextId, value: '立即保存的最新草稿', revision: 1 }); command('save-current', 'draft.save', { contextId }); });
 expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0].text).toBe('立即保存的最新草稿'); expect(boundary.requests.some(r => r.method === 'turn/start')).toBe(false); save.mockRestore();
});
