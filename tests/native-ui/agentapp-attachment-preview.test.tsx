import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeRuntime } from '../../src/native-ui/runtime';
import { useNativeConversationAdapter, type NativeWorkspaceController } from '../../src/native-ui/workspace-adapter';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function controller(files: File[], overrides: Partial<NativeWorkspaceController> = {}): NativeWorkspaceController {
  return { backend: { id: 'b', name: '设备', token: 'PRIVATE', baseUrl: 'https://gateway.invalid', enabled: true, order: 0 }, active: { id: 't', turns: [] }, contextId: 'ctx', connection: 'online', draft: '', draftImages: [], draftFiles: files.map((file, index) => ({ id: `file-${index}`, name: file.name, type: file.type, size: file.size, file, previewUrl: 'blob:PRIVATE' })), busy: false, readOnly: false, imageReading: false, draftSaving: false, pending: false, models: [], selectedModel: '', selectedModelLabel: '', effortOptions: [], selectedEffort: null, permission: '', skills: [], plugins: [], queued: [], approvalCount: 0, loadState: 'ready', olderTurnsState: 'exhausted', error: '', setDraft() {}, send: async () => {}, stop: async () => {}, chooseModel() {}, chooseEffort() {}, removeAttachment() {}, selectFiles: async () => {}, selectLocation: async () => true, saveDraft: async () => {}, retry() {}, loadOlder: async () => true, editMessage() {}, cancelQueued: async () => {}, sendQueued: async () => {}, editQueued: async () => true, ...overrides };
}

it.each([
  ['notes.txt', 'text/plain', '完整文本', 'source'], ['readme.md', 'text/markdown', '# 标题', 'markdown'],
  ['index.html', 'text/html', '<h1>安全内容</h1>', 'html'], ['main.ts', 'text/typescript', 'export const value = 1;', 'source'],
])('当前真实File %s提供正确预览及相同原始字节下载', async (name, type, text, kind) => {
  const file = new File([text], name, { type });
  const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
  renderHook(() => useNativeConversationAdapter(runtime, controller([file])));
  const command = runtime.snapshot().attachments[0].command;
  expect(command?.name).toBe('attachment.preview');
  await act(async () => { expect((await runtime.dispatch({ id: 'preview', name: 'attachment.preview', params: { contextId: 'ctx', id: 'file-0' } })).ok).toBe(true); });
  const panel = runtime.snapshot().panel!;
  const content = panel.items.find(item => item.kind === kind)!;
  expect(content).toBeDefined(); expect(content.text ?? content.value).toBe(text);
  const download = panel.items.find(item => item.kind === 'file')!;
  expect(download.value?.startsWith(`data:${type};base64,`)).toBe(true);
  expect(content.previewURL).toBe(download.value);
  expect(JSON.stringify(panel)).not.toContain('blob:'); expect(JSON.stringify(panel)).not.toContain('PRIVATE');
  runtime.dispose();
});

it('二进制File只提供原始字节下载和明确说明，不以损坏UTF8呈现源码', async () => {
  const file = new File([new Uint8Array([0, 255, 1, 254])], 'data.bin', { type: 'application/octet-stream' });
  const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
  renderHook(() => useNativeConversationAdapter(runtime, controller([file])));
  await act(async () => { expect((await runtime.dispatch({ id: 'binary', name: 'attachment.preview', params: { contextId: 'ctx', id: 'file-0' } })).ok).toBe(true); });
  expect(runtime.snapshot().panel?.items.find(item => item.kind === 'file')?.value).toBe('data:application/octet-stream;base64,AP8B/g==');
  expect(runtime.snapshot().panel?.items.some(item => ['source', 'markdown', 'html'].includes(item.kind))).toBe(false);
  expect(JSON.stringify(runtime.snapshot().panel)).toContain('二进制'); runtime.dispose();
});

it('超出文本预览上限仍能下载，明确说明限制并避免巨量源码进入快照', async () => {
  const file = new File(['a'.repeat(2 * 1024 * 1024 + 1)], 'large.txt', { type: 'text/plain' });
  const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
  renderHook(() => useNativeConversationAdapter(runtime, controller([file])));
  await act(async () => { expect((await runtime.dispatch({ id: 'large', name: 'attachment.preview', params: { contextId: 'ctx', id: 'file-0' } })).ok).toBe(true); });
  expect(runtime.snapshot().panel?.items.some(item => item.kind === 'file')).toBe(true);
  expect(runtime.snapshot().panel?.items.some(item => item.kind === 'source')).toBe(false);
  expect(runtime.snapshot().panel?.items.find(item => item.id === 'draft-preview-limit')?.text).toContain('2 MB'); runtime.dispose();
});

it('同ID替换File或关闭预览后，迟到本地读取不能泄露旧内容', async () => {
  const attachments = await import('../../src/ui/attachments'); let finish!: (value: string) => void;
  vi.spyOn(attachments, 'readFileAsDataUrl').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const file = new File(['old'], 'notes.txt', { type: 'text/plain' });
  const runtime = new NativeRuntime(() => {}); runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
  let current = controller([file]); const { rerender } = renderHook(() => useNativeConversationAdapter(runtime, current));
  let pending!: ReturnType<NativeRuntime['dispatch']>;
  act(() => { pending = runtime.dispatch({ id: 'old-file', name: 'attachment.preview', params: { contextId: 'ctx', id: 'file-0' } }); });
  current = controller([new File(['new'], 'notes.txt', { type: 'text/plain' })]); rerender();
  await act(async () => { finish('data:text/plain;base64,b2xk'); await pending; });
  expect(runtime.snapshot().panel).toBeUndefined(); expect(JSON.stringify(runtime.snapshot())).not.toContain('b2xk'); runtime.dispose();
});
