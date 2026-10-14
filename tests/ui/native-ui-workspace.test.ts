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
