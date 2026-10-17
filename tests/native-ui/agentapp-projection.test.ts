import { describe, expect, it } from 'vitest';
import { aggregateThreads } from '../../src/features/threads/thread-list-model';
import { projectConversation, projectNavigation } from '../../src/native-ui/projection';
import { projectNativeBackends, projectNativePreferences } from '../../src/native-ui/device-panel';
import { bindWorkspaceCommands, createWorkspaceAdapter, type NativeWorkspaceController } from '../../src/native-ui/workspace-adapter';
import { NativeRuntime } from '../../src/native-ui/runtime';
import { emptyNativeSnapshot } from '../../src/native-ui/protocol';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateNativeAttachmentImport } from '../../src/native-ui/attachment-import';

const panel = { panelId: null, query: '', setPanel() {}, setQuery() {} };
function controller(overrides: Partial<NativeWorkspaceController> = {}): NativeWorkspaceController {
  return { backend: { id: 'b', name: '设备', token: 'PRIVATE_TOKEN', baseUrl: 'https://gateway.invalid', enabled: true, order: 0 },
    active: { id: 't', name: '真实对话', turns: [] }, contextId: 'b:t:1', connection: 'online', draft: '', draftImages: [], draftFiles: [], busy: false, readOnly: false,
    imageReading: false, draftSaving: false, pending: false, models: [], selectedModel: '', selectedModelLabel: '模型', effortOptions: [], selectedEffort: null, permission: '', skills: [], plugins: [], queued: [], approvalCount: 0,
    loadState: 'ready', olderTurnsState: 'exhausted', error: '', setDraft() {}, send: async () => {}, stop: async () => {}, chooseModel() {}, chooseEffort() {}, removeAttachment() {}, selectFiles: async () => {}, selectLocation: async () => true, saveDraft: async () => {}, retry() {}, loadOlder: async () => true, editMessage() {}, cancelQueued: async () => {}, sendQueued: async () => {}, editQueued: async () => true, ...overrides };
}

