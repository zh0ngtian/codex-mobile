import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as bridge from '../../src/native-ui/runtime';
import { useNativeRuntime } from '../../src/native-ui/adapters';
import { emptyNativeSnapshot } from '../../src/native-ui/protocol';
import { WebInterfaceProvider, useWebInterface, WEB_INTERFACE_KEY } from '../../src/features/web-ui/preference';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.removeItem(WEB_INTERFACE_KEY); for (const key of ['__CODEX_NATIVE_UI__', '__CODEX_NATIVE_COMPOSER__', '__CODEX_NATIVE_UI_RECOVERED__', '__CODEX_NATIVE_ACTIVE__', '__CODEX_IOS_HOST__', 'webkit']) delete (window as any)[key]; });
function hybrid() { Object.assign(window, { __CODEX_NATIVE_UI__: false, __CODEX_NATIVE_COMPOSER__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } } }); }
it('独立输入能力启动唯一业务runtime而不启用完整原生界面，恢复后关闭桥', () => {
 hybrid(); const { result } = renderHook(() => useNativeRuntime({ selectedBackendId: '', backends: [], groups: [] }, {}));
 expect(bridge.isNativeUIEnabled()).toBe(false); expect(result.current).not.toBeNull();
 expect((bridge as any).isNativeBridgeEnabled()).toBe(true);
 (window as any).__CODEX_NATIVE_UI_RECOVERED__ = true; expect((bridge as any).isNativeBridgeEnabled()).toBe(false);
});
it('只发布真实挂载且当前设备context匹配的网页输入呈现，旧context清理不能移除新登记', () => {
 const runtime = new bridge.NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] });
 runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:new' }, {});
 expect((runtime.snapshot() as any).webComposer).toBeUndefined();
 (runtime as any).setWebComposer('a', { contextId: 'a:old', visible: true, blocked: false });
 expect((runtime.snapshot() as any).webComposer).toBeUndefined();
 (runtime as any).setWebComposer('a', { contextId: 'a:new', visible: true, blocked: false });
 (runtime as any).setWebComposer('a', undefined, 'a:old');
 expect((runtime.snapshot() as any).webComposer).toEqual({ contextId: 'a:new', visible: true, blocked: false });
 runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] }); expect((runtime.snapshot() as any).webComposer).toBeUndefined(); runtime.dispose();
});
it('独立输入偏好命令严格验证布尔值并使用全局事务', async () => {
 const runtime = new bridge.NativeRuntime(() => {}); let saved: unknown;
 runtime.setNavigation({ selectedBackendId: '', backends: [], groups: [] }, { 'settings.native-composer': p => { saved = p.enabled; } });
 expect((await runtime.dispatch({ id: 'bad', name: 'settings.native-composer', params: { enabled: 'false' } })).ok).toBe(false);
 expect((await runtime.dispatch({ id: 'good', name: 'settings.native-composer', params: { enabled: false } })).ok).toBe(true);
 expect(saved).toBe(false); runtime.dispose();
});

