import { decodeUserMessage } from '../../server/user-message-format';
import { quoteInput, quoteSource } from '../../src/features/conversation/message-quotes';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';
import { HttpOperationPendingError } from '../../src/backends/http-transport';
const boundary = vi.hoisted(() => ({ requests: [] as Array<{ method: string; params: any }>, threadList: [] as any[], quoteCatalog: false, options: null as any, client: null as any, release: null as null | (() => void), failSend: false, immediateSend: false, nextThreadId: 'sent-thread', delayRevert: false, pendingMethod: '', releaseRevert: null as null | (() => void), rejectStart: null as null | (() => void) }));
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
 constructor(private options: any) { boundary.options = options; }
 client() { return boundary.client; } socket() { return null; } close() {} reconnect() {}
 sync(backends: any[]) {
  if (!backends.length) return;
  const client = { onNotification() { return () => {}; }, onThreadMetadata() { return () => {}; }, request: async (method: string, params: any) => {
   if (method === 'mobile/sidechat/rpc') { method = params.method; params = params.params; }
   boundary.requests.push({ method, params });
   if (method === 'thread/read' && boundary.threadList.some(thread=>thread.id===params.threadId)) return {thread:boundary.threadList.find(thread=>thread.id===params.threadId)};
   if (method === 'thread/list') return {data:boundary.threadList,nextCursor:null};
   if (method === 'skills/list' && boundary.quoteCatalog) return {data:[{cwd:null,skills:[{name:'private-skill',path:'/skills/private/SKILL.md',description:'test',scope:'user',enabled:true}]}]};
   if (method === 'plugin/installed' && boundary.quoteCatalog) return {marketplaces:[{name:'test',plugins:[{id:'private-plugin',name:'private-plugin',installed:true,enabled:true,availability:'AVAILABLE'}]}]};
   if (method === 'model/list') return { data: [{ model: 'gpt', displayName: 'GPT', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] }] };
   if (method === 'permissionProfile/list') return { data: [{ id: ':workspace', allowed: true }] };
   if (method === 'config/read') return { config: { model: 'gpt', sandbox_mode: 'workspace-write', model_reasoning_effort: 'high' } };
   if (method === 'thread/start') return { thread: { id: boundary.nextThreadId, cwd: null, turns: [] }, model: 'gpt' };
   if (method === boundary.pendingMethod) throw new HttpOperationPendingError(`pending-${params.threadId}-${method}`, { id: 'pending-rpc', method, params });
   if (method === 'thread/revert' && boundary.delayRevert) return new Promise(resolve => { boundary.releaseRevert = () => resolve({ thread: { id: params.threadId, turns: [] } }); });
   if (method === 'turn/start') { const turnId = params.threadId === 'thread-b' ? 'turn-b' : 'turn-live'; if (boundary.failSend) throw new Error('真实发送失败'); if (boundary.immediateSend) return { turn: { id: turnId, status: 'inProgress', items: [] } }; return new Promise((resolve, reject) => { boundary.release = () => resolve({ turn: { id: turnId, status: 'inProgress', items: [] } }); boundary.rejectStart = () => reject(new Error('旧会话发送失败')); }); }
   if (method === 'read') throw new Error('Sidechat 已失效');
   if (method === 'thread/fork') return { thread: { id: `side-${boundary.requests.filter(r => r.method === 'thread/fork').length}`, cwd: '/work', ephemeral: true, turns: [{ id: 'inherited', items: [{ type: 'agentMessage', text: '不得显示的继承正文' }] }] }, model: 'gpt', reasoningEffort: 'high' };
   if (method === 'thread/turns/list') return { data: [{ id: 'done-main', status: 'completed', items: [] }], nextCursor: null };
   return { data: [], items: [], marketplaces: [], nextCursor: null };
  } };
  boundary.client = client;
  queueMicrotask(() => { this.options.onConnection(backends[0].id, 'online'); this.options.onReady(backends[0].id, client); });
 }
} }));
const posts: any[] = []; let queueItems: any[] = [];
function command(id: string, name: string, params: Record<string, unknown> = {}) { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } })); }
afterEach(() => { cleanup(); boundary.requests = []; boundary.threadList = []; boundary.quoteCatalog = false; boundary.client = null; boundary.options = null; boundary.release = null; boundary.failSend = false; boundary.immediateSend = false; boundary.nextThreadId = 'sent-thread'; boundary.delayRevert = false; boundary.pendingMethod = ''; boundary.releaseRevert = null; boundary.rejectStart = null; queueItems = []; posts.length = 0; localStorage.clear(); delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).webkit; delete (window as any).codexMobilePublishNativeSnapshot; vi.unstubAllGlobals(); });
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
it('Sidechat沿真实App路由创建、隐藏历史、独立发送、返回与关闭，并拒绝旧上下文命令', async () => {
 boundary.immediateSend = true;
 const initial = await setup();
 await act(async () => { command('draft-main', 'draft.set', { contextId: initial, value: '主任务', revision: 1 }); command('send-main', 'message.send', { contextId: initial }); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 const mainContext = posts.at(-1).contextId;
 await act(async () => command('side-create', 'sidechat.create', { contextId: mainContext }));
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('side-1'));
 expect(posts.at(-1).messages).toEqual([]);
 expect(posts.at(-1).sidechatParentId).toBe('sent-thread');
 expect(posts.at(-1).contextId).not.toBe(mainContext);
 const sideContext = posts.at(-1).contextId;
 await act(async () => { command('draft-side', 'draft.set', { contextId: sideContext, value: '只探索', revision: 1 }); command('send-side', 'message.send', { contextId: sideContext }); });
 await waitFor(() => expect(boundary.requests.some(r => r.method === 'turn/start' && r.params.threadId === 'side-1')).toBe(true));
 expect(boundary.requests.find(r => r.method === 'thread/fork')?.params.lastTurnId).toBe('done-main');
 await act(async () => command('return-main', 'sidechat.return', { contextId: sideContext }));
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 const returned = posts.at(-1).contextId;
 await act(async () => command('stale-close', 'sidechat.close', { contextId: sideContext, id: 'side-1' }));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((r: any) => r.id === 'stale-close' && !r.ok)).toBe(true));
 await act(async () => command('open-side', 'sidechat.open', { contextId: returned, id: 'side-1' }));
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('side-1'));
 const reopenedContext = posts.at(-1).contextId;
 await act(async () => { command('queue-draft','draft.set',{contextId:reopenedContext,value:'保留排队消息',revision:1}); command('enqueue-side','message.send',{contextId:reopenedContext}); });
 await waitFor(() => expect(posts.at(-1)?.queued.some((item:any) => item.title === '保留排队消息')).toBe(true));
 const queueBefore = posts.at(-1).queued.map((item:any) => item.id);
 await act(async () => command('keep-draft', 'draft.set', {contextId:reopenedContext,value:'保留尚未发送的草稿',revision:2}));
 const closesBefore = boundary.requests.filter(r => ['turn/interrupt','thread/unsubscribe'].includes(r.method) && r.params.threadId === 'side-1').length;
 await act(async () => command('close-cancel', 'sidechat.close', { contextId: reopenedContext, id: 'side-1' }));
 await waitFor(() => expect(posts.at(-1)?.panel?.id).toMatch(/^confirmation:/));
 expect(posts.at(-1).threadId).toBe('side-1');
 expect(posts.at(-1).busy).toBe(true);
 expect(boundary.requests.filter(r => ['turn/interrupt','thread/unsubscribe'].includes(r.method) && r.params.threadId === 'side-1')).toHaveLength(closesBefore);
 let panel = posts.at(-1).panel;
 await act(async () => command('cancel-close','confirmation.answer',{key:panel.id,confirmed:false}));
 await waitFor(() => expect(posts.at(-1)?.panel).toBeUndefined());
 expect(posts.at(-1).threadId).toBe('side-1');expect(posts.at(-1).busy).toBe(true);expect(posts.at(-1).draft).toBe('保留尚未发送的草稿');
 expect(posts.at(-1).queued.map((item:any) => item.id)).toEqual(queueBefore);
 expect(boundary.requests.filter(r => ['turn/interrupt','thread/unsubscribe'].includes(r.method) && r.params.threadId === 'side-1')).toHaveLength(closesBefore);
 await act(async () => command('close-stale-intent','sidechat.close',{contextId:reopenedContext,id:'side-1'}));
 await waitFor(() => expect(posts.at(-1)?.panel?.id).toMatch(/^confirmation:/));
 panel = posts.at(-1).panel;
 await act(async () => command('navigate-during-confirm','sidechat.return',{contextId:reopenedContext}));
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async () => command('late-confirm-close','confirmation.answer',{key:panel.id,confirmed:true}));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((r:any) => r.id === 'close-stale-intent' && !r.ok)).toBe(true));
 expect(boundary.requests.filter(r => ['turn/interrupt','thread/unsubscribe'].includes(r.method) && r.params.threadId === 'side-1')).toHaveLength(closesBefore);
 await act(async () => command('reopen-for-close','sidechat.open',{contextId:posts.at(-1).contextId,id:'side-1'}));
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('side-1'));
 await act(async () => command('close-side', 'sidechat.close', { contextId: posts.at(-1).contextId, id: 'side-1' }));
 await waitFor(() => expect(posts.at(-1)?.panel?.id).toMatch(/^confirmation:/));
 panel = posts.at(-1).panel;
 expect(panel.items.find((item:any) => item.id === 'confirmation-yes').text).toContain('关闭');
 await act(async () => command('confirm-close','confirmation.answer',{key:panel.id,confirmed:true}));
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 expect(boundary.requests.some(r => r.method === 'thread/unsubscribe' && r.params.threadId === 'side-1')).toBe(true);
 expect(queueItems).toEqual([]);
});

