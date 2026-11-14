// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { RemoteStream } from '../../server/remote/relay.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';
import { RemoteCommands, type RemoteCommandScope } from '../../server/remote/commands.js';
import { RemoteModelUploadSource } from '../../server/remote/model-upload-source.js';
import type { JsonValue, RpcMessage } from '../../server/remote/envelope.js';
import type { ModelUploadUsage } from '../../server/model-upload-meter.js';
import { assertRemoteOperation, withRemoteOperation } from '../../server/remote/operation-guard.js';
import { RemoteSendError } from '../../server/remote/relay.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const scope = (): RemoteCommandScope => ({ managed: { codexHome: '/managed/canonical', accountId: 'account', accountUserId: 'member' }, target: { environmentId: 'environment', installationId: 'installation' } });
const usage = (revision = 1, epoch = 'epoch-a'): ModelUploadUsage => ({ epoch, revision, turnId: 'turn-a', lastRequestBytes: revision, turnBytes: revision * 10, requestCount: 1 });
const frame = (value: unknown) => Buffer.from(JSON.stringify(value) + '\n');
const update = (revision = 1, epoch = 'epoch-a', threadId = 'existing') => ({ type: 'usage', threadId, usage: usage(revision, epoch) });
async function until(check: () => boolean, ms = 3000) { await expect.poll(check, { timeout: ms, interval: 5 }).toBe(true); }

