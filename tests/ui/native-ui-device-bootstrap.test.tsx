import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';
import type { BackendRegistry } from '../../src/backends/types';
import type { NativeResult, NativeSnapshot } from '../../src/native-ui/protocol';

// 仅替换网络边界；表单、registry、业务组件挂载及原生发布链均使用实际实现。
const boundary = vi.hoisted(() => ({ probe: vi.fn(), created: 0, closed: 0 }));
vi.mock('../../src/backends/probe', async original => ({
  ...await original<typeof import('../../src/backends/probe')>(),
  probeBackend: (...args: unknown[]) => boundary.probe(...args),
}));
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
  constructor() { boundary.created++; }
  sync() {} close() { boundary.closed++; } reconnect() {} client() { return null; } socket() { return null; }
} }));
const posts: NativeSnapshot[] = [];
const empty: BackendRegistry = { version: 1, selectedBackendId: '', backends: [] };
const configured: BackendRegistry = { version: 1, selectedBackendId: 'existing', backends: [{
  id: 'existing', name: '已有设备', hostId: 'existing-host', baseUrl: 'https://owned-existing.invalid', token: 'synthetic', enabled: true, order: 0,
}] };
const host = { hostId: 'owned-host', displayName: '自有设备', appServerReady: true, httpPolling: true };
let serial = 0;
const latest = () => posts.at(-1)!;
function emit(id: string, name: string, params: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } }));
}
function results(id: string): NativeResult[] { return posts.flatMap(snapshot => snapshot.commandResults ?? []).filter(result => result.id === id); }
async function issue(name: string, params: Record<string, unknown> = {}) {
  const id = `device-bootstrap-${++serial}`;
  await act(async () => emit(id, name, params));
  await waitFor(() => expect(results(id).some(result => result.ok)).toBe(true));
  return id;
}
async function open(registry = empty) {
  const app = render(<AppBootstrap initialRegistry={registry} />);
  await waitFor(() => expect(latest()?.ready).toBe(true));
  if (registry.backends.length) { await issue('settings.open', { id: 'devices' }); await issue('device.add'); }
  await waitFor(() => expect(latest().panel?.items.some(item => item.id === 'gatewayUrl')).toBe(true));
  return app;
}
async function fill(name = '新设备', address = 'https://owned-new.invalid/?token=synthetic') {
  await issue('device.change', { field: 'name', value: name, fieldKey: 'bootstrap-name', fieldRevision: ++serial });
  await issue('device.change', { field: 'gatewayUrl', value: address, fieldKey: 'bootstrap-address', fieldRevision: ++serial });
}
async function saved(id: string, name = '新设备') {
  await waitFor(() => expect(latest()?.backends?.some(backend => backend.title === name)).toBe(true));
  await waitFor(() => expect(results(id).some(result => result.ok)).toBe(true));
  expect(latest().panel?.items.some(item => item.id === 'gatewayUrl')).not.toBe(true);
  expect(latest().title).not.toBe('添加设备');
  expect(JSON.parse(localStorage.getItem('codex-mobile.backend-registry.v1')!).backends.some((backend: { name: string }) => backend.name === name)).toBe(true);
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); }); }
beforeEach(() => {
  boundary.probe.mockReset().mockResolvedValue(host); boundary.created = 0; boundary.closed = 0;
  Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (snapshot: NativeSnapshot) => posts.push(snapshot) });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ projects: [], projectlessThreadIds: [] }), { headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  cleanup(); posts.length = 0; localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const key of ['__CODEX_NATIVE_UI__', '__CODEX_NATIVE_UI_RECOVERED__', 'webkit', 'codexMobilePublishNativeSnapshot']) delete (window as unknown as Record<string, unknown>)[key];
});

it('首次保存发布真实成功回执，切换前后重复同一命令均不再探测或产生失败回执', async () => {
  let finish!: (value: typeof host) => void;
  boundary.probe.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const added = vi.spyOn(window, 'addEventListener'); const removed = vi.spyOn(window, 'removeEventListener');
  const listeners = () => added.mock.calls.filter(([name]) => name === 'codex-mobile-native-command').length - removed.mock.calls.filter(([name]) => name === 'codex-mobile-native-command').length;
  const app = await open(); await fill(); expect(listeners()).toBe(1);
  const oldDraft = latest().panel?.items.find(item => item.id === 'gatewayUrl')?.command?.params.draftId;
  const id = 'first-save';
  await act(async () => { emit(id, 'device.save'); emit(id, 'device.save'); });
  expect(boundary.probe).toHaveBeenCalledTimes(1); expect(results(id)).toEqual([]);
  await act(async () => finish(host));
  await saved(id);
  await act(async () => emit(id, 'device.save'));
  await settle();
  expect(boundary.probe).toHaveBeenCalledTimes(1);
  expect(results(id).every(result => result.ok)).toBe(true);
  expect(latest().commandResults?.filter(result => result.id === id)).toHaveLength(1); expect(listeners()).toBe(1);
  await act(async () => emit('stale-bootstrap-form', 'device.change', { draftId: oldDraft, field: 'name', value: '不应覆盖', fieldKey: 'old-form', fieldRevision: ++serial }));
  await waitFor(() => expect(results('stale-bootstrap-form').at(-1)?.ok).toBe(false));
  expect(latest().panel?.items.some(item => item.id === 'gatewayUrl')).not.toBe(true);
  expect(latest().backends?.some(backend => backend.title === '新设备')).toBe(true);
  const count = posts.length; app.unmount(); expect(listeners()).toBe(0); await settle(); expect(posts).toHaveLength(count);
});

