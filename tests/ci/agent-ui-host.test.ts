import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

it('iOS 准备安装完整 AgentApp 页面、主题资源，同时不引入第二个应用入口', () => {
  const root = resolve('.');
  const temporary = mkdtempSync(join(tmpdir(), 'codex-agent-host-'));
  try {
    symlinkSync(join(root, 'mobile'), join(temporary, 'mobile'), 'dir');
    mkdirSync(join(temporary, 'pakeplus/PakePlus'), { recursive: true });
    const recipe = parse(readFileSync('mobile/ios/build-recipe.yml', 'utf8'));
    const script = recipe.steps.find((step: any) => step.name === 'Install iOS in-app browser source').run;
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', script], { cwd: temporary, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const app = join(temporary, 'pakeplus/PakePlus/AgentUI');
    expect(existsSync(join(app, 'App/RootView.swift'))).toBe(true);
    expect(existsSync(join(app, 'Composer/ComposerBar.swift'))).toBe(true);
    expect(existsSync(join(app, 'Assets.xcassets/ProjectFolderOpen.imageset/Contents.json'))).toBe(true);
    expect(existsSync(join(app, 'App/AgentApp.swift'))).toBe(false);
    expect(existsSync(join(app, 'Info.plist'))).toBe(false);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
