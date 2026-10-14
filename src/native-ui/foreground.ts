import { isNativeUIEnabled } from './runtime';
/** WK 宿主可见性由 scene 显式传递，普通网页保持浏览器语义。 */
export function isClientForeground(target: { visibilityState: DocumentVisibilityState } = document): boolean {
  const nativeActive = typeof window === 'undefined' ? undefined : (window as Window & { __CODEX_NATIVE_ACTIVE__?: boolean }).__CODEX_NATIVE_ACTIVE__;
  return isNativeUIEnabled() && typeof nativeActive === 'boolean' ? nativeActive : target.visibilityState === 'visible';
}
