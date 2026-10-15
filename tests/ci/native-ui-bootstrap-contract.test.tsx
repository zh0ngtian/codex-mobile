import { render, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AppBootstrap } from '../../src/App';

beforeEach(() => {
  // 固定为浏览器Storage；Node 26 的实验性同名全局不属于这项Web宿主契约。
  vi.stubGlobal('localStorage', new JSDOM('', { url: 'http://localhost' }).window.localStorage);
});

afterEach(() => {
  cleanup(); window.localStorage.clear(); vi.unstubAllGlobals();
  delete (window as any).__CODEX_NATIVE_UI__;
  delete (window as any).webkit;
  delete (window as any).codexMobilePublishNativeSnapshot;
});
it.skipIf(process.platform !== 'darwin')('真实无设备App首启快照可直接被生产Swift DTO解码', async () => {
  const posts: any[] = [];
  Object.assign(window, { __CODEX_NATIVE_UI__: true,
    webkit: { messageHandlers: { nativeUI: { postMessage() {} } } },
    codexMobilePublishNativeSnapshot: (snapshot: unknown) => posts.push(snapshot),
  });
  render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: '', backends: [] }} />);
  await waitFor(() => expect(posts.at(-1)?.panel?.id).toBe('devices'));
  const directory = mkdtempSync(join(tmpdir(), 'native-bootstrap-'));
  try {
    const names = ['NativeJSONValue', 'NativeCommand', 'NativeCommandResult', 'NativeOption', 'NativeBackend', 'NativeNavigationItem', 'NativeGroup', 'NativeAttachment', 'NativeMessage', 'NativePanelItem', 'NativePanel', 'NativeContextUsage', 'NativeSnapshot'];
    const executable = join(directory, 'decode');
    const compiled = spawnSync('xcrun', ['swiftc', ...names.map(name => `mobile/ios/NativeUI/${name}.swift`), 'tests/ci/native-ui-decode.swift', '-o', executable], { encoding: 'utf8', timeout: 90_000 });
    expect(compiled.status, compiled.error?.message ?? compiled.stderr).toBe(0);
    const result = spawnSync(executable, [], { input: JSON.stringify(posts.at(-1)), encoding: 'utf8', timeout: 15_000 });
    expect(result.status, result.error?.message ?? result.stderr).toBe(0);
    expect(result.stdout).toContain('Native bootstrap snapshot decoded');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 120_000);