import { createRef, useState } from 'react';
import { ComposerSettings, type ComposerPicker } from '../../src/features/settings/ComposerSettings';
import { ConversationPage } from '../../src/features/conversation/ConversationPage';
import { useOverlayScrollIsolation } from '../../src/ui/overlay-scroll';
const pageProps = {
 active: { id: 't', turns: [] }, backendId: 'a', backendName: 'Mac', backends: [], projectOptions: [], loadState: 'ready', loadError: '', olderTurnsState: 'exhausted', connection: 'online', client: null, error: '', draft: '中文😀尾文本', draftImages: [], draftFiles: [], imageReading: false, busy: false, steering: false, steerable: false, pendingSteerText: '', queuedFollowUps: [], accessMode: 'interactive', resumeError: '', tokenUsage: null, rateLimits: null, pendingAction: '', selectedServiceTier: null, selectedModelLabel: 'Codex', selectedEffort: null, selectedPermissionLabel: '工作区', imageInputRef: createRef<HTMLInputElement>(), onBack() {}, onNewChatBackendChange() {}, onNewChatProjectChange() {}, onPin: async () => true, onDuplicate: async () => true, onRename: async () => true, onArchive: async () => true, onRetry() {}, onLoadOlderTurns: async () => true, onSubmit() {}, onRemoveImage() {}, onRemoveFile() {}, onSelectImages: async () => {}, onSelectLocation: async () => true, onOpenAgentSettings() {}, onOpenPermissionSettings() {}, onDraftChange() {}, onInterrupt() {}, onQueuedFollowUpAction() {},
} as Parameters<typeof ConversationPage>[0];
function Overlay({ open }: { open: boolean }) { const ref = createRef<HTMLDivElement>(); useOverlayScrollIsolation(open, ref); return <div ref={ref} />; }
it('真实网页会话保留Web表单和隐藏布局代理，公共遮罩控制原生文字编辑', () => {
 hybrid(); const runtime = new bridge.NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] }); runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t' }, {});
 const props = { ...pageProps, nativeRuntime: runtime, nativeContextId: 'a:t', conversationVisible: true };
 const view = render(<><ConversationPage {...props} /><Overlay open={false} /></>);
 expect(screen.queryByRole('textbox', { name: '向 Codex 提问' })).toBeNull();
 const proxy = view.container.querySelector('.composer textarea')!;
 expect(proxy).toHaveAttribute('aria-hidden', 'true');
 expect(proxy).toHaveAttribute('tabindex', '-1');
 expect(view.container.querySelector('form')).not.toBeNull();
 expect(screen.getByRole('button', { name: '发送' })).toBeEnabled();
 expect(screen.queryByRole('button', { name: '最大化输入框' })).toBeNull();
 expect(runtime.snapshot().webComposer).toMatchObject({ contextId: 'a:t', visible: true, blocked: false, bodyFontSize: 16 });
 view.rerender(<><ConversationPage {...props} /><Overlay open /></>); expect((runtime.snapshot() as any).webComposer.blocked).toBe(true);
 view.rerender(<><ConversationPage {...props} conversationVisible={false} /><Overlay open={false} /></>); expect((runtime.snapshot() as any).webComposer.visible).toBe(false);
 view.unmount(); expect((runtime.snapshot() as any).webComposer).toBeUndefined(); runtime.dispose();
});
it('网页代理发布有限矩形及UTF16选区，旧context状态不能覆盖当前焦点', () => {
 hybrid(); const runtime = new bridge.NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] });
 runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t' }, {});
 const view = render(<ConversationPage {...pageProps} nativeRuntime={runtime} nativeContextId="a:t" conversationVisible />);
 const proxy = view.container.querySelector('.composer textarea') as HTMLTextAreaElement;
 vi.spyOn(proxy, 'getBoundingClientRect').mockReturnValue({ x: 50, y: 500, left: 50, top: 500, right: 350, bottom: 550, width: 300, height: 50 } as DOMRect);
 act(() => window.dispatchEvent(new Event('resize')));
 expect(runtime.snapshot().webComposer).toMatchObject({ rect: { x: 50, y: 500, width: 300, height: 50 }, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
 const state = (contextId: string, start: number, end: number, focused = true) => act(() => window.dispatchEvent(new CustomEvent('codex-mobile-native-editor-state', { detail: { contextId, selectionStart: start, selectionEnd: end, focused } })));
 state('a:t', 2, 4);
 expect(proxy.selectionStart).toBe(2); expect(proxy.selectionEnd).toBe(4);
 expect(runtime.snapshot().webComposer).toMatchObject({ focused: true, selectionStart: 2, selectionEnd: 4 });
 state('a:old', 0, 0, false); state('a:t', NaN, 5); state('a:t', 4, 99);
 expect(runtime.snapshot().webComposer).toMatchObject({ focused: true, selectionStart: 2, selectionEnd: 4 });
 vi.mocked(proxy.getBoundingClientRect).mockReturnValue({ x: NaN, y: 10, width: 300, height: 50 } as DOMRect);
 act(() => window.dispatchEvent(new Event('resize')));
 expect(runtime.snapshot().webComposer?.rect).toBeUndefined();
 view.unmount(); expect(runtime.snapshot().webComposer).toBeUndefined(); runtime.dispose();
});
it.each([false, true])('原生文字模式的附件、发送和设置均调用原网页回调（modern=%s）', modern => {
 hybrid(); localStorage.setItem(WEB_INTERFACE_KEY, modern ? 'modern' : 'legacy');
 const runtime = new bridge.NativeRuntime(() => {});
 const submit = vi.fn(event => event.preventDefault()); const model = vi.fn(); const permission = vi.fn(); const speed = vi.fn(); const location = vi.fn(async () => true);
 const view = render(<WebInterfaceProvider><ConversationPage {...pageProps} nativeRuntime={runtime} nativeContextId="a:t" conversationVisible onSubmit={submit} onOpenAgentSettings={model} onOpenPermissionSettings={permission} onOpenSpeedSettings={speed} onSelectLocation={location} /></WebInterfaceProvider>);
 fireEvent.click(screen.getByRole('button', { name: modern ? '选择模型与思考强度' : '选择模型、智能与速度' })); expect(model).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button', { name: '选择审批与权限模式' })); expect(permission).toHaveBeenCalledOnce();
 if (modern) { fireEvent.click(screen.getByRole('button', { name: '选择速度' })); expect(speed).toHaveBeenCalledOnce(); }
 fireEvent.click(screen.getByRole('button', { name: '添加附件' })); expect(screen.getByRole('menu', { name: '附件菜单' })).toBeVisible();
 fireEvent.click(screen.getByRole('menuitem', { name: '当前位置' })); expect(location).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button', { name: '发送' })); expect(submit).toHaveBeenCalledOnce();
 view.unmount(); runtime.dispose();
});

