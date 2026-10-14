import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import { parse } from "yaml";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const source = (name: string) => readFileSync(`mobile/ios/NativeUI/${name}.swift`, "utf8");
const trustedURL = "file:///Applications/Codex.app/index.html";
function bootstrap() {
  return source("NativeUITrust").match(/static let script = """\n([\s\S]*?)\n\s*"""/)![1]
    .replace("__CODEX_TRUSTED_URL__", JSON.stringify(trustedURL)).replace("__CODEX_NATIVE_ENABLED__", "true");
}
afterEach(() => { delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).codexMobileNativeCommand; delete (window as any).codexMobilePublishNativeSnapshot; delete (window as any).webkit; });
describe("SwiftUI 原生宿主契约", () => {
  it.skipIf(process.platform !== "darwin")("执行真实 Swift store、Codable往返、离线状态与 Markdown 解析", () => {
    const directory = mkdtempSync(join(tmpdir(), "native-model-"));
    try {
      const names = ["NativeJSONValue", "NativeCommand", "NativeOption", "NativeBackend", "NativeNavigationItem", "NativeGroup", "NativeAttachment", "NativeMessage", "NativePanelItem", "NativePanel", "NativeSnapshot", "NativeUIStore", "NativeMarkdownBlock"];
      const compile = spawnSync("xcrun", ["swiftc", ...names.map(name => `mobile/ios/NativeUI/${name}.swift`), "tests/ci/native-ui-model-smoke.swift", "-o", join(directory, "smoke")], { encoding: "utf8" });
      expect(compile.status, compile.stderr).toBe(0);
      const result = spawnSync(join(directory, "smoke"), [], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("smoke passed");
    } finally { rmSync(directory, { force: true, recursive: true }); }
  }, 30000);
  it("具有离线原生根、输入、侧栏及设置 UI 验收", () => {
    expect(existsSync("mobile/ios/NativeUI/NativeRootView.swift"), "缺少真实 SwiftUI 根").toBe(true);
    expect(source("NativeRootView")).toContain("native-ui-root");
    expect(source("NativeUIStore")).toContain("--native-ui-reference");
    expect(source("NativeComposerView")).toContain("native-composer-input");
    expect(source("NativeSettingsView")).toContain("native-ui-preference");
  });
  it("注入纯数据命令事件，保留 request id 与任意 JSON 参数", () => {
    expect(existsSync("mobile/ios/NativeUI/NativeUIBridge.swift")).toBe(true);
    const script = bootstrap();
    new Function("location", script)({ protocol: "file:", href: trustedURL });
    const listener = vi.fn();
    window.addEventListener("codex-mobile-native-command", listener, { once: true });
    (window as any).codexMobileNativeCommand({ id: "c1", name: "draft.set", params: { value: "你好" } });
    expect(listener.mock.calls[0][0].detail).toEqual({ id: "c1", name: "draft.set", params: { value: "你好" } });
  });
  it.each(["file:///private/tmp/index.html", "file:///Applications/Codex.app/other.html"])("其他本地文件不能取得原生桥：%s", (href) => {
    const script = bootstrap();
    new Function("location", script)({ protocol: "file:", href });
    expect((window as any).codexMobileNativeCommand).toBeUndefined();
    expect((window as any).codexMobilePublishNativeSnapshot).toBeUndefined();
  });
  it("外部网页不能取得原生数据发布入口", () => {
    const script = bootstrap();
    new Function("location", script)({ protocol: "https:" });
    expect((window as any).codexMobilePublishNativeSnapshot).toBeUndefined();
    expect(source("NativeUIBridge")).toContain("message.webView === webView");
    expect(source("NativeUIBridge")).toContain("NativeUITrust.accepts(message.frameInfo.request.url");
  });
  it.skipIf(process.platform !== "darwin")("执行Swift生产可信URL策略与真实生成脚本，特殊字符和导航变化仍限制首页", () => {
    const directory = mkdtempSync(join(tmpdir(), "native-trust-"));
    try {
      const compile = spawnSync("xcrun", ["swiftc", ...["NativeJSONValue", "NativeCommand", "NativeUITrust"].map(name => `mobile/ios/NativeUI/${name}.swift`), "tests/ci/native-ui-trust-fixture.swift", "-o", join(directory, "fixture")], { encoding: "utf8" });
      expect(compile.status, compile.stderr).toBe(0);
      const result = spawnSync(join(directory, "fixture"), [], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout);
      const install = (href: string) => new Function("location", output.bootstrap)({ protocol: new URL(href).protocol, href });
      for (const href of ["file:///private/tmp/index.html", output.trustedURL.replace("index.html", "other.html"), output.trustedURL + "?x=1", output.trustedURL + "#x", "https://example.com/index.html"]) {
        install(href);
        expect((window as any).__CODEX_NATIVE_UI__).toBeUndefined();
        expect((window as any).codexMobilePublishNativeSnapshot).toBeUndefined();
      }
      install(output.normalizedURL);
      expect((window as any).__CODEX_NATIVE_UI__).toBe(true);
      const command = vi.fn();
      (window as any).codexMobileNativeCommand = command;
      new Function("location", output.dispatch)({ protocol: "file:", href: "file:///private/tmp/index.html" });
      expect(command).not.toHaveBeenCalled();
      new Function("location", output.dispatch)({ protocol: "file:", href: output.normalizedURL });
      expect(command).toHaveBeenCalledWith({ id: "trust-test", name: "draft.set", params: { value: '中文引号"和\\反斜线' } });
    } finally { rmSync(directory, { force: true, recursive: true }); }
  }, 30000);
  it("离线基准不挂载业务 WebView，正式模式复用旧实例", () => {
    expect(source("NativeUIHost")).toMatch(/if !store.isReference \{\s+legacy/);
    expect(source("NativeUIBridge")).not.toContain("WKWebView(frame:");
    expect(source("NativeUIBridge")).not.toContain("static let shared");
    expect(source("NativeUIHost")).toContain("@State private var bridge = NativeUIBridge()");
    expect(source("NativeUIHost")).toContain(".environment(\\.nativeUIBridge, bridge)");
    expect(source("NativeUIEnvironment")).toContain("@Entry var nativeUIBridge: NativeUIBridge? = nil");
    expect(source("NativeUIStore")).toContain("guard value.version == 1, !isReference");
  });
  it("构建安装原生源码并保持现有 WebView 唯一构造入口", () => {
    const recipe = parse(readFileSync("mobile/ios/build-recipe.yml", "utf8"));
    const scripts = recipe.steps.map((s: any) => s.run ?? "").join("\n");
    expect(scripts).toContain("mobile/ios/NativeUI/*.swift");
    expect(scripts).toContain("NativeUIHost");
    expect(scripts).toContain("context.environment.nativeUIBridge?.attach(webView)");
    expect(scripts).toContain('IPHONEOS_DEPLOYMENT_TARGET = 18.0;');
    expect(readFileSync("scripts/configure-ios-tests.rb", "utf8")).toContain("NativeUIUITests.swift");
  });
});
