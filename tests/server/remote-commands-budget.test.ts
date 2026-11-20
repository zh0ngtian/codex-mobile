// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { RemoteCommands } from '../../server/remote/commands.js';
import { RemoteRelay } from '../../server/remote/relay.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';
import type { JsonValue, RpcMessage } from '../../server/remote/envelope.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function until(check: () => boolean, timeout = 2500) { await expect.poll(check, { timeout, interval: 5 }).toBe(true); }
const large = { stdoutBytesCap: 2 * 1024 * 1024, stderrBytesCap: 2 * 1024 * 1024 };

/** 实际WS/RPC运行固定Python；空terminate ACK、RPC拒绝和实际child close分别控制。 */
async function fixture() {
  const directory = await mkdtemp('/tmp/cmc-budget-'); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise<void>(resolve => wss.once('listening', resolve));
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of wss.clients) socket.terminate(); wss.close(() => resolve()); }));
  const children = new Map<string, ChildProcessWithoutNullStreams>(); const frames: RpcMessage[] = [];
  let leaveStdinOpen = false;
  const endings = new Map<string, () => void>(); const executions = new Map<string, string>(); const deadlines = new Map<string, number>(); const uncertainDeadlines: number[] = [];
  let ignoreTerminate = false; let holdEnd = false; let rejectEnd = false; let invalidEnd = false; let sequence = 0; let socket: WebSocket; let streamId = '';
  const send = (message: RpcMessage) => socket.send(JSON.stringify({ type: 'server_message', client_id: 'budget', stream_id: streamId, env_id: 'environment', seq_id: ++sequence, message }));
  const kill = (id: string) => { const child = children.get(id); if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 已退出。 */ } } };
  wss.on('connection', connected => {
    socket = connected; socket.on('error', () => {}); socket.send(JSON.stringify({ type: 'device_key_challenge', nonce: 'test' }));
    socket.on('message', raw => {
      const envelope = JSON.parse(raw.toString()); if (!envelope.message) return;
      streamId = envelope.stream_id; const message = envelope.message as RpcMessage; frames.push(message); const p = (message.params ?? {}) as Record<string, JsonValue>;
      const respond = (value: unknown) => send({ id: message.id!, result: value as JsonValue });
      if (message.method === 'initialize') respond({ codexHome: directory, platformFamily: 'unix', platformOs: process.platform === 'darwin' ? 'macos' : 'linux', userAgent: 'budget-test' });
      else if (message.method === 'command/exec') {
        const id = p.processId as string; executions.set(id, String(message.id)); deadlines.set(id, performance.now() + (p.timeoutMs as number));
        const argv = p.command as string[]; const child = spawn(argv[0]!, argv.slice(1), { cwd: p.cwd as string, stdio: 'pipe', detached: true }); children.set(id, child); child.stdin.on('error', () => {});
        for (const [name, pipe] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) pipe.on('data', (data: Buffer) => send({ method: 'command/exec/outputDelta', params: { processId: id, stream: name, deltaBase64: data.toString('base64'), capReached: false } }));
        child.on('close', code => { children.delete(id); const finish = () => respond({ exitCode: code ?? -1, stdout: '', stderr: '' }); if (holdEnd) endings.set(id, finish); else finish(); });
      } else if (message.method === 'command/exec/write') {
        const child = children.get(p.processId as string); if (child) { child.stdin.write(Buffer.from(p.deltaBase64 as string, 'base64')); if (p.closeStdin && !leaveStdinOpen) child.stdin.end(); } respond({});
      } else if (message.method === 'command/exec/terminate') {
        const id = p.processId as string; if (!ignoreTerminate) kill(id); respond({});
        if (rejectEnd || invalidEnd) uncertainDeadlines.push(deadlines.get(id)!);
        if (rejectEnd) send({ id: executions.get(id)!, error: { code: -32000, message: 'synthetic rejection' } });
        if (invalidEnd) send({ id: executions.get(id)!, result: { exitCode: 0 } });
      } else if (message.id) respond({ alive: true });
    });
  });
  const relay = new RemoteRelay({ clientId: 'budget', authProvider: { async prepareConnection() { return { url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`, headers: {}, async signChallenge() { return { signature: 'test' }; } }; } }, streamPingMs: 10000, nativePingMs: 10000 });
  cleanup.push(() => relay.close()); const session = RemoteRpcSession.fromRemoteStream(relay.createStream({ environmentId: 'environment' })); await until(() => relay.state === 'online'); await session.initialize();
  const adapters: RemoteCommands[] = [];
  cleanup.push(async () => {
    for (const adapter of adapters) await adapter.close();
    holdEnd = false; for (const id of children.keys()) kill(id); await until(() => children.size === 0);
    for (const finish of endings.values()) finish(); endings.clear();
    // 已拒绝/非法的exec不能再提供有效证明，夹具等原期限以免跨测试保留全局许可。
    if (rejectEnd || invalidEnd) { const remaining = Math.max(...uncertainDeadlines) - performance.now(); if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining + 20)); }
    await until(() => pending() === 0); session.close();
  });
  const scope = { managed: { codexHome: '/managed', accountId: 'account', accountUserId: 'member' }, target: { environmentId: 'environment', installationId: 'installation' } };
  const adapter = async () => { const value = await RemoteCommands.create(session, scope); adapters.push(value); return value; };
  const commands = await adapter(); const pending = () => (session as unknown as { pending: Set<unknown> }).pending.size;
  return {
    directory, children, frames, commands, session, pending, adapter, kill, endings,
    ignore() { ignoreTerminate = true; }, normal() { ignoreTerminate = false; }, hold() { holdEnd = true; }, reject() { rejectEnd = true; }, invalid() { invalidEnd = true; },
    release(id: string) { const finish = endings.get(id); endings.delete(id); finish?.(); },
    execs: () => frames.filter(m => m.method === 'command/exec').length,
    holdStdin: () => { leaveStdinOpen = true; },
    terminates: () => frames.filter(m => m.method === 'command/exec/terminate'),
  };
}

async function cancelledAfterDone(f: Awaited<ReturnType<typeof fixture>>, adapter = f.commands, caps = {}, timeoutMs = 1800) {
  const controller = new AbortController(); const before = f.terminates().length;
  const result = adapter.execute({ argv: ['python3', '-c', 'print("owned")'], cwd: f.directory, timeoutMs, ...caps, signal: controller.signal }).catch(error => error);
  await until(() => f.terminates().length === before + 1);
  const id = (f.terminates().at(-1)!.params as Record<string, JsonValue>).processId as string;
  controller.abort(); const error = await result;
  expect(error).toMatchObject({ code: 'cancelled', outcome: 'unknown' }); expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  return { id, error };
}

it('取消后四个实际wrapper仍活且空ACK，跨adapter的第五条零物理发送；迟到真实结束只释放许可', async () => {
  const f = await fixture(); const other = await f.adapter(); f.ignore(); const listenerCount = f.session.listenerCount('notification'); const cancelled = [];
  for (let index = 0; index < 4; index++) cancelled.push(await cancelledAfterDone(f, index % 2 ? other : f.commands));
  expect(f.children.size).toBe(4); const before = f.execs();
  await expect(other.execute({ argv: ['python3', '-c', 'print(1)'], cwd: f.directory, timeoutMs: 150 })).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  expect(f.execs()).toBe(before); expect(f.pending()).toBe(4); expect(f.session.listenerCount('notification')).toBe(listenerCount);
  expect(await f.session.call('budget/alive')).toEqual({ alive: true }); expect(f.session.ready).toBe(true);
  f.kill(cancelled[0]!.id); await until(() => f.pending() === 3); f.normal();
  expect((await other.execute({ argv: ['python3', '-c', 'print("available")'], cwd: f.directory })).stdout.toString()).toBe('available\n');
  expect(cancelled.every(value => value.error.code === 'cancelled')).toBe(true);
  for (const { id } of cancelled) expect(f.terminates().filter(m => (m.params as Record<string, JsonValue>).processId === id)).toHaveLength(1);
});

it('收到完整且校验正确的输入后执行，无需等目标关闭 stdin', async () => {
  const f = await fixture();
  f.holdStdin();
  const result = await f.commands.execute({ argv: ['python3', '-c', 'print("framed")'], cwd: f.directory, timeoutMs: 600 });
  expect(result.stdout.toString()).toBe('framed\n');
  expect(f.terminates()).toHaveLength(1);
});

it('真实包装器输出完成但迟迟不退出时报告退出阶段超时', async () => {
  const f = await fixture();
  f.ignore();
  const pending = f.commands.execute({ argv: ['python3', '-c', 'print("done")'], cwd: f.directory, timeoutMs: 500 });
  const failed = expect(pending).rejects.toMatchObject({ code: 'timeout', stage: 'exit' });
  await until(() => f.terminates().length === 1);
  await failed;
});

it('两个最大捕获的保守内存预留在业务取消后跨adapter保留，实际终结才归还', async () => {
  const f = await fixture(); const other = await f.adapter(); f.ignore();
  const first = await cancelledAfterDone(f, f.commands, large); await cancelledAfterDone(f, other, large); expect(f.children.size).toBe(2); const before = f.execs();
  await expect(other.execute({ argv: ['python3', '-c', 'print(1)'], cwd: f.directory, timeoutMs: 150, ...large })).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  expect(f.execs()).toBe(before); f.kill(first.id); await until(() => f.pending() === 1); f.normal();
  expect((await f.commands.execute({ argv: ['python3', '-c', 'print(1)'], cwd: f.directory, ...large })).exitCode).toBe(0);
});

it.each(['reject', 'invalid'] as const)('%s exec终结响应不释放保守预留，直到原期限且共享RPC仍活', async mode => {
  const f = await fixture(); const other = await f.adapter(); f.ignore(); f[mode]();
  for (const adapter of [f.commands, other]) await expect(adapter.execute({ argv: ['python3', '-c', 'print(1)'], cwd: f.directory, timeoutMs: 700, ...large })).rejects.toMatchObject({ code: mode === 'reject' ? 'capability' : 'protocol', outcome: 'unknown' });
  const before = f.execs(); expect(f.children.size).toBe(2);
  await expect(other.execute({ argv: ['python3', '-c', 'print(1)'], cwd: f.directory, timeoutMs: 150, ...large })).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  expect(f.execs()).toBe(before); expect(await f.session.call('budget/alive')).toEqual({ alive: true });
  await new Promise(resolve => setTimeout(resolve, 750));
  // 旧RPC已拒绝，期限后仍只允许一次新执行；新响应仍按原协议拒绝。
  await expect(other.execute({ argv: ['python3', '-c', 'print(1)'], cwd: f.directory, timeoutMs: 150, ...large })).rejects.toMatchObject({ code: mode === 'reject' ? 'capability' : 'protocol' });
  expect(f.execs()).toBe(before + 1);
});

it('实际child已经关闭但终结证明迟到时仍占许可，收到有效证明后立即释放且不恢复业务成功', async () => {
  const f = await fixture(); f.ignore(); f.hold();
  const first = await cancelledAfterDone(f, f.commands, large); await cancelledAfterDone(f, f.commands, large);
  f.kill(first.id); await until(() => f.endings.has(first.id)); expect(f.pending()).toBe(2); const before = f.execs();
  await expect(f.commands.execute({ argv: ['python3', '-c', 'print(1)'], cwd: f.directory, timeoutMs: 150, ...large })).rejects.toMatchObject({ code: 'capacity' }); expect(f.execs()).toBe(before);
  f.release(first.id); await until(() => f.pending() === 1); expect(first.error.code).toBe('cancelled');
  const controller = new AbortController(); const operation = f.commands.execute({ argv: ['python3', '-c', 'print(1)'], cwd: f.directory, timeoutMs: 800, ...large, signal: controller.signal }).catch(error => error);
  await until(() => f.execs() === before + 1); controller.abort(); expect(await operation).toMatchObject({ code: 'cancelled' });
});

it('没有实际终结证明时只在原绝对期限归还许可、清理exec等待，adapter.close不会提前释放', async () => {
  const f = await fixture(); const other = await f.adapter(); f.ignore();
  await cancelledAfterDone(f, f.commands, large, 550); await cancelledAfterDone(f, f.commands, large, 550); await f.commands.close(); const before = f.execs();
  await expect(other.execute({ argv: ['python3', '-c', 'print(1)'], cwd: f.directory, timeoutMs: 150, ...large })).rejects.toMatchObject({ code: 'capacity' }); expect(f.execs()).toBe(before);
  await until(() => f.pending() === 0); expect(f.children.size).toBe(2); f.normal();
  expect((await other.execute({ argv: ['python3', '-c', 'print("after-deadline")'], cwd: f.directory, ...large })).exitCode).toBe(0);
  expect(f.execs()).toBe(before + 1);
});

it('RPC明确零发送的拒绝立即归还许可与内存，无terminate或等待残留', async () => {
  const f = await fixture(); const actual = f.session.call.bind(f.session); let blocked = true;
  // session本身的请求容量检查给出明确未发送事实，仍走真实RPC实现。
  f.session.call = (...args) => actual(...(blocked && args[0] === 'command/exec' ? [args[0], args[1], { ...args[2], timeoutMs: 0 }] as Parameters<RemoteRpcSession['call']> : args));
  const before = f.execs();
  for (let index = 0; index < 6; index++) await expect(f.commands.execute({ argv: ['python3', '-c', 'print(1)'], cwd: f.directory, timeoutMs: 150, ...large })).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false, outcome: 'not-sent' });
  expect(f.execs()).toBe(before); expect(f.terminates()).toHaveLength(0); expect(f.pending()).toBe(0); blocked = false;
  expect((await f.commands.execute({ argv: ['python3', '-c', 'print(1)'], cwd: f.directory, ...large })).exitCode).toBe(0);
});
