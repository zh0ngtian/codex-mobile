import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

function plan(...args: string[]) {
  return spawnSync(process.execPath, ["scripts/prepare-ios.mjs", "--plan", ...args], { encoding: "utf8" });
}

describe("iOS 本地工程准备", () => {
  it("主容器安装原生对话与状态源文件并注册版本化桥接", () => {
    const workflow = parse(readFileSync(".github/workflows/build-ios.yml", "utf8"));
    const install = workflow.jobs.build.steps.find((step: any) => step.name === "Install iOS in-app browser source").run;
    const harden = workflow.jobs.build.steps.find((step: any) => step.name === "Harden and test the iOS host").run;
    for (const name of ["NativeConversationBridge", "NativeConversationViewController", "NativeConversationState"]) {
      expect(install).toContain(`${name}.swift`);
    }
    expect(harden).toContain("CodexMobileNativeConversationBridge.configure(webView)");
    expect(harden).toContain("return CodexMobileConversationHostView(webView: webView)");
    expect(harden).toContain('func makeUIView(context: Context) -> UIView');
  });
  it("注册会话 URL Scheme，并在冷启动网页加载完成后消费目标", () => {
    const workflow = parse(readFileSync(".github/workflows/build-ios.yml", "utf8"));
    const harden = workflow.jobs.build.steps.find((step: any) => step.name === "Harden and test the iOS host").run;
    expect(harden).toContain('info["CFBundleURLTypes"]');
    expect(harden).toContain('"CFBundleURLSchemes": ["codexmobile"]');
    expect(harden).toContain(".onOpenURL");
    expect(harden).toContain("CodexMobileCompletionRouter.attach(webView)");
    expect(harden).toContain("UserDefaults.standard");
    expect(harden).toContain("codex-mobile-open-thread");
  });
  it("复用发布流水线固定容器与硬化步骤，并输出可构建工程", () => {
    const result = plan("--version", "0.2.91");
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    const workflow = parse(readFileSync(".github/workflows/build-ios.yml", "utf8"));
    const checkout = workflow.jobs.build.steps.find((step: any) => step.name === "Checkout pinned PakePlus iOS");
    expect(output.repository).toBe(checkout.with.repository);
    expect(output.ref).toBe(checkout.with.ref);
    expect(output.version).toBe("0.2.91");
    expect(output.projectPath).toMatch(/\.mobile-build\/ios\/pakeplus\/PakePlus.xcodeproj$/);
    expect(output.scheme).toBe("PakePlus");
    expect(output.packageManager).toBe("pnpm@10");
    expect(output.steps).toEqual([
      "Install Codex Mobile app icon", "Build embedded frontend",
      "Configure PakePlus for embedded HTML", "Install PakePlus dependencies",
      "Generate iOS project", "Install iOS in-app browser source",
      "Harden and test the iOS host",
    ]);
  });

  it("iOS 容器保留全面屏布局并避让键盘", () => {
    const workflow = parse(readFileSync(".github/workflows/build-ios.yml", "utf8"));
    const harden = workflow.jobs.build.steps.find((step: any) => step.name === "Harden and test the iOS host").run;
    expect(harden).toContain(".ignoresSafeArea(.container, edges: [.all])");
    expect(harden).toContain("Pinned PakePlus keyboard safe area hook changed");
    expect(harden).toContain("MARKETING_VERSION");
    expect(harden).toContain("CURRENT_PROJECT_VERSION");
    expect(harden).toContain("os.environ[\"APP_VERSION\"]");
  });

  it("WebView 主图层阻止新增几何动画，避免布局后追加动画造成错位", () => {
    const workflow = parse(readFileSync(".github/workflows/build-ios.yml", "utf8"));
    const harden = workflow.jobs.build.steps.find((step: any) => step.name === "Harden and test the iOS host").run;
    expect(harden.includes("let webView = CodexMobileWebView(frame:")).toBe(true);
    expect(harden.includes("override class var layerClass: AnyClass { CodexMobileWebViewLayer.self }")).toBe(true);
    expect(harden.includes('path == "position" || path == "bounds" || path.hasPrefix("bounds.")')).toBe(true);
    expect(harden.includes("override func add(_ animation: CAAnimation, forKey key: String?)")).toBe(true);
    expect(harden.includes("super.add(animation, forKey: key)")).toBe(true);
  });

  it("iOS 在启动、系统粗体设置变化、回到前台和页面重载时同步字重", () => {
    const workflow = parse(readFileSync(".github/workflows/build-ios.yml", "utf8"));
    const harden = workflow.jobs.build.steps.find((step: any) => step.name === "Harden and test the iOS host").run;
    expect(harden).toContain("UIAccessibility.isBoldTextEnabled");
    expect(harden).toContain("UIAccessibility.boldTextStatusDidChangeNotification");
    expect(harden).toContain("UIApplication.didBecomeActiveNotification");
    expect(harden).toContain("context.coordinator.installBoldTextSupport(webView)");
    expect(harden).toContain("injectionTime: .atDocumentEnd, forMainFrameOnly: true");
    expect(harden).toContain("data-ios-bold-text");
    expect(harden).toContain('navigation_finished + "        syncBoldText()\\n"');
  });

  it("系统键盘收起时同步取消网页输入焦点，保留未发送草稿", () => {
    const workflow = parse(readFileSync(".github/workflows/build-ios.yml", "utf8"));
    const harden = workflow.jobs.build.steps.find((step: any) => step.name === "Harden and test the iOS host").run;
    expect(harden).toContain("context.coordinator.installKeyboardDismissalSupport()");
    expect(harden).toContain("UIResponder.keyboardWillHideNotification");
    expect(harden).toContain("input.blur()");
    expect(harden).not.toContain("input.value =");
    const script = harden.match(/blurWebInputOnKeyboardDismissal\([^)]*\) \{[\s\S]*?evaluateJavaScript\("""\n([\s\S]*?)\n\s*""",/)?.[1];
    expect(script).toBeTruthy();
    for (const tag of ["input", "textarea"]) {
      const input = document.createElement(tag) as HTMLInputElement | HTMLTextAreaElement;
      input.value = "未发送的草稿";
      document.body.append(input);
      input.focus();
      expect(document.activeElement).toBe(input);
      new Function(script!.replace("\\(duration)", "250"))();
      expect(document.activeElement).not.toBe(input);
      expect(input.value).toBe("未发送的草稿");
      input.remove();
    }
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    new Function(script!.replace("\\(duration)", "250"))();
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("iOS 普通网页链接使用独立内置浏览器并提供与 Android 一致的操作", () => {
    const workflow = parse(readFileSync(".github/workflows/build-ios.yml", "utf8"));
    const installBrowser = workflow.jobs.build.steps.find(
      (step: any) => step.name === "Install iOS in-app browser source",
    );
    const harden = workflow.jobs.build.steps.find(
      (step: any) => step.name === "Harden and test the iOS host",
    ).run;

    expect(installBrowser.run).toContain(
      "mobile/ios/InAppBrowserViewController.swift",
    );
    expect(installBrowser.run).toContain(
      "pakeplus/PakePlus/InAppBrowserViewController.swift",
    );
    expect(harden).toContain("CodexMobileInAppBrowserViewController.present");
    expect(harden).toContain("download_navigation_anchor");
    expect(harden).toContain("navigationAction.navigationType == .linkActivated");
    expect(harden).toContain("navigationAction.targetFrame == nil");

    const browserSource = readFileSync(
      "mobile/ios/InAppBrowserViewController.swift",
      "utf8",
    );
    expect(browserSource).toContain(
      "final class CodexMobileInAppBrowserViewController: UIViewController",
    );
    expect(browserSource).toContain("WKWebViewConfiguration()");
    expect(browserSource).toContain("observe(\\.title");
    expect(browserSource).toContain("在外部浏览器中打开");
    expect(browserSource).toContain("重新加载");
    expect(browserSource).toContain("桌面版网页");
    expect(browserSource).toContain("全屏打开");
    expect(browserSource).toContain("preferredContentMode = .desktop");
    expect(browserSource).toContain("setNavigationBarHidden");
    expect(browserSource).not.toContain("addScriptMessageHandler");
  });

  it.each(["../1.2.3", "1.2", "1.2.3;echo bad", "1.2.3-beta"])("拒绝不适合 iOS 的版本 %s", (version) => {
    const result = plan("--version", version);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("版本必须是三个数字");
  });
});

it("本地工程准备解析 APP_ID/OTA 配置而不是使用 GitHub 表达式", () => {
  const plain = JSON.parse(plan("--version", "0.2.116").stdout);
  expect(plain.appId).toBe("vip.loock.codexmobile");
  expect(plain.otaBaseUrl).toBe("");
  const custom = spawnSync(process.execPath, ["scripts/prepare-ios.mjs", "--plan", "--version", "0.2.116"], {
    encoding: "utf8", env: { ...process.env, APP_ID: "app.example.mobile", IOS_OTA_BASE_URL: "https://updates.example.com/mobile" },
  });
  expect(custom.status, custom.stderr).toBe(0);
  expect(JSON.parse(custom.stdout)).toMatchObject({ appId: "app.example.mobile", otaBaseUrl: "https://updates.example.com/mobile" });
});
