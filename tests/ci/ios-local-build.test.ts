import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

function plan(...args: string[]) {
  return spawnSync(process.execPath, ["scripts/prepare-ios.mjs", "--plan", ...args], { encoding: "utf8" });
}

describe("iOS 本地工程准备", () => {
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
      "Generate iOS project", "Harden and test the iOS host",
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

  it.each(["../1.2.3", "1.2", "1.2.3;echo bad", "1.2.3-beta"])("拒绝不适合 iOS 的版本 %s", (version) => {
    const result = plan("--version", version);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("版本必须是三个数字");
  });
});