it('daemon重启导致分支失效时回到主聊天，不能把已失效分支当普通聊天继续使用', async () => {
 boundary.immediateSend = true; const initial = await setup();
 await act(async () => { command('main-draft', 'draft.set', {contextId:initial,value:'主任务',revision:1}); command('main-send','message.send',{contextId:initial}); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async () => command('create','sidechat.create',{contextId:posts.at(-1).contextId}));
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('side-1'));
 await act(async () => boundary.options.onReady('a',boundary.client));
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 expect(posts.at(-1)?.sidechatActive).toBe(false);
 expect(boundary.requests.filter(r=>r.method==='thread/fork')).toHaveLength(1);
});

async function openSidechatForSend() {
 boundary.immediateSend = true;
 const initial = await setup();
 await act(async () => { command('seed-draft','draft.set',{contextId:initial,value:'只读主聊天',revision:1}); command('seed-send','message.send',{contextId:initial}); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async () => command('create-for-send','sidechat.create',{contextId:posts.at(-1).contextId}));
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('side-1'));
 return posts.at(-1).contextId as string;
}

it.each([false, true])('从现有对话新建继承当前项目并覆盖旧项目记忆，projectless=%s', async projectless => {
  boundary.threadList = [{ id: 'current-project', cwd: '/current', preview: '当前项目对话' }];
  localStorage.setItem('codex-mobile:new-chat-project:a', '/remembered');
  await setup(true, { projects: ['/current', '/remembered'], projectlessThreadIds: projectless ? ['current-project'] : [] });
  await act(async () => command('open-project-source', 'thread.open', { backendId: 'a', threadId: 'current-project' }));
  await waitFor(() => expect(posts.at(-1)?.threadId).toBe('current-project'));
  await act(async () => command('inherit-current-project', 'thread.new'));
  await waitFor(() => expect(posts.at(-1)?.threadId).toBeUndefined());
  expect(posts.at(-1).cwd).toBe(projectless ? undefined : '/current');
  expect(posts.at(-1).projectName).toBe(projectless ? '无项目' : 'current');
  expect(boundary.requests.some(r => r.method === 'thread/start')).toBe(false);
});

