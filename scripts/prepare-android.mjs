#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { versionCode } from './resolve-mobile-version.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['Install Codex Mobile app icon', 'Build embedded frontend', 'Configure PakePlus for embedded HTML',
  'Install PakePlus dependencies', 'Generate Android project', 'Harden and test embedded Android project',
  'Install Android Material native interface'];
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败（${result.status}）`);
}
async function main() {
  const { values } = parseArgs({ options: { version: { type: 'string' }, plan: { type: 'boolean', default: false } } });
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const version = values.version ?? pkg.version;
  const code = versionCode(version);
  const recipe = parse(await readFile(join(root, 'mobile/android/build-recipe.yml'), 'utf8'));
  if (!/^[\da-f]{40}$/.test(recipe.container?.ref ?? '') || !/^[\w-]+\/[\w-]+$/.test(recipe.container?.repository ?? '')) throw new Error('Android 容器必须固定仓库与完整 SHA');
  const steps = names.map(name => {
    const step = recipe.steps.find(item => item.name === name);
    if (!step?.run || (step['working-directory'] && step['working-directory'] !== 'pakeplus')) throw new Error(`Android 构建配置步骤不兼容：${name}`);
    return step;
  });
  const output = join(root, '.mobile-build/android');
  const pnpm = String(recipe.tools?.pnpm?.version ?? '');
  if (!/^\d+\.\d+\.\d+$/.test(pnpm)) throw new Error('pnpm 必须固定精确版本');
  const plan = { repository: recipe.container.repository, ref: recipe.container.ref, version, versionCode: code,
    projectPath: join(output, 'pakeplus'), steps: names, buildsPackage: false, publishes: false };
  if (values.plan) { console.log(JSON.stringify(plan, null, 2)); return; }
  await mkdir(join(root, '.mobile-build'), { recursive: true });
  const staging = await mkdtemp(join(root, '.mobile-build/android-staging-'));
  try {
    const container = join(staging, 'pakeplus'); const runner = join(staging, 'runner-temp');
    await mkdir(container); await mkdir(runner);
    await symlink(join(root, 'mobile'), join(staging, 'mobile'), 'dir');
    const env = { ...recipe.env, ...process.env, APP_VERSION: version, APP_VERSION_CODE: String(code),
      RUNNER_TEMP: runner, GITHUB_ENV: join(runner, 'github-env') };
    run('git', ['init', '--quiet'], container, env);
    run('git', ['remote', 'add', 'origin', `https://github.com/${recipe.container.repository}.git`], container, env);
    run('git', ['fetch', '--depth=1', 'origin', recipe.container.ref], container, env);
    run('git', ['checkout', '--detach', 'FETCH_HEAD'], container, env);
    for (const step of steps) {
      console.log(`\n▶ ${step.name}`);
      const managed = step.run.replace(/\bpnpm\b/g, `npm exec --yes --package=pnpm@${pnpm} -- pnpm`);
      const script = step['working-directory'] ? managed : managed.replaceAll('pakeplus/', `${quote(container)}/`);
      run('bash', ['-euo', 'pipefail', '-c', script], step['working-directory'] ? container : root, env);
    }
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (sdk) await writeFile(join(container, 'local.properties'), `sdk.dir=${sdk.replaceAll('\\', '\\\\').replaceAll(':', '\\:')}\n`);
    await writeFile(join(staging, 'build-plan.json'), JSON.stringify(plan, null, 2) + '\n');
    const previous = `${staging}-previous`;
    let movedPrevious = false;
    try { await rename(output, previous); movedPrevious = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(staging, output); }
    catch (error) { if (movedPrevious) await rename(previous, output); throw error; }
    if (movedPrevious) await rm(previous, { recursive: true, force: true });
    console.log(`\n已生成 Android 原生工程：${plan.projectPath}；未构建或发布安装包`);
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