/** 只在临时目录执行真实Python；RPC边界保留官方exec、通知及真实子进程终结语义。 */
async function fixture() {
  const directory = await realpath(await mkdtemp('/tmp/cmm-'));
  await chmod(directory, 0o700); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'); const privateDir = join(directory, 'private');
  await mkdir(home, { mode: 0o700 }); await mkdir(privateDir, { mode: 0o700 });
  const meterDir = join(home, 'mobile-model-upload'); await mkdir(meterDir, { mode: 0o700 });
  const socketPath = join(meterDir, 'meter.sock'); const launcher = join(privateDir, 'launcher');
  const config = { codexExecutable: '/target/bin/codex', nodeExecutable: '/target/bin/node', originalAdapter: launcher + '.pre-model-upload', socketPath, upstreamUrl: 'ws://127.0.0.1:49321/rpc?token=synthetic-private-value' };
  const launcherText = () => '#!' + config.nodeExecutable + '\n// Codex Mobile desktop model upload meter; original adapter retained.\nimport("file:///target/npm-dist/server/desktop-model-upload.js").then(async module => {\n  process.exitCode = await module.runDesktopModelUpload(' + JSON.stringify(config) + ');\n}).catch(() => { console.error("桌面模型计量启动失败，请检查安装与配置"); process.exitCode = 1; });\n';
  await writeFile(launcher, launcherText(), { mode: 0o700 });
  const sockets = new Set<Socket>(); let onConnect = (socket: Socket) => { socket.write(frame({ type: 'hello', version: 1, sourceHash: createHash('sha256').update(config.upstreamUrl).digest('hex') })); socket.write(frame(update())); };
  const server = createServer(socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); onConnect(socket); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); }); await chmod(socketPath, 0o600);
  cleanup.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const processes = new Map<string, ChildProcessWithoutNullStreams>(); const frames: RpcMessage[] = []; let sequence = 0;
  let instrumentPython = (source: string) => source;
  let rejectMeterExec = false;
  let transform = (_stream: string, data: Buffer, _id: string): Buffer => data;
  let holdFinal = false; const finals: (() => void)[] = []; let terminate: 'normal' | 'ack-only' | 'reject' = 'normal'; let beforeSend: ((message: RpcMessage) => void) | undefined;
  const respond = (message: RpcMessage, result: unknown) => stream.emit('message', { id: message.id!, result: result as JsonValue }, { seqId: ++sequence });
  const output = (processId: string, name: string, bytes: Buffer) => {
    bytes = transform(name, bytes, processId); if (bytes.length) stream.emit('message', { method: 'command/exec/outputDelta', params: { processId, stream: name, deltaBase64: bytes.toString('base64'), capReached: false } }, { seqId: ++sequence });
  };
  const kill = (child: ChildProcessWithoutNullStreams) => { try { child.kill('SIGKILL'); } catch { /* 已结束。 */ } };
  const stream = new RemoteStream('environment', 'meter-test', async (_stream, message, _control, deadline) => {
    if (!message) return { seqId: 0 }; beforeSend?.(message);
    try { assertRemoteOperation(); } catch { throw new RemoteSendError('controlled guard', false); }
    if (deadline !== undefined && performance.now() >= deadline) throw new RemoteSendError('controlled deadline', false, undefined, 'timeout');
    frames.push(message);
    const p = (message.params ?? {}) as Record<string, JsonValue>;
    if (message.method === 'initialize') queueMicrotask(() => respond(message, { codexHome: home, platformFamily: 'unix', platformOs: process.platform === 'darwin' ? 'macos' : 'linux', userAgent: 'test' }));
    else if (message.method === 'command/exec') {
      const id = p.processId as string; const argv = [...p.command as string[]];
      if (rejectMeterExec && id.startsWith('codex-mobile-meter:')) { queueMicrotask(() => stream.emit('message', { id: message.id!, error: { code: 1, message: 'synthetic-private-value' } }, { seqId: ++sequence })); return { seqId: frames.length }; }
      if (id.startsWith('codex-mobile-meter:')) argv[4] = instrumentPython(argv[4]!);
      const child = spawn(argv[0]!, argv.slice(1), { cwd: p.cwd as string, env: { PATH: process.env.PATH, CODEX_APP_RUNTIME_CLI_PATH: launcher }, stdio: 'pipe' }); processes.set(id, child);
      child.stdin.on('error', () => {}); child.stdout.on('data', (data: Buffer) => output(id, 'stdout', data)); child.stderr.on('data', (data: Buffer) => output(id, 'stderr', data));
      child.on('error', () => respond(message, { exitCode: 127, stdout: '', stderr: 'synthetic-private-value' }));
      child.on('close', code => { processes.delete(id); const final = () => respond(message, { exitCode: code ?? -1, stdout: '', stderr: '' }); if (holdFinal && id.startsWith('codex-mobile-meter:')) finals.push(final); else final(); });
    } else if (message.method === 'command/exec/write') {
      const child = processes.get(p.processId as string); if (child) { if (p.deltaBase64) child.stdin.write(Buffer.from(p.deltaBase64 as string, 'base64')); if (p.closeStdin) child.stdin.end(); } queueMicrotask(() => respond(message, {}));
    } else if (message.method === 'command/exec/terminate') {
      const child = processes.get(p.processId as string); if (child && terminate === 'normal') kill(child);
      queueMicrotask(() => { if (terminate === 'reject') stream.emit('message', { id: message.id!, error: { code: 1, message: 'synthetic-private-value' } }, { seqId: ++sequence }); else respond(message, {}); });
    } else if (message.id) queueMicrotask(() => respond(message, { alive: true }));
    return { seqId: frames.length };
  }, () => {});
  const session = RemoteRpcSession.fromRemoteStream(stream); await session.initialize();
  cleanup.push(async () => { for (const child of processes.values()) kill(child); await until(() => processes.size === 0); session.close(); });
  const commands = await RemoteCommands.create(session, scope()); cleanup.push(() => commands.close());
  return { directory, home, launcher, meterDir, socketPath, config, launcherText, sockets, server, processes, frames, session, commands, stream, output,
    async writeLauncher() { await writeFile(launcher, launcherText(), { mode: 0o700 }); },
    onConnect(fn: typeof onConnect) { onConnect = fn; }, transform(fn: typeof transform) { transform = fn; },
    instrumentPython(fn: typeof instrumentPython) { instrumentPython = fn; },
    rejectMeterExec() { rejectMeterExec = true; },
    holdFinal() { holdFinal = true; }, releaseFinal() { holdFinal = false; for (const fn of finals.splice(0)) fn(); },
    terminate(value: typeof terminate) { terminate = value; }, beforeSend(fn: (message: RpcMessage) => void) { beforeSend = fn; },
    async source(options: { windowMs?: number; signal?: AbortSignal } = {}) { const source = await RemoteModelUploadSource.create(session, commands, options); cleanup.push(() => source.close()); return source; },
  };
}

it('从同一目标官方环境证明来源后提供实际已有usage，未知线程保持null', async () => {
  const f = await fixture(); const source = await f.source();
  await until(() => source.read('existing')?.revision === 1);
  expect(source.read('existing')).toEqual(usage()); expect(source.read('missing')).toBeNull();
  const value = source.read('existing')!; value.turnBytes = 999; expect(source.read('existing')?.turnBytes).toBe(10);
});

