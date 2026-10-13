import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  it("正式构建只消费冻结版本，不自动分配版本", () => {
    const workflow = parse(readFileSync(".github/workflows/build-mobile.yml", "utf8"));
    const script = workflow.jobs.version.steps.find((step: { id?: string }) => step.id === "version").run;
    expect(script).toContain("validate-release-batch.mjs");
    expect(script).not.toContain("resolve-mobile-version.mjs");
    expect(script).not.toContain("gh api");
  });
  it("双端与本机使用同一个精确 pnpm 版本，避免主版本解析到不可下载的新包", () => {
    const workflow = parse(readFileSync(".github/workflows/build-mobile.yml", "utf8"));
    const setup = workflow.jobs.build.steps.find((step: { uses?: string }) => step.uses === "pnpm/action-setup@v4");
    expect(setup.with.version).toBe("10.34.6");
    for (const platform of ["android", "ios"]) {
      const recipe = parse(readFileSync(`mobile/${platform}/build-recipe.yml`, "utf8"));
      expect(recipe.tools.pnpm.version).toBe(setup.with.version);
    }
  });
  it("Android SDK 沿用 recipe 的空 packages，不安装已删除的 tools", () => {
    const workflow = parse(readFileSync(".github/workflows/build-mobile.yml", "utf8"));
    const recipe = parse(readFileSync("mobile/android/build-recipe.yml", "utf8"));
    const setup = workflow.jobs.build.steps.find((step: { uses?: string }) => step.uses === "android-actions/setup-android@v3");
    expect(setup.with?.packages).toBe(recipe.tools["Android SDK"].packages);
  });
  it("隔离 Android 容器能通过 recipe 的 ../mobile 路径读取原生源文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "android-native-source-"));
    try {
      const source = join(dir, "source/mobile");
      const output = join(dir, "output");
      mkdirSync(join(source, "android"), { recursive: true });
      mkdirSync(join(output, "pakeplus"), { recursive: true });
      writeFileSync(join(source, "android/ActionMenuBridge.kt"), "native-source-fixture");
      const result = spawnSync(process.execPath, ["--input-type=module", "-e",
        'import { linkAndroidSources } from "./scripts/build-mobile.mjs"; await linkAndroidSources(process.argv[1], process.argv[2]);', output, source], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(output, "pakeplus/../mobile/android/ActionMenuBridge.kt"), "utf8")).toBe("native-source-fixture");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("main 自动触发、统一版本、双端成功后才创建 Release", () => {
    const path = ".github/workflows/build-mobile.yml";
    expect(existsSync(path), "缺少双端工作流").toBe(true);
    const source = readFileSync(path, "utf8");
    const workflow = parse(source);
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.push.paths).toEqual([".release-batch.json"]);
    expect(workflow.on.push.paths).not.toContain("server/**");
    expect(workflow.on.workflow_dispatch.inputs.release_version).toBeDefined();
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
    expect(workflow.jobs.build.needs).toBe("version");
    expect(workflow.jobs.build.strategy["fail-fast"]).toBe(false);
    expect(workflow.jobs.build.strategy.matrix.include.map((job: { platform: string }) => job.platform)).toEqual(["android", "ios"]);
    expect(workflow.jobs.build.env.APP_VERSION).toBe("${{ needs.version.outputs.app_version }}");
    expect(workflow.jobs.release.needs).toEqual(["version", "build"]);
    expect(workflow.jobs.release.if).toContain("release_required == 'true'");
    expect(workflow.jobs.build.if).toContain("release_required == 'true'");
    expect(workflow.concurrency.group).toBe("codex-mobile-main-production");
    expect(workflow.concurrency.queue).toBe("max");
    for (const job of ["version", "build", "release"]) {
      const checkout = workflow.jobs[job].steps.find((step: { uses?: string }) => step.uses === "actions/checkout@v4");
      expect(checkout.with["fetch-depth"]).toBe(0);
    }
    expect(source).toContain("--receipts");
    expect(source).toContain("gh auth setup-git");
    expect(source).toContain('remote_tag="$(git ls-remote');
    expect(source).toContain("--run-id");
    expect(source).toContain("git rev-parse");
    expect(workflow.on.workflow_dispatch.inputs.batch_id.required).toBe(true);
    expect(workflow.on.workflow_dispatch.inputs.frozen_sha.required).toBe(true);
    expect(source).toContain("sha256sum --check");
    expect(source).toContain("npm ci");
    expect(source).not.toContain("--ignore-scripts");
    expect(source).toContain("gh release create");
    expect(source).not.toMatch(/npm publish|IOS_P12|IOS_PROFILE|secrets: inherit/);
  });
  it("开发和 PR 检查独立运行且不能发包", () => {
    const path = ".github/workflows/development-checks.yml";
    expect(existsSync(path), "缺少独立开发检查工作流").toBe(true);
    const source = readFileSync(path, "utf8");
    const workflow = parse(source);
    expect(workflow.on.pull_request).toBeDefined();
    expect(workflow.on.push).toBeDefined();
    expect(workflow.permissions.contents).toBe("read");
    expect(source).toContain("npm ci");
    expect(source).not.toContain("--ignore-scripts");
    expect(source).toContain("npm test");
    expect(source).not.toMatch(/gh release|build-mobile.mjs|release-ios.py|npm run build/);
  });

});
