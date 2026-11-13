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
it('已死owner回收前锁目录被替换，即使PID和nonce相同也不能删除新inode', async () => {
 const { path, store } = await fixture(); await store.readJson('init.json');
 const { randomUUID } = await import('node:crypto'); const { spawnSync } = await import('node:child_process'); const fs = await import('node:fs'); const { vi } = await import('vitest');
 const pid = spawnSync(process.execPath, ['-e', '']).pid; const nonce = randomUUID(); const lock = join(path, '.init-test.lock'); const name = `owner-${pid}-${nonce}.json`; const contents = JSON.stringify({ version: 1, pid, nonce });
 await mkdir(lock, { mode: 0o700 }); await writeFile(join(lock, name), contents, { mode: 0o600 });
 const originalKill = process.kill; let changed = false;
 const spy = vi.spyOn(process, 'kill').mockImplementation(((p: number, signal: any) => {
  if (p === pid && !changed) { changed = true; fs.renameSync(lock, `${lock}-old`); fs.mkdirSync(lock, { mode: 0o700 }); fs.writeFileSync(join(lock, name), contents, { mode: 0o600 }); }
  return originalKill(p, signal);
 }) as typeof process.kill);
 try { await expect(store.withInitialization('test', async () => 'unsafe', { timeoutMs: 20, pollMs: 1 })).rejects.toBeDefined(); expect(await readFile(join(lock, name), 'utf8')).toBe(contents); }
 finally { spy.mockRestore(); }
});
it('锁owner被替换为FIFO时有界拒绝，不遗留永久挂起open', async () => {
 const { path, store } = await fixture(); await store.readJson('init.json'); const { randomUUID } = await import('node:crypto'); const { spawnSync, execFileSync } = await import('node:child_process'); const sync = await import('node:fs');
 const pid = spawnSync(process.execPath, ['-e', '']).pid; const nonce = randomUUID(); const lock = join(path, '.init-fifo.lock'); const owner = join(lock, `owner-${pid}-${nonce}.json`); await mkdir(lock, { mode: 0o700 }); execFileSync('mkfifo', ['-m', '600', owner]);
 const operation = store.withInitialization('fifo', async () => 'unsafe', { timeoutMs: 20, pollMs: 1 }).then(() => 'resolved', () => 'rejected');
 const result = await Promise.race([operation, new Promise<string>(resolve => setTimeout(() => resolve('blocked'), 100))]);
 if (result === 'blocked') { const writer = sync.openSync(owner, sync.constants.O_WRONLY | sync.constants.O_NONBLOCK); sync.closeSync(writer); await operation; }
 expect(result).toBe('rejected'); expect((await lstat(owner)).isFIFO()).toBe(true);
});

it('初始化准备路径被替换后失败清理保留新目录及未知内容', async () => {
 const { path, store } = await fixture(); await store.readJson('init.json'); const fs = await import('node:fs/promises'); const { syncBuiltinESMExports } = await import('node:module'); const { vi } = await import('vitest'); const original = fs.rename; let replacement!: string;
 const spy = vi.spyOn(fs.default, 'rename').mockImplementation((async (from: any, to: any) => {
  if (String(from).includes('.lock-prepare-') && to === join(path, '.init-test.lock')) { replacement = from; await original(from, `${from}-old`); await mkdir(from, { mode: 0o700 }); await writeFile(join(from, 'replacement'), 'must-remain'); throw new Error('synthetic-rename-failure'); }
  return original(from, to);
 }) as typeof fs.rename); syncBuiltinESMExports();
 try { await expect(store.withInitialization('test', async () => 'unsafe')).rejects.toBeDefined(); expect(await readFile(join(replacement, 'replacement'), 'utf8').catch(() => 'missing')).toBe('must-remain'); }
 finally { spy.mockRestore(); syncBuiltinESMExports(); }
});


it('释放锁最后owner检查后原子替换同名文件仍保留替换物', async () => {
 const { path, store } = await fixture(); await store.readJson('init.json');
 const fs = await import('node:fs/promises'); const { syncBuiltinESMExports } = await import('node:module'); const { vi } = await import('vitest');
 const original = fs.lstat; const lock = join(path, '.init-test.lock'); let replacement = ''; let changed = false;
 const spy = vi.spyOn(fs.default, 'lstat').mockImplementation((async (...args: Parameters<typeof original>) => {
  const stat = await Reflect.apply(original, fs.default, args);
  if (String(args[0]).startsWith(join(lock, 'owner-')) && !changed) { changed = true; replacement = String(args[0]); await fs.rename(replacement, join(path, 'old-owner.json')); await writeFile(replacement, 'must-remain', { mode: 0o600 }); }
  return stat;
 }) as typeof fs.lstat); syncBuiltinESMExports();
 try { await store.withInitialization('test', async () => undefined).catch(() => undefined); expect(changed).toBe(true); const quarantine=(await readdir(path)).filter(name=>name.startsWith('.cleanup-')); expect(quarantine).toHaveLength(1); expect(await readFile(join(path,quarantine[0]!, 'entry'),'utf8')).toBe('must-remain'); }
 finally { spy.mockRestore(); syncBuiltinESMExports(); }
});

