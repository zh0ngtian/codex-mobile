import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectVersion, snapshotVersion, retainVersions } from '../../scripts/windows/service/versions.mjs';

test('比较二进制内容，版本名称相同但文件改变也会触发对齐', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-service-version-'));
  try {
    await writeFile(join(root, 'codex.exe'), 'old'); await writeFile(join(root, 'codex-code-mode-host.exe'), 'host');
    const candidate = { resourcesDirectory: root, version: 'same', desktopExecutable: join(root, 'ui.exe') };
    const first = await inspectVersion(candidate);
    await writeFile(join(root, 'codex.exe'), 'new');
    const second = await inspectVersion(candidate);
    assert.notEqual(first.fingerprint, second.fingerprint);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('只清理本服务有凭证的旧版本，保留当前、回退版本和未知目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-service-retention-'));
  try {
    for (const id of ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]) {
      await mkdir(join(root, id)); await writeFile(join(root, id, 'receipt.json'), JSON.stringify({ fingerprint: id }));
    }
    await mkdir(join(root, 'unknown'));
    await retainVersions(root, ['b'.repeat(64), 'c'.repeat(64)]);
    await assert.rejects(readFile(join(root, 'a'.repeat(64), 'receipt.json')), { code: 'ENOENT' });
    assert.equal(JSON.parse(await readFile(join(root, 'b'.repeat(64), 'receipt.json'), 'utf8')).fingerprint, 'b'.repeat(64));
    await writeFile(join(root, 'unknown', 'untouched'), 'ok');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('快照保留配套文件，安装目录变化不会修改已运行的版本', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-service-snapshot-'));
  try {
    const source = join(root, 'package'), store = join(root, 'versions'); await mkdir(source);
    await writeFile(join(source, 'codex.exe'), 'old'); await writeFile(join(source, 'codex-code-mode-host.exe'), 'host-old');
    const old = await inspectVersion({ resourcesDirectory: source, version: 'old' });
    const snapshot = await snapshotVersion(old, store);
    await writeFile(join(source, 'codex.exe'), 'new');
    assert.equal(await readFile(snapshot.executable, 'utf8'), 'old');
    assert.equal(await readFile(join(snapshot.directory, 'codex-code-mode-host.exe'), 'utf8'), 'host-old');
    await assert.rejects(snapshotVersion(old, store), /changed|变化/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
