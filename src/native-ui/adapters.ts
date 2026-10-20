import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { NativeRuntime, isNativeBridgeEnabled, publishNativeSnapshot } from './runtime';
import { useNativeSwitch } from './switch-context';
import type { NativeHandlers, NativeNavigation, NativeParams, NativeSnapshot } from './protocol';

/** 快照/context 与 callback ref 在同一提交 effect 注册；render 不能提前暴露新回调。 */
function useCommittedRegistration(handlers: NativeHandlers, register: (handlers: NativeHandlers) => void) {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
    register(Object.fromEntries(Object.keys(handlers).map(name => [name, (params: NativeParams) => {
      const handler = latest.current[name];
      if (!handler) throw new Error('此操作在当前上下文不可用');
      return handler(params);
    }])));
  });
}
// 人工错误恢复只关闭呈现层，不重挂业务workspace或更改本进程冻结模式。
function subscribeRecovery(callback: () => void) {
  window.addEventListener('codex-mobile-native-recovery', callback);
  return () => window.removeEventListener('codex-mobile-native-recovery', callback);
}
export function useNativeRuntime(navigation: NativeNavigation, handlers: NativeHandlers): NativeRuntime | null {
  const preference = useNativeSwitch();
  const preferenceRef = useRef(preference);
  useLayoutEffect(() => { preferenceRef.current = preference; });
  const enabled = useSyncExternalStore(subscribeRecovery, isNativeBridgeEnabled, () => false);
  const [cachedRuntime] = useState(() => enabled ? new NativeRuntime(publishNativeSnapshot, () => preferenceRef.current?.changed()) : null);
  const runtime = enabled ? cachedRuntime : null;
  useLayoutEffect(() => { runtime?.listen(); return () => runtime?.dispose(); }, [runtime]);
  useCommittedRegistration({ ...handlers, ...(preference ? { 'settings.native-ui': (params: NativeParams) => preference.change(params.enabled as boolean) } : {}) }, committed => runtime?.setNavigation({ ...navigation, error: preference?.error || navigation.error }, committed));
  return runtime;
}
export function useNativeWorkspace(runtime: NativeRuntime | null, id: string, value: NativeSnapshot, handlers: NativeHandlers) {
  useCommittedRegistration(handlers, committed => runtime?.setWorkspace(id, value, committed));
  useLayoutEffect(() => () => runtime?.removeWorkspace(id), [runtime, id]);
}

/** 全局面板复用各组件已有状态，仅注册其展示与显式回调。 */
export function useNativeGlobalPanel(runtime: NativeRuntime | null | undefined, id: string, panel: NativeSnapshot['panel'], handlers: NativeHandlers) {
  useCommittedRegistration(handlers, committed => runtime?.setGlobalPanel(id, panel, committed));
  useLayoutEffect(() => () => runtime?.removeGlobalPanel(id), [runtime, id]);
}
