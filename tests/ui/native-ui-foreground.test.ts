import { afterEach, expect, it } from 'vitest';
import { isClientForeground } from '../../src/native-ui/foreground';
afterEach(() => { delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).__CODEX_NATIVE_ACTIVE__; delete (window as any).webkit; });
it('隐藏WK继续用显式原生scene前台信号，后台确实暂停，网页仍用可见性', () => {
  const hidden = { visibilityState: 'hidden' as const };
  expect(isClientForeground(hidden)).toBe(false);
  Object.assign(window, { __CODEX_NATIVE_UI__: true, __CODEX_NATIVE_ACTIVE__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } } });
  expect(isClientForeground(hidden)).toBe(true);
  (window as any).__CODEX_NATIVE_ACTIVE__ = false;
  expect(isClientForeground({ visibilityState: 'visible' })).toBe(false);
  (window as any).__CODEX_NATIVE_UI__ = false;
  expect(isClientForeground({ visibilityState: 'visible' })).toBe(true);
});
