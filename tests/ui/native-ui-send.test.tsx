import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';
import { HttpOperationPendingError } from '../../src/backends/http-transport';
const boundary = vi.hoisted(() => ({ requests: [] as Array<{ method: string; params: any }>, options: null as any, client: null as any, release: null as null | (() => void), failSend: false, immediateSend: false, nextThreadId: 'sent-thread', delayRevert: false, pendingMethod: '', releaseRevert: null as null | (() => void), rejectStart: null as null | (() => void) }));
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
   if (method === 'thread/start') return { thread: { id: boundary.nextThreadId, cwd: null, turns: [] }, model: 'gpt' };
   if (method === boundary.pendingMethod) throw new HttpOperationPendingError(`pending-${params.threadId}-${method}`, { id: 'pending-rpc', method, params });
   if (method === 'thread/revert' && boundary.delayRevert) return new Promise(resolve => { boundary.releaseRevert = () => resolve({ thread: { id: params.threadId, turns: [] } }); });
   if (method === 'turn/start') { const turnId = params.threadId === 'thread-b' ? 'turn-b' : 'turn-live'; if (boundary.failSend) throw new Error('真实发送失败'); if (boundary.immediateSend) return { turn: { id: turnId, status: 'inProgress', items: [] } }; return new Promise((resolve, reject) => { boundary.release = () => resolve({ turn: { id: turnId, status: 'inProgress', items: [] } }); boundary.rejectStart = () => reject(new Error('旧会话发送失败')); }); }
   if (method === 'thread/turns/list') return { data: [], nextCursor: null };
   return { data: [], items: [], marketplaces: [], nextCursor: null };
  } };
  boundary.client = client;
  queueMicrotask(() => { this.options.onConnection(backends[0].id, 'online'); this.options.onReady(backends[0].id, client); });
 }
} }));
const posts: any[] = []; let queueItems: any[] = [];
function command(id: string, name: string, params: Record<string, unknown> = {}) { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } })); }
afterEach(() => { cleanup(); boundary.requests = []; boundary.client = null; boundary.options = null; boundary.release = null; boundary.failSend = false; boundary.immediateSend = false; boundary.nextThreadId = 'sent-thread'; boundary.delayRevert = false; boundary.pendingMethod = ''; boundary.releaseRevert = null; boundary.rejectStart = null; queueItems = []; posts.length = 0; localStorage.clear(); delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).webkit; delete (window as any).codexMobilePublishNativeSnapshot; vi.unstubAllGlobals(); });
async function setup(native = true, projectState = { projects: [] as string[], projectlessThreadIds: [] as string[] }) {
 if (native) Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (s: unknown) => posts.push(s) });
 vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
  if (String(url).includes('/api/follow-ups')) {
   if (options?.body) { const action = JSON.parse(String(options.body)); if (action.action === 'enqueue') queueItems.push({ ...action, revision: 1, state: 'queued' }); if (action.action === 'cancel') queueItems = queueItems.filter(item => item.id !== action.id); }
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
 await waitFor(() => expect(posts.at(-1)?.messages.find((message: any) => message.id === 'turn-live:history-user')?.historyEdit?.id).toContain('history-edit:'));
 expect(posts.at(-1).panel).toBeUndefined();
 const editKey = 'sent-thread:turn-live:history-user';
 await act(async () => {
  command('hist-change', 'history.change', { contextId, editKey, value: '最新历史正文' });
  command('hist-submit1', 'history.submit', { contextId, editKey });
  command('hist-submit2', 'history.submit', { contextId, editKey });
 });
 await waitFor(() => expect(boundary.requests.filter(r => r.method === 'turn/start')).toHaveLength(2));
 expect(boundary.requests.filter(r => r.method === 'turn/start')[1].params.input[0].text).toContain('最新历史正文');
 expect(boundary.requests.filter(r => r.method === 'thread/revert')).toHaveLength(1);
 await waitFor(() => expect(posts.at(-1)?.messages.every((message: any) => !message.historyEdit)).toBe(true));
});
it('原位历史编辑失败恢复目标草稿和原附件，重试保留同轮此前消息并只回退一次', async () => {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => { command('history-failure-draft', 'draft.set', { contextId, value: '创建对话', revision: 1 }); command('history-failure-send', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async () => boundary.options.onNotification('a', { method: 'turn/completed', params: { threadId: 'sent-thread', turn: { id: 'turn-live', status: 'completed', items: [
  { id: 'before', type: 'userMessage', content: [{ type: 'text', text: '同轮此前消息' }, { type: 'localImage', path: '/cache/before.png' }] },
  { id: 'target', type: 'userMessage', content: [{ type: 'text', text: '原目标' }, { type: 'localImage', path: '/cache/target.png' }] },
 ] } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.busy).toBe(false));
 await act(async () => { command('history-failure-composer', 'draft.set', { contextId, value: '普通草稿仍保留', revision: 2 }); command('history-failure-edit', 'message.edit', { contextId, turnId: 'turn-live', messageId: 'target' }); });
 const edited = () => posts.at(-1)?.messages.find((message: any) => message.id === 'turn-live:target');
 await waitFor(() => expect(edited()?.historyEdit?.id).toBe('history-edit:sent-thread:turn-live:target'));
 expect(JSON.stringify(edited().historyEdit)).toContain('同轮此前的 1 条用户消息及附件会一起重发');
 boundary.failSend = true;
 await act(async () => { command('history-failure-change', 'history.change', { contextId, editKey: 'sent-thread:turn-live:target', value: '失败后保留的新草稿' }); command('history-failure-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:target' }); });
 await waitFor(() => expect(posts.at(-1)?.error).toContain('真实发送失败'));
 await waitFor(() => expect(edited()?.historyEdit?.items.find((item: any) => item.id === 'history-text')?.disabled).toBe(false));
 expect(edited().historyEdit.items.find((item: any) => item.id === 'history-text').value).toBe('失败后保留的新草稿');
 expect(JSON.stringify(edited().blocks)).toContain(encodeURIComponent('/cache/target.png'));
 expect(JSON.stringify(edited().historyEdit)).toContain('原对话已回退，待重新发送的编辑草稿');
 expect(posts.at(-1).draft).toBe('普通草稿仍保留'); expect(posts.at(-1).panel).toBeUndefined();
 const attempted = boundary.requests.filter(request => request.method === 'turn/start').at(-1)!.params.input;
 expect(attempted.filter((part: any) => part.type === 'text').map((part: any) => part.text)).toEqual(['同轮此前消息', '失败后保留的新草稿']);
 expect(attempted.filter((part: any) => part.type === 'localImage').map((part: any) => part.path)).toEqual(['/cache/before.png', '/cache/target.png']);
 boundary.failSend = false;
 await act(async () => { command('history-failure-retry', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:target' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.every((message: any) => !message.historyEdit)).toBe(true));
 expect(boundary.requests.filter(request => request.method === 'thread/revert')).toHaveLength(1);
});

async function createHistorySource() {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => { command('source-draft', 'draft.set', { contextId, value: 'A原消息', revision: 1 }); command('source-send', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await completeHistoryThread('sent-thread', 'turn-live', 'message-a', 'A原消息');
 await act(async () => { command('source-edit', 'message.edit', { contextId, turnId: 'turn-live', messageId: 'message-a' }); command('source-edit-change', 'history.change', { contextId, editKey: 'sent-thread:turn-live:message-a', value: 'A授权重发内容' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.some((message: any) => message.historyEdit)).toBe(true));
 return contextId;
}
async function completeHistoryThread(threadId: string, turnId: string, messageId: string, text: string) {
 await act(async () => boundary.options.onNotification('a', { method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed', items: [{ id: messageId, type: 'userMessage', content: [{ type: 'text', text }] }] } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.busy).toBe(false));
}
async function switchHistoryDestination(existing: boolean) {
 await act(async () => { command('destination-new', 'thread.new'); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBeUndefined());
 const contextId = posts.at(-1).contextId;
 if (existing) {
  boundary.nextThreadId = 'thread-b'; boundary.immediateSend = true;
  await act(async () => { command('destination-draft', 'draft.set', { contextId, value: 'B原消息', revision: 1 }); command('destination-send', 'message.send', { contextId }); });
  await waitFor(() => expect(posts.at(-1)?.threadId).toBe('thread-b'));
  await completeHistoryThread('thread-b', 'turn-b', 'message-b', 'B原消息');
 }
 await act(async () => { command('destination-composer', 'draft.set', { contextId, value: 'B普通草稿', revision: 2 }); });
 await waitFor(() => expect(posts.at(-1)?.draft).toBe('B普通草稿'));
 return contextId;
}
it.each([false, true])('A历史回退迟到时已切换目标existing=%s，仍重发A但不能覆盖新目标上下文', async existing => {
 const contextId = await createHistorySource(); boundary.delayRevert = true;
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(boundary.releaseRevert).toBeTypeOf('function'));
 const destinationContext = await switchHistoryDestination(existing);
 const expectedThread = existing ? 'thread-b' : undefined;
 await act(async () => { boundary.releaseRevert!(); });
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'turn/start' && request.params.threadId === 'sent-thread')).toHaveLength(2));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'source-submit')).toBe(true));
 expect(posts.at(-1)).toMatchObject({ contextId: destinationContext, draft: 'B普通草稿', busy: false, pending: false, readOnly: false });
 expect(posts.at(-1).threadId).toBe(expectedThread);
 expect(posts.at(-1).messages.some((message: any) => message.text.includes('A授权重发内容'))).toBe(false);
 const resend = boundary.requests.filter(request => request.method === 'turn/start' && request.params.threadId === 'sent-thread').at(-1)!;
 expect(resend.params.input[0].text).toBe('A授权重发内容');
 expect(boundary.requests.filter(request => request.method === 'thread/revert')).toHaveLength(1);
});
it.each(['success', 'failure'])('A历史发送%s迟到时B的新编辑、错误、草稿和pending状态不被清空', async outcome => {
 const contextId = await createHistorySource(); boundary.immediateSend = false;
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(2));
 const finish = outcome === 'success' ? boundary.release! : boundary.rejectStart!;
 const destinationContext = await switchHistoryDestination(true);
 await act(async () => { command('destination-edit', 'message.edit', { contextId: destinationContext, turnId: 'turn-b', messageId: 'message-b' }); command('destination-change', 'history.change', { contextId: destinationContext, editKey: 'thread-b:turn-b:message-b', value: 'B新编辑草稿' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.find((message: any) => message.id === 'turn-b:message-b')?.historyEdit?.items[0].value).toBe('B新编辑草稿'));
 await act(async () => { command('destination-error', 'model.select', { contextId: destinationContext, value: 'invalid' }); });
 await waitFor(() => expect(posts.at(-1)?.error).toBeTruthy());
 const error = posts.at(-1).error;
 await act(async () => { finish(); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'source-submit')).toBe(true));
 expect(posts.at(-1)).toMatchObject({ threadId: 'thread-b', contextId: destinationContext, draft: 'B普通草稿', busy: false, pending: false, readOnly: true, error });
 expect(posts.at(-1).messages.find((message: any) => message.id === 'turn-b:message-b')?.historyEdit?.items[0].value).toBe('B新编辑草稿');
});

it.each(['thread/revert', 'turn/start'])('A历史%s的HTTP待确认成功只完成A授权操作并保持B编辑状态', async method => {
 const contextId = await createHistorySource(); boundary.pendingMethod = method;
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(posts.at(-1)?.pending).toBe(true));
 boundary.pendingMethod = '';
 const destinationContext = await switchHistoryDestination(true);
 await act(async () => { command('destination-edit', 'message.edit', { contextId: destinationContext, turnId: 'turn-b', messageId: 'message-b' }); command('destination-change', 'history.change', { contextId: destinationContext, editKey: 'thread-b:turn-b:message-b', value: 'B新编辑草稿' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.find((message: any) => message.id === 'turn-b:message-b')?.historyEdit?.items[0].value).toBe('B新编辑草稿'));
 const result = method === 'thread/revert' ? { thread: { id: 'sent-thread', turns: [] } } : { turn: { id: 'turn-a-retry', status: 'inProgress', items: [] } };
 await act(async () => boundary.options.onNotification('a', { method: 'mobile/operation/confirmed', params: { requestId: `pending-sent-thread-${method}`, request: { method, params: { threadId: 'sent-thread' } }, response: { id: 'pending-rpc', result } } }, boundary.client));
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'turn/start' && request.params.threadId === 'sent-thread')).toHaveLength(2));
 expect(posts.at(-1)).toMatchObject({ threadId: 'thread-b', contextId: destinationContext, draft: 'B普通草稿', busy: false, pending: false, readOnly: true });
 expect(posts.at(-1).messages.find((message: any) => message.id === 'turn-b:message-b')?.historyEdit?.items[0].value).toBe('B新编辑草稿');
 expect(boundary.requests.filter(request => request.method === 'thread/revert' && request.params.threadId === 'sent-thread')).toHaveLength(1);
});
it('A历史发送迟到不解除B自己正在等待HTTP回退确认的busy和pending', async () => {
 const contextId = await createHistorySource(); boundary.immediateSend = false;
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(2));
 const finish = boundary.release!;
 const destinationContext = await switchHistoryDestination(true);
 await act(async () => { command('destination-edit', 'message.edit', { contextId: destinationContext, turnId: 'turn-b', messageId: 'message-b' }); command('destination-change', 'history.change', { contextId: destinationContext, editKey: 'thread-b:turn-b:message-b', value: 'B待确认编辑草稿' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.find((message: any) => message.id === 'turn-b:message-b')?.historyEdit).toBeDefined());
 boundary.pendingMethod = 'thread/revert';
 await act(async () => { command('destination-submit', 'history.submit', { contextId: destinationContext, editKey: 'thread-b:turn-b:message-b' }); });
 await waitFor(() => expect(posts.at(-1)?.pending).toBe(true));
 await act(async () => { finish(); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'source-submit')).toBe(true));
 expect(posts.at(-1)).toMatchObject({ threadId: 'thread-b', contextId: destinationContext, busy: true, pending: true, readOnly: true, draft: 'B普通草稿' });
 expect(posts.at(-1).messages.find((message: any) => message.id === 'turn-b:message-b')?.historyEdit?.items[0]).toMatchObject({ value: 'B待确认编辑草稿', disabled: true });
});

async function reconnectHistoryClient() {
 const previous = boundary.client;
 const replacement = { ...previous, request: async (method: string, params: any) => {
  if (method === 'thread/resume') {
   boundary.requests.push({ method, params });
   return { thread: { id: params.threadId, turns: [] }, model: 'gpt' };
  }
  return previous.request(method, params);
 } };
 const before = boundary.requests.filter(request => request.method === 'thread/resume').length;
 await act(async () => {
  boundary.options.onConnection('a', 'offline');
  boundary.options.onConnection('a', 'connecting');
  boundary.client = replacement;
  boundary.options.onConnection('a', 'online');
  boundary.options.onReady('a', replacement);
 });
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'thread/resume')).toHaveLength(before + 1));
 return replacement;
}
it.each(['thread/revert', 'turn/start'].flatMap(method => ['success', 'error'].map(outcome => ({ method, outcome }))))('历史$method等待期间原上下文重连后可信确认$outcome能释放旧提交', async ({ method, outcome }) => {
 const contextId = await createHistorySource(); boundary.pendingMethod = method;
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(posts.at(-1)?.pending).toBe(true));
 const replacement = await reconnectHistoryClient();
 boundary.pendingMethod = '';
 const response = outcome === 'error' ? { id: 'pending-rpc', error: { code: -1, message: '确认发送失败' } }
  : { id: 'pending-rpc', result: method === 'thread/revert' ? { thread: { id: 'sent-thread', turns: [] } } : { turn: { id: 'turn-resend', status: 'inProgress', items: [] } } };
 await act(async () => boundary.options.onNotification('a', { method: 'mobile/operation/confirmed', params: { requestId: `pending-sent-thread-${method}`, request: { method }, response } }, replacement));
 await waitFor(() => expect(posts.at(-1)?.pending).toBe(false));
 expect(posts.at(-1).contextId).toBe(contextId);
 if (outcome === 'success') {
  await waitFor(() => expect(posts.at(-1)?.readOnly).toBe(false));
  expect(posts.at(-1).messages.every((message: any) => !message.historyEdit)).toBe(true);
 } else {
  await waitFor(() => expect(posts.at(-1)?.messages.find((message: any) => message.id === 'turn-live:message-a')?.historyEdit?.items[0].disabled).toBe(false));
  expect(posts.at(-1)).toMatchObject({ busy: false, error: '确认发送失败' });
  await act(async () => { command('cancel-after-reconnect', 'history.cancel', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
  await waitFor(() => expect(posts.at(-1)?.readOnly).toBe(false));
 }
});
it('普通历史发送错误在同一编辑重连后到达仍能释放编辑且保留失败草稿', async () => {
 const contextId = await createHistorySource(); boundary.immediateSend = false;
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(2));
 const fail = boundary.rejectStart!;
 await reconnectHistoryClient();
 await act(async () => { fail(); });
 await waitFor(() => expect(posts.at(-1)?.error).toContain('旧会话发送失败'));
 expect(posts.at(-1)).toMatchObject({ busy: false, pending: false, contextId });
 expect(posts.at(-1).messages.find((message: any) => message.id === 'turn-live:message-a')?.historyEdit?.items[0]).toMatchObject({ value: 'A授权重发内容', disabled: false });
});
it('历史start待确认前已完成，迟到inProgress确认不能倒退终态或阻止再次编辑', async () => {
 const contextId = await createHistorySource(); boundary.pendingMethod = 'turn/start';
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(posts.at(-1)?.pending).toBe(true));
 boundary.pendingMethod = '';
 await act(async () => boundary.options.onNotification('a', { method: 'turn/completed', params: { threadId: 'sent-thread', turn: { id: 'turn-resend', status: 'completed', items: [{ id: 'message-resend', type: 'userMessage', content: [{ type: 'text', text: 'A授权重发内容' }] }, { id: 'final-resend', type: 'agentMessage', phase: 'final_answer', text: '重发已完成' }] } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.messages.some((message: any) => message.text === '重发已完成')).toBe(true));
 const beforeReads = boundary.requests.filter(request => request.method === 'thread/turns/list').length;
 await act(async () => boundary.options.onNotification('a', { method: 'mobile/operation/confirmed', params: { requestId: 'pending-sent-thread-turn/start', request: { method: 'turn/start' }, response: { id: 'pending-rpc', result: { turn: { id: 'turn-resend', status: 'inProgress', items: [] } } } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.pending).toBe(false));
 expect(posts.at(-1).busy).toBe(false);
 expect(posts.at(-1).groups.flatMap((group: any) => group.items).filter((item: any) => item.command?.params?.threadId === 'sent-thread').every((item: any) => item.badge !== '运行中')).toBe(true);
 await act(async () => { command('edit-completed-resend', 'message.edit', { contextId, turnId: 'turn-resend', messageId: 'message-resend' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.find((message: any) => message.id === 'turn-resend:message-resend')?.historyEdit).toBeDefined());
 expect(boundary.requests.filter(request => request.method === 'thread/turns/list').length).toBeGreaterThan(beforeReads);
});

it('新对话连续输入与保存草稿使用同一实时草稿且不会发送消息', async () => {
 const { newChatDraftStore } = await import('../../src/features/drafts/new-chat-drafts');
 const save = vi.spyOn(newChatDraftStore, 'save').mockImplementation(async input => ({ ...input, id: 'draft-native', revision: '1', updatedAt: Date.now(), files: [] }));
 const contextId = await setup();
 await act(async () => { command('save-input', 'draft.set', { contextId, value: '立即保存的最新草稿', revision: 1 }); command('save-current', 'draft.save', { contextId }); });
 expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0].text).toBe('立即保存的最新草稿'); expect(boundary.requests.some(r => r.method === 'turn/start')).toBe(false); save.mockRestore();
});

it.each([['workspace.thread', false], ['thread.manage', false], ['workspace.thread', true], ['thread.manage', true]] as const)('%s 归档先确认（存在队列：%s），取消不改队列，确认仅归档一次', async (entry, queued) => {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => { command('archive-seed-draft', 'draft.set', { contextId, value: '归档确认测试', revision: 1 }); command('archive-seed-send', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 if (queued) {
  await act(async () => { command('archive-queue-draft', 'draft.set', { contextId, value: '归档前保留队列', revision: 2 }); command('archive-queue-send', 'message.send', { contextId }); });
  await waitFor(() => expect(queueItems).toHaveLength(1));
 }
 const params = entry === 'workspace.thread' ? { contextId, action: 'archive' } : { backendId: 'a', threadId: 'sent-thread', action: 'archive' };
 await act(async () => { command('archive-cancelled', entry, params); });
 await waitFor(() => expect(posts.at(-1)?.panel?.id).toMatch(/^confirmation:/));
 expect(boundary.requests.filter(r => r.method === 'thread/archive')).toHaveLength(0);
 const cancel = posts.at(-1).panel.items.find((i: any) => i.id === 'confirmation-no').command;
 await act(async () => { command('archive-answer-no', cancel.name, cancel.params); });
 await waitFor(() => expect(posts.at(-1)?.panel?.id ?? '').not.toMatch(/^confirmation:/));
 expect(boundary.requests.filter(r => r.method === 'thread/archive')).toHaveLength(0);
 expect(posts.at(-1).threadId).toBe('sent-thread');
 expect(queueItems).toHaveLength(queued ? 1 : 0);
 await act(async () => { command('archive-confirmed', entry, params); });
 await waitFor(() => expect(posts.at(-1)?.panel?.id).toMatch(/^confirmation:/));
 const yes = posts.at(-1).panel.items.find((i: any) => i.id === 'confirmation-yes').command;
 await act(async () => { command('archive-answer-yes', yes.name, yes.params); });
 await waitFor(() => expect(boundary.requests.filter(r => r.method === 'thread/archive')).toHaveLength(1));
 expect(boundary.requests.find(r => r.method === 'thread/archive')?.params.threadId).toBe('sent-thread');
 expect(queueItems).toHaveLength(0);
});