it('持续usage按同epoch revision去重、接纳新epoch，remove删除且不伪造零通知', async () => {
  const f = await fixture(); const source = await f.source(); await until(() => source.read('existing') !== null);
  const received: ModelUploadUsage[] = []; const unsubscribe = source.subscribe((_id, value) => received.push(value));
  const send = (value: unknown) => { for (const socket of f.sockets) socket.write(frame(value)); };
  send(update(3)); await until(() => source.read('existing')?.revision === 3);
  send(update(2)); send(update(3)); send(update(1, 'epoch-b')); await until(() => source.read('existing')?.epoch === 'epoch-b');
  expect(received).toEqual([usage(3), usage(1, 'epoch-b')]);
  send({ type: 'remove', threadId: 'existing' }); await until(() => source.read('existing') === null);
  expect(received).toHaveLength(2); unsubscribe(); send(update(2, 'epoch-b')); await until(() => source.read('existing')?.revision === 2); expect(received).toHaveLength(2);
});

it('断线同步清值并拒收迟到通知，重建重新证明来源并保留共享RPC', async () => {
  const f = await fixture(); const source = await f.source({ windowMs: 1000 }); await until(() => source.read('existing') !== null);
  const old = f.frames.filter(x => x.method === 'command/exec').at(-1)!.params as Record<string, JsonValue>;
  f.stream.emit('disconnect', { reason: 'network', mayHaveBeenSent: true });
  expect(source.read('existing')).toBeNull(); f.output(old.processId as string, 'stdout', frame(update(99))); expect(source.read('existing')).toBeNull();
  f.config.upstreamUrl = 'ws://127.0.0.1:49322/rebuilt'; await f.writeLauncher();
  await until(() => source.read('existing') !== null, 4000);
  await source.close(); expect(source.read('existing')).toBeNull(); expect(await f.session.call('test/alive')).toEqual({ alive: true });
  expect(f.session.ready).toBe(true); for (const name of ['notification', 'disconnect', 'close']) expect(f.session.listenerCount(name)).toBe(0);
});

it.each(['launcher-symlink', 'launcher-hardlink', 'launcher-mode', 'launcher-shape', 'launcher-json-duplicate', 'launcher-utf8', 'launcher-too-large', 'ancestor-symlink', 'ancestor-mode', 'home-mode', 'socket-mode', 'socket-symlink', 'wrong-home', 'nonloopback', 'bad-config', 'shebang-mismatch', 'node-whitespace'] as const)('来源证明明确拒绝%s，错误不泄漏配置', async fault => {
  const f = await fixture();
  if (fault === 'launcher-symlink') { await rename(f.launcher, f.launcher + '.real'); await symlink(f.launcher + '.real', f.launcher); }
  if (fault === 'launcher-hardlink') await link(f.launcher, f.launcher + '.hard');
  if (fault === 'launcher-mode') await chmod(f.launcher, 0o744);
  if (fault === 'launcher-shape') await writeFile(f.launcher, f.launcherText() + 'process.exit(0);\n');
  if (fault === 'launcher-json-duplicate') await writeFile(f.launcher, f.launcherText().replace('"upstreamUrl":', '"upstreamUrl":"ws://localhost/duplicate","upstreamUrl":'));
  if (fault === 'launcher-utf8') await writeFile(f.launcher, Buffer.from([255, 10]));
  if (fault === 'launcher-too-large') await writeFile(f.launcher, 'x'.repeat(65537));
  if (fault === 'ancestor-symlink') { const parent = join(f.directory, 'private'); await rename(parent, parent + '.real'); await symlink(parent + '.real', parent); }
  if (fault === 'ancestor-mode') await chmod(f.directory, 0o777);
  if (fault === 'home-mode') await chmod(f.home, 0o755);
  if (fault === 'socket-mode') await chmod(f.socketPath, 0o666);
  if (fault === 'socket-symlink') { await rename(f.socketPath, f.socketPath + '.real'); await symlink(f.socketPath + '.real', f.socketPath); }
  if (fault === 'wrong-home') { f.config.socketPath = join(f.directory, 'elsewhere.sock'); await f.writeLauncher(); }
  if (fault === 'nonloopback') { f.config.upstreamUrl = 'ws://example.invalid/rpc'; await f.writeLauncher(); }
  if (fault === 'bad-config') { await writeFile(f.launcher, f.launcherText().replace('"upstreamUrl":', '"extra":true,"upstreamUrl":')); }
  if (fault === 'shebang-mismatch') await writeFile(f.launcher, f.launcherText().replace('#!/target/bin/node', '#!/other/node'));
  if (fault === 'node-whitespace') { f.config.nodeExecutable += ' invalid'; await f.writeLauncher(); }
  const outcome = await f.source({ windowMs: 800 }).then(() => 'unexpected-success', error => error);
  expect(outcome).toMatchObject({ code: 'capability' }); expect(String(outcome)).not.toContain('synthetic-private-value'); expect(String(outcome)).not.toContain(f.launcher);
});

