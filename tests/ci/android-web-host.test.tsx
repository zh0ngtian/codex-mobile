// @vitest-environment jsdom
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { isIOSNativeHost, isNativeUIHost, requestNativePreference } from '../../src/native-ui/preference';
import { NativeSwitchBoundary, useNativeSwitch } from '../../src/native-ui/switch-context';

const target = window as any;
afterEach(() => {
  cleanup();
  for (const key of ['__CODEX_ANDROID_HOST__', '__CODEX_IOS_HOST__', 'webkit']) delete target[key];
});

it('Android 直接挂载网页，不请求原生偏好或提供界面切换', async () => {
  const postMessage = vi.fn();
  Object.assign(target, { __CODEX_ANDROID_HOST__: true, webkit: { messageHandlers: { nativeUI: { postMessage } } } });
  function Page() { return <p>{useNativeSwitch() ? '原生设置' : '网页界面'}</p>; }
  render(<NativeSwitchBoundary initialRegistry={{ version: 1, selectedBackendId: '', backends: [] }}>{() => <Page />}</NativeSwitchBoundary>);
  expect(screen.getByText('网页界面')).toBeInTheDocument();
  expect(isNativeUIHost()).toBe(false);
  await expect(requestNativePreference({ enabled: true })).rejects.toThrow('当前环境不支持原生界面设置');
  expect(postMessage).not.toHaveBeenCalled();
});

it('iOS 原生宿主继续支持原有开关', () => {
  Object.assign(target, { __CODEX_IOS_HOST__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } } });
  expect(isIOSNativeHost()).toBe(true);
  expect(isNativeUIHost()).toBe(true);
});

it('本地准备计划只配置网页容器，不安装 Compose 呈现层', () => {
  const result = spawnSync(process.execPath, ['scripts/prepare-android.mjs', '--plan'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  const plan = JSON.parse(result.stdout);
  expect(plan.steps).toContain('Configure Android WebView host build');
  expect(plan.steps).not.toContain('Install Android Material native interface');
  expect(plan.buildsPackage).toBe(false);
  expect(plan.publishes).toBe(false);
});

it('容器配置可重复执行，保留 WebView 与系统桥且没有 Compose 依赖', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-android-web-'));
  try {
    for (const path of ['gradle/wrapper', 'app/src/main/java/com/app/pakeplus']) mkdirSync(join(directory, path), { recursive: true });
    writeFileSync(join(directory, 'gradle/libs.versions.toml'), '[versions]\nagp = "8.3.0"\nkotlin = "1.9.0"\ncoreKtx = "1.10.1"\njunitVersion = "1.1.5"\nespressoCore = "3.5.1"\n');
    writeFileSync(join(directory, 'gradle/wrapper/gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.4-bin.zip\n');
    writeFileSync(join(directory, 'app/build.gradle.kts'), 'android {\n    compileSdk = 34\n    buildFeatures { viewBinding = true }\n}\ndependencies {\n}\n');
    const activity = 'webView.loadUrl(webUrl)\nfun safeAreaTopCssPx() = 24.0\n';
    const activityPath = join(directory, 'app/src/main/java/com/app/pakeplus/MainActivity.kt');
    writeFileSync(activityPath, activity);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync('python3', ['scripts/prepare-android-host.py', directory], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    }
    const gradle = readFileSync(join(directory, 'app/build.gradle.kts'), 'utf8');
    expect(gradle).toContain('compileSdk = 36');
    expect(gradle.match(/activity-ktx/g)).toHaveLength(1);
    expect(gradle).not.toMatch(/compose|markwon|coil|zxing|webkit/);
    expect(readFileSync(activityPath, 'utf8')).toBe(activity);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
