import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
it.skipIf(process.platform !== 'darwin')('HEIC导入输出真实JPEG、保留方向并丢弃原始文件表示', () => {
 const directory = mkdtempSync(join(tmpdir(), 'heic-import-'));
 try {
  const files = ['Session/AttachmentItem','Session/AttachmentKind','Session/AttachmentState','Composer/AttachmentLoader','Composer/AttachmentPhotoTransfer','Composer/AttachmentImportLimits','Composer/AttachmentImportError'].map(name => `mobile/ios/AgentUI/${name}.swift`);
  const compile = spawnSync('xcrun', ['swiftc', '-parse-as-library', ...files, 'tests/ci/heic-import-smoke.swift', '-o', join(directory, 'smoke')], { encoding: 'utf8', timeout: 120000 });
  expect(compile.status, compile.stderr).toBe(0);
  const run = spawnSync(join(directory, 'smoke'), [], { encoding: 'utf8', timeout: 30000 });
  expect(run.status, run.stderr).toBe(0);
  expect(run.stdout).toContain('HEIC import smoke passed');
 } finally { rmSync(directory, { recursive: true, force: true }); }
}, 160000);
