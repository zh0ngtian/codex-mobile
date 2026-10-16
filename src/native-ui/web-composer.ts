import { useLayoutEffect, useSyncExternalStore, type RefObject } from 'react';
import { hasOverlayPresence, subscribeOverlayPresence } from '../ui/overlay-scroll';
import { isNativeBridgeEnabled, isNativeUIEnabled, type NativeRuntime } from './runtime';

export function isNativeWebComposerEnabled() { return isNativeBridgeEnabled() && !isNativeUIEnabled(); }
function subscribeRecovery(callback: () => void) {
  window.addEventListener('codex-mobile-native-recovery', callback);
  return () => window.removeEventListener('codex-mobile-native-recovery', callback);
}
/** 挂载页面拥有呈现权；后台workspace继续复用原有adapter，但不显示输入栏。 */
export function useNativeWebComposer(runtime: NativeRuntime | null, backendId: string, contextId: string, visible: boolean, blocked: boolean, scrollRef: RefObject<HTMLElement | null>) {
  const capable = useSyncExternalStore(subscribeRecovery, isNativeWebComposerEnabled, () => false);
  const overlay = useSyncExternalStore(subscribeOverlayPresence, hasOverlayPresence, () => false);
  const enabled = capable && runtime !== null;
  useLayoutEffect(() => {
    if (enabled) runtime.setWebComposer(backendId, { contextId, visible, blocked: blocked || overlay });
  }, [runtime, backendId, contextId, enabled, visible, blocked, overlay]);
  useLayoutEffect(() => () => runtime?.setWebComposer(backendId, undefined, contextId), [runtime, backendId, contextId]);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!enabled || !scroll) return;
    let geometry: { top: number; webViewHeight: number } | undefined;
    const update = () => {
      const top = geometry ? geometry.top * window.innerHeight / geometry.webViewHeight : undefined;
      scroll.style.setProperty('--native-composer-occlusion', `${top === undefined ? 0 : Math.max(0, scroll.getBoundingClientRect().bottom - top)}px`);
    };
    const layout = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.contextId !== contextId || typeof detail.top !== 'number' || !Number.isFinite(detail.top) || detail.top < 0 || typeof detail.webViewHeight !== 'number' || !Number.isFinite(detail.webViewHeight) || detail.webViewHeight <= 0) return;
      geometry = detail; update();
    };
    window.addEventListener('codex-mobile-native-composer-layout', layout);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('codex-mobile-native-composer-layout', layout); window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update);
      scroll.style.removeProperty('--native-composer-occlusion');
    };
  }, [enabled, contextId, scrollRef]);
  return enabled;
}
