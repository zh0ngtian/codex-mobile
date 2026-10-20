import { existsSync, readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = '';
});

it('生成的主 WebView 安装文本输入桥并转发真实 WKUIDelegate prompt', () => {
  const recipe = parse(readFileSync('mobile/ios/build-recipe.yml', 'utf8'));
  const install = recipe.steps.find((step: any) => step.name === 'Install iOS in-app browser source').run;
  const harden = recipe.steps.find((step: any) => step.name === 'Harden and test the iOS host').run;
  expect(install).toContain('mobile/ios/JavaScriptTextInputBridge.swift');
  expect(harden).toContain('runJavaScriptTextInputPanelWithPrompt');
  expect(harden).toContain('javaScriptTextInput.configure(webView)');
  expect(harden).toContain('javaScriptTextInput.present');
  expect(existsSync('mobile/ios/JavaScriptTextInputBridge.swift')).toBe(true);
});

it('文本输入按钮语言同步只关注可信首页的 lang 属性', async () => {
  expect(existsSync('mobile/ios/JavaScriptTextInputBridge.swift')).toBe(true);
  const source = readFileSync('mobile/ios/JavaScriptTextInputBridge.swift', 'utf8');
  const script = source.match(/static let languageScript = """\n([\s\S]*?)\n\s*"""/)?.[1];
  expect(script).toBeTruthy();
  const postMessage = vi.fn();
  vi.stubGlobal('location', new URL('file:///Applications/Codex.app/index.html'));
  vi.stubGlobal('webkit', { messageHandlers: { javaScriptTextInputLanguage: { postMessage } } });
  document.documentElement.lang = 'en';
  new Function(script!.replace('__CODEX_TRUSTED_URL__', JSON.stringify(location.href)))();
  expect(postMessage).toHaveBeenLastCalledWith({ locale: 'en' });
  document.documentElement.lang = 'zh-CN';
  await Promise.resolve();
  expect(postMessage).toHaveBeenLastCalledWith({ locale: 'zh-CN' });
  const count = postMessage.mock.calls.length;
  document.documentElement.dataset.other = 'changed';
  await Promise.resolve();
  expect(postMessage).toHaveBeenCalledTimes(count);
  vi.stubGlobal('location', new URL('https://external.example/'));
  document.documentElement.lang = 'en';
  await Promise.resolve();
  expect(postMessage).toHaveBeenCalledTimes(count);
});
