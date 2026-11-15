import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteStream } from '../../../server/remote/relay.js';
import { RemoteRpcSession } from '../../../server/remote/rpc-session.js';
import { RemoteCommands, type RemoteCommandScope } from '../../../server/remote/commands.js';
import type { JsonValue, RpcMessage } from '../../../server/remote/envelope.js';

/** 真正固定Python/Commands/RPC；只将受控目标根映射到随机临时目录。 */
export async function rolloutRemote(options: { target?: string; timezone?: string; windows?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rollout-target-'));
  const home = options.windows ? 'C:\\rollout' : '/rollout';
  const scope: RemoteCommandScope = { managed: { codexHome: '/managed', accountId: 'account', accountUserId: 'member' },
    target: { environmentId: options.target ?? 'environment', installationId: 'installation' } };
  const processes = new Map<string, ChildProcessWithoutNullStreams>();
  const requests: Record<string, unknown>[] = []; const frames: RpcMessage[] = [];
  let sequence = 0; let delay = 0; let hook: ((request: Record<string, unknown>) => Promise<void> | void) | undefined;
  const mapping = `import builtins,os,subprocess\n_fixture_root=${JSON.stringify(root)}\n_fixture_open=builtins.open\n_fixture_stat=os.stat\n_fixture_scandir=os.scandir\ndef _fixture_path(p):\n    if isinstance(p,str):\n        q=p.replace('\\\\','/')\n        for prefix in ['/rollout','C:/rollout']:\n            if q==prefix or q.startswith(prefix+'/'): return _fixture_root+q[len(prefix):]\n    return p\ndef _fixture_denied():\n    if os.path.exists(_fixture_root+'/.deny'): raise PermissionError('fixture denial')\ndef _fixture_read(p,*a,**k):\n    _fixture_denied();return _fixture_open(_fixture_path(p),*a,**k)\ndef _fixture_list(p,*a,**k):\n    _fixture_denied();return _fixture_scandir(_fixture_path(p),*a,**k)\nbuiltins.open=_fixture_read\nos.stat=lambda p,*a,**k: _fixture_stat(_fixture_path(p),*a,**k)\nos.scandir=_fixture_list\n`;
  const kill = (child: ChildProcessWithoutNullStreams) => { try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { /* 已终结。 */ } };
  const reply = (message: RpcMessage, result: unknown) => stream.emit('message', { id: message.id!, result: result as JsonValue }, { seqId: ++sequence });
  const output = (id: string, name: string, bytes: Buffer) => stream.emit('message', { method: 'command/exec/outputDelta', params: {
    processId: id, stream: name, deltaBase64: bytes.toString('base64'), capReached: false,
  } }, { seqId: ++sequence });
  const stream = new RemoteStream(scope.target.environmentId, 'rollout-fixture', async (_stream, message) => {
    if (!message) return { seqId: 0 }; frames.push(message);
    const p = (message.params ?? {}) as Record<string, JsonValue>;
    if (message.method === 'initialize') queueMicrotask(() => reply(message, { codexHome: home,
      platformFamily: options.windows ? 'windows' : 'unix', platformOs: options.windows ? 'windows' : 'linux', userAgent: 'rollout-fixture' }));
    else if (message.method === 'command/exec') {
      const id = p.processId as string; const argv = [...p.command as string[]];
      const prefix = `import subprocess\n_fixture_popen=subprocess.Popen\ndef _fixture_spawn(argv,*a,**k):\n    argv=list(argv)\n    if len(argv)>3 and argv[2]=='-c':\n        argv[3]=${JSON.stringify(mapping)}+${JSON.stringify('\nimport time\ntime.sleep(')}+str(${delay / 1000})+')\\n'+argv[3]\n        argv[0]='python3'\n    k['cwd']=${JSON.stringify(root)}\n    return _fixture_popen(argv,*a,**k)\nsubprocess.Popen=_fixture_spawn\n`;
      argv[4] = prefix + argv[4];
      const child = spawn(argv[0]!.startsWith('C:\\') ? 'python3' : argv[0]!, argv.slice(1), { cwd: root, detached: true,
        env: { PATH: process.env.PATH, ...(options.timezone ? { TZ: options.timezone } : {}) } });
      processes.set(id, child); child.stdin.on('error', () => {}); let probe = '';
      child.stdout.on('data', (bytes: Buffer) => {
        if (!options.windows) { output(id, 'stdout', bytes); return; }
        probe += bytes.toString(); let end: number;
        while ((end = probe.indexOf('\n')) >= 0) {
          const line = probe.slice(0, end); probe = probe.slice(end + 1);
          if (line.startsWith('CMDC1_READY:')) output(id, 'stdout', Buffer.from(line + '\n'));
          else { const value = JSON.parse(line); if (value.kind === 'probe') value.python = 'C:\\Fixture\\python3.exe'; output(id, 'stdout', Buffer.from(JSON.stringify(value) + '\n')); }
        }
      });
      child.stderr.on('data', (bytes: Buffer) => output(id, 'stderr', bytes));
      child.on('error', () => reply(message, { exitCode: 127, stdout: '', stderr: '' }));
      child.on('close', code => { processes.delete(id); reply(message, { exitCode: code ?? -1, stdout: '', stderr: '' }); });
    } else if (message.method === 'command/exec/write') {
      const bytes = Buffer.from(p.deltaBase64 as string, 'base64');
      const payload = JSON.parse(bytes.toString());
      if (payload.mode === 'execute' && payload.argv.length > 4 && payload.argv.at(-1).startsWith('{')) {
        const request = JSON.parse(payload.argv.at(-1)); requests.push(request); await hook?.(request);
      }
      const child = processes.get(p.processId as string); child?.stdin.write(bytes); if (p.closeStdin) child?.stdin.end();
      queueMicrotask(() => reply(message, {}));
    } else if (message.method === 'command/exec/terminate') {
      const child = processes.get(p.processId as string); if (child) kill(child); queueMicrotask(() => reply(message, {}));
    }
    return { seqId: sequence };
  }, () => {});
  const session = RemoteRpcSession.fromRemoteStream(stream);
  try {
    await session.initialize(); const commands = await RemoteCommands.create(session, scope);
    return { root, home, scope, session, commands, requests, frames, get active() { return processes.size; },
      beforeRequest(fn?: typeof hook) { hook = fn; }, delay(ms: number) { delay = ms; },
      async close() {
        await commands.close(); session.close(); for (const child of processes.values()) kill(child);
        const deadline = Date.now() + 3000;
        while (processes.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
        if (processes.size) throw new Error('fixture进程未清理'); await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) { session.close(); for (const child of processes.values()) kill(child); await rm(root, { recursive: true, force: true }); throw error; }
}