it('Sidechat运行中原生队列可转为引导，编辑待发文字后发送最新正文', async () => {
  const contextId = await openSidechatForSend();
  await act(async () => { command('side-run-text', 'draft.set', { contextId, value: '启动分支', revision: 1 }); command('side-run-send', 'message.send', { contextId }); });
  await waitFor(() => expect(posts.at(-1)?.busy).toBe(true));
  await act(async () => { command('side-guide-text', 'draft.set', { contextId, value: '待引导', revision: 2 }); command('side-guide-queue', 'message.send', { contextId }); });
  await waitFor(() => expect(posts.at(-1)?.queued).toHaveLength(1));
  const id = posts.at(-1).queued[0].id;
  expect(posts.at(-1).queued[0].command.name).toBe('queue.send');
  await act(async () => command('side-guide-edit', 'queue.edit', { contextId, id, value: '修改后的引导' }));
  await act(async () => command('side-guide-steer', 'queue.send', { contextId, id }));
  await waitFor(() => expect(boundary.requests.some(r => r.method === 'turn/steer')).toBe(true));
  expect(boundary.requests.find(r => r.method === 'turn/steer')?.params).toMatchObject({ threadId: 'side-1', expectedTurnId: 'turn-live', clientUserMessageId: id });
  expect(decodeUserMessage(boundary.requests.find(r => r.method === 'turn/steer')!.params.input[0].text).body).toBe('修改后的引导');
  await waitFor(() => expect(posts.at(-1)?.queued).toEqual([])); expect(queueItems).toEqual([]);
});

it('Sidechat历史编辑确认删除后重建分支，保留前文和未发草稿', async () => {
  const contextId = await openSidechatForSend();
  for (const id of ['keep', 'edit', 'later']) await act(async () => boundary.options.onNotification('a', { method: 'turn/completed', params: { threadId: 'side-1', turn: { id, status: 'completed', items: [{ id: `${id}-user`, type: 'userMessage', content: [{ type: 'text', text: `${id}原文` }] }, { id: `${id}-answer`, type: 'agentMessage', text: `${id}回答` }] } } }));
  await waitFor(() => expect(posts.at(-1)?.messages.some((m: any) => m.itemId === 'edit-user')).toBe(true));
  expect(posts.at(-1).messages.find((m: any) => m.itemId === 'edit-user').actions.some((a: any) => a.command?.name === 'message.edit')).toBe(true);
  await act(async () => { command('side-unsent-draft', 'draft.set', { contextId, value: '尚未发送的草稿', revision: 1 }); command('side-history-open', 'message.edit', { contextId, turnId: 'edit', messageId: 'edit-user' }); });
  await waitFor(() => expect(posts.at(-1)?.messages.some((m: any) => m.historyEdit)).toBe(true));
  const editKey = 'side-1:edit:edit-user';
  await act(async () => { command('side-history-change', 'history.change', { contextId, editKey, value: '修改后的历史消息' }); command('side-history-submit', 'history.submit', { contextId, editKey }); });
  await waitFor(() => expect(posts.at(-1)?.panel?.id).toMatch(/^confirm-history:/));
  expect(boundary.requests.filter(r => r.method === 'thread/fork')).toHaveLength(1);
  await act(async () => command('side-history-confirm', 'history.submit', { contextId, editKey, confirmed: true }));
  await waitFor(() => expect(posts.at(-1)?.threadId).toBe('side-2'));
  expect(posts.at(-1).draft).toBe('尚未发送的草稿'); expect(posts.at(-1).sidechatParentId).toBe('sent-thread');
  expect(posts.at(-1).messages.some((m: any) => m.itemId === 'keep-user')).toBe(true);
  expect(posts.at(-1).messages.some((m: any) => m.itemId === 'later-user')).toBe(false);
  expect(boundary.requests.find(r => r.method === 'turn/start' && r.params.threadId === 'side-2')?.params.input[0].text).toContain('修改后的历史消息');
  expect(boundary.requests.some(r => r.method === 'thread/unsubscribe' && r.params.threadId === 'side-1')).toBe(true);
});

it('Sidechat历史重发失败保留原分支和编辑内容，允许继续修改', async () => {
 const contextId = await openSidechatForSend();
 await act(async () => boundary.options.onNotification('a', { method: 'turn/completed', params: { threadId: 'side-1', turn: { id: 'source-edit', status: 'completed', items: [{ id: 'source-user', type: 'userMessage', content: [{ type: 'text', text: '原问题' }] }, { id: 'source-answer', type: 'agentMessage', text: '原回答不能丢失' }] } } }));
 await act(async () => command('failed-side-open-edit', 'message.edit', { contextId, turnId: 'source-edit', messageId: 'source-user' }));
 await waitFor(() => expect(posts.at(-1)?.messages.some((m: any) => m.historyEdit)).toBe(true));
 boundary.failSend = true;
 const editKey = 'side-1:source-edit:source-user';
 await act(async () => { command('failed-side-change', 'history.change', { contextId, editKey, value: '保留这次修改' }); command('failed-side-submit', 'history.submit', { contextId, editKey }); });
 await waitFor(() => expect(posts.at(-1)?.error).toContain('真实发送失败'));
 expect(posts.at(-1).threadId).toBe('side-1');
 const editor = posts.at(-1).messages.find((m: any) => m.historyEdit).historyEdit;
 expect(editor.items.find((i: any) => i.id === 'history-text').value).toBe('保留这次修改');
 expect(editor.items.find((i: any) => i.id === 'history-text').disabled).toBe(false);
 expect(posts.at(-1).messages.some((m: any) => m.text === '原回答不能丢失')).toBe(true);
 expect(boundary.requests.some(r => r.method === 'thread/unsubscribe' && r.params.threadId === 'side-1')).toBe(false);
});

