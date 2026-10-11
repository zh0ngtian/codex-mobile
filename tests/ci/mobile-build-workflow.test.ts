import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

function resolveVersion(tags: string[], requested?: string) {
  const dir = mkdtempSync(join(tmpdir(), "mobile-version-"));
  try {
    const releases = join(dir, "releases.json");
    writeFileSync(releases, JSON.stringify(tags));
    return spawnSync(process.execPath, ["scripts/resolve-mobile-version.mjs", "--releases", releases,
      ...(requested ? ["--requested", requested] : [])], { encoding: "utf8" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("GitHub 双端自动构建", () => {
  it("统一版本高于正式版本、临时 unsigned IPA 及仓库下限", () => {
    const result = resolveVersion(["v0.2.146", "unsigned-ipa-0.2.147-123-1"]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ app_version: "0.2.148", app_version_code: "2148", release_tag: "v0.2.148" });
    expect(JSON.parse(resolveVersion([]).stdout).app_version).toBe("0.2.123");
  });
  it("允许更高的手动版本，拒绝重用或倒退", () => {
    expect(resolveVersion(["v0.2.147"], "0.2.148").status).toBe(0);
    for (const version of ["0.2.147", "0.2.146"]) {
      expect(resolveVersion(["v0.2.147"], version).stderr).toContain("必须高于");
    }
  });
  it("正确进位并拒绝 Android 无法表示的版本", () => {
    expect(JSON.parse(resolveVersion(["v0.2.999"]).stdout).app_version).toBe("0.3.0");
    expect(JSON.parse(resolveVersion(["v0.999.999"]).stdout).app_version).toBe("1.0.0");
    for (const version of ["0.2.1000", "2101.0.0", "0.2.148-beta", "invalid"]) {
      expect(resolveVersion([], version).status).not.toBe(0);
    }
  });
  it.each(["android", "ios"])("%s 构建 plan 使用现役 recipe 和同一版本", (platform) => {
    const result = spawnSync(process.execPath, ["scripts/build-mobile.mjs", "--platform", platform, "--version", "0.2.148", "--plan"], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const plan = JSON.parse(result.stdout);
    const recipe = parse(readFileSync(`mobile/${platform}/build-recipe.yml`, "utf8"));
    expect(plan).toMatchObject({ platform, version: "0.2.148", container: recipe.container, signing: platform === "android" });
    expect(plan.steps).toContain(platform === "ios" ? "Build unsigned iOS app" : "Build debug APK");
    expect(plan.artifactPath).toContain(platform === "ios" ? "-unsigned.ipa" : ".apk");
  });
  it("非法平台或版本在实际构建前失败", () => {
    for (const [platform, version] of [["web", "0.2.148"], ["ios", "0.2.1000"]]) {
      const result = spawnSync(process.execPath, ["scripts/build-mobile.mjs", "--platform", platform, "--version", version, "--plan"], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
    }
  });
  it("main 自动触发、统一版本、双端成功后才创建 Release", () => {
    const path = ".github/workflows/build-mobile.yml";
    expect(existsSync(path), "缺少双端工作流").toBe(true);
    const source = readFileSync(path, "utf8");
    const workflow = parse(source);
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.push.paths).toContain("src/**");
    expect(workflow.on.push.paths).not.toContain("server/**");
    expect(workflow.on.workflow_dispatch.inputs.release_version).toBeDefined();
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
    expect(workflow.jobs.build.needs).toBe("version");
    expect(workflow.jobs.build.strategy["fail-fast"]).toBe(false);
    expect(workflow.jobs.build.strategy.matrix.include.map((job: { platform: string }) => job.platform)).toEqual(["android", "ios"]);
    expect(workflow.jobs.build.env.APP_VERSION).toBe("${{ needs.version.outputs.app_version }}");
    expect(workflow.jobs.release.needs).toEqual(["version", "build"]);
    expect(workflow.jobs.release.if).toBeUndefined();
    expect(source).toContain("sha256sum --check");
    expect(source).toContain("gh release create");
    expect(source).not.toMatch(/npm publish|IOS_P12|IOS_PROFILE|secrets: inherit/);
  });
});