it('网页遮罩期间迟到原生动作不能改草稿，关闭后必须有当前挂载登记', async () => {
 hybrid(); const runtime = new bridge.NativeRuntime(() => {}); let calls = 0;
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] }); runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t' }, { 'message.send': () => { calls++; } });
 expect((await runtime.dispatch({ id: 'unmounted', name: 'message.send', params: { contextId: 'a:t' } })).ok).toBe(false);
 runtime.setWebComposer('a', { contextId: 'a:t', visible: true, blocked: true });
 expect((await runtime.dispatch({ id: 'covered', name: 'message.send', params: { contextId: 'a:t' } })).ok).toBe(false);
 runtime.setWebComposer('a', { contextId: 'a:t', visible: true, blocked: false });
 expect((await runtime.dispatch({ id: 'visible', name: 'message.send', params: { contextId: 'a:t' } })).ok).toBe(true);
 expect(calls).toBe(1); runtime.dispose();
});

it.each([false, true])('业务错误保持关闭和新错误恢复能力，混合模式移入历史末尾（hybrid=%s）', enabled => {
 if (enabled) hybrid();
 const runtime = enabled ? new bridge.NativeRuntime(() => {}) : null;
 const styles = readFileSync('src/styles.css', 'utf8');
 const errorRules = styles.match(/(?:\[data-native-composer="true"\]\s+)?\.error-banner\s*\{[^}]*\}/g)?.join('\n') ?? '';
 const page = (error: string) => <><style>{errorRules}</style><ConversationPage {...pageProps} error={error} nativeRuntime={runtime} nativeContextId="a:t" conversationVisible /></>;
 const view = render(page('首次业务失败'));
 const alert = screen.getByRole('alert');
 const content = view.container.querySelector('.conversation-scroll-content')!;
 expect(content.contains(alert)).toBe(enabled);
 if (enabled) expect(alert.closest('.timeline')).not.toBeNull();
 expect(getComputedStyle(alert).position).toBe(enabled ? 'static' : 'fixed');
 expect(getComputedStyle(alert).transform).toBe(enabled ? 'none' : 'translateX(-50%)');
 expect(screen.getAllByText('首次业务失败')).toHaveLength(1);
 fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' })); expect(screen.queryByRole('alert')).toBeNull();
 view.rerender(page('首次业务失败')); expect(screen.queryByRole('alert')).toBeNull();
 view.rerender(page('后续业务失败')); expect(screen.getByRole('alert')).toHaveTextContent('后续业务失败');
 fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }));
 view.rerender(page('')); view.rerender(page('后续业务失败')); expect(screen.getByRole('alert')).toHaveTextContent('后续业务失败');
 runtime?.dispose();
});

