import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, it, expect } from "vitest";

describe("iOS OTA 原生入口", () => {
  it("原生设置只展示版本，不提供更新导航或误导的无障碍标签", () => {
    const source = readFileSync("mobile/ios/NativeUI/NativeSettingsView.swift", "utf8");
    expect(source).not.toContain('open("updates")');
    expect(source).not.toContain("版本与检查更新");
    expect(source).not.toContain("Version and Check for Updates");
    expect(source).toContain('accessibilityIdentifier("native-settings-version")');
    expect(source).toContain("CFBundleShortVersionString");
  });

  it("本地构建安装专用桥，外部浏览器不暴露桥", () => {
    expect(existsSync("mobile/ios/AppUpdateBridge.swift")).toBe(true);
    const recipe = parse(readFileSync("mobile/ios/build-recipe.yml", "utf8"));
    const install = recipe.steps.find((step: any) => step.name === "Install iOS in-app browser source").run;
    const harden = recipe.steps.find((step: any) => step.name === "Harden and test the iOS host").run;
    expect(install).toContain("mobile/ios/AppUpdateBridge.swift");
    expect(harden).toContain("CodexMobileAppUpdateBridge.configure(webView)");
    const source = readFileSync("mobile/ios/AppUpdateBridge.swift", "utf8");
    expect(source).toContain("message.frameInfo.isMainFrame");
    expect(source).toContain("isFileURL");
    expect(source).toContain('scheme == "https"');
    expect(source).toContain("UIApplication.shared.open");
    expect(readFileSync("mobile/ios/InAppBrowserViewController.swift", "utf8")).not.toContain("CodexMobileAppUpdateBridge");
  });
});
