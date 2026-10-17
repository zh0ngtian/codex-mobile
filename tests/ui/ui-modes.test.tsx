import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';
import { useNativeRuntime } from '../../src/native-ui/adapters';
import { NativeRuntime, isNativeBridgeEnabled, isNativeUIEnabled } from '../../src/native-ui/runtime';

const host = window as any;
beforeEach(() => { localStorage.clear(); vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => {
  cleanup(); localStorage.clear(); vi.unstubAllGlobals();
  for (const key of ['__CODEX_IOS_HOST__', '__CODEX_NATIVE_UI__', '__CODEX_NATIVE_COMPOSER__', '__CODEX_NATIVE_UI_RECOVERED__', 'webkit', 'codexMobileNativePreference', 'codexMobileNativePreferenceComplete']) delete host[key];
});
it.each([null, 'modern'])('非原生设置忽略旧网页模式 %s，保留可保存的原生界面开关', async saved => {
  if (saved) localStorage.setItem('codex-mobile:web-interface', saved);
  const requests: any[] = [];
  Object.assign(host, { __CODEX_IOS_HOST__: true, __CODEX_NATIVE_UI__: false,
    webkit: { messageHandlers: { nativeUI: { postMessage(message: any) {
      requests.push(message);
      if (message.type === 'nativePreference') queueMicrotask(() => host.codexMobileNativePreferenceComplete({ id: message.id, enabled: message.enabled ?? false, active: false }));
    } } } } });
  render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: '', backends: [] }} />);
  const toggle = await screen.findByRole('checkbox', { name: '使用原生界面' });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  expect(screen.queryByRole('checkbox', { name: '使用新版界面' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: '使用原生输入框' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByRole('dialog', { name: '管理设备' })).toBeInTheDocument();
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeChecked());
  expect(requests.some(message => message.type === 'nativePreference' && message.enabled === true)).toBe(true);
  expect(requests.some(message => message.kind === 'composer')).toBe(false);
  expect(host.__CODEX_NATIVE_UI__).toBe(false);
});
it('旧独立输入框启动标记不再激活 runtime，完整原生与人工恢复仍生效', async () => {
  Object.assign(host, { __CODEX_NATIVE_COMPOSER__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } } });
  const navigation = { selectedBackendId: '', backends: [], groups: [] };
  expect(isNativeBridgeEnabled()).toBe(false);
  const old = renderHook(() => useNativeRuntime(navigation, {}));
  expect(old.result.current).toBeNull(); old.unmount();
  host.__CODEX_NATIVE_UI__ = true;
  expect(isNativeUIEnabled()).toBe(true);
  const current = renderHook(() => useNativeRuntime(navigation, {}));
  expect(current.result.current?.listenerCount).toBe(1);
  await act(async () => { host.__CODEX_NATIVE_UI_RECOVERED__ = true; window.dispatchEvent(new Event('codex-mobile-native-recovery')); });
  expect(isNativeUIEnabled()).toBe(false);
  expect(isNativeBridgeEnabled()).toBe(false);
  expect(current.result.current).toBeNull();
});

it('已撤销的独立原生输入框命令不能调用设置 handler', async () => {
  const changed = vi.fn(); const runtime = new NativeRuntime(() => {});
  runtime.setNavigation({ selectedBackendId: '', backends: [], groups: [] }, { 'settings.native-composer': changed });
  const result = await runtime.dispatch({ id: 'stale-composer-setting', name: 'settings.native-composer', params: { enabled: true } });
  expect(result.ok).toBe(false); expect(changed).not.toHaveBeenCalled();
  runtime.dispose();
});