function WebInterfaceToggle() {
 const { modern, change } = useWebInterface();
 return <button onClick={() => change(!modern)}>切换网页模式</button>;
}
it('真实网页会话发布当前正文基准字号，切换界面时更新且不重复应用字号缩放', () => {
 hybrid(); const runtime = new bridge.NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] });
 runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t', fontScale: 0.875 }, {});
 const view = render(<WebInterfaceProvider><ConversationPage {...pageProps} nativeRuntime={runtime} nativeContextId="a:t" conversationVisible /><WebInterfaceToggle /></WebInterfaceProvider>);
 expect(runtime.snapshot().webComposer).toMatchObject({ contextId: 'a:t', bodyFontSize: 16 });
 fireEvent.click(screen.getByRole('button', { name: '切换网页模式' }));
 expect(document.documentElement.dataset.webInterface).toBe('modern');
 expect(runtime.snapshot().webComposer).toMatchObject({ contextId: 'a:t', bodyFontSize: 14.2 });
 fireEvent.click(screen.getByRole('button', { name: '切换网页模式' }));
 expect(runtime.snapshot().webComposer).toMatchObject({ contextId: 'a:t', bodyFontSize: 16 });
 view.unmount(); expect(runtime.snapshot().webComposer).toBeUndefined(); runtime.dispose();
});
it('字号投影使用实际界面上下文，不从保存的新版偏好推断', () => {
 hybrid(); localStorage.setItem(WEB_INTERFACE_KEY, 'modern');
 const runtime = new bridge.NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] });
 runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t' }, {});
 render(<ConversationPage {...pageProps} nativeRuntime={runtime} nativeContextId="a:t" conversationVisible />);
 expect(runtime.snapshot().webComposer).toMatchObject({ bodyFontSize: 16 });
 runtime.dispose();
});

it('新context可先于workspace登记，旧context几何更新和清理不能覆盖新会话', () => {
 const runtime = new bridge.NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] });
 runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:old' }, {});
 runtime.setWebComposer('a', { contextId: 'a:old', visible: true, blocked: false });
 runtime.setWebComposer('a', { contextId: 'a:new', visible: true, blocked: false });
 runtime.setWebComposer('a', { contextId: 'a:old', visible: false, blocked: true }, 'a:old');
 runtime.setWebComposer('a', undefined, 'a:old');
 runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:new' }, {});
 expect(runtime.snapshot().webComposer).toMatchObject({ contextId: 'a:new', visible: true, blocked: false }); runtime.dispose();
});
it.each([false, true])('网页设置关闭恢复同context的原生焦点和UTF16选区，旧回调不能聚焦新会话（modern=%s）', modern => {
 hybrid(); localStorage.setItem(WEB_INTERFACE_KEY, modern ? 'modern' : 'legacy');
 const runtime = new bridge.NativeRuntime(() => {}); let restore: (() => void) | undefined;
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] });
 runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t' }, {});
 const props = { ...pageProps, nativeRuntime: runtime, nativeContextId: 'a:t', conversationVisible: true, onOpenAgentSettings: (callback?: () => void) => { restore = callback; } };
 const page = (contextId = 'a:t', covered = false) => <WebInterfaceProvider><ConversationPage {...props} nativeContextId={contextId} webOverlayOpen={covered} /></WebInterfaceProvider>;
 const view = render(page());
 act(() => window.dispatchEvent(new CustomEvent('codex-mobile-native-editor-state', { detail: { contextId: 'a:t', focused: true, selectionStart: 2, selectionEnd: 4 } })));
 const button = screen.getByRole('button', { name: modern ? '选择模型与思考强度' : '选择模型、智能与速度' });
 fireEvent.pointerDown(button); fireEvent.click(button); expect(restore).toBeTypeOf('function');
 view.rerender(page('a:t', true)); act(() => restore?.()); view.rerender(page());
 expect(runtime.snapshot().webComposer).toMatchObject({ focused: true, selectionStart: 2, selectionEnd: 4 });
 view.rerender(page('a:new')); runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:new' }, {});
 act(() => restore?.()); expect(runtime.snapshot().webComposer?.focused).toBe(false);
 view.unmount(); runtime.dispose();
});
it('宿主后台立即阻止混合文字编辑与迟到焦点', () => {
 hybrid(); const runtime = new bridge.NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] }); runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t' }, {});
 const view = render(<ConversationPage {...pageProps} nativeRuntime={runtime} nativeContextId="a:t" conversationVisible />);
 (window as any).__CODEX_NATIVE_ACTIVE__ = false;
 act(() => window.dispatchEvent(new Event('visibilitychange')));
 act(() => window.dispatchEvent(new CustomEvent('codex-mobile-native-editor-state', { detail: { contextId: 'a:t', focused: true, selectionStart: 2, selectionEnd: 4 } })));
 expect(runtime.snapshot().webComposer).toMatchObject({ blocked: true, focused: false });
 view.unmount(); runtime.dispose();
});

