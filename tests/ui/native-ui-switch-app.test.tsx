import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as switchStoreModule from '../../src/native-ui/switch-store';
import { nativeSwitchStore } from '../../src/native-ui/switch-store';
import { useNativeRuntime } from '../../src/native-ui/adapters';
import { useNativeConfirmation } from '../../src/native-ui/confirmation';
import { AppBootstrap } from '../../src/App';
const connections = vi.hoisted(() => ({ created: 0, closed: 0 }));
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class { constructor() { connections.created++; } sync() {} close() { connections.closed++; } reconnect() {} client() { return null; } socket() { return null; } } }));
const posts: any[] = []; const messages: any[] = [];
const registry = { version: 1 as const, selectedBackendId: 'a', backends: ['a', 'b'].map((id, order) => ({ id, hostId: id, name: id, enabled: true, order, baseUrl: `https://${id}.invalid`, token: '' })) };
function command(id: string, name: string, params: Record<string, unknown> = {}) { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } })); }
function host(active: boolean) { Object.assign(window, { __CODEX_IOS_HOST__: true, __CODEX_NATIVE_UI__: active, webkit: { messageHandlers: { nativeUI: { postMessage(message: any) {
 messages.push(message); if (message.type === 'nativePreference') { const complete = (window as any).codexMobileNativePreferenceComplete; queueMicrotask(() => complete({ id: message.id, enabled: message.enabled ?? (message.kind === 'composer' ? true : active), active: message.kind === 'composer' ? true : active })); }
 } } } }, codexMobilePublishNativeSnapshot: (snapshot: any) => posts.push(snapshot) }); }
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }))); });
afterEach(() => { cleanup(); localStorage.clear(); posts.length = 0; messages.length = 0; for (const key of ['__CODEX_IOS_HOST__', '__CODEX_NATIVE_UI__', '__CODEX_NATIVE_UI_RECOVERED__', 'webkit', 'codexMobilePublishNativeSnapshot', 'codexMobileNativePreference', 'codexMobileNativePreferenceComplete']) delete (window as any)[key]; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('旧界面仅在iOS宿主显示原生开关，保存偏好后当前界面保持旧模式', async () => {
 host(false); render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: '', backends: [] }} />);
 const toggle = await screen.findByRole('checkbox', { name: '使用原生界面' }); expect(toggle).not.toBeChecked();
 fireEvent.click(toggle); await waitFor(() => expect(toggle).toBeChecked());
 expect(messages.some(message => message.type === 'nativePreference' && message.enabled === true)).toBe(true);
 expect((window as any).__CODEX_NATIVE_UI__).toBe(false); expect(screen.getByText('下次完整启动 App 时生效')).toBeInTheDocument();
});
it('非iOS网页没有界面切换功能', () => { render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: '', backends: [] }} />); expect(screen.queryByRole('checkbox', { name: '使用原生界面' })).toBeNull(); });
it('同一原生命令保存所有workspace并在冷启动前恢复文本与项目，不重放发送', async () => {
 host(true); const first = render(<AppBootstrap initialRegistry={registry} />);
 await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 await act(async () => command('text-a', 'draft.set', { contextId: posts.at(-1).contextId, value: '甲草稿', revision: 1 }));
 await act(async () => command('filter-b', 'backend.select', { id: 'b' })); await act(async () => command('new-b', 'thread.new'));
 await waitFor(() => expect(posts.at(-1)?.backendId).toBe('b'));
 await act(async () => command('text-b', 'draft.set', { contextId: posts.at(-1).contextId, value: '乙草稿', revision: 1 }));
 await act(async () => command('switch', 'settings.native-ui', { enabled: false }));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((r: any) => r.id === 'switch')?.ok).toBe(true));
 expect((window as any).__CODEX_NATIVE_UI__).toBe(true); first.unmount(); posts.length = 0;
 render(<AppBootstrap initialRegistry={registry} />);
 await waitFor(() => expect(posts.at(-1)?.draft).toBe('乙草稿'));
 expect(screen.getAllByRole('textbox', { name: '向 Codex 提问', hidden: true }).map(node => (node as HTMLTextAreaElement).value)).toEqual(['甲草稿', '乙草稿']);
 expect(vi.mocked(fetch).mock.calls.some(([, init]) => String(init?.body).includes('turn/start'))).toBe(false);
});
it('检查点写入失败不请求Swift修改偏好，并给出可重试错误', async () => {
 host(true); vi.stubGlobal('indexedDB', { open() { throw new Error('存储被拒绝'); } });
 render(<AppBootstrap initialRegistry={registry} />);
 // 冷启动读取失败必须明确停留，不能导航并清空草稿。
 await screen.findByRole('alert'); expect(messages.some(message => message.enabled !== undefined)).toBe(false);
 expect(screen.getByRole('button', { name: '重试恢复' })).toBeInTheDocument();
});
it('运行中检查点写入被拒绝时保持旧设置，并允许再次保存', async () => {
 host(false); render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: '', backends: [] }} />);
 const toggle = await screen.findByRole('checkbox', { name: '使用原生界面' });
 await waitFor(() => expect(toggle).not.toBeDisabled());
 const factory = globalThis.indexedDB; vi.stubGlobal('indexedDB', { open() { throw new Error('磁盘已满'); } });
 fireEvent.click(toggle); await screen.findByText('无法保存界面设置：磁盘已满');
 expect(toggle).not.toBeChecked(); expect(messages.some(message => message.enabled !== undefined)).toBe(false);
 vi.stubGlobal('indexedDB', factory); fireEvent.click(toggle); await waitFor(() => expect(toggle).toBeChecked());
});
it('Swift拒绝保存偏好时保持开关原值并显示宿主错误', async () => {
 host(false); render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: '', backends: [] }} />);
 const toggle = await screen.findByRole('checkbox', { name: '使用原生界面' }); await waitFor(() => expect(toggle).not.toBeDisabled());
 (window as any).webkit.messageHandlers.nativeUI.postMessage = (message: any) => message.type === 'nativePreference' && queueMicrotask(() => (window as any).codexMobileNativePreferenceComplete({ id: message.id, enabled: false, active: false, error: '偏好写入失败' }));
 fireEvent.click(toggle); await screen.findByText('无法保存界面设置：偏好写入失败'); expect(toggle).not.toBeChecked(); expect(await nativeSwitchStore.load()).toBeNull();
});

