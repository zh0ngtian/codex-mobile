// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { ModelUploadMeter } from '../../server/model-upload-meter.js';
import { publishDesktopModelUsage } from '../../server/model-upload-ipc.js';
import { RemoteCommands } from '../../server/remote/commands.js';
import { RemoteModelUploadSource } from '../../server/remote/model-upload-source.js';
import { RemoteRelay } from '../../server/remote/relay.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';
import type { JsonValue, RpcMessage } from '../../server/remote/envelope.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function until(check: () => boolean) { await expect.poll(check, { timeout: 2500, interval: 5 }).toBe(true); }

/** 只读临时目标，真实WS/RPC、固定Python与产品Unix publisher；不访问官方或现役配置。 */
async function fixture(mode = 0o755) {
  const directory = await realpath(await mkdtemp('/tmp/cmh-')); await chmod(directory, 0o700);
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'); const privateDir = join(directory, 'private');
  await mkdir(home); await chmod(home, mode); await mkdir(privateDir, { mode: 0o700 });
  const launcher = join(privateDir, 'launcher'); const meterDir = join(home, 'mobile-model-upload'); const socketPath = join(meterDir, 'meter.sock');
  const config = { codexExecutable: '/target/bin/codex', nodeExecutable: '/target/bin/node', originalAdapter: launcher + '.pre-model-upload', socketPath, upstreamUrl: 'ws://127.0.0.1:49321/rpc?token=synthetic-only' };
  await writeFile(launcher, '#!' + config.nodeExecutable + '\n// Codex Mobile desktop model upload meter; original adapter retained.\nimport("file:///target/npm-dist/server/desktop-model-upload.js").then(async module => {\n  process.exitCode = await module.runDesktopModelUpload(' + JSON.stringify(config) + ');\n}).catch(() => { console.error("桌面模型计量启动失败，请检查安装与配置"); process.exitCode = 1; });\n', { mode: 0o700 });
  const meter = new ModelUploadMeter(); const count = meter.begin({ threadId: 'home-thread', turnId: 'turn' }); count(7);
  const publisher = await publishDesktopModelUsage({ socketPath, upstreamUrl: config.upstreamUrl, meter }); cleanup.push(() => publisher.close());
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise<void>(resolve => wss.once('listening', resolve));
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of wss.clients) socket.terminate(); wss.close(() => resolve()); }));
  const children = new Map<string, ChildProcessWithoutNullStreams>(); const frames: RpcMessage[] = [];
  let socket: WebSocket; let streamId = ''; let sequence = 0; let instrument = (source: string) => source;
  const send = (message: RpcMessage) => socket.send(JSON.stringify({ type: 'server_message', client_id: 'home-test', stream_id: streamId, env_id: 'environment', seq_id: ++sequence, message }));
  const kill = (child: ChildProcessWithoutNullStreams) => { try { child.kill('SIGKILL'); } catch { /* 已结束。 */ } };
  wss.on('connection', connected => {
    socket = connected; socket.on('error', () => {}); socket.send(JSON.stringify({ type: 'device_key_challenge', nonce: 'synthetic' }));
    socket.on('message', raw => {
      const envelope = JSON.parse(raw.toString()); if (!envelope.message) return;
      streamId = envelope.stream_id; const message = envelope.message as RpcMessage; frames.push(message);
      const p = (message.params ?? {}) as Record<string, JsonValue>; const respond = (result: unknown) => send({ id: message.id!, result: result as JsonValue });
      if (message.method === 'initialize') respond({ codexHome: home, platformFamily: 'unix', platformOs: process.platform === 'darwin' ? 'macos' : 'linux', userAgent: 'synthetic-home' });
      else if (message.method === 'command/exec') {
        const id = p.processId as string; const argv = [...p.command as string[]];
        if (id.startsWith('codex-mobile-meter:')) argv[4] = instrument(argv[4]!);
        const child = spawn(argv[0]!, argv.slice(1), { cwd: p.cwd as string, env: { PATH: process.env.PATH, CODEX_APP_RUNTIME_CLI_PATH: launcher }, stdio: 'pipe' }); children.set(id, child); child.stdin.on('error', () => {});
        for (const [name, pipe] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) pipe.on('data', (data: Buffer) => send({ method: 'command/exec/outputDelta', params: { processId: id, stream: name, deltaBase64: data.toString('base64'), capReached: false } }));
        child.on('close', code => { children.delete(id); respond({ exitCode: code ?? -1, stdout: '', stderr: '' }); });
      } else if (message.method === 'command/exec/write') {
        const child = children.get(p.processId as string); if (child) { if (p.deltaBase64) child.stdin.write(Buffer.from(p.deltaBase64 as string, 'base64')); if (p.closeStdin) child.stdin.end(); } respond({});
      } else if (message.method === 'command/exec/terminate') { const child = children.get(p.processId as string); if (child) kill(child); respond({}); }
      else if (message.id) respond({ alive: true });
    });
  });
  const relay = new RemoteRelay({ clientId: 'home-test', authProvider: { async prepareConnection() { return { url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`, headers: {}, async signChallenge() { return { signature: 'synthetic' }; } }; } }, streamPingMs: 10000, nativePingMs: 10000 });
  cleanup.push(() => relay.close()); const session = RemoteRpcSession.fromRemoteStream(relay.createStream({ environmentId: 'environment' })); await until(() => relay.state === 'online'); await session.initialize();
  const pending = () => (session as unknown as { pending: Set<unknown> }).pending.size;
  cleanup.push(async () => { for (const child of children.values()) kill(child); await until(() => children.size === 0 && pending() === 0); session.close(); });
  const commands = await RemoteCommands.create(session, { managed: { codexHome: '/managed', accountId: 'account', accountUserId: 'member' }, target: { environmentId: 'environment', installationId: 'installation' } }); cleanup.push(() => commands.close());
  return { directory, home, privateDir, launcher, meterDir, socketPath, meter, count, frames, children, session,
    instrumentPython(fn: typeof instrument) { instrument = fn; },
    async source() { const source = await RemoteModelUploadSource.create(session, commands, { windowMs: 2000 }); cleanup.push(() => source.close()); return source; },
  };
}

it.each([{ label: '0700', mode: 0o700 }, { label: '0755', mode: 0o755 }])('$label home可证明来源并读取真实既有和持续usage', async ({ mode }) => {
  const f = await fixture(mode); const info = await lstat(f.home); expect(info.uid).toBe(process.getuid!()); expect(info.mode & 0o777).toBe(mode);
  const source = await f.source(); await until(() => source.read('home-thread')?.turnBytes === 7);
  expect(source.read('home-thread')).toEqual(f.meter.read('home-thread')); expect(source.read('unknown')).toBeNull();
  f.count(11); await until(() => source.read('home-thread')?.turnBytes === 18);
  expect(source.read('home-thread')).toEqual(f.meter.read('home-thread')); expect(await f.session.call('home/alive')).toEqual({ alive: true });
});

it.each([{ label: '0775', mode: 0o775 }, { label: '0777', mode: 0o777 }])('$label home仍明确拒绝', async ({ mode }) => {
  const f = await fixture(mode); expect((await lstat(f.home)).mode & 0o777).toBe(mode);
  await expect(f.source()).rejects.toMatchObject({ code: 'capability' }); expect(await f.session.call('home/alive')).toEqual({ alive: true });
});

it('home为symlink时即使真实目录0755也拒绝', async () => {
  const f = await fixture(); await rename(f.home, f.home + '.real'); await symlink(f.home + '.real', f.home);
  expect((await lstat(f.home)).isSymbolicLink()).toBe(true); await expect(f.source()).rejects.toMatchObject({ code: 'capability' });
});

it('受控lstat错误owner分支拒绝（并非真实chown覆盖）', async () => {
  const f = await fixture(); expect((await lstat(f.home)).uid).toBe(process.getuid!());
  // 无需提升权限或chown；仅在这个负例中改变Python观察到的home uid，底层文件仍是当前uid。
  f.instrumentPython(source => 'import os\n_home_lstat=os.lstat\nclass _OtherOwner:\n    def __init__(self,info): self.info=info\n    def __getattr__(self,key): return os.getuid()+1 if key=="st_uid" else getattr(self.info,key)\nos.lstat=lambda path: _OtherOwner(_home_lstat(path)) if os.fspath(path)==' + JSON.stringify(f.home) + ' else _home_lstat(path)\n' + source);
  await expect(f.source()).rejects.toMatchObject({ code: 'capability' });
});

it.each(['launcher-directory', 'launcher', 'meter-directory', 'socket'] as const)('0755 home不会放宽%s私有权限', async fault => {
  const f = await fixture(); const path = { 'launcher-directory': f.privateDir, launcher: f.launcher, 'meter-directory': f.meterDir, socket: f.socketPath }[fault];
  await chmod(path, fault === 'socket' ? 0o644 : 0o755); await expect(f.source()).rejects.toMatchObject({ code: 'capability' });
});

it.each(['group-write', 'world-write', 'trusted-mode-change', 'inode-replace', 'symlink', 'launcher-mode', 'meter-mode', 'socket-mode'] as const)('来源建立后%s立即失效且后续真实usage不复活旧值', async fault => {
  const f = await fixture(fault === 'trusted-mode-change' ? 0o700 : 0o755); const source = await f.source(); await until(() => source.read('home-thread')?.turnBytes === 7);
  const previous = await lstat(f.home);
  if (fault === 'group-write') await chmod(f.home, 0o775);
  if (fault === 'world-write') await chmod(f.home, 0o777);
  if (fault === 'trusted-mode-change') await chmod(f.home, 0o755);
  if (fault === 'inode-replace') {
    const socket = await lstat(f.socketPath); await rename(f.home, f.home + '.old'); await mkdir(f.home, { mode: 0o755 });
    await rename(join(f.home + '.old', 'mobile-model-upload'), f.meterDir);
    expect((await lstat(f.home)).ino).not.toBe(previous.ino); expect((await lstat(f.socketPath)).ino).toBe(socket.ino);
  }
  if (fault === 'symlink') { await rename(f.home, f.home + '.real'); await symlink(f.home + '.real', f.home); }
  if (fault === 'launcher-mode') await chmod(f.launcher, 0o755);
  if (fault === 'meter-mode') await chmod(f.meterDir, 0o755);
  if (fault === 'socket-mode') await chmod(f.socketPath, 0o644);
  await until(() => source.read('home-thread') === null); f.count(11);
  expect(await f.session.call('home/alive')).toEqual({ alive: true }); expect(source.read('home-thread')).toBeNull(); await source.close();
});