it.each(['launcher-replace', 'launcher-content', 'socket-replace', 'ancestor-replace', 'private-mode'] as const)('读取期间%s即失效，不再提供旧值', async fault => {
  const f = await fixture(); const source = await f.source({ windowMs: 2000 }); await until(() => source.read('existing') !== null);
  if (fault === 'launcher-replace') { await writeFile(f.launcher + '.new', f.launcherText(), { mode: 0o700 }); await rename(f.launcher + '.new', f.launcher); }
  if (fault === 'launcher-content') await writeFile(f.launcher, f.launcherText().replace('49321', '49323'));
  if (fault === 'socket-replace') { await rename(f.socketPath, f.socketPath + '.old'); await writeFile(f.socketPath, '', { mode: 0o600 }); }
  if (fault === 'ancestor-replace') { await rename(join(f.directory, 'private'), join(f.directory, 'old-private')); await mkdir(join(f.directory, 'private'), { mode: 0o700 }); await f.writeLauncher(); }
  if (fault === 'private-mode') await chmod(f.meterDir, 0o755);
  await until(() => source.read('existing') === null); await source.close();
});

it.each(['hello-hash', 'hello-extra', 'hello-utf8', 'hello-json', 'hello-duplicate', 'hello-overflow', 'hello-truncated'] as const)('hello校验拒绝%s而非exit0成功', async fault => {
  const f = await fixture(); f.onConnect(socket => {
    if (fault === 'hello-hash') socket.write(frame({ type: 'hello', version: 1, sourceHash: '0'.repeat(64) }));
    if (fault === 'hello-extra') socket.write(frame({ type: 'hello', version: 1, sourceHash: createHash('sha256').update(f.config.upstreamUrl).digest('hex'), extra: true }));
    if (fault === 'hello-utf8') socket.write(Buffer.from([255, 10]));
    if (fault === 'hello-json') socket.write('{bad}\n');
    if (fault === 'hello-duplicate') socket.write('{"type":"hello","type":"hello"}\n');
    if (fault === 'hello-overflow') socket.write('x'.repeat(4096) + '\n');
    if (fault === 'hello-truncated') socket.end('{"type":"hello"');
  });
  await expect(f.source({ windowMs: 800 })).rejects.toMatchObject({ code: 'protocol' });
});

it.each(['utf8', 'json', 'extra-field', 'negative', 'unsafe-integer', 'fraction', 'unknown-type', 'overflow', 'truncated'] as const)('既有usage后%s帧使来源失效', async fault => {
  const f = await fixture(); const source = await f.source({ windowMs: 2000 }); await until(() => source.read('existing') !== null);
  let data = frame(update(2));
  if (fault === 'utf8') data = Buffer.from([255, 10]);
  if (fault === 'json') data = Buffer.from('{bad}\n');
  if (fault === 'extra-field') data = frame({ ...update(2), usage: { ...usage(2), extra: true } });
  if (fault === 'negative') data = frame({ ...update(2), usage: { ...usage(2), lastRequestBytes: -1 } });
  if (fault === 'unsafe-integer') data = frame({ ...update(2), usage: { ...usage(2), revision: Number.MAX_SAFE_INTEGER + 1 } });
  if (fault === 'fraction') data = frame({ ...update(2), usage: { ...usage(2), requestCount: 1.5 } });
  if (fault === 'unknown-type') data = frame({ type: 'snapshot-end' });
  if (fault === 'overflow') data = Buffer.from('x'.repeat(4096) + '\n');
  if (fault === 'truncated') { for (const socket of f.sockets) socket.end('{'); } else for (const socket of f.sockets) socket.write(data);
  await until(() => source.read('existing') === null); await source.close();
});

it('权限例外严格只在固定计量脚本，普通命令仍默认且不接受权限入口', async () => {
  const f = await fixture(); const source = await f.source(); await until(() => source.read('existing') !== null); await source.close();
  for (const message of f.frames.filter(x => x.method === 'command/exec')) {
    const p = message.params as Record<string, JsonValue>;
    if ((p.processId as string).startsWith('codex-mobile-meter:')) expect(p.sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: true });
    else expect(p).not.toHaveProperty('sandboxPolicy');
    expect(p).not.toHaveProperty('permissionProfile');
  }
  await expect(f.commands.execute({ argv: ['python3', '-c', 'print(1)'], cwd: f.home, sandboxPolicy: { type: 'readOnly', networkAccess: true } } as never)).rejects.toMatchObject({ code: 'invalid-input' });
});

