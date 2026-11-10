// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isIOSNativeHost, isNativeUIHost, requestNativePreference } from '../../src/native-ui/preference';
import { isNativeUIEnabled, publishNativeSnapshot } from '../../src/native-ui/runtime';
import { emptyNativeSnapshot } from '../../src/native-ui/protocol';

const target = window as any;
const homepage = 'file:///android_asset/index.html';
function install(href = homepage, enabled = true, scope: any = window) {
  const postMessage = vi.fn();
  scope.CodexNativeUI = { postMessage };
  const source = readFileSync('mobile/android/native-ui/bootstrap.js', 'utf8')
    .replace('__NATIVE_TOKEN__', JSON.stringify('test-token'))
    .replace('__NATIVE_ENABLED__', String(enabled));
  new Function('window', 'location', 'document', source)(scope, { href }, document);
  return postMessage;
}
beforeEach(() => { vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {}); });
afterEach(() => {
  target.codexMobileAttachmentPickerCancelled?.();
  for (const key of ['__CODEX_ANDROID_HOST__', '__CODEX_IOS_HOST__', '__CODEX_NATIVE_UI__', '__CODEX_NATIVE_ACTIVE__',
    'webkit', 'CodexNativeUI', 'codexMobileNativeCommand', 'codexMobilePublishNativeSnapshot',
    'codexMobileNativePreference', 'codexMobileNativePreferenceComplete', 'codexMobileSetNativeActive',
    'codexMobilePickAttachments', 'codexMobileAttachmentPickerCancelled', 'codexMobileScanGatewayQr', 'codexMobileQRComplete']) delete target[key];
  vi.restoreAllMocks();
});

describe('Android 原生业务桥', () => {
  it.each(['https://example.com/', 'file:///android_asset/other.html', `${homepage}?token=wrong`, `${homepage}#fragment`])('拒绝非精确首页 %s', href => {
    install(href);
    expect(isNativeUIEnabled()).toBe(false);
    expect(target.codexMobileNativeCommand).toBeUndefined();
  });
  it('子 frame 无法获取共享业务桥', () => {
    const frame = { top: window };
    install(homepage, true, frame);
    expect((frame as any).__CODEX_NATIVE_UI__).toBeUndefined();
  });
  it('Android 快照携带本次宿主 token，仍使用现有 v1 协议', () => {
    const post = install();
    expect(isNativeUIEnabled()).toBe(true);
    expect(isNativeUIHost()).toBe(true);
    expect(isIOSNativeHost()).toBe(false);
    const snapshot = { ...emptyNativeSnapshot(), ready: true, draft: '你好 👋' };
    publishNativeSnapshot(snapshot);
    expect(JSON.parse(post.mock.calls.at(-1)![0])).toEqual({ token: 'test-token', type: 'snapshot', snapshot });
  });
  it('网页模式仍支持安全保存下次启动偏好，本次模式不变化', async () => {
    const post = install(homepage, false);
    expect(isNativeUIEnabled()).toBe(false);
    const result = requestNativePreference({ enabled: true });
    const request = JSON.parse(post.mock.calls.at(-1)![0]);
    expect(request).toMatchObject({ token: 'test-token', type: 'nativePreference', enabled: true });
    target.codexMobileNativePreferenceComplete({ id: 'unrelated', enabled: false, active: false });
    target.codexMobileNativePreferenceComplete({ id: request.id, enabled: true, active: false });
    await expect(result).resolves.toEqual({ enabled: true, active: false });
    expect(isNativeUIEnabled()).toBe(false);
  });
  it('原生命令保留上下文、请求 id、UTF16 光标与版本，不通过业务 DOM 操作', () => {
    install();
    const listener = vi.fn();
    window.addEventListener('codex-mobile-native-command', listener, { once: true });
    const command = { id: 'request-1', name: 'draft.set', params: { contextId: 'ctx-a', value: '你好👋', caretOffset: 4, revision: 3 } };
    target.codexMobileNativeCommand(command);
    expect(listener.mock.calls[0][0].detail).toEqual(command);
  });
  it('附件取消完成 Promise；随后可重开，选择仍返回原始 File 二进制', async () => {
    install();
    const cancelled = target.codexMobilePickAttachments('photos');
    await expect(target.codexMobilePickAttachments('files')).rejects.toThrow('正在使用中');
    target.codexMobileAttachmentPickerCancelled();
    await expect(cancelled).resolves.toEqual([]);
    const next = target.codexMobilePickAttachments('files');
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['\u0000实际二进制'], '报告.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await expect(next).resolves.toEqual([file]);
    expect(document.querySelector('input[type=file]')).toBeNull();
  });
  it('二维码回执按请求匹配，取消后可再次扫描', async () => {
    const post = install();
    const first = target.codexMobileScanGatewayQr();
    const request = JSON.parse(post.mock.calls.at(-1)![0]);
    target.codexMobileQRComplete({ id: 'other', value: 'wrong' });
    target.codexMobileQRComplete({ id: request.id, error: '已取消扫描' });
    await expect(first).rejects.toThrow('已取消扫描');
    const second = target.codexMobileScanGatewayQr();
    const next = JSON.parse(post.mock.calls.at(-1)![0]);
    target.codexMobileQRComplete({ id: next.id, value: 'https://gateway.example/?token=example' });
    await expect(second).resolves.toBe('https://gateway.example/?token=example');
  });
  it('前后台信号复用已有恢复事件', () => {
    install();
    const changed = vi.fn();
    document.addEventListener('visibilitychange', changed);
    try {
      target.codexMobileSetNativeActive(false); expect(target.__CODEX_NATIVE_ACTIVE__).toBe(false);
      target.codexMobileSetNativeActive(true); expect(target.__CODEX_NATIVE_ACTIVE__).toBe(true);
      expect(changed).toHaveBeenCalledTimes(2);
    } finally { document.removeEventListener('visibilitychange', changed); }
  });
});
