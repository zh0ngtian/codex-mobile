import { renderHook, cleanup } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createWorkspaceAdapter, useNativeConversationAdapter, type NativeWorkspaceController } from '../../src/native-ui/workspace-adapter';
function controller(overrides: Partial<NativeWorkspaceController> = {}): NativeWorkspaceController {
 return { backend: { id: 'b', name: 'Mac', token: 'SECRET', baseUrl: 'https://gateway.invalid', enabled: true, order: 0 },
 active: { id: 't', name: '真实会话', turns: [] }, contextId: 'b:t:1', connection: 'online', draft: '输入', draftImages: [], draftFiles: [], busy: true, readOnly: false,
 imageReading: false, draftSaving: false, pending: false, models: [{ model: 'm', displayName: 'Model' }], selectedModel: 'm', selectedModelLabel: 'Model',
 effortOptions: [{ id: 'high', label: '高' }], selectedEffort: 'high', permission: '工作区', skills: [], plugins: [], queued: [], approvalCount: 0,
 loadState: 'ready', olderTurnsState: 'idle', error: '', setDraft() {}, send: async () => {}, stop: async () => {}, chooseModel() {}, chooseEffort() {},
 removeAttachment() {}, selectFiles: async () => {}, selectLocation: async () => true, saveDraft: async () => {}, retry() {}, loadOlder: async () => true,
 editMessage() {}, cancelQueued: async () => {}, sendQueued: async () => {}, editQueued: async () => true,
 ...overrides };
}
describe('核心会话controller适配', () => {
 it('忙碌中仍可发送并暴露独立停止，所有回调走现有controller且无设备凭证进入快照', async () => {
  const activity: string[] = []; const adapter = createWorkspaceAdapter(controller({ send: async () => { activity.push('queue'); }, stop: async () => { activity.push('stop'); } }), { panelId: null, query: '', setPanel() {}, setQuery() {} });
  expect(adapter.snapshot.canSend).toBe(true); expect(adapter.snapshot.canInterrupt).toBe(true);
  await adapter.handlers['message.send']!({}); await adapter.handlers['turn.stop']!({}); expect(activity).toEqual(['queue', 'stop']);
  expect(JSON.stringify(adapter.snapshot)).not.toContain('SECRET'); expect(JSON.stringify(adapter.snapshot)).not.toContain('baseUrl');
 });
 it('真实模型参数校验、附件取消保留输入、错误透传与草稿保存均可调用', async () => {
  const changes: string[] = []; const c = controller({ chooseModel: value => { changes.push(value); }, selectFiles: async files => { changes.push(files[0]?.name ?? 'empty'); }, saveDraft: async () => { changes.push('saved'); } });
  const { handlers } = createWorkspaceAdapter(c, { panelId: null, query: '', setPanel() {}, setQuery() {} });
  await expect(Promise.resolve().then(() => handlers['model.select']!({ value: 'invalid' }))).rejects.toThrow();
  await handlers['model.select']!({ value: 'm' }); await handlers['draft.save']!({});
  expect(changes).toEqual(['m', 'saved']);
 });
 it('真实目录搜索与Skill插入回写现有草稿setter', () => {
  let text = ''; const c = controller({ draft: '请 @sw', skills: [{ name: 'swift', path: '/skills/swift', description: 'Swift', enabled: true, scope: 'user' }], setDraft: value => { text = value; } });
  const adapter = createWorkspaceAdapter(c, { panelId: 'mentions', query: 'swift', setPanel() {}, setQuery() {} });
  expect(adapter.snapshot.panel?.items.some(item => item.title === 'swift')).toBe(true);
  adapter.handlers['mention.insert']!({ id: 'skill:/skills/swift' }); expect(text).toBe('请 $swift ');
 });
});

it('草稿保存失败返回关联错误，已有线程不暴露保存新对话草稿空操作', async () => {
 const panel = { panelId: null, query: '', setPanel() {}, setQuery() {} };
 const adapter = createWorkspaceAdapter(controller({ active: { id: '', turns: [] }, saveDraft: async () => false }), panel);
 await expect(adapter.handlers['draft.save']!({})).rejects.toThrow();
 const existing = createWorkspaceAdapter(controller(), panel);
 expect(existing.snapshot.conversationActions?.some(item => item.command?.name === 'draft.save')).toBe(false);
});

