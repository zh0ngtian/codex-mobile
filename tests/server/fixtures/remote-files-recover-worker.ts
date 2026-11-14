import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeHeapSnapshot } from 'node:v8';
import { RemoteStream } from '../../../server/remote/relay.js';
import { RemoteRpcSession } from '../../../server/remote/rpc-session.js';
import { RemoteFiles } from '../../../server/remote/files.js';
import type { JsonValue, RpcMessage } from '../../../server/remote/envelope.js';

// 独立OS进程只接收测试暂存路径和序列化收据；每个目标协议命令仍实际运行Python3。
let input = '';
for await (const part of process.stdin) { input += String(part); if (input.length > 65536) throw new Error('测试输入超限'); }
const request = JSON.parse(input) as { directory: string; operation?: unknown; path?: string; action?: 'read-retention' | 'read-paused-retention'; mode?: 'deadline' | 'close'; snapshot?: string };
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
    const captured = { stdout: [] as Buffer[], stderr: [] as Buffer[] }; const sizes = { stdout: 0, stderr: 0 };
    for (const name of ['stdout', 'stderr'] as const) child[name].on('data', (data: Buffer) => {
      if (p.streamStdoutStderr !== false) stream.emit('message', { method: 'command/exec/outputDelta', params: { processId: id, stream: name, deltaBase64: data.toString('base64'), capReached: false } }, { seqId: ++seq });
      else { const part = data.subarray(0, Math.max(0, Number(p.outputBytesCap) - sizes[name])); captured[name].push(part); sizes[name] += part.length; }
    });
    if (p.streamStdin === false) child.stdin.end();
    child.on('close', code => { children.delete(id); respond(message, { exitCode: code ?? -1, stdout: Buffer.concat(captured.stdout).toString('utf8'), stderr: Buffer.concat(captured.stderr).toString('utf8') }); });
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
  if (request.action === 'read-retention') {
    if (!global.gc || !request.path) throw new Error('测试需要显式GC和目标路径');
    const call = session.call.bind(session); const results: WeakRef<object>[] = [];
    session.call = (method, params, options) => call(method, params, options).then(value => {
      if (method === 'command/exec' && (params as Record<string, unknown>)?.streamStdoutStderr === false && value && typeof value === 'object') results.push(new WeakRef(value));
      return value;
    });
    const iterator = files.read(request.path)[Symbol.asyncIterator]();
    // 消费前十五个单块窗口，并暂停在第十六个最终窗的yield；原deadline/failure promise仍有效。
    for (let n = 0; n < 16; n++) { const part = await iterator.next(); if (part.done || part.value.length !== 524288) throw new Error('窗口数量不符'); }
    for (let n = 0; n < 5; n++) { await new Promise(resolve => setImmediate(resolve)); global.gc(); }
    if (request.snapshot) writeHeapSnapshot(request.snapshot);
    const livePreviousResults = results.slice(0, -1).filter(reference => reference.deref() !== undefined).length;
    process.stdout.write(JSON.stringify({ windows: results.length, previousResults: results.length - 1, livePreviousResults, activeTargetProcesses: children.size, finalPaused: true }));
    await iterator.return(undefined);
  } else if (request.action === 'read-paused-retention') {
    if (!global.gc || !request.path || !request.mode) throw new Error('测试需要显式GC、目标路径和回收模式');
    const parsed: WeakRef<object>[] = []; const decoded: WeakRef<Buffer>[] = []; const raw: WeakRef<object>[] = [];
    const parse = JSON.parse; const from = Buffer.from; const call = session.call.bind(session);
    const listeners = () => ['notification', 'disconnect', 'close'].map(name => session.listenerCount(name));
    const baseline = listeners(); const held: AsyncGenerator<Buffer>[] = []; const consumed: Buffer[] = []; const owners: RemoteFiles[] = [];
    JSON.parse = (text, reviver) => {
      const value: unknown = parse(text, reviver);
      if (value && typeof value === 'object' && 'kind' in value && value.kind === 'chunk') parsed.push(new WeakRef(value));
      return value;
    };
    Buffer.from = function (...args: unknown[]) {
      const value: Buffer = Reflect.apply(from, Buffer, args);
      if (typeof args[0] === 'string' && args[1] === 'base64' && value.length === 524288) decoded.push(new WeakRef(value));
      return value;
    } as typeof Buffer.from;
    session.call = (method, params, options) => call(method, params, options).then(value => {
      if (method === 'command/exec' && (params as Record<string, unknown>)?.streamStdoutStderr === false && value && typeof value === 'object') raw.push(new WeakRef(value));
      return value;
    });
    // 每窗只产生一个块，由消费者有意持有；parsed记录与原RPC结果必须在原期限/close后可回收。
    const first = async (iterator: AsyncGenerator<Buffer>) => {
      const part = await iterator.next(); if (part.done || part.value.length !== 524288) throw new Error('首块不符'); consumed.push(part.value);
    };
    try {
      for (let n = 0; n < 8; n++) {
        const owner = request.mode === 'close' ? await RemoteFiles.create(session, { managed: { codexHome: '/managed', accountId: 'account', accountUserId: 'member' }, target: { environmentId: 'environment', installationId: 'installation' } }) : files;
        owners.push(owner); const iterator = owner.read(request.path, { timeoutMs: request.mode === 'deadline' ? 500 : 3000 });
        await first(iterator); held.push(iterator);
        if (request.mode === 'close') await owner.close(); else await new Promise(resolve => setTimeout(resolve, 530));
      }
      for (let n = 0; n < 8; n++) { await new Promise(resolve => setImmediate(resolve)); global.gc(); }
      if (request.snapshot) writeHeapSnapshot(request.snapshot);
      const result = {
        mode: request.mode, heldIterators: held.length, parsedChunks: parsed.length, decodedBuffers: decoded.length,
        liveParsedChunks: parsed.filter(reference => reference.deref()).length,
        liveUnyieldedBuffers: decoded.filter(reference => { const value = reference.deref(); return value && !consumed.includes(value); }).length,
        liveCallerBuffers: decoded.filter(reference => { const value = reference.deref(); return value && consumed.includes(value); }).length,
        channels: owners.reduce((total, owner) => total + (owner as unknown as { channels: Set<unknown> }).channels.size, 0),
        activeTargetProcesses: children.size, rawResultsAlive: raw.filter(reference => reference.deref()).length,
        listenersBackToBase: JSON.stringify(listeners()) === JSON.stringify(baseline),
        allPermitsReusable: (await Promise.all(Array.from({ length: 4 }, () => files!.stat(request.path!)))).every(stat => stat.size === 2097152),
      };
      process.stdout.write(JSON.stringify(result));
      if (consumed.length !== 8 || consumed.some(part => part.length !== 524288)) throw new Error('消费者首块丢失');
    } finally {
      JSON.parse = parse; Buffer.from = from; session.call = call;
      for (const iterator of held) await iterator.return(undefined);
      for (const owner of owners) if (owner !== files) await owner.close();
    }
  } else process.stdout.write(JSON.stringify(await files.queryUpload(request.operation)));
} finally { await files?.close(); for (const child of children.values()) kill(child); session.close(); }
