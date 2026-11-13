// @vitest-environment node
import { it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrivateStore } from '../../server/remote/private-store.js';
import { acquireRemoteOwner } from '../../server/remote/owner.js';
import { publishRemoteAdmin } from '../../server/remote/admin.js';
import { RemoteRuntime } from '../../server/remote/runtime.js';
import { RemoteController } from '../../server/remote/controller.js';
import { RemoteRelay } from '../../server/remote/relay.js';
import { WebSocketServer } from 'ws';

it('独立复现：owner 首个 FS 挂起受 timeoutMs 约束', async () => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'spec-owner-'));
  const original = fs.lstat;
  let release!: () => void;
  let entered = false;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof original>) => {
    if (String(args[0]) === root && !entered) {
      entered = true;
      await new Promise<void>(resolve => release = resolve);
    }
    return Reflect.apply(original, fs, args);
  });
  syncBuiltinESMExports();
  try {
    const operation = acquireRemoteOwner(new PrivateStore(root), { timeoutMs: 20 });
    const result = await Promise.race([operation.then(() => 'acquired', () => 'rejected'), new Promise<string>(resolve => setTimeout(() => resolve('still-pending-after-100ms'), 100))]);
    release();
    const late = await operation.catch(() => undefined);
    await late?.close();
    await operation.settled().catch(() => undefined);
    expect(await fs.readdir(root)).not.toContain('.init-gateway-owner.lock');
    expect(result).toBe('rejected');
  } finally {
    spy.mockRestore(); syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('独立复现：owner 首个 FS 同步跨期限不应晚成功', async () => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'spec-owner-sync-'));
  const original = fs.lstat;
  let entered = false;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof original>) => {
    if (String(args[0]) === root && !entered) {
      entered = true;
      const deadline = performance.now() + 80;
      while (performance.now() < deadline) {}
    }
    return Reflect.apply(original, fs, args);
  });
  syncBuiltinESMExports();
  try {
    const began = performance.now();
    const operation = acquireRemoteOwner(new PrivateStore(root), { timeoutMs: 20 });
    const result = await operation.then(async owner => {
      await owner.close();
      return 'acquired';
    }, () => 'rejected');
    await operation.settled().catch(() => undefined);
    expect(await fs.readdir(root)).not.toContain('.init-gateway-owner.lock');
    expect(performance.now() - began).toBeGreaterThanOrEqual(20);
    expect(result).toBe('rejected');
  } finally {
    spy.mockRestore(); syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('独立复现：close 的 inode 检查后替换公开 socket 不应删除替换物', async () => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'spec-unlink-'));
  await fs.chmod(root, 0o700);
  const admin = await publishRemoteAdmin({ directory: root, runtime: { queryStatus: async () => ({ state: 'unconfigured' }) } as any, access: () => ({ host: 'localhost', port: 1, token: 'x' }) });
  const socketPath = join(root, 'admin.sock');
  const original = fs.lstat;
  let replaced = false;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof original>) => {
    const stat = await Reflect.apply(original, fs, args);
    if (String(args[0]) === socketPath && !replaced) {
      replaced = true;
      await fs.rename(socketPath, join(root, 'old.sock'));
      await fs.writeFile(socketPath, 'must-remain', { mode: 0o600 });
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    await admin.settled();
    expect(replaced).toBe(true);
    const quarantine = (await fs.readdir(root)).filter(name => name.startsWith('.cleanup-'));
    expect(quarantine).toHaveLength(1);
    expect(await fs.readFile(join(root, quarantine[0]!, 'entry'), 'utf8')).toBe('must-remain');
  } finally {
    spy.mockRestore(); syncBuiltinESMExports();
    await admin.settled();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('独立复现：Runtime settled 等待真实 Relay 的 WebSocket close', async () => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'spec-relay-'));
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => wss.once('listening', resolve));
  let peer: any;
  wss.on('connection', socket => {
    peer = socket;
    socket.send(JSON.stringify({ type: 'device_key_challenge', nonce: 'synthetic' }));
  });
  const relay = new RemoteRelay({ clientId: 'synthetic-client', authProvider: { prepareConnection: async () => ({ url: `ws://127.0.0.1:${(wss.address() as any).port}`, headers: {}, signChallenge: async () => ({ signature: 'synthetic' }) }) } });
  const deadline = performance.now() + 2000;
  while (relay.state !== 'online') {
    if (performance.now() > deadline) throw new Error('local relay startup timeout');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  const socket = (relay as any).socket;
  let actualClose = false;
  socket.once('close', () => actualClose = true);
  const store = new PrivateStore(root);
  const controller = new RemoteController({ store, canonicalUrl: 'ws://127.0.0.1:1', managedAuth: {} as any, authProvider: {} as any });
  (controller as any).relay = relay;
  const runtime = new RemoteRuntime({ store, canonicalUrl: 'ws://127.0.0.1:1' });
  (runtime as any).bundle = { controller, loader: { close() {} }, oauth: { close() {} } };
  try {
    await runtime.settled();
    expect(socket.readyState).toBe(3);
    expect(actualClose).toBe(true);
  } finally {
    await runtime.settled();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('捕获socket替换物时后来又出现新公开路径，保留两者且不覆盖新文件', async () => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'spec-capture-'));
  const admin = await publishRemoteAdmin({ directory: root, runtime: {} as any, access: () => ({ host: 'localhost', port: 1, token: 'x' }) });
  const path = join(root, 'admin.sock'); const originalStat=fs.lstat;const originalRename=fs.rename;
  let replaced=false;let later=false;let capturedIdentity:any;
  const statSpy=vi.spyOn(fs,'lstat').mockImplementation((async (...args:Parameters<typeof originalStat>)=>{
    const stat=await Reflect.apply(originalStat,fs,args);
    if(String(args[0])===path&&!replaced){replaced=true;await originalRename(path,join(root,'old.sock'));await fs.writeFile(path,'first-replacement',{mode:0o600});capturedIdentity=await originalStat(path);}
    return stat;
  }) as typeof fs.lstat);
  const renameSpy=vi.spyOn(fs,'rename').mockImplementation((async (from:any,to:any)=>{
    await originalRename(from,to);
    if(String(from)===path&&String(to).includes('.cleanup-')&&!later){later=true;await fs.writeFile(path,'later-replacement',{mode:0o600});}
  }) as typeof fs.rename);syncBuiltinESMExports();
  try {
    await admin.settled();expect(later).toBe(true);expect(await fs.readFile(path,'utf8')).toBe('later-replacement');
    const captures=(await fs.readdir(root)).filter(name=>name.startsWith('.cleanup-'));expect(captures).toHaveLength(1);const held=join(root,captures[0]!,'entry');const stat=await originalStat(held);
    expect([stat.dev,stat.ino]).toEqual([capturedIdentity.dev,capturedIdentity.ino]);expect(await fs.readFile(held,'utf8')).toBe('first-replacement');
  } finally {statSpy.mockRestore();renameSpy.mockRestore();syncBuiltinESMExports();await admin.settled();await fs.rm(root,{recursive:true,force:true});}
});

