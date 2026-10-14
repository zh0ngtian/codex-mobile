import { useEffect, useRef, useState } from 'react';
import { NativeRuntime, isNativeUIEnabled, publishNativeSnapshot } from './runtime';
import type { NativeHandlers, NativeNavigation, NativeParams, NativeSnapshot } from './protocol';

/** callback 只通过 latest ref 执行，事件订阅不捕获旧草稿、模型或会话。 */
function useLatestHandlers(handlers: NativeHandlers): NativeHandlers {
  const latest = useRef(handlers); latest.current = handlers;
  return Object.fromEntries(Object.keys(handlers).map(name => [name, (params: NativeParams) => {
    const handler = latest.current[name];
    if (!handler) throw new Error('此操作在当前上下文不可用');
    return handler(params);
  }]));
}
export function useNativeRuntime(navigation: NativeNavigation, handlers: NativeHandlers): NativeRuntime | null {
  const [runtime] = useState(() => isNativeUIEnabled() ? new NativeRuntime(publishNativeSnapshot) : null);
  const currentHandlers = useLatestHandlers(handlers);
  useEffect(() => { runtime?.listen(); return () => runtime?.dispose(); }, [runtime]);
  useEffect(() => { runtime?.setNavigation(navigation, currentHandlers); });
  return runtime;
}
export function useNativeWorkspace(runtime: NativeRuntime | null, id: string, value: NativeSnapshot, handlers: NativeHandlers) {
  const currentHandlers = useLatestHandlers(handlers);
  useEffect(() => { runtime?.setWorkspace(id, value, currentHandlers); });
  useEffect(() => () => runtime?.removeWorkspace(id), [runtime, id]);
}
