#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import { versionCode } from "./resolve-mobile-version.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败（${result.status}）`);
}
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";

export async function linkAndroidSources(output, source = join(root, "mobile")) {
  // recipe 在容器目录通过 ../mobile 读取当前仓库的原生补丁。
  await symlink(source, join(output, "mobile"), "dir");
}

async function main() {
  const { values } = parseArgs({ options: {
    platform: { type: "string" }, version: { type: "string" }, plan: { type: "boolean", default: false },
  } });
  const platform = values.platform;
  if (!["android", "ios"].includes(platform)) throw new Error("平台必须为 android 或 ios");
  const version = values.version;
  const code = versionCode(version);
  const recipe = parse(await readFile(join(root, `mobile/${platform}/build-recipe.yml`), "utf8"));
  if (!/^[\da-f]{40}$/.test(recipe.container?.ref ?? "") || !/^[\w-]+\/[\w-]+$/.test(recipe.container?.repository ?? "")) {
    throw new Error("构建容器必须固定完整 SHA");
  }
  const steps = platform === "ios"
    ? ["Build unsigned iOS app", "Prepare and verify unsigned IPA"].map(name => recipe.steps.find(step => step.name === name))
    : recipe.steps;
  if (steps.some(step => !step?.run || (step["working-directory"] && step["working-directory"] !== "pakeplus"))) {
    throw new Error("构建配置步骤或工作目录不兼容");
  }
  if (platform === "ios" && !["CODE_SIGN_IDENTITY=\"\"", "CODE_SIGNING_REQUIRED=NO", "CODE_SIGNING_ALLOWED=NO"].every(flag => steps[0].run.includes(flag))) {
    throw new Error("云端 IPA 必须关闭签名");
  }
  const output = join(root, ".mobile-build", platform);
  const container = join(output, "pakeplus");
  const runnerTemp = join(output, "runner-temp");
  const filename = `CodexMobile-v${version}${platform === "ios" ? "-unsigned.ipa" : ".apk"}`;
  const artifactPath = join(root, ".mobile-build/artifacts", filename);
  const plan = { platform, version, signing: platform === "android", container: recipe.container, artifactPath,
    steps: [...(platform === "ios" ? ["Prepare iOS project"] : []), ...steps.map(step => step.name)] };
  if (values.plan) { console.log(JSON.stringify(plan, null, 2)); return; }
  if (platform === "ios" && process.platform !== "darwin") throw new Error("iOS 构建需要 macOS 和 Xcode");
  if (platform === "android" && process.platform !== "linux") throw new Error("Android 云端 recipe 需要 Linux");
  const env = { ...recipe.env, ...process.env, APP_VERSION: version, APP_VERSION_CODE: String(code), RUNNER_TEMP: runnerTemp,
    GITHUB_ENV: join(runnerTemp, "github-env") };
  if (platform === "ios") {
    run(process.execPath, [join(root, "scripts/prepare-ios.mjs"), "--version", version], root, env);
  } else {
    // 不覆盖已有构建目录；每次 CI checkout 都有独立输出目录。
    await mkdir(container, { recursive: true });
    await linkAndroidSources(output);
    run("git", ["init", "--quiet"], container, env);
    run("git", ["remote", "add", "origin", `https://github.com/${recipe.container.repository}.git`], container, env);
    run("git", ["fetch", "--depth=1", "origin", recipe.container.ref], container, env);
    run("git", ["checkout", "--detach", "FETCH_HEAD"], container, env);
  }
  await mkdir(runnerTemp, { recursive: true });
  for (const step of steps) {
    console.log(`\n▶ ${step.name}`);
    const cwd = step["working-directory"] ? container : root;
    const script = step["working-directory"] ? step.run : step.run.replaceAll("pakeplus/", `${shellQuote(container)}/`);
    run("bash", ["-euo", "pipefail", "-c", script], cwd, env);
  }
  const built = join(runnerTemp, ...(platform === "android" ? ["apk"] : []), filename);
  const size = (await stat(built)).size;
  if (!size) throw new Error("安装包为空");
  const sha256 = createHash("sha256").update(await readFile(built)).digest("hex");
  await mkdir(dirname(artifactPath), { recursive: true });
  await copyFile(built, artifactPath);
  await writeFile(`${artifactPath}.sha256`, `${sha256}  ${basename(artifactPath)}\n`);
  const receipt = { ...plan, size, sha256, sourceCommit: process.env.GITHUB_SHA ?? null };
  await writeFile(join(dirname(artifactPath), `${platform}-build.json`), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