it.each([false,true])('已摘除的真实Relay连接仍阻止Runtime settled（storage失败=%s）；原bounded close保持有界', async failedStorage => {
  const root=await fs.mkdtemp(join(await fs.realpath(tmpdir()),'retired-relay-'));
  const wss=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise<void>(resolve=>wss.once('listening',resolve));
  wss.on('connection',socket=>socket.send(JSON.stringify({type:'device_key_challenge',nonce:'synthetic'})));
  const relay=new RemoteRelay({clientId:'synthetic',authProvider:{prepareConnection:async()=>({url:`ws://127.0.0.1:${(wss.address() as any).port}`,headers:{},signChallenge:async()=>({signature:'synthetic'})})}});
  const deadline=performance.now()+2000;while(relay.state!=='online'){if(performance.now()>deadline)throw new Error('local relay timeout');await new Promise(resolve=>setTimeout(resolve,2));}
  const socket=(relay as any).socket;const native=socket._socket;const destroy=native.destroy.bind(native);const spy=vi.spyOn(native,'destroy').mockImplementation(()=>native);
  const store=new PrivateStore(root);const controller=new RemoteController({store,canonicalUrl:'ws://127.0.0.1:1',managedAuth:{} as any,authProvider:{} as any});(controller as any).relay=relay;
  const runtime=new RemoteRuntime({store,canonicalUrl:'ws://127.0.0.1:1',cleanupTimeoutMs:10});(runtime as any).bundle={controller,loader:{close(){}},oauth:{close(){}}};
  if (failedStorage) {
    await fs.writeFile(join(root,'victim'),'must-remain'); await fs.symlink(join(root,'victim'),join(root,'blocked.json'));
    const failed=store.writeJson('blocked.json',{});void failed.catch(()=>undefined);(controller as any).storage=failed;
  }
  let finished=false;
  try {
    (controller as any).suspend('auth-required');expect((controller as any).relay).toBeUndefined();
    const began=performance.now();await runtime.close();expect(performance.now()-began).toBeLessThan(500);
    const actual=runtime.settled().then(()=>finished=true);await new Promise(resolve=>setTimeout(resolve,25));expect(finished).toBe(false);expect(socket.readyState).toBe(2);
    spy.mockRestore();destroy();await actual;expect(socket.readyState).toBe(3);
  } finally {spy.mockRestore();destroy();await runtime.settled();for(const peer of wss.clients)peer.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await fs.rm(root,{recursive:true,force:true});}
});

it('取得归属前已取消不执行FS，也不遗留未处理的ready拒绝', async () => {
  const root=await fs.mkdtemp(join(await fs.realpath(tmpdir()),'cancel-owner-'));const path=join(root,'absent');const abort=new AbortController();abort.abort();
  const operation=acquireRemoteOwner(new PrivateStore(path),{signal:abort.signal});
  try {await expect(operation).rejects.toMatchObject({code:'cancelled'});await operation.settled();await expect(fs.lstat(path)).rejects.toMatchObject({code:'ENOENT'});await new Promise(resolve=>setImmediate(resolve));}
  finally {await fs.rm(root,{recursive:true,force:true});}
});