it('输入光标处的@建议使用真实目录，插入只替换光标前mention且保留尾部正文并回显光标', () => {
 let text = ''; let caret = 0;
 const c = controller({ draft: '前 @sw 后文', caretOffset: 5, skills: [{ name: 'swift', path: '/swift', description: 'Swift', enabled: true, scope: 'user' }],
  setDraft: (value, _revision, nextCaret) => { text = value; caret = nextCaret!; } });
 const adapter = createWorkspaceAdapter(c, { panelId: null, query: '', setPanel() {}, setQuery() {} });
 expect(adapter.snapshot.mentions?.map(option => option.id)).toEqual(['skill:/swift']);
 adapter.handlers['mention.insert']!({ id: 'skill:/swift' });
 expect(text).toBe('前 $swift  后文'); expect(caret).toBe(9);
});

it('系统剪贴板拒绝时回执错误，不声称复制成功', async () => {
 const adapter = createWorkspaceAdapter(controller({ active: { id: 't', turns: [{ id: 'turn', items: [{ id: 'u', type: 'userMessage', content: [{ type: 'text', text: '完整文字' }] }] }] } }), { panelId: null, query: '', setPanel() {}, setQuery() {} });
 await expect(adapter.handlers['message.copy']!({ id: 'turn:u' })).rejects.toThrow('复制失败');
});

it('默认网页模式不重复计算原生会话投影', () => {
 const c = controller();
 Object.defineProperty(c, 'active', { get() { throw new Error('不应读取原生投影数据'); } });
 expect(() => renderHook(() => useNativeConversationAdapter(null, c))).not.toThrow();
 cleanup();
});

it('会话快照中的递归动作绑定创建上下文，旧面板动作不能被补成新会话命令', () => {
 const c = controller({ active: { id: 't', turns: [{ id: 'turn', status: 'completed', items: [
  { id: 'u', type: 'userMessage', content: [{ type: 'text', text: '用户' }] },
  { id: 'tool', type: 'commandExecution', command: 'ls' },
 ] }] } });
 const { snapshot } = createWorkspaceAdapter(c, { panelId: 'mentions', query: '', setPanel() {}, setQuery() {} });
 const commands: any[] = [];
 const visit = (value: any) => { if (!value || typeof value !== 'object') return; if (value.command) commands.push(value.command); for (const child of Object.values(value)) if (child !== value.command) Array.isArray(child) ? child.forEach(visit) : visit(child); };
 visit(snapshot);
 expect(commands.length).toBeGreaterThan(3);
 expect(commands.every(command => command.params.contextId === 'b:t:1')).toBe(true);
});

it('原图资源URL保留现有token/path鉴权参数并移除thumbnail，不把640像素缩略图当原图', () => {
 const adapter = createWorkspaceAdapter(controller({ active: { id: 't', turns: [{ id: 'turn', items: [{ id: 'u', type: 'userMessage', content: [{ type: 'localImage', path: '/tmp/原图.png' }] }] }] } }), { panelId: null, query: '', setPanel() {}, setQuery() {} });
 const image = adapter.snapshot.messages[0].blocks![0];
 expect(new URL(image.value!).searchParams.get('thumbnail')).toBe('1');
 expect(image.previewURL).toBeTypeOf('string');
 const original = new URL(image.previewURL!);
 expect(original.searchParams.has('thumbnail')).toBe(false);
 expect(original.searchParams.get('token')).toBe('SECRET');
 expect(original.searchParams.get('path')).toBe('/tmp/原图.png');
});

