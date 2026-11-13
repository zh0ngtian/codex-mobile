// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { getEventListeners } from 'node:events';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrivateStore } from '../../server/remote/private-store.js';
import { acquireRemoteOwner } from '../../server/remote/owner.js';
import { publishRemoteAdmin } from '../../server/remote/admin.js';
import { RemoteRuntime } from '../../server/remote/runtime.js';
import { RemoteController } from '../../server/remote/controller.js';
import { ManagedAuthLoader } from '../../server/remote/managed-auth.js';
import { RemoteRelay } from '../../server/remote/relay.js';
import { WebSocketServer } from 'ws';
import { RemoteIdentityRegistry } from '../../server/remote/identity-registry.js';

it.each(['managed-auth', 'controller'] as const)('%s最终同步真实root证明跨期限，不交付外部操作的晚结果', async kind => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'resource-final-proof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const resource = kind === 'managed-auth'
    ? new ManagedAuthLoader({ canonicalFactory: async () => ({} as any), operationTimeoutMs: 20, assertOwnership: () => owner.assert() })
    : new RemoteController({ store: owner.store, canonicalUrl: 'ws://127.0.0.1:1', managedAuth: {} as any, authProvider: {} as any, operationTimeoutMs: 20 });
  const original = fsSync.lstatSync;
  let returned = false;
  let delayed = false;
  const spy = vi.spyOn(fsSync, 'lstatSync').mockImplementation((...args: Parameters<typeof original>) => {
    const stat = Reflect.apply(original, fsSync, args);
    if (returned && !delayed && String(args[0]) === root) {
      delayed = true;
      const until = performance.now() + 80;
      while (performance.now() < until) {}
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    const operation = async () => { returned = true; return 'late-result'; };
    const pending = kind === 'managed-auth'
      ? (resource as any).external(operation, true)
      : (resource as any).external((resource as any).epoch, operation);
    const result = await pending.then(() => 'delivered', () => 'rejected');
    expect(delayed).toBe(true);
    expect(result).toBe('rejected');
  } finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    await resource.settled();
    await owner.close();
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['timeout', 'cancel'] as const)('owner最终同步真实root证明期间%s，不交付归属且实际settled释放锁', async reason => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-final-proof-'));
  const store = new PrivateStore(root);
  const abort = new AbortController();
  const initialize = store.withGatewayOwnership.bind(store);
  let ready = false;
  let delayed = false;
  let owner: Awaited<ReturnType<typeof acquireRemoteOwner>> | undefined;
  const initializeSpy = vi.spyOn(store, 'withGatewayOwnership').mockImplementation((operation, options) =>
    initialize(proof => { ready = true; return operation(proof); }, options));
  const original = fsSync.lstatSync;
  const statSpy = vi.spyOn(fsSync, 'lstatSync').mockImplementation((...args: Parameters<typeof original>) => {
    const stat = Reflect.apply(original, fsSync, args);
    if (ready && !delayed && String(args[0]) === root) {
      delayed = true;
      if (reason === 'cancel') abort.abort();
      else {
        const until = performance.now() + 250;
        while (performance.now() < until) {}
      }
    }
    return stat;
  });
  syncBuiltinESMExports();
  const pending = acquireRemoteOwner(store, { timeoutMs: reason === 'timeout' ? 100 : 1000, signal: abort.signal });
  try {
    const result = await pending.then(value => { owner = value; return 'acquired'; }, () => 'rejected');
    expect(delayed).toBe(true);
    expect(result).toBe('rejected');
    await pending.settled();
    expect(await fs.readdir(root)).toEqual([]);
  } finally {
    statSpy.mockRestore();
    initializeSpy.mockRestore();
    syncBuiltinESMExports();
    await owner?.close();
    await pending.settled();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('归属清理末次锁检查await期间替换root，不删除新root中的空锁目录', async () => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-cleanup-proof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const lock = join(root, '.init-gateway-owner.lock');
  const original = fs.lstat;
  let changed = false;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof original>) => {
    const stat = await Reflect.apply(original, fs, args);
    if (String(args[0]) === lock && !changed && (await fs.readdir(lock)).length === 0) {
      changed = true;
      await fs.rename(root, `${root}-moved`);
      await fs.mkdir(root, { mode: 0o700 });
      await fs.mkdir(lock, { mode: 0o700 });
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    await expect(owner.close()).rejects.toBeDefined();
    expect(changed).toBe(true);
    expect(await fs.readdir(root)).toEqual(['.init-gateway-owner.lock']);
    expect(await fs.readdir(lock)).toEqual([]);
    expect(owner.signal.aborted).toBe(true);
  } finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it('Runtime正常收尾解除自己的归属监听器，同一owner可再次创建Runtime', async () => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-listener-proof-'));
  const owner = await acquireRemoteOwner(new PrivateStore(join(parent, 'r')));
  try {
    for (let iteration = 0; iteration < 2; iteration++) {
      const runtime = new RemoteRuntime({ store: owner.store, canonicalUrl: 'ws://127.0.0.1:1' });
      await runtime.start();
      expect(getEventListeners(owner.signal, 'abort')).toHaveLength(1);
      await runtime.settled();
      expect(getEventListeners(owner.signal, 'abort')).toHaveLength(0);
    }
  }
  finally {
    await owner.close();
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['root', 'ancestor'] as const)('首次异步FS返回前替换%s也不能重建或chmod后来目录', async (kind) => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-first-proof-'));
  const ancestor = join(parent, 'a');
  const root = join(ancestor, 'r');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const original = fs.lstat;
  let changed = false;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof original>) => {
    const stat = await Reflect.apply(original, fs, args);
    if (String(args[0]) === (kind === 'root' ? root : ancestor) && !changed) {
      changed = true;
      await fs.rename(kind === 'root' ? root : ancestor, `${kind === 'root' ? root : ancestor}-moved`);
      await fs.mkdir(root, { recursive: true, mode: 0o755 });
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    const pending = acquireRemoteOwner(new PrivateStore(root));
    await expect(pending).rejects.toBeDefined();
    await pending.settled().catch(() => undefined);
    expect(changed).toBe(true);
    expect(await fs.readdir(root)).toEqual([]);
    expect((await original(root)).mode & 0o777).toBe(0o755);
  }
  finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it('原root移回原路径也不能恢复已失效归属；同PID/nonce的owner替换inode仍拒绝', async () => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-permanent-proof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const lock = join(root, '.init-gateway-owner.lock');
  const name = (await fs.readdir(lock))[0]!;
  const contents = await fs.readFile(join(lock, name), 'utf8');
  try {
    await fs.rename(join(lock, name), join(parent, 'old-owner'));
    await fs.writeFile(join(lock, name), contents, { mode: 0o600 });
    expect(() => owner.assert()).toThrow();
    expect(owner.signal.aborted).toBe(true);
    await fs.rm(join(lock, name));
    await fs.rename(join(parent, 'old-owner'), join(lock, name));
    await expect(owner.store.writeJson('must-not-write.json', {})).rejects.toBeDefined();
    expect(() => owner.assert()).toThrow();
    expect(await fs.readFile(join(lock, name), 'utf8')).toBe(contents);
    expect(await fs.readdir(root)).toEqual(['.init-gateway-owner.lock']);
  }
  finally {
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['root', 'ancestor'] as const)('Runtime读取指针await期间替换%s：不交付结果、不创建canonical，可信settled完成', async (kind) => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-runtime-await-'));
  const ancestor = join(parent, 'a');
  const root = join(ancestor, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  let entered!: () => void;
  const started = new Promise<void>(resolve => entered = resolve);
  let release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  const factory = vi.fn();
  const runtime = new RemoteRuntime({ store: owner.store, canonicalFactory: factory, registry: { readActive: async () => {
        entered();
        await gate;
        return null;
      } } as any });
  try {
    const pending = runtime.start().then(() => 'delivered', () => 'rejected');
    await started;
    const target = kind === 'root' ? root : ancestor;
    await fs.rename(target, `${target}-moved`);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    release();
    expect(await pending).toBe('rejected');
    await runtime.settled();
    expect(runtime.status().state).toBe('closed');
    expect(factory).not.toHaveBeenCalled();
    expect(await fs.readdir(root)).toEqual([]);
  }
  finally {
    release();
    await runtime.settled();
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['root', 'ancestor'] as const)('Registry克隆与generation子store保留同一%s归属，不能写入替换目录', async (kind) => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-registry-proof-'));
  const ancestor = join(parent, 'a');
  const root = join(ancestor, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const registry = new RemoteIdentityRegistry(owner.store);
  const candidate = await registry.beginCandidate();
  try {
    const target = kind === 'root' ? root : ancestor;
    await fs.rename(target, `${target}-moved`);
    await fs.mkdir(root, { recursive: true, mode: 0o755 });
    await expect(candidate.store.writeJson('must-not-write.json', {})).rejects.toBeDefined();
    await expect(registry.beginCandidate()).rejects.toBeDefined();
    expect(await fs.readdir(root)).toEqual([]);
    expect((await fs.lstat(root)).mode & 0o777).toBe(0o755);
  }
  finally {
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it('Registry generation mkdir await期间替换root，不在新目录继续提交candidate', async () => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-generation-proof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const registry = new RemoteIdentityRegistry(owner.store);
  const original = fs.mkdir;
  let changed = false;
  const spy = vi.spyOn(fs, 'mkdir').mockImplementation(async (...args: Parameters<typeof original>) => {
    const value = await Reflect.apply(original, fs, args);
    if (String(args[0]).startsWith(join(root, 'identity-')) && !changed) {
      changed = true;
      await fs.rename(root, `${root}-moved`);
      await Reflect.apply(original, fs, [root, { mode: 0o700 }]);
    }
    return value;
  });
  syncBuiltinESMExports();
  try {
    await expect(registry.beginCandidate()).rejects.toBeDefined();
    expect(changed).toBe(true);
    expect(await fs.readdir(root)).toEqual([]);
  }
  finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it('Relay等待认证期间root被替换，晚认证结果不得再建立物理连接', async () => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-relay-proof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => wss.once('listening', resolve));
  let connections = 0;
  wss.on('connection', () => connections++);
  let release!: (value: any) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => entered = resolve);
  const relay = new RemoteRelay({ clientId: 'synthetic-client', assertOwnership: () => owner.assert(), authProvider: { prepareConnection: () => {
        entered();
        return new Promise(resolve => release = resolve);
      } } } as any);
  try {
    await started;
    await fs.rename(root, `${root}-moved`);
    await fs.mkdir(root, { mode: 0o700 });
    release({ url: `ws://127.0.0.1:${(wss.address() as any).port}`, headers: {}, signChallenge: async () => ({}) });
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(connections).toBe(0);
    expect(relay.state).toBe('closed');
    expect(owner.signal.aborted).toBe(true);
  }
  finally {
    await relay.settled();
    for (const peer of wss.clients)
      peer.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['root', 'ancestor'] as const)('取得归属的root fsync返回前替换%s：不得交付错位归属或污染新目录', async (kind) => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-proof-'));
  const ancestor = join(parent, 'a');
  const root = join(ancestor, 'r');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const target = kind === 'root' ? root : ancestor;
  const original = fs.open;
  let changed = false;
  const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof original>) => {
    const handle = await Reflect.apply(original, fs, args);
    if (String(args[0]) === root && !changed) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        await sync();
        if (!changed) {
          changed = true;
          await fs.rename(target, `${target}-moved`);
          await fs.mkdir(root, { recursive: true, mode: 0o700 });
        }
      };
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    const pending = acquireRemoteOwner(new PrivateStore(root));
    const result = await pending.then(async (owner) => {
      await owner.close().catch(() => undefined);
      return 'acquired';
    }, () => 'rejected');
    await pending.settled().catch(() => undefined);
    expect(changed).toBe(true);
    expect(result).toBe('rejected');
    expect(await fs.readdir(root)).toEqual([]);
  }
  finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['store', 'runtime', 'admin'] as const)('已交付归属后替换root：%s不得采用新目录', async (kind) => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-proof-live-'));
  const root = join(parent, 'r');
  const originalStore = new PrivateStore(root);
  const owner = await acquireRemoteOwner(originalStore);
  const store = (owner as any).store ?? originalStore;
  let runtime: RemoteRuntime | undefined;
  let publication: ReturnType<typeof publishRemoteAdmin> | undefined;
  try {
    await fs.rename(root, `${root}-moved`);
    await fs.mkdir(root, { mode: 0o700 });
    if (kind === 'store')
      await expect(store.writeJson('must-not-write.json', {})).rejects.toBeDefined();
    if (kind === 'runtime') {
      runtime = new RemoteRuntime({ store, canonicalUrl: 'ws://127.0.0.1:1' });
      const status = await runtime.start().catch(() => runtime!.status());
      expect(['closed', 'fault']).toContain(status.state);
    }
    if (kind === 'admin') {
      publication = publishRemoteAdmin({ directory: root, owner, runtime: { queryStatus: async () => ({ state: 'unconfigured' }) } as any, access: () => ({ host: 'localhost', port: 1, token: 'x' }) } as any);
      const result = await publication.then(async (server) => {
        await server.settled();
        return 'published';
      }, () => 'rejected');
      expect(result).toBe('rejected');
    }
    expect(await fs.readdir(root)).toEqual([]);
  }
  finally {
    await publication?.settled().catch(() => undefined);
    await runtime?.settled();
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

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