it('切换成功后继续编辑会更新检查点，且排除传输待确认写入', async () => {
 host(true); render(<AppBootstrap initialRegistry={registry} />); await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 localStorage.setItem('codex-mobile:http-writes:a:session', 'NEVER-REPLAY');
 localStorage.setItem('codex-mobile:font-size', 'large');
 await act(async () => command('prepare-sync', 'settings.native-ui', { enabled: false }));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((r: any) => r.id === 'prepare-sync')?.ok).toBe(true));
 await act(async () => command('after-toggle', 'draft.set', { contextId: posts.at(-1).contextId, value: '切换后继续输入', revision: 1 }));
 await waitFor(async () => expect((await nativeSwitchStore.load())?.workspaces[0].text).toBe('切换后继续输入'));
 expect((await nativeSwitchStore.load())?.storage).toMatchObject({ 'codex-mobile:font-size': 'large' });
 expect((await nativeSwitchStore.load())?.storage).not.toHaveProperty('codex-mobile:http-writes:a:session');
});
it('恢复检查点消费失败时原生界面也显示错误与可操作重试', async () => {
 host(true);
 await nativeSwitchStore.save({ version: 1, registry, storage: {}, workspaces: [] });
 const remove = vi.spyOn(nativeSwitchStore, 'remove').mockRejectedValue(new Error('删除被拒绝'));
 render(<AppBootstrap initialRegistry={registry} />);
 await waitFor(() => expect(posts.at(-1)?.panel?.id).toBe('native-switch-recovery'));
 expect(posts.at(-1).panel.items.some((item: any) => item.command?.name === 'navigation.refresh')).toBe(true);
 expect(screen.queryByRole('textbox', { name: '向 Codex 提问' })).toBeNull();
 remove.mockRestore(); await act(async () => command('retry-restore', 'navigation.refresh'));
 await waitFor(() => expect(posts.at(-1)?.backendId).toBe('a'));
});
it('后续切换失败保留之前已确认检查点，继续编辑仍同步', async () => {
 host(true); render(<AppBootstrap initialRegistry={registry} />); await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 await act(async () => command('first-valid', 'settings.native-ui', { enabled: false }));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((r: any) => r.id === 'first-valid')?.ok).toBe(true));
 await act(async () => command('retained-text', 'draft.set', { contextId: posts.at(-1).contextId, value: '保留有效检查点', revision: 1 }));
 await waitFor(async () => expect((await nativeSwitchStore.load())?.workspaces[0].text).toBe('保留有效检查点'));
 (window as any).webkit.messageHandlers.nativeUI.postMessage = (message: any) => message.type === 'nativePreference' && queueMicrotask(() => (window as any).codexMobileNativePreferenceComplete({ id: message.id, enabled: false, active: true, error: '偏好写入失败' }));
 await act(async () => command('second-rejected', 'settings.native-ui', { enabled: true }));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((r: any) => r.id === 'second-rejected')?.ok).toBe(false));
 expect((await nativeSwitchStore.load())?.workspaces[0].text).toBe('保留有效检查点');
});
it('持续同步落盘失败时原生快照显示错误，输入仍保留且不会自动发送', async () => {
 host(true); render(<AppBootstrap initialRegistry={registry} />); await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 await act(async () => command('arm-sync-error', 'settings.native-ui', { enabled: false }));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((r: any) => r.id === 'arm-sync-error')?.ok).toBe(true));
 const save = vi.spyOn(nativeSwitchStore, 'save').mockRejectedValue(new Error('磁盘已满'));
 await act(async () => command('keep-text-on-error', 'draft.set', { contextId: posts.at(-1).contextId, value: '保留当前输入', revision: 1 }));
 await waitFor(() => expect(posts.at(-1)?.error).toContain('无法更新界面切换检查点'));
 expect(posts.at(-1).draft).toBe('保留当前输入'); save.mockRestore();
});
it('初始导航之前恢复现有线程、输入和设备注册，恢复过程不重放写入', async () => {
 host(true);
 await nativeSwitchStore.save({ version: 1, registry: { ...registry, selectedBackendId: 'b' }, storage: { 'codex-mobile:transport-mode': 'stream' }, workspaces: [{ backendId: 'b', backendName: 'b', cwd: '/saved/project', text: '已有线程待发送文字', thread: { id: 'existing-thread', cwd: '/saved/project', preview: '恢复线程' }, images: [], files: [], settings: { model: 'saved-model', effort: 'high', serviceTier: null, permissions: ':workspace', approvalPolicy: 'on-request', approvalsReviewer: 'user' } }] });
 render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: '', backends: [] }} />);
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('existing-thread'));
 expect(posts.at(-1).draft).toBe('已有线程待发送文字');
 expect(JSON.parse(localStorage.getItem('codex-mobile.backend-registry.v1')!).selectedBackendId).toBe('b');
 expect(localStorage.getItem('codex-mobile:transport-mode')).toBe('stream');
 expect(vi.mocked(fetch).mock.calls.some(([, init]) => String(init?.body).includes('turn/start'))).toBe(false);
});

