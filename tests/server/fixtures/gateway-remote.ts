import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import { fixture, until } from '../remote-session-fixture.js';
import { TargetResolver } from '../../../server/targets.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** 真实 Runtime/Relay/RPC/目标 Python；所有目标文件都在随机测试根内。 */
export async function gatewayRemote(respond?: (message: any) => unknown) {
  const f = await fixture();
  const targetHome = join(f.root, 'target'); const gatewayHome = join(f.root, 'gateway');
  await mkdir(targetHome); await mkdir(gatewayHome);
  const processes = new Map<string, ChildProcessWithoutNullStreams>();
  const frames: any[] = []; const sequences = new Map<string, number>();
  await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const prompts = new Map<string, (message: unknown) => void>();
  const send = (socket: WebSocket, frame: any, message: unknown) => {
    if (socket.readyState !== 1) return;
    const seq = (sequences.get(frame.stream_id) ?? 0) + 1; sequences.set(frame.stream_id, seq);
    socket.send(JSON.stringify({ type: 'server_message', client_id: f.runtime.status().clientId,
      env_id: frame.env_id, stream_id: frame.stream_id, seq_id: seq, message }));
  };
  const respondOver = (socket: WebSocket) => socket.on('message', bytes => {
    const frame = JSON.parse(bytes.toString()); if (frame.type !== 'client_message' || !frame.message) return;
    const message = frame.message; frames.push(message); const p = message.params ?? {};
    const sendMessage = (message: unknown) => send(socket, frame, message);
    const reply = (result: unknown) => sendMessage({ id: message.id, result });
    const key = (id: string) => JSON.stringify([frame.stream_id, id]);
    if (message.method === 'initialize') {
      if (p.clientInfo?.name) prompts.set(p.clientInfo.name, sendMessage);
      reply({ codexHome: targetHome, platformFamily: 'unix', platformOs: 'linux', userAgent: 'gateway-test' });
    }
    else if (message.method === 'command/exec') {
      const child = spawn(p.command[0], p.command.slice(1), { cwd: targetHome, detached: true,
        env: { PATH: process.env.PATH, HOME: targetHome, CODEX_HOME: targetHome, TMPDIR: process.env.TMPDIR } });
      const id = key(p.processId); processes.set(id, child); child.stdin.on('error', () => {});
      const captured = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
      for (const stream of ['stdout', 'stderr'] as const) child[stream].on('data', (bytes: Buffer) => {
        if (p.streamStdoutStderr === false) captured[stream].push(bytes);
        else sendMessage({ method: 'command/exec/outputDelta', params: { processId: p.processId, stream, deltaBase64: bytes.toString('base64'), capReached: false } });
      });
      child.on('error', () => reply({ exitCode: 127, stdout: '', stderr: '' }));
      child.on('close', code => { processes.delete(id); reply({ exitCode: code ?? -1, stdout: Buffer.concat(captured.stdout).toString(), stderr: Buffer.concat(captured.stderr).toString() }); });
      if (p.streamStdin === false) child.stdin.end();
    } else if (message.method === 'command/exec/write') {
      const child = processes.get(key(p.processId)); child?.stdin.write(Buffer.from(p.deltaBase64, 'base64'));
      if (p.closeStdin) child?.stdin.end(); reply({});
    } else if (message.method === 'command/exec/terminate') {
      const child = processes.get(key(p.processId)); if (child?.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 已退出。 */ }
      reply({});
    } else if (message.id != null) reply(respond?.(message) ?? (message.method === 'thread/read'
      ? { ok: true, thread: { id: p.threadId, status: 'idle' } } : { ok: true }));
  });
  respondOver(f.connections[0]!);
  f.relayServer.on('connection', respondOver);
  cleanups.push(async () => {
    f.relayServer.off('connection', respondOver);
    for (const child of processes.values()) if (child.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 已退出。 */ }
    await until(() => processes.size === 0);
  });
  const resolver = new TargetResolver({ identity: { version: 1, gatewayId: 'gateway', localHostId: 'local' }, remoteRuntime: f.runtime });
  const directory = await resolver.directory();
  const reference = directory.data.targets.find(target => target.isGatewayHost)!.reference;
  return { ...f, targetHome, gatewayHome, frames, resolver, reference, prompts, get processes() { return processes.size; } };
}
