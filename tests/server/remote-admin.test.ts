// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { mkdtemp, realpath, rm, readdir, chmod, lstat, readFile, writeFile, symlink, link, rename, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { PrivateStore } from '../../server/remote/private-store.js';
import { publishRemoteAdmin } from '../../server/remote/admin.js';
import { callRemoteAdmin } from '../../server/remote/admin-client.js';
import { acquireRemoteOwner } from '../../server/remote/owner.js';
const roots: string[] = [];
const resources: {
  close(): Promise<void>;
}[] = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map(r => r.close()));
  await Promise.all(roots.splice(0).map(r => rm(r, { recursive: true, force: true })));
});
async function root() {
  const r = await mkdtemp(join(await realpath(tmpdir()), 'radmin-'));
  roots.push(r);
  await chmod(r, 0o700);
  return r;
}
const status = { state: 'unconfigured', pendingResume: [], targets: [] };
function runtime(overrides: Record<string, unknown> = {}) {
  return { status: () => status, queryStatus: async () => status, ...overrides } as any;
}
async function admin(r: string, rt = runtime(), options = {}) {
  const a = await publishRemoteAdmin({ directory: r, runtime: rt, access: () => ({ host: '127.0.0.1', port: 12345, token: 'gateway-only' }), ...options });
  resources.push(a);
  return a;
}
it('完整EOF解析越过原请求期限时不执行身份操作，也不重置为新操作期限', async () => {
  const r = await root();
  const authorize = vi.fn(async () => null);
  await admin(r, runtime({ authorize }), { requestTimeoutMs: 50 });
  const original = JSON.parse;
  let delayed = false;
  const spy = vi.spyOn(JSON, 'parse').mockImplementation((...args: Parameters<typeof original>) => {
    const parsed = Reflect.apply(original, JSON, args);
    if (!delayed && parsed?.method === 'authorize') {
      delayed = true;
      const until = performance.now() + 200;
      while (performance.now() < until) {}
    }
    return parsed;
  });
  try {
    await expect(callRemoteAdmin({ directory: r, method: 'authorize', timeoutMs: 1000 })).rejects.toMatchObject({ code: 'timeout' });
    expect(delayed).toBe(true);
    expect(authorize).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});

it.each(['timeout', 'cancel'] as const)('客户端最终响应解析期间%s：拒绝晚结果，已发送身份操作不自动重放', async reason => {
  const r = await root();
  const authorize = vi.fn(async () => ({ marker: 'final-response-deadline' }));
  await admin(r, runtime({ authorize }));
  const abort = new AbortController();
  const original = JSON.parse;
  let finalFrames = 0;
  let delayed = false;
  const spy = vi.spyOn(JSON, 'parse').mockImplementation((...args: Parameters<typeof original>) => {
    const parsed = Reflect.apply(original, JSON, args);
    // data阶段只排除pending帧；EOF阶段再次严格验证最终帧。
    if (parsed?.result?.marker === 'final-response-deadline' && ++finalFrames === 2) {
      delayed = true;
      if (reason === 'cancel') abort.abort();
      else {
        const until = performance.now() + 200;
        while (performance.now() < until) {}
      }
    }
    return parsed;
  });
  try {
    await expect(callRemoteAdmin({ directory: r, method: 'authorize', timeoutMs: reason === 'timeout' ? 50 : 1000, signal: abort.signal }))
      .rejects.toMatchObject({ code: reason === 'timeout' ? 'timeout' : 'cancelled' });
    expect(delayed).toBe(true);
    expect(authorize).toHaveBeenCalledTimes(1);
  } finally { spy.mockRestore(); }
});

it('只通过当前私有运行端点读取状态和实际网关访问参数', async () => {
  const r = await root();
  await admin(r);
  expect(await callRemoteAdmin({ directory: r, method: 'status' })).toEqual(status);
  expect(await callRemoteAdmin({ directory: r, method: 'url' })).toEqual({ host: '127.0.0.1', port: 12345, token: 'gateway-only' });
  expect((await lstat(join(r, 'admin.json'))).mode & 0o777).toBe(0o600);
  expect((await lstat(join(r, 'admin.sock'))).mode & 0o777).toBe(0o600);
});
it('离线客户端完全只读，未知路径不会创建根目录或修复权限', async () => {
  const r = await root();
  const missing = join(r, 'missing');
  await expect(callRemoteAdmin({ directory: missing, method: 'status' })).rejects.toMatchObject({ code: 'unavailable' });
  expect(await readdir(r)).toEqual([]);
  await chmod(r, 0o755);
  await expect(callRemoteAdmin({ directory: r, method: 'status' })).rejects.toBeDefined();
  expect((await lstat(r)).mode & 0o777).toBe(0o755);
});
it('runtime身份busy时只读状态并行，断开连接中止尚未提交的操作', async () => {
  const r = await root();
  let aborted = false;
  let entered!: () => void;
  const started = new Promise<void>(r => entered = r);
  await admin(r, runtime({ login: (signal: AbortSignal) => {
      entered();
      return new Promise((_r, reject) => signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('secret-auth-url'));
      }));
    } }));
  const abort = new AbortController();
  const flight = callRemoteAdmin({ directory: r, method: 'login', signal: abort.signal });
  const rejected = expect(flight).rejects.toMatchObject({ code: 'cancelled' });
  await started;
  expect(await callRemoteAdmin({ directory: r, method: 'status' })).toEqual(status);
  abort.abort();
  await rejected;
  await new Promise(r => setTimeout(r, 250));
  expect(aborted).toBe(true);
});
it('完整参数先校验，重复帧绝不执行，错误脱敏', async () => {
  const r = await root();
  let calls = 0;
  await admin(r, runtime({ login: async () => {
      calls++;
      throw new Error('secret-code https://auth.example');
    } }));
  const meta = JSON.parse(await readFile(join(r, 'admin.json'), 'utf8'));
  const request = { version: 1, instance: meta.instance, nonce: meta.nonce, method: 'login', params: {} };
  await new Promise<void>((resolve, reject) => {
    const s = createConnection(join(r, 'admin.sock'));
    let hello = false;
    s.on('error', reject);
    s.on('data', () => {
      if (!hello) {
        hello = true;
        s.end(JSON.stringify(request) + '\n' + JSON.stringify(request) + '\n');
      }
    });
    s.on('close', () => resolve());
  });
  expect(calls).toBe(0);
  await expect(callRemoteAdmin({ directory: r, method: 'login' })).rejects.toMatchObject({ code: 'unavailable', message: 'Remote 管理通道不可用' });
  expect(calls).toBe(1);
});
it('关闭不删除被替换的 metadata 或公开 socket', async () => {
  const r = await root();
  const a = await admin(r);
  await unlink(join(r, 'admin.sock'));
  await writeFile(join(r, 'admin.sock'), 'replacement');
  await unlink(join(r, 'admin.json'));
  await writeFile(join(r, 'admin.json'), 'replacement');
  await a.close();
  expect(await readFile(join(r, 'admin.sock'), 'utf8')).toBe('replacement');
  expect(await readFile(join(r, 'admin.json'), 'utf8')).toBe('replacement');
});
it('拒绝 metadata 硬链接、符号链接以及祖先替换', async () => {
  const r = await root();
  await admin(r);
  const p = join(r, 'admin.json');
  await link(p, join(r, 'copy'));
  await expect(callRemoteAdmin({ directory: r, method: 'status' })).rejects.toBeDefined();
  await unlink(join(r, 'copy'));
  await rename(p, join(r, 'real'));
  await symlink(join(r, 'real'), p);
  await expect(callRemoteAdmin({ directory: r, method: 'status' })).rejects.toBeDefined();
  const alias = join(r, 'alias');
  await symlink(r, alias);
  await expect(callRemoteAdmin({ directory: alias, method: 'status' })).rejects.toBeDefined();
});
it('已活着PID的旧端点绝不被清理，归属不靠锁年龄抢占', async () => {
  const r = await root();
  const owner = await acquireRemoteOwner(new PrivateStore(r), { timeoutMs: 500 });
  const competing = acquireRemoteOwner(new PrivateStore(r), { timeoutMs: 20 });
  await expect(competing).rejects.toMatchObject({ code: 'busy' });
  await competing.settled().catch(() => undefined);
  await owner.close();
  const next = await acquireRemoteOwner(new PrivateStore(r), { timeoutMs: 500 });
  await next.close();
});
async function rawRequest(r: string, bytes: string | Buffer, end = true): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(join(r, 'admin.sock'));
    const frames: any[] = [];
    let pending = '';
    let sent = false;
    socket.on('error', reject);
    socket.on('data', b => {
      pending += b.toString();
      while (pending.includes('\n')) {
        const n = pending.indexOf('\n');
        frames.push(JSON.parse(pending.slice(0, n)));
        pending = pending.slice(n + 1);
        if (!sent) {
          sent = true;
          if (end) {
            socket.end(bytes);
          }
          else {
            socket.write(bytes);
          }
        }
      }
    });
    socket.on('close', () => resolve(frames));
  });
}
async function encoded(r: string, method: string, params: object = {}) {
  const m = JSON.parse(await readFile(join(r, 'admin.json'), 'utf8'));
  return JSON.stringify({ version: 1, instance: m.instance, nonce: m.nonce, method, params }) + '\n';
}
it('固定verb拒绝额外参数、不完整tuple、未知版本与nonce，不触发身份变更', async () => {
  const r = await root();
  let calls = 0;
  await admin(r, runtime({ pairManual: async () => {
      calls++;
    }, login: async () => {
      calls++;
    } }));
  for (const [method, params] of [['pair', { code: 'secret', target: { environmentId: 'only-one' } }], ['login', { script: 'secret' }], ['unknown', {}]]) {
    const frames = await rawRequest(r, await encoded(r, method as string, params as object));
    expect(frames.at(-1)).toMatchObject({ ok: false, error: 'protocol' });
  }
  const valid = JSON.parse(await encoded(r, 'login'));
  for (const wrong of [{ ...valid, version: 2 }, { ...valid, nonce: '00000000-0000-4000-8000-000000000000' }]) {
    expect((await rawRequest(r, JSON.stringify(wrong) + '\n')).at(-1)).toMatchObject({ error: 'protocol' });
  }
  expect(calls).toBe(0);
});
it('超大请求、慢写和连接上限均有明确有界错误', async () => {
  const r = await root();
  await admin(r, runtime(), { requestTimeoutMs: 30, maxConnections: 1 });
  expect((await rawRequest(r, Buffer.alloc(65537, 65))).at(-1)).toMatchObject({ error: 'limit' });
  expect((await rawRequest(r, '{', false)).at(-1)).toMatchObject({ error: 'timeout' });
  const hold = createConnection(join(r, 'admin.sock'));
  await new Promise<void>(resolve => hold.once('data', () => resolve()));
  const limited = await new Promise<string>(resolve => {
    const second = createConnection(join(r, 'admin.sock'));
    let output = '';
    second.on('data', b => output += b);
    second.on('close', () => resolve(output));
    second.on('error', () => resolve(output));
  });
  expect(limited).toContain('limit');
  try {
    await expect(callRemoteAdmin({ directory: r, method: 'status' })).rejects.toMatchObject({ code: 'limit' });
  }
  finally {
    hold.destroy();
  }
});
it('同步跨绝对期限与迟到操作结果不会作为成功交付，关闭中止操作', async () => {
  const r = await root();
  let finish!: (v: unknown) => void;
  let aborted = false;
  let mode = 'block';
  const a = await admin(r, runtime({ login: async (signal: AbortSignal) => {
      if (mode === 'block') {
        const d = performance.now() + 20;
        while (performance.now() < d) {
        }
        return { accountId: 'late' };
      }
      return new Promise(resolve => {
        finish = resolve;
        signal.addEventListener('abort', () => aborted = true);
      });
    } }), { operationTimeoutMs: 5 });
  await expect(callRemoteAdmin({ directory: r, method: 'login' })).rejects.toMatchObject({ code: 'timeout' });
  mode = 'pending';
  await expect(callRemoteAdmin({ directory: r, method: 'login' })).rejects.toMatchObject({ code: 'timeout' });
  expect(aborted).toBe(true);
  finish({ accountId: 'late' });
  await a.close();
  await expect(callRemoteAdmin({ directory: r, method: 'status' })).rejects.toMatchObject({ code: 'unavailable' });
});
it('响应超过8MiB明确报limit且不截断，异常身份操作保留runtime busy分类', async () => {
  const r = await root();
  const { RemoteRuntimeError } = await import('../../server/remote/runtime.js');
  await admin(r, runtime({ queryStatus: async () => ({ large: 'a'.repeat(8 * 1024 * 1024) }), login: async () => {
      throw new RemoteRuntimeError('busy');
    } }));
  await expect(callRemoteAdmin({ directory: r, method: 'status' })).rejects.toMatchObject({ code: 'limit' });
  await expect(callRemoteAdmin({ directory: r, method: 'login' })).rejects.toMatchObject({ code: 'busy' });
});
it('取消启动不会发布任何管理端点', async () => {
  const r = await root();
  const signal = AbortSignal.abort();
  await expect(publishRemoteAdmin({ directory: r, runtime: runtime(), access: () => ({ host: 'localhost', port: 1, token: 'x' }), signal })).rejects.toMatchObject({ code: 'cancelled' });
  expect(await readdir(r)).toEqual([]);
});
it('握手重验nonce、PID存活和socket inode，替换端点不能收到管理请求', async () => {
  const { createServer } = await import('node:net');
  const { randomUUID } = await import('node:crypto');
  for (const kind of ['nonce', 'socket', 'parent'] as const) {
    const r = await root();
    const m = { version: 1, pid: process.pid, instance: randomUUID(), nonce: randomUUID() };
    await writeFile(join(r, 'admin.json'), JSON.stringify(m), { mode: 0o600 });
    let received = 0;
    const server = createServer(socket => {
      socket.on('error', () => {
      });
      socket.on('data', b => received += b.length);
      void (async () => {
        if (kind === 'socket') {
          await unlink(join(r, 'admin.sock'));
          const replacement = createServer();
          await new Promise<void>(resolve => replacement.listen(join(r, 'admin.sock'), resolve));
          await chmod(join(r, 'admin.sock'), 0o600);
          resources.push({ close: () => new Promise<void>(resolve => replacement.close(() => resolve())) });
        }
        if (kind === 'parent') {
          await rename(r, `${r}-moved`);
          roots.push(`${r}-moved`);
          await mkdir(r, { mode: 0o700 });
        }
        socket.write(JSON.stringify({ type: 'hello', ...m, ...(kind === 'nonce' ? { nonce: randomUUID() } : {}) }) + '\n');
      })();
    });
    await new Promise<void>(resolve => server.listen(join(r, 'admin.sock'), resolve));
    await chmod(join(r, 'admin.sock'), 0o600);
    resources.push({ close: () => new Promise<void>(resolve => server.close(() => resolve())) });
    await expect(callRemoteAdmin({ directory: r, method: 'login' })).rejects.toBeDefined();
    expect(received).toBe(0);
  }
});
it('metadata PID仍活跃或无法证明死亡时拒绝清理，不把PID复用当成旧owner死亡', async () => {
  const r = await root();
  await admin(r);
  const before = await readFile(join(r, 'admin.json'), 'utf8');
  await expect(publishRemoteAdmin({ directory: r, runtime: runtime(), access: () => ({ host: 'localhost', port: 1, token: 'x' }) })).rejects.toMatchObject({ code: 'busy' });
  expect(await readFile(join(r, 'admin.json'), 'utf8')).toBe(before);
});
it('仅dead PID可回收确切旧socket与metadata，死PID加普通文件仍fail closed', async () => {
  const { spawnSync } = await import('node:child_process');
  const { randomUUID } = await import('node:crypto');
  const r = await root();
  const pid = spawnSync(process.execPath, ['-e', '']).pid;
  const m = { version: 1, pid, instance: randomUUID(), nonce: randomUUID() };
  await writeFile(join(r, 'admin.json'), JSON.stringify(m), { mode: 0o600 });
  await writeFile(join(r, 'admin.sock'), 'ordinary-file', { mode: 0o600 });
  await expect(admin(r)).rejects.toBeDefined();
  expect(await readFile(join(r, 'admin.sock'), 'utf8')).toBe('ordinary-file');
  expect(JSON.parse(await readFile(join(r, 'admin.json'), 'utf8'))).toEqual(m);
  await unlink(join(r, 'admin.sock'));
  await admin(r);
  expect(await callRemoteAdmin({ directory: r, method: 'status' })).toEqual(status);
});
it('启动监听阶段取消后有界清理，不会晚发布metadata', async () => {
  const { Server } = await import('node:net');
  const { vi } = await import('vitest');
  const r = await root();
  const abort = new AbortController();
  const listen = Server.prototype.listen;
  const spy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: import('node:net').Server, ...args: any[]) {
    const result = Reflect.apply(listen, this, args);
    abort.abort();
    return result;
  } as typeof Server.prototype.listen);
  try {
    await expect(publishRemoteAdmin({ directory: r, runtime: runtime(), access: () => ({ host: 'localhost', port: 1, token: 'x' }), signal: abort.signal })).rejects.toMatchObject({ code: 'cancelled' });
  }
  finally {
    spy.mockRestore();
  }
  expect(await readdir(r)).toEqual([]);
});
it('只读metadata在lstat后被换成FIFO也有界失败，不留下永久挂起open', async () => {
  const fs = await import('node:fs/promises');
  const sync = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { vi } = await import('vitest');
  const r = await root();
  await admin(r);
  const path = join(r, 'admin.json');
  const original = fs.open;
  let changed = false;
  const { syncBuiltinESMExports } = await import('node:module');
  const spy = vi.spyOn(fs.default, 'open').mockImplementation((async (filename: any, ...args: any[]) => {
    if (filename === path && !changed) {
      changed = true;
      await unlink(path);
      execFileSync('mkfifo', ['-m', '600', path]);
    }
    return Reflect.apply(original, fs, [filename, ...args]);
  }) as typeof fs.open);
  syncBuiltinESMExports();
  try {
    const operation = callRemoteAdmin({ directory: r, method: 'status' }).then(() => 'resolved', () => 'rejected');
    const result = await Promise.race([operation, new Promise<string>(resolve => setTimeout(() => resolve('blocked'), 100))]);
    if (result === 'blocked') {
      const writer = sync.openSync(path, sync.constants.O_WRONLY | sync.constants.O_NONBLOCK);
      sync.closeSync(writer);
      await operation;
    }
    expect(result).toBe('rejected');
  }
  finally {
    spy.mockRestore();
    syncBuiltinESMExports();
  }
});
it.each(['client', 'publisher'] as const)('%s首个FS证明挂起也按实际期限结束，晚proof不会连接或发布', async (mode) => {
  const fs = await import('node:fs/promises');
  const { syncBuiltinESMExports } = await import('node:module');
  const { vi } = await import('vitest');
  const r = await root();
  const original = fs.lstat;
  let release!: () => void;
  let captured = false;
  const spy = vi.spyOn(fs.default, 'lstat').mockImplementation((async (...args: any[]) => {
    if (args[0] === r && !captured) {
      captured = true;
      await new Promise<void>(resolve => release = resolve);
    }
    return Reflect.apply(original, fs, args);
  }) as typeof fs.lstat);
  syncBuiltinESMExports();
  try {
    const publication = mode === 'publisher' ? publishRemoteAdmin({ directory: r, runtime: runtime(), access: () => ({ host: 'localhost', port: 1, token: 'x' }), startupTimeoutMs: 20 }) : undefined;
    const operation = (publication ?? callRemoteAdmin({ directory: r, method: 'status', handshakeTimeoutMs: 20 })).then(value => {
      if (mode === 'publisher') {
        resources.push(value as any);
      }
      return 'success';
    }, error => error.code);
    const result = await Promise.race([operation, new Promise<string>(resolve => setTimeout(() => resolve('blocked'), 80))]);
    release();
    await operation;
    expect(result).toBe('timeout');
    await publication?.settled();
    expect(await readdir(r)).toEqual([]);
  }
  finally {
    spy.mockRestore();
    syncBuiltinESMExports();
  }
});
it('真实Unix最终证明后同步跨外层期限也不晚交付或残留端点', async () => {
  const { vi } = await import('vitest');
  const sync = await import('node:fs');
  const r = await root();
  const remove = AbortSignal.prototype.removeEventListener;
  let blocked = false;
  const spy = vi.spyOn(AbortSignal.prototype, 'removeEventListener').mockImplementation(function (this: AbortSignal, type: string, listener: any, ...args: any[]) {
    const result = Reflect.apply(remove, this, [type, listener, ...args]);
    if (type === 'abort' && listener?.name === 'cancel' && !blocked && sync.existsSync(join(r, 'admin.json'))) {
      blocked = true;
      const deadline = performance.now() + 100;
      while (performance.now() < deadline) {
      }
    }
    return result;
  } as typeof AbortSignal.prototype.removeEventListener);
  const publication = publishRemoteAdmin({ directory: r, runtime: runtime(), access: () => ({ host: 'localhost', port: 1, token: 'x' }), startupTimeoutMs: 80 });
  try {
    await expect(publication).rejects.toMatchObject({ code: 'timeout' });
    expect(blocked).toBe(true);
    await publication.settled();
    expect(await readdir(r)).toEqual([]);
  }
  finally {
    spy.mockRestore();
    await publication.settled();
  }
});
it('客户端请求写入期限独立于长交互，同步跨写入期限也拒绝迟到成功', async () => {
  const { Socket } = await import('node:net');
  const { vi } = await import('vitest');
  const r = await root();
  await admin(r);
  const end = Socket.prototype.end;
  let blocked = false;
  const spy = vi.spyOn(Socket.prototype, 'end').mockImplementation(function (this: import('node:net').Socket, ...args: any[]) {
    const result = Reflect.apply(end, this, args);
    if (!blocked && Buffer.isBuffer(args[0]) && args[0].includes(Buffer.from('"method":"status"'))) {
      blocked = true;
      const deadline = performance.now() + 25;
      while (performance.now() < deadline) {
      }
    }
    return result;
  } as typeof Socket.prototype.end);
  try {
    await expect(callRemoteAdmin({ directory: r, method: 'status', timeoutMs: 1000, writeTimeoutMs: 5 })).rejects.toMatchObject({ code: 'timeout' });
    expect(blocked).toBe(true);
  }
  finally {
    spy.mockRestore();
  }
});
it('响应序列化同步跨操作期限时不得发送迟到成功', async () => {
  const r = await root();
  await admin(r, runtime({ queryStatus: async () => ({ toJSON() {
        const deadline = performance.now() + 25;
        while (performance.now() < deadline) {
        }
        return status;
      } }) }), { operationTimeoutMs: 5 });
  await expect(callRemoteAdmin({ directory: r, method: 'status' })).rejects.toMatchObject({ code: 'timeout' });
});
it('固定动作逐一调用同一runtime，完整目标与void结果均保真', async () => {
  const r = await root();
  const calls: {
    name: string;
    args: unknown[];
  }[] = [];
  const overrides: Record<string, unknown> = {};
  for (const name of ['login', 'authorize', 'recover', 'refreshTargets', 'pairLocal', 'pairManual', 'acceptTarget', 'resume', 'reassociate']) {
    overrides[name] = async (...args: unknown[]) => {
      calls.push({ name, args });
      return ['pairLocal', 'pairManual', 'acceptTarget', 'reassociate'].includes(name) ? undefined : { done: name };
    };
  }
  await admin(r, runtime(overrides));
  const target = { environmentId: 'full-env', installationId: 'full-install' };
  const next = { environmentId: 'full-next-env', installationId: 'full-next-install' };
  const commands = [['login', 'login', {}, []], ['authorize', 'authorize', {}, []], ['recover', 'recover', {}, []], ['reauthorize', 'recover', {}, []], ['targets', 'refreshTargets', {}, []], ['pair-local', 'pairLocal', {}, []], ['pair', 'pairManual', { code: 'explicit-code', target }, ['explicit-code', target]], ['accept', 'acceptTarget', { target }, [target]], ['resume', 'resume', { target }, [target]], ['reassociate', 'reassociate', { previous: target, next, code: 'explicit-code' }, [target, next, 'explicit-code']]] as const;
  for (const [method, name, params, args] of commands) {
    const result = await callRemoteAdmin({ directory: r, method, params });
    const call = calls.at(-1)!;
    expect(call.name).toBe(name);
    expect(call.args.slice(0, -1)).toEqual(args);
    expect(call.args.at(-1)).toBeInstanceOf(AbortSignal);
    expect(result).toEqual(['pairLocal', 'pairManual', 'acceptTarget', 'reassociate'].includes(name) ? null : { done: name });
  }
});
it('原始错误即使来自Runtime错误类型也只发送固定白名单code', async () => {
  const r = await root();
  const { RemoteRuntimeError } = await import('../../server/remote/runtime.js');
  await admin(r, runtime({ login: async () => {
      const error = new RemoteRuntimeError('unavailable');
      Object.assign(error, { code: 'private-pair-code' });
      throw error;
    } }));
  const frames = await rawRequest(r, await encoded(r, 'login'));
  expect(frames.at(-1)).toEqual({ version: 1, ok: false, error: 'unavailable' });
  expect(JSON.stringify(frames)).not.toContain('private-pair-code');
});