it('二进制附件重建失败保留检查点并停留在恢复界面', async () => {
 host(true);
 await nativeSwitchStore.save({ version: 1, registry, storage: {}, workspaces: [{ backendId: 'a', backendName: 'a', cwd: null, text: '保留文字', thread: null, images: [], files: [], settings: { model: '', effort: null, serviceTier: null, permissions: '', approvalPolicy: 'on-request', approvalsReviewer: 'user' } }] });
 const restore = vi.spyOn(switchStoreModule, 'restoreSwitchWorkspace').mockImplementation(() => { throw new Error('无法重建附件'); });
 render(<AppBootstrap initialRegistry={registry} />);
 await waitFor(() => expect(posts.at(-1)?.error).toContain('无法重建附件'));
 expect((await nativeSwitchStore.load())?.workspaces[0].text).toBe('保留文字'); restore.mockRestore();
});

it('iOS旧界面确认沿用可见Web对话框，不创建不可见的原生确认', async () => {
 host(false); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
 const { result } = renderHook(() => {
  const runtime = useNativeRuntime({ selectedBackendId: '', backends: [], groups: [] }, {});
  return { runtime, confirm: useNativeConfirmation(runtime, 'legacy') };
 });
 expect(result.current.runtime).toBeNull();
 expect(await result.current.confirm('确认清除？')).toBe(true); expect(confirm).toHaveBeenCalledWith('确认清除？');
});
it('iOS 切换检查点中的旧大字号与过期字号命令均不改变固定小字号，重启仍一致', async () => {
 localStorage.setItem('codex-mobile:font-size', 'extra-large');
 host(true); const first = render(<AppBootstrap initialRegistry={registry} />);
 await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 expect(posts.at(-1)?.fontScale).toBe(0.875);
 await act(async () => command('font-before-arm', 'settings.open', { id: 'font' }));
 await act(async () => command('arm-before-font', 'settings.native-ui', { enabled: false }));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((r: any) => r.id === 'arm-before-font')?.ok).toBe(true));
 await act(async () => command('font-after-arm', 'settings.font', { value: 'standard', fieldKey: 'settings:font:font', fieldRevision: 1 }));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((r: any) => r.id === 'font-after-arm')?.ok).toBe(true));
 await waitFor(async () => expect((await nativeSwitchStore.load())?.storage['codex-mobile:font-size']).toBe('extra-large'));
 first.unmount(); render(<AppBootstrap initialRegistry={registry} />);
 await waitFor(() => expect(posts.at(-1)?.fontScale).toBe(0.875));
 expect(localStorage.getItem('codex-mobile:font-size')).toBe('extra-large');
});

