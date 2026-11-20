import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteStream } from '../../../server/remote/relay.js';
import { RemoteRpcSession } from '../../../server/remote/rpc-session.js';
import { RemoteFiles } from '../../../server/remote/files.js';
import type { RemoteCommandScope } from '../../../server/remote/commands.js';
import type { JsonValue, RpcMessage } from '../../../server/remote/envelope.js';

/** 临时目标 RPC 运行真正的固定 Python；仅文件系统命名空间映射到独立临时目录。没有官方连接。 */
export async function mediaRemote(options: { scope?: RemoteCommandScope; windows?: boolean; prefix?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'codex-media-target-'));
  const scope = options.scope ?? { managed: { codexHome: '/managed', accountId: 'account', accountUserId: 'member' },
    target: { environmentId: 'environment', installationId: 'installation' } };
  const processes = new Map<string, ChildProcessWithoutNullStreams>();
  const reads: Array<{ path: string; offset: number; length?: number; position: number; expected?: unknown }> = [];
  let sequence = 0; let terminated = 0; let stats = 0;
  let beforeRead: ((request: (typeof reads)[number]) => Promise<void> | void) | undefined;
  let beforeStat: (() => Promise<void> | void) | undefined;
  let delayReadMs = 0;
  const kill = (child: ChildProcessWithoutNullStreams) => { try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { /* 已退出。 */ } };
  const reply = (message: RpcMessage, result: unknown) => stream.emit('message', { id: message.id!, result: result as JsonValue }, { seqId: ++sequence });
  const notify = (id: string, name: string, bytes: Buffer) => stream.emit('message', {
    method: 'command/exec/outputDelta', params: { processId: id, stream: name, deltaBase64: bytes.toString('base64'), capReached: false },
  }, { seqId: ++sequence });
  const mapping = `import os,builtins,ntpath\n_fixture_root=${JSON.stringify(root)}\n_fixture_open=builtins.open\n_fixture_stat=os.stat\n_fixture_isabs=os.path.isabs\ndef _fixture_path(p):\n    if isinstance(p,str):\n        normalized=p.replace('\\\\','/')\n        if normalized.startswith('/media/'): return _fixture_root+'/'+normalized[7:]\n        if normalized.startswith('C:/media/'): return _fixture_root+'/'+normalized[9:]\n    return p\nbuiltins.open=lambda p,*a,**k: _fixture_open(_fixture_path(p),*a,**k)\nos.stat=lambda p,*a,**k: _fixture_stat(_fixture_path(p),*a,**k)\nos.path.isabs=lambda p: _fixture_isabs(p) or ntpath.isabs(p)\n`;
  const stream = new RemoteStream(scope.target.environmentId, 'media-target', async (_stream, message) => {
    if (!message) return { seqId: 0 };
    const p = (message.params ?? {}) as Record<string, JsonValue>;
    if (message.method === 'initialize') queueMicrotask(() => reply(message, {
      codexHome: options.windows ? 'C:\\media' : root, platformFamily: options.windows ? 'windows' : 'unix',
      platformOs: options.windows ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux', userAgent: 'temporary-media-rpc',
    }));
    else if (message.method === 'command/exec') {
      const id = p.processId as string; const argv = [...p.command as string[]]; const file = id.includes('file:');
      const buffered = p.streamStdoutStderr === false;
      if (file) argv[4] = mapping + (options.prefix ? `\n_fixture_previous_path=_fixture_path\ndef _fixture_path(p):\n    if isinstance(p,str) and p.startswith(${JSON.stringify(options.prefix)}): return _fixture_root+'/'+p[${options.prefix.length}:]\n    return _fixture_previous_path(p)\n` : '') + (buffered && delayReadMs ? `\nimport time\ntime.sleep(${delayReadMs / 1000})\n` : '') + argv[4];
      if (file && buffered) { const request = JSON.parse(argv[7]!); reads.push(request); await beforeRead?.(request); }
      const child = spawn(argv[0]!.startsWith('C:\\Fixture\\') ? 'python3' : argv[0]!, argv.slice(1), { cwd: root, detached: true, env: { PATH: process.env.PATH } });
      processes.set(id, child); child.stdin.on('error', () => {});
      const captured = { stdout: [] as Buffer[], stderr: [] as Buffer[] }; let metadataBuffer = '';
      const output = (name: 'stdout' | 'stderr', bytes: Buffer) => {
        if (buffered) captured[name].push(bytes); else notify(id, name, bytes);
      };
      child.stdout.on('data', (bytes: Buffer) => {
        if (options.windows && !file) {
          metadataBuffer += bytes.toString(); let end: number;
          while ((end = metadataBuffer.indexOf('\n')) >= 0) {
            const line = metadataBuffer.slice(0, end); metadataBuffer = metadataBuffer.slice(end + 1);
            if (line.startsWith('CMDC1_READY:')) output('stdout', Buffer.from(line + '\n'));
            else { const value = JSON.parse(line); value.python = 'C:\\Fixture\\python3.exe'; output('stdout', Buffer.from(JSON.stringify(value) + '\n')); }
          }
        } else output('stdout', bytes);
      });
      child.stderr.on('data', (bytes: Buffer) => output('stderr', bytes));
      child.on('error', () => reply(message, { exitCode: 127, stdout: '', stderr: '' }));
      child.on('close', code => { processes.delete(id); reply(message, {
        exitCode: code ?? -1, stdout: Buffer.concat(captured.stdout).toString(), stderr: Buffer.concat(captured.stderr).toString(),
      }); });
      if (p.streamStdin === false) child.stdin.end();
    } else if (message.method === 'command/exec/write') {
      const bytes = Buffer.from(p.deltaBase64 as string, 'base64');
      if (bytes.includes(Buffer.from('"mode":"stat"'))) { stats++; await beforeStat?.(); }
      const child = processes.get(p.processId as string); child?.stdin.write(bytes); if (p.closeStdin) child?.stdin.end();
      queueMicrotask(() => reply(message, {}));
    } else if (message.method === 'command/exec/terminate') {
      terminated++; const child = processes.get(p.processId as string); if (child) kill(child);
      queueMicrotask(() => reply(message, {}));
    }
    return { seqId: sequence };
  }, () => {});
  const session = RemoteRpcSession.fromRemoteStream(stream);
  try {
    await session.initialize(); const files = await RemoteFiles.create(session, scope);
    return { root, files, session, reads, get stats() { return stats; }, get terminated() { return terminated; }, get active() { return processes.size; },
      beforeRead(fn?: typeof beforeRead) { beforeRead = fn; }, beforeStat(fn?: typeof beforeStat) { beforeStat = fn; }, delayReads(ms: number) { delayReadMs = ms; },
      async close() {
        await files.close(); session.close(); for (const child of processes.values()) kill(child);
        const deadline = Date.now() + 3000;
        while (processes.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) { session.close(); for (const child of processes.values()) kill(child); await rm(root, { recursive: true, force: true }); throw error; }
}