it('预取消不发送统计命令，运行中取消同步清值并精确终止自身进程', async () => {
  const f = await fixture(); const cancelled = new AbortController(); cancelled.abort();
  await expect(f.source({ signal: cancelled.signal })).rejects.toMatchObject({ code: 'cancelled' });
  expect(f.frames.filter(x => x.method === 'command/exec')).toHaveLength(1);
  const controller = new AbortController(); const source = await f.source({ signal: controller.signal }); await until(() => source.read('existing') !== null); controller.abort();
  expect(source.read('existing')).toBeNull(); await source.close(); await until(() => f.processes.size === 0);
  const own = new Set(f.frames.filter(x => x.method === 'command/exec').map(x => (x.params as Record<string, JsonValue>).processId));
  for (const x of f.frames.filter(x => x.method === 'command/exec/terminate')) expect(own.has((x.params as Record<string, JsonValue>).processId)).toBe(true);
  expect(await f.session.call('test/alive')).toEqual({ alive: true });
});

it.each(['exec', 'write'] as const)('同步取消发生在%s物理发送前时禁止迟到发送，cleanup仍可精确发送', async phase => {
  const f = await fixture(); const controller = new AbortController(); let cancelled = false;
  f.beforeSend(message => { if (!cancelled && message.method === (phase === 'exec' ? 'command/exec' : 'command/exec/write')) { cancelled = true; controller.abort(); } });
  await expect(f.source({ signal: controller.signal, windowMs: 500 })).rejects.toMatchObject({ code: 'cancelled' });
  expect(cancelled).toBe(true);
  expect(f.frames.filter(x => x.method === 'command/exec')).toHaveLength(phase === 'exec' ? 1 : 2);
  expect(f.frames.filter(x => x.method === 'command/exec/write')).toHaveLength(1);
  expect(f.frames.some(x => x.method === 'command/exec/terminate')).toBe(true);
  expect(await f.session.call('test/alive')).toEqual({ alive: true });
});

it('自然窗口以序号/双路摘要及真实exec终结完成，重新证明后恢复', async () => {
  const f = await fixture(); const source = await f.source({ windowMs: 400 }); await until(() => source.read('existing') !== null);
  await until(() => source.read('existing') === null); await until(() => source.read('existing') !== null, 3000);
  const commands = f.frames.filter(x => x.method === 'command/exec').slice(1).map(x => x.params as Record<string, JsonValue>);
  expect(commands).toHaveLength(2); expect((commands[0]!.command as string[])[4]).toBe((commands[1]!.command as string[])[4]); await source.close();
});

it.each(['missing-control', 'bad-control-hash', 'bad-complete-hash', 'truncated-line', 'wrong-sequence', 'unframed-stderr'] as const)('exit0不能掩盖%s，失效且不能继续使用旧值', async fault => {
  const f = await fixture(); let damaged = false;
  f.transform((name, data, id) => {
    if (!id.startsWith('codex-mobile-meter:')) return data;
    if (name === 'stderr') {
      if (fault === 'missing-control') { damaged = true; return Buffer.alloc(0); }
      if (fault === 'bad-control-hash') { damaged = true; return Buffer.from(data.toString().replace(/[a-f0-9]{64}/, '0'.repeat(64))); }
      if (fault === 'unframed-stderr') { damaged = true; return Buffer.from('synthetic-private-value'); }
    }
    if (name === 'stdout' && data.includes(Buffer.from('"kind":"complete"'))) {
      if (fault === 'bad-complete-hash') { damaged = true; return Buffer.from(data.toString().replace(/"sha256":"[a-f0-9]{64}"/, '"sha256":"' + '0'.repeat(64) + '"')); }
      if (fault === 'truncated-line') { damaged = true; return data.subarray(0, data.length - 1); }
      if (fault === 'wrong-sequence') { damaged = true; return Buffer.from(data.toString().replace(/"seq":\d+/, '"seq":9999')); }
    }
    return data;
  });
  const source = await f.source({ windowMs: 500 }); await until(() => source.read('existing') !== null);
  await until(() => damaged && source.read('existing') === null); await source.close();
});

