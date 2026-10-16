import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as bridge from '../../src/native-ui/runtime';
import { useNativeRuntime } from '../../src/native-ui/adapters';
import { emptyNativeSnapshot } from '../../src/native-ui/protocol';

afterEach(() => { cleanup(); for (const key of ['__CODEX_NATIVE_UI__', '__CODEX_NATIVE_COMPOSER__', '__CODEX_NATIVE_UI_RECOVERED__', 'webkit']) delete (window as any)[key]; });
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

import { createRef } from 'react';
import { ConversationPage } from '../../src/features/conversation/ConversationPage';
import { useOverlayScrollIsolation } from '../../src/ui/overlay-scroll';
const pageProps = {
 active: { id: 't', turns: [] }, backendId: 'a', backendName: 'Mac', backends: [], projectOptions: [], loadState: 'ready', loadError: '', olderTurnsState: 'exhausted', connection: 'online', client: null, error: '', draft: '中文😀尾文本', draftImages: [], draftFiles: [], imageReading: false, busy: false, steering: false, steerable: false, pendingSteerText: '', queuedFollowUps: [], accessMode: 'interactive', resumeError: '', tokenUsage: null, rateLimits: null, pendingAction: '', selectedServiceTier: null, selectedModelLabel: 'Codex', selectedEffort: null, selectedPermissionLabel: '工作区', imageInputRef: createRef<HTMLInputElement>(), onBack() {}, onNewChatBackendChange() {}, onNewChatProjectChange() {}, onPin: async () => true, onDuplicate: async () => true, onRename: async () => true, onArchive: async () => true, onRetry() {}, onLoadOlderTurns: async () => true, onSubmit() {}, onRemoveImage() {}, onRemoveFile() {}, onSelectImages: async () => {}, onSelectLocation: async () => true, onOpenAgentSettings() {}, onOpenPermissionSettings() {}, onDraftChange() {}, onInterrupt() {}, onQueuedFollowUpAction() {},
} as Parameters<typeof ConversationPage>[0];
function Overlay({ open }: { open: boolean }) { const ref = createRef<HTMLDivElement>(); useOverlayScrollIsolation(open, ref); return <div ref={ref} />; }
it('真实网页会话卸载Web表单，公共遮罩与当前可见状态控制原生呈现', () => {
 hybrid(); const runtime = new bridge.NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'a', backends: [], groups: [] }); runtime.setWorkspace('a', { ...emptyNativeSnapshot(), ready: true, contextId: 'a:t' }, {});
 const props = { ...pageProps, nativeRuntime: runtime, nativeContextId: 'a:t', conversationVisible: true };
 const view = render(<><ConversationPage {...props} /><Overlay open={false} /></>);
 expect(screen.queryByRole('textbox', { name: '向 Codex 提问' })).toBeNull();
 expect((runtime.snapshot() as any).webComposer).toEqual({ contextId: 'a:t', visible: true, blocked: false });
 view.rerender(<><ConversationPage {...props} /><Overlay open /></>); expect((runtime.snapshot() as any).webComposer.blocked).toBe(true);
 view.rerender(<><ConversationPage {...props} conversationVisible={false} /><Overlay open={false} /></>); expect((runtime.snapshot() as any).webComposer.visible).toBe(false);
 view.unmount(); expect((runtime.snapshot() as any).webComposer).toBeUndefined(); runtime.dispose();
});
it('原生布局按真实WebView比例计算遮挡，拒绝旧context并清理CSS', () => {
 hybrid(); const runtime = new bridge.NativeRuntime(() => {});
 const view = render(<ConversationPage {...pageProps} nativeRuntime={runtime} nativeContextId="a:t" conversationVisible />);
 const scroll = view.container.querySelector('.conversation-scroll') as HTMLElement;
 vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({ bottom: 700 } as DOMRect);
 const layout = (contextId: string, top: number) => act(() => { window.dispatchEvent(new CustomEvent('codex-mobile-native-composer-layout', { detail: { contextId, top, webViewHeight: window.innerHeight } })); });
 layout('a:t', 500); expect(scroll.style.getPropertyValue('--native-composer-occlusion')).toBe('200px');
 layout('a:old', 100); expect(scroll.style.getPropertyValue('--native-composer-occlusion')).toBe('200px');
 layout('a:t', 0); expect(scroll.style.getPropertyValue('--native-composer-occlusion')).toBe('700px');
 layout('a:t', window.innerHeight); expect(scroll.style.getPropertyValue('--native-composer-occlusion')).toBe('0px');
 view.unmount(); expect(scroll.style.getPropertyValue('--native-composer-occlusion')).toBe(''); runtime.dispose();
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
