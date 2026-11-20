// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { RemoteRelay } from '../../server/remote/relay.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';
import { RemoteCommands } from '../../server/remote/commands.js';
import { RemoteFiles } from '../../server/remote/files.js';
import { RemoteFileChannel } from '../../server/remote/file-channel.js';
import { withRemoteOperation } from '../../server/remote/operation-guard.js';
import type { JsonValue, RpcMessage } from '../../server/remote/envelope.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function until(check: () => boolean, timeout = 2000) { await expect.poll(check, { timeout, interval: 5 }).toBe(true); }

/** 真实WebSocket Relay/RPC + 实际Python适配器，检查新业务guard没有截断既有精确收尾。 */
async function fixture() {
  const directory = await mkdtemp('/tmp/cmm-cleanup-'); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise<void>(resolve => wss.once('listening', resolve));
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of wss.clients) socket.terminate(); wss.close(() => resolve()); }));
  const children = new Map<string, ChildProcessWithoutNullStreams>(); const frames: RpcMessage[] = []; let sequence = 0; let socket: WebSocket; let streamId = ''; let holdBuffered = false;
  let terminationDelayMs = 0; let terminationAckDelayMs = 0; const terminationTimers = new Set<NodeJS.Timeout>();
  const send = (message: RpcMessage) => socket.send(JSON.stringify({ type: 'server_message', client_id: 'client', stream_id: streamId, env_id: 'environment', seq_id: ++sequence, message }));
  const output = (id: string, name: string, data: Buffer) => send({ method: 'command/exec/outputDelta', params: { processId: id, stream: name, deltaBase64: data.toString('base64'), capReached: false } });
  wss.on('connection', connected => {
    socket = connected; socket.on('error', () => {}); socket.send(JSON.stringify({ type: 'device_key_challenge', nonce: 'test' }));
    socket.on('message', raw => {
      const envelope = JSON.parse(raw.toString()); if (!envelope.message) return;
      streamId = envelope.stream_id; const message = envelope.message as RpcMessage; frames.push(message); const p = (message.params ?? {}) as Record<string, JsonValue>;
      const respond = (value: unknown) => send({ id: message.id!, result: value as JsonValue });
      if (message.method === 'initialize') respond({ codexHome: directory, platformFamily: 'unix', platformOs: process.platform === 'darwin' ? 'macos' : 'linux', userAgent: 'test' });
      else if (message.method === 'command/exec') {
        const id = p.processId as string; const argv = [...p.command as string[]];
        if (holdBuffered && p.streamStdoutStderr === false) argv[4] = 'import time\ntime.sleep(5)\n' + argv[4];
        const child = spawn(argv[0]!, argv.slice(1), { cwd: p.cwd as string, stdio: 'pipe', detached: true }); children.set(id, child); const captured = [Buffer.alloc(0), Buffer.alloc(0)]; child.stdin.on('error', () => {});
        for (const [index, name, pipe] of [[0, 'stdout', child.stdout], [1, 'stderr', child.stderr]] as const) pipe.on('data', (data: Buffer) => { if (p.streamStdoutStderr) output(id, name, data); else captured[index] = Buffer.concat([captured[index]!, data]); });
        child.on('close', code => { children.delete(id); respond({ exitCode: code ?? -1, stdout: captured[0]!.toString(), stderr: captured[1]!.toString() }); });
      } else if (message.method === 'command/exec/write') {
        const child = children.get(p.processId as string); if (child) { if (p.deltaBase64) child.stdin.write(Buffer.from(p.deltaBase64 as string, 'base64')); if (p.closeStdin) child.stdin.end(); } respond({});
      } else if (message.method === 'command/exec/terminate') {
        const finish = () => {
          const child = children.get(p.processId as string); if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 已结束。 */ } }
          if (!terminationAckDelayMs) respond({});
          else { const timer = setTimeout(() => { terminationTimers.delete(timer); respond({}); }, terminationAckDelayMs); terminationTimers.add(timer); }
        };
        if (!terminationDelayMs) finish();
        else { const timer = setTimeout(() => { terminationTimers.delete(timer); finish(); }, terminationDelayMs); terminationTimers.add(timer); }
      } else if (message.id) respond({ alive: true });
    });
  });
  const relay = new RemoteRelay({ clientId: 'client', authProvider: { async prepareConnection() { return { url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`, headers: {}, async signChallenge() { return { signature: 'test' }; } }; } }, streamPingMs: 10000, nativePingMs: 10000 });
  cleanup.push(() => relay.close()); const session = RemoteRpcSession.fromRemoteStream(relay.createStream({ environmentId: 'environment' })); await until(() => relay.state === 'online'); await session.initialize();
  cleanup.push(async () => { for (const timer of terminationTimers) clearTimeout(timer); terminationTimers.clear(); for (const child of children.values()) if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 已结束。 */ } } await until(() => children.size === 0); session.close(); });
  const scope = { managed: { codexHome: '/managed', accountId: 'account', accountUserId: 'member' }, target: { environmentId: 'environment', installationId: 'installation' } };
  const commands = await RemoteCommands.create(session, scope); const files = await RemoteFiles.create(session, scope); cleanup.push(() => commands.close()); cleanup.push(() => files.close());
  return { directory, children, frames, session, commands, files, holdBuffered() { holdBuffered = true; }, delayTermination(ms: number) { terminationDelayMs = ms; }, delayTerminationAck(ms: number) { terminationAckDelayMs = ms; } };
}

it.each(['command', 'read', 'list', 'upload-cleanup'] as const)('父guard失效且同步取消%s时真实Relay仍发送精确清理，共享RPC可继续', async mode => {
  const f = await fixture(); await writeFile(join(f.directory, 'file'), 'hello'); await writeFile(join(f.directory, 'other'), 'other');
  const controller = new AbortController(); let live = true; let started = false;
  const operation = withRemoteOperation(() => { if (!live) throw new Error('expired parent'); }, async () => {
    if (mode === 'upload-cleanup') {
      async function* source(): AsyncGenerator<Uint8Array> { started = true; live = false; throw new Error('producer failed'); yield Buffer.alloc(0); }
      await f.files.upload(join(f.directory, 'new'), source(), { size: 1, sha256: '0'.repeat(64), expectedVersion: null, timeoutMs: 1800 }); return;
    }
    if (mode === 'list') {
      const iterator = f.files.list(f.directory, { pageSize: 1, signal: controller.signal, timeoutMs: 1800 }); await iterator.next(); started = true; live = false; controller.abort(); await iterator.return(undefined); return;
    }
    if (mode === 'read') f.holdBuffered();
    const pending = mode === 'command' ? f.commands.execute({ argv: ['python3', '-c', 'import time; time.sleep(5)'], cwd: f.directory, signal: controller.signal, timeoutMs: 1800 }) : f.files.read(join(f.directory, 'file'), { signal: controller.signal, timeoutMs: 1800 }).next();
    await until(() => f.children.size === 1); started = true; live = false; controller.abort(); await pending;
  }).catch(error => error);
  await operation; expect(started).toBe(true);
  await until(() => f.frames.some(message => message.method === 'command/exec/terminate'));
  await until(() => f.children.size === 0);
  if (mode === 'upload-cleanup') expect((await readdir(f.directory)).some(name => name.startsWith('.codex-mobile-upload-'))).toBe(false);
  const own = new Set(f.frames.filter(x => x.method === 'command/exec').map(x => (x.params as Record<string, JsonValue>).processId));
  for (const message of f.frames.filter(x => x.method === 'command/exec/terminate')) expect(own.has((message.params as Record<string, JsonValue>).processId)).toBe(true);
  expect(await f.session.call('test/alive')).toEqual({ alive: true });
});

it.each(['command', 'command-cancel', 'command-expired', 'file-success'] as const)('正常%s输出后首次terminate调用内同步失效，仍物理发送并观察实际Python退出', async mode => {
  const f = await fixture(); await writeFile(join(f.directory, 'file'), 'hello'); let live = true; let hit = false;
  const controller = new AbortController(); let restoreClock = () => {}; let terminationOptions: unknown;
  const actual = f.session.call.bind(f.session);
  f.session.call = (...args) => {
    if (args[0] === 'command/exec/terminate' && !hit) {
      hit = true; terminationOptions = args[2];
      if (mode === 'command-cancel') controller.abort();
      else if (mode === 'command-expired') { const now = performance.now.bind(performance); const spy = vi.spyOn(performance, 'now').mockImplementation(() => now() + 10000); restoreClock = () => spy.mockRestore(); }
      else live = false;
    }
    return actual(...args);
  };
  const outcome = await withRemoteOperation(() => { if (!live) throw new Error('expired parent'); }, async () => {
    if (mode.startsWith('command')) await f.commands.execute({ argv: ['python3', '-c', 'print("done")'], cwd: f.directory, signal: controller.signal, timeoutMs: 1800 });
    else for await (const _page of f.files.list(f.directory, { pageSize: 1, timeoutMs: 1800 })) { /* 消费至正常收尾。 */ }
  }).then(() => 'completed', error => error.code ?? 'parent-failed');
  restoreClock();
  const alive = await f.session.call('test/alive');
  process.stdout.write(JSON.stringify({ test: 'normal-precise-cleanup-parent-invalidated', mode, outcome, hit, physicalTerminates: f.frames.filter(x => x.method === 'command/exec/terminate').length, liveChildren: [...f.children.keys()], sessionReady: f.session.ready, alive }) + '\n');
  expect(hit).toBe(true); expect(outcome).not.toBe('completed'); expect(f.session.ready).toBe(true); expect(alive).toEqual({ alive: true });
  await until(() => f.frames.some(message => message.method === 'command/exec/terminate'), 500);
  await until(() => f.children.size === 0, 500);
  if (mode.startsWith('command')) { expect(terminationOptions).toEqual({ timeoutMs: expect.any(Number), signal: expect.any(AbortSignal) }); expect((terminationOptions as { signal: AbortSignal }).signal).not.toBe(controller.signal); expect((terminationOptions as { timeoutMs: number }).timeoutMs).toBeGreaterThan(0); expect((terminationOptions as { timeoutMs: number }).timeoutMs).toBeLessThanOrEqual(1800); }
  const own = new Set(f.frames.filter(x => x.method === 'command/exec').map(x => (x.params as Record<string, JsonValue>).processId));
  const terminations = f.frames.filter(x => x.method === 'command/exec/terminate'); expect(terminations).toHaveLength(1);
  expect(own.has((terminations[0]!.params as Record<string, JsonValue>).processId)).toBe(true);
  process.stdout.write(JSON.stringify({ test: 'normal-precise-cleanup-actual-ended', mode, activeTargetProcesses: f.children.size, physicalTerminates: terminations.length }) + '\n');
});

it('FileChannel正常完成在success预算计算前父guard失效仍必须精确收尾', async () => {
  const f = await fixture(); await writeFile(join(f.directory, 'file'), 'hello'); let live = true; let hit = false; let terminationOptions: unknown;
  const call = f.session.call.bind(f.session); f.session.call = (...args) => { if (args[0] === 'command/exec/terminate') terminationOptions = args[2]; return call(...args); };
  const stop = RemoteFileChannel.prototype.stop;
  vi.spyOn(RemoteFileChannel.prototype, 'stop').mockImplementation(function (this: RemoteFileChannel, ...args) {
    if (args[0] === true && !hit) { hit = true; live = false; }
    return stop.apply(this, args);
  });
  const outcome = await withRemoteOperation(() => { if (!live) throw new Error('expired parent'); }, async () => {
    for await (const _page of f.files.list(f.directory, { pageSize: 1, timeoutMs: 1800 })) { /* 消费正常终结。 */ }
  }).then(() => 'completed', error => error.code ?? 'parent-failed');
  const alive = await f.session.call('test/alive');
  process.stdout.write(JSON.stringify({ test: 'file-success-budget-parent-invalidated', outcome, hit, physicalTerminates: f.frames.filter(x => x.method === 'command/exec/terminate').length, liveChildren: [...f.children.keys()], sessionReady: f.session.ready, alive }) + '\n');
  expect(hit).toBe(true); expect(outcome).not.toBe('completed'); expect(f.session.ready).toBe(true); expect(alive).toEqual({ alive: true });
  await until(() => f.frames.some(message => message.method === 'command/exec/terminate'), 500); await until(() => f.children.size === 0, 500);
  expect(f.frames.filter(x => x.method === 'command/exec/terminate')).toHaveLength(1); expect(terminationOptions).toEqual({ timeoutMs: 1000, signal: expect.any(AbortSignal) });
  process.stdout.write(JSON.stringify({ test: 'file-success-budget-actual-ended', activeTargetProcesses: f.children.size }) + '\n');
});

it.each(['command', 'file-success'] as const)('健康%s的真实terminate与实际Python退出延迟超过1s仍沿用原业务剩余预算', async mode => {
  const f = await fixture(); await writeFile(join(f.directory, 'file'), 'hello'); f.delayTermination(1200); const start = performance.now();
  if (mode === 'command') {
    const result = await f.commands.execute({ argv: ['python3', '-c', 'print("done")'], cwd: f.directory, timeoutMs: 3000 }); expect(result.stdout.toString()).toBe('done\n');
  } else {
    const entries: string[] = []; for await (const page of f.files.list(f.directory, { pageSize: 1, timeoutMs: 3000 })) entries.push(...page.map(entry => entry.name)); expect(entries).toContain('file');
  }
  expect(performance.now() - start).toBeGreaterThanOrEqual(1200); await until(() => f.children.size === 0);
  expect(f.frames.filter(x => x.method === 'command/exec/terminate')).toHaveLength(1); expect(await f.session.call('test/alive')).toEqual({ alive: true });
});

it('Command的父guard在DONE后预算计算前失效，只用独立1000ms清理且不交付成功', async () => {
  const f = await fixture(); let live = true; let hit = false; let terminationOptions: unknown;
  const actual = f.session.call.bind(f.session); f.session.call = (...args) => { if (args[0] === 'command/exec/terminate') terminationOptions = args[2]; return actual(...args); };
  f.session.on('notification', message => { const p = message.params as Record<string, JsonValue> | undefined; if (p?.stream === 'stderr' && typeof p.deltaBase64 === 'string' && Buffer.from(p.deltaBase64, 'base64').includes(Buffer.from('CMDC1_DONE:'))) { live = false; hit = true; } });
  const outcome = await withRemoteOperation(() => { if (!live) throw new Error('expired parent'); }, () => f.commands.execute({ argv: ['python3', '-c', 'print("done")'], cwd: f.directory, timeoutMs: 1800 })).then(() => 'completed', error => error.code ?? 'parent-failed');
  const alive = await f.session.call('test/alive'); process.stdout.write(JSON.stringify({ test: 'command-done-before-budget', outcome, hit, physicalTerminates: f.frames.filter(x => x.method === 'command/exec/terminate').length, liveChildren: [...f.children.keys()], sessionReady: f.session.ready, alive }) + '\n');
  expect(hit).toBe(true); expect(outcome).not.toBe('completed'); expect(alive).toEqual({ alive: true });
  await until(() => f.frames.some(message => message.method === 'command/exec/terminate'), 500); await until(() => f.children.size === 0, 500); expect(terminationOptions).toEqual({ timeoutMs: 1000, signal: expect.any(AbortSignal) });
});


it('FileChannel清理等待中父guard恢复仍不得丢弃success预算已发生的失败', async () => {
  const f = await fixture(); await writeFile(join(f.directory, 'file'), 'hello'); f.delayTermination(120);
  let live = true; let hit = false; let recovered = false; let recovery: NodeJS.Timeout | undefined;
  cleanup.push(() => { if (recovery) clearTimeout(recovery); });
  const stop = RemoteFileChannel.prototype.stop;
  vi.spyOn(RemoteFileChannel.prototype, 'stop').mockImplementation(function (this: RemoteFileChannel, ...args) {
    if (args[0] === true && !hit) { hit = true; live = false; recovery = setTimeout(() => { live = true; recovered = true; }, 20); }
    return stop.apply(this, args);
  });
  const outcome = await withRemoteOperation(() => { if (!live) throw new Error('expired parent'); }, async () => {
    for await (const _page of f.files.list(f.directory, { pageSize: 1, timeoutMs: 1800 })) { /* 完整消费至收尾。 */ }
  }).then(() => 'completed', error => error.code ?? 'parent-failed');
  const alive = await f.session.call('test/alive');
  process.stdout.write(JSON.stringify({ test: 'file-success-budget-failure-persists-after-parent-recovery', outcome, hit, recovered, physicalTerminates: f.frames.filter(x => x.method === 'command/exec/terminate').length, activeTargetProcesses: f.children.size, sessionReady: f.session.ready, alive }) + '\n');
  expect(hit).toBe(true); expect(recovered).toBe(true); expect(outcome).not.toBe('completed');
  expect(f.frames.filter(x => x.method === 'command/exec/terminate')).toHaveLength(1); await until(() => f.children.size === 0, 500);
  expect(f.session.ready).toBe(true); expect(alive).toEqual({ alive: true });
});

it.each(['command', 'file-success'] as const)('正常%s已精确终止Python后取消，延迟ACK不能延长失败清理等待', async mode => {
  const f = await fixture(); await writeFile(join(f.directory, 'file'), 'hello'); f.delayTerminationAck(2400);
  const controller = new AbortController();
  const operation = (async () => {
    if (mode === 'command') await f.commands.execute({ argv: ['python3', '-c', 'print("done")'], cwd: f.directory, signal: controller.signal, timeoutMs: 4500 });
    else for await (const _page of f.files.list(f.directory, { pageSize: 1, signal: controller.signal, timeoutMs: 4500 })) { /* 消费至正常收尾。 */ }
  })().then(() => 'completed', error => error.code ?? 'parent-failed');
  await until(() => f.frames.some(message => message.method === 'command/exec/terminate')); await until(() => f.children.size === 0);
  const pending = () => (f.session as unknown as { pending: Set<unknown> }).pending.size;
  const cancelledAt = performance.now(); controller.abort(); const outcome = await operation; const elapsedMs = performance.now() - cancelledAt;
  const alive = await f.session.call('test/alive');
  process.stdout.write(JSON.stringify({ test: 'cancel-during-normal-termination-ack', mode, outcome, elapsedMs, physicalTerminates: f.frames.filter(x => x.method === 'command/exec/terminate').length, activeTargetProcesses: f.children.size, pendingRpc: pending(), sessionReady: f.session.ready, alive }) + '\n');
  expect(pending()).toBe(0); expect(outcome).toBe('cancelled'); expect(elapsedMs).toBeLessThan(1400);
  expect(f.frames.filter(x => x.method === 'command/exec/terminate')).toHaveLength(1); expect(f.children.size).toBe(0);
  expect(f.session.ready).toBe(true); expect(alive).toEqual({ alive: true });
});