it.each(['ack-only', 'reject'] as const)('%s不证明exec结束，close持有至实际结束或原期限，且无无限捕获', async termination => {
  const f = await fixture(); f.terminate(termination); f.holdFinal();
  const source = await f.source({ windowMs: 650 }); await until(() => source.read('existing') !== null); let closed = false;
  const closing = source.close().then(() => { closed = true; }); expect(source.read('existing')).toBeNull();
  await new Promise(resolve => setTimeout(resolve, 100)); expect(closed).toBe(false);
  await closing; expect(closed).toBe(true); f.releaseFinal();
  expect(await f.session.call('test/alive')).toEqual({ alive: true });
});

it('真实publisher的大快照经固定Python背压与live/remove交错后只保留当前2048项', async () => {
  const f = await fixture();
  for (const socket of f.sockets) socket.destroy(); await new Promise<void>(resolve => f.server.close(() => resolve()));
  const { ModelUploadMeter } = await import('../../server/model-upload-meter.js');
  const { publishDesktopModelUsage } = await import('../../server/model-upload-ipc.js');
  const meter = new ModelUploadMeter(); const id = (i: number) => String(i).padStart(5, '0') + 't'.repeat(240);
  for (let i = 0; i < 2048; i++) meter.begin({ threadId: id(i), turnId: 'v'.repeat(256) })(1);
  const publisher = await publishDesktopModelUsage({ socketPath: f.socketPath, upstreamUrl: f.config.upstreamUrl, meter }); cleanup.push(() => publisher.close());
  const source = await f.source(); let interleaved = false;
  source.subscribe(() => { if (interleaved) return; interleaved = true; for (let i = 2048; i < 2150; i++) meter.begin({ threadId: id(i), turnId: 'turn' })(2); });
  await until(() => source.read(id(2149)) !== null);
  await expect.poll(() => Array.from({ length: 2150 }, (_, i) => source.read(id(i))), { timeout: 3000, interval: 10 }).toEqual(Array.from({ length: 2150 }, (_, i) => meter.read(id(i))));
  expect(source.read(id(0))).toBeNull(); expect(source.read(id(2149))?.turnBytes).toBe(2);
});

it('拒绝不同session绑定及Windows无Unix能力，不创建任何本地fallback', async () => {
  const f = await fixture(); const other = await fixture();
  await expect(RemoteModelUploadSource.create(other.session, f.commands)).rejects.toMatchObject({ code: 'binding' });
  Object.defineProperty(f.commands, 'metadata', { value: { ...f.commands.metadata, platformFamily: 'windows', platformOs: 'windows' } });
  await expect(f.source()).rejects.toMatchObject({ code: 'capability' });
  expect(f.frames.filter(x => x.method === 'command/exec')).toHaveLength(1);
});

it.each(['open-flags', 'fd-uid', 'fd-devino', 'open-replacement', 'connect-replacement'] as const)('真实Python的%s受控竞态不能通过来源证明', async fault => {
  const f = await fixture();
  // 只在测试RPC的子进程边界注入系统调用竞态；其余固定证明/读取源码与真实文件和socket不变。
  f.instrumentPython(source => {
    const path = JSON.stringify(f.launcher); const socket = JSON.stringify(f.socketPath);
    const head = 'import os,socket,types\n';
    if (fault === 'open-flags') return head + '_open=os.open\ndef _checked_open(path,flags,*a,**kw):\n if path==' + path + ':\n  assert flags & os.O_NOFOLLOW and flags & os.O_NONBLOCK\n  raise PermissionError()\n return _open(path,flags,*a,**kw)\nos.open=_checked_open\n' + source;
    if (fault === 'fd-uid' || fault === 'fd-devino') return head + '_fstat=os.fstat\nclass _Changed:\n def __init__(self,info): self.info=info\n def __getattr__(self,key):\n  if key==' + JSON.stringify(fault === 'fd-uid' ? 'st_uid' : 'st_ino') + ': return getattr(self.info,key)+1\n  return getattr(self.info,key)\nos.fstat=lambda fd:_Changed(_fstat(fd))\n' + source;
    if (fault === 'open-replacement') return head + '_open=os.open\ndef _race(path,flags,*a,**kw):\n if path==' + path + ':\n  os.rename(path,path+".previous")\n  with open(path+".previous","rb") as f: data=f.read()\n  with open(path,"wb") as f: f.write(data)\n  os.chmod(path,0o700)\n return _open(path,flags,*a,**kw)\nos.open=_race\n' + source;
    return head + '_connect=socket.socket.connect\ndef _race(client,path):\n value=_connect(client,path)\n if path==' + socket + ':\n  os.rename(path,path+".previous")\n  with open(path,"wb") as f: f.write(b"")\n  os.chmod(path,0o600)\n return value\nsocket.socket.connect=_race\n' + source;
  });
  await expect(f.source({ windowMs: 700 })).rejects.toMatchObject({ code: 'capability' });
});

