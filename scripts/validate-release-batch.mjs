#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFile, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { versionCode } from "./resolve-mobile-version.mjs";
import { readReleaseNotes } from "./read-release-notes.mjs";

const manifestPath = ".release-batch.json";
const fail = message => { throw new Error(message); };
const line = value => typeof value === "string" && value.length > 0 && !/[\r\n\0]/.test(value);
function git(root, args, allowFailure = false) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) fail(`git ${args[0]} 失败：${result.stderr.trim()}`);
  return result;
}
export function readSourceCommit(root) {
  return git(root, ["rev-parse", "HEAD"]).stdout.trim();
}
export function validateManifest(batch) {
  if (batch?.schemaVersion !== 1 || !line(batch.batchId)) fail("无效冻结批次 schemaVersion 或 batchId");
  const targets = {
    "vip.loock.codexmobile": { project: "codex-mobile-lan-production", environment: "lan-production", release: true },
    "codex-mobile-gateway": { project: "codex-mobile-gateway-production", environment: "production", release: false },
    "codex-mobile-github-release": { project: "codex-mobile-github-release", environment: "github-release", release: true },
  };
  const target = Object.hasOwn(targets, batch.target ?? "") && targets[batch.target];
  if (!target || batch.project !== target.project || batch.environment !== target.environment || batch.scope !== "codex-mobile-main-production") fail("冻结批次目标、项目、环境或作用域不匹配");
  if (!Array.isArray(batch.tasks) || !batch.tasks.length) fail("冻结批次必须包含任务");
  const ids = new Set();
  for (const task of batch.tasks) {
    if (!line(task?.id) || ids.has(task.id) || !/^[a-f0-9]{40}$/.test(task.sha ?? "")) fail("无效或重复任务来源");
    ids.add(task.id);
    const checks = task.validation?.checks;
    if (!Array.isArray(checks) || !checks.length || checks.some(check => !line(check?.name) || check.status !== "passed")) fail("任务验证必须全部 passed");
  }
  const prepared = batch.prepared;
  if (prepared?.localValidation !== "passed" || !/^[a-f0-9]{64}$/.test(prepared.inputFingerprint ?? "")) fail("缺少本机验证或输入指纹");
  let code;
  if (target.release || prepared.version !== undefined || prepared.buildNumber !== undefined) {
    code = versionCode(prepared.version);
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(prepared.version) ||
      ((target.release || prepared.buildNumber !== undefined) && String(prepared.buildNumber) !== String(code))) fail("冻结版本与构建号不一致");
  }
  // 服务端批次不分配或输出客户端版本；可选参考版本仍须有效。
  return { batch_id: batch.batchId, app_version: target.release ? prepared.version : "", app_version_code: target.release ? String(code) : "",
    release_tag: target.release ? `v${prepared.version}` : "", release_required: String(target.release) };
}
export async function validateReleaseBatch({ root = process.cwd(), batchId, frozenSha, version, githubSha = process.env.GITHUB_SHA, githubRef = process.env.GITHUB_REF } = {}) {
  root = resolve(root);
  const sourceCommit = readSourceCommit(root);
  if (git(root, ["rev-parse", "--is-shallow-repository"]).stdout.trim() !== "false") fail("冻结来源校验需要完整 Git 历史");
  if (githubRef && githubRef !== "refs/heads/main") fail("正式批次仅允许 main");
  if (githubSha && githubSha !== sourceCommit) fail("运行 SHA 与实际 git HEAD 不一致");
  if (git(root, ["status", "--porcelain", "--untracked-files=no"]).stdout.trim()) fail("冻结工作区存在未提交修改");
  const raw = await readFile(join(root, manifestPath), "utf8");
  const committed = git(root, ["show", `HEAD:${manifestPath}`]).stdout;
  if (raw !== committed) fail("冻结 manifest 工作区与提交不一致");
  const manifestCommit = git(root, ["log", "-1", "--format=%H", "--first-parent", "HEAD", "--", manifestPath]).stdout.trim();
  if (manifestCommit !== sourceCommit) fail("实际 git HEAD 必须恰为 manifest 的冻结提交");
  const batch = JSON.parse(raw);
  const outputs = validateManifest(batch);
  for (const task of batch.tasks) {
    if (task.sha === sourceCommit || git(root, ["merge-base", "--is-ancestor", task.sha, sourceCommit], true).status !== 0) fail(`任务 ${task.id} SHA 必须为冻结提交祖先`);
  }
  for (const [name, requested, actual] of [["batchId", batchId, batch.batchId], ["frozen SHA", frozenSha, sourceCommit], ["version", version, batch.prepared.version]]) {
    if (requested !== undefined && requested !== actual) fail(`手动输入 ${name} 与冻结批次不一致`);
  }
  return { batch, sourceCommit, outputs: { ...outputs, source_commit: sourceCommit } };
}
export function createBuildReceipt(context, artifact, { runId = process.env.GITHUB_RUN_ID, runAttempt = process.env.GITHUB_RUN_ATTEMPT } = {}) {
  if (!line(runId) || !line(runAttempt)) fail("正式构建回执必须绑定 GitHub run 与 attempt");
  return { ...artifact, batchId: context.batch.batchId, sourceCommit: context.sourceCommit, version: context.batch.prepared.version,
    buildNumber: String(context.batch.prepared.buildNumber), tasks: context.batch.tasks.map(({ id, sha }) => ({ id, sha })), runId, runAttempt };
}
export async function validateBuildReceipts(context, directory, { root = process.cwd(), runId, runAttempt } = {}) {
  if (context.outputs.release_required !== "true") fail("网关批次不得发布客户端产物");
  if (!line(runId) || !line(runAttempt)) fail("发布回执校验必须指定 run 与 attempt");
  const tag = context.outputs.release_tag;
  const existingTag = git(root, ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`], true);
  if (existingTag.status === 0 && existingTag.stdout.trim() !== context.sourceCommit) fail("真实 tag 目标与冻结 SHA 不一致");
  for (const platform of ["android", "ios"]) {
    const filename = `CodexMobile-v${context.batch.prepared.version}${platform === "android" ? ".apk" : "-unsigned.ipa"}`;
    const receipt = JSON.parse(await readFile(join(directory, `${platform}-build.json`), "utf8"));
    const expected = createBuildReceipt(context, { platform, filename }, { runId, runAttempt });
    for (const [key, value] of Object.entries(expected)) {
      if (JSON.stringify(receipt[key]) !== JSON.stringify(value)) fail(`${platform} 回执 ${key} 与冻结批次或本 run 不一致`);
    }
    const artifact = join(directory, filename);
    const size = (await stat(artifact)).size;
    const sha256 = createHash("sha256").update(await readFile(artifact)).digest("hex");
    if (!size || receipt.size !== size || receipt.sha256 !== sha256) fail(`${platform} 回执文件大小或 SHA-256 不一致`);
  }
}
async function main() {
  const { values } = parseArgs({ options: {
    root: { type: "string" }, "batch-id": { type: "string" }, "frozen-sha": { type: "string" }, version: { type: "string" },
    output: { type: "string" }, notes: { type: "string" }, receipts: { type: "string" }, "run-id": { type: "string" }, "run-attempt": { type: "string" },
  } });
  const context = await validateReleaseBatch({ root: values.root, batchId: values["batch-id"], frozenSha: values["frozen-sha"], version: values.version });
  if (values.receipts) await validateBuildReceipts(context, resolve(values.receipts), { root: values.root, runId: values["run-id"], runAttempt: values["run-attempt"] });
  if (values.notes) {
    const changes = await readReleaseNotes(resolve(values.root || process.cwd()), context.batch);
    await writeFile(values.notes, changes + "\n", "utf8");
  }
  const output = values.output || process.env.GITHUB_OUTPUT;
  if (output) await appendFile(output, Object.entries(context.outputs).map(([key, value]) => `${key}=${value}\n`).join(""));
  console.log(JSON.stringify(context.outputs));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