it.each([false, true])('混合代理与原生文字使用正文基准乘一次iOS字号，独立于Web防缩放字号（modern=%s）', modern => {
 hybrid(); (window as any).__CODEX_IOS_HOST__ = true;
 localStorage.setItem(WEB_INTERFACE_KEY, modern ? 'modern' : 'legacy');
 const runtime = new bridge.NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] }); runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t' }, {});
 const view = render(<WebInterfaceProvider><ConversationPage {...pageProps} nativeRuntime={runtime} nativeContextId="a:t" conversationVisible /></WebInterfaceProvider>);
 const proxy = view.container.querySelector('.composer textarea') as HTMLTextAreaElement;
 const expectedSize = (modern ? 14.2 : 16) * 0.875;
 expect(parseFloat(proxy.style.fontSize)).toBeCloseTo(expectedSize);
 expect(runtime.snapshot().webComposer?.fontSize).toBeCloseTo(expectedSize);
 const modernCSS = readFileSync('src/features/web-ui/modern.css', 'utf8');
 expect(modernCSS).toContain('font-size: max(16px,1rem)');
 view.unmount(); expect(proxy.style.fontSize).toBe(''); runtime.dispose();
});

it('原生焦点观察与显式网页焦点请求分离，观察echo不推进请求版本', () => {
 hybrid(); const runtime = new bridge.NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] }); runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t' }, {});
 const view = render(<ConversationPage {...pageProps} nativeRuntime={runtime} nativeContextId="a:t" conversationVisible />);
 const proxy = view.container.querySelector('.composer textarea') as HTMLTextAreaElement;
 act(() => window.dispatchEvent(new CustomEvent('codex-mobile-native-editor-state', { detail: { contextId: 'a:t', focused: true, selectionStart: 2, selectionEnd: 4 } })));
 expect(runtime.snapshot().webComposer).toMatchObject({ focused: true, focusRevision: 0 });
 act(() => proxy.focus()); expect(runtime.snapshot().webComposer).toMatchObject({ focused: true, focusRevision: 1 });
 act(() => proxy.blur()); expect(runtime.snapshot().webComposer).toMatchObject({ focused: false, focusRevision: 2 });
 view.unmount(); runtime.dispose();
});

it('旧context位置选择晚完成不能请求新会话焦点', async () => {
 hybrid(); const runtime = new bridge.NativeRuntime(() => {}); let finish!: (value: boolean) => void;
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] }); runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t' }, {});
 const location = () => new Promise<boolean>(resolve => { finish = resolve; });
 const view = render(<ConversationPage {...pageProps} nativeRuntime={runtime} nativeContextId="a:t" conversationVisible onSelectLocation={location} />);
 fireEvent.click(screen.getByRole('button', { name: '添加附件' })); fireEvent.click(screen.getByRole('menuitem', { name: '当前位置' }));
 view.rerender(<ConversationPage {...pageProps} nativeRuntime={runtime} nativeContextId="a:new" conversationVisible onSelectLocation={location} />);
 runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:new' }, {});
 await act(async () => { finish(true); });
 expect(runtime.snapshot().webComposer?.focused).toBe(false);
 view.unmount(); runtime.dispose();
});

