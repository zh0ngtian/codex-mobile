// @vitest-environment node
import { fork, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PrivateStore } from '../../server/remote/private-store.js';
import { SecureEnclaveDeviceKey } from '../../server/remote/device-key.js';

type Event = { event: string; ok?: boolean; identity?: string };
const roots: string[] = []; const workers: ChildProcess[] = [];
async function fixture() { const root = await mkdtemp(join(await realpath(tmpdir()), 'remote-init-test-')); roots.push(root); const directory = join(root, 'store'); return { root, directory, store: new PrivateStore(directory) }; }
function worker(action: string, directory: string, id: string) {
  const child = fork(resolve('tests/server/fixtures/remote-init-worker.ts'), [action, directory, id], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); workers.push(child);
  const events: Event[] = []; const waiters = new Set<() => void>();
  child.on('message', message => { events.push(message as Event); for (const wake of waiters) wake(); });
  const wait = (event: string) => new Promise<Event>((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`worker timeout: ${event}`)); }, 5000);
    const check = () => { const value = events.find(value => value.event === event); if (value) { clearTimeout(timer); waiters.delete(check); resolve(value); } else if (events.some(value => value.event === 'result' && value.ok === false)) { clearTimeout(timer); waiters.delete(check); reject(new Error(`worker operation failed before ${event}`)); } }; waiters.add(check); check();
  });
  return { child, events, wait };
}
afterEach(async () => { await Promise.all(workers.splice(0).map(child => new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; } child.once('exit', () => resolve()); if (child.connected) child.send('release', () => undefined); child.kill('SIGKILL'); }))); await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function contenders(action: 'key' | 'enroll') {
  const f = await fixture(); const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const children = ['one', 'two'].map(id => worker(action, f.directory, id));
  await Promise.all(children.map(child => child.wait('ready')));
  children.forEach(child => child.child.send('start'));
  if (action === 'enroll') {
    await Promise.all(children.map(child => child.wait('need-key')));
    children.forEach(child => child.child.send({ publicKeySpkiDerBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privatePem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }));
  }
  await Promise.race(children.map(child => child.wait('entered')));
  // Both workers passed the IPC start barrier. Hold the first operation so a second
  // unprotected process reaches the same helper/commit barrier deterministically.
  await new Promise(resolve => setTimeout(resolve, 250));
  children.forEach(child => child.child.send('release'));
  const results = await Promise.all(children.map(child => child.wait('result')));
  return { ...f, children, results };
}
describe('Remote跨进程首次初始化', () => {
  it('两个独立进程只创建一次key，所有成功结果等于磁盘权威身份', async () => {
    const f = await contenders('key');
    expect(f.results.every(result => result.ok)).toBe(true);
    expect(f.children.flatMap(child => child.events).filter(event => event.event === 'entered')).toHaveLength(1);
    const record = await f.store.readJson('device-key.json') as { keyId: string };
    expect(f.results.map(result => result.identity)).toEqual([record.keyId, record.keyId]);
    expect((await readdir(f.directory)).filter(name => name.startsWith('.'))).toEqual([]);
  });
  it('两个独立进程仅一次REST start，第二个enroll拒绝且成功结果与磁盘一致', async () => {
    const f = await contenders('enroll'); const successful = f.results.filter(result => result.ok);
    expect(f.children.flatMap(child => child.events).filter(event => event.event === 'rest-start')).toHaveLength(1);
    expect(successful).toHaveLength(1);
    expect(successful[0]!.identity).toBe((await f.store.readJson('enrollment.json') as { clientId: string }).clientId);
    expect((await readdir(f.directory)).filter(name => name.startsWith('.'))).toEqual([]);
  });
  it('独立实例竞争同一key时复用一份已持久化身份', async () => {
    const f = await fixture(); let creates = 0;
    const publicKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const runHelper = async (operation: string, input: Record<string, unknown>) => {
      if (operation === 'create') { const id = `key-${++creates}`; await new Promise(resolve => setTimeout(resolve, 25)); return { keyId: id, algorithm: 'ecdsa_p256_sha256', protectionClass: 'hardware_secure_enclave', publicKeySpkiDerBase64: publicKey, keyRecord: { keyId: id, sealedKeyBase64: Buffer.from(id).toString('base64') } }; }
      return { keyId: (input.keyRecord as { keyId: string }).keyId, algorithm: 'ecdsa_p256_sha256', protectionClass: 'hardware_secure_enclave', publicKeySpkiDerBase64: publicKey };
    };
    const result = await Promise.all([new SecureEnclaveDeviceKey({ store: f.store, runHelper }).create(), new SecureEnclaveDeviceKey({ store: new PrivateStore(f.directory), runHelper }).create()]);
    expect(creates).toBe(1); expect(result[0]).toEqual(result[1]);
  });
  it('create-if-absent不替换既有或损坏记录，始终700/600且无临时文件', async () => {
    const f = await fixture();
    const results = await Promise.all([f.store.createJson('own.json', { owner: 1 }), new PrivateStore(f.directory).createJson('own.json', { owner: 2 })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const before = await readFile(join(f.directory, 'own.json'), 'utf8');
    expect(await f.store.createJson('own.json', { owner: 3 })).toBe(false);
    expect(await readFile(join(f.directory, 'own.json'), 'utf8')).toBe(before);
    await writeFile(join(f.directory, 'broken.json'), '{broken', { mode: 0o600 });
    expect(await f.store.createJson('broken.json', { repair: true })).toBe(false);
    expect(await readFile(join(f.directory, 'broken.json'), 'utf8')).toBe('{broken');
    expect((await lstat(f.directory)).mode & 0o777).toBe(0o700); expect((await lstat(join(f.directory, 'own.json'))).mode & 0o777).toBe(0o600);
    expect((await readdir(f.directory)).filter(name => name.startsWith('.'))).toEqual([]);
  });
  it('活锁有界超时不按年龄抢占，700/600；owner被杀后安全恢复', async () => {
    const f = await fixture(); const held = worker('lock', f.directory, 'holder'); await held.wait('ready'); held.child.send('start'); await held.wait('entered');
    const lockName = (await readdir(f.directory)).find(name => name.endsWith('.lock'))!; const lockPath = join(f.directory, lockName);
    const ownerName = (await readdir(lockPath))[0]!;
    expect((await lstat(lockPath)).mode & 0o777).toBe(0o700); expect((await lstat(join(lockPath, ownerName))).mode & 0o777).toBe(0o600);
    await utimes(lockPath, 0, 0); await utimes(join(lockPath, ownerName), 0, 0);
    let called = false;
    await expect(f.store.withInitialization('held', async () => { called = true; }, { timeoutMs: 40, pollMs: 5 })).rejects.toThrow('超时');
    expect(called).toBe(false); expect(await readdir(lockPath)).toEqual([ownerName]);
    const exited = new Promise<void>(resolve => held.child.once('exit', () => resolve())); held.child.kill('SIGKILL'); await exited;
    expect(await f.store.withInitialization('held', async () => 'recovered', { timeoutMs: 1000, pollMs: 5 })).toBe('recovered');
    expect(await readdir(f.directory)).toEqual([]);
  });
  it('等待锁的进程被杀后可清理其确切prepare目录', async () => {
    const f = await fixture(); const held = worker('lock', f.directory, 'holder'); await held.wait('ready'); held.child.send('start'); await held.wait('entered');
    const waiting = worker('lock', f.directory, 'waiter'); await waiting.wait('ready'); waiting.child.send('start');
    const deadline = Date.now() + 2000;
    while (!(await readdir(f.directory)).some(name => name.startsWith('.lock-prepare-'))) {
      if (Date.now() > deadline) throw new Error('waiter prepare timeout');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const exited = new Promise<void>(resolve => waiting.child.once('exit', () => resolve())); waiting.child.kill('SIGKILL'); await exited;
    held.child.send('release'); await held.wait('result');
    expect(await f.store.withInitialization('held', async () => 'recovered')).toBe('recovered');
    expect(await readdir(f.directory)).toEqual([]);
  });
  it('多个回收者竞争已死亡owner时仍只允许一个初始化操作进入', async () => {
    const f = await fixture(); const held = worker('lock', f.directory, 'holder'); await held.wait('ready'); held.child.send('start'); await held.wait('entered');
    const exited = new Promise<void>(resolve => held.child.once('exit', () => resolve())); held.child.kill('SIGKILL'); await exited;
    let active = 0; let maximum = 0;
    await Promise.all(Array.from({ length: 8 }, () => new PrivateStore(f.directory).withInitialization('held', async () => {
      maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, 5)); --active;
    }, { timeoutMs: 2000, pollMs: 1 })));
    expect(maximum).toBe(1); expect(await readdir(f.directory)).toEqual([]);
  });
  it('损坏owner或锁目录符号链接不猜测回收；真实硬链接保持拒绝', async () => {
    const f = await fixture(); await f.store.readJson('init.json');
    const lockPath = join(f.directory, '.init-bad.lock'); await mkdir(lockPath, { mode: 0o700 });
    await writeFile(join(lockPath, 'unrecognized-owner'), '{}', { mode: 0o600 });
    await expect(f.store.withInitialization('bad', async () => 'unsafe', { timeoutMs: 20 })).rejects.toThrow('私有存储');
    expect(await readdir(lockPath)).toEqual(['unrecognized-owner']);
    const outside = join(f.root, 'outside'); await mkdir(outside); await symlink(outside, join(f.directory, '.init-linked.lock'));
    await expect(f.store.withInitialization('linked', async () => 'unsafe', { timeoutMs: 20 })).rejects.toThrow('私有存储');
    expect(await readdir(outside)).toEqual([]);
    await f.store.writeJson('linked.json', { own: true }); await link(join(f.directory, 'linked.json'), join(f.root, 'hardlink'));
    await expect(f.store.readJson('linked.json')).rejects.toThrow('私有存储');
    await expect(f.store.createJson('linked.json', { changed: true })).rejects.toThrow('私有存储');
  });

  it('原子发布后目录fsync前并发读始终看到nlink=1的完整记录，杀死发布者后可恢复且不覆盖', async () => {
    const f = await fixture(); const publisher = worker('publish', f.directory, 'publisher'); await publisher.wait('ready'); publisher.child.send('start'); await publisher.wait('entered');
    expect((await lstat(join(f.directory, 'published.json'))).nlink).toBe(1);
    expect(await f.store.readJson('published.json')).toEqual({ complete: true, payload: 'x'.repeat(50000) });
    const exited = new Promise<void>(resolve => publisher.child.once('exit', () => resolve())); publisher.child.kill('SIGKILL'); await exited;
    expect(await f.store.createJson('published.json', { changed: true })).toBe(false);
    expect(await f.store.readJson('published.json')).toEqual({ complete: true, payload: 'x'.repeat(50000) });
    expect((await readdir(f.directory)).filter(name => name.startsWith('.'))).toEqual([]);
  });

});
