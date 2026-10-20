import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('只清除本服务旧启动链接，保留同名其他软件链接；安装和更新不再创建重复入口', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-startup-test-'));
  try {
    const probe = join(root, 'probe.ps1');
    await writeFile(probe, `param([string]$Source,[string]$Root)
$ErrorActionPreference='Stop'
$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$null,[ref]$null)
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Remove-LegacyStartupShortcut'},$true)
if(-not $definition){throw 'Missing legacy startup migration'}
Invoke-Expression $definition.Extent.Text
$ServiceRoot=Join-Path $Root 'service with spaces'
New-Item -ItemType Directory -Path $ServiceRoot | Out-Null
$path=Join-Path $Root 'Codex Desktop.lnk'
$shell=New-Object -ComObject WScript.Shell
$link=$shell.CreateShortcut($path); $link.TargetPath=Join-Path $ServiceRoot 'CodexMobileLauncher-test.exe'; $link.Arguments='start'; $link.Save()
Remove-LegacyStartupShortcut -Path $path
if(Test-Path -LiteralPath $path){throw 'Duplicate entry retained'}
Remove-LegacyStartupShortcut -Path $path
$link=$shell.CreateShortcut($path); $link.TargetPath=Join-Path $Root 'another.exe'; $link.Save()
Remove-LegacyStartupShortcut -Path $path
if(-not(Test-Path -LiteralPath $path)){throw 'Unrelated shortcut removed'}
$calls=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Remove-LegacyStartupShortcut'},$true))
if($calls.Count -ne 2){throw 'Both install and update must migrate'}
if($ast.Extent.Text.Contains('Set-StartupShortcut')){throw 'Duplicate entry still created'}
Write-Output 'OK'
`);
    const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', probe,
      '-Source', resolve('scripts/windows/manage-service.ps1'), '-Root', root], { windowsHide: true });
    assert.match(result.stdout, /OK/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('codex-startup-test-'));
    await rm(root, { recursive: true, force: true });
  }
});
