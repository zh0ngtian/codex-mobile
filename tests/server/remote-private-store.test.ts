// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as privateStore from '../../server/remote/private-store.js';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'remote-store-test-'));
  roots.push(root);
  return { root, path: join(root, 'owned'), store: new privateStore.PrivateStore(join(root, 'owned')) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
describe('Remote 网关私有存储', () => {
  it('原子持久化、重启读取并约束自己目录和文件权限', async () => {
    const { root, path, store } = await fixture();
    await chmod(root, 0o755);
    await store.writeJson('enrollment.json', { clientId: 'own' });
    expect((await lstat(path)).mode & 0o777).toBe(0o700);
    expect((await lstat(join(path, 'enrollment.json'))).mode & 0o777).toBe(0o600);
    expect((await lstat(root)).mode & 0o777).toBe(0o755);
    expect(await new privateStore.PrivateStore(path).readJson('enrollment.json')).toEqual({ clientId: 'own' });
  });
  it('读取缺失记录返回null，损坏记录报错且保留原文', async () => {
    const { path, store } = await fixture();
    expect(await store.readJson('missing.json')).toBeNull();
    await writeFile(join(path, 'broken.json'), '{broken', { mode: 0o600 });
    await expect(store.readJson('broken.json')).rejects.toThrow('私有存储');
    expect(await readFile(join(path, 'broken.json'), 'utf8')).toBe('{broken');
  });
  it('拒绝损坏的UTF-8 JSON记录', async () => {
    const { path, store } = await fixture(); await store.readJson('init.json');
    await writeFile(join(path, 'broken.json'), Buffer.from([123, 34, 97, 34, 58, 34, 255, 34, 125]), { mode: 0o600 });
    await expect(store.readJson('broken.json')).rejects.toThrow('私有存储');
  });
  it('拒绝路径逃逸、根目录和符号链接', async () => {
    const { root, store } = await fixture();
    expect(() => new privateStore.PrivateStore('/')).toThrow();
    expect(() => new privateStore.PrivateStore('relative')).toThrow();
    expect(() => new privateStore.PrivateStore(join(root, 'a') + '/../b')).toThrow();
    await expect(store.writeJson('../escape', {})).rejects.toThrow();
    await mkdir(join(root, 'target'));
    await symlink(join(root, 'target'), join(root, 'linked'));
    await expect(new privateStore.PrivateStore(join(root, 'linked', 'owned')).writeJson('x.json', {})).rejects.toThrow();
  });
  it('文件符号链接不得读取或替换目标', async () => {
    const { root, path, store } = await fixture();
    await store.readJson('init.json');
    const victim = join(root, 'victim');
    await writeFile(victim, 'unchanged');
    await symlink(victim, join(path, 'linked.json'));
    await expect(store.readJson('linked.json')).rejects.toThrow();
    await expect(store.writeJson('linked.json', {})).rejects.toThrow();
    expect(await readFile(victim, 'utf8')).toBe('unchanged');
  });
  it('序列化失败保留旧记录且不遗留临时文件', async () => {
    const { path, store } = await fixture();
    await store.writeJson('record.json', { version: 1 });
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    await expect(store.writeJson('record.json', cyclic)).rejects.toThrow();
    expect(await store.readJson('record.json')).toEqual({ version: 1 });
    expect(await readdir(path)).toEqual(['record.json']);
  });
  it('并发覆盖时读者只会看到完整JSON且文件保持0600', async () => {
    const { path, store } = await fixture();
    await store.writeJson('record.json', { n: 0, payload: 'a'.repeat(50000) });
    await Promise.all(Array.from({ length: 12 }, async (_, n) => {
      await store.writeJson('record.json', { n, payload: 'b'.repeat(50000) });
      expect(JSON.parse(await readFile(join(path, 'record.json'), 'utf8')).payload).toHaveLength(50000);
    }));
    expect((await lstat(join(path, 'record.json'))).mode & 0o777).toBe(0o600);
    expect(await readdir(path)).toEqual(['record.json']);
  });
});
