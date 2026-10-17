import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';

vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class { sync() {} close() {} reconnect() {} client() { return null; } socket() { return null; } } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).webkit; delete (window as any).codexMobilePublishNativeSnapshot; });

it('真实App附件读取部分失败时原子拒绝整批、返回失败ACK并保留原草稿', async () => {
  const posts: any[] = [];
  Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (value: unknown) => posts.push(value) });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })));
  let reads = 0;
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function(this: FileReader) {
    reads += 1;
    if (reads === 1) { Object.defineProperty(this, 'result', { configurable: true, value: 'data:image/png;base64,YQ==' }); this.dispatchEvent(new Event('load')); }
    else { this.dispatchEvent(new Event('error')); }
  });
  render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: 'b', backends: [{ id: 'b', hostId: 'h', name: '设备', enabled: true, order: 0, baseUrl: 'https://gateway.invalid', token: 'PRIVATE' }] }} />);
  await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
  const contextId = posts.at(-1).contextId;
  const command = { id: 'atomic-import', name: 'attachment.import', params: { contextId, items: [{ name: 'good.png', type: 'image/png', data: 'YQ==' }, { name: 'broken.png', type: 'image/png', data: 'Yg==' }] } };
  await act(async () => { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: command })); });
  await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === command.id)).toBe(true));
  expect(posts.at(-1).commandResults.find((result: any) => result.id === command.id).ok).toBe(false);
  expect(posts.at(-1).attachments).toEqual([]);
});

it('原生导入期间切换新对话，迟到读取不得向新会话提交附件或写入错误', async () => {
  const posts: any[] = [];
  Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (value: unknown) => posts.push(value) });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })));
  let reader: FileReader | undefined;
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function(this: FileReader) { reader = this; });
  render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: 'b', backends: [{ id: 'b', hostId: 'h', name: '设备', enabled: true, order: 0, baseUrl: 'https://gateway.invalid', token: 'PRIVATE' }] }} />);
  await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
  const contextId = posts.at(-1).contextId;
  const send = (id: string, name: string, params: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } }));
  await act(async () => { send('old-import', 'attachment.import', { contextId, items: [{ name: 'old.png', type: 'image/png', data: 'YQ==' }] }); });
  await waitFor(() => expect(reader).toBeDefined());
  await act(async () => { send('new-thread', 'thread.new', {}); });
  await waitFor(() => expect(posts.at(-1)?.contextId).not.toBe(contextId));
  await act(async () => { Object.defineProperty(reader!, 'result', { configurable: true, value: 'data:image/png;base64,YQ==' }); reader!.dispatchEvent(new Event('load')); });
  await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'old-import')).toBe(true));
  expect(posts.at(-1).commandResults.find((result: any) => result.id === 'old-import').ok).toBe(false);
  expect(posts.at(-1).attachments).toEqual([]);
  expect(posts.at(-1).error).toBeUndefined();
});