it('扩展工作区面板显示真实服务档位权限与项目且校验目录', async () => {
 const calls: unknown[] = []; const c = controller({ active: { id: '', cwd: '/app', turns: [] }, extended: { state: {
 speedOptions: [{ id: null, label: '正常' }, { id: 'fast', label: '快速' }], selectedServiceTier: null,
 permissionModes: [{ id: 'full-access', label: '完全访问权限', description: '允许执行' }], selectedPermissionModeId: 'full-access',
 projectOptions: ['/app'], backends: [{ id: 'b', name: 'Mac', enabled: true, token: 'NOLEAK' }], activeThreadAccessMode: 'interactive',
 tokenUsage: { total: { totalTokens: 123 } }, rateLimits: { primary: { usedPercent: 25 } }, pendingAction: 'saving',
 }, callbacks: { chooseSpeed: v => calls.push(v), choosePermissionMode: v => calls.push(v), chooseNewChatProject: v => calls.push(v) } } });
 const a = createWorkspaceAdapter(c, { panelId: 'workspace', query: '', setPanel() {}, setQuery() {} });
 expect(a.snapshot.panel?.items.some(i => i.id === 'speed')).toBe(true);
 expect(JSON.stringify(a.snapshot.panel)).toContain('123'); expect(JSON.stringify(a.snapshot.panel)).not.toContain('NOLEAK');
 await a.handlers['speed.select']!({ value: 'fast' }); await a.handlers['permission.select']!({ value: 'full-access' });
 await expect(Promise.resolve().then(() => a.handlers['speed.select']!({ value: 'bogus' }))).rejects.toThrow();
 expect(calls).toEqual(['fast', 'full-access']);
});

