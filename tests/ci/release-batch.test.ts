import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const validator = resolve("scripts/validate-release-batch.mjs");
function fixture(change?: (batch: any) => void) {
  const root = mkdtempSync(join(tmpdir(), "frozen-batch-"));
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  git("init", "-q"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Test");
  writeFileSync(join(root, "source.txt"), "source"); git("add", "."); git("commit", "-qm", "task");
  const task = git("rev-parse", "HEAD");
  const batch = { schemaVersion: 1, batchId: "batch-123", project: "codex-mobile-lan-production", scope: "codex-mobile-main-production", target: "vip.loock.codexmobile", environment: "lan-production", tasks: [{ id: "task-1", sha: task, validation: { checks: [{ name: "ci", status: "passed" }] } }], prepared: { version: "0.2.148", buildNumber: 2148, localValidation: "passed", inputFingerprint: "b".repeat(64) } };
  change?.(batch);
  writeFileSync(join(root, ".release-batch.json"), JSON.stringify(batch)); git("add", "."); git("commit", "-qm", "freeze");
  const frozen = git("rev-parse", "HEAD");
  const run = (...args: string[]) => spawnSync(process.execPath, [validator, "--root", root, ...args], { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_SHA: "", GITHUB_EVENT_NAME: "", GITHUB_REF: "" } });
  return { root, git, batch, task, frozen, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("冻结批次来源门禁", () => {
  it("从最终 git HEAD 输出冻结版本、构建号、任务与批次", () => {
    const f = fixture(); try {
      const output = join(f.root, "github-output");
      const result = f.run("--batch-id", f.batch.batchId, "--frozen-sha", f.frozen, "--version", "0.2.148", "--output", output);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ batch_id: "batch-123", source_commit: f.frozen, app_version: "0.2.148", app_version_code: "2148", release_required: "true", release_tag: "v0.2.148" });
      expect(readFileSync(output, "utf8")).toContain("source_commit=" + f.frozen);
    } finally { f.cleanup(); }
  });
  it("网关批次跳过客户端构建", () => {
    const f = fixture(b => { b.project = "codex-mobile-gateway-production"; b.target = "codex-mobile-gateway"; b.environment = "production"; });
    try { const r = f.run(); expect(r.status, r.stderr).toBe(0); expect(JSON.parse(r.stdout).release_required).toBe("false"); } finally { f.cleanup(); }
  });
  it.each([
    ["未知目标", (b: any) => b.target = "unknown"],
    ["错误环境", (b: any) => b.environment = "production"],
    ["错误项目", (b: any) => b.project = "other"],
    ["错误作用域", (b: any) => b.scope = "other"],
    ["验证未通过", (b: any) => b.tasks[0].validation.checks[0].status = "failed"],
    ["缺少任务验证", (b: any) => b.tasks[0].validation.checks = []],
    ["无任务", (b: any) => b.tasks = []],
    ["伪造任务来源", (b: any) => b.tasks[0].sha = "a".repeat(40)],
    ["本机未通过", (b: any) => b.prepared.localValidation = "failed"],
    ["不一致构建号", (b: any) => b.prepared.buildNumber = 999],
    ["非法版本", (b: any) => b.prepared.version = "0.2.148-beta"],
    ["缺少指纹", (b: any) => b.prepared.inputFingerprint = ""],
    ["无效指纹", (b: any) => b.prepared.inputFingerprint = "wrong"],
    ["输出注入", (b: any) => b.batchId = "batch\nrelease_required=true"],
  ])("拒绝%s", (_, change) => {
    const f = fixture(change as any); try { expect(f.run().status).not.toBe(0); } finally { f.cleanup(); }
  });
  it("拒绝冻结提交之后的任意提交", () => {
    const f = fixture(); try { writeFileSync(join(f.root, "source.txt"), "changed"); f.git("add", "."); f.git("commit", "-qm", "later"); expect(f.run().stderr).toContain("冻结提交"); } finally { f.cleanup(); }
  });
  it("拒绝未提交 manifest 改写", () => {
    const f = fixture(); try { writeFileSync(join(f.root, ".release-batch.json"), JSON.stringify({ ...f.batch, batchId: "other" })); expect(f.run().stderr).toContain("工作区"); } finally { f.cleanup(); }
  });
  it.each([["--batch-id", "other"], ["--frozen-sha", "a".repeat(40)], ["--version", "0.2.149"]])("拒绝手动输入 %s 不一致", (arg, value) => {
    const f = fixture(); try { expect(f.run(arg, value).status).not.toBe(0); } finally { f.cleanup(); }
  });
  it("发布前校验双端回执、当前 run、真实文件散列与 tag 目标", () => {
    const f = fixture(); try {
      const artifacts = join(f.root, "artifacts"); mkdirSync(artifacts);
      for (const platform of ["android", "ios"]) {
        const filename = `CodexMobile-v0.2.148${platform === "android" ? ".apk" : "-unsigned.ipa"}`;
        const data = Buffer.from(platform);
        writeFileSync(join(artifacts, filename), data);
        writeFileSync(join(artifacts, `${platform}-build.json`), JSON.stringify({ platform, version: "0.2.148", buildNumber: "2148", batchId: f.batch.batchId, sourceCommit: f.frozen, tasks: [{ id: "task-1", sha: f.task }], runId: "100", runAttempt: "1", filename, size: data.length, sha256: createHash("sha256").update(data).digest("hex") }));
      }
      const args = ["--receipts", artifacts, "--run-id", "100", "--run-attempt", "1"];
      expect(f.run(...args).status).toBe(0);
      expect(f.run(...args, "--run-id", "101").status).not.toBe(0);
      f.git("tag", "v0.2.148", f.task);
      expect(f.run(...args).stderr).toContain("tag");
      f.git("tag", "-f", "v0.2.148", f.frozen);
      expect(f.run(...args).status).toBe(0);
      writeFileSync(join(artifacts, "CodexMobile-v0.2.148.apk"), "tampered");
      expect(f.run(...args).status).not.toBe(0);
    } finally { f.cleanup(); }
  });
  it("拒绝伪造 GITHUB_SHA 与非 main 正式运行", () => {
    const f = fixture(); try {
      for (const env of [{ GITHUB_SHA: f.task, GITHUB_REF: "refs/heads/main" }, { GITHUB_SHA: f.frozen, GITHUB_REF: "refs/heads/development" }]) {
        const r = spawnSync(process.execPath, [validator, "--root", f.root], { encoding: "utf8", env: { ...process.env, ...env, GITHUB_OUTPUT: "" } });
        expect(r.status).not.toBe(0);
      }
    } finally { f.cleanup(); }
  });
  it("拒绝同一 manifest 被额外空提交重用", () => {
    const f = fixture(); try { f.git("commit", "--allow-empty", "-qm", "later"); expect(f.run().stderr).toContain("冻结提交"); } finally { f.cleanup(); }
  });
  it("拒绝未完整获取的 Git 历史", () => {
    const f = fixture(); const clone = mkdtempSync(join(tmpdir(), "shallow-batch-"));
    try {
      const r = spawnSync("git", ["clone", "--depth=1", "file://" + f.root, clone], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      const check = spawnSync(process.execPath, [validator, "--root", clone], { encoding: "utf8", env: { ...process.env, GITHUB_SHA: "", GITHUB_REF: "", GITHUB_OUTPUT: "" } });
      expect(check.status).not.toBe(0); expect(check.stderr).toContain("完整 Git 历史");
    } finally { f.cleanup(); rmSync(clone, { recursive: true, force: true }); }
  });

});
