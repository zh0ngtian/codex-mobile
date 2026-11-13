// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, readdir, readFile, rm, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
const exec = promisify(execFile);
let fixture: string;
beforeAll(async () => {
  fixture = await mkdtemp(resolve('.remote-index-fixture-'));
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.npm.json', '--outDir', join(fixture, 'npm-dist/server')], { env: { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage' } });
  await cp('bin', join(fixture, 'bin'), { recursive: true });
  await cp('package.json', join(fixture, 'package.json'));
}, 30000);
afterAll(async () => {
  if (fixture) {
    await rm(fixture, { recursive: true, force: true });
  }
});
async function until(check: () => Promise<boolean>, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() > deadline) {
      throw new Error('等待隔离进程超时');
    }
    await new Promise(r => setTimeout(r, 20));
  }
}
async function exit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>(r => child.once('exit', () => r()));
}
it('真实入口只启一个Runtime，未授权Local仍通，CLI证明实际端口；SIGTERM/SIGKILL回收', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'rindex-'));
  const remote = join(root, 'r');
  const home = join(root, 'c');
  await mkdir(home);
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(r => upstream.once('listening', r));
  let upstreamMessages = 0;
  let connections = 0;
  upstream.on('connection', socket => {
    connections++;
    socket.on('message', raw => {
      upstreamMessages++;
      const m = JSON.parse(raw.toString());
      socket.send(JSON.stringify({ id: m.id, result: { local: true } }));
    });
  });
  const env = { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage', HOST: '127.0.0.1', PORT: '0', CODEX_MOBILE_TOKEN: 'isolated-token', CODEX_APP_SERVER_MODE: 'external', CODEX_APP_SERVER_URL: `ws://127.0.0.1:${(upstream.address() as any).port}`, CODEX_HOME: home, CODEX_MOBILE_REMOTE_DIR: remote, CODEX_MOBILE_UPLOAD_DIR: join(root, 'u'), CODEX_MOBILE_RUNTIME_FILE: join(root, 'runtime.json'), CODEX_MOBILE_SERVE_STATIC: 'false' };
  const marker = join(root, 'actual-runtime-starts');
  const observer = join(fixture, 'runtime-start-observer.mjs');
  const { pathToFileURL } = await import('node:url');
  await writeFile(observer, `import {appendFileSync} from 'node:fs'; import {RemoteRuntime} from ${JSON.stringify(pathToFileURL(join(fixture, 'npm-dist/server/remote/runtime.js')).href)};const start=RemoteRuntime.prototype.start;RemoteRuntime.prototype.start=function(){appendFileSync(${JSON.stringify(marker)},process.pid+'\\n');return start.call(this);};`);
  const children: ChildProcess[] = [];
  function start() {
    const c = spawn(process.execPath, ['--import', observer, join(fixture, 'npm-dist/server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(c);
    let out = '';
    c.stdout!.on('data', b => out += b);
    c.stderr!.on('data', b => out += b);
    return { child: c, out: () => out };
  }
  const cli = (...args: string[]) => exec(process.execPath, [join(fixture, 'bin/codex-mobile.mjs'), 'remote', ...args], { env });
  try {
    const first = start();
    await until(async () => first.out().includes('Codex Mobile Web:'));
    const port = Number(/http:\/\/127.0.0.1:(\d+)/.exec(first.out())![1]);
    const queried = JSON.parse((await cli('status')).stdout);
    expect(queried).toEqual({ state: 'unconfigured', pendingResume: [], targets: [] });
    expect(connections).toBe(0);
    expect(upstreamMessages).toBe(0);
    const exported = (await cli('url', '--plain')).stdout.trim();
    expect(exported).toContain(`:${port}/?token=isolated-token`);
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws?token=isolated-token`);
    await new Promise<void>(r => client.once('open', r));
    const response = new Promise<any>(r => client.once('message', b => r(JSON.parse(b.toString()))));
    client.send(JSON.stringify({ id: 1, method: 'thread/list', params: {} }));
    expect(await response).toEqual({ id: 1, result: { local: true } });
    client.close();
    const second = start();
    await exit(second.child);
    expect(second.child.exitCode).toBe(1);
    expect(second.out()).not.toContain('Codex Mobile Web:');
    expect((await readFile(marker, 'utf8')).trim().split('\n')).toHaveLength(1);
    const names = await readdir(remote);
    expect(names).not.toContain('active-identity.json');
    expect(names).not.toContain('device-key.json');
    first.child.kill('SIGTERM');
    await exit(first.child);
    expect(first.child.exitCode).toBe(0);
    expect(await readdir(remote)).not.toContain('admin.sock');
    const killed = start();
    await until(async () => killed.out().includes('Codex Mobile Web:'));
    killed.child.kill('SIGKILL');
    await exit(killed.child);
    const recovered = start();
    await until(async () => recovered.out().includes('Codex Mobile Web:'));
    expect(JSON.parse((await cli('status')).stdout).state).toBe('unconfigured');
    expect((await readFile(marker, 'utf8')).trim().split('\n')).toHaveLength(3);
    recovered.child.kill('SIGTERM');
    await exit(recovered.child);
  }
  finally {
    for (const c of children) {
      if (c.exitCode === null && c.signalCode === null) {
        c.kill('SIGKILL');
      }
    }
    for (const s of upstream.clients) {
      s.terminate();
    }
    await new Promise<void>(r => upstream.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
it('已配置Remote的真实canonical初始化超时仍保留Local和私有管理用于显式修复', async () => {
  const { PrivateStore } = await import('../../server/remote/private-store.js');
  const { RemoteIdentityRegistry } = await import('../../server/remote/identity-registry.js');
  const { RemoteRuntimeStateStore } = await import('../../server/remote/runtime-state.js');
  const { deviceIdentityHash } = await import('../../server/remote/auth-protocol.js');
  const { generateKeyPairSync } = await import('node:crypto');
  const { pathToFileURL } = await import('node:url');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'rfault-'));
  const remote = join(root, 'r');
  const home = join(root, 'c');
  await mkdir(home);
  const store = new PrivateStore(remote);
  const registry = new RemoteIdentityRegistry(store);
  const candidate = await registry.beginCandidate();
  const managed = { codexHome: home, accountId: 'synthetic-workspace', accountUserId: 'synthetic-account-user', userId: 'synthetic-user' };
  const local = { environmentId: 'synthetic-env', installationId: 'synthetic-install' };
  const identity = { keyId: 'synthetic-key', algorithm: 'ecdsa_p256_sha256' as const, protectionClass: 'hardware_secure_enclave' as const, publicKeySpkiDerBase64: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const own = { clientId: 'synthetic-client', accountId: managed.accountId, accountUserId: managed.userId, managedAccountUserId: managed.accountUserId, identityHash: deviceIdentityHash(identity) };
  const binding = { version: 1 as const, managed, enrollment: own, local, targets: [local] };
  await candidate.store.createJson('device-key.json', { keyId: identity.keyId, sealedKeyBase64: 'c3ludGhldGlj' });
  await candidate.store.createJson('enrollment.json', { version: 1, ...own, identity });
  await candidate.store.createJson('controller-binding.json', binding);
  await new RemoteRuntimeStateStore(candidate.store, candidate.generation, managed).write({ version: 1, generation: candidate.generation, managed, paused: false, reason: 'reauthorization', pending: [] });
  await registry.activate(candidate, binding);
  const loader = join(fixture, 'fault-start-loader.mjs');
  await writeFile(loader, `import {RemoteRuntime} from ${JSON.stringify(pathToFileURL(join(fixture, 'npm-dist/server/remote/runtime.js')).href)}; const start=RemoteRuntime.prototype.start; RemoteRuntime.prototype.start=function(){this.timeout=80;this.lifecycle.timeout=80;this.cleanupTimeout=20;return start.call(this).catch(error=>{console.log('REMOTE_START_REJECTED');throw error;});};`);
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => upstream.once('listening', resolve));
  const methods: string[] = [];
  upstream.on('connection', socket => socket.on('message', raw => {
    const value = JSON.parse(raw.toString());
    methods.push(value.method);
    if (value.method !== 'initialize') {
      socket.send(JSON.stringify({ id: value.id, result: { local: true } }));
    }
  }));
  const env = { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage', HOST: '127.0.0.1', PORT: '0', CODEX_MOBILE_TOKEN: 'isolated-token', CODEX_APP_SERVER_MODE: 'external', CODEX_APP_SERVER_URL: `ws://127.0.0.1:${(upstream.address() as any).port}`, CODEX_HOME: home, CODEX_MOBILE_REMOTE_DIR: remote, CODEX_MOBILE_UPLOAD_DIR: join(root, 'u'), CODEX_MOBILE_RUNTIME_FILE: join(root, 'runtime.json'), CODEX_MOBILE_SERVE_STATIC: 'false' };
  const child = spawn(process.execPath, ['--import', loader, join(fixture, 'npm-dist/server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout!.on('data', b => out += b);
  child.stderr!.on('data', b => out += b);
  try {
    await until(async () => out.includes('Codex Mobile Web:') || child.exitCode !== null);
    expect(out).toContain('REMOTE_START_REJECTED');
    expect(out).toContain('Codex Mobile Web:');
    const queried = JSON.parse((await exec(process.execPath, [join(fixture, 'bin/codex-mobile.mjs'), 'remote', 'status'], { env })).stdout);
    expect(queried.state).toBe('fault');
    expect(queried.reason).toBe('timeout');
    expect(methods).toEqual(['initialize']);
    const port = Number(/http:\/\/127.0.0.1:(\d+)/.exec(out)![1]);
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws?token=isolated-token`);
    await new Promise<void>(r => client.once('open', r));
    const response = new Promise<any>(r => client.once('message', b => r(JSON.parse(b.toString()))));
    client.send(JSON.stringify({ id: 2, method: 'thread/list', params: {} }));
    expect(await response).toEqual({ id: 2, result: { local: true } });
    client.close();
    child.kill('SIGTERM');
    await exit(child);
    expect(child.exitCode).toBe(0);
  }
  finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exit(child);
    }
    for (const socket of upstream.clients) {
      socket.terminate();
    }
    await new Promise<void>(r => upstream.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
it('真实CLI长交互SIGINT退出并及时取消运行实例操作', async () => {
  const { publishRemoteAdmin } = await import('../../server/remote/admin.js');
  const { chmod } = await import('node:fs/promises');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'rcancel-'));
  await chmod(root, 0o700);
  let entered!: () => void;
  let aborted = false;
  const started = new Promise<void>(resolve => entered = resolve);
  const runtime = { login: (signal: AbortSignal) => {
      entered();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('private-auth-url'));
      }));
    } } as any;
  const admin = await publishRemoteAdmin({ directory: root, runtime, access: () => ({ host: 'localhost', port: 1, token: 'x' }) });
  const child = spawn(process.execPath, [join(fixture, 'bin/codex-mobile.mjs'), 'remote', 'login', '--root', root], { env: { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr!.on('data', b => output += b);
  try {
    await started;
    child.kill('SIGINT');
    await exit(child);
    expect(child.exitCode).toBe(1);
    expect(output).toContain('已取消');
    expect(output).not.toContain('private-auth-url');
    await until(async () => aborted, 1000);
  }
  finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exit(child);
    }
    await admin.settled();
    await rm(root, { recursive: true, force: true });
  }
}, 5000);
it('无Unix用户能力时保留Local入口且remote CLI明确拒绝', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'rlocal-'));
  const loader = join(fixture, 'no-getuid.mjs');
  await writeFile(loader, "Object.defineProperty(process, 'getuid', {value:undefined});");
  const home = join(root, 'c');
  await mkdir(home);
  const remote = join(root, 'r');
  const env = { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage', HOST: '127.0.0.1', PORT: '0', CODEX_MOBILE_TOKEN: 'isolated-token', CODEX_APP_SERVER_MODE: 'external', CODEX_APP_SERVER_URL: 'ws://127.0.0.1:1', CODEX_HOME: home, CODEX_MOBILE_REMOTE_DIR: remote, CODEX_MOBILE_UPLOAD_DIR: join(root, 'u'), CODEX_MOBILE_RUNTIME_FILE: join(root, 'runtime.json'), CODEX_MOBILE_SERVE_STATIC: 'false' };
  const child = spawn(process.execPath, ['--import', loader, join(fixture, 'npm-dist/server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout!.on('data', b => output += b);
  child.stderr!.on('data', b => output += b);
  try {
    await until(async () => output.includes('Codex Mobile Web:'));
    expect(await readdir(root)).not.toContain('r');
    const cli = spawn(process.execPath, ['--import', loader, join(fixture, 'bin/codex-mobile.mjs'), 'remote', 'status'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    cli.stderr!.on('data', b => error += b);
    await exit(cli);
    expect(cli.exitCode).toBe(1);
    expect(error).toContain('当前平台不支持');
    child.kill('SIGTERM');
    await exit(child);
    expect(child.exitCode).toBe(0);
  }
  finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exit(child);
    }
    await rm(root, { recursive: true, force: true });
  }
}, 5000);
it.each(['config', 'app', 'exited'] as const)('managed %s阶段停止必须终止并等待自己创建的真实子进程', async (stage) => {
  const { chmod } = await import('node:fs/promises');
  const { createServer } = await import('node:net');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'rmanaged-'));
  const fakeBin = join(root, 'bin');
  await mkdir(fakeBin);
  const marker = join(root, 'pids');
  const executable = join(fakeBin, 'codex');
  await writeFile(executable, `#!${process.execPath}
const {appendFileSync}=require('node:fs'); const {createInterface}=require('node:readline'); const config=process.argv.includes('stdio://'); appendFileSync(${JSON.stringify(marker)},(config?'config':'app')+':'+process.pid+'\\n'); const hold=${JSON.stringify(stage)}; if(!config&&hold==='exited'){const port=Number(new URL(process.argv[process.argv.indexOf('--listen')+1]).port);require('node:http').createServer((_req,res)=>res.end('ready')).listen(port,'127.0.0.1');}else if(!config||hold==='config'){process.on('SIGTERM',()=>{});process.stdin.resume();setInterval(()=>{},1000);}else{const lines=createInterface({input:process.stdin});lines.on('line',line=>{const v=JSON.parse(line);if(v.id)process.stdout.write(JSON.stringify({id:v.id,result:v.method==='config/read'?{config:{}}:{}})+'\\n');});}`);
  await chmod(executable, 0o700);
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as any).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const home = join(root, 'home');
  await mkdir(home);
  const env = { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage', PATH: `${fakeBin}:${process.env.PATH}`, HOST: '127.0.0.1', PORT: '0', CODEX_MOBILE_TOKEN: 'isolated-token', CODEX_APP_SERVER_MODE: 'managed', CODEX_APP_SERVER_PORT: String(port), CODEX_HOME: home, CODEX_MOBILE_REMOTE_DIR: join(root, 'remote'), CODEX_MOBILE_UPLOAD_DIR: join(root, 'u'), CODEX_MOBILE_RUNTIME_FILE: join(root, 'runtime.json'), CODEX_MOBILE_SERVE_STATIC: 'false' };
  const child = spawn(process.execPath, [join(fixture, 'npm-dist/server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout!.on('data', b => output += b);
  const pids = async () => (await readFile(marker, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => Number(line.split(':')[1]));
  try {
    await until(async () => (await readFile(marker, 'utf8').catch(() => '')).includes(`${stage === 'config' ? 'config' : 'app'}:`));
    if (stage === 'app') {
      const count = (await pids()).length;
      const second = spawn(process.execPath, [join(fixture, 'npm-dist/server/index.js')], { env, stdio: 'ignore' });
      await exit(second);
      expect(second.exitCode).toBe(1);
      expect((await pids()).length).toBe(count);
    }
    if (stage === 'exited') {
      await until(async () => output.includes('Codex Mobile Web:'));
      process.kill((await pids()).at(-1)!, 'SIGKILL');
    }
    else {
      child.kill('SIGTERM');
    }
    await exit(child);
    for (const pid of await pids()) {
      let alive = true;
      try {
        process.kill(pid, 0);
      }
      catch (error) {
        alive = (error as NodeJS.ErrnoException).code !== 'ESRCH';
      }
      expect(alive).toBe(false);
    }
    expect(child.exitCode).toBe(stage === 'exited' ? 1 : 0);
    expect(await readdir(join(root, 'remote'))).not.toContain('.init-gateway-owner.lock');
  }
  finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exit(child);
    }
    for (const pid of await pids()) {
      try {
        process.kill(pid, 'SIGKILL');
      }
      catch {
      }
    }
    await rm(root, { recursive: true, force: true });
  }
}, 10000);