describe('AgentApp 真实展示契约', () => {
  it.skipIf(process.platform !== 'darwin')('Swift DTO 解码真实展示字段并无损往返', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentapp-projection-'));
    try {
      const names = ['NativeJSONValue', 'NativeCommand', 'NativeCommandResult', 'NativeOption', 'NativeBackend', 'NativeNavigationItem', 'NativeGroup', 'NativeAttachment', 'NativeMessage', 'NativePanelItem', 'NativePanel', 'NativeContextUsage', 'NativeRateLimit', 'NativeSnapshot'];
      const executable = join(directory, 'decode');
      const compile = spawnSync('xcrun', ['swiftc', ...names.map(name => `mobile/ios/NativeUI/${name}.swift`), 'tests/ci/agent-ui-projection-decode.swift', '-o', executable], { encoding: 'utf8', timeout: 180000 });
      expect(compile.status, compile.error?.message ?? compile.stderr).toBe(0);
      const input = { ...emptyNativeSnapshot(), backends: [{ id: 'b', title: '设备', gatewayAddress: 'https://gateway.invalid', enabled: false, projects: ['/项目'] }],
        groups: [{ id: 'b:/项目', title: '项目', items: [], backendId: 'b', allItems: [{ id: 'b:t', title: '对话', threadId: 't', cwd: '/项目', isPinned: true }] }],
        queued: [{ id: 'q', title: '排队', queueState: 'uncertain', attachmentCount: 2 }], attachments: [{ id: 'a', name: 'file.txt', size: 42 }],
        tokenUsage: { inputTokens: 987654, lastRequestTokens: 123456 }, preferences: { language: 'en', barkConfigured: true },
        approvalPanel: { id: 'approval:number:9', title: '确认', items: [{ id: 'accept', kind: 'action', value: '"accept"' }] } };
      const execution = spawnSync(executable, [], { encoding: 'utf8', input: JSON.stringify(input), timeout: 15000 });
      expect(execution.status, execution.error?.message ?? execution.stderr).toBe(0);
      expect(execution.stdout).toContain('AgentApp projection decoded');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 210000);
  it('折叠项目仍保留可追踪的完整原始身份，展示列表与真实分页动作保持现有行为', () => {
    const threads = aggregateThreads([{ id: 'device:1', name: '工作电脑' }], { 'device:1': [{ id: 'thread:2', cwd: '/真实/项目', name: '任务', isPinned: true, isUnread: true, updatedAt: 123 }] });
    const groups = projectNavigation({ threads, listBackendId: 'device:1', selectedBackendId: 'device:1', projectDirectories: ['/真实/项目'], hasProjectlessThreads: false,
      collapsedProjectKeys: new Set(['device:1:/真实/项目']), projectThreadStates: {}, projectHasMore: { '/真实/项目': true }, loadingProjectKeys: new Set() });
    const group = groups.find(value => value.category === 'project')!;
    expect(group).toMatchObject({ backendId: 'device:1', cwd: '/真实/项目', hasMore: true, collapsed: true, items: [], allItems: [{ backendId: 'device:1', threadId: 'thread:2', cwd: '/真实/项目', isPinned: true, isUnread: true, running: false, timestamp: 123 }] });
    expect(group.allItems?.[0].command?.params).toEqual({ backendId: 'device:1', threadId: 'thread:2' });
  });

  it('常规设备与偏好快照只包含展示信息，剥离网关用户信息、query、fragment和私密配置', () => {
    const backends = [{ id: 'b', name: '设备', token: 'PRIVATE_TOKEN', baseUrl: 'https://user:password@gateway.invalid/path?token=URL_TOKEN#private', enabled: false, order: 0, privateExtra: 'NEVER_PROJECT' }];
    const projected = projectNativeBackends(backends, { b: { connection: 'online', approvalCount: 2, queuedCount: 3 } }, { b: { projects: ['/项目'] } });
    expect(projected).toEqual([{ id: 'b', title: '设备', connected: false, enabled: false, gatewayAddress: 'https://gateway.invalid/path', connectionState: 'paused', projects: ['/项目'], approvalCount: 2, queuedCount: 3 }]);
    const preferences = projectNativePreferences({ language: 'en', transportMode: 'stream', fontSize: 'standard', notification: { mode: 'bark', barkUrl: 'https://api.day.app/BARK_SECRET' } });
    expect(preferences).toEqual({ language: 'en', transportMode: 'stream', fontSize: 'standard', notificationMode: 'bark', barkConfigured: true });
    expect(JSON.stringify({ projected, preferences })).not.toMatch(/PRIVATE_TOKEN|password|URL_TOKEN|NEVER_PROJECT|BARK_SECRET/);
  });

  it('原始Token用量不经格式化或当前值替代，未知数值不生成计数', () => {
    const snapshot = createWorkspaceAdapter(controller({ extended: { state: { tokenUsage: { last: { totalTokens: 123456 }, total: { inputTokens: 987654, cachedInputTokens: 876543, outputTokens: 765432, totalTokens: 1753086, reasoningOutputTokens: 654321 }, modelContextWindow: 1000000 } }, callbacks: {} } }), panel).snapshot;
    expect(snapshot.tokenUsage).toEqual({ lastRequestTokens: 123456, modelContextWindow: 1000000, inputTokens: 987654, cachedInputTokens: 876543, outputTokens: 765432, totalTokens: 1753086, reasoningOutputTokens: 654321 });
    const missing = createWorkspaceAdapter(controller({ extended: { state: { tokenUsage: { last: { totalTokens: -1 }, total: { inputTokens: NaN }, modelContextWindow: Infinity } }, callbacks: {} } }), panel).snapshot;
    expect(missing.tokenUsage).toBeUndefined();
  });

  it('新会话与已有会话都保留真实cwd，commentary保留稳定phase和源身份', () => {
    const snapshot = createWorkspaceAdapter(controller({ active: { id: 't', cwd: '/真实/项目', turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'comment', type: 'agentMessage', phase: 'commentary', text: '检查' }] }] } }), panel).snapshot;
    expect(snapshot.cwd).toBe('/真实/项目');
    expect(snapshot.messages[0]).toMatchObject({ turnId: 'turn', itemId: 'comment', phase: 'commentary' });
    expect(createWorkspaceAdapter(controller({ active: { cwd: '/新项目', turns: [] } }), panel).snapshot.cwd).toBe('/新项目');
  });

  it('已完成历史使用显式commentary条目，真实时间与所属媒体不与工具推理混合', () => {
    const timestamp = new Date(2026, 9, 17, 10, 44).getTime() / 1000;
    const messages = projectConversation({ turns: [{ id: 'turn', status: 'completed', items: [
      { id: 'c1', type: 'agentMessage', phase: 'commentary', text: '正在读取项目上下文。', timestamp },
      { id: 'screen', type: 'imageView', path: '/screen.png' },
      { id: 'reasoning', type: 'reasoning', text: '内部推理' },
      { id: 'tool', type: 'commandExecution', command: 'ls' },
      { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '已检查相关文件，正在整理结果。' },
      { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '完成' },
    ] }] }, path => `thumb:${path}`, path => `original:${path}`);
    const history = messages.find(message => message.id === 'turn:c1:history')!;
    expect(history).toMatchObject({ commentaryCanAttachToReply: false, commentaryBlockId: 'turn:c1:commentary', commentary: [
      { id: 'turn:c1', text: '正在读取项目上下文。', timestamp, blocks: [{ id: 'turn:screen:image:0', kind: 'image', value: 'thumb:/screen.png', previewURL: 'original:/screen.png' }] },
      { id: 'turn:c2', text: '已检查相关文件，正在整理结果。' },
    ] });
    expect(history.commentary?.[1].timestamp).toBeUndefined();
    expect(history.blocks?.[0]).toMatchObject({ kind: 'disclosure', title: '历史过程 (2)' });
    expect(messages.flatMap(message => message.blocks ?? []).some(block => block.id.endsWith(':reasoning'))).toBe(true);
    expect(messages.flatMap(message => message.blocks ?? []).find(block => block.id.endsWith(':tools'))?.children).toHaveLength(1);
    expect(messages.find(message => message.id === 'turn:final')?.text).toBe('完成');
  });

  it('运行中commentary传递真实时间以复用原型liveCommentary，缺失时间不补造', () => {
    const messages = projectConversation({ turns: [{ id: 'turn', status: 'inProgress', items: [
      { id: 'c1', type: 'agentMessage', phase: 'commentary', text: '读取项目', timestamp: 1792205040 },
      { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '整理结果' },
    ] }] }, path => path);
    expect(messages[0]).toMatchObject({ id: 'turn:c1', role: 'assistant', phase: 'commentary', timestamp: 1792205040 });
    expect(messages[1].timestamp).toBeUndefined();
    expect(messages[0].blocks?.at(-1)?.kind).toBe('text');
  });

  it('tool之后的commentary按原始末段标记，工具仍按旧wire尾置且媒体归属不变', () => {
    const messages = projectConversation({ turns: [{ id: 'turn', status: 'inProgress', items: [
      { id: 'u', type: 'userMessage', text: '问题' },
      { id: 'tool', type: 'commandExecution', command: 'ls' },
      { id: 'c', type: 'agentMessage', phase: 'commentary', text: '工具之后' },
      { id: 'screen', type: 'imageView', path: '/screen.png' },
    ] }] }, path => `thumb:${path}`, path => `original:${path}`);
    expect(messages.map(message => message.id)).toEqual(['turn:u', 'turn:c', 'turn:u:tools']);
    expect(messages[1]).toMatchObject({ commentaryIsLiveTail: true, blocks: [{ kind: 'image', previewURL: 'original:/screen.png' }] });
  });

  it.each(['commandExecution', 'reasoning', 'userMessage', 'imageGeneration'])('commentary之后出现%s时不能标为原始live末段', type => {
    const messages = projectConversation({ turns: [{ id: 'turn', status: 'inProgress', items: [
      { id: 'c', type: 'agentMessage', phase: 'commentary', text: '较早过程' },
      { id: 'separator', type, command: 'ls', text: '分隔', savedPath: '/standalone.png' },
    ] }] }, path => path);
    expect(messages.find(message => message.id === 'turn:c')).toMatchObject({ commentaryIsLiveTail: false });
  });

  it('用户插话阻断之前过程，只有最新连续commentary与附属媒体标为live末段', () => {
    const messages = projectConversation({ turns: [{ id: 'turn', status: 'inProgress', items: [
      { id: 'old', type: 'agentMessage', phase: 'commentary', text: '插话前' },
      { id: 'u', type: 'userMessage', text: '插话' },
      { id: 'tool', type: 'commandExecution', command: 'ls' },
      { id: 'new1', type: 'agentMessage', phase: 'commentary', text: '新过程一' },
      { id: 'screen', type: 'imageView', path: '/screen.png' },
      { id: 'new2', type: 'agentMessage', phase: 'commentary', text: '新过程二' },
    ] }] }, path => path);
    expect(messages.filter(message => message.commentaryIsLiveTail).map(message => message.id)).toEqual(['turn:new1', 'turn:new2']);
    expect(messages.find(message => message.id === 'turn:old')).toMatchObject({ commentaryIsLiveTail: false });
  });

  it.each(['reasoning', 'commandExecution', 'userMessage', 'imageGeneration'])('原始过程被%s隔开时不因最终Native相邻而绑定到final', type => {
    const messages = projectConversation({ turns: [{ id: 'turn', status: 'completed', items: [
      { id: 'c', type: 'agentMessage', phase: 'commentary', text: '较早过程' },
      { id: 'separator', type, text: '分隔', command: 'ls', savedPath: '/standalone.png' },
      { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '完成' },
    ] }] }, path => path);
    expect(messages.find(message => message.id === 'turn:c:history')).toMatchObject({ commentaryCanAttachToReply: false });
  });

  it('仅连续commentary与附属媒体后直接进入final时标记可以绑定，未完成则不绑定', () => {
    const items = [
      { id: 'c1', type: 'agentMessage', phase: 'commentary', text: '过程一' },
      { id: 'image', type: 'imageView', path: '/screen.png' },
      { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '过程二' },
    ];
    const completed = projectConversation({ turns: [{ id: 'turn', status: 'completed', items: [...items, { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '完成' }] }] }, path => path);
    expect(completed[0]).toMatchObject({ commentaryCanAttachToReply: true, commentary: [{ id: 'turn:c1' }, { id: 'turn:c2' }] });
    const noFinal = projectConversation({ turns: [{ id: 'turn', status: 'completed', items }] }, path => path);
    expect(noFinal[0]).toMatchObject({ commentaryCanAttachToReply: false });
  });

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('历史时间缺失或非法时不生成时间：%s', timestamp => {
    const messages = projectConversation({ turns: [{ id: 'turn', status: 'completed', items: [{ id: 'c', type: 'agentMessage', phase: 'commentary', text: '过程', timestamp }] }] }, path => path);
    expect(messages[0].commentary).toEqual([{ id: 'turn:c', text: '过程', blocks: [] }]);
  });

  it('历史条目内的操作同样绑定创建快照时的会话上下文', () => {
    const snapshot = bindWorkspaceCommands({ ...emptyNativeSnapshot(), contextId: 'original-context', messages: [{ id: 'history', role: 'activity', text: '',
      commentary: [{ id: 'entry', text: '过程', blocks: [{ id: 'entry:action', kind: 'action', command: { name: 'panel.open', params: { id: 'media' } } }] }] }] });
    expect(snapshot.messages[0].commentary?.[0].blocks?.[0].command?.params).toEqual({ id: 'media', contextId: 'original-context' });
  });

  it('历史加载保留原始状态，业务明确返回false时给出失败ACK', async () => {
    const adapter = createWorkspaceAdapter(controller({ olderTurnsState: 'error', loadOlder: async () => false }), panel);
    expect(adapter.snapshot.olderTurnsState).toBe('error');
    await expect(adapter.handlers['thread.older']!({})).rejects.toThrow('加载失败');
    const legacy = createWorkspaceAdapter(controller({ loadOlder: async () => undefined as any }), panel);
    await expect(legacy.handlers['thread.older']!({})).resolves.toBeUndefined();
  });

  it('附件容量在解码前严格核对，最大单项和总容量仍可用', () => {
    const maximum = 'YWFh'.repeat(Math.floor(20 * 1024 * 1024 / 3)) + 'YWE=';
    const item = { name: 'large.bin', type: 'application/octet-stream', data: maximum };
    expect(validateNativeAttachmentImport([item, item])).toHaveLength(2);
    expect(() => validateNativeAttachmentImport([item, item, { name: 'extra', type: '', data: 'YQ==' }])).toThrow();
    expect(() => validateNativeAttachmentImport([{ ...item, data: maximum + 'YQ==' }])).toThrow();
    expect(() => validateNativeAttachmentImport(Array.from({ length: 21 }, () => ({ name: 'a', type: '', data: '' })))).toThrow();
  });

  it('队列保留真实状态和附件数量，不把当前输入配置冒充旧队列设置', () => {
    const snapshot = createWorkspaceAdapter(controller({ queued: [{ id: 'q', threadId: 't', inputText: '原输入', text: '显示输入', attachmentCount: 2, state: 'uncertain', revision: 7, error: '网络断开' }], extended: { state: { selectedServiceTier: 'priority' }, callbacks: {} } }), panel).snapshot;
    expect(snapshot.queued[0]).toMatchObject({ threadId: 't', inputText: '原输入', queueState: 'uncertain', attachmentCount: 2, revision: 7, error: '网络断开' });
    expect(snapshot.queued[0].configuration).toBeUndefined();
  });

  it('打开其他面板仍保留同一真实审批及稳定decision，命令继续绑定原上下文', () => {
    const approval = { id: 9, method: 'item/commandExecution/requestApproval', params: { command: 'ls', availableDecisions: ['accept', 'decline'] } };
    const snapshot = createWorkspaceAdapter(controller({ approvalCount: 1, extended: { state: { approval }, callbacks: {} } }), { ...panel, panelId: 'workspace' }).snapshot;
    expect(snapshot.panel?.id).toBe('workspace');
    expect(snapshot.approvalPanel).toMatchObject({ id: 'approval:number:9' });
    expect(snapshot.approvalPanel?.items.find(item => item.id === 'approval-decision:0')).toMatchObject({ value: '"accept"', command: { name: 'approval.decide', params: { requestKey: 'number:9', index: 0, contextId: 'b:t:1' } } });
  });

  it('系统附件导入复用真实File入口，拒绝过期会话、只读和畸形载荷', async () => {
    const selected: File[][] = [];
    const runtime = new NativeRuntime(() => {});
    runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
    const adapter = createWorkspaceAdapter(controller({ selectFiles: async files => { selected.push(files); } }), panel);
    runtime.setWorkspace('b', adapter.snapshot, adapter.handlers);
    const items = [{ name: '照片.png', type: 'image/png', data: 'YQ==' }, { name: 'notes.txt', type: 'text/plain', data: '5Lit5paH' }];
    expect((await runtime.dispatch({ id: 'import', name: 'attachment.import', params: { contextId: 'b:t:1', items } })).ok).toBe(true);
    expect(selected[0].map(file => [file.name, file.type, file.size])).toEqual([['照片.png', 'image/png', 1], ['notes.txt', 'text/plain', 6]]);
    for (const [id, payload] of [ ['old', { contextId: 'old', items }], ['invalid', { contextId: 'b:t:1', items: [{ name: '../bad', type: 'text/plain', data: 'YQ==' }] }], ['bad64', { contextId: 'b:t:1', items: [{ name: 'bad.txt', type: 'text/plain', data: '!!!!' }] }], ['empty', { contextId: 'b:t:1', items: [] }] ] as const) {
      expect((await runtime.dispatch({ id, name: 'attachment.import', params: payload })).ok).toBe(false);
    }
    runtime.setWorkspace('b', { ...adapter.snapshot, readOnly: true }, adapter.handlers);
    expect((await runtime.dispatch({ id: 'readonly', name: 'attachment.import', params: { contextId: 'b:t:1', items } })).ok).toBe(false);
    expect(selected).toHaveLength(1);
    runtime.dispose();
  });

  it('附件原子预验证遵守真实图片上限、已选数量与累计40MiB，业务拒绝保留失败回执', async () => {
    let calls = 0;
    const selectFiles = async () => { calls += 1; };
    const payload = (name: string, type: string, bytes: number) => ({ name, type, data: 'YWFh'.repeat(Math.floor(bytes / 3)) + (bytes % 3 === 2 ? 'YWE=' : bytes % 3 === 1 ? 'YQ==' : '') });
    const invoke = (overrides: Partial<NativeWorkspaceController>, items: unknown[]) => createWorkspaceAdapter(controller({ selectFiles, ...overrides }), panel).handlers['attachment.import']!({ items });
    await expect(Promise.resolve().then(() => invoke({}, [payload('too-large.png', 'image/png', 15 * 1024 * 1024)]))).rejects.toThrow('10 MB');
    const prior = new File(['x'], 'previous.txt', { type: 'text/plain' });
    await expect(Promise.resolve().then(() => invoke({ draftFiles: [{ id: 'previous', name: prior.name, type: prior.type, size: 30 * 1024 * 1024, file: prior, previewUrl: 'blob:private' }] }, [payload('new.txt', 'text/plain', 15 * 1024 * 1024)]))).rejects.toThrow('40 MB');
    await expect(Promise.resolve().then(() => invoke({ draftImages: Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `${i}.png`, type: 'image/png', size: 1, url: 'data:image/png;base64,YQ==' })) }, [payload('new.png', 'image/png', 1)]))).rejects.toThrow('4');
    expect(calls).toBe(0);
    await expect(Promise.resolve().then(() => invoke({ selectFiles: async () => { throw new Error('真实读取失败'); } }, [payload('new.png', 'image/png', 1)]))).rejects.toThrow('真实读取失败');
  });
});