it('Sidechat附件上传失败保留正文和原始附件，不提前清空输入', async () => {
 const contextId=await openSidechatForSend();
 const BaseURL=URL;
 vi.stubGlobal('URL',class extends BaseURL {static createObjectURL(){return 'blob:sidechat-test';}static revokeObjectURL(){}});
 const originalFetch=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async(...args:Parameters<typeof fetch>)=>String(args[0]).includes('/api/uploads/file')?new Response('',{status:503}):originalFetch(...args));
 await act(async()=>{
  command('draft-upload','draft.set',{contextId,value:'保留这条正文',revision:1});
  command('import-upload','attachment.import',{contextId,items:[{name:'note.txt',type:'text/plain',data:btoa('file bytes')}]});
 });
 await waitFor(()=>expect(posts.at(-1)?.attachments).toHaveLength(1));
 const attachmentId=posts.at(-1).attachments[0].id;
 await act(async()=>command('send-upload-error','message.send',{contextId}));
 await waitFor(()=>expect(posts.at(-1)?.commandResults?.some((r:any)=>r.id==='send-upload-error'&&!r.ok)).toBe(true));
 expect(posts.at(-1).draft).toBe('保留这条正文');
 expect(posts.at(-1).attachments.map((a:any)=>a.id)).toContain(attachmentId);
 expect(boundary.requests.some(r=>r.method==='turn/start'&&r.params.threadId==='side-1')).toBe(false);
});

it('Sidechat入队前失效时拒绝旧上下文发送并清理私有正文', async () => {
 const contextId=await openSidechatForSend();
 await act(async()=>{command('draft-reject','draft.set',{contextId,value:'还没入队的正文',revision:1});boundary.options.onNotification('a',{method:'thread/closed',params:{threadId:'side-1'}});});
 await act(async()=>command('send-unavailable','message.send',{contextId}));
 await waitFor(()=>expect(posts.at(-1)?.commandResults?.some((r:any)=>r.id==='send-unavailable'&&!r.ok)).toBe(true));
 expect(posts.at(-1).threadId).toBe('sent-thread');expect(posts.at(-1).draft).not.toBe('还没入队的正文');
});

it('Sidechat原输入已入队后发送失败只留队列，避免草稿重复恢复', async () => {
 const contextId=await openSidechatForSend();boundary.failSend=true;
 await act(async()=>{command('draft-queued-error','draft.set',{contextId,value:'失败条目保留一次',revision:1});command('send-queued-error','message.send',{contextId});});
 await waitFor(()=>expect(posts.at(-1)?.queued.some((item:any)=>item.title==='失败条目保留一次')).toBe(true));
 expect(posts.at(-1).draft).toBe('');expect(posts.at(-1).queued).toHaveLength(1);
});

