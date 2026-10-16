import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BackendManagerSheet } from '../../src/features/backends/BackendManagerSheet';
import { WebInterfaceProvider } from '../../src/features/web-ui/preference';
import { FontSizeSettings } from '../../src/features/settings/FontSizeSettings';
import { NativeRuntime } from '../../src/native-ui/runtime';
import { applyFontSize, FONT_SIZE_STORAGE_KEY, readFontSize } from '../../src/ui/font-size';

const props = {
  open: true, registry: { version: 1 as const, backends: [], selectedBackendId: 'all' },
  summaries: {}, onChange() {}, onClose() {},
};
beforeEach(() => {
  window.localStorage.clear();
  (window as any).__CODEX_IOS_HOST__ = true;
  (window as any).webkit = { messageHandlers: { nativeUI: { postMessage: vi.fn() } } };
});
afterEach(() => {
  cleanup();
  delete (window as any).__CODEX_IOS_HOST__;
  delete (window as any).webkit;
  window.localStorage.clear();
  document.documentElement.style.removeProperty('--app-font-scale');
});

it.each(['small', 'standard', 'large', 'extra-large', 'broken'])('iOS 忽略旧字号 %s 并固定现有小字号比例', oldSize => {
  window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, oldSize);
  expect(readFontSize()).toBe('small');
  applyFontSize('extra-large');
  expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('0.875');
});

it.each(['legacy', 'modern'])('iOS %s 网页设置没有字号入口且立即应用固定比例', mode => {
  window.localStorage.setItem('codex-mobile:web-interface', mode);
  window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, 'extra-large');
  const registry = { version: 1 as const, backends: [{ id: 'mac', name: 'Mac', baseUrl: 'https://gateway.example', token: '', enabled: true, order: 0 }], selectedBackendId: 'mac' };
  render(<WebInterfaceProvider><BackendManagerSheet {...props} registry={registry} /></WebInterfaceProvider>);
  expect(screen.queryByText('字体大小')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '特大' })).not.toBeInTheDocument();
  expect(document.querySelector('[data-settings-page="font"]')).toBeNull();
  expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('0.875');
});

it('iOS 独立字体表单也不展示字号调整', () => {
  render(<FontSizeSettings />);
  expect(screen.queryByRole('group', { name: '字体大小' })).not.toBeInTheDocument();
});

it('iOS 原生设置与旧字体页没有选项，过期命令不能放大有效字号', async () => {
  window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, 'extra-large');
  const runtime = new NativeRuntime(() => {});
  const view = render(<BackendManagerSheet {...props} nativeRuntime={runtime} nativePage="settings" />);
  expect(runtime.snapshot().fontScale).toBe(0.875);
  expect(runtime.snapshot().panel?.items.some(item => item.id.startsWith('font'))).toBe(false);
  view.rerender(<BackendManagerSheet {...props} nativeRuntime={runtime} nativePage="font" />);
  expect(runtime.snapshot().panel?.items).toEqual([]);
  await act(async () => { await runtime.dispatch({ id: 'stale-font', name: 'settings.font', params: { value: 'extra-large' } }); });
  expect(runtime.snapshot().fontScale).toBe(0.875);
  expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('0.875');
  runtime.dispose();
});

it('普通浏览器及 Android 不受 iOS 固定字号影响', () => {
  delete (window as any).__CODEX_IOS_HOST__;
  window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, 'extra-large');
  expect(readFontSize()).toBe('extra-large');
  applyFontSize('extra-large');
  expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('1.25');
});
