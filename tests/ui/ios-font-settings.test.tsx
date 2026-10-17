import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BackendManagerSheet } from '../../src/features/backends/BackendManagerSheet';
import { FontSizeSettings } from '../../src/features/settings/FontSizeSettings';
import { NativeRuntime } from '../../src/native-ui/runtime';
import { applyFontSize, FONT_SCALES, FONT_SIZE_STORAGE_KEY, readFontSize } from '../../src/ui/font-size';

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
  vi.restoreAllMocks();
  delete (window as any).__CODEX_IOS_HOST__;
  delete (window as any).webkit;
  window.localStorage.clear();
  document.documentElement.style.removeProperty('--app-font-scale');
});

it.each(Object.entries(FONT_SCALES))('iOS 恢复保存的 %s 字号并应用对应比例', (size, scale) => {
  window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, size);
  expect(readFontSize()).toBe(size);
  applyFontSize(readFontSize());
  expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe(String(scale));
});

it('iOS 未保存或保存值损坏时保留现有小字号默认值', () => {
  expect(readFontSize()).toBe('small');
  window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, 'broken');
  expect(readFontSize()).toBe('small');
});

it('iOS 网页设置可以调整字号并在重新挂载后恢复', () => {
  const registry = { version: 1 as const, backends: [{ id: 'mac', name: 'Mac', baseUrl: 'https://gateway.example', token: '', enabled: true, order: 0 }], selectedBackendId: 'mac' };
  const mount = () => render(<BackendManagerSheet {...props} registry={registry} />);
  const view = mount();
  fireEvent.click(screen.getByRole('button', { name: '特大' }));
  expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('1.25');
  expect(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe('extra-large');
  view.unmount();
  mount();
  expect(screen.getByRole('button', { name: '特大' })).toHaveAttribute('aria-pressed', 'true');
  expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('1.25');
});

it('iOS 存储不可用时仍能调整字号并显示保存错误', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  render(<FontSizeSettings />);
  expect(screen.getByRole('button', { name: '小' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '大' }));
  expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('1.125');
  expect(screen.getByRole('alert')).toHaveTextContent('字号已应用，但无法保存');
});

it('iOS 原生设置和字体页投影四档选择，调整后同步网页与快照', async () => {
  const runtime = new NativeRuntime(() => {});
  const view = render(<BackendManagerSheet {...props} nativeRuntime={runtime} nativePage="settings" />);
  expect(runtime.snapshot().panel?.items.find(item => item.id === 'font')?.options?.map(option => option.value)).toEqual(Object.keys(FONT_SCALES));
  view.rerender(<BackendManagerSheet {...props} nativeRuntime={runtime} nativePage="font" />);
  for (const [size, scale] of Object.entries(FONT_SCALES)) {
    await act(async () => { await runtime.dispatch({ id: `font-${size}`, name: 'settings.font', params: { value: size } }); });
    expect(runtime.snapshot().fontScale).toBe(scale);
    expect(runtime.snapshot().panel?.items.find(item => item.id === 'font')?.value).toBe(size);
    expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe(String(scale));
    expect(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe(size);
  }
  runtime.dispose();
});

it('普通浏览器及 Android 保持标准默认值和已保存的字号', () => {
  delete (window as any).__CODEX_IOS_HOST__;
  expect(readFontSize()).toBe('standard');
  window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, 'extra-large');
  expect(readFontSize()).toBe('extra-large');
  applyFontSize('extra-large');
  expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('1.25');
});