it('上传期间继续编辑时只清理已入队附件，保留后续新正文', async () => {
 const contextId=await openSidechatForSend();const BaseURL=URL;
 vi.stubGlobal('URL',class extends BaseURL {static createObjectURL(){return 'blob:sidechat-edit';}static revokeObjectURL(){}});
 const originalFetch=vi.mocked(fetch).getMockImplementation()!;let finish!:(response:Response)=>void;
 vi.mocked(fetch).mockImplementation(async(...args:Parameters<typeof fetch>)=>String(args[0]).includes('/api/uploads/file')?new Promise(resolve=>{finish=resolve;}):originalFetch(...args));
 await act(async()=>{command('draft-first','draft.set',{contextId,value:'先发送的正文',revision:1});command('import-first','attachment.import',{contextId,items:[{name:'note.txt',type:'text/plain',data:btoa('bytes')}]});});
 await waitFor(()=>expect(posts.at(-1)?.attachments).toHaveLength(1));
 act(()=>command('send-first','message.send',{contextId}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
 await act(async()=>command('draft-next','draft.set',{contextId,value:'上传期间的新正文',revision:2}));
 await act(async()=>finish(new Response(JSON.stringify({path:'/tmp/note.txt',name:'note.txt',type:'text/plain',size:5}))));
 await waitFor(()=>expect(posts.at(-1)?.commandResults?.some((r:any)=>r.id==='send-first'&&r.ok)).toBe(true));
 expect(posts.at(-1).draft).toBe('上传期间的新正文');expect(posts.at(-1).attachments).toHaveLength(0);
 expect(decodeUserMessage(boundary.requests.find(r=>r.method==='turn/start'&&r.params.threadId==='side-1')?.params.input[0].text).body).toBe('先发送的正文');
});


it('选文加入聊天保留问题，引用携带真实来源并在发送时冻结全文', async () => {
 const contextId = await openSidechatForSend();
 await act(async()=> boundary.options.onNotification('a',{method:'turn/completed',params:{threadId:'side-1',turn:{id:'turn-live',status:'completed',items:[{id:'answer-selection',type:'agentMessage',phase:'final_answer',text:'重复内容，重复内容。 **重点** @private-skill'}]}}}));
 await waitFor(()=>expect(posts.at(-1)?.messages.some((m:any)=>m.itemId==='answer-selection')).toBe(true));
 const message=posts.at(-1).messages.find((m:any)=>m.itemId==='answer-selection');
 expect(message.quoteSource).toMatchObject({backendId:'a',threadId:'side-1',turnId:'turn-live',itemId:'answer-selection'});
 await act(async()=>command('question','draft.set',{contextId,value:'解释这部分',revision:1}));
 const params={contextId,source:message.quoteSource,renderedText:'重复内容，重复内容。 重点 @private-skill',start:5,end:9,text:'重复内容'};
 await act(async()=>command('select-quote','message.quote',params));
 await waitFor(()=>expect(posts.at(-1)?.quotes).toHaveLength(1));
 expect(posts.at(-1).draft).toBe('解释这部分');
 expect(posts.at(-1).quotes[0].text).toBe('重复内容');
 await act(async()=>command('nested-selection','sidechat.quote',params));
 await waitFor(()=>expect(posts.at(-1)?.commandResults.some((r:any)=>r.id==='nested-selection'&&!r.ok)).toBe(true));
 await act(async()=>command('send-selection','message.send',{contextId}));
 await waitFor(()=>expect(boundary.requests.filter(r=>r.method==='turn/start'&&r.params.threadId==='side-1')).toHaveLength(1));
 const input=[...boundary.requests].reverse().find(r=>r.method==='turn/start'&&r.params.threadId==='side-1')!.params.input;
 expect(input[0].text).toContain('重复内容');expect(input[0].text).toContain('<response-annotations>');expect(input[0].text).toContain('解释这部分');
 await waitFor(()=>expect(posts.at(-1).quotes).toEqual([]));
});

it('主聊天与Sidechat往返保留各自草稿，旧选文来源和伪造范围被拒绝', async () => {
 const sideContext=await openSidechatForSend();
 await act(async()=>command('side-draft','draft.set',{contextId:sideContext,value:'分支草稿',revision:1}));
 await act(async()=>command('return-with-draft','sidechat.return',{contextId:sideContext}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async()=>command('main-draft-preserve','draft.set',{contextId:posts.at(-1).contextId,value:'主聊天草稿',revision:1}));
 await act(async()=>command('open-with-draft','sidechat.open',{contextId:posts.at(-1).contextId,id:'side-1'}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('side-1'));
 expect(posts.at(-1).draft).toBe('分支草稿');
 await act(async()=>command('return-main-preserved','sidechat.return',{contextId:posts.at(-1).contextId}));
 await waitFor(()=>expect(posts.at(-1)?.draft).toBe('主聊天草稿'));
});

it('Sidechat失败队列编辑问题时保留冻结引用，重试不读取后续新引用', async()=>{
 const contextId=await openSidechatForSend();
 await act(async()=>boundary.options.onNotification('a',{method:'turn/completed',params:{threadId:'side-1',turn:{id:'quoted-turn',status:'completed',items:[{id:'quoted-answer',type:'agentMessage',text:'冻结的选文 @private-skill'}]}}}));
 await waitFor(()=>expect(posts.at(-1)?.messages.some((m:any)=>m.itemId==='quoted-answer')).toBe(true));
 const source=posts.at(-1).messages.find((m:any)=>m.itemId==='quoted-answer').quoteSource;
 await act(async()=>{command('quote-for-queue','message.quote',{contextId,source,renderedText:'冻结的选文 @private-skill',start:0,end:6,text:'冻结的选文 '});command('queue-question','draft.set',{contextId,value:'原问题',revision:1});});
 boundary.failSend=true;
 await act(async()=>command('fail-quoted-send','message.send',{contextId}));
 await waitFor(()=>expect(posts.at(-1)?.queued).toHaveLength(1));
 const queued=posts.at(-1).queued[0];
 await act(async()=>command('edit-quoted-queue','queue.edit',{contextId,id:queued.id,value:'修改后的问题'}));
 await waitFor(()=>expect(posts.at(-1)?.commandResults.some((r:any)=>r.id==='edit-quoted-queue'&&r.ok)).toBe(true));
 boundary.failSend=false;
 await act(async()=>command('retry-quoted-queue','queue.send',{contextId,id:queued.id}));
 await waitFor(()=>expect(boundary.requests.filter(r=>r.method==='turn/start'&&r.params.threadId==='side-1')).toHaveLength(2));
 const request=boundary.requests.filter(r=>r.method==='turn/start'&&r.params.threadId==='side-1')[1];
 expect(request.params.input[0].text).toContain('冻结的选文');expect(request.params.input[0].text).toContain('修改后的问题');
});

it('没有Sidechat的主聊天托管失败往返后恢复同一引用并复用原入队UUID',async()=>{
 boundary.immediateSend=true;boundary.threadList=[{id:'thread-b',cwd:null,preview:'另一个聊天'},{id:'sent-thread',cwd:null,preview:'主聊天'}];const initial=await setup(true,{projects:[],projectlessThreadIds:['thread-b','sent-thread']});
 await act(async()=>{command('seed-main-q','draft.set',{contextId:initial,value:'启动主聊天',revision:1});command('send-main-q','message.send',{contextId:initial});});
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async()=>boundary.options.onNotification('a',{method:'item/completed',params:{threadId:'sent-thread',turnId:'turn-live',item:{id:'main-quote',type:'agentMessage',text:'托管引用内容'}}}));
 await waitFor(()=>expect(posts.at(-1)?.messages.some((m:any)=>m.itemId==='main-quote')).toBe(true));
 const source=posts.at(-1).messages.find((m:any)=>m.itemId==='main-quote').quoteSource;let contextId=posts.at(-1).contextId;
 await act(async()=>{command('main-quote','message.quote',{contextId,source,renderedText:'托管引用内容',start:0,end:6,text:'托管引用内容'});command('main-queued-question','draft.set',{contextId,value:'托管问题',revision:2});});
 const originalFetch=vi.mocked(fetch).getMockImplementation()!;const enqueues:any[]=[];let reject=true;
 vi.mocked(fetch).mockImplementation(async(...args:Parameters<typeof fetch>)=>{
  const options=args[1];if(String(args[0]).includes('/api/follow-ups')&&options?.body){const action=JSON.parse(String(options.body));if(action.action==='enqueue'){enqueues.push(action);if(reject)throw new TypeError('托管应答丢失');}}
  return originalFetch(...args);
 });
 await act(async()=>command('pending-main-enqueue','message.send',{contextId}));
 await waitFor(()=>expect(posts.at(-1)?.commandResults.some((r:any)=>r.id==='pending-main-enqueue'&&!r.ok)).toBe(true));
 const quoteId=posts.at(-1).quotes[0].id;
 await act(async()=>command('leave-pending-main','thread.open',{backendId:'a',threadId:'thread-b'}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('thread-b'));
 await act(async()=>command('return-pending-main','thread.open',{backendId:'a',threadId:'sent-thread'}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 expect(posts.at(-1).draft).toBe('托管问题');expect(posts.at(-1).quotes?.map((q:any)=>q.id)).toEqual([quoteId]);
 reject=false;contextId=posts.at(-1).contextId;
 await act(async()=>command('retry-original-enqueue','message.send',{contextId}));
 await waitFor(()=>expect(enqueues).toHaveLength(2));
 expect(enqueues[1].id).toBe(enqueues[0].id);expect(enqueues[1].inputText).toBe(enqueues[0].inputText);
});


it('App重建后托管队列仅编辑问题且保留引用全文，不识别引用中的@',async()=>{
 const source=quoteSource('a','queue-main','physical',{id:'item',type:'agentMessage',text:'@private-skill 冻结引用'});
 queueItems=[{id:'persisted-quote',threadId:'queue-main',inputText:quoteInput('原问题',[{id:'q',source,text:'@private-skill 冻结引用'}]),text:'原问题',attachmentCount:0,state:'failed',revision:1}];
 boundary.threadList=[{id:'queue-main',cwd:null,preview:'队列主聊天'}];
 await setup(true,{projects:[],projectlessThreadIds:['queue-main']});cleanup();posts.length=0;
 await setup(true,{projects:[],projectlessThreadIds:['queue-main']});
 await act(async()=>command('open-persisted-queue','thread.open',{backendId:'a',threadId:'queue-main'}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('queue-main'));
 await waitFor(()=>expect(posts.at(-1)?.queued).toHaveLength(1));
 expect(posts.at(-1).queued[0].inputText).toBe('原问题');
 const contextId=posts.at(-1).contextId;
 await act(async()=>command('edit-restored-quote-panel','panel.open',{contextId,id:'queue-edit:persisted-quote'}));
 await waitFor(()=>expect(posts.at(-1)?.panel?.items.some((item:any)=>item.value==='原问题')).toBe(true));
 let edit:any;const originalFetch=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async(...args:Parameters<typeof fetch>)=>{
  if(String(args[0]).includes('/api/follow-ups')&&args[1]?.body){const action=JSON.parse(String(args[1].body));if(action.action==='edit'){edit=action;queueItems=queueItems.map(item=>({...item,inputText:action.inputText,text:action.text,revision:2}));}}
  return originalFetch(...args);
 });
 await act(async()=>command('edit-restored-quote','queue.edit',{contextId,id:'persisted-quote',value:'新问题'}));
 await waitFor(()=>expect(edit).toBeDefined());
 expect(edit.inputText).toContain('@private-skill 冻结引用');expect(edit.inputText).toContain('新问题');expect(edit.inputText).not.toContain('原问题');expect(edit.mentions).toEqual([]);
});

it('有分支的主聊天离开普通聊天再返回恢复既有家族草稿',async()=>{
 boundary.immediateSend=true;boundary.threadList=[{id:'thread-b',cwd:null,preview:'普通B'},{id:'sent-thread',cwd:null,preview:'主A'}];
 const initial=await setup(true,{projects:[],projectlessThreadIds:['thread-b','sent-thread']});
 await act(async()=>{command('family-main-seed','draft.set',{contextId:initial,value:'主任务',revision:1});command('family-main-send','message.send',{contextId:initial});});
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async()=>command('family-create-side','sidechat.create',{contextId:posts.at(-1).contextId}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('side-1'));
 await act(async()=>command('family-return-main','sidechat.return',{contextId:posts.at(-1).contextId}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async()=>command('family-cached-draft','draft.set',{contextId:posts.at(-1).contextId,value:'主A缓存草稿',revision:1}));
 await act(async()=>command('family-open-b','thread.open',{backendId:'a',threadId:'thread-b'}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('thread-b'));
 await act(async()=>command('family-back-a','thread.open',{backendId:'a',threadId:'sent-thread'}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 expect(posts.at(-1).draft).toBe('主A缓存草稿');
});

it('daemon关闭当前Sidechat时清理失效草稿并提示返回主聊天',async()=>{
 const contextId=await openSidechatForSend();
 await act(async()=>command('invalid-side-draft','draft.set',{contextId,value:'失效分支私有草稿',revision:1}));
 await act(async()=>boundary.options.onNotification('a',{method:'thread/closed',params:{threadId:'side-1'}}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 expect(posts.at(-1).draft).not.toBe('失效分支私有草稿');expect(posts.at(-1).quotes).toEqual([]);
 expect(posts.at(-1).error).toContain('失效');
});

it.each([false,true])('主聊天带引用直发跨上下文失败保留源失败队列，confirmed=%s',async(confirmed)=>{
 boundary.immediateSend=true;boundary.threadList=[{id:'thread-b',cwd:null,preview:'新聊天B'},{id:'sent-thread',cwd:null,preview:'源聊天A'}];
 const initial=await setup(true,{projects:[],projectlessThreadIds:['thread-b','sent-thread']});
 await act(async()=>{command('background-seed','draft.set',{contextId:initial,value:'启动A',revision:1});command('background-seed-send','message.send',{contextId:initial});});
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async()=>boundary.options.onNotification('a',{method:'turn/completed',params:{threadId:'sent-thread',turn:{id:'turn-live',status:'completed',items:[{id:'background-answer',type:'agentMessage',text:'不能丢失的引用'}]}}}));
 await waitFor(()=>expect(posts.at(-1)?.messages.some((m:any)=>m.itemId==='background-answer')).toBe(true));
 const contextId=posts.at(-1).contextId;const source=posts.at(-1).messages.find((m:any)=>m.itemId==='background-answer').quoteSource;
 await act(async()=>{command('background-quote','message.quote',{contextId,source,renderedText:'不能丢失的引用',start:0,end:7,text:'不能丢失的引用'});command('background-question','draft.set',{contextId,value:'源问题',revision:2});});
 if(confirmed)boundary.pendingMethod='turn/start';else boundary.immediateSend=false;
 act(()=>command('background-send','message.send',{contextId}));
 if(confirmed)await waitFor(()=>expect(posts.at(-1)?.commandResults.some((r:any)=>r.id==='background-send'&&!r.ok)).toBe(true));
 else await waitFor(()=>expect(boundary.rejectStart).toBeTypeOf('function'));
 await act(async()=>command('background-open-b','thread.open',{backendId:'a',threadId:'thread-b'}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('thread-b'));
 await act(async()=>command('background-new-draft','draft.set',{contextId:posts.at(-1).contextId,value:'新聊天草稿',revision:1}));
 await waitFor(()=>expect(posts.at(-1)?.draft).toBe('新聊天草稿'));
 await act(async()=>{if(confirmed)boundary.options.onNotification('a',{method:'mobile/operation/confirmed',params:{requestId:'pending-sent-thread-turn/start',request:{method:'turn/start',params:{threadId:'sent-thread'}},response:{id:'pending-rpc',error:{code:-32000,message:'确认发送失败'}}}});else boundary.rejectStart!();});
 expect(posts.at(-1).draft).toBe('新聊天草稿');expect(posts.at(-1).queued).toEqual([]);
 await act(async()=>command('background-return-a','thread.open',{backendId:'a',threadId:'sent-thread'}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await waitFor(()=>expect(posts.at(-1)?.queued).toHaveLength(1));
 expect(posts.at(-1).queued[0].inputText).toBe('源问题');
 boundary.pendingMethod='';boundary.immediateSend=true;
 await act(async()=>command('background-retry-source','queue.send',{contextId:posts.at(-1).contextId,id:posts.at(-1).queued[0].id}));
 await waitFor(()=>expect(boundary.requests.filter(r=>r.method==='turn/start'&&r.params.threadId==='sent-thread')).toHaveLength(3));
 const retried=boundary.requests.filter(r=>r.method==='turn/start'&&r.params.threadId==='sent-thread')[2];
 expect(retried.params.input[0].text).toContain('不能丢失的引用');expect(retried.params.input[0].text).toContain('源问题');
});

it('HTTP LAN缺少randomUUID时仍可加入引用、聚焦并创建选文Sidechat发送',async()=>{
 boundary.immediateSend=true;const initial=await setup();
 await act(async()=>{command('lan-seed','draft.set',{contextId:initial,value:'主任务',revision:1});command('lan-seed-send','message.send',{contextId:initial});});
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async()=>boundary.options.onNotification('a',{method:'turn/completed',params:{threadId:'sent-thread',turn:{id:'turn-live',status:'completed',items:[{id:'lan-answer',type:'agentMessage',text:'LAN可选文字'}]}}}));
 await waitFor(()=>expect(posts.at(-1)?.messages.some((m:any)=>m.itemId==='lan-answer')).toBe(true));
 const contextId=posts.at(-1).contextId;const source=posts.at(-1).messages.find((m:any)=>m.itemId==='lan-answer').quoteSource;
 vi.stubGlobal('crypto',{randomUUID:undefined});
 const selection={contextId,source,renderedText:'LAN可选文字',start:0,end:7,text:'LAN可选文字'};
 await act(async()=>command('lan-quote','message.quote',selection));
 await waitFor(()=>expect(posts.at(-1)?.quotes).toHaveLength(1));
 expect(posts.at(-1).quoteFocusToken).toBeTruthy();const mainToken=posts.at(-1).quoteFocusToken;
 await act(async()=>command('lan-side-quote','sidechat.quote',selection));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('side-1'));
 expect(posts.at(-1).quoteFocusToken).toBeTruthy();expect(posts.at(-1).quoteFocusToken).not.toBe(mainToken);
 const sideContext=posts.at(-1).contextId;
 await act(async()=>{command('lan-side-question','draft.set',{contextId:sideContext,value:'解释引用',revision:1});command('lan-side-send','message.send',{contextId:sideContext});});
 await waitFor(()=>expect(boundary.requests.some(r=>r.method==='turn/start'&&r.params.threadId==='side-1')).toBe(true));
});

it('Sidechat新建普通对话后返回保留最新文字引用附件且不撤销文件URL',async()=>{
 const contextId=await openSidechatForSend();const BaseURL=URL;const revoke=vi.fn();
 vi.stubGlobal('URL',class extends BaseURL{static createObjectURL(){return 'blob:new-chat-family';}static revokeObjectURL(url:string){revoke(url);}});
 await act(async()=>boundary.options.onNotification('a',{method:'turn/completed',params:{threadId:'side-1',turn:{id:'side-source',status:'completed',items:[{id:'side-answer',type:'agentMessage',text:'分支引用'}]}}}));
 await waitFor(()=>expect(posts.at(-1)?.messages.some((m:any)=>m.itemId==='side-answer')).toBe(true));
 const source=posts.at(-1).messages.find((m:any)=>m.itemId==='side-answer').quoteSource;
 await act(async()=>{command('newchat-family-text','draft.set',{contextId,value:'离开分支前最新草稿',revision:1});command('newchat-family-quote','message.quote',{contextId,source,renderedText:'分支引用',start:0,end:4,text:'分支引用'});command('newchat-family-file','attachment.import',{contextId,items:[{name:'source.txt',type:'text/plain',data:btoa('file')}]});});
 await waitFor(()=>expect(posts.at(-1)?.attachments).toHaveLength(1));
 const quoteId=posts.at(-1).quotes[0].id;
 await act(async()=>command('family-new-normal','thread.new',{backendId:'a',cwd:''}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBeUndefined());
 expect(revoke).not.toHaveBeenCalledWith('blob:new-chat-family');
 await act(async()=>command('family-new-return-main','thread.open',{backendId:'a',threadId:'sent-thread'}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async()=>command('family-new-reopen-side','sidechat.open',{contextId:posts.at(-1).contextId,id:'side-1'}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('side-1'));
 expect(posts.at(-1).draft).toBe('离开分支前最新草稿');expect(posts.at(-1).quotes.map((q:any)=>q.id)).toEqual([quoteId]);expect(posts.at(-1).attachments).toHaveLength(1);
});

it.each([false,true])('托管ACK消费源家族缓存且保留上传期间新编辑，newEdits=%s',async(newEdits)=>{
 const sideContext=await openSidechatForSend();
 await act(async()=>command('host-family-return','sidechat.return',{contextId:sideContext}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));const contextId=posts.at(-1).contextId;
 const BaseURL=URL;const revoke=vi.fn();vi.stubGlobal('URL',class extends BaseURL{static createObjectURL(){return 'blob:host-family';}static revokeObjectURL(url:string){revoke(url);}});
 await act(async()=>boundary.options.onNotification('a',{method:'turn/started',params:{threadId:'sent-thread',turn:{id:'host-running',status:'inProgress',items:[{id:'host-answer',type:'agentMessage',text:'托管中的引用'}]}}}));
 await waitFor(()=>expect(posts.at(-1)?.messages.some((m:any)=>m.itemId==='host-answer')).toBe(true));
 const source=posts.at(-1).messages.find((m:any)=>m.itemId==='host-answer').quoteSource;
 const selection={contextId,source,renderedText:'托管中的引用',start:0,end:6,text:'托管中的引用'};
 await act(async()=>{command('host-family-draft','draft.set',{contextId,value:'将入队的问题',revision:1});command('host-family-quote','message.quote',selection);command('host-family-file','attachment.import',{contextId,items:[{name:'host.txt',type:'text/plain',data:btoa('file')}]});});
 await waitFor(()=>expect(posts.at(-1)?.attachments).toHaveLength(1));
 const originalFetch=vi.mocked(fetch).getMockImplementation()!;let acknowledge!:(()=>void);
 vi.mocked(fetch).mockImplementation(async(...args:Parameters<typeof fetch>)=>{
  if(String(args[0]).includes('/api/uploads/file'))return new Response(JSON.stringify({path:'/tmp/host.txt',name:'host.txt',type:'text/plain',size:4}));
  if(String(args[0]).includes('/api/follow-ups')&&args[1]?.body){const action=JSON.parse(String(args[1].body));if(action.action==='enqueue')return new Promise(resolve=>{acknowledge=()=>{queueItems.push({...action,revision:1,state:'queued'});resolve(new Response(JSON.stringify({items:queueItems})));};});}
  return originalFetch(...args);
 });
 act(()=>command('host-family-send','message.send',{contextId}));await waitFor(()=>expect(acknowledge).toBeTypeOf('function'));
 let nextQuoteId:string|undefined;
 if(newEdits){await act(async()=>{command('host-family-new-text','draft.set',{contextId,value:'上传期间新问题',revision:2});command('host-family-new-quote','message.quote',selection);});await waitFor(()=>expect(posts.at(-1)?.quotes).toHaveLength(2));nextQuoteId=posts.at(-1).quotes[1].id;}
 await act(async()=>command('host-family-open-side','sidechat.open',{contextId,id:'side-1'}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('side-1'));
 await act(async()=>acknowledge());
 await waitFor(()=>expect(posts.at(-1)?.commandResults.some((r:any)=>r.id==='host-family-send'&&r.ok)).toBe(true));
 await act(async()=>command('host-family-return-main','sidechat.return',{contextId:posts.at(-1).contextId}));
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 expect(posts.at(-1).draft).toBe(newEdits?'上传期间新问题':'');expect(posts.at(-1).attachments).toEqual([]);expect(posts.at(-1).quotes.map((q:any)=>q.id)).toEqual(newEdits?[nextQuoteId]:[]);expect(revoke).toHaveBeenCalledWith('blob:host-family');
});


it('历史编辑仅修改引用封装的问题，不激活引用内skill/plugin',async()=>{
 boundary.immediateSend=true;boundary.quoteCatalog=true;const initial=await setup();
 const source=quoteSource('a','sent-thread','quoted-source',{id:'quoted-item',type:'agentMessage',text:'$private-skill @private-plugin'});
 const quotes=[{id:'history-quote',source,text:'$private-skill @private-plugin'}];const original=quoteInput('原问题',quotes);
 await act(async()=>{command('history-quote-seed','draft.set',{contextId:initial,value:original,revision:1});command('history-quote-seed-send','message.send',{contextId:initial});});
 await waitFor(()=>expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async()=>boundary.options.onNotification('a',{method:'turn/completed',params:{threadId:'sent-thread',turn:{id:'turn-live',status:'completed',items:[{id:'history-source',type:'userMessage',content:[{type:'text',text:original}]}]}}}));
 await waitFor(()=>expect(posts.at(-1)?.busy).toBe(false));
 await waitFor(()=>expect(boundary.requests.some(r=>r.method==='plugin/installed')).toBe(true));
 await act(async()=>command('history-quote-catalog-check','draft.set',{contextId:initial,value:'@',revision:2}));
 await waitFor(()=>expect(posts.at(-1)?.mentions.some((m:any)=>m.title==='private-plugin')).toBe(true));
 await act(async()=>command('history-quote-edit','message.edit',{contextId:initial,turnId:'turn-live',messageId:'history-source'}));
 await waitFor(()=>expect(posts.at(-1)?.messages.some((m:any)=>m.historyEdit)).toBe(true));
 const editKey='sent-thread:turn-live:history-source';const edited='修改后的问题';
 await act(async()=>{command('history-quote-change','history.change',{contextId:initial,editKey,value:edited});command('history-quote-submit','history.submit',{contextId:initial,editKey});});
 await waitFor(()=>expect(boundary.requests.filter(r=>r.method==='turn/start'&&r.params.threadId==='sent-thread')).toHaveLength(2));
 const input=boundary.requests.filter(r=>r.method==='turn/start'&&r.params.threadId==='sent-thread')[1].params.input;
 expect(input.find((part:any)=>part.type==='text')?.text).toContain('$private-skill @private-plugin');
 expect(input.some((part:any)=>part.type==='skill'||part.type==='mention')).toBe(false);
});
