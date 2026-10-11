import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function plan(version: string) {
  return spawnSync(process.execPath, ["scripts/build-unsigned-ios.mjs", `--version=${version}`, "--plan"], { encoding: "utf8" });
}

describe("未签名 iOS 构建入口", () => {
  it("在非 Mac 环境也能预检现有设备构建与 IPA 产物路径", () => {
    const result = plan("0.2.147");
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.version).toBe("0.2.147");
    expect(output.signing).toBe(false);
    expect(output.projectPath).toBe(resolve(".mobile-build/ios/pakeplus/PakePlus.xcodeproj"));
    expect(output.artifactPath).toBe(resolve(".mobile-build/ios/runner-temp/CodexMobile-v0.2.147-unsigned.ipa"));
    expect(output.steps).toEqual(["Prepare iOS project", "Build unsigned iOS app", "Prepare and verify unsigned IPA"]);
  });

  it.each(["0.2", "0.2.147;echo injected", "0.2.1000", "-1.2.147"])("拒绝不合法版本 %s，不进入构建", (version) => {
    const result = plan(version);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("版本必须");
    expect(result.stdout).toBe("");
  });
});