it('人工恢复同一个Web业务界面时保留全部草稿与连接，仅关闭原生呈现', async () => {
 host(true); render(<AppBootstrap initialRegistry={registry} />); await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 await act(async () => command('before-recovery-text', 'draft.set', { contextId: posts.at(-1).contextId, value: '人工恢复保留输入', revision: 1 }));
 await act(async () => command('before-recovery-settings', 'settings.open', { id: 'devices' }));
 const created = connections.created; const closed = connections.closed;
 await act(async () => { (window as any).__CODEX_NATIVE_UI_RECOVERED__ = true; window.dispatchEvent(new Event('codex-mobile-native-recovery')); });
 expect((window as any).__CODEX_NATIVE_UI__).toBe(true);
 expect(screen.getByRole('dialog', { name: '管理设备' })).toBeInTheDocument();
 expect(screen.getByRole('textbox', { name: '向 Codex 提问' })).toHaveValue('人工恢复保留输入');
 expect(connections.created).toBe(created); expect(connections.closed).toBe(closed);
 const count = posts.length;
 await act(async () => { command('after-recovery-invalid', 'draft.set', { contextId: posts.at(-1).contextId, value: '不应覆盖', revision: 2 }); await new Promise(resolve => setTimeout(resolve, 40)); });
 expect(posts.length).toBe(count); expect(screen.getByRole('textbox', { name: '向 Codex 提问' })).toHaveValue('人工恢复保留输入');
 expect(messages.some(message => message.type === 'nativePreference' && message.enabled !== undefined)).toBe(false);
});
it('人工恢复结束等待中的原生确认，后续确认走可见Web对话框', async () => {
 host(true); const webConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
 const { result } = renderHook(() => { const runtime = useNativeRuntime({ selectedBackendId: '', backends: [], groups: [] }, {}); return { runtime, confirm: useNativeConfirmation(runtime, 'manual-recovery') }; });
 let pending!: Promise<boolean>; act(() => { pending = result.current.confirm('等待中的确认'); });
 expect(result.current.runtime?.snapshot().panel?.id).toContain('manual-recovery');
 await act(async () => { (window as any).__CODEX_NATIVE_UI_RECOVERED__ = true; window.dispatchEvent(new Event('codex-mobile-native-recovery')); });
 expect(result.current.runtime).toBeNull(); expect(await pending).toBe(false);
 expect(await result.current.confirm('恢复后的确认')).toBe(false); expect(webConfirm).toHaveBeenCalledWith('恢复后的确认');
});

it('独立原生输入开关从宿主读取并经同一检查点保存且不热切换', async () => {
 host(false);
 (window as any).webkit.messageHandlers.nativeUI.postMessage = (message: any) => {
  messages.push(message); if (message.type === 'nativePreference') queueMicrotask(() => (window as any).codexMobileNativePreferenceComplete({ id: message.id, enabled: message.enabled ?? (message.kind === 'composer'), active: message.kind === 'composer' }));
 };
 render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: '', backends: [] }} />);
 const toggle = await screen.findByRole('checkbox', { name: '使用原生输入框' });
 await waitFor(() => expect(toggle).toBeChecked()); fireEvent.click(toggle);
 await waitFor(() => expect(toggle).not.toBeChecked());
 expect(messages.some(message => message.kind === 'composer' && message.enabled === false)).toBe(true);
 expect(await nativeSwitchStore.load()).not.toBeNull(); expect((window as any).__CODEX_NATIVE_UI__).toBe(false);
});