it('全局最多四个来源，未观察到exec实际结束时空ACK不提前释放容量', async () => {
  const f = await fixture(); f.terminate('ack-only'); f.holdFinal();
  const sources = await Promise.all(Array.from({ length: 4 }, () => f.source({ windowMs: 750 })));
  const closed = sources.map(source => source.close());
  await expect(f.source({ windowMs: 750 })).rejects.toMatchObject({ code: 'capacity' });
  await new Promise(resolve => setTimeout(resolve, 100));
  await expect(f.source({ windowMs: 750 })).rejects.toMatchObject({ code: 'capacity' });
  await Promise.all(closed); f.releaseFinal();
  const recovered = await f.source({ windowMs: 750 }); await until(() => recovered.read('existing') !== null); await recovered.close();
});

it('来源缓存最多2048线程，未收到的线程与被挤出线程均为null', async () => {
  const f = await fixture(); const source = await f.source();
  for (const socket of f.sockets) for (let index = 0; index < 2050; index++) socket.write(frame(update(1, 'epoch-a', 'thread-' + index)));
  await until(() => source.read('thread-2049') !== null);
  expect(source.read('existing')).toBeNull(); expect(source.read('thread-0')).toBeNull(); expect(source.read('thread-1')).toBeNull(); expect(source.read('thread-2')).toEqual(usage()); expect(source.read('thread-2050')).toBeNull();
});

it('同步读取跨过原绝对期限即失效，不依赖计时器先运行', async () => {
  const f = await fixture(); const source = await f.source({ windowMs: 300 }); await until(() => source.read('existing') !== null);
  const end = performance.now() + 350; while (performance.now() < end) { /* 模拟调用者阻塞事件循环。 */ }
  expect(source.read('existing')).toBeNull(); await source.close(); expect(await f.session.call('test/alive')).toEqual({ alive: true });
});

it('声明的原期限贯穿exec、stdin和所有物理发送，超时cleanup只有独立1000ms预算', async () => {
  const f = await fixture(); let originalDeadline: number | undefined; const actual = f.stream.send.bind(f.stream); const budgets: { method: string; deadline?: number }[] = []; const raw: { method: string; deadline?: number }[] = [];
  const call = f.session.call.bind(f.session);
  f.session.call = (method, params, options = {}) => { raw.push({ method, deadline: options.deadline }); if (method === 'command/exec') originalDeadline = options.deadline; return call(method, params, options); };
  f.stream.send = (...args) => { const [message, deadline] = args; if (typeof message.method === 'string') budgets.push({ method: message.method, deadline }); return actual(...args); };
  const source = await f.source({ windowMs: 500 }); await until(() => source.read('existing') !== null); await source.close();
  expect(typeof originalDeadline).toBe('number');
  for (const budget of raw.filter(value => value.method === 'command/exec' || value.method === 'command/exec/write')) expect(budget.deadline).toBe(originalDeadline);
  for (const budget of budgets.filter(value => value.method === 'command/exec' || value.method === 'command/exec/write')) expect(budget.deadline).toBeLessThanOrEqual(originalDeadline!);
  expect(budgets.find(value => value.method === 'command/exec/terminate')?.deadline).toBeUndefined();
});

it('另一个消费者的已失效操作不能通过read取消共享来源，来源自己的期限仍有效', async () => {
  const f = await fixture(); const source = await f.source(); await until(() => source.read('existing') !== null);
  let consumerLive = true; let observed: ModelUploadUsage | null = null;
  await withRemoteOperation(() => { if (!consumerLive) throw new Error('consumer expired'); }, async () => { consumerLive = false; observed = source.read('existing'); }).catch(() => {});
  expect(observed).toEqual(usage()); expect(source.read('existing')).toEqual(usage());
  expect(f.frames.filter(x => x.method === 'command/exec/terminate')).toHaveLength(0); await source.close();
});

it('持续高吞吐仍有8MiB固定输出上限，达到边界清值和精确终止而非无限捕获', async () => {
  const f = await fixture(); const source = await f.source({ windowMs: 8000 }); await until(() => source.read('existing') !== null);
  let decoded = 0;
  f.transform((name, data, id) => { if (name === 'stdout' && id.startsWith('codex-mobile-meter:')) decoded += data.length; return data; });
  const id = 't'.repeat(256); const turnId = 'v'.repeat(256);
  const batch = Buffer.concat(Array.from({ length: 13000 }, (_, i) => frame({ type: 'usage', threadId: id, usage: { ...usage(i + 1), turnId } })));
  for (const socket of f.sockets) socket.write(batch);
  await until(() => source.read(id) !== null);
  await until(() => source.read(id) === null, 6000); expect(decoded).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(f.frames.filter(x => x.method === 'command/exec/terminate').length).toBeGreaterThan(0); await source.close();
}, 10000);

