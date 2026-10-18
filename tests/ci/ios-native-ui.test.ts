import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import { parse } from "yaml";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// 正式 CI 的完整 Swift 回归编译在 90 秒超时；为云端冷启动保留有界预算，执行仍限 15 秒。
const swiftCompileTimeout = 180_000;
const swiftExecutionTimeout = 15_000;
const swiftContractTimeout = 210_000;
const source = (name: string) => readFileSync(`mobile/ios/NativeUI/${name}.swift`, "utf8");
const trustedURL = "file:///Applications/Codex.app/index.html";
function bootstrap() {
  return source("NativeUITrust").match(/static let script = """\n([\s\S]*?)\n\s*"""/)![1]
    .replace("__CODEX_TRUSTED_URL__", JSON.stringify(trustedURL)).replace("__CODEX_NATIVE_ENABLED__", "true");
}
afterEach(() => { delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).__CODEX_IOS_HOST__; delete (window as any).__CODEX_NATIVE_UI_RECOVERED__; delete (window as any).codexMobileUseLegacyRecovery; delete (window as any).__CODEX_NATIVE_ACTIVE__; delete (window as any).codexMobileSetNativeActive; delete (window as any).codexMobileNativeCommand; delete (window as any).codexMobilePublishNativeSnapshot; delete (window as any).webkit; delete (window as any).codexMobileScanGatewayQr; delete (window as any).codexMobileQRComplete; delete (window as any).codexMobileNativePreferenceComplete; });
describe("SwiftUI 原生宿主契约", () => {
  it.skipIf(process.platform !== "darwin")("执行真实 Swift store、Codable往返、离线状态与 Markdown 解析", () => {
    const directory = mkdtempSync(join(tmpdir(), "native-model-"));
    try {
      const names = ["NativeJSONValue", "NativeCommand", "NativeCommandResult", "NativeOption", "NativeBackend", "NativeNavigationItem", "NativeGroup", "NativeAttachment", "NativeMessage", "NativePanelItem", "NativePanel", "NativeContextUsage", "NativeRateLimit", "NativeComposerLineLimits", "NativeComposerLayoutBudget", "NativeComposerSymbols", "NativeComposerMenuContext", "NativeComposerAttachmentAction", "NativeSnapshot", "NativeUIStore", "NativeComposerPresentation", "NativeComposerPresentationEvent", "NativeComposerPresentationIntent", "NativeUIPreference", "NativeMarkdownBlock", "NativeMarkdownBlockKind", "NativeMarkdownSyntax", "NativeMarkdownInlinePart", "NativeMediaSource", "NativeReferenceAudio", "NativeVisualReference", "NativeReferenceSettings", "NativeHistoryEditReference", "NativeTextRhythm", "NativeFieldKey", "NativeFieldScope", "NativeImageData", "NativePlainText", "NativeInlineMarkdown", "NativeMarkdownDisplaySource", "NativeMarkdownHTMLScope", "NativeTimelineState", "NativeTextPrompt"];
      const compile = spawnSync("xcrun", ["swiftc", ...names.map(name => `mobile/ios/NativeUI/${name}.swift`), "tests/ci/native-ui-model-smoke.swift", "tests/ci/native-ui-presentation-smoke.swift", "tests/ci/native-ui-menu-smoke.swift", "tests/ci/native-ui-history-smoke.swift", "-o", join(directory, "smoke")], { encoding: "utf8", timeout: swiftCompileTimeout });
      expect(compile.status, compile.error?.message ?? compile.stderr).toBe(0);
      const result = spawnSync(join(directory, "smoke"), [], { encoding: "utf8", timeout: swiftExecutionTimeout });
      expect(result.status, result.error?.message ?? result.stderr).toBe(0);
      expect(result.stdout).toContain("smoke passed");
      expect(result.stdout).toMatch(/Native composer presentation \d+ assertions passed/);
      expect(result.stdout).toMatch(/Native composer menu \d+ assertions passed/);
      expect(result.stdout).toMatch(/Native visual content \d+ assertions passed/);
      expect(result.stdout).toMatch(/Native document presentation \d+ assertions passed/);
      expect(result.stdout).toMatch(/Native inline history \d+ assertions passed/);
    } finally { rmSync(directory, { force: true, recursive: true }); }
  }, swiftContractTimeout);
  it.skipIf(process.platform !== "darwin")("原生偏好默认开启，保留明确选择并在保存失败时回滚", () => {
    const directory = mkdtempSync(join(tmpdir(), "native-preference-"));
    try {
      const compile = spawnSync("xcrun", ["swiftc", "mobile/ios/NativeUI/NativeUIPreference.swift", "tests/ci/native-ui-preference-smoke.swift", "-o", join(directory, "preference")], { encoding: "utf8", timeout: swiftCompileTimeout });
      expect(compile.status, compile.error?.message ?? compile.stderr).toBe(0);
      const result = spawnSync(join(directory, "preference"), [], { encoding: "utf8", timeout: swiftExecutionTimeout });
      expect(result.status, result.error?.message ?? result.stderr).toBe(0);
      expect(result.stdout).toContain("Preference smoke passed");
    } finally { rmSync(directory, { force: true, recursive: true }); }
  }, swiftContractTimeout);
  it("正文生产消费者沿 block、图片分段与表格单元格传递文档展示范围", () => {
    expect(source("NativeMarkdownBlockView")).toContain("NativeInlineMarkdown.text(block.text, scope: block.scope)");
    expect(source("NativeMarkdownBlockView")).toContain("compact: compact, scope: block.scope");
    expect(source("NativeMarkdownBlockView")).toContain("cellScopes: block.cellScopes");
    expect(source("NativeInlineContentView")).toContain("NativeMarkdownInlinePart.parse(text, scope: scope)");
    expect(source("NativeInlineContentView")).toContain("NativeSelectableMarkdown.inline(part.text, scope: part.scope, font: .preferredFont(forTextStyle: textStyle), strong: strong)");
    expect(source("NativeSelectableMarkdown")).toContain("NativeInlineMarkdown.text(source, scope: scope)");
    expect(source("NativeInlineContentView")).toContain(".task(id: scope.identity + [text])");
    expect(source("NativeMarkdownTableView")).toContain("scope: cellScope(row: rowIndex, column: columnIndex)");
    expect(source("NativePlainText")).toContain("NativeInlineMarkdown.text(block.text, scope: block.scope)");
  });
  it("自然增长保留同一原生编辑器并把预算行数用于TextField", () => {
    const composer = source("NativeComposerView");
    expect(composer.match(/TextField\(/g)).toHaveLength(1);
    expect(composer).toContain(".lineLimit(composerLineLimits)");
  });
  it("输入栏直接使用系统菜单，完整平级目录不带勾选并可见当前推理强度", () => {
    const composer = source("NativeComposerView");
    const configuration = source("NativeComposerConfigurationView");
    const attachments = source("NativeComposerAttachmentMenu");
    expect(composer).toContain("NativeComposerAttachmentMenu(");
    expect(composer).toContain("let contextID: String?");
    expect(composer).toContain("isOpen: attachmentPresentation");
    expect(composer).toContain("store.consumeComposerPresentation(contextID: contextID)");
    expect(composer).not.toMatch(/\$store\.attachmentOpen|store\.attachmentOpen\s*=/);
    for (const host of ["NativeConversationView"]) {
      expect(source(host)).toContain("NativeComposerView(store: store, contextID: store.snapshot.contextId,");
    }
    expect(composer).not.toContain(".sheet(");
    expect(configuration).toContain("ForEach(store.snapshot.permissions ?? [])");
    expect(configuration).toContain("NativeComposerSymbols.permissionSymbol(option.value)");
    expect(configuration).toContain("ForEach(store.snapshot.models)");
    expect(configuration).toContain("ForEach(store.snapshot.efforts)");
    expect(configuration.match(/Section\(/g)).toHaveLength(2);
    expect(configuration.match(/\.menuOrder\(\.fixed\)/g)).toHaveLength(3);
    expect(configuration).not.toMatch(/checkmark|ScrollView|\.prefix\(|Picker\(/);
    expect(configuration).toContain("Text(NativeComposerSymbols.modelTitle(");
    expect(configuration).toContain(".truncationMode(.middle)");
    expect(attachments).toContain("showsMenuAsPrimaryAction = true");
    expect(attachments).toContain("preferredMenuElementOrder = .fixed");
    expect(attachments).toContain("performPrimaryAction()");
    expect(attachments).toContain("willEndFor");
    expect(attachments).toContain("animator.addCompletion");
    expect(attachments).not.toContain("hitTest(");
  });
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
  it("人工恢复仅切换呈现标记，不修改冻结模式或重新加载业务文档", () => {
    const changed = vi.fn();
    window.addEventListener("codex-mobile-native-recovery", changed, { once: true });
    new Function("location", bootstrap())({ protocol: "file:", href: trustedURL });
    (window as any).codexMobileUseLegacyRecovery();
    expect((window as any).__CODEX_NATIVE_UI_RECOVERED__).toBe(true);
    expect((window as any).__CODEX_NATIVE_UI__).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
  });
  it("原生场景前后台信号更新共享运行时并触发已有恢复事件", () => {
    new Function("location", bootstrap())({ protocol: "file:", href: trustedURL });
    const visibility = vi.fn();
    document.addEventListener("visibilitychange", visibility);
    try {
      (window as any).codexMobileSetNativeActive(false);
      expect((window as any).__CODEX_NATIVE_ACTIVE__).toBe(false);
      (window as any).codexMobileSetNativeActive(true);
      expect((window as any).__CODEX_NATIVE_ACTIVE__).toBe(true);
      expect(visibility).toHaveBeenCalledTimes(2);
    } finally { document.removeEventListener("visibilitychange", visibility); }
  });
  it("原生扫码Promise按请求回传结果、取消与占用错误", async () => {
    const postMessage = vi.fn();
    (window as any).webkit = { messageHandlers: { nativeUI: { postMessage } } };
    new Function("location", bootstrap())({ protocol: "file:", href: trustedURL });
    const target = window as any;
    const success = target.codexMobileScanGatewayQr();
    const request = postMessage.mock.calls.at(-1)![0];
    expect(request.type).toBe("scanQR");
    target.codexMobileQRComplete({ id: "not-current", value: "wrong" });
    target.codexMobileQRComplete({ id: request.id, value: "https://gateway.example/?token=example" });
    await expect(success).resolves.toBe("https://gateway.example/?token=example");
    const cancelled = target.codexMobileScanGatewayQr();
    const next = postMessage.mock.calls.at(-1)![0];
    target.codexMobileQRComplete({ id: next.id, error: "已取消扫描" });
    await expect(cancelled).rejects.toThrow("已取消扫描");
    postMessage.mockImplementation(() => { throw new Error("扫码不可用"); });
    await expect(target.codexMobileScanGatewayQr()).rejects.toThrow("扫码不可用");
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
  it.skipIf(process.platform !== "darwin")("执行Swift生产可信URL策略与真实生成脚本，特殊字符和导航变化仍限制首页", async () => {
    const directory = mkdtempSync(join(tmpdir(), "native-trust-"));
    try {
      const compile = spawnSync("xcrun", ["swiftc", ...["NativeJSONValue", "NativeCommand", "NativeUITrust"].map(name => `mobile/ios/NativeUI/${name}.swift`), "tests/ci/native-ui-trust-fixture.swift", "-o", join(directory, "fixture")], { encoding: "utf8", timeout: swiftCompileTimeout });
      expect(compile.status, compile.error?.message ?? compile.stderr).toBe(0);
      const result = spawnSync(join(directory, "fixture"), [], { encoding: "utf8", timeout: swiftExecutionTimeout });
      expect(result.status, result.error?.message ?? result.stderr).toBe(0);
      const output = JSON.parse(result.stdout);
      const privatePage = output.private;
      expect(privatePage.trustedURL).toMatch(/^file:\/\/\/private\/tmp\//);
      expect(privatePage.trustedURL).not.toBe(privatePage.standardizedURL);
      // 使用隔离的浏览器表面执行真正由 Swift 生产代码生成的每一种脚本。
      const surface = (href: string, mainFrame = true) => {
        const target: any = new EventTarget();
        target.top = mainFrame ? target : {};
        const document = new EventTarget();
        const location = { protocol: new URL(href).protocol, href };
        const postMessage = vi.fn();
        target.webkit = { messageHandlers: { nativeUI: { postMessage } } };
        const run = (script: string) => new Function("window", "document", "location", "Date", script)(target, document, location, { now: () => 0 });
        return { target, document, location, postMessage, run };
      };
      const page = surface(privatePage.trustedURL);
      page.run(privatePage.bootstrap);
      expect(page.target.__CODEX_IOS_HOST__, "原始 /private 首页必须取得原生宿主标记").toBe(true);
      expect(page.target.__CODEX_NATIVE_UI__).toBe(true);
      expect(page.postMessage).toHaveBeenCalledWith({ type: "ready" });
      const receivedCommand = vi.fn();
      page.target.addEventListener("codex-mobile-native-command", receivedCommand);
      page.run(privatePage.dispatch);
      expect(receivedCommand.mock.calls[0][0].detail).toEqual({ id: "trust-test", name: "draft.set", params: { value: '中文引号"和\\反斜线' } });
      const preferenceReceipt = vi.fn();
      page.target.codexMobileNativePreferenceComplete = preferenceReceipt;
      page.run(privatePage.preference);
      expect(preferenceReceipt).toHaveBeenCalledWith({ id: "switch-test", enabled: true, active: false, error: null });
      const visibility = vi.fn();
      const focus = vi.fn();
      page.document.addEventListener("visibilitychange", visibility);
      page.target.addEventListener("focus", focus);
      page.run(privatePage.lifecycleInactive);
      expect(page.target.__CODEX_NATIVE_ACTIVE__).toBe(false);
      page.run(privatePage.lifecycleActive);
      expect(page.target.__CODEX_NATIVE_ACTIVE__).toBe(true);
      expect(visibility).toHaveBeenCalledTimes(2);
      expect(focus).toHaveBeenCalledOnce();
      const scan = page.target.codexMobileScanGatewayQr();
      expect(page.postMessage).toHaveBeenLastCalledWith({ type: "scanQR", id: "qr-0-1" });
      page.run(privatePage.qr);
      await expect(scan).resolves.toBe("https://gateway.example/?token=中文");
      const recovery = vi.fn();
      page.target.addEventListener("codex-mobile-native-recovery", recovery);
      page.run(privatePage.recovery);
      expect(page.target.__CODEX_NATIVE_UI_RECOVERED__).toBe(true);
      expect(recovery).toHaveBeenCalledOnce();
      for (const [href, mainFrame] of [
        [privatePage.standardizedURL, true],
        [privatePage.trustedURL + "?x=1", true],
        [privatePage.trustedURL + "#x", true],
        [privatePage.trustedURL.replace("index.html", "other.html"), true],
        ["file:///private/tmp/index.html", true],
        ["https://example.com/index.html", true],
        [privatePage.trustedURL, false]
      ] as const) {
        const rejected = surface(href, mainFrame);
        rejected.run(privatePage.bootstrap);
        expect(rejected.target.__CODEX_IOS_HOST__).toBeUndefined();
        expect(rejected.target.codexMobilePublishNativeSnapshot).toBeUndefined();
        expect(rejected.postMessage).not.toHaveBeenCalled();
        const callbacks = ["codexMobileNativeCommand", "codexMobileNativePreferenceComplete", "codexMobileSetNativeActive", "codexMobileQRComplete", "codexMobileUseLegacyRecovery"];
        for (const callback of callbacks) rejected.target[callback] = vi.fn();
        for (const script of [privatePage.dispatch, privatePage.preference, privatePage.lifecycleInactive, privatePage.lifecycleActive, privatePage.qr, privatePage.recovery]) rejected.run(script);
        for (const callback of callbacks) expect(rejected.target[callback]).not.toHaveBeenCalled();
        // 导航后，已安装 bootstrap 闭包内的生命周期与恢复入口同样拒绝。
        page.location.href = href;
        page.location.protocol = new URL(href).protocol;
        page.target.top = mainFrame ? page.target : {};
        page.target.codexMobileSetNativeActive(false);
        page.target.codexMobileUseLegacyRecovery();
        expect(visibility).toHaveBeenCalledTimes(2);
        expect(recovery).toHaveBeenCalledOnce();
      }
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
      const preference = vi.fn();
      (window as any).codexMobileNativePreferenceComplete = preference;
      new Function("location", output.preference)({ protocol: "file:", href: "file:///private/tmp/index.html" });
      expect(preference).not.toHaveBeenCalled();
      new Function("location", output.preference)({ protocol: "file:", href: output.normalizedURL });
      expect(preference).toHaveBeenCalledWith({ id: "switch-test", enabled: true, active: false, error: null });

    } finally { rmSync(directory, { force: true, recursive: true }); }
  }, swiftContractTimeout);
  it("桥与 WebView 使用同一原始 Bundle 首页资源，缺失时明确报告不可用", () => {
    const bridge = source("NativeUIBridge");
    expect(bridge).toContain('private let trustedURL = Bundle.main.url(forResource: "index", withExtension: "html")');
    expect(bridge).not.toContain("Bundle.main.bundleURL.appendingPathComponent");
    expect(bridge).not.toContain("standardizedFileURL");
    expect(bridge).toContain("guard let trustedURL else");
    expect(bridge).toContain("内置首页资源不可用");
    expect(bridge).toContain("message.frameInfo.isMainFrame");
  });
  it("离线基准不挂载业务 WebView，正式模式复用旧实例", () => {
    expect(source("NativeUIHost")).toMatch(/if !store.isReference && !isConversationFixture \{\s+legacy/);
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
