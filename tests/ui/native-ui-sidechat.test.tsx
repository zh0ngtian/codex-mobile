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
   if (method === 'mobile/sidechat/rpc') { method = params.method; params = params.params; }
   boundary.requests.push({ method, params });
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

it('Sidechat入队前已失效时保留正文', async () => {
 const contextId=await openSidechatForSend();
 await act(async()=>{command('draft-reject','draft.set',{contextId,value:'还没入队的正文',revision:1});boundary.options.onNotification('a',{method:'thread/closed',params:{threadId:'side-1'}});});
 await act(async()=>command('send-unavailable','message.send',{contextId}));
 await waitFor(()=>expect(posts.at(-1)?.commandResults?.some((r:any)=>r.id==='send-unavailable'&&!r.ok)).toBe(true));
 expect(posts.at(-1).draft).toBe('还没入队的正文');
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
 expect(boundary.requests.find(r=>r.method==='turn/start'&&r.params.threadId==='side-1')?.params.input[0].text).toBe('先发送的正文');
});
