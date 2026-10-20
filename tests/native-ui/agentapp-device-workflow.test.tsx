import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BackendManagerSheet } from '../../src/features/backends/BackendManagerSheet';
import { DraftsSheet } from '../../src/features/drafts/DraftsSheet';
import { newChatDraftStore } from '../../src/features/drafts/new-chat-drafts';
import { NativeRuntime } from '../../src/native-ui/runtime';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('取消真实设备测试立即解锁表单，迟到probe不保存且不会关闭下一次测试', async () => {
  const runtime = new NativeRuntime(() => {});
  const changes: unknown[] = [];
  const probes: Array<(value: any) => void> = [];
  render(<BackendManagerSheet nativeRuntime={runtime} nativePage="devices" open registry={{ version: 1, backends: [], selectedBackendId: '' }} summaries={{}} onClose={() => {}} onChange={value => changes.push(value)} probe={() => new Promise(resolve => probes.push(resolve))} />);
  const send = async (id: string, name: string, params = {}) => act(async () => runtime.dispatch({ id, name, params }));
  await send('name', 'device.change', { field: 'name', value: '测试设备' });
  await send('url', 'device.change', { field: 'gatewayUrl', value: 'https://gateway.invalid/?token=PRIVATE' });
  let first!: ReturnType<NativeRuntime['dispatch']>;
  act(() => { first = runtime.dispatch({ id: 'first', name: 'device.save', params: {} }); });
  await waitFor(() => expect(probes).toHaveLength(1));
  expect(runtime.snapshot().panel?.items.find(item => item.id === 'save')?.disabled).toBe(true);
  expect((await send('cancel', 'device.cancel', { testOnly: true })).ok).toBe(true);
  expect(runtime.snapshot().panel?.items.find(item => item.id === 'gatewayUrl')?.value).toContain('PRIVATE');
  expect(runtime.snapshot().panel?.items.find(item => item.id === 'save')?.disabled).toBe(false);
  expect((await first).ok).toBe(false);
  let second!: ReturnType<NativeRuntime['dispatch']>;
  act(() => { second = runtime.dispatch({ id: 'second', name: 'device.save', params: {} }); });
  await waitFor(() => expect(probes).toHaveLength(2));
  await act(async () => { probes[0]({ hostId: 'OLD', displayName: '旧请求' }); });
  expect(changes).toHaveLength(0);
  expect(runtime.snapshot().panel?.items.find(item => item.id === 'save')?.disabled).toBe(true);
  await act(async () => { probes[1]({ hostId: 'NEW', displayName: '新请求' }); await second; });
  expect(changes).toHaveLength(1);
  expect((changes[0] as any).backends[0].hostId).toBe('NEW');
  runtime.dispose();
});

it('设备probe失败返回失败回执并保留输入', async () => {
  const runtime = new NativeRuntime(() => {});
  render(<BackendManagerSheet nativeRuntime={runtime} open registry={{ version: 1, backends: [], selectedBackendId: '' }} summaries={{}} onClose={() => {}} onChange={() => { throw new Error('不应保存'); }} probe={async () => { throw new Error('访问口令不正确'); }} />);
  await act(async () => { await runtime.dispatch({ id: 'url', name: 'device.change', params: { field: 'gatewayUrl', value: 'https://gateway.invalid/?token=PRIVATE' } }); });
  let result: Awaited<ReturnType<NativeRuntime['dispatch']>> | undefined;
  await act(async () => { result = await runtime.dispatch({ id: 'save', name: 'device.save', params: {} }); });
  expect(result).toMatchObject({ ok: false, error: '访问口令不正确' });
  expect(runtime.snapshot().panel?.items.find(item => item.id === 'gatewayUrl')?.value).toContain('PRIVATE');
  runtime.dispose();
});

it('Bark链接验证失败返回失败回执，不能把未保存设置呈现为成功', async () => {
  const runtime = new NativeRuntime(() => {});
  const saves: unknown[] = [];
  render(<BackendManagerSheet nativeRuntime={runtime} nativePage="notifications" open registry={{ version: 1, backends: [], selectedBackendId: '' }} summaries={{}} onClose={() => {}} onChange={() => {}} notificationPreference={{ mode: 'system', barkUrl: '' }} onNotificationPreferenceSave={value => saves.push(value)} />);
  await act(async () => { await runtime.dispatch({ id: 'mode', name: 'settings.push.mode', params: { value: 'bark' } }); });
  await act(async () => { await runtime.dispatch({ id: 'url', name: 'settings.push.url', params: { value: 'invalid' } }); });
  let result: Awaited<ReturnType<NativeRuntime['dispatch']>> | undefined;
  await act(async () => { result = await runtime.dispatch({ id: 'save', name: 'settings.push.save', params: {} }); });
  expect(result?.ok).toBe(false);
  expect(saves).toHaveLength(0);
  expect(runtime.snapshot().panel?.items.find(item => item.id === 'bark-url')?.value).toBe('invalid');
  runtime.dispose();
});

it('草稿显式元数据保留原设备项目正文时间及附件信息，不序列化文件字节', async () => {
  const saved = { id: 'd', backendId: 'b', backendName: '工作电脑', cwd: '/真实/项目', text: '第一行\n完整正文', updatedAt: 123456789, revision: 'r', settings: { model: 'm', effort: 'high', serviceTier: null, permissions: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' },
    images: [{ id: 'i', name: '照片.png', type: 'image/png', size: 1, url: 'data:image/png;base64,YQ==' }], files: [{ id: 'f', name: 'notes.txt', type: 'text/plain', size: 3, lastModified: 1, bytes: new ArrayBuffer(3) }] } as any;
  vi.spyOn(newChatDraftStore, 'list').mockResolvedValue([saved]);
  const runtime = new NativeRuntime(() => {});
  render(<DraftsSheet nativeRuntime={runtime} onClose={() => {}} onOpenDraft={() => {}} />);
  await waitFor(() => expect(runtime.snapshot().panel?.items.some(item => item.id === 'd')).toBe(true));
  const item = runtime.snapshot().panel!.items.find(item => item.id === 'd')!;
  expect(JSON.parse(item.value!)).toMatchObject({ backendId: 'b', backendName: '工作电脑', cwd: '/真实/项目', text: saved.text, updatedAt: 123456789, images: saved.images, files: [{ id: 'f', name: 'notes.txt', type: 'text/plain', size: 3 }], settings: { model: 'm', effort: 'high' } });
  expect(item.value).not.toContain('bytes');
  runtime.dispose();
});
