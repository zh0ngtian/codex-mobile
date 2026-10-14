import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeRuntime } from '../../src/native-ui/runtime';
import { createWorkspaceAdapter, useNativeConversationAdapter, type NativeWorkspaceController } from '../../src/native-ui/workspace-adapter';
const engine = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(async (_id, source) => ({ svg: `<svg><text>${source}</text></svg>` })) }));
vi.mock('mermaid', () => ({ default: engine }));
afterEach(cleanup);
function c(overrides: any = {}): NativeWorkspaceController { return { backend: { id: 'b', name: 'Mac', baseUrl: 'http://gateway', token: 'TOKEN', enabled: true, order: 0 }, active: { id: 't', turns: [] }, contextId: 'ctx', connection: 'online', draft: '', draftImages: [], draftFiles: [], busy: false, readOnly: false, imageReading: false, draftSaving: false, pending: false, models: [], selectedModel: '', selectedModelLabel: '', effortOptions: [], selectedEffort: null, permission: '', skills: [], plugins: [], queued: [], approvalCount: 0, loadState: 'ready', olderTurnsState: 'exhausted', error: '', setDraft() {}, send: async () => {}, stop: async () => {}, chooseModel() {}, chooseEffort() {}, removeAttachment() {}, selectFiles: async () => {}, selectLocation: async () => true, saveDraft: async () => {}, retry() {}, loadOlder: async () => true, editMessage() {}, cancelQueued: async () => {}, sendQueued: async () => {}, editQueued: async () => true, ...overrides }; }
it('命令和文件变更面板挑选真实业务字段与diff统计，不以整对象JSON替代详情', () => {
 const state = c({ active: { id: 't', turns: [{ id: 'turn', items: [{ id: 'cmd', type: 'commandExecution', command: 'ls -la', cwd: '/app', status: 'completed', exitCode: 0, aggregatedOutput: 'hello', hidden: 'NOLEAK' }, { id: 'change', type: 'fileChange', changes: [{ path: '/app/a.ts', diff: '@@ -1 +1 @@\n-old\n+new' }] }] }] } });
 const panel = (id: string) => createWorkspaceAdapter(state, { panelId: id, query: '', setPanel() {}, setQuery() {} }).snapshot.panel;
 expect(panel('tool:turn:cmd')?.items.find(i => i.id.endsWith(':command'))?.text).toBe('ls -la');
 expect(JSON.stringify(panel('tool:turn:cmd'))).not.toContain('NOLEAK');
 const diff = panel('changes:turn')!; expect(JSON.stringify(diff)).toContain('+1'); expect(JSON.stringify(diff)).toContain('file.open'); expect(JSON.stringify(diff)).not.toContain('"changes"');
});
it('本地Markdown图片提供鉴权资源，Mermaid只渲染实际源码并复用strict引擎', async () => {
 const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 const controller = c({ active: { id: 't', turns: [{ id: 'turn', items: [{ id: 'a', type: 'agentMessage', text: '![图](/tmp/a.png)\n\n```mermaid\ngraph TD; A-->B\n```' }] }] } });
 renderHook(() => useNativeConversationAdapter(runtime, controller));
 await waitFor(() => expect(runtime.snapshot().richContent?.some(i => i.kind === 'html')).toBe(true));
 const resources = runtime.snapshot().richContent!;
 expect(resources.find(i => i.kind === 'image')?.text).toBe('/tmp/a.png'); expect(resources.find(i => i.kind === 'image')?.value).toContain('token=TOKEN');
 expect(resources.find(i => i.kind === 'html')?.text).toBe('graph TD; A-->B');
 expect(engine.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict' })); runtime.dispose();
});
it('文件链接使用既有fs读取与解码，预览模式切换及下载URL保留；切换会话后迟到内容不污染新面板', async () => {
 const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 let resolve!: (v: any) => void; const read = vi.fn().mockResolvedValueOnce({ dataBase64: btoa('# 标题'.replace('标题', 'Heading')) }).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
 let controller = c({ extended: { state: {}, callbacks: { readRemoteFile: read } } });
 const { rerender } = renderHook(() => useNativeConversationAdapter(runtime, controller));
 await act(async () => { expect((await runtime.dispatch({ id: 'file', name: 'file.open', params: { contextId: 'ctx', href: '/app/readme.md:4' } })).ok).toBe(true); });
 expect(read).toHaveBeenCalledWith('/app/readme.md'); expect(runtime.snapshot().panel?.items.some(i => i.kind === 'markdown')).toBe(true);
 const download = runtime.snapshot().panel?.items.find(i => i.kind === 'file'); expect(new URL(download!.value!).searchParams.get('path')).toBe('/app/readme.md'); expect(download!.title).toBe('readme.md');
 await act(async () => { await runtime.dispatch({ id: 'mode', name: 'file.mode', params: { contextId: 'ctx', value: 'source' } }); }); expect(runtime.snapshot().panel?.items.some(i => i.kind === 'source' && i.line === 4)).toBe(true);
 let pending: Promise<unknown>;
 act(() => { pending = runtime.dispatch({ id: 'late', name: 'file.open', params: { contextId: 'ctx', href: '/app/late.html' } }); });
 controller = c({ contextId: 'next', extended: { state: {}, callbacks: { readRemoteFile: read } } }); rerender();
 await act(async () => { resolve({ dataBase64: btoa('<h1>LATE</h1>') }); await pending!; }); expect(JSON.stringify(runtime.snapshot().panel ?? null)).not.toContain('LATE'); runtime.dispose();
});
it('会话投影包含运行计划、推理折叠与生成视频的真实鉴权媒体URL', () => {
 const controller = c({ busy: true, active: { id: 't', mobilePlan: [{ step: '读取实现', status: 'completed' }, { step: '验证', status: 'inProgress' }], turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'r', type: 'reasoning', text: '推理正文' }, { id: 'v', type: 'imageGeneration', savedPath: '/tmp/out.mp4' }] }] } });
 const snapshot = createWorkspaceAdapter(controller, { panelId: null, query: '', setPanel() {}, setQuery() {} }).snapshot;
 expect(JSON.stringify(snapshot.messages)).toContain('读取实现'); expect(JSON.stringify(snapshot.messages)).toContain('推理正文'); expect(JSON.stringify(snapshot.messages)).toContain('"kind":"video"');
});
it('SVG通过原fs读取并投影隔离HTML而非UIImage；关闭后迟到读取不会重开面板', async () => {
 const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 let finish!: (value: any) => void; const read = vi.fn().mockResolvedValueOnce({ dataBase64: btoa('<svg><text>Vector</text></svg>') }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 const controller = c({ extended: { state: {}, callbacks: { readRemoteFile: read } } }); renderHook(() => useNativeConversationAdapter(runtime, controller));
 await act(async () => { await runtime.dispatch({ id: 'svg', name: 'file.open', params: { contextId: 'ctx', href: '/app/a.svg' } }); });
 expect(read).toHaveBeenCalledWith('/app/a.svg'); expect(runtime.snapshot().panel?.items.find(i => i.kind === 'html')?.value).toContain('<svg>');
 let late!: Promise<unknown>; act(() => { late = runtime.dispatch({ id: 'closing', name: 'file.open', params: { contextId: 'ctx', href: '/app/readme.md' } }); });
 const id = runtime.snapshot().panel!.id;
 await act(async () => { await runtime.dispatch({ id: 'close', name: 'panel.close', params: { contextId: 'ctx', id } }); finish({ dataBase64: btoa('AFTER CLOSE') }); await late; });
 expect(runtime.snapshot().panel).toBeUndefined(); runtime.dispose();
});
it('失败生成图像提供明确失败入口并复用网关诊断详情，失败路径不当作成功媒体', async () => {
 const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'moderation_blocked', stage: 'output', categories: ['sexual'], requestId: 'request-1' } })));
 const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 const controller = c({ active: { id: 't', turns: [{ id: 'turn', items: [{ id: 'failed', type: 'imageGeneration', status: 'failed', savedPath: '/tmp/no.png' }] }] } });
 renderHook(() => useNativeConversationAdapter(runtime, controller));
 expect(JSON.stringify(runtime.snapshot().messages)).toContain('图像生成未完成'); expect(JSON.stringify(runtime.snapshot().messages)).not.toContain('no.png');
 await act(async () => { await runtime.dispatch({ id: 'failure-open', name: 'panel.open', params: { contextId: 'ctx', id: 'tool:turn:failed' } }); });
 expect(String(fetcher.mock.calls[0][0])).toContain('/api/image-generation-error');
 expect(JSON.stringify(runtime.snapshot().panel)).toContain('生成结果被内容审核拦截'); expect(JSON.stringify(runtime.snapshot().panel)).toContain('request-1'); fetcher.mockRestore(); runtime.dispose();
});
it('Windows Markdown的Mermaid源码与Swift统一CRLF为LF后缓存和查找', async () => {
 const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 renderHook(() => useNativeConversationAdapter(runtime, c({ active: { id: 't', turns: [{ id: 'x', items: [{ id: 'a', type: 'agentMessage', text: '```mermaid\r\ngraph TD\r\n A-->B\r\n```\r\n' }] }] } })));
 await waitFor(() => expect(runtime.snapshot().richContent?.find(i => i.kind === 'html')?.text).toBe('graph TD\n A-->B')); runtime.dispose();
});
it('用户Markdown正文也提供本地图片与Mermaid资源并剥离业务标题指令', async () => {
 const { appendConversationTitleRequest } = await import('../../src/app-server/conversation-title');
 const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 const text = appendConversationTitleRequest('![用户图](/tmp/user.png)\n\n```mermaid\ngraph LR; User-->Codex\n```\n\n[代码](/app/main.ts:5)');
 renderHook(() => useNativeConversationAdapter(runtime, c({ active: { id: 't', turns: [{ id: 'turn', items: [{ id: 'u', type: 'userMessage', content: [{ type: 'text', text }] }] }] } })));
 await waitFor(() => expect(runtime.snapshot().richContent?.find(item => item.kind === 'html')?.text).toBe('graph LR; User-->Codex'));
 const image = runtime.snapshot().richContent?.find(item => item.kind === 'image'); expect(image?.text).toBe('/tmp/user.png'); expect(new URL(image!.value!).searchParams.get('path')).toBe('/tmp/user.png');
 expect(runtime.snapshot().messages[0].text).toContain('[代码](/app/main.ts:5)'); expect(runtime.snapshot().messages[0].text).not.toContain('conversation_title_request'); runtime.dispose();
});
it.each(['completed', 'inProgress'])('正式videoGeneration在%s且产物已就绪时提供真实视频预览', status => {
 const snapshot = createWorkspaceAdapter(c({ active: { id: 't', turns: [{ id: 'turn', status, items: [{ id: 'video', type: 'videoGeneration', status, savedPath: '/tmp/generated-video.mp4' }] }] } }), { panelId: null, query: '', setPanel() {}, setQuery() {} }).snapshot;
 const blocks = snapshot.messages.flatMap(message => message.blocks ?? []); const video = blocks.find(item => item.kind === 'video');
 expect(video).toBeDefined(); expect(new URL(video!.value!).searchParams.get('path')).toBe('/tmp/generated-video.mp4'); expect(new URL(video!.value!).pathname).toBe('/api/files/preview');
});
it('正式videoGeneration无产物的运行态和失败态仍保留明确入口与原错误详情', () => {
 const controller = c({ active: { id: 't', turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'running', type: 'videoGeneration', status: 'inProgress' }, { id: 'failed-video', type: 'videoGeneration', status: 'failed', savedPath: '/tmp/failed.mp4', error: '视频模型返回失败' }] }] } });
 const projection = (panelId: string | null) => createWorkspaceAdapter(controller, { panelId, query: '', setPanel() {}, setQuery() {} }).snapshot;
 const snapshot = projection(null); expect(JSON.stringify(snapshot.messages)).toContain('正在生成视频'); expect(JSON.stringify(snapshot.messages)).toContain('视频生成未完成'); expect(JSON.stringify(snapshot.messages)).not.toContain('failed.mp4');
 expect(JSON.stringify(projection('tool:turn:failed-video').panel)).toContain('视频模型返回失败');
});
it('相对变更文件按真实cwd规范化为可解析路径，缺cwd时保留diff而不提供死按钮', () => {
 const active = { id: 't', cwd: '/app/project', turns: [{ id: 'turn', items: [{ id: 'file', type: 'fileChange', changes: [{ path: 'src/../src/App.tsx', diff: '+new' }] }] }] };
 const project = (cwd?: string) => createWorkspaceAdapter(c({ active: { ...active, cwd } }), { panelId: 'changes:turn', query: '', setPanel() {}, setQuery() {} }).snapshot.panel!;
 const existing = project('/app/project').items[0].children!.find(item => item.command?.name === 'file.open'); expect(existing?.command?.params.href).toBe('/app/project/src/App.tsx');
 expect(project().items[0].children!.some(item => item.command?.name === 'file.open')).toBe(false); expect(project().items[0].children!.some(item => item.kind === 'diff')).toBe(true);
 expect(project('relative-cwd').items[0].children!.some(item => item.command?.name === 'file.open')).toBe(false);
});
