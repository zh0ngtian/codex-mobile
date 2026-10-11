import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";

function plan(...args: string[]) {
  return spawnSync(process.execPath, ["scripts/prepare-ios.mjs", "--plan", ...args], { encoding: "utf8" });
}

describe("iOS 本地工程准备", () => {
  it("注册会话 URL Scheme，并在冷启动网页加载完成后消费目标", () => {
    const recipe = parse(readFileSync("mobile/ios/build-recipe.yml", "utf8"));
    const harden = recipe.steps.find((step: any) => step.name === "Harden and test the iOS host").run;
    expect(harden).toContain('info["CFBundleURLTypes"]');
    expect(harden).toContain('"CFBundleURLSchemes": ["codexmobile"]');
    expect(harden).toContain(".onOpenURL");
    expect(harden).toContain("CodexMobileCompletionRouter.attach(webView)");
    expect(harden).toContain("UserDefaults.standard");
    expect(harden).toContain("codex-mobile-open-thread");
  });
  it("读取本地构建配置中的固定容器与硬化步骤，并输出可构建工程", () => {
    const result = plan("--version", "0.2.91");
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    const recipe = parse(readFileSync("mobile/ios/build-recipe.yml", "utf8"));
    const container = recipe.container;
    expect(output.repository).toBe(container.repository);
    expect(output.ref).toBe(container.ref);
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
    const recipe = parse(readFileSync("mobile/ios/build-recipe.yml", "utf8"));
    const harden = recipe.steps.find((step: any) => step.name === "Harden and test the iOS host").run;
    expect(harden).toContain(".ignoresSafeArea(.container, edges: [.all])");
    expect(harden).toContain("Pinned PakePlus keyboard safe area hook changed");
    expect(harden).toContain("MARKETING_VERSION");
    expect(harden).toContain("CURRENT_PROJECT_VERSION");
    expect(harden).toContain("os.environ[\"APP_VERSION\"]");
  });

  it("WebView 主图层阻止新增几何动画，避免布局后追加动画造成错位", () => {
    const recipe = parse(readFileSync("mobile/ios/build-recipe.yml", "utf8"));
    const harden = recipe.steps.find((step: any) => step.name === "Harden and test the iOS host").run;
    expect(harden.includes("let webView = CodexMobileWebView(frame:")).toBe(true);
    expect(harden.includes("override class var layerClass: AnyClass { CodexMobileWebViewLayer.self }")).toBe(true);
    expect(harden.includes('path == "position" || path == "bounds" || path.hasPrefix("bounds.")')).toBe(true);
    expect(harden.includes("override func add(_ animation: CAAnimation, forKey key: String?)")).toBe(true);
    expect(harden.includes("super.add(animation, forKey: key)")).toBe(true);
  });

  it("iOS 在启动、系统粗体设置变化、回到前台和页面重载时同步字重", () => {
    const recipe = parse(readFileSync("mobile/ios/build-recipe.yml", "utf8"));
    const harden = recipe.steps.find((step: any) => step.name === "Harden and test the iOS host").run;
    expect(harden).toContain("UIAccessibility.isBoldTextEnabled");
    expect(harden).toContain("UIAccessibility.boldTextStatusDidChangeNotification");
    expect(harden).toContain("UIApplication.didBecomeActiveNotification");
    expect(harden).toContain("context.coordinator.installBoldTextSupport(webView)");
    expect(harden).toContain("injectionTime: .atDocumentEnd, forMainFrameOnly: true");
    expect(harden).toContain("data-ios-bold-text");
    expect(harden).toContain('navigation_finished + "        syncBoldText()\\n"');
  });

  it("系统键盘收起时同步取消网页输入焦点，保留未发送草稿", () => {
    const recipe = parse(readFileSync("mobile/ios/build-recipe.yml", "utf8"));
    const harden = recipe.steps.find((step: any) => step.name === "Harden and test the iOS host").run;
    expect(harden).toContain("context.coordinator.installKeyboardDismissalSupport()");
    const source = readFileSync("mobile/ios/KeyboardDismissal.swift", "utf8");
    expect(source).toContain("UIResponder.keyboardWillHideNotification");
    expect(source).toContain("input.blur()");
    expect(source).not.toContain("input.value =");
    const script = source.match(/evaluateJavaScript\("""\n([\s\S]*?)\n\s*""",/)?.[1];
    expect(script).toBeTruthy();
    for (const tag of ["input", "textarea"]) {
      const input = document.createElement(tag) as HTMLInputElement | HTMLTextAreaElement;
      input.value = "未发送的草稿";
      document.body.append(input);
      input.focus();
      expect(document.activeElement).toBe(input);
      new Function(script!.replace("\\(payload)", JSON.stringify({ startedAt: Date.now(), duration: 0, frames: [0, 1], easing: "linear" })))();
      expect(document.activeElement).not.toBe(input);
      expect(input.value).toBe("未发送的草稿");
      input.remove();
    }
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    new Function(script!.replace("\\(payload)", JSON.stringify({ startedAt: Date.now(), duration: 0, frames: [0, 1], easing: "linear" })))();
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("iOS 普通网页链接使用独立内置浏览器并提供与 Android 一致的操作", () => {
    const recipe = parse(readFileSync("mobile/ios/build-recipe.yml", "utf8"));
    const installBrowser = recipe.steps.find(
      (step: any) => step.name === "Install iOS in-app browser source",
    );
    const harden = recipe.steps.find(
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


it("复用系统键盘时间线，网页延迟收到布局时从已过进度开始", async () => {
  const source = readFileSync("mobile/ios/KeyboardDismissal.swift", "utf8");
  const script = source.match(/evaluateJavaScript\("""\n([\s\S]*?)\n\s*""",/)?.[1];
  const composer = document.createElement("form");
  composer.className = "composer-wrap";
  composer.style.bottom = "12px";
  document.body.append(composer);
  vi.spyOn(composer, "getBoundingClientRect").mockReturnValue({ top: 400 } as DOMRect);
  Object.defineProperty(composer, "offsetHeight", { value: 100, configurable: true });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 512, writable: true });
  let completeFirst!: () => void;
  const animation = { currentTime: 0, cancel: vi.fn(), finished: new Promise<void>((resolve) => { completeFirst = resolve; }) };
  const animate = vi.fn((_frames: unknown, _options: unknown) => animation);
  Object.defineProperty(composer, "animate", { value: animate });
  vi.spyOn(Date, "now").mockReturnValue(1120);
  try {
    const payload = JSON.stringify({ startedAt: 1000, duration: 400, frames: [0, 0.7, 1], easing: "linear", viewportHeight: 812, bottomInset: 0 });
    new Function(script!.replaceAll("\\(payload)", payload).replaceAll("\\(keyboardTop)", "520").replaceAll("\\(keyboardEndTop)", "854"))();
    (window as any).innerHeight = 744;
    window.dispatchEvent(new Event("resize"));
    expect(animate).toHaveBeenCalled();
    expect(animation.currentTime).toBe(120);
    expect(animate.mock.calls[0]).toEqual([[{ top: "400px", offset: 0 }, { top: "610px", offset: 0.5 }, { top: "700px", offset: 1 }], { duration: 400, easing: "linear", fill: "forwards" }]);
    window.dispatchEvent(new Event("resize"));
    expect(animate).toHaveBeenCalledTimes(1);
    const next = { currentTime: 0, cancel: vi.fn(), finished: new Promise<void>(() => {}) };
    animate.mockReturnValue(next);
    vi.mocked(Date.now).mockReturnValue(1180);
    Object.defineProperty(composer, "offsetHeight", { value: 80 });
    (window as any).innerHeight = 812;
    window.dispatchEvent(new Event("resize"));
    expect(next.currentTime).toBe(180);
    expect(animate).toHaveBeenCalledTimes(2);
    completeFirst();
    await Promise.resolve();
    expect((window as any).__codexKeyboardDismissal).toBeDefined();
    (window as any).__codexKeyboardDismissal?.finish();
    expect(composer.style.top).toBe("");
    expect(animation.cancel).toHaveBeenCalled();
    expect(next.cancel).toHaveBeenCalled();
  } finally { composer.remove(); vi.restoreAllMocks(); }
});

it("迟到的键盘通知不能额外启动一段动画，重复通知不覆盖原始样式", () => {
  const source = readFileSync("mobile/ios/KeyboardDismissal.swift", "utf8");
  const script = source.match(/evaluateJavaScript\("""\n([\s\S]*?)\n\s*""",/)?.[1];
  const composer = document.createElement("form");
  composer.className = "composer-wrap";
  composer.style.bottom = "12px";
  document.body.append(composer);
  vi.spyOn(composer, "getBoundingClientRect").mockReturnValue({ top: 400 } as DOMRect);
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 512, writable: true });
  const animate = vi.fn();
  Object.defineProperty(composer, "animate", { value: animate });
  vi.spyOn(Date, "now").mockReturnValue(1500);
  const execute = () => new Function(script!.replace("\\(payload)", JSON.stringify({ startedAt: 1000, duration: 400, frames: [0, 1], easing: "linear" })))();
  try {
    execute();
    const first = (window as any).__codexKeyboardDismissal;
    execute();
    expect((window as any).__codexKeyboardDismissal).toBe(first);
    window.dispatchEvent(new Event("resize"));
    expect(animate).not.toHaveBeenCalled();
    expect(composer.style.top).toBe("");
    expect(composer.style.bottom).toBe("12px");
    expect((window as any).__codexKeyboardDismissal).toBeUndefined();
  } finally { (window as any).__codexKeyboardDismissal?.finish(); composer.remove(); vi.restoreAllMocks(); }
});