it('审批面板保留所有问题与secret并阻止过期请求和无效decision', async () => {
 const calls: unknown[] = []; const request = { id: 9, method: 'item/tool/requestUserInput', params: { questions: [
 { id: 'q', header: '密码', question: '请输入密码', isSecret: true, isOther: true, options: [{ label: 'A', description: '选项 A' }] },
 ] } };
 const c = controller({ extended: { state: { approval: request, requests: [request], userAnswers: {}, approvalSubmitting: false }, callbacks: { answerApproval: (...v) => calls.push(v), replyToRequest: v => calls.push(v) } } });
 const a = createWorkspaceAdapter(c, { panelId: 'approval', query: '', setPanel() {}, setQuery() {} });
 expect(JSON.stringify(a.snapshot.panel)).toContain('secureField');
 expect(a.snapshot.panel?.items.find(i => i.id === 'approval-submit')?.disabled).toBe(true);
 await expect(Promise.resolve().then(() => a.handlers['approval.answer']!({ requestKey: 'number:8', questionId: 'q', value: 'late' }))).rejects.toThrow();
 await a.handlers['approval.answer']!({ requestKey: 'number:9', questionId: 'q', value: 'secret' }); expect(calls).toEqual([['q', 'secret']]);
 const command = { id: 10, method: 'item/commandExecution/requestApproval', params: { availableDecisions: ['decline', { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git'] } }] } };
 c.extended!.state.approval = command;
 const b = createWorkspaceAdapter(c, { panelId: 'approval', query: '', setPanel() {}, setQuery() {} });
 await b.handlers['approval.decide']!({ requestKey: 'number:10', index: 1 });
 expect(calls[1]).toEqual({ decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git'] } } });
 await expect(Promise.resolve().then(() => b.handlers['approval.decide']!({ requestKey: 'number:10', index: 20 }))).rejects.toThrow();
});

it('历史编辑使用原编辑状态并要求显式删除后续确认，队列不确定取消同样确认', async () => {
 const calls: string[] = []; let shown: string | null = null;
 const c = controller({ readOnly: true, queued: [{ id: 'q', text: '待确认', state: 'uncertain', hosted: true }], extended: { state: {
 historyEdit: { threadId: 't', text: '修改', submitting: false, target: { turnId: 'turn', messageId: 'msg', rollbackTurnCount: 2, hasLaterTurns: true, input: [{ type: 'localImage', path: '/a.png' }] } },
 }, callbacks: { submitHistoricalMessageEdit: () => calls.push('submit'), changeHistoricalMessageEditText: (v: string) => calls.push(v) } }, cancelQueued: async (_id: string, confirmed?: boolean) => { if (confirmed) calls.push('cancel'); } } as any);
 const a = createWorkspaceAdapter(c, { panelId: null, query: '', setPanel: id => { shown = id; }, setQuery() {} });
 expect(a.snapshot.panel?.id).toBe('history-edit:t:turn:msg');
 await a.handlers['history.change']!({ value: '新文', editKey: 't:turn:msg' });
 await a.handlers['history.submit']!({ editKey: 't:turn:msg' }); expect(calls).toEqual(['新文']); expect(shown).toBe('confirm-history');
 await a.handlers['history.submit']!({ editKey: 't:turn:msg', confirmed: true }); expect(calls).toEqual(['新文', 'submit']);
 await a.handlers['queue.cancel']!({ id: 'q' }); expect(shown).toBe('confirm-queue:q');
 await a.handlers['queue.cancel']!({ id: 'q', confirmed: true }); expect(calls).toContain('cancel');
});

it('审批和历史编辑使用身份隔离原生字段缓存并保持真实input附件', () => {
 const c = controller({ extended: { state: { approval: { id: 1, method: 'item/tool/requestUserInput', params: { questions: [] } } }, callbacks: {} } });
 const state = { panelId: 'approval', query: '', setPanel() {}, setQuery() {} };
 expect(createWorkspaceAdapter(c, state).snapshot.panel?.id).toBe('approval:number:1');
 c.extended!.state.approval = { id: 2, method: 'item/tool/requestUserInput', params: { questions: [] } };
 expect(createWorkspaceAdapter(c, state).snapshot.panel?.id).toBe('approval:number:2');
 c.extended!.state = { historyEdit: { threadId: 't', text: '', submitting: true, target: { turnId: 'turn', messageId: 'm', input: [{ type: 'localImage', path: '/tmp/a.png' }], attachmentCount: 1 } } };
 const panel = createWorkspaceAdapter(c, { ...state, panelId: null }).snapshot.panel!;
 expect(panel.id).toBe('history-edit:t:turn:m'); expect(panel.dismissible).toBe(false); expect(JSON.stringify(panel)).toContain('/tmp/a.png');
});
it('队列投影保留引导、重试、待确认状态并禁用发送中的修改取消', () => {
 const c = controller({ busy: true, extended: { state: { steerable: true, steering: false, queueSaving: false }, callbacks: {} }, queued: [
 { id: 'q', text: '排队', state: 'queued' }, { id: 's', text: '发送', state: 'sending' }, { id: 'u', text: '待确认', state: 'uncertain' },
 ] });
 const entries = createWorkspaceAdapter(c, { panelId: null, query: '', setPanel() {}, setQuery() {} }).snapshot.queued;
 expect(entries[0].subtitle).toContain('改为引导'); expect(entries[1].actions?.find(a => a.command?.name === 'queue.cancel')?.disabled).toBe(true);
 expect(entries[2].command).toBeUndefined();
});
it('审批提交从同一业务拥有者读取已接受但尚未render的最新回答，旧请求不能写入新问题', async () => {
 let live: any = { request: { id: 1, method: 'item/tool/requestUserInput', params: { questions: [{ id: 'q', question: '问题', header: '问题', isOther: true, options: [] }] } }, answers: { q: '旧答案' }, submitting: false }; const replies: any[] = [];
 const c = controller({ extended: { state: { approval: live.request, requests: [live.request], userAnswers: { q: '旧答案' } }, callbacks: { currentApproval: () => live, answerApproval: (id: string, value: string) => { live.answers[id] = value; }, replyToRequest: (v: any) => replies.push(v) } } });
 const a = createWorkspaceAdapter(c, { panelId: 'approval', query: '', setPanel() {}, setQuery() {} });
 await a.handlers['approval.answer']!({ requestKey: 'number:1', questionId: 'q', value: '新答案' });
 await a.handlers['approval.submit']!({ requestKey: 'number:1' }); expect(replies[0]).toEqual({ answers: { q: { answers: ['新答案'] } } });
 live = { ...live, request: { ...live.request, id: 2 } };
 await expect(Promise.resolve().then(() => a.handlers['approval.answer']!({ requestKey: 'number:1', questionId: 'q', value: '迟到答案' }))).rejects.toThrow();
 expect(live.answers.q).toBe('新答案');
});
it('自定义secret答案不作为Picker值或option暴露，用其他选项哨兵保持合法选择', () => {
 const request = { id: 1, method: 'item/tool/requestUserInput', params: { questions: [{ id: 'q', question: '输入', header: '输入', isSecret: true, isOther: true, options: [{ label: 'A', description: '说明' }] }] } };
 const c = controller({ extended: { state: { approval: request, userAnswers: { q: 'TOPSECRET' } }, callbacks: {} } });
 const panel = createWorkspaceAdapter(c, { panelId: 'approval', query: '', setPanel() {}, setQuery() {} }).snapshot.panel!;
 const option = panel.items[0].children?.find(i => i.kind === 'singleChoice')!;
 expect(option.value).not.toBe('TOPSECRET'); expect(option.options?.some(o => o.value === option.value)).toBe(true); expect(JSON.stringify(option.options)).not.toContain('TOPSECRET');
 expect(panel.items[0].children?.find(i => i.kind === 'secureField')?.value).toBe('TOPSECRET');
});
it('会话状态面板保留线程ID目录和真实上下文剩余量', () => {
 const c = controller({ active: { id: 'thread-id', cwd: '/app/project', turns: [] }, extended: { state: { tokenUsage: { last: { totalTokens: 20 }, total: { totalTokens: 500 }, modelContextWindow: 100 }, activeThreadAccessMode: 'interactive' }, callbacks: {} } });
 const panel = createWorkspaceAdapter(c, { panelId: 'workspace', query: '', setPanel() {}, setQuery() {} }).snapshot.panel!;
 expect(JSON.stringify(panel)).toContain('thread-id'); expect(JSON.stringify(panel)).toContain('/app/project'); expect(JSON.stringify(panel)).toContain('80%');
});
it('重命名和队列字段连续编辑保存不会消费上次render的旧值', async () => {
 const { NativeRuntime } = await import('../../src/native-ui/runtime'); const calls: any[] = [];
 const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 const c = controller({ queued: [{ id: 'q', inputText: '旧队列', text: '旧队列' }], editQueued: async (_id, value) => { calls.push(value); return true; }, extended: { state: {}, callbacks: { renameThread: (name: string) => { calls.push(name); return true; } } } });
 renderHook(() => useNativeConversationAdapter(runtime, c));
 const send = (id: string, name: string, params = {}) => runtime.dispatch({ id, name, params: { ...params, contextId: c.contextId } });
 const { act } = await import('@testing-library/react');
 await act(async () => { await send('queue-panel', 'panel.open', { id: 'queue-edit:q' }); });
 await act(async () => { const change = send('queue-change-fast', 'queue.change', { id: 'q', value: '最新队列' }); const save = send('queue-save-fast', 'queue.edit', { id: 'q' }); await change; await save; });
 expect(calls[0]).toBe('最新队列');
 await act(async () => { await send('rename-panel', 'workspace.thread', { action: 'rename' }); });
 await act(async () => { const change = send('rename-change-fast', 'workspace.rename.change', { value: '最新名称' }); const save = send('rename-save-fast', 'workspace.rename.submit'); await change; await save; });
 expect(calls[1]).toBe('最新名称'); runtime.dispose(); cleanup();
});
it('旧会话队列编辑异步完成不能关闭新会话已打开的面板', async () => {
 const { NativeRuntime } = await import('../../src/native-ui/runtime'); const { act } = await import('@testing-library/react');
 const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 let finish!: (v: boolean) => void; let c = controller({ queued: [{ id: 'q', inputText: '旧', text: '旧' }], editQueued: () => new Promise(resolve => { finish = resolve; }) });
 const { rerender } = renderHook(() => useNativeConversationAdapter(runtime, c));
 let pending!: Promise<unknown>; act(() => { pending = runtime.dispatch({ id: 'old-edit', name: 'queue.edit', params: { contextId: c.contextId, id: 'q', value: '编辑' } }); });
 c = controller({ contextId: 'new-context' }); rerender();
 await act(async () => { await runtime.dispatch({ id: 'new-panel', name: 'panel.open', params: { contextId: 'new-context', id: 'mentions' } }); });
 expect(runtime.snapshot().panel?.id).toBe('mentions');
 await act(async () => { finish(true); await pending; }); expect(runtime.snapshot().panel?.id).toBe('mentions'); runtime.dispose(); cleanup();
});
it.each(['item/commandExecution/requestApproval', 'item/tool/requestUserInput'])('设备级%s面板明确显示目标会话而不误认active会话', method => {
 const request = { id: 7, method, params: { threadId: 'other-thread', questions: [] } };
 const c = controller({ active: { id: 'active-thread', name: '当前会话', turns: [] }, extended: { state: { approval: request, approvalThreadTitle: '另一个会话', userAnswers: {} }, callbacks: {} } });
 const panel = createWorkspaceAdapter(c, { panelId: 'approval', query: '', setPanel() {}, setQuery() {} }).snapshot.panel!;
 expect(JSON.stringify(panel.items)).toContain('other-thread'); expect(JSON.stringify(panel.items)).toContain('另一个会话');
});
it('审批成功与历史提交、队列移除真实rerender后不保留空瞬态sheet，下个审批仍可见', async () => {
 const { NativeRuntime } = await import('../../src/native-ui/runtime'); const { useApprovalRequests } = await import('../../src/features/approvals/useApprovalRequests'); const { useState } = await import('react'); const { act } = await import('@testing-library/react');
 const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 let resolveHistory!: () => void; let removeQueue!: () => void;
 const { result } = renderHook(() => {
  const approvals = useApprovalRequests(); const [historyEdit, setHistoryEdit] = useState<any>(null); const [queued, setQueued] = useState<any[]>([]);
  resolveHistory = () => setHistoryEdit({ threadId: 't', text: '修改', submitting: false, target: { turnId: 'turn', messageId: 'm', hasLaterTurns: true, rollbackTurnCount: 2 } });
  removeQueue = () => setQueued([{ id: 'q', state: 'uncertain', text: '待确认' }]);
  useNativeConversationAdapter(runtime, controller({ queued, cancelQueued: async () => setQueued([]), approvalCount: approvals.requests.length, extended: { state: { approval: approvals.approval, userAnswers: approvals.userAnswers, historyEdit }, callbacks: { replyToRequest: (value: unknown) => approvals.submit(value, { respond: async () => {} }, () => {}, approvals.approval ?? undefined), submitHistoricalMessageEdit: () => setHistoryEdit(null) } } }));
  return approvals;
 });
 await act(async () => { result.current.receive({ id: 1, method: 'item/commandExecution/requestApproval' }); await runtime.dispatch({ id: 'approval-open', name: 'panel.open', params: { contextId: 'b:t:1', id: 'approval' } }); });
 await act(async () => { await runtime.dispatch({ id: 'approval-finish', name: 'approval.decide', params: { contextId: 'b:t:1', requestKey: 'number:1', index: 0 } }); }); expect(runtime.snapshot().panel).toBeUndefined();
 await act(async () => { result.current.receive({ id: 2, method: 'item/commandExecution/requestApproval' }); }); expect(runtime.snapshot().panel?.id).toBe('approval:number:2');
 await act(async () => { await runtime.dispatch({ id: 'approval-next-finish', name: 'approval.decide', params: { contextId: 'b:t:1', requestKey: 'number:2', index: 0 } }); resolveHistory(); await runtime.dispatch({ id: 'history-open', name: 'panel.open', params: { contextId: 'b:t:1', id: 'history-edit' } }); });
 await act(async () => { await runtime.dispatch({ id: 'history-confirm', name: 'history.submit', params: { contextId: 'b:t:1', editKey: 't:turn:m' } }); }); expect(runtime.snapshot().panel?.id).toBe('confirm-history:t:turn:m');
 await act(async () => { await runtime.dispatch({ id: 'history-done', name: 'history.submit', params: { contextId: 'b:t:1', editKey: 't:turn:m', confirmed: true } }); }); expect(runtime.snapshot().panel).toBeUndefined();
 await act(async () => { removeQueue(); }); await act(async () => { await runtime.dispatch({ id: 'queue-warning', name: 'queue.cancel', params: { contextId: 'b:t:1', id: 'q' } }); }); expect(runtime.snapshot().panel?.id).toBe('confirm-queue:q');
 await act(async () => { await runtime.dispatch({ id: 'queue-done', name: 'queue.cancel', params: { contextId: 'b:t:1', id: 'q', confirmed: true } }); }); expect(runtime.snapshot().panel).toBeUndefined(); runtime.dispose(); cleanup();
});
