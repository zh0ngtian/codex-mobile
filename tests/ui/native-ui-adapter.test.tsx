import { StrictMode, useLayoutEffect, useState } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useNativeRuntime, useNativeWorkspace } from '../../src/native-ui/adapters';
import { emptyNativeSnapshot } from '../../src/native-ui/protocol';
const posts: any[] = [];
function Harness() {
  const [draft, setDraft] = useState(''); const [sidebar, setSidebar] = useState(false);
  const runtime = useNativeRuntime({ selectedBackendId: 'b', backends: [], groups: [], sidebarOpen: sidebar }, { 'navigation.sidebar': p => setSidebar(Boolean(p.open)) });
  useNativeWorkspace(runtime, 'b', { ...emptyNativeSnapshot(), contextId: 'b:t', backendId: 'b', ready: true, draft }, { 'draft.set': p => setDraft(String(p.value)) });
  return <output>{draft}</output>;
}
afterEach(() => { cleanup(); delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).webkit; delete (window as any).codexMobilePublishNativeSnapshot; vi.useRealTimers(); posts.length = 0; });
it('真实React适配器订阅纯事件并回写业务状态，清理后迟到事件不再执行', async () => {
  vi.useFakeTimers(); Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (s: unknown) => posts.push(s) });
  const view = render(<Harness />);
  await act(async () => { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id: 'd', name: 'draft.set', params: { contextId: 'b:t', value: '真实输入', revision: 1 } } })); });
  expect(view.container.textContent).toBe('真实输入');
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  expect(posts.at(-1)).toMatchObject({ draft: '真实输入', draftRevision: 1 });
  view.unmount();
  await act(async () => { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id: 'late', name: 'draft.set', params: { contextId: 'b:t', value: '迟到', revision: 2 } } })); await vi.runAllTimersAsync(); });
  expect(posts).toHaveLength(1);
});
it('默认网页模式不注册新命令监听也不发布快照', async () => {
  vi.useFakeTimers(); const view = render(<Harness />);
  await act(async () => { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id: 'd', name: 'draft.set', params: { contextId: 'b:t', value: '误写', revision: 1 } } })); await vi.runAllTimersAsync(); });
  expect(view.container.textContent).toBe(''); expect(posts).toHaveLength(0);
});

it('React StrictMode清理重挂后仍发布且只订阅一次', async () => {
 vi.useFakeTimers(); Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (s: unknown) => posts.push(s) });
 const view = render(<StrictMode><Harness /></StrictMode>);
 await act(async () => { await vi.advanceTimersByTimeAsync(40); });
 expect(posts).toHaveLength(1);
 await act(async () => { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id: 'strict-d', name: 'draft.set', params: { contextId: 'b:t', value: '严格模式', revision: 1 } } })); });
 expect(view.container.textContent).toBe('严格模式');
});

it('提交新会话的布局effect中迟到旧命令不能执行新会话回调', async () => {
 Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } } });
 const writes: Array<{ contextId: string; value: string }> = [];
 function ContextHarness({ contextId }: { contextId: string }) {
  const runtime = useNativeRuntime({ selectedBackendId: 'b', backends: [], groups: [] }, {});
  useNativeWorkspace(runtime, 'b', { ...emptyNativeSnapshot(), ready: true, backendId: 'b', contextId }, {
   'draft.set': params => { writes.push({ contextId, value: String(params.value) }); },
  });
  useLayoutEffect(() => {
   if (contextId !== 'new') return;
   for (const [id, context, value] of [['old-request', 'old', 'stale draft'], ['new-request', 'new', 'fresh draft']]) {
    window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name: 'draft.set', params: { contextId: context, value, revision: 1 } } }));
   }
  }, [contextId]);
  return null;
 }
 const view = render(<ContextHarness contextId="old" />);
 await act(async () => { view.rerender(<ContextHarness contextId="new" />); });
 expect(writes).toEqual([{ contextId: 'new', value: 'fresh draft' }]);
});
it('导航状态与回调在同一布局提交更新，不会校验旧设备却调用新设备回调', async () => {
 Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } } });
 const actions: Array<{ callbackBackend: string; snapshotBackend?: string }> = [];
 function NavigationHarness({ backendId }: { backendId: string }) {
  const runtime = useNativeRuntime({ selectedBackendId: backendId, backends: [], groups: [] }, {
   'thread.new': () => { actions.push({ callbackBackend: backendId, snapshotBackend: runtime?.snapshot().backendId }); },
  });
  useNativeWorkspace(runtime, backendId, { ...emptyNativeSnapshot(), ready: true, backendId, contextId: backendId }, {});
  useLayoutEffect(() => {
   if (backendId === 'new') window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id: 'new-navigation', name: 'thread.new', params: {} } }));
  }, [backendId]);
  return null;
 }
 const view = render(<NavigationHarness backendId="old" />);
 await act(async () => { view.rerender(<NavigationHarness backendId="new" />); });
 expect(actions).toEqual([{ callbackBackend: 'new', snapshotBackend: 'new' }]);
});
