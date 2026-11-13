import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { RemoteStream } from '../../../server/remote/relay.js';
import { RemoteRpcSession } from '../../../server/remote/rpc-session.js';
import { RemoteFiles } from '../../../server/remote/files.js';
import type { JsonValue, RpcMessage } from '../../../server/remote/envelope.js';

// 独立OS进程只接收测试暂存路径和序列化收据；每个目标协议命令仍实际运行Python3。
let input = '';
for await (const part of process.stdin) { input += String(part); if (input.length > 65536) throw new Error('测试输入超限'); }
const request = JSON.parse(input) as { directory: string; operation: unknown };
let seq = 0;
const children = new Map<string, ChildProcessWithoutNullStreams>();
const respond = (message: RpcMessage, result: unknown) => stream.emit('message', { id: message.id!, result: result as JsonValue }, { seqId: ++seq });
const kill = (child: ChildProcessWithoutNullStreams) => { try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { /* 已结束。 */ } };
const stream = new RemoteStream('environment', 'recover-worker', async (_stream, message) => {
  if (!message) return { seqId: 0 };
  const p = (message.params ?? {}) as Record<string, JsonValue>;
  if (message.method === 'initialize') queueMicrotask(() => respond(message, { codexHome: request.directory, platformFamily: 'unix', platformOs: process.platform === 'darwin' ? 'macos' : 'linux', userAgent: 'worker' }));
  else if (message.method === 'command/exec') {
    const id = p.processId as string; const argv = p.command as string[];
    const child = spawn(argv[0]!, argv.slice(1), { cwd: p.cwd as string, env: { PATH: process.env.PATH }, detached: true }); children.set(id, child); child.stdin.on('error', () => {});
    for (const name of ['stdout', 'stderr'] as const) child[name].on('data', (data: Buffer) => stream.emit('message', { method: 'command/exec/outputDelta', params: { processId: id, stream: name, deltaBase64: data.toString('base64'), capReached: false } }, { seqId: ++seq }));
    child.on('close', code => { children.delete(id); respond(message, { exitCode: code ?? -1, stdout: '', stderr: '' }); });
  } else if (message.method === 'command/exec/write') {
    children.get(p.processId as string)?.stdin.write(Buffer.from(p.deltaBase64 as string, 'base64')); queueMicrotask(() => respond(message, {}));
    if (p.closeStdin) children.get(p.processId as string)?.stdin.end();
  } else if (message.method === 'command/exec/terminate') { const child = children.get(p.processId as string); if (child) kill(child); queueMicrotask(() => respond(message, {})); }
  return { seqId: ++seq };
}, () => {});
const session = RemoteRpcSession.fromRemoteStream(stream);
let files: RemoteFiles | undefined;
try {
  await session.initialize();
  files = await RemoteFiles.create(session, { managed: { codexHome: '/managed', accountId: 'account', accountUserId: 'member' }, target: { environmentId: 'environment', installationId: 'installation' } });
  process.stdout.write(JSON.stringify(await files.queryUpload(request.operation)));
} finally { await files?.close(); for (const child of children.values()) kill(child); session.close(); }