it('订阅者抛错或重入close不能复活来源或影响共享RPC', async () => {
  const f = await fixture(); const source = await f.source(); await until(() => source.read('existing') !== null);
  source.subscribe(() => { throw new Error('subscriber'); }); let closing: Promise<void> | undefined;
  source.subscribe(() => { closing = source.close(); }); for (const socket of f.sockets) socket.write(frame(update(2)));
  await until(() => closing !== undefined); expect(source.read('existing')).toBeNull(); await closing;
  expect(await f.session.call('test/alive')).toEqual({ alive: true });
});

it.each([0, -1, 180001, 1.5, NaN])('拒绝无界或非法windowMs %s而不发送', async windowMs => {
  const f = await fixture(); await expect(f.source({ windowMs })).rejects.toMatchObject({ code: 'capacity' }); expect(f.frames.filter(x => x.method === 'command/exec')).toHaveLength(1);
});

it('官方通知可以合并超过64KiB的多条记录，仍以有界分片逐行验证', async () => {
  const f = await fixture(); const source = await f.source(); await until(() => source.read('existing') !== null);
  let pending = Buffer.alloc(0); let coalesced = false;
  f.transform((name, data, id) => {
    if (name !== 'stdout' || !id.startsWith('codex-mobile-meter:')) return data;
    pending = Buffer.concat([pending, data]); if (pending.length < 100000) return Buffer.alloc(0);
    const result = pending; pending = Buffer.alloc(0); coalesced = true; return result;
  });
  for (const socket of f.sockets) socket.write(Buffer.concat(Array.from({ length: 1500 }, (_, index) => frame(update(index + 2)))));
  await until(() => coalesced && (source.read('existing')?.revision ?? 0) >= 500);
  await source.close();
});

it('官方exec拒绝立即报告能力失败，未证实实际结束的额度仍持有原期限', async () => {
  const f = await fixture(); f.rejectMeterExec(); const start = performance.now();
  await expect(f.source({ windowMs: 700 })).rejects.toMatchObject({ code: 'capability' }); const elapsed = performance.now() - start;
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 750 - elapsed)));
  expect(elapsed).toBeLessThan(300); expect(await f.session.call('test/alive')).toEqual({ alive: true });
});

it('原期限从工厂入口开始，准备绑定同步耗尽时统计exec零发送', async () => {
  const f = await fixture(); const actual = f.commands.fileTransportBinding.bind(f.commands);
  f.commands.fileTransportBinding = (...args) => { const end = performance.now() + 160; while (performance.now() < end) { /* 模拟同步准备。 */ } return actual(...args); };
  await expect(f.source({ windowMs: 100 })).rejects.toMatchObject({ code: 'timeout' });
  expect(f.frames.filter(x => x.method === 'command/exec')).toHaveLength(1);
});

it.each([
  'ws://@127.0.0.1:49321/rpc?token=synthetic',
  'ws://:@127.0.0.1:49321/rpc',
  'ws://user@127.0.0.1:49321/rpc',
  'ws://user:@127.0.0.1:49321/rpc',
  'ws://:password@127.0.0.1:49321/rpc',
  'ws://user:password@127.0.0.1:49321/rpc',
  'ws://127.0.0.1:49321/rpc#',
  'ws://127.0.0.1:49321/rpc#fragment',
  'ws://127.0.0.1:49321/rpc?encoded=%23#',
])('来源URL禁止显式空或非空userinfo及任何fragment分隔符 %s', async url => {
  const f = await fixture(); f.config.upstreamUrl = url; await f.writeLauncher();
  await expect(f.source({ windowMs: 700 })).rejects.toMatchObject({ code: 'capability' });
});

it('合法query保持原样参与来源SHA，编码的井号和query内at符号不当作userinfo或fragment', async () => {
  const f = await fixture(); f.config.upstreamUrl = 'ws://127.0.0.1:49321/rpc?token=a%40b&hash=%23&raw=@&case=%2f'; await f.writeLauncher();
  const source = await f.source(); await until(() => source.read('existing') !== null); expect(source.read('existing')).toEqual(usage());
});
