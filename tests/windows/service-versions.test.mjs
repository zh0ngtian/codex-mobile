import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, utimes } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectVersion, snapshotVersion, retainVersions } from '../../scripts/windows/service/versions.mjs';
import * as versions from '../../scripts/windows/service/versions.mjs';

async function cleanupFixture(root) {
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('codex-service-'));
  await rm(root, { recursive: true, force: true });
}

test('读取期间文件变化拒绝缓存；缓存目录不可写时仍能完成校验', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-service-version-cache-'));
  try {
    await writeFile(join(root, 'codex.exe'), 'old'); await writeFile(join(root, 'codex-code-mode-host.exe'), 'host');
    const candidate = { resourcesDirectory: root, version: 'v1' };
    const changing = versions.createVersionInspector({ cachePath: join(root, 'cache.json'), onHash: async (path) => {
      if (path.endsWith('codex.exe')) await writeFile(path, 'changed');
    } });
    await assert.rejects(changing(candidate), /变化/);
    const uncached = versions.createVersionInspector({ cachePath: join(root, 'missing', 'cache.json') });
    assert.equal((await uncached(candidate)).fingerprint, (await inspectVersion(candidate)).fingerprint);
  } finally { await cleanupFixture(root); }
});

test('校验缓存跨启动复用，同大小改写并恢复 mtime 仍重新计算，损坏缓存安全回退', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-service-version-cache-'));
  try {
    const source = join(root, 'package'); await mkdir(source);
    await writeFile(join(source, 'codex.exe'), 'old'); await writeFile(join(source, 'codex-code-mode-host.exe'), 'host');
    const cachePath = join(root, 'cache.json'), candidate = { resourcesDirectory: source, version: 'same' };
    let reads = [];
    const make = () => versions.createVersionInspector({ cachePath, onHash: (path) => reads.push(path) });
    const inspect = make(), first = await inspect(candidate);
    assert.equal(reads.length, 2);
    reads = []; assert.equal((await inspect(candidate)).fingerprint, first.fingerprint); assert.equal(reads.length, 0);
    assert.equal((await make()(candidate)).fingerprint, first.fingerprint); assert.equal(reads.length, 0);
    const binary = join(source, 'codex.exe'), before = await stat(binary);
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(binary, 'new'); await utimes(binary, before.atime, before.mtime);
    const changed = await make()(candidate);
    assert.notEqual(changed.fingerprint, first.fingerprint); assert.deepEqual(reads, [binary]);
    reads = []; await writeFile(join(source, 'rg.exe'), 'optional');
    const added = await make()(candidate); assert.notEqual(added.fingerprint, changed.fingerprint); assert.equal(reads.length, 1);
    await rm(join(source, 'rg.exe')); assert.equal((await make()(candidate)).fingerprint, changed.fingerprint);
    await writeFile(cachePath, '{broken'); reads = [];
    assert.equal((await make()(candidate)).fingerprint, changed.fingerprint); assert.equal(reads.length, 2);
    await rm(binary); await assert.rejects(make()(candidate), { code: 'ENOENT' });
  } finally { await cleanupFixture(root); }
});

test('已有快照跨启动不重复读取，快照内容改变必须拒绝使用', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-service-version-cache-'));
  try {
    const source = join(root, 'package'); await mkdir(source);
    await writeFile(join(source, 'codex.exe'), 'old'); await writeFile(join(source, 'codex-code-mode-host.exe'), 'host');
    const cachePath = join(root, 'cache.json'); let reads = 0;
    const make = () => versions.createVersionInspector({ cachePath, onHash: () => reads++ });
    const inspect = make(), candidate = await inspect({ resourcesDirectory: source, version: 'v1' });
    const snapshot = await snapshotVersion(candidate, join(root, 'versions'), inspect);
    // 新复制文件必须实际读取校验；第一次检查最终目录允许建立新身份的缓存。
    assert.ok(reads >= 4); await snapshotVersion(candidate, join(root, 'versions'), inspect);
    reads = 0;
    const nextInspect = make();
    await snapshotVersion(await nextInspect(candidate), join(root, 'versions'), nextInspect);
    assert.equal(reads, 0);
    await writeFile(snapshot.executable, 'bad');
    await assert.rejects(snapshotVersion(candidate, join(root, 'versions'), make()), /校验失败/);
  } finally { await cleanupFixture(root); }
});

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