it.each(['skill', 'plugin'] as const)('旧context的%s插入动画回调不能聚焦新会话', kind => {
 hybrid(); const runtime = new bridge.NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] }); runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t' }, {});
 const props = { ...pageProps, draft: '@p', skills: [{ name: 'pdf', path: '/pdf/SKILL.md', description: 'PDF', scope: 'user', enabled: true }], plugins: [{ id: 'pdf-plugin', name: 'pdf-plugin', installed: true, enabled: true, availability: 'AVAILABLE' }] } as Parameters<typeof ConversationPage>[0];
 const view = render(<ConversationPage {...props} nativeRuntime={runtime} nativeContextId="a:t" conversationVisible />);
 act(() => window.dispatchEvent(new CustomEvent('codex-mobile-native-editor-state', { detail: { contextId: 'a:t', focused: true, selectionStart: 2, selectionEnd: 2 } })));
 const callbacks: FrameRequestCallback[] = []; vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callbacks.push(callback); return callbacks.length; });
 fireEvent.click(screen.getByRole('option', { name: kind === 'skill' ? /\$pdf/ : /@pdf-plugin/ }));
 view.rerender(<ConversationPage {...props} nativeRuntime={runtime} nativeContextId="a:new" conversationVisible />);
 runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:new' }, {});
 act(() => callbacks.forEach(callback => callback(0)));
 expect(runtime.snapshot().webComposer?.focused).toBe(false);
 view.unmount(); runtime.dispose();
});

it.each([
 [false, '选择模型、智能与速度', '智能'], [false, '选择审批与权限模式', '权限模式'],
 [true, '选择模型与思考强度', '模型与思考强度'], [true, '选择审批与权限模式', '权限模式'], [true, '选择速度', '速度'],
] as const)('设置按钮的pointerdown→原生失焦→click保留工具栏并打开网页选项（modern=%s，%s）', (modern, buttonName, title) => {
 hybrid(); localStorage.setItem(WEB_INTERFACE_KEY, modern ? 'modern' : 'legacy');
 const runtime = new bridge.NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] }); runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t' }, {});
 const modernCSS = readFileSync('src/features/web-ui/modern.css', 'utf8');
 const configurationCSS = modernCSS.split('\n').filter(line => line.includes('.modern-composer-configuration {')).join('\n');
 function Handoff() {
  const [picker, setPicker] = useState<ComposerPicker>(null);
  return <WebInterfaceProvider><style>{configurationCSS}</style>
   <ConversationPage {...pageProps} nativeRuntime={runtime} nativeContextId="a:t" conversationVisible webOverlayOpen={picker !== null}
    onOpenAgentSettings={() => setPicker('agent')} onOpenPermissionSettings={() => setPicker('permission')} onOpenSpeedSettings={() => setPicker('speed')} />
   <ComposerSettings picker={picker} effortOptions={[]} speedOptions={[]} permissionModes={[]} models={[]} selectedEffort={null} selectedModel="" selectedModelLabel="Codex" selectedServiceTier={null} selectedSpeedLabel="普通" selectedPermissionModeId={null}
    onPickerChange={setPicker} onChooseEffort={() => {}} onChooseModel={() => {}} onChooseSpeed={() => {}} onChoosePermissionMode={() => {}} />
  </WebInterfaceProvider>;
 }
 const view = render(<Handoff />);
 const state = (focused: boolean) => act(() => window.dispatchEvent(new CustomEvent('codex-mobile-native-editor-state', { detail: { contextId: 'a:t', focused, selectionStart: 2, selectionEnd: 4 } })));
 state(true);
 const trigger = screen.getByRole('button', { name: buttonName });
 fireEvent.pointerDown(trigger);
 state(false);
 if (modern) expect(view.container.querySelector('.composer-wrap')).toHaveAttribute('data-expanded', 'true');
 expect(screen.getByRole('button', { name: buttonName })).toBeVisible();
 fireEvent.click(trigger);
 expect(screen.getByRole(modern ? 'dialog' : 'region', { name: title })).toBeVisible();
 view.unmount(); runtime.dispose();
});
