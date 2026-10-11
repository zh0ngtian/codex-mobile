#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stepNames = ["Build unsigned iOS app", "Prepare and verify unsigned IPA"];

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败（${result.status}）`);
}

async function main() {
  const { values } = parseArgs({ options: { version: { type: "string" }, plan: { type: "boolean", default: false } } });
  const version = values.version;
  const numbers = /^\d+\.\d+\.\d+$/.test(version ?? "") ? version.split(".").map(Number) : [];
  if (numbers.length !== 3 || numbers[1] > 999 || numbers[2] > 999 || numbers[0] * 1000000 + numbers[1] * 1000 + numbers[2] > 2100000000) {
    throw new Error("版本必须为有效的 major.minor.patch，minor 和 patch 小于 1000");
  }
  const recipe = parse(await readFile(join(root, "mobile/ios/build-recipe.yml"), "utf8"));
  const steps = stepNames.map(name => {
    const step = recipe.steps.find(candidate => candidate.name === name);
    if (!step?.run || step["working-directory"] !== "pakeplus") throw new Error(`未签名构建步骤缺失或工作目录不兼容：${name}`);
    return step;
  });
  if (!steps[0].run.includes('CODE_SIGN_IDENTITY=""') || !steps[0].run.includes("CODE_SIGNING_REQUIRED=NO") || !steps[0].run.includes("CODE_SIGNING_ALLOWED=NO")) {
    throw new Error("构建配置必须关闭 iOS 签名");
  }
  const projectRoot = join(root, ".mobile-build/ios/pakeplus");
  const runnerTemp = join(root, ".mobile-build/ios/runner-temp");
  const plan = { version, signing: false, projectPath: join(projectRoot, "PakePlus.xcodeproj"), artifactPath: join(runnerTemp, `CodexMobile-v${version}-unsigned.ipa`), steps: ["Prepare iOS project", ...stepNames] };
  if (values.plan) { console.log(JSON.stringify(plan, null, 2)); return; }
  if (process.platform !== "darwin") throw new Error("未签名 IPA 编译需要 macOS 和 Xcode；可使用 --plan 预检");
  const env = { ...recipe.env, ...process.env, APP_VERSION: version, RUNNER_TEMP: runnerTemp, GITHUB_ENV: join(runnerTemp, "github-env") };
  run(process.execPath, [join(root, "scripts/prepare-ios.mjs"), "--version", version], root, env);
  for (const step of steps) {
    console.log(`\n▶ ${step.name}`);
    run("bash", ["-euo", "pipefail", "-c", step.run], projectRoot, env);
  }
  const receipt = { ...plan, size: (await stat(plan.artifactPath)).size, sourceCommit: process.env.GITHUB_SHA ?? null };
  await writeFile(join(root, ".mobile-build/unsigned-ios-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
