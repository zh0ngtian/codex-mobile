// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { RemoteRelay } from '../../server/remote/relay.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';
import { RemoteCommands } from '../../server/remote/commands.js';
import { RemoteFiles } from '../../server/remote/files.js';
import { withRemoteOperation } from '../../server/remote/operation-guard.js';
import type { JsonValue, RpcMessage } from '../../server/remote/envelope.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function until(check: () => boolean, timeout = 2000) { await expect.poll(check, { timeout, interval: 5 }).toBe(true); }

/** 真实WebSocket Relay/RPC + 实际Python适配器，检查新业务guard没有截断既有精确收尾。 */
async function fixture() {
  const directory = await mkdtemp('/tmp/cmm-cleanup-'); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise<void>(resolve => wss.once('listening', resolve));
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of wss.clients) socket.terminate(); wss.close(() => resolve()); }));
  const children = new Map<string, ChildProcessWithoutNullStreams>(); const frames: RpcMessage[] = []; let sequence = 0; let socket: WebSocket; let streamId = ''; let holdBuffered = false;
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
        const child = children.get(p.processId as string); if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 已结束。 */ } } respond({});
      } else if (message.id) respond({ alive: true });
    });
  });
  const relay = new RemoteRelay({ clientId: 'client', authProvider: { async prepareConnection() { return { url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`, headers: {}, async signChallenge() { return { signature: 'test' }; } }; } }, streamPingMs: 10000, nativePingMs: 10000 });
  cleanup.push(() => relay.close()); const session = RemoteRpcSession.fromRemoteStream(relay.createStream({ environmentId: 'environment' })); await until(() => relay.state === 'online'); await session.initialize();
  cleanup.push(async () => { for (const child of children.values()) if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 已结束。 */ } } await until(() => children.size === 0); session.close(); });
  const scope = { managed: { codexHome: '/managed', accountId: 'account', accountUserId: 'member' }, target: { environmentId: 'environment', installationId: 'installation' } };
  const commands = await RemoteCommands.create(session, scope); const files = await RemoteFiles.create(session, scope); cleanup.push(() => commands.close()); cleanup.push(() => files.close());
  return { directory, children, frames, session, commands, files, holdBuffered() { holdBuffered = true; } };
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
