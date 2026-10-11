import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

function readProjectFile(path: string) {
  return readFileSync(path, "utf8");
}

interface RecipeStep {
  name?: string;
  run?: string;
}

interface Recipe {
  steps: RecipeStep[];
}

function readRecipe(path: string) {
  const source = readProjectFile(path);
  const recipe = parse(source) as Recipe;
  expect(recipe.steps).toBeInstanceOf(Array);
  return { source, recipe };
}

function readRunStep(recipe: Recipe, name: string) {
  const step = recipe.steps.find((candidate) => candidate.name === name);
  expect(step, `找不到构建步骤：${name}`).toBeDefined();
  expect(step?.run, `构建步骤没有 run 脚本：${name}`).toBeTypeOf("string");
  return step?.run ?? "";
}

function readAssetScanner(recipe: Recipe) {
  const buildFrontend = readRunStep(recipe, "Build embedded frontend");
  const match = buildFrontend.match(
    /scan-mobile-assets\.cjs" <<'NODE'\n([\s\S]*?)\nNODE\n/,
  );

  expect(match, "找不到移动资源扫描器 heredoc").not.toBeNull();
  return match?.[1] ?? "";
}

function runAssetScanner(scanner: string, source: string) {
  const directory = mkdtempSync(join(tmpdir(), "codex-mobile-scanner-"));
  const fixture = join(directory, "custom.js");
  writeFileSync(fixture, source);
  try {
    return spawnSync(process.execPath, ["-", fixture], {
      input: scanner,
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("移动 App 本地构建配置", () => {
  it("主界面禁用原生捏合缩放，独立网页保留缩放", () => {
    const ios = readRunStep(readRecipe("mobile/ios/build-recipe.yml").recipe, "Harden and test the iOS host");
    expect(ios).toContain('"webConfiguration.ignoresViewportScaleLimits = false"');
    expect(ios).toContain("scrollView.pinchGestureRecognizer?.isEnabled = false");
    const iosBrowser = readProjectFile("mobile/ios/InAppBrowserViewController.swift");
    expect(iosBrowser).toContain("WKWebView(frame: .zero, configuration: configuration)");
    expect(iosBrowser).not.toContain("pinchGestureRecognizer?.isEnabled = false");
    const android = readRunStep(readRecipe("mobile/android/build-recipe.yml").recipe, "Harden and test embedded Android project");
    expect(android).toContain("webView.settings.setSupportZoom(false)");
    expect(android).toContain("webView.settings.builtInZoomControls = false");
    const androidBrowser = readProjectFile("mobile/android/InAppBrowserActivity.kt");
    expect(androidBrowser).toContain("builtInZoomControls = true");
    expect(androidBrowser).not.toContain("setSupportZoom(false)");
  });

  it.each(["android", "ios"])("%s 允许 Mermaid 依赖内置文档和 XML 命名空间，仍拦截固定私网地址与口令", (platform) => {
    const { recipe } = readRecipe(`mobile/${platform}/build-recipe.yml`);
    const scanner = readAssetScanner(recipe);
    const dependencyUrls = [
      "https://github.com/mermaid-js/mermaid/issues.",
      "https://github.com/mermaid-js/mermaid/releases/tag/v11.0.0)",
      "https://github.com/markedjs/marked.",
      "https://chevrotain.io/docs/guide/resolving_lexer_errors.html#COMPLEMENT",
      "https://github.com/chevrotain/chevrotain/issues/564#issuecomment-349062346",
      "https://langium.org/docs/reference/configuration-services/#resolving-cyclic-dependencies",
      "https://en.wikipedia.org/wiki/LL_parser#Left_factoring.",
      "http://www.eclipse.org/elk/ElkGraph",
      "http:///org/eclipse/emf/ecore/util/ExtendedMetaData",
      "http://www.eclipse.org/emf/2002/Ecore",
      "http://www.eclipse.org/emf/2003/XMLType",
    ];
    const result = runAssetScanner(scanner, JSON.stringify(dependencyUrls));
    expect(result.status, result.stderr).toBe(0);
    expect(runAssetScanner(scanner, '"http://192.168.0.2:18766"').status).not.toBe(0);
    expect(runAssetScanner(scanner, '"https://example.com/?token=secret-token"').status).not.toBe(0);
  });

  it("Android edge-to-edge 底部扣除 IME 且保留顶部安全区，硬化检查防止模板漂移", () => {
    const { recipe } = readRecipe("mobile/android/build-recipe.yml");
    const hardenHost = readRunStep(recipe, "Harden and test embedded Android project");
    const template = hardenHost.match(/edge_to_edge_insets = "\\n"\.join\(\(\n([\s\S]*?)\n\s*\)\)/);
    expect(template, "找不到原生 inset 模板").not.toBeNull();
    const generatedInsets = template![1].split("\n")
      .map((line) => JSON.parse(line.trim().replace(/,$/, "")))
      .join("\n");
    expect(generatedInsets).toContain("val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())");
    expect(generatedInsets).toContain("view.setPadding(systemBar.left, 0, systemBar.right, maxOf(systemBar.bottom, imeInsets.bottom))");
    expect(generatedInsets).toContain("nativeSafeAreaTopCssPx =\n                systemBar.top / resources.displayMetrics.density.toDouble()");
    expect(hardenHost).toContain("grep -Fq 'val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())'");
    expect(hardenHost).toContain("'view.setPadding(systemBar.left, 0, systemBar.right, maxOf(systemBar.bottom, imeInsets.bottom))' \\\n  app/src/main/java/com/app/pakeplus/MainActivity.kt");
  });

  it("Vite 使用同时兼容 Web 与本地 WebView 的相对资源路径", () => {
    expect(readProjectFile("vite.config.ts")).toContain('base: "./"');
  });

  it("移动图标合成后裁掉圆角矩形外侧透明留白", () => {
    const composer = readProjectFile("scripts/compose-mobile-app-icon.sh");

    expect(composer).toContain("crop=824:824:100:100");
    expect(composer).toContain("color=c=white:s=824x824");
    expect(composer).toContain(
      "fillborders=left=100:right=100:top=100:bottom=100:mode=smear",
    );
    expect(composer).toContain("geq=r=255:g=255:b=255:a='255*Y/103'");
    expect(composer).toContain("overlay=x=0:y=920");
    expect(composer).toContain("format=rgb24");
    expect(composer).toContain("scale=1024:1024:flags=lanczos");
  });

  it("Android 只构建一个不绑定后端的 Codex Mobile App", () => {
    const { source, recipe } = readRecipe(
      "mobile/android/build-recipe.yml",
    );
    const installIcon = readRunStep(
      recipe,
      "Install Codex Mobile app icon",
    );
    const buildFrontend = readRunStep(recipe, "Build embedded frontend");
    const hardenHost = readRunStep(
      recipe,
      "Harden and test embedded Android project",
    );
    const verifyArtifact = readRunStep(recipe, "Prepare and verify APK");
    const scanner = readAssetScanner(recipe);

    expect(installIcon).toContain(
      "docs/assets/app-icon/codex-mobile-app-icon-1024.png",
    );
    expect(installIcon).toContain("readUInt32BE(16) !== 1024");
    expect(installIcon).toContain('cp "$icon" pakeplus/app-icon.png');
    expect(installIcon).toContain('cmp "$icon" pakeplus/app-icon.png');
    expect(buildFrontend).toContain("npm ci");
    expect(buildFrontend).toContain("npm run build");
    expect(buildFrontend).toContain("cp -R dist/. pakeplus/scripts/www/");
    expect(source).toContain('packages: ""');
    expect(buildFrontend).toContain("allowedUrlPrefixes");
    expect(buildFrontend).toContain("authorization");
    expect(buildFrontend).toContain("bearer");
    expect(buildFrontend).toContain("169\\.254");
    expect(buildFrontend).toContain("::1");
    expect(buildFrontend).toContain(
      "https://api.github.com/repos/loock-ai/codex-mobile/releases/",
    );
    expect(buildFrontend).toContain(
      "https://github.com/loock-ai/codex-mobile/releases/",
    );
    expect(
      runAssetScanner(
        scanner,
        'const location = "https://maps.google.com/?q=31.230416,121.473701";',
      ).status,
    ).toBe(0);
    expect(runAssetScanner(scanner, 'const socket = "wss://gateway.example/ws";').status)
      .not.toBe(0);
    expect(
      runAssetScanner(
        scanner,
        'const token = "literal-secret-value"; const authorization = "Bearer abcdefghijklmnopqrstuvwxyz";',
      ).status,
    ).not.toBe(0);
    expect(
      runAssetScanner(
        scanner,
        'const docs = "https://react.dev/errors/"; const sample = "http://host.local:18766/?token=xxx"; const sentinel = "https://www.pakeplus.com/\0\b";',
      ).status,
    ).toBe(0);
    expect(
      runAssetScanner(
        scanner,
        'const manifest = "http://192.168.123.79:8765/channels/codex-mobile/latest.json"; const apk = "http://192.168.123.79:8765/channels/codex-mobile/latest.apk";',
      ).status,
    ).toBe(0);
    expect(hardenHost).toContain("app/src/main/assets/index.html");
    expect(hardenHost).toContain("allowed_permissions");
    expect(source).toContain(".phone.camera = true");
    expect(hardenHost).toContain("android.permission.CAMERA");
    expect(hardenHost).toContain("android.permission.RECORD_AUDIO");
    expect(hardenHost).toContain("android.permission.POST_NOTIFICATIONS");
    expect(hardenHost).toContain("android.permission.ACCESS_COARSE_LOCATION");
    expect(hardenHost).toContain("android.permission.ACCESS_FINE_LOCATION");
    expect(hardenHost).toContain("setGeolocationEnabled(true)");
    expect(hardenHost).toContain("onGeolocationPermissionsShowPrompt");
    expect(hardenHost).toContain("onPermissionRequest");
    expect(hardenHost).toContain("PermissionRequest.RESOURCE_AUDIO_CAPTURE");
    expect(hardenHost).toContain("fun realtimeAudioStart()");
    expect(hardenHost).toContain("fun realtimeAudioStop()");
    expect(hardenHost).toContain("fun realtimeAudioSetMuted(");
    expect(hardenHost).toContain("android.media.AudioRecord");
    expect(hardenHost).toContain("codex-mobile-realtime-audio");
    expect(hardenHost).toContain(
      "fun requestCompletionNotificationPermission()",
    );
    expect(hardenHost).toContain("fun showCompletionNotification(");
    expect(hardenHost).toContain("fun consumeCompletionNotificationTarget()");
    expect(hardenHost).toContain("override fun onNewIntent(");
    expect(hardenHost).toContain("codex-mobile-open-thread");
    expect(hardenHost).toContain("NotificationCompat.Builder");
    expect(hardenHost).toContain("codex-mobile-run-completed");
    expect(hardenHost).toContain('android:allowBackup="false"');
    expect(hardenHost).toContain("enableEdgeToEdge()");
    expect(hardenHost).toContain(
      "view.setPadding(systemBar.left, 0, systemBar.right, maxOf(systemBar.bottom, imeInsets.bottom))",
    );
    expect(hardenHost).toContain(
      "systemBar.top / resources.displayMetrics.density.toDouble()",
    );
    expect(hardenHost).toContain("nativeSafeAreaTopCssPx");
    expect(hardenHost).toContain("fun safeAreaTopCssPx(): Double");
    expect(hardenHost).toContain("evaluateJavascript");
    expect(hardenHost).toContain(".fullScreen == false");
    expect(verifyArtifact).toContain("apkanalyzer manifest print");
    expect(verifyArtifact).toContain(
      "DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
    );
    expect(verifyArtifact).toContain("protectionLevel");
    expect(verifyArtifact).toContain('{"signature", "0x2"}');
    expect(verifyArtifact).toContain("CodexMobile-unpacked-assets");
    expect(verifyArtifact).toContain(
      'node "$RUNNER_TEMP/scan-mobile-assets.cjs" "$unpacked_assets/assets"',
    );
    expect(source).toContain(".android.isHtml = true");
    expect(source).toContain('.android.safeArea = "all"');
    expect(readProjectFile("src/styles.css")).not.toContain(
      "html.android-webview { --safe-area-top: 0px; }",
    );
    expect(readProjectFile("src/styles.css")).toContain(
      "--native-safe-area-top: 0px",
    );
    expect(readProjectFile("src/styles.css")).toContain(
      "--safe-area-top: max(env(safe-area-inset-top, 0px), var(--native-safe-area-top), var(--browser-edge-top))",
    );
    expect(readProjectFile("src/styles.css")).toContain(
      "html.native-webview { --browser-edge-top: 0px; --browser-edge-bottom: 0px; }",
    );
    expect(source).toContain("vip.loock.codexmobile");
    expect(source).not.toContain("matrix:");
    expect(source).not.toContain("page_url");
    const privateAddresses = source.match(/192\.168\.\d+\.\d+/g) ?? [];
    expect(privateAddresses.length).toBeGreaterThan(0);
    expect(new Set(privateAddresses)).toEqual(new Set(["192.168.123.79"]));
  });

  it("Android 普通网页链接使用独立内置浏览器并提供参考图中的操作", () => {
    const { recipe } = readRecipe(
      "mobile/android/build-recipe.yml",
    );
    const hardenHost = readRunStep(
      recipe,
      "Harden and test embedded Android project",
    );

    expect(hardenHost).toContain("mobile/android/InAppBrowserActivity.kt");
    expect(hardenHost).toContain("InAppBrowserActivity.createIntent");
    expect(hardenHost).toContain('".InAppBrowserActivity"');
    expect(hardenHost).toContain('f"{{{android}}}exported", "false"');
    expect(hardenHost).toContain(
      'fixedUrl.startsWith("http://", ignoreCase = true)',
    );
    expect(hardenHost).toContain(
      'fixedUrl.startsWith("https://", ignoreCase = true)',
    );
    expect(hardenHost).toContain("required_drawables");

    const browserSource = readProjectFile(
      "mobile/android/InAppBrowserActivity.kt",
    );
    expect(browserSource).toContain(
      "class InAppBrowserActivity : AppCompatActivity()",
    );
    expect(browserSource).toContain("MaterialToolbar");
    expect(browserSource).toContain("onReceivedTitle");
    expect(browserSource).toContain("在外部浏览器中打开");
    expect(browserSource).toContain("重新加载");
    expect(browserSource).toContain("桌面版网页");
    expect(browserSource).toContain("全屏打开");
    expect(browserSource).toContain("openInExternalBrowser");
    expect(browserSource).toContain("toggleDesktopMode");
    expect(browserSource).toContain("enterFullscreen");
    expect(browserSource).toContain("webView.canGoBack()");
    expect(browserSource).toContain(
      "R.drawable.ic_in_app_browser_close",
    );
    expect(browserSource).toContain(
      "R.drawable.ic_in_app_browser_more",
    );
    expect(browserSource).not.toContain("addJavascriptInterface");
    expect(
      readProjectFile(
        "mobile/android/res/drawable/ic_in_app_browser_open_in_new.xml",
      ),
    ).toContain("Material Icons Round");
    expect(
      readProjectFile(
        "mobile/android/res/drawable/ic_in_app_browser_desktop.xml",
      ),
    ).toContain("Material Icons Round");
  });

  it("Android 更新桥仅允许固定局域网渠道、校验摘要并只增加安装权限", () => {
    const { source, recipe } = readRecipe(
      "mobile/android/build-recipe.yml",
    );
    const hardenHost = readRunStep(
      recipe,
      "Harden and test embedded Android project",
    );
    const verifyArtifact = readRunStep(recipe, "Prepare and verify APK");

    expect(hardenHost).toContain("REQUEST_INSTALL_PACKAGES");
    expect(hardenHost).toContain("FileProvider");
    expect(hardenHost).toContain("update_file_paths");
    expect(hardenHost).toContain(
      "http://192.168.123.79:8765/channels/codex-mobile/latest.apk",
    );
    expect(hardenHost).toContain("instanceFollowRedirects = false");
    expect(hardenHost).toContain("MessageDigest.getInstance(\"SHA-256\")");
    expect(hardenHost).toContain("fun appVersion(): String");
    expect(hardenHost).toContain("getPackageInfo");
    expect(hardenHost).toContain("fun installApk(");
    expect(hardenHost).toContain("codex-mobile-app-update");
    expect(hardenHost).toContain("canRequestPackageInstalls");
    expect(verifyArtifact).toContain("REQUEST_INSTALL_PACKAGES");
    expect(verifyArtifact).toContain(".fileprovider");
    expect(source).not.toMatch(
      /CODEX_MOBILE_TOKEN\s*:\s*[A-Za-z0-9._~+/%=-]{8,}/,
    );
  });

  it("iOS 只构建一个内置同一份前端的 Codex Mobile App", () => {
    const { source, recipe } = readRecipe("mobile/ios/build-recipe.yml");
    const installIcon = readRunStep(
      recipe,
      "Install Codex Mobile app icon",
    );
    const buildFrontend = readRunStep(recipe, "Build embedded frontend");
    const hardenHost = readRunStep(recipe, "Harden and test the iOS host");
    const verifyArtifact = readRunStep(
      recipe,
      "Prepare and verify unsigned IPA",
    );
    const scanner = readAssetScanner(recipe);

    expect(installIcon).toContain(
      "docs/assets/app-icon/codex-mobile-app-icon-1024.png",
    );
    expect(installIcon).toContain("readUInt32BE(16) !== 1024");
    expect(installIcon).toContain('cp "$icon" pakeplus/app-icon.png');
    expect(installIcon).toContain('cmp "$icon" pakeplus/app-icon.png');
    expect(source).toContain(".phone.camera = true");
    expect(source).toContain("NSCameraUsageDescription");
    expect(source).toContain("NSMicrophoneUsageDescription");
    expect(source).not.toContain('APP_VERSION: "1.0.0"');
    expect(buildFrontend).toContain("npm ci");
    expect(buildFrontend).toContain("npm run build");
    expect(buildFrontend).toContain("cp -R dist/. pakeplus/scripts/www/");
    expect(buildFrontend).toContain("allowedUrlPrefixes");
    expect(buildFrontend).toContain("authorization");
    expect(buildFrontend).toContain("bearer");
    expect(buildFrontend).toContain("169\\.254");
    expect(buildFrontend).toContain("::1");
    expect(buildFrontend).toContain(
      "https://api.github.com/repos/loock-ai/codex-mobile/releases/",
    );
    expect(buildFrontend).toContain(
      "https://github.com/loock-ai/codex-mobile/releases/",
    );
    expect(
      runAssetScanner(
        scanner,
        'const location = "https://maps.google.com/?q=31.230416,121.473701";',
      ).status,
    ).toBe(0);
    expect(runAssetScanner(scanner, 'const socket = "ws://gateway.example/ws";').status)
      .not.toBe(0);
    expect(
      runAssetScanner(
        scanner,
        'const manifest = "http://192.168.123.79:8765/channels/codex-mobile/latest.json"; const apk = "http://192.168.123.79:8765/channels/codex-mobile/latest.apk";',
      ).status,
    ).toBe(0);
    expect(hardenHost).toContain("PakePlus/index.html");
    expect(hardenHost).toContain(
      "Delete :NSAppTransportSecurity:NSAllowsArbitraryLoads",
    );
    expect(hardenHost).toContain("Delete :UIBackgroundModes");
    expect(hardenHost).toContain("Add :NSLocationWhenInUseUsageDescription");
    expect(hardenHost).not.toContain("Delete :NSLocationWhenInUseUsageDescription");
    expect(hardenHost).toContain("developerExtrasEnabled");
    expect(hardenHost).toContain("case .microphone");
    expect(hardenHost).toContain("return .grant");
    expect(hardenHost).toContain('name: "realtimeAudio"');
    expect(hardenHost).toContain("AVAudioEngine");
    expect(hardenHost).toContain("codex-mobile-realtime-audio");
    expect(hardenHost).toContain("import UserNotifications");
    expect(hardenHost).toContain('name: "completionNotification"');
    expect(hardenHost).toContain("UNUserNotificationCenter");
    expect(hardenHost).toContain("codex-mobile-run-completed");
    expect(hardenHost).toContain("didReceive response: UNNotificationResponse");
    expect(hardenHost).toContain("codex-mobile-open-thread");
    expect(hardenHost).toContain(
      'index_source.replace("./assets/", "./")',
    );
    expect(hardenHost).toContain(
      'node "$RUNNER_TEMP/scan-mobile-assets.cjs" PakePlus',
    );
    expect(verifyArtifact).toContain("Print :DEBUG");
    expect(verifyArtifact).toContain(":NSLocationWhenInUseUsageDescription");
    expect(verifyArtifact).toContain(":UIBackgroundModes");
    expect(verifyArtifact).toContain('find "$app" -maxdepth 1');
    expect(verifyArtifact).toContain(
      "Payload/PakePlus.app/index-.+\\.js",
    );
    expect(verifyArtifact).not.toContain('find "$app/assets"');
    expect(verifyArtifact).toContain("CodexMobile-ios-unpacked");
    expect(verifyArtifact).toContain(
      'node "$RUNNER_TEMP/scan-mobile-assets.cjs"',
    );
    expect(verifyArtifact).toContain('"$unpacked/Payload/PakePlus.app"');
    expect(verifyArtifact).toContain(".sha256");
    expect(source).toContain(".ios.isHtml = true");
    expect(source).toContain("vip.loock.codexmobile");
    expect(source).toContain("CODE_SIGNING_ALLOWED=NO");
    expect(source).not.toContain("page_url");
    const privateAddresses = source.match(/192\.168\.\d+\.\d+/g) ?? [];
    expect(privateAddresses.length).toBeGreaterThan(0);
    expect(new Set(privateAddresses)).toEqual(new Set(["192.168.123.79"]));
  });
});
