#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stepNames = [
  "Install Codex Mobile app icon", "Build embedded frontend",
  "Configure PakePlus for embedded HTML", "Install PakePlus dependencies",
  "Generate iOS project", "Harden and test the iOS host",
];

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败（${result.status}）`);
}

async function main() {
  const { values } = parseArgs({ options: {
    version: { type: "string" }, plan: { type: "boolean", default: false },
  }});
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const version = values.version ?? pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("版本必须是三个数字，例如 0.2.91");
  const workflow = parse(await readFile(join(root, ".github/workflows/build-ios.yml"), "utf8"));
  const steps = workflow.jobs.build.steps;
  const checkout = steps.find((step) => step.name === "Checkout pinned PakePlus iOS");
  if (!/^[\da-f]{40}$/.test(checkout?.with?.ref ?? "") ||
      !/^[\w-]+\/[\w-]+$/.test(checkout?.with?.repository ?? "")) {
    throw new Error("iOS 流水线必须固定容器仓库和完整提交 SHA");
  }
  const selected = stepNames.map((name) => {
    const step = steps.find((candidate) => candidate.name === name);
    if (!step?.run || (step["working-directory"] && step["working-directory"] !== "pakeplus")) {
      throw new Error(`iOS 流水线步骤缺失或工作目录不兼容：${name}`);
    }
    return step;
  });
  const pnpmSetup = steps.find((step) => step.uses?.startsWith("pnpm/action-setup@"));
  const pnpmVersion = String(pnpmSetup?.with?.version ?? "");
  if (!/^\d+$/.test(pnpmVersion)) throw new Error("流水线必须配置 pnpm 主版本");
  const output = join(root, ".mobile-build/ios");
  const plan = {
    repository: checkout.with.repository, ref: checkout.with.ref, version,
    projectPath: join(output, "pakeplus/PakePlus.xcodeproj"),
    scheme: "PakePlus", packageManager: `pnpm@${pnpmVersion}`, steps: stepNames,
  };
  if (values.plan) { console.log(JSON.stringify(plan, null, 2)); return; }
  if (process.platform !== "darwin") throw new Error("iOS 工程准备需要 macOS 和 Xcode");
  await mkdir(join(root, ".mobile-build"), { recursive: true });
  const staging = await mkdtemp(join(root, ".mobile-build/ios-staging-"));
  try {
    const container = join(staging, "pakeplus");
    const runnerTemp = join(staging, "runner-temp");
    await mkdir(container);
    await mkdir(runnerTemp);
    const env = { ...process.env, ...workflow.env, APP_VERSION: version,
      RUNNER_TEMP: runnerTemp, GITHUB_ENV: join(runnerTemp, "github-env") };
    run("git", ["init", "--quiet"], container, env);
    run("git", ["remote", "add", "origin", `https://github.com/${plan.repository}.git`], container, env);
    run("git", ["fetch", "--depth=1", "origin", plan.ref], container, env);
    run("git", ["checkout", "--detach", "FETCH_HEAD"], container, env);
    for (const step of selected) {
      console.log(`\n▶ ${step.name}`);
      const cwd = step["working-directory"] ? container : root;
      const quotedContainer = "\"" + container.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("$", "\\$").replaceAll("`", "\\`") + "\"";
      const source = step["working-directory"] ? step.run : step.run.replaceAll("pakeplus/", `${quotedContainer}/`);
      const script = source.replace(/\bpnpm\b/g, `npm exec --yes --package=pnpm@${pnpmVersion} -- pnpm`);
      run("bash", ["-euo", "pipefail", "-c", script], cwd, env);
    }
    const icons = join(container, "PakePlus/Assets.xcassets/AppIcon.appiconset");
    const contents = JSON.parse(await readFile(join(icons, "Contents.json"), "utf8"));
    for (const entry of contents.images) {
      if (!entry.filename) continue;
      const size = Math.round(parseFloat(entry.size) * parseFloat(entry.scale));
      await sharp(join(root, "docs/assets/app-icon/codex-mobile-app-icon-1024.png"))
        .resize(size, size).removeAlpha().png().toFile(join(icons, entry.filename));
    }
    await writeFile(join(staging, "build-plan.json"), JSON.stringify(plan, null, 2));
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
    console.log(`\n已生成 iOS 工程：${plan.projectPath}\nscheme：${plan.scheme}；版本：${version}`);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
