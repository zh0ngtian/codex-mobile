// @vitest-environment node
import { chmod, lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadGatewayIdentity } from '../../server/gateway-identity.js';
const MACHINE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gateway-identity-'))); roots.push(root);
  return { root, directory: join(root, 'identity') };
}
async function load(directory: string) {
  return loadGatewayIdentity(directory, { readMachineIdentity: async () => MACHINE });
}
it('固定随机网关及本机锚点耐久保存，重启读取不改变且不同数据目录不合并', async () => {
  const { directory, root } = await fixture();
  const first = await load(directory); const second = await load(directory);
  expect(first).toEqual(second); expect(Object.isFrozen(first)).toBe(true);
  expect(first.gatewayId).toMatch(/^[0-9a-f-]{36}$/); expect(first.localHostId).toMatch(/^[0-9a-f-]{36}$/);
  expect(first.gatewayId).not.toBe(first.localHostId);
  expect((await load(join(root, 'other'))).gatewayId).not.toBe(first.gatewayId);
  expect((await lstat(directory)).mode & 0o777).toBe(0o700);
  expect((await lstat(join(directory, 'identity.json'))).mode & 0o777).toBe(0o600);
});
it('并发初始化采用唯一完整记录且不会覆盖既有值', async () => {
  const { directory } = await fixture();
  const values = await Promise.all(Array.from({ length: 12 }, () => load(directory)));
  expect(new Set(values.map(value => JSON.stringify(value))).size).toBe(1);
  expect(JSON.parse(await readFile(join(directory, 'identity.json'), 'utf8'))).toMatchObject(values[0]);
});
it.each(['invalid-json', 'wrong-type', 'file-mode', 'directory-mode', 'symlink'] as const)('身份%s明确失败且不修复覆盖', async kind => {
  const { directory, root } = await fixture(); await load(directory);
  const file = join(directory, 'identity.json');
  if (kind === 'invalid-json') await writeFile(file, '{');
  if (kind === 'wrong-type') await writeFile(file, JSON.stringify({ version: 1, gatewayId: 42, localHostId: 'host' }));
  if (kind === 'file-mode') await chmod(file, 0o644);
  if (kind === 'directory-mode') await chmod(directory, 0o755);
  if (kind === 'symlink') { await rm(file); await writeFile(join(root, 'other.json'), '{}'); await symlink(join(root, 'other.json'), file); }
  const before = await lstat(file); const bytes = await readFile(file, 'utf8');
  await expect(load(directory)).rejects.toThrow();
  expect(await readFile(file, 'utf8')).toBe(bytes); expect((await lstat(file)).ino).toBe(before.ino);
  if (kind === 'file-mode') expect((await lstat(file)).mode & 0o777).toBe(0o644);
  if (kind === 'directory-mode') expect((await lstat(directory)).mode & 0o777).toBe(0o755);
});
it('拒绝已有目录符号链接且不改写其目标', async () => {
  const { directory, root } = await fixture(); const actual = join(root, 'actual'); await mkdir(actual, { mode: 0o700 }); await symlink(actual, directory);
  await expect(load(directory)).rejects.toThrow();
  expect((await lstat(directory)).isSymbolicLink()).toBe(true);
});
it('复制旧数据到另一机器明确拒绝，原记录字节与inode保持', async () => {
  const { directory, root } = await fixture(); await load(directory);
  const copied = join(root, 'copied'); await mkdir(copied, { mode: 0o700 });
  await copyFile(join(directory, 'identity.json'), join(copied, 'identity.json')); await chmod(join(copied, 'identity.json'), 0o600);
  const file = join(copied, 'identity.json'); const bytes = await readFile(file, 'utf8'); const inode = (await lstat(file)).ino;
  const module = await import('../../server/gateway-identity.js');
  await expect(module.loadGatewayIdentity(copied, { readMachineIdentity: async () => '11111111-2222-3333-4444-555555555555' })).rejects.toMatchObject({ code: 'machine-mismatch' });
  expect(await readFile(file, 'utf8')).toBe(bytes); expect((await lstat(file)).ino).toBe(inode);
  expect(bytes).not.toContain(MACHINE);
});
it('坏机器指纹和机器读取失败不覆盖旧身份', async () => {
  const { directory } = await fixture(); await load(directory); const file = join(directory, 'identity.json');
  const module = await import('../../server/gateway-identity.js');
  await expect(module.loadGatewayIdentity(directory, { readMachineIdentity: async () => { throw new Error('private-machine'); } })).rejects.toMatchObject({ code: 'machine-unavailable' });
  const record = JSON.parse(await readFile(file, 'utf8')); record.machineFingerprint = 'invalid'; await writeFile(file, JSON.stringify(record));
  await expect(load(directory)).rejects.toMatchObject({ code: 'storage' });
});
it.each(['', 'invalid', 'IOPlatformUUID = "bad"', '"IOPlatformUUID" = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"\n"IOPlatformUUID" = "11111111-2222-3333-4444-555555555555"'])('Mac reader拒绝缺失或畸形输出 %#', async stdout => {
  const module = await import('../../server/gateway-identity.js');
  await expect(module.readMacMachineIdentity({ platform: 'darwin', execute: async () => ({ stdout }) })).rejects.toMatchObject({ code: 'machine-unavailable' });
});
it('Mac reader固定绝对命令、预算及输出上限，非Mac和命令超时拒绝', async () => {
  const module = await import('../../server/gateway-identity.js'); let invocation: unknown[] = [];
  expect(await module.readMacMachineIdentity({ platform: 'darwin', execute: async (...args) => { invocation = args; return { stdout: `    "IOPlatformUUID" = "${MACHINE}"\n` }; } })).toBe(MACHINE);
  expect(invocation).toEqual(['/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 2000, maxBuffer: 65536, shell: false }]);
  await expect(module.readMacMachineIdentity({ platform: 'linux' })).rejects.toMatchObject({ code: 'unsupported-platform' });
  await expect(module.readMacMachineIdentity({ platform: 'darwin', execute: async () => { throw new Error('timeout-secret'); } })).rejects.toMatchObject({ code: 'machine-unavailable' });
});
it('真实进程并发初始化唯一身份，发布前后SIGKILL恢复不接受半记录或改写旧身份', async () => {
  const { spawn } = await import('node:child_process');
  const { directory } = await fixture();
  const worker = (mode: string) => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(process.cwd(), 'tests/server/fixtures/gateway-identity-worker.ts'), directory, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let error = ''; child.stdout.on('data', value => output += value); child.stderr.on('data', value => error += value);
    const closed = new Promise<number | null>(resolve => child.once('close', resolve));
    const line = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('worker timeout')); }, 5000);
      child.stdout.on('data', () => { if (output.includes('\n')) { clearTimeout(timer); resolve(output.split('\n')[0]!); } });
      child.once('close', code => { clearTimeout(timer); if (!output.includes('\n')) reject(new Error(`worker ${code}: ${error}`)); });
    });
    return { child, closed, line };
  };
  const before = worker('before'); expect(await before.line).toBe('locked'); before.child.kill('SIGKILL'); await before.closed;
  const values = await Promise.all(Array.from({ length: 4 }, async () => { const run = worker('once'); const value = JSON.parse(await run.line); expect(await run.closed).toBe(0); return value; }));
  expect(new Set(values.map(value => JSON.stringify(value))).size).toBe(1);
  const after = worker('after'); expect(JSON.parse(await after.line)).toEqual(values[0]); after.child.kill('SIGKILL'); await after.closed;
  expect(await load(directory)).toEqual(values[0]);
});
it('首次返回前同步新目录父项，父目录fsync故障明确失败但不覆盖已发布记录', async () => {
  const fs = (await import('node:fs/promises')).default; const { syncBuiltinESMExports } = await import('node:module');
  const { vi } = await import('vitest'); const { directory, root } = await fixture(); const nested = join(directory, 'nested');
  const synced: string[] = []; let failParent = false; const original = fs.open;
  const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof original>) => {
    const handle = await Reflect.apply(original, fs, args); const sync = handle.sync.bind(handle);
    handle.sync = async () => { const path = String(args[0]); synced.push(path); if (failParent && path === directory) throw new Error('injected parent fsync'); await sync(); };
    return handle;
  }); syncBuiltinESMExports();
  try {
    await load(nested); expect(synced).toContain(directory); expect(synced).toContain(root);
    const bytes = await readFile(join(nested, 'identity.json'), 'utf8'); const inode = (await lstat(join(nested, 'identity.json'))).ino;
    failParent = true; await expect(load(nested)).rejects.toMatchObject({ code: 'storage' });
    expect(await readFile(join(nested, 'identity.json'), 'utf8')).toBe(bytes); expect((await lstat(join(nested, 'identity.json'))).ino).toBe(inode);
  } finally { spy.mockRestore(); syncBuiltinESMExports(); }
});