it('捕获替换owner后父目录被竞争者换走时，隔离物保留且新owner不受污染', async () => {
 const { path, store } = await fixture(); await store.readJson('init.json');
 const fs = await import('node:fs/promises'); const { syncBuiltinESMExports } = await import('node:module'); const { vi } = await import('vitest');
 const originalStat = fs.lstat; const originalRename = fs.rename; const lock = join(path, '.init-test.lock');
 let replaced = false; let changedParent = false;
 const statSpy = vi.spyOn(fs.default, 'lstat').mockImplementation((async (...args: Parameters<typeof originalStat>) => {
  const stat = await Reflect.apply(originalStat, fs.default, args);
  if (String(args[0]).startsWith(join(lock,'owner-')) && !replaced) { replaced=true; await originalRename(String(args[0]),join(path,'old-owner.json')); await writeFile(String(args[0]),'captured-replacement',{mode:0o600}); }
  return stat;
 }) as typeof fs.lstat);
 const renameSpy = vi.spyOn(fs.default,'rename').mockImplementation((async (from:any,to:any) => {
  await originalRename(from,to);
  if(String(from).startsWith(join(lock,'owner-')) && String(to).includes('.cleanup-') && !changedParent){changedParent=true;await originalRename(lock,`${lock}-old`);await mkdir(lock,{mode:0o700});await writeFile(join(lock,'new-owner.json'),'new-owner',{mode:0o600});}
 }) as typeof fs.rename); syncBuiltinESMExports();
 try {
  await expect(store.withInitialization('test',async()=>undefined)).rejects.toThrow('私有存储');
  expect(changedParent).toBe(true); expect(await readdir(lock)).toEqual(['new-owner.json']); expect(await readFile(join(lock,'new-owner.json'),'utf8')).toBe('new-owner');
  const captures=(await readdir(path)).filter(name=>name.startsWith('.cleanup-'));expect(captures).toHaveLength(1);expect(await readFile(join(path,captures[0]!,'entry'),'utf8')).toBe('captured-replacement');
 } finally {statSpy.mockRestore();renameSpy.mockRestore();syncBuiltinESMExports();}
});

it('健康owner被捕获后竞争者合法替换空锁目录：释放成功且只保留新owner', async () => {
 const { path, store } = await fixture(); await store.readJson('init.json');
 const fs = await import('node:fs/promises'); const { syncBuiltinESMExports } = await import('node:module'); const { vi } = await import('vitest'); const { randomUUID } = await import('node:crypto');
 const originalRename=fs.rename; const lock=join(path,'.init-test.lock'); let changed=false;
 const replacement=join(path,'competitor'); await mkdir(replacement,{mode:0o700}); const name=`owner-${process.pid}-${randomUUID()}.json`;await writeFile(join(replacement,name),'new-owner',{mode:0o600});
 const spy=vi.spyOn(fs.default,'rename').mockImplementation((async (from:any,to:any)=>{
  await originalRename(from,to);
  if(String(from).startsWith(join(lock,'owner-'))&&String(to).includes('.cleanup-')&&!changed){changed=true;await originalRename(replacement,lock);}
 }) as typeof fs.rename);syncBuiltinESMExports();
 try {await store.withInitialization('test',async()=>undefined);expect(changed).toBe(true);expect(await readdir(lock)).toEqual([name]);expect(await readFile(join(lock,name),'utf8')).toBe('new-owner');expect((await readdir(path)).filter(name=>name.startsWith('.cleanup-'))).toEqual([]);}
 finally {spy.mockRestore();syncBuiltinESMExports();}
});

it('过时死亡owner回收遇到完整的后继owner时继续等待，不误报损坏或删除后继归属', async () => {
 const { path, store } = await fixture(); await store.readJson('init.json');
 const fs = await import('node:fs/promises'); const { syncBuiltinESMExports } = await import('node:module'); const { vi } = await import('vitest'); const { randomUUID } = await import('node:crypto'); const { spawnSync } = await import('node:child_process');
 const pid=spawnSync(process.execPath,['-e','']).pid; const nonce=randomUUID(); const lock=join(path,'.init-test.lock');const name=`owner-${pid}-${nonce}.json`;await mkdir(lock,{mode:0o700});await writeFile(join(lock,name),JSON.stringify({version:1,pid,nonce}),{mode:0o600});
 const nextNonce=randomUUID();const nextName=`owner-${process.pid}-${nextNonce}.json`;const next=JSON.stringify({version:1,pid:process.pid,nonce:nextNonce}); const original=fs.lstat;let changed=false;
 const spy=vi.spyOn(fs.default,'lstat').mockImplementation((async(...args:Parameters<typeof original>)=>{
  const stat=await Reflect.apply(original,fs.default,args);
  if(String(args[0])===join(lock,name)&&!changed){changed=true;await fs.rename(lock,`${lock}-old`);await mkdir(lock,{mode:0o700});await writeFile(join(lock,nextName),next,{mode:0o600});}
  return stat;
 }) as typeof fs.lstat);syncBuiltinESMExports();
 try{await expect(store.withInitialization('test',async()=>{throw new Error('不得进入');},{timeoutMs:80,pollMs:1})).rejects.toThrow('超时');expect(changed).toBe(true);expect(await readdir(lock)).toEqual([nextName]);expect(await readFile(join(lock,nextName),'utf8')).toBe(next);expect(await readFile(join(`${lock}-old`,name),'utf8')).toContain(nonce);expect((await readdir(path)).filter(name=>name.startsWith('.cleanup-'))).toEqual([]);}
 finally{spy.mockRestore();syncBuiltinESMExports();}
});
