import { useLayoutEffect, useRef, useState } from 'react';
import { NativeRuntime, isNativeUIEnabled, publishNativeSnapshot } from './runtime';
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
export function useNativeRuntime(navigation: NativeNavigation, handlers: NativeHandlers): NativeRuntime | null {
  const [runtime] = useState(() => isNativeUIEnabled() ? new NativeRuntime(publishNativeSnapshot) : null);
  useLayoutEffect(() => { runtime?.listen(); return () => runtime?.dispose(); }, [runtime]);
  useCommittedRegistration(handlers, committed => runtime?.setNavigation(navigation, committed));
  return runtime;
}
export function useNativeWorkspace(runtime: NativeRuntime | null, id: string, value: NativeSnapshot, handlers: NativeHandlers) {
  useCommittedRegistration(handlers, committed => runtime?.setWorkspace(id, value, committed));
  useLayoutEffect(() => () => runtime?.removeWorkspace(id), [runtime, id]);
}