it('已有配置新增设备仍发布成功回执并保留原工作区草稿', async () => {
  render(<AppBootstrap initialRegistry={configured} />);
  await waitFor(() => expect(latest()?.ready).toBe(true));
  const contextId = latest().contextId;
  await issue('draft.set', { contextId, value: '已有草稿', revision: 1 });
  await issue('settings.open', { id: 'devices' }); await issue('device.add'); await fill();
  await act(async () => emit('configured-save', 'device.save'));
  await saved('configured-save');
  expect(latest().draft).toBe('已有草稿'); expect(latest().contextId).toBe(contextId);
  expect(latest().backends?.some(backend => backend.id === 'existing')).toBe(true);
});

it('首次探测失败发布失败回执并保留输入，不切换业务；真实重试成功才切换', async () => {
  boundary.probe.mockRejectedValueOnce(new Error('受控身份探测失败'));
  await open(); await fill();
  await act(async () => emit('rejected-save', 'device.save'));
  await waitFor(() => expect(results('rejected-save').at(-1)).toMatchObject({ ok: false, error: '受控身份探测失败' }));
  expect(latest().title).toBe('添加设备'); expect(boundary.created).toBe(0);
  expect(latest().panel?.items.find(item => item.id === 'name')?.value).toBe('新设备');
  expect(localStorage.getItem('codex-mobile.backend-registry.v1')).toBeNull();
  await act(async () => emit('retry-save', 'device.save')); await saved('retry-save');
  expect(boundary.probe).toHaveBeenCalledTimes(2);
});

it('移除当前设备注销旧工作区，保留另一设备且旧上下文不能写入新工作区', async () => {
  await open(); await fill(); await act(async () => emit('remove-source-save', 'device.save')); await saved('remove-source-save');
  const previousContext = latest().contextId; const backend = latest().backends!.find(entry => entry.title === '新设备')!;
  await issue('draft.set', { contextId: previousContext, value: '旧工作区草稿', revision: 1 });
  await issue('settings.open', { id: 'devices' }); await issue('device.add');
  boundary.probe.mockResolvedValueOnce({ ...host, hostId: 'other-host' });
  await fill('另一设备', 'https://owned-other.invalid/?token=synthetic');
  await act(async () => emit('other-save', 'device.save')); await saved('other-save', '另一设备');
  await issue('device.remove', { id: backend.id, confirmed: true });
  await waitFor(() => expect(latest().backendId).not.toBe(backend.id));
  expect(latest().draft).not.toBe('旧工作区草稿'); expect(boundary.closed).toBe(1); expect(boundary.created).toBe(2);
  expect(latest().backends?.some(entry => entry.id === backend.id)).toBe(false);
  expect(latest().backends?.some(entry => entry.title === '另一设备')).toBe(true);
  expect(latest().panel?.items.some(item => item.id === 'gatewayUrl')).not.toBe(true);
  await act(async () => emit('old-context-write', 'draft.set', { contextId: previousContext, value: '不应写入', revision: 2 }));
  await waitFor(() => expect(results('old-context-write').at(-1)?.ok).toBe(false));
  expect(latest().draft).not.toBe('不应写入');
  await issue('draft.set', { contextId: latest().contextId, value: '保留设备草稿', revision: 1 });
  expect(latest().draft).toBe('保留设备草稿');
});

it('保存期间真正卸载不再发布或保存，下一次AppBootstrap不继承旧命令结果', async () => {
  let finish!: (value: typeof host) => void;
  boundary.probe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = await open(); await fill();
  await act(async () => emit('unmounted-save', 'device.save'));
  first.unmount(); const count = posts.length;
  await settle(); expect(posts).toHaveLength(count); expect(localStorage.getItem('codex-mobile.backend-registry.v1')).toBeNull();
  posts.length = 0; await open(); await fill('下一次设备');
  await act(async () => finish(host)); await settle();
  expect(results('unmounted-save')).toEqual([]);
  await act(async () => emit('unmounted-save', 'device.save')); await saved('unmounted-save', '下一次设备');
  expect(boundary.probe).toHaveBeenCalledTimes(2);
});

it('保存期间人工恢复仅释放原生runtime，迟到完成和后续业务切换不会复活原生发布', async () => {
  let finish!: (value: typeof host) => void;
  boundary.probe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await open(); await fill(); await act(async () => emit('recovery-save', 'device.save'));
  await act(async () => { (window as unknown as Record<string, unknown>).__CODEX_NATIVE_UI_RECOVERED__ = true; window.dispatchEvent(new Event('codex-mobile-native-recovery')); });
  const count = posts.length;
  await act(async () => finish(host));
  await waitFor(() => expect(JSON.parse(localStorage.getItem('codex-mobile.backend-registry.v1')!).backends[0].name).toBe('新设备'));
  await settle(); expect(posts).toHaveLength(count);
  await act(async () => emit('ignored-after-recovery', 'settings.open', { id: 'devices' }));
  await settle(); expect(posts).toHaveLength(count); expect(boundary.probe).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll('.backend-workspace')).toHaveLength(1);
  expect(boundary.created).toBeGreaterThan(0); expect(boundary.closed).toBe(0);
});
