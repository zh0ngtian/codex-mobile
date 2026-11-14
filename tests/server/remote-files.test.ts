// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { mkdtemp, readFile, rm, writeFile, rename, readdir, truncate, mkdir, symlink, readlink, utimes, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { RemoteStream } from '../../server/remote/relay.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';
import type { JsonValue, RpcMessage } from '../../server/remote/envelope.js';
import { withRemoteOperation } from '../../server/remote/operation-guard.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0; }, 180000);
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const scope = { managed: { codexHome: '/managed', accountId: 'account', accountUserId: 'member' }, target: { environmentId: 'environment', installationId: 'installation' } };
async function until(test: () => boolean) { const start = performance.now(); while (!test()) { if (performance.now() - start > 3000) throw new Error('测试条件超时'); await new Promise(resolve => setTimeout(resolve, 5)); } }
async function fixture(metadata?: Record<string, unknown>, missingPython = false) {
  const directory = await mkdtemp(join(tmpdir(), 'remote-files-'));
  const fileDeadlines = new Map<string, number>(); let unknownDeadline = 0;
  const frames: RpcMessage[] = []; const processes = new Map<string, ChildProcessWithoutNullStreams>();
  let seq = 0; let outputTransform: ((bytes: Buffer) => Buffer) | undefined; let beforeWrite: (() => void) | undefined;
  let dropCommit = false; let finalHold = false; let summary = false; let maxFrameBytes = 0; let exitZero = false;
  let controlTransform: ((bytes: Buffer) => Buffer) | undefined; const finals: (() => void)[] = [];
  let scriptTransform: ((source: string) => string) | undefined;
  let packetBytes = 0; let ignoreTermination = false; let captureCap: number | undefined;
  let resultTransform: typeof bufferedTransform;
  let bufferedTransform: ((value: { exitCode: number; stdout: string; stderr: string }) => { exitCode: number; stdout: string; stderr: string }) | undefined;
  const captures: { stdoutBytes: number; stderrBytes: number; cap: number; request: Record<string, unknown> }[] = [];
  let fileNotifications = 0;
  const kill = (child: ChildProcessWithoutNullStreams) => { try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { /* 已退出。 */ } };
  const respond = (message: RpcMessage, result: unknown) => stream.emit('message', { id: message.id!, result: result as JsonValue }, { seqId: ++seq });
  const notify = (processId: string, name: string, bytes: Buffer) => {
    const size = packetBytes && processId.includes('file:') && name === 'stdout' ? packetBytes : Math.max(1, bytes.length);
    for (let n = 0; n < bytes.length; n += size) {
      if (processId.includes('file:')) fileNotifications++;
      stream.emit('message', { method: 'command/exec/outputDelta', params: { processId, stream: name, deltaBase64: bytes.subarray(n, n + size).toString('base64'), capReached: false } }, { seqId: ++seq });
    }
  };
  const stream = new RemoteStream('environment', 'files-test', async (_stream, message) => {
    if (!message) return { seqId: 0 };
    maxFrameBytes = Math.max(maxFrameBytes, Buffer.byteLength(JSON.stringify(message)));
    const p = (message.params ?? {}) as Record<string, JsonValue>;
    frames.push(summary && message.method === 'command/exec/write' ? { ...message, params: { ...p, deltaBase64: '' } } : message);
    if (message.method === 'initialize') queueMicrotask(() => respond(message, metadata ?? { codexHome: directory, platformFamily: 'unix', platformOs: process.platform === 'darwin' ? 'macos' : 'linux', userAgent: 'test' }));
    else if (message.method === 'command/exec') {
      if (missingPython) { queueMicrotask(() => respond(message, { exitCode: 127, stdout: '', stderr: '' })); return { seqId: frames.length }; }
      const id = p.processId as string; const argv = [...p.command as string[]];
      if (id.includes('file:')) fileDeadlines.set(id, performance.now() + Number(p.timeoutMs));
      if (id.includes('file:') && scriptTransform) argv[4] = scriptTransform(argv[4]!);
      const child = spawn(argv[0]!.startsWith('C:\\Fixture\\') ? 'python3' : argv[0]!, argv.slice(1), { cwd: metadata?.platformFamily === 'windows' ? directory : p.cwd as string, env: { PATH: process.env.PATH }, detached: true }); processes.set(id, child); child.stdin.on('error', () => {});
      let lineBuffer = Buffer.alloc(0); const buffered = p.streamStdoutStderr === false;
      const captured = { stdout: [] as Buffer[], stderr: [] as Buffer[] }; const capturedBytes = { stdout: 0, stderr: 0 };
      const output = (name: 'stdout' | 'stderr', data: Buffer) => {
        if (!buffered) { notify(id, name, data); return; }
        const part = data.subarray(0, Math.max(0, Math.min(Number(p.outputBytesCap), captureCap ?? Infinity) - capturedBytes[name]));
        captured[name].push(part); capturedBytes[name] += part.length;
      };
      if (p.streamStdin === false) child.stdin.end();
      child.stdout.on('data', (data: Buffer) => {
        if (metadata?.platformFamily === 'windows' && !id.includes('file:')) {
          lineBuffer = Buffer.concat([lineBuffer, data]); let end: number;
          while ((end = lineBuffer.indexOf(10)) >= 0) {
            const line = lineBuffer.subarray(0, end + 1); lineBuffer = lineBuffer.subarray(end + 1);
            if (line.toString().startsWith('CMDC1_READY:')) output('stdout', line);
            else { const value = JSON.parse(line.toString()); value.python = 'C:\\Fixture\\python3.exe'; output('stdout', Buffer.from(JSON.stringify(value) + '\n')); }
          } return;
        }
        if (id.includes('file:') && exitZero) { output('stdout', data); kill(child); return; }
        if (!id.includes('file:') || !outputTransform) { output('stdout', data); return; }
        lineBuffer = Buffer.concat([lineBuffer, data]); let end: number;
        while ((end = lineBuffer.indexOf(10)) >= 0) { const line = lineBuffer.subarray(0, end + 1); lineBuffer = lineBuffer.subarray(end + 1); const result = outputTransform(line); if (result.length) output('stdout', result); }
      });
      child.stderr.on('data', (data: Buffer) => { const value = id.includes('file:') && controlTransform ? controlTransform(data) : data; if (value.length) output('stderr', value); });
      child.on('error', () => respond(message, { exitCode: 127, stdout: '', stderr: '' }));
      child.on('close', code => { processes.delete(id); const final = () => {
        fileDeadlines.delete(id);
        const value = { exitCode: id.includes('file:') && exitZero ? 0 : code ?? -1, stdout: Buffer.concat(captured.stdout).toString('utf8'), stderr: Buffer.concat(captured.stderr).toString('utf8') };
        if (buffered) captures.push({ stdoutBytes: capturedBytes.stdout, stderrBytes: capturedBytes.stderr, cap: Number(p.outputBytesCap), request: argv[7] ? JSON.parse(argv[7]) : {} });
        const result = buffered && bufferedTransform ? bufferedTransform(value) : value;
        respond(message, id.includes('file:') && resultTransform ? resultTransform(result) : result);
      }; if (finalHold) finals.push(final); else final(); });
    } else if (message.method === 'command/exec/write') {
      beforeWrite?.(); const child = processes.get(p.processId as string); const bytes = Buffer.from(p.deltaBase64 as string, 'base64');
      if (child) { child.stdin.write(bytes); if (p.closeStdin) child.stdin.end(); }
      if (dropCommit && bytes.includes(Buffer.from('"op":"commit"'))) { dropCommit = false; setTimeout(() => stream.emit('disconnect', { reason: 'network', mayHaveBeenSent: true }), 40); }
      else queueMicrotask(() => respond(message, {}));
    } else if (message.method === 'command/exec/terminate') { const child = processes.get(p.processId as string); if (child && !ignoreTermination) kill(child); queueMicrotask(() => respond(message, {})); }
    return { seqId: frames.length };
  }, () => {});
  const session = RemoteRpcSession.fromRemoteStream(stream);
  stream.on('disconnect', () => { unknownDeadline = Math.max(unknownDeadline, ...fileDeadlines.values()); });
  cleanup.push(async () => { for (const child of processes.values()) kill(child); session.close(); await until(() => processes.size === 0); await rm(directory, { recursive: true, force: true });
    // 断线后的RPC拒绝不能证明目标结束；模拟目标虽已由fixture杀掉，产品仍须到原期限回收。
    if (unknownDeadline > performance.now()) await new Promise(resolve => setTimeout(resolve, unknownDeadline - performance.now() + 10));
  });
  await session.initialize();
  return { directory, session, stream, frames, processes, captures, captureCap(bytes: number) { captureCap = bytes; }, result(fn: typeof resultTransform) { resultTransform = fn; }, buffered(fn: typeof bufferedTransform) { bufferedTransform = fn; }, ignoreTermination(value = true) { ignoreTermination = value; }, notifications() { return fileNotifications; }, packets(size: number) { packetBytes = size; }, script(fn: typeof scriptTransform) { scriptTransform = fn; }, exitFilesWithoutProof() { exitZero = true; }, control(fn: typeof controlTransform) { controlTransform = fn; }, summarizeFrames() { summary = true; }, maxFrameBytes() { return maxFrameBytes; }, transform(fn: typeof outputTransform) { outputTransform = fn; }, beforeWrite(fn: typeof beforeWrite) { beforeWrite = fn; }, dropCommit() { dropCommit = true; }, holdFinal() { finalHold = true; }, releaseFinal() { finalHold = false; for (const fn of finals.splice(0)) fn(); } };
}
async function prepared() {
  const implementation = await import('../../server/remote/files.js').catch(() => null);
  expect(implementation?.RemoteFiles, '缺少 Remote 目标文件基础').toBeTypeOf('function');
  const f = await fixture(); const files = await implementation!.RemoteFiles.create(f.session, scope);
  cleanup.push(() => files.close()); return { ...f, files };
}
async function bytes(source: AsyncIterable<Uint8Array>) { const parts: Buffer[] = []; for await (const part of source) parts.push(Buffer.from(part)); return Buffer.concat(parts); }
async function* input(data: Uint8Array) { for (let n = 0; n < data.length; n += 512 * 1024) yield data.subarray(n, n + 512 * 1024); }
async function queryInNewProcess(directory: string, operation: unknown) {
  const child = spawn(process.execPath, ['--import', 'tsx', new URL('./fixtures/remote-files-recover-worker.ts', import.meta.url).pathname], { stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage' } });
  let stdout = ''; let stderr = ''; child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); }); child.stdin.end(JSON.stringify({ directory, operation }));
  expect(await new Promise<number | null>(resolve => child.on('close', resolve))).toBe(0); expect(stderr).toBe(''); return JSON.parse(stdout);
}

it('通过同一ready session在目标创建临时文件并原子提交，特殊字符路径只作为数据', async () => {
  const f = await prepared(); const path = join(f.directory, '名字 空格;$()`".bin'); const data = Buffer.from([0, 255, 128, 1, 2]);
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  expect(await readFile(path)).toEqual(data); expect(result.sha256).toBe(sha(data));
  expect(await bytes(f.files.read(path))).toEqual(data);
  expect(f.frames.filter(frame => frame.method === 'command/exec')).toHaveLength(3);
  for (const frame of f.frames.filter(frame => frame.method === 'command/exec')) {
    expect(frame.params).not.toHaveProperty('sandboxPolicy'); expect(frame.params).not.toHaveProperty('permissionProfile');
    expect(JSON.stringify(frame.params)).not.toContain(path);
  }
  expect(f.session.ready).toBe(true);
});

it('目标stat版本贯穿非整块Range并支持空文件', async () => {
  const f = await prepared(); const path = join(f.directory, 'range'); const data = Buffer.alloc(1200000); for (let n = 0; n < data.length; n++) data[n] = n % 251;
  await writeFile(path, data); const stat = await f.files.stat(path);
  expect(stat).toMatchObject({ path, type: 'file', size: data.length });
  expect(await bytes(f.files.read(path, { offset: 17, length: 800003, version: stat.version }))).toEqual(data.subarray(17, 800020));
  await writeFile(join(f.directory, 'empty'), ''); expect(await bytes(f.files.read(join(f.directory, 'empty')))).toHaveLength(0);
});

it('上传暂存与私有捕获保留目标父路径的symlink/..语义，不以纯字符串归一化改写', async () => {
  const f = await prepared(); await mkdir(join(f.directory, 'physical')); await mkdir(join(f.directory, 'physical', 'child')); await mkdir(join(f.directory, 'logical'));
  await symlink(join(f.directory, 'physical', 'child'), join(f.directory, 'logical', 'link'));
  const path = f.directory + '/logical/link/../payload'; const data = Buffer.from('raw-parent');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  expect(await readFile(join(f.directory, 'physical', 'payload'))).toEqual(data); expect(await bytes(f.files.read(path, { version: result.version }))).toEqual(data);
  await f.files.releaseUpload(result.operation); expect(await readdir(join(f.directory, 'physical'))).toEqual(['child', 'payload']);
});

it('上传接受目标父路径的重复分隔符并保留原始目标字符串', async () => {
  const f = await prepared(); const path = f.directory + '//payload'; const data = Buffer.from('double-separator');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  expect(result.path).toBe(path); expect(await readFile(path)).toEqual(data);
  await f.files.releaseUpload(result.operation); expect(await readdir(f.directory)).toEqual(['payload']);
});

it('目录分页和严格文本/JSONL前缀读取有界且复用目标路径', async () => {
  const f = await prepared(); for (let n = 0; n < 9; n++) await writeFile(join(f.directory, '项' + n), '');
  const entries = []; for await (const page of f.files.list(f.directory, { pageSize: 3 })) { expect(page.length).toBeLessThanOrEqual(3); entries.push(...page); }
  expect(entries).toHaveLength(9); expect(entries.every(entry => entry.path.startsWith(f.directory) && entry.type === 'file')).toBe(true);
  const path = join(f.directory, 'lines'); await writeFile(path, '{"a":1}\n{"b":"中"}\n{"unfinished":');
  const lines = await f.files.readJsonLines(path, { maxBytes: 1000 });
  expect(lines.values).toEqual([{ a: 1 }, { b: '中' }]); expect(lines.incompleteTail).toBe(true);
  expect(lines.snapshotBytes).toBe((await readFile(path)).length);
  await writeFile(path, Buffer.from([0xff])); await expect(f.files.readText(path, { maxBytes: 100 })).rejects.toMatchObject({ code: 'encoding' });
});

it('目录枚举接受重复和末尾分隔符，保留目标真实entry.path', async () => {
  const f = await prepared(); await mkdir(join(f.directory, 'folder')); await writeFile(join(f.directory, 'folder', 'entry'), 'x');
  for (const path of [f.directory + '/folder/', f.directory + '//folder//']) {
    const pages = []; for await (const page of f.files.list(path)) pages.push(...page);
    expect(pages).toHaveLength(1); expect(pages[0]!.name).toBe('entry'); expect(await readFile(pages[0]!.path, 'utf8')).toBe('x');
  }
});

it.each(['C:\\', 'C:/Users/名字/data', '\\\\codex-files-controlled-server\\share\\', '//codex-files-controlled-server/share/名字'])('受控Windows完全限定路径原样交目标，支持drive/UNC根%s', async path => {
  const f = await fixture({ codexHome: 'C:\\Fixture\\.codex', platformFamily: 'windows', platformOs: 'windows', userAgent: 'controlled-not-windows-machine' });
  const { RemoteFiles } = await import('../../server/remote/files.js'); const files = await RemoteFiles.create(f.session, scope); cleanup.push(() => files.close());
  const outcome = await files.stat(path).catch(error => error); expect(outcome).toMatchObject({ mayHaveBeenSent: true });
  const frame = f.frames.filter(frame => frame.method === 'command/exec/write').at(-1)!;
  expect(JSON.parse(Buffer.from((frame.params as Record<string, string>).deltaBase64!, 'base64').toString()).path).toBe(path);
});

it('JSONL同步解析结束后仍检查父操作，父期限失效不得交付解析结果', async () => {
  const f = await prepared(); const path = join(f.directory, 'parse-deadline'); await writeFile(path, '{"marker":1}\n');
  const { RemoteFileError } = await import('../../server/remote/files.js'); const parse = JSON.parse; let expired = false; let delivered = false;
  JSON.parse = (value, reviver) => { const result = parse(value, reviver); if (value === '{"marker":1}') expired = true; return result; };
  try {
    const error = await withRemoteOperation(() => { if (expired) throw new RemoteFileError('timeout', true); }, async () => { const result = await f.files.readJsonLines(path, { maxBytes: 100 }); delivered = true; return result; }).catch(error => error);
    expect(error).toMatchObject({ code: 'timeout' }); expect(delivered).toBe(false);
  } finally { JSON.parse = parse; }
});

it('读取中的追加和同名替换不能拼接为同版本附件', async () => {
  for (const replace of [false, true]) {
    const f = await prepared(); const path = join(f.directory, 'changing'); await writeFile(path, Buffer.alloc(3 * 1024 * 1024, 1));
    const iterator = f.files.read(path)[Symbol.asyncIterator](); expect((await iterator.next()).value).toHaveLength(512 * 1024);
    if (replace) { await writeFile(path + '.new', Buffer.alloc(3 * 1024 * 1024, 2)); await rename(path + '.new', path); }
    else await writeFile(path, Buffer.alloc(3 * 1024 * 1024 + 1, 3));
    await expect(bytes({ [Symbol.asyncIterator]: () => iterator })).rejects.toMatchObject({ code: 'version' });
  }
});

it('Range与上传大小超过单文件100MiB或负数/溢出时不发送文件命令', async () => {
  const f = await prepared(); const before = f.frames.length; const path = join(f.directory, 'unused');
  for (const patch of [{ offset: -1 }, { length: -1 }, { offset: Number.MAX_SAFE_INTEGER, length: 1 }, { length: 100 * 1024 * 1024 + 1 }]) await expect(bytes(f.files.read(path, patch))).rejects.toMatchObject({ mayHaveBeenSent: false });
  await expect(f.files.upload(path, input(Buffer.alloc(0)), { size: 100 * 1024 * 1024 + 1, sha256: sha(Buffer.alloc(0)), expectedVersion: null })).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  expect(f.frames).toHaveLength(before);
});

it('上传不足/摘要错误/目标版本不符均不提交半文件且精确清理自有暂存', async () => {
  const f = await prepared(); const path = join(f.directory, 'destination'); await writeFile(path, 'original'); const original = await f.files.stat(path);
  for (const options of [{ size: 4, sha256: sha(Buffer.from('new')) }, { size: 3, sha256: '0'.repeat(64) }]) {
    await expect(f.files.upload(path, input(Buffer.from('new')), { ...options, expectedVersion: original.version })).rejects.toMatchObject({ code: 'integrity', mayHaveBeenSent: true });
    expect(await readFile(path, 'utf8')).toBe('original');
  }
  await writeFile(path, 'changed');
  await expect(f.files.upload(path, input(Buffer.from('new')), { size: 3, sha256: sha(Buffer.from('new')), expectedVersion: original.version })).rejects.toMatchObject({ code: 'version' });
  expect(await readdir(f.directory)).toEqual(['destination']);
});

it('有限窗口遵守背压且四文件并发后拒绝第五个，close不关闭调用者session', async () => {
  const f = await prepared(); const path = join(f.directory, 'backpressure'); await writeFile(path, Buffer.alloc(6 * 1024 * 1024, 4));
  const iterators = Array.from({ length: 4 }, () => f.files.read(path)[Symbol.asyncIterator]());
  for (const iterator of iterators) await iterator.next();
  const writes = f.frames.filter(frame => frame.method === 'command/exec/write').length;
  await new Promise(resolve => setTimeout(resolve, 30)); expect(f.frames.filter(frame => frame.method === 'command/exec/write')).toHaveLength(writes);
  await expect(bytes(f.files.read(path))).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  await f.files.close(); for (const iterator of iterators) await iterator.return?.(undefined);
  expect(f.session.ready).toBe(true); await until(() => f.processes.size === 0);
});

it('取消、超时、断线和同步迟到都不能成功，也不自动重放写入', async () => {
  for (const mode of ['cancel', 'timeout', 'disconnect', 'late'] as const) {
    const f = await prepared(); const controller = new AbortController(); let sent = false;
    async function* source() { sent = true; if (mode === 'cancel') controller.abort(); if (mode === 'disconnect') f.stream.emit('disconnect', { reason: 'network', mayHaveBeenSent: true }); await new Promise(resolve => setTimeout(resolve, mode === 'timeout' ? 80 : 1)); yield Buffer.from('x'); }
    if (mode === 'late') f.beforeWrite(() => { const end = performance.now() + 90; while (performance.now() < end) {} });
    if (mode === 'timeout') f.script(source => 'import time\ntime.sleep(.08)\n' + source);
    await expect(f.files.upload(join(f.directory, 'cancelled'), source(), { size: 1, sha256: sha(Buffer.from('x')), expectedVersion: null, signal: controller.signal, timeoutMs: mode === 'timeout' || mode === 'late' ? 50 : 1000 })).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : mode === 'disconnect' ? 'disconnected' : 'timeout', mayHaveBeenSent: true });
    if (mode === 'cancel' || mode === 'disconnect') expect(sent).toBe(true);
    if (mode === 'timeout' && !sent) {
      const operations = f.frames.filter(frame => frame.method === 'command/exec/write').map(frame => JSON.parse(Buffer.from((frame.params as Record<string, string>).deltaBase64!, 'base64').toString()));
      expect(operations.filter(value => ['chunk', 'stage', 'commit'].includes(value.op))).toEqual([]);
      process.stdout.write(JSON.stringify({ test: 'timeout-before-producer', entered: false, timeoutMs: 50, dataWrites: 0 }) + '\n');
    }
    expect(f.frames.filter(frame => frame.method === 'command/exec').length).toBeLessThanOrEqual(3);
    await expect(readFile(join(f.directory, 'cancelled'))).rejects.toMatchObject({ code: 'ENOENT' });
  }
});

it('生产者已经实际调用后绝对期限耗尽仍拒绝交付且不发送chunk或commit', async () => {
  const f = await prepared(); const path = join(f.directory, 'producer-timeout'); let entered = false;
  async function* waiting(): AsyncGenerator<Uint8Array> { entered = true; await new Promise(() => {}); }
  // 独立证明生产者阶段；原取消/超时用例仍保留50ms预算与READY前耗尽边界。
  const pending = f.files.upload(path, waiting(), { size: 1, sha256: sha(Buffer.from('x')), expectedVersion: null, timeoutMs: 1000 }).catch(error => error);
  await until(() => entered); expect(await pending).toMatchObject({ code: 'timeout', mayHaveBeenSent: true });
  const operations = f.frames.filter(frame => frame.method === 'command/exec/write').map(frame => JSON.parse(Buffer.from((frame.params as Record<string, string>).deltaBase64!, 'base64').toString()));
  expect(operations.filter(value => ['chunk', 'stage', 'commit'].includes(value.op))).toEqual([]); await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  process.stdout.write(JSON.stringify({ test: 'producer-entered-timeout', entered, timeoutMs: 1000, dataWrites: 0 }) + '\n');
});

it('commit响应未知保留可查询目标事实且不自动重做', async () => {
  const f = await prepared(); const path = join(f.directory, 'unknown'); f.dropCommit();
  const error = await f.files.upload(path, input(Buffer.from('final')), { size: 5, sha256: sha(Buffer.from('final')), expectedVersion: null }).catch(error => error);
  expect(error).toMatchObject({ mayHaveBeenSent: true, outcome: 'unknown' }); expect(error.operation).toBeDefined();
  const fact = await f.files.queryUpload(error.operation); expect(fact.state).toBe('committed'); expect(await readFile(path, 'utf8')).toBe('final');
  const commits = f.frames.filter(frame => frame.method === 'command/exec/write' && Buffer.from((frame.params as Record<string, string>).deltaBase64!, 'base64').includes(Buffer.from('"op":"commit"')));
  expect(commits).toHaveLength(1);
});

it('可序列化receipt可由新适配器对账，持久交接后显式释放且不删除后来替换的目的文件', async () => {
  const f = await prepared(); const path = join(f.directory, 'receipt'); const data = Buffer.from('committed');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  const saved = JSON.parse(JSON.stringify(result.operation)); expect(await readdir(saved.token.directory)).toEqual(['lock', 'receipt']);
  const { RemoteFiles } = await import('../../server/remote/files.js'); const other = await RemoteFiles.create(f.session, scope); cleanup.push(() => other.close());
  expect(await other.queryUpload(saved)).toMatchObject({ state: 'committed', size: data.length, currentMatches: true });
  await writeFile(path + '.new', 'user replacement'); await rename(path + '.new', path);
  expect(await other.queryUpload(saved)).toMatchObject({ state: 'committed', currentMatches: false });
  await other.releaseUpload(saved); expect(await readFile(path, 'utf8')).toBe('user replacement');
  await expect(readdir(saved.token.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readdir(f.directory)).toEqual(['receipt']);
});

it('已持久提交版本在同inode同内容touch后保持历史事实且currentMatches为false', async () => {
  const f = await prepared(); const path = join(f.directory, 'touched-commit'); const data = Buffer.from('unchanged-content');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  await utimes(path, new Date(1000), new Date(1000));
  expect(await f.files.queryUpload(JSON.parse(JSON.stringify(result.operation)))).toMatchObject({ state: 'committed', version: result.version, currentMatches: false });
  await f.files.releaseUpload(result.operation); expect(await readFile(path)).toEqual(data);
});

it('清理原子捕获operation后真实进程中断仍可由原收据查询和精确恢复', async () => {
  const f = await prepared(); const path = join(f.directory, 'cleanup-interrupted'); const data = Buffer.from('retained-result');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  const marker = join(f.directory, 'capture-visited');
  f.script(source => source.replace('ready_at=time.monotonic()', String.raw`_capture=capture_noreplace
def capture_noreplace(src,dst):
    result=_capture(src,dst)
    if os.path.basename(src).startswith('.codex-mobile-upload-') and os.path.basename(dst)=='entry' and os.path.basename(os.path.dirname(dst)).startswith('.codex-mobile-cleanup-'):
        with open(` + JSON.stringify(marker) + String.raw`,'w') as marker: marker.write('operation captured')
        os._exit(0)
    return result
ready_at=time.monotonic()`));
  await expect(f.files.releaseUpload(result.operation)).rejects.toMatchObject({ code: 'protocol', mayHaveBeenSent: true }); f.script(undefined);
  expect(await readFile(marker, 'utf8')).toBe('operation captured'); await rm(marker);
  const saved = JSON.parse(JSON.stringify(result.operation));
  expect(await f.files.queryUpload(saved)).toMatchObject({ state: 'committed', version: result.version, currentMatches: true });
  const child = spawn(process.execPath, ['--import', 'tsx', new URL('./fixtures/remote-files-recover-worker.ts', import.meta.url).pathname], { stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage' } });
  let stdout = ''; let stderr = ''; child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
  child.stdin.end(JSON.stringify({ directory: f.directory, operation: saved }));
  expect(await new Promise<number | null>(resolve => child.on('close', resolve))).toBe(0); expect(stderr).toBe('');
  expect(JSON.parse(stdout)).toMatchObject({ state: 'committed', version: result.version, currentMatches: true });
  await f.files.releaseUpload(saved); expect(await readdir(f.directory)).toEqual(['cleanup-interrupted']); expect(await readFile(path)).toEqual(data);
});

it.each(['receipt', 'lock', 'removed-receipt', 'removed-lock', 'captured-journal', 'removed-journal'])('清理%s子项后实际退出仍保留原locator的恢复事实和回收能力', async phase => {
  const f = await prepared(); const path = join(f.directory, 'cleanup-child'); const data = Buffer.from('kept');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  const marker = join(f.directory, 'phase-visited');
  f.script(source => String.raw`import os
_unlink=os.unlink;_phase=` + JSON.stringify(phase) + String.raw`
def _interrupted():
    with open(` + JSON.stringify(marker) + String.raw`,'w') as marker: marker.write(_phase)
    os._exit(0)
def _interrupt_unlink(path,*args,**kwargs):
    result=_unlink(path,*args,**kwargs)
    parent=os.path.basename(os.path.dirname(path));name=os.path.basename(path)
    if (parent=='files' and ((_phase=='removed-receipt' and name=='receipt') or (_phase=='removed-lock' and name=='writer-lock'))) or (_phase=='removed-journal' and path.endswith('.receipt.captured')): _interrupted()
    return result
os.unlink=_interrupt_unlink
` + source.replace('ready_at=time.monotonic()', String.raw`_capture=capture_noreplace
def capture_noreplace(src,dst):
    result=_capture(src,dst)
    if os.path.basename(src)==_phase and os.path.basename(os.path.dirname(src))=='entry': _interrupted()
    return result
_capture_journal=capture_journal
def capture_journal(source,target):
    result=_capture_journal(source,target)
    if _phase=='captured-journal': _interrupted()
    return result
ready_at=time.monotonic()`));
  await expect(f.files.releaseUpload(result.operation)).rejects.toMatchObject({ code: 'protocol' }); f.script(undefined);
  expect(await readFile(marker, 'utf8')).toBe(phase); await rm(marker);
  const saved = JSON.parse(JSON.stringify(result.operation));
  if (phase === 'removed-journal') { expect(await f.files.queryUpload(saved)).toEqual({ state: 'missing' }); expect(await readdir(f.directory)).toEqual(['cleanup-child']); return; }
  expect(await f.files.queryUpload(saved)).toMatchObject({ state: 'committed', version: result.version, currentMatches: true });
  if (phase === 'captured-journal') {
    for (const key of ['directoryIdentity', 'receiptIdentity', 'payloadIdentity', 'lockIdentity', 'cleanupIdentity', 'cleanupLockIdentity', 'cleanupFilesIdentity']) delete saved.token[key];
    const child = spawn(process.execPath, ['--import', 'tsx', new URL('./fixtures/remote-files-recover-worker.ts', import.meta.url).pathname], { stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage' } });
    let stdout = ''; let stderr = ''; child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
    child.stdin.end(JSON.stringify({ directory: f.directory, operation: saved }));
    expect(await new Promise<number | null>(resolve => child.on('close', resolve))).toBe(0); expect(stderr).toBe(''); expect(JSON.parse(stdout)).toMatchObject({ state: 'committed', version: result.version, currentMatches: true });
  }
  await f.files.releaseUpload(saved); expect(await readdir(f.directory)).toEqual(['cleanup-child']); expect(await readFile(path)).toEqual(data);
});

it('开始响应未知的locator在discard捕获payload后中断仍可由新适配器精确完成', async () => {
  const f = await prepared(); const path = join(f.directory, 'uncommitted');
  f.transform(line => {
    if (!line.toString().startsWith('CMFILE1_READY:') && JSON.parse(line.toString()).kind === 'upload') { f.stream.emit('disconnect', { reason: 'network', mayHaveBeenSent: true }); return Buffer.alloc(0); }
    return line;
  });
  const error = await f.files.upload(path, input(Buffer.from('x')), { size: 1, sha256: sha(Buffer.from('x')), expectedVersion: null }).catch(error => error); f.transform(undefined);
  const saved = JSON.parse(JSON.stringify(error.operation)); expect(saved.token).not.toHaveProperty('directoryIdentity');
  const marker = join(f.directory, 'discard-captured');
  f.script(source => source.replace('ready_at=time.monotonic()', String.raw`_capture=capture_noreplace
def capture_noreplace(src,dst):
    result=_capture(src,dst)
    if os.path.basename(src)=='payload' and os.path.basename(os.path.dirname(src))=='entry':
        with open(` + JSON.stringify(marker) + String.raw`,'w') as marker: marker.write('payload captured')
        os._exit(0)
    return result
ready_at=time.monotonic()`));
  await expect(f.files.discardUpload(saved)).rejects.toMatchObject({ code: 'protocol' }); f.script(undefined);
  expect(await readFile(marker, 'utf8')).toBe('payload captured'); await rm(marker);
  const { RemoteFiles } = await import('../../server/remote/files.js'); const other = await RemoteFiles.create(f.session, scope); cleanup.push(() => other.close());
  expect((await other.queryUpload(saved)).state).not.toBe('missing');
  await other.discardUpload(saved); expect(await readdir(f.directory)).toEqual([]);
});

it('两清理者只允许实际持有稳定清理锁的一方推进捕获和删除', async () => {
  const f = await prepared(); const path = join(f.directory, 'two-cleaners'); const data = Buffer.from('unchanged');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null }); const marker = join(f.directory, 'cleaner-held');
  f.script(source => source.replace('ready_at=time.monotonic()', String.raw`_acquire=acquire_lock
def acquire_lock(handle):
    _acquire(handle)
    if identity(os.fstat(handle.fileno()))==token['cleanupLockIdentity']:
        with open(` + JSON.stringify(marker) + String.raw`,'wb') as marker: marker.write(b'held')
        time.sleep(.2)
ready_at=time.monotonic()`));
  const first = f.files.releaseUpload(result.operation); await until(() => existsSync(marker));
  await expect(f.files.releaseUpload(result.operation)).rejects.toMatchObject({ code: 'version' }); await first;
  await rm(marker); expect(await readdir(f.directory)).toEqual(['two-cleaners']); expect(await readFile(path)).toEqual(data);
});

it('固定清理入口被移走时不把仍有自有receipt和写者锁的operation误报missing', async () => {
  const f = await prepared(); const path = join(f.directory, 'missing-cleanup-proof'); const data = Buffer.from('safe');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  const root = join(f.directory, '.codex-mobile-cleanup-' + String(result.operation.token.id)); await rename(root, root + '.preserved');
  await expect(f.files.queryUpload(result.operation)).rejects.toMatchObject({ code: 'version' });
  expect(await readdir(result.operation.token.directory as string)).toEqual(['lock', 'receipt']); expect(await readFile(path)).toEqual(data);
});

it('原operation目录被外部移走但稳定清理收据尚存时不能误报missing', async () => {
  const f = await prepared(); const path = join(f.directory, 'moved-operation'); const data = Buffer.from('kept');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  const directory = result.operation.token.directory as string; await rename(directory, directory + '.preserved');
  await expect(f.files.queryUpload(result.operation)).rejects.toMatchObject({ code: 'version' });
  expect(await readdir(directory + '.preserved')).toEqual(['lock', 'receipt']); expect(await readFile(path)).toEqual(data);
});

it('第二清理者已打开旧锁但尚未取锁时不能推进已完成或同名替换的清理根', async () => {
  const f = await prepared(); const path = join(f.directory, 'old-lock'); const data = Buffer.from('safe');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null }); const marker = join(f.directory, 'opened-lock');
  f.script(source => source.replace('ready_at=time.monotonic()', String.raw`_lock_file=lock_file
def lock_file(path,create=False):
    handle=_lock_file(path,create)
    if not create and identity(os.fstat(handle.fileno()))==token['cleanupLockIdentity']:
        with open(` + JSON.stringify(marker) + String.raw`,'wb') as marker: marker.write(b'opened')
        time.sleep(.25)
    return handle
ready_at=time.monotonic()`));
  const delayed = f.files.releaseUpload(result.operation).catch(error => error); await until(() => existsSync(marker)); f.script(undefined);
  await f.files.releaseUpload(result.operation);
  const root = join(f.directory, '.codex-mobile-cleanup-' + String(result.operation.token.id)); await mkdir(root); await writeFile(join(root, 'user-file'), 'replacement');
  expect(await delayed).toMatchObject({ code: 'version' }); expect(await readFile(join(root, 'user-file'), 'utf8')).toBe('replacement'); expect(await readFile(path)).toEqual(data);
});

it('最终清理journal捕获到同名替换物时保留实际捕获内容并失败关闭', async () => {
  const f = await prepared(); const path = join(f.directory, 'journal-race'); const data = Buffer.from('safe');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  f.script(source => source.replace('ready_at=time.monotonic()', String.raw`_capture_journal=capture_journal
def capture_journal(source,target):
    os.rename(source,source+'.preserved')
    with open(source,'wb') as unknown: unknown.write(b'user replacement')
    return _capture_journal(source,target)
ready_at=time.monotonic()`));
  const error = await f.files.releaseUpload(result.operation).catch(error => error); expect(error).toMatchObject({ code: 'version', mayHaveBeenSent: true }); expect(error.operation).toEqual(result.operation);
  const root = join(f.directory, '.codex-mobile-cleanup-' + String(result.operation.token.id)); expect(await readFile(root + '.receipt.captured', 'utf8')).toBe('user replacement'); expect(await readFile(path)).toEqual(data);
});

it('最后目标journal删除前所有自有容器已移除，不留下只能凭token收尾的空根', async () => {
  const f = await prepared(); const path = join(f.directory, 'last-receipt'); const data = Buffer.from('safe');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null }); const root = join(f.directory, '.codex-mobile-cleanup-' + String(result.operation.token.id)); const marker = join(f.directory, 'final-layout');
  f.script(source => String.raw`import os,json
_unlink=os.unlink
def _last_unlink(path,*args,**kwargs):
    if os.path.basename(path)=='journal' or path.endswith('.receipt.captured'):
        with open(` + JSON.stringify(marker) + String.raw`,'w') as marker: json.dump(dict(root=os.path.lexists(` + JSON.stringify(root) + String.raw`),files=os.path.lexists(os.path.join(` + JSON.stringify(root) + String.raw`,'files'))),marker)
        result=_unlink(path,*args,**kwargs);os._exit(0)
    return _unlink(path,*args,**kwargs)
os.unlink=_last_unlink
` + source);
  await expect(f.files.releaseUpload(result.operation)).rejects.toMatchObject({ code: 'protocol' }); f.script(undefined);
  expect(JSON.parse(await readFile(marker, 'utf8'))).toEqual({ root: false, files: false });
  expect(await f.files.queryUpload(result.operation)).toEqual({ state: 'missing' }); expect(await readFile(path)).toEqual(data);
});

it('目标已无可认证journal时不能仅凭完整token删除仍存在的空清理根', async () => {
  const f = await prepared(); const path = join(f.directory, 'no-receipt-proof'); const data = Buffer.from('safe');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null }); const root = join(f.directory, '.codex-mobile-cleanup-' + String(result.operation.token.id));
  await rm(result.operation.token.directory as string, { recursive: true }); await rm(join(root, 'lock'), { force: true }); await rm(root + '.receipt', { force: true });
  await expect(f.files.releaseUpload(result.operation)).rejects.toMatchObject({ code: 'version' }); expect(await readdir(root)).toEqual(['files']);
});

it.each(['preexisting', 'concurrent'])('最后journal的no-replace捕获拒绝%s同名文件且不覆盖未知内容', async timing => {
  const f = await prepared(); const path = join(f.directory, 'no-replace'); const data = Buffer.from('safe');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null }); const journal = join(f.directory, '.codex-mobile-cleanup-' + String(result.operation.token.id) + '.receipt');
  if (timing === 'preexisting') await writeFile(journal + '.captured', 'user replacement');
  else f.script(source => source.replace('ready_at=time.monotonic()', String.raw`_capture_journal=capture_journal
def capture_journal(source,target):
    with open(target,'xb') as unknown: unknown.write(b'user replacement')
    return _capture_journal(source,target)
ready_at=time.monotonic()`));
  await expect(f.files.releaseUpload(result.operation)).rejects.toMatchObject({ code: 'version' });
  expect(await readFile(journal + '.captured', 'utf8')).toBe('user replacement'); expect(JSON.parse((await readFile(journal, 'utf8')).split('\n')[0]!)).toEqual(result.operation.token);
  await expect(f.files.queryUpload(result.operation)).rejects.toMatchObject({ code: 'version' }); expect(await readFile(path)).toEqual(data);
});

const captureDestinationCases = ['operation', 'commit', 'receipt', 'writer-lock', 'journal'].flatMap(slot => ['file', 'directory', 'symlink'].flatMap(type => ['preexisting', 'concurrent'].map(timing => ({ slot, type, timing }))));
it.each(captureDestinationCases)('捕获目的地原子拒绝覆盖：$slot/$type/$timing', async ({ slot, type, timing }) => {
  const f = await prepared(); const path = join(f.directory, 'destination'); const data = Buffer.from('user destination remains safe');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  const root = join(f.directory, '.codex-mobile-cleanup-' + String(result.operation.token.id));
  const target = slot === 'journal' ? root + '.receipt.captured' : slot === 'operation' ? join(root, 'entry') : slot === 'commit' ? join(root, 'commit') : join(root, 'files', slot);
  const marker = join(f.directory, 'race-created'); const referent = join(f.directory, 'unknown-referent'); await writeFile(referent, 'unknown referent');
  const statIdentity = async (path: string) => { const s = await lstat(path, { bigint: true }); return { dev: String(s.dev), ino: String(s.ino), mode: String(s.mode) }; };
  let unknownIdentity: Record<string, string>;
  if (timing === 'preexisting') {
    if (type === 'file') await writeFile(target, 'UNKNOWN-USER-CAPTURE-DESTINATION');
    else if (type === 'directory') await mkdir(target);
    else await symlink(referent, target);
    unknownIdentity = await statIdentity(target);
  } else {
    // 同一断言同时观察旧普通rename与真实no-replace原语，注入位于检查之后、实际捕获之前。
    f.script(source => source.replace('ready_at=time.monotonic()', String.raw`_race_target=` + JSON.stringify(target) + String.raw`
_race_type=` + JSON.stringify(type) + String.raw`
_raced=False
def _before_capture(src,dst):
    global _raced
    if dst!=_race_target or _raced: return
    _raced=True
    if _race_type=='file':
        with open(dst,'xb') as unknown: unknown.write(b'UNKNOWN-USER-CAPTURE-DESTINATION')
    elif _race_type=='directory': os.mkdir(dst)
    else: os.symlink(` + JSON.stringify(referent) + String.raw`,dst)
    with open(` + JSON.stringify(marker) + String.raw`,'w') as marker: json.dump(identity(os.lstat(dst)),marker)
def _capture_race(function):
    def wrapped(src,dst,*args,**kwargs):
        _before_capture(src,dst)
        return function(src,dst,*args,**kwargs)
    return wrapped
os.rename=_capture_race(os.rename)
for _name in ('capture_noreplace','capture_journal'):
    if _name in globals(): globals()[_name]=_capture_race(globals()[_name])
ready_at=time.monotonic()`));
  }
  const error = await f.files.releaseUpload(result.operation).then(() => null, error => error); f.script(undefined);
  if (timing === 'concurrent') unknownIdentity = JSON.parse(await readFile(marker, 'utf8'));
  // 先核对真实未知inode/内容；不能仅因错误分类碰巧正确而遗漏覆盖和删除。
  expect(await statIdentity(target)).toEqual(unknownIdentity!);
  if (type === 'file') expect(await readFile(target, 'utf8')).toBe('UNKNOWN-USER-CAPTURE-DESTINATION');
  else if (type === 'directory') expect(await readdir(target)).toEqual([]);
  else expect(await readlink(target)).toBe(referent);
  expect(await readFile(referent, 'utf8')).toBe('unknown referent'); expect(await readFile(path)).toEqual(data);
  expect(error).toMatchObject({ code: 'version', mayHaveBeenSent: true }); expect(error.operation).toEqual(result.operation);
  // 测试方显式移走未知物后，原持久operation仍可对账和继续清理。
  await rename(target, join(f.directory, 'unknown-preserved'));
  const saved = JSON.parse(JSON.stringify(result.operation));
  if (slot === 'receipt' && type === 'file' && timing === 'concurrent') {
    const child = spawn(process.execPath, ['--import', 'tsx', new URL('./fixtures/remote-files-recover-worker.ts', import.meta.url).pathname], { stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage' } });
    let stdout = ''; let stderr = ''; child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); }); child.stdin.end(JSON.stringify({ directory: f.directory, operation: saved }));
    expect(await new Promise<number | null>(resolve => child.on('close', resolve))).toBe(0); expect(stderr).toBe(''); expect(JSON.parse(stdout)).toMatchObject({ state: 'committed', version: result.version, currentMatches: true });
  }
  expect(await f.files.queryUpload(saved)).toMatchObject({ state: 'committed', version: result.version, currentMatches: true });
  await f.files.releaseUpload(saved); expect(await f.files.queryUpload(saved)).toEqual({ state: 'missing' });
  expect(await statIdentity(join(f.directory, 'unknown-preserved'))).toEqual(unknownIdentity!); expect(await readFile(path)).toEqual(data);
});

it.each(['file', 'directory', 'symlink'].flatMap(type => ['preexisting', 'concurrent'].map(timing => ({ type, timing }))))('提交前payload捕获目的地拒绝覆盖：$type/$timing', async ({ type, timing }) => {
  const f = await prepared(); const path = join(f.directory, 'original'); await writeFile(path, 'original user contents'); const stat = await f.files.stat(path);
  const marker = join(f.directory, 'payload-capture-race'); const referent = join(f.directory, 'unknown-referent'); await writeFile(referent, 'unknown referent');
  f.script(source => source.replace('ready_at=time.monotonic()', String.raw`_raced=False
def _occupy(dst):
    global _raced
    if _raced: return
    _raced=True
    if ` + JSON.stringify(type) + String.raw`=='file':
        with open(dst,'xb') as unknown: unknown.write(b'UNKNOWN-COMMIT-CAPTURE')
    elif ` + JSON.stringify(type) + String.raw`=='directory': os.mkdir(dst)
    else: os.symlink(` + JSON.stringify(referent) + String.raw`,dst)
    with open(` + JSON.stringify(marker) + String.raw`,'w') as marker: json.dump(dict(path=dst,identity=identity(os.lstat(dst))),marker)
_private=private_directory
def private_directory(prefix,parent):
    result=_private(prefix,parent)
    if ` + JSON.stringify(timing) + String.raw`=='preexisting' and prefix.startswith('.codex-mobile-commit-'): _occupy(os.path.join(result,'payload'))
    return result
_capture=capture_noreplace
def capture_noreplace(src,dst):
    if ` + JSON.stringify(timing) + String.raw`=='concurrent' and os.path.basename(src)=='payload' and os.path.basename(os.path.dirname(src)).startswith('.codex-mobile-upload-') and os.path.basename(os.path.dirname(dst)).startswith('.codex-mobile-commit-'): _occupy(dst)
    return _capture(src,dst)
ready_at=time.monotonic()`));
  const error = await f.files.upload(path, input(Buffer.from('new')), { size: 3, sha256: sha(Buffer.from('new')), expectedVersion: stat.version }).catch(error => error); f.script(undefined);
  const visited = JSON.parse(await readFile(marker, 'utf8')); const s = await lstat(visited.path, { bigint: true });
  expect({ dev: String(s.dev), ino: String(s.ino), mode: String(s.mode) }).toEqual(visited.identity);
  if (type === 'file') expect(await readFile(visited.path, 'utf8')).toBe('UNKNOWN-COMMIT-CAPTURE');
  else if (type === 'directory') expect(await readdir(visited.path)).toEqual([]);
  else expect(await readlink(visited.path)).toBe(referent);
  expect(error).toMatchObject({ code: 'version', mayHaveBeenSent: true }); expect(error.operation).toBeDefined(); expect(await readFile(path, 'utf8')).toBe('original user contents');
  await rename(visited.path, join(f.directory, 'unknown-preserved'));
  if (type === 'file' && timing === 'concurrent') {
    const child = spawn(process.execPath, ['--import', 'tsx', new URL('./fixtures/remote-files-recover-worker.ts', import.meta.url).pathname], { stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage' } });
    let stdout = ''; let stderr = ''; child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); }); child.stdin.end(JSON.stringify({ directory: f.directory, operation: JSON.parse(JSON.stringify(error.operation)) }));
    expect(await new Promise<number | null>(resolve => child.on('close', resolve))).toBe(0); expect(stderr).toBe(''); expect(JSON.parse(stdout)).toMatchObject({ state: 'staged', size: 3, sha256: sha(Buffer.from('new')) });
  }
  expect(await f.files.queryUpload(error.operation)).toMatchObject({ state: 'staged', size: 3, sha256: sha(Buffer.from('new')) });
  await f.files.discardUpload(error.operation); expect(await f.files.queryUpload(error.operation)).toEqual({ state: 'missing' }); expect(await readFile(path, 'utf8')).toBe('original user contents');
});

it.each(['ENOTEMPTY', 'EISDIR', 'ENOTDIR'])('目标捕获原语的%s占用错误固定为version且不删除任何原内容', async code => {
  const f = await prepared(); const path = join(f.directory, 'fixed-errors'); const data = Buffer.from('original');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  f.script(source => String.raw`import ctypes,errno
class _OccupiedFunction:
    def __call__(self,*args): ctypes.set_errno(getattr(errno,` + JSON.stringify(code) + String.raw`));return -1
class _OccupiedFilesystem:
    renamex_np=_OccupiedFunction();renameat2=_OccupiedFunction()
ctypes.CDLL=lambda *args,**kwargs: _OccupiedFilesystem()
` + source);
  await expect(f.files.releaseUpload(result.operation)).rejects.toMatchObject({ code: 'version', mayHaveBeenSent: true }); f.script(undefined);
  expect(await f.files.queryUpload(result.operation)).toMatchObject({ state: 'committed', version: result.version, currentMatches: true }); await f.files.releaseUpload(result.operation); expect(await readFile(path)).toEqual(data);
});

it.each(['payload', 'commit-payload'].flatMap(slot => ['file', 'directory', 'symlink'].flatMap(type => ['preexisting', 'concurrent'].map(timing => ({ slot, type, timing })))))('discard子项捕获拒绝未知目的：$slot/$type/$timing', async ({ slot, type, timing }) => {
  const f = await prepared(); const path = join(f.directory, 'never-committed'); const data = Buffer.from('staged');
  f.script(source => source.replace('ready_at=time.monotonic()', slot === 'payload' ? String.raw`_receive=receive
def receive():
    value=_receive()
    if value.get('op')=='commit': raise OSError('test before capture')
    return value
ready_at=time.monotonic()` : String.raw`def _no_commit(*args,**kwargs): raise OSError('test after capture')
os.replace=_no_commit
ready_at=time.monotonic()`));
  const uploadError = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null }).catch(error => error); f.script(undefined);
  expect(await f.files.queryUpload(uploadError.operation)).toMatchObject({ state: 'staged', size: data.length, sha256: sha(data) });
  const root = join(f.directory, '.codex-mobile-cleanup-' + String(uploadError.operation.token.id)); const target = join(root, 'files', slot);
  const marker = join(f.directory, 'discard-capture-race'); const referent = join(f.directory, 'unknown-referent'); await writeFile(referent, 'unknown referent');
  const statIdentity = async (path: string) => { const s = await lstat(path, { bigint: true }); return { dev: String(s.dev), ino: String(s.ino), mode: String(s.mode) }; };
  let unknownIdentity: Record<string, string>;
  if (timing === 'preexisting') {
    if (type === 'file') await writeFile(target, 'UNKNOWN-DISCARD-CAPTURE');
    else if (type === 'directory') await mkdir(target);
    else await symlink(referent, target);
    unknownIdentity = await statIdentity(target);
  } else f.script(source => source.replace('ready_at=time.monotonic()', String.raw`_capture=capture_noreplace
def capture_noreplace(src,dst):
    if dst==` + JSON.stringify(target) + String.raw`:
        if ` + JSON.stringify(type) + String.raw`=='file':
            with open(dst,'xb') as unknown: unknown.write(b'UNKNOWN-DISCARD-CAPTURE')
        elif ` + JSON.stringify(type) + String.raw`=='directory': os.mkdir(dst)
        else: os.symlink(` + JSON.stringify(referent) + String.raw`,dst)
        with open(` + JSON.stringify(marker) + String.raw`,'w') as marker: json.dump(identity(os.lstat(dst)),marker)
    return _capture(src,dst)
ready_at=time.monotonic()`));
  await expect(f.files.discardUpload(uploadError.operation)).rejects.toMatchObject({ code: 'version', mayHaveBeenSent: true }); f.script(undefined);
  if (timing === 'concurrent') unknownIdentity = JSON.parse(await readFile(marker, 'utf8'));
  expect(await statIdentity(target)).toEqual(unknownIdentity!);
  if (type === 'file') expect(await readFile(target, 'utf8')).toBe('UNKNOWN-DISCARD-CAPTURE');
  else if (type === 'directory') expect(await readdir(target)).toEqual([]);
  else expect(await readlink(target)).toBe(referent);
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' }); await rename(target, join(f.directory, 'unknown-preserved'));
  expect(await f.files.queryUpload(uploadError.operation)).toMatchObject({ state: 'staged', size: data.length, sha256: sha(data) });
  await f.files.discardUpload(uploadError.operation); expect(await f.files.queryUpload(uploadError.operation)).toEqual({ state: 'missing' });
  expect(await statIdentity(join(f.directory, 'unknown-preserved'))).toEqual(unknownIdentity!); expect(await readFile(referent, 'utf8')).toBe('unknown referent');
});

it.each([{ phase: 'operation', foreign: '' }, { phase: 'payload', foreign: '' }, { phase: 'captured', foreign: '' }, { phase: 'deleted', foreign: '' }, { phase: 'payload', foreign: 'original' }, { phase: 'payload', foreign: 'held' }])('两次捕获拒绝或中断后独立OS重证存活payload：$phase/$foreign', async ({ phase, foreign }) => {
  const f = await prepared(); const path = join(f.directory, 'destination'); const data = Buffer.from('original staged bytes'); await writeFile(path, 'ORIGINAL'); const previous = await f.files.stat(path);
  const firstMarker = join(f.directory, 'first-marker'); const secondMarker = join(f.directory, 'second-marker');
  f.script(source => source.replace('ready_at=time.monotonic()', String.raw`_capture=capture_noreplace
def capture_noreplace(src,dst):
    if os.path.basename(src)=='payload' and os.path.basename(os.path.dirname(src)).startswith('.codex-mobile-upload-') and os.path.basename(os.path.dirname(dst)).startswith('.codex-mobile-commit-'):
        with open(dst,'xb') as unknown: unknown.write(b'FIRST-UNKNOWN')
        with open(` + JSON.stringify(firstMarker) + String.raw`,'w') as marker: json.dump(dict(source=src,target=dst),marker)
    return _capture(src,dst)
ready_at=time.monotonic()`));
  const firstError = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: previous.version }).catch(error => error); f.script(undefined);
  expect(firstError).toMatchObject({ code: 'version', mayHaveBeenSent: true }); const saved = JSON.parse(JSON.stringify(firstError.operation)); const first = JSON.parse(await readFile(firstMarker, 'utf8'));
  expect(await readFile(first.target, 'utf8')).toBe('FIRST-UNKNOWN'); await rename(first.target, join(f.directory, 'preserved-first'));
  expect(await f.files.queryUpload(saved)).toMatchObject({ state: 'staged', size: data.length, sha256: sha(data) });
  f.script(source => source.replace('ready_at=time.monotonic()', String.raw`_capture=capture_noreplace;_unlink=os.unlink;_phase=` + JSON.stringify(phase) + String.raw`
def _record(src,dst):
    with open(` + JSON.stringify(secondMarker) + String.raw`,'w') as marker: json.dump(dict(source=src,target=dst),marker)
def capture_noreplace(src,dst):
    if _phase=='operation' and os.path.basename(src).startswith('.codex-mobile-upload-') and os.path.basename(dst)=='entry':
        os.mkdir(dst);_record(src,dst)
    if _phase=='payload' and os.path.basename(src)=='payload' and os.path.basename(os.path.dirname(src))=='entry':
        with open(dst,'xb') as unknown: unknown.write(b'SECOND-UNKNOWN')
        _record(src,dst)
    result=_capture(src,dst)
    if _phase=='captured' and os.path.basename(src)=='payload' and os.path.basename(os.path.dirname(src))=='entry': _record(src,dst);os._exit(0)
    return result
def _after_unlink(path,*args,**kwargs):
    result=_unlink(path,*args,**kwargs)
    if _phase=='deleted' and os.path.basename(path)=='payload' and os.path.basename(os.path.dirname(path))=='files': _record(path,path);os._exit(0)
    return result
os.unlink=_after_unlink
ready_at=time.monotonic()`));
  await expect(f.files.discardUpload(saved)).rejects.toMatchObject({ code: phase === 'operation' || phase === 'payload' ? 'version' : 'protocol', mayHaveBeenSent: true }); f.script(undefined);
  const second = JSON.parse(await readFile(secondMarker, 'utf8'));
  if (phase === 'operation' || phase === 'payload') {
    if (phase === 'payload') expect(await readFile(second.target, 'utf8')).toBe('SECOND-UNKNOWN'); else expect(await readdir(second.target)).toEqual([]);
    await rename(second.target, join(f.directory, 'preserved-second'));
  }
  const actualPath = phase === 'operation' ? join(second.source, 'payload') : phase === 'captured' || phase === 'deleted' ? second.target : second.source;
  if (phase === 'deleted') await expect(lstat(actualPath)).rejects.toMatchObject({ code: 'ENOENT' });
  else {
    const actual = await readFile(actualPath); const identity = await lstat(actualPath, { bigint: true });
    expect(actual.length).toBe(data.length); expect(sha(actual)).toBe(sha(data)); expect(String(identity.ino)).toBe(saved.token.payloadIdentity.ino); expect(String(identity.dev)).toBe(saved.token.payloadIdentity.dev);
  }
  const begin = JSON.parse(JSON.stringify(saved)); for (const key of ['directoryIdentity', 'receiptIdentity', 'payloadIdentity', 'lockIdentity', 'cleanupIdentity', 'cleanupLockIdentity', 'cleanupFilesIdentity']) delete begin.token[key];
  if (foreign) {
    const unknown = foreign === 'original' ? dirname(first.target) : join(f.directory, '.codex-mobile-cleanup-' + String(saved.token.id), 'commit'); await mkdir(unknown); await writeFile(join(unknown, 'user-file'), 'FOREIGN-CONTAINER');
    for (const token of [saved, begin]) expect(await queryInNewProcess(f.directory, token)).toEqual({ state: 'unknown' });
    expect(await readFile(join(unknown, 'user-file'), 'utf8')).toBe('FOREIGN-CONTAINER'); await rename(unknown, join(f.directory, 'preserved-foreign'));
  }
  const fullResult = await queryInNewProcess(f.directory, saved); const beginResult = await queryInNewProcess(f.directory, begin);
  process.stdout.write(JSON.stringify({ test: 'double-capture-recovery', phase, foreign, fullResult, beginResult, actualBytes: phase === 'deleted' ? 0 : data.length }) + '\n');
  for (const result of [fullResult, beginResult]) expect(result).toMatchObject(phase === 'deleted' ? { state: 'unknown' } : { state: 'staged', size: data.length, sha256: sha(data) });
  await f.files.discardUpload(saved); expect(await f.files.queryUpload(begin)).toEqual({ state: 'missing' }); expect(await readFile(path, 'utf8')).toBe('ORIGINAL'); expect(await readFile(join(f.directory, 'preserved-first'), 'utf8')).toBe('FIRST-UNKNOWN');
  if (phase === 'payload') expect(await readFile(join(f.directory, 'preserved-second'), 'utf8')).toBe('SECOND-UNKNOWN');
});

it('没有真实清理intent时不把丢失commit目录猜成可忽略的空容器进度', async () => {
  const f = await prepared(); const path = join(f.directory, 'missing-before-intent'); const data = Buffer.from('still own staged bytes'); await writeFile(path, 'ORIGINAL'); const previous = await f.files.stat(path);
  f.script(source => source.replace('ready_at=time.monotonic()', String.raw`_capture=capture_noreplace
def capture_noreplace(src,dst):
    if os.path.basename(src)=='payload' and os.path.basename(os.path.dirname(src)).startswith('.codex-mobile-upload-') and os.path.basename(os.path.dirname(dst)).startswith('.codex-mobile-commit-'): raise OSError('test before move')
    return _capture(src,dst)
ready_at=time.monotonic()`));
  const error = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: previous.version }).catch(error => error); f.script(undefined);
  expect(error).toMatchObject({ mayHaveBeenSent: true }); const saved = JSON.parse(JSON.stringify(error.operation));
  const records = (await readFile(join(saved.token.directory, 'receipt'), 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line));
  expect(records).toHaveLength(2); expect(records[1].state).toBe('captured'); await rm(records[1].directory, { recursive: true });
  expect(await readFile(join(saved.token.directory, 'payload'))).toEqual(data);
  const begin = JSON.parse(JSON.stringify(saved)); for (const key of ['directoryIdentity', 'receiptIdentity', 'payloadIdentity', 'lockIdentity', 'cleanupIdentity', 'cleanupLockIdentity', 'cleanupFilesIdentity']) delete begin.token[key];
  for (const token of [saved, begin]) expect(await queryInNewProcess(f.directory, token)).toEqual({ state: 'unknown' });
  await expect(f.files.discardUpload(saved)).rejects.toMatchObject({ code: 'version' }); expect(await readFile(path, 'utf8')).toBe('ORIGINAL');
});

it.each(['platform', 'filesystem'])('no-replace原语不支持%s时明确capability失败并保留目标真实收据供后续恢复', async unsupported => {
  const f = await prepared(); const path = join(f.directory, 'capability'); const data = Buffer.from('safe');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  f.script(source => (unsupported === 'platform' ? "import sys\nsys.platform='unsupported-capture-platform'\n" : String.raw`import ctypes,errno
class _UnsupportedFunction:
    def __call__(self,*args): ctypes.set_errno(errno.EINVAL);return -1
class _UnsupportedFilesystem:
    renamex_np=_UnsupportedFunction();renameat2=_UnsupportedFunction()
ctypes.CDLL=lambda *args,**kwargs: _UnsupportedFilesystem()
`) + source);
  await expect(f.files.releaseUpload(result.operation)).rejects.toMatchObject({ code: 'capability', mayHaveBeenSent: true }); f.script(undefined);
  expect(await f.files.queryUpload(result.operation)).toMatchObject({ state: 'committed', version: result.version, currentMatches: true });
  await f.files.releaseUpload(result.operation); expect(await readdir(f.directory)).toEqual(['capability']);
});

it('目标receipt绑定完整namespace，跨账号/工作区/目标重包token不能借用旧证据', async () => {
  const f = await prepared(); const path = join(f.directory, 'scope'); const data = Buffer.from('scope');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  const saved = JSON.parse(JSON.stringify(result.operation)); expect(saved.token.namespace).toBe(f.files.namespace);
  saved.token.namespace = '0'.repeat(64);
  await expect(f.files.queryUpload(saved)).rejects.toMatchObject({ code: 'binding', mayHaveBeenSent: false });
  expect(await readFile(path)).toEqual(data); await f.files.releaseUpload(result.operation);
});

it('目标已建立暂存但开始响应丢失时仍提供精确操作定位，断线恢复先查询而不重放', async () => {
  const f = await prepared(); const path = join(f.directory, 'lost-begin');
  f.transform(line => {
    if (!line.toString().startsWith('CMFILE1_READY:') && JSON.parse(line.toString()).kind === 'upload') { f.stream.emit('disconnect', { reason: 'network', mayHaveBeenSent: true }); return Buffer.alloc(0); }
    return line;
  });
  const error = await f.files.upload(path, input(Buffer.from('x')), { size: 1, sha256: sha(Buffer.from('x')), expectedVersion: null }).catch(error => error);
  expect(error).toMatchObject({ code: 'disconnected', mayHaveBeenSent: true }); expect(error.operation).toBeDefined(); f.transform(undefined);
  expect(await f.files.queryUpload(JSON.parse(JSON.stringify(error.operation)))).toMatchObject({ state: 'receiving', size: 0 });
  expect(f.frames.filter(frame => frame.method === 'command/exec')).toHaveLength(3);
});

it('独立OS进程可用序列化scope收据恢复commit事实，不依赖原模块内存', async () => {
  const f = await prepared(); const path = join(f.directory, 'restart'); const data = Buffer.from('durable');
  const result = await f.files.upload(path, input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  const child = spawn(process.execPath, ['--import', 'tsx', new URL('./fixtures/remote-files-recover-worker.ts', import.meta.url).pathname], { stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage' } });
  let stdout = ''; let stderr = ''; child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
  child.stdin.end(JSON.stringify({ directory: f.directory, operation: result.operation }));
  const exit = await new Promise<number | null>(resolve => child.on('close', resolve)); expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' });
  expect(JSON.parse(stdout)).toMatchObject({ state: 'committed', size: data.length, currentMatches: true });
  await f.files.releaseUpload(result.operation);
});

it('大于100MiB文件只允许显式有界Range，元数据不触发整文件读取', async () => {
  const f = await prepared(); const path = join(f.directory, 'large-sparse'); await writeFile(path, ''); await truncate(path, 100 * 1024 * 1024 + 123);
  const value = await f.files.stat(path); expect(value.size).toBe(100 * 1024 * 1024 + 123);
  const range = await bytes(f.files.read(path, { offset: 100 * 1024 * 1024 + 100, length: 23, version: value.version })); expect(range).toHaveLength(23);
  const outcome = await bytes(f.files.read(path)).then(() => 'unexpected-success', error => error); expect(outcome).toMatchObject({ code: 'capacity' });
});

it.each([65536, 800000])('两个合法记录交界处的%s字节通知分片不扩大单条记录限制', async packetBytes => {
  const f = await prepared(); const path = join(f.directory, 'packet-boundary'); const data = Buffer.alloc(1048576, 37); await writeFile(path, data); f.packets(packetBytes);
  let held: Buffer | undefined;
  f.transform(line => {
    if (line.toString().startsWith('CMFILE1_READY:')) return line;
    if (JSON.parse(line.toString()).kind !== 'chunk') return line;
    if (!held) { held = Buffer.from(line); return Buffer.alloc(0); }
    const result = Buffer.concat([held, line]); held = undefined; return result;
  });
  expect(await bytes(f.files.read(path))).toEqual(data);
});

it('上传把64KiB生产者块聚合为512KiB有界协议窗口，RPC数不随小块放大', async () => {
  const f = await prepared(); const data = Buffer.alloc(2 * 1024 * 1024, 29);
  async function* small() { for (let n = 0; n < data.length; n += 65536) yield data.subarray(n, n + 65536); }
  const result = await f.files.upload(join(f.directory, 'coalesced'), small(), { size: data.length, sha256: sha(data), expectedVersion: null });
  const chunks = f.frames.filter(frame => frame.method === 'command/exec/write').map(frame => JSON.parse(Buffer.from((frame.params as Record<string, string>).deltaBase64!, 'base64').toString())).filter(value => value.op === 'chunk');
  expect(chunks).toHaveLength(4); expect(chunks.every(value => value.size === 524288)).toBe(true); await f.files.releaseUpload(result.operation);
});

it('跨账号新session重包内外namespace也不能冒认原目标收据', async () => {
  const f = await prepared(); const data = Buffer.from('scope-proof'); const result = await f.files.upload(join(f.directory, 'scope'), input(data), { size: data.length, sha256: sha(data), expectedVersion: null });
  const other = await fixture(); const { RemoteFiles } = await import('../../server/remote/files.js');
  const files = await RemoteFiles.create(other.session, { ...scope, managed: { ...scope.managed, accountId: 'other-account' } }); cleanup.push(() => files.close());
  const forged = JSON.parse(JSON.stringify(result.operation)); forged.namespace = files.namespace; forged.token.namespace = files.namespace;
  await expect(files.queryUpload(forged)).rejects.toMatchObject({ code: 'version', mayHaveBeenSent: true });
  expect(other.frames.filter(frame => frame.method === 'command/exec')).toHaveLength(2); expect(await readFile(result.operation.token.directory as string + '/receipt', 'utf8')).toContain(f.files.namespace);
});

it.each([{ sandboxPolicy: { type: 'dangerFullAccess' } }, { permissionProfile: 'override' }, { timeoutMs: 180001 }])('文件层不开放任意权限或延长期限%j', async patch => {
  const f = await prepared(); const before = f.frames.length; const outcome = await bytes(f.files.read(join(f.directory, 'path'), patch)).catch(error => error);
  expect(outcome).toMatchObject({ mayHaveBeenSent: false }); expect(f.frames).toHaveLength(before);
});

it('失败清理拒绝同名暂存替换物，错误不泄露生产者内容', async () => {
  const f = await prepared(); const path = join(f.directory, 'protected'); let directory = '';
  async function* source() {
    directory = join(f.directory, (await readdir(f.directory)).find(name => name.startsWith('.codex-mobile-upload-'))!);
    await rename(join(directory, 'payload'), join(directory, 'original-payload'));
    await writeFile(join(directory, 'payload'), 'user replacement'); throw new Error('source-secret-data'); yield Buffer.from('never');
  }
  const error = await f.files.upload(path, source(), { size: 5, sha256: sha(Buffer.from('never')), expectedVersion: null }).catch(error => error);
  expect(error.message).not.toContain('source-secret-data'); expect(error.operation).toBeDefined();
  expect(JSON.stringify(error)).not.toContain('.codex-mobile-upload-'); expect(inspect(error)).not.toContain('.codex-mobile-upload-');
  expect(await readFile(join(directory, 'payload'), 'utf8')).toBe('user replacement');
  expect(await readdir(directory)).toContain('receipt');
});

it('精确清理在公开路径检查后发生替换时保留捕获的替换物', async () => {
  const f = await prepared(); const marker = join(f.directory, 'source-replaced');
  f.script(source => String.raw`import os
_rename=os.rename;_unlink=os.unlink;_raced=False
def _race(path):
    global _raced
    payload=os.path.join(path,'payload') if os.path.basename(path).startswith('.codex-mobile-upload-') else path
    if not _raced and os.path.basename(payload)=='payload' and '.codex-mobile-upload-' in payload and os.path.isfile(payload):
        _raced=True;_rename(payload,payload+'.original')
        with open(payload,'wb') as f: f.write(b'user replacement')
        with open(` + JSON.stringify(marker) + String.raw`,'w') as marker: marker.write('cleanup source replaced')
def _racing_rename(src,dst,*a,**kw):
    _race(src);return _rename(src,dst,*a,**kw)
def _racing_unlink(path,*a,**kw):
    _race(path);return _unlink(path,*a,**kw)
os.rename=_racing_rename;os.unlink=_racing_unlink
` + source.replace('ready_at=time.monotonic()', String.raw`_capture=capture_noreplace
def capture_noreplace(src,dst):
    _race(src);return _capture(src,dst)
ready_at=time.monotonic()`));
  async function* failed(): AsyncGenerator<Uint8Array> { throw new Error('source-failed'); }
  const outcome = await f.files.upload(join(f.directory, 'never-created'), failed(), { size: 1, sha256: sha(Buffer.from('x')), expectedVersion: null }).catch(error => error);
  expect(outcome).toMatchObject({ mayHaveBeenSent: true });
  expect(await readFile(marker, 'utf8')).toBe('cleanup source replaced');
  const contents: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 4) throw new Error('测试目录深度越界');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.name === 'payload') contents.push(await readFile(path, 'utf8'));
    }
  }
  await visit(f.directory, 0); expect(contents).toContain('user replacement');
});

it('暂存完成后被外部修改不得原子覆盖目的文件', async () => {
  const f = await prepared(); const path = join(f.directory, 'stage-modified'); await writeFile(path, 'original'); const stat = await f.files.stat(path); let operation: unknown;
  f.transform(line => {
    if (line.toString().startsWith('CMFILE1_READY:')) return line; const value = JSON.parse(line.toString());
    if (value.kind === 'upload') operation = value.operation;
    if (value.kind === 'staged') writeFileSync(join((operation as { directory: string }).directory, 'payload'), 'BAD');
    return line;
  });
  const error = await f.files.upload(path, input(Buffer.from('new')), { size: 3, sha256: sha(Buffer.from('new')), expectedVersion: stat.version }).catch(error => error);
  expect(error).toMatchObject({ mayHaveBeenSent: true }); expect(await readFile(path, 'utf8')).toBe('original');
});

it('提交前公开payload被同名替换时先验证捕获物，不覆盖用户目的文件', async () => {
  const f = await prepared(); const path = join(f.directory, 'commit-race'); await writeFile(path, 'original'); const stat = await f.files.stat(path);
  const marker = join(f.directory, 'source-replaced');
  f.script(source => String.raw`import os
_rename=os.rename;_replace=os.replace;_raced=False
def _commit_race(src):
    global _raced
    if not _raced and os.path.basename(src)=='payload' and os.path.basename(os.path.dirname(src)).startswith('.codex-mobile-upload-'):
        _raced=True;_rename(src,src+'.original')
        with open(src,'wb') as f: f.write(b'BAD')
        with open(` + JSON.stringify(marker) + String.raw`,'w') as marker: marker.write('commit source replaced')
def _racing_rename(src,dst,*a,**kw):
    _commit_race(src);return _rename(src,dst,*a,**kw)
def _racing_replace(src,dst,*a,**kw):
    _commit_race(src);return _replace(src,dst,*a,**kw)
os.rename=_racing_rename;os.replace=_racing_replace
` + source.replace('ready_at=time.monotonic()', String.raw`_capture=capture_noreplace
def capture_noreplace(src,dst):
    _commit_race(src);return _capture(src,dst)
ready_at=time.monotonic()`));
  const error = await f.files.upload(path, input(Buffer.from('new')), { size: 3, sha256: sha(Buffer.from('new')), expectedVersion: stat.version }).catch(error => error);
  expect(await readFile(marker, 'utf8')).toBe('commit source replaced');
  expect(error).toMatchObject({ mayHaveBeenSent: true }); expect(await readFile(path, 'utf8')).toBe('original');
});

it('已捕获但原子提交尚未执行时保留可恢复的暂存完整性事实且不重放', async () => {
  const f = await prepared(); const path = join(f.directory, 'captured-not-committed'); await writeFile(path, 'original'); const stat = await f.files.stat(path);
  f.script(source => String.raw`import os
_replace=os.replace
def _fail_replace(src,dst,*a,**kw):
    if os.path.basename(os.path.dirname(src)).startswith('.codex-mobile-commit-'): raise OSError('test interruption before replace')
    return _replace(src,dst,*a,**kw)
os.replace=_fail_replace
` + source);
  const error = await f.files.upload(path, input(Buffer.from('new')), { size: 3, sha256: sha(Buffer.from('new')), expectedVersion: stat.version }).catch(error => error);
  expect(error).toMatchObject({ outcome: 'unknown', mayHaveBeenSent: true }); f.script(undefined);
  expect(await f.files.queryUpload(JSON.parse(JSON.stringify(error.operation)))).toMatchObject({ state: 'staged', size: 3, sha256: sha(Buffer.from('new')) });
  expect(await readFile(path, 'utf8')).toBe('original'); await expect(f.files.releaseUpload(error.operation)).rejects.toMatchObject({ code: 'version' });
  await f.files.discardUpload(error.operation); expect(await readdir(f.directory)).toEqual(['captured-not-committed']);
});

it('首次1s清理失败后保留receiving收据，新连接查询后可显式discard精确回收', async () => {
  const f = await prepared();
  f.script(source => String.raw`import json,time
_loads=json.loads
def _delay_cleanup(raw,*a,**kw):
    value=_loads(raw,*a,**kw)
    if type(value)==dict and value.get('mode')=='cleanup': time.sleep(2)
    return value
json.loads=_delay_cleanup
` + source);
  async function* failed() { for (let n = 0; n < 4; n++) yield Buffer.alloc(524288, 1); throw new Error('source-failed'); }
  const error = await f.files.upload(join(f.directory, 'discard'), failed(), { size: 2097153, sha256: '0'.repeat(64), expectedVersion: null }).catch(error => error); f.script(undefined);
  const { RemoteFiles } = await import('../../server/remote/files.js'); const recovery = await fixture(); const files = await RemoteFiles.create(recovery.session, scope); cleanup.push(() => files.close());
  expect(await files.queryUpload(error.operation)).toMatchObject({ state: 'receiving', size: 2097152 });
  expect(files.discardUpload).toBeTypeOf('function'); await files.discardUpload(error.operation);
  expect(await files.queryUpload(error.operation)).toMatchObject({ state: 'missing' }); expect(await readdir(f.directory)).toEqual([]);
});

it('discard拒绝仍持有同inode锁的活动写者，不清除其暂存或重放写入', async () => {
  const f = await prepared(); const controller = new AbortController(); let operation: unknown;
  f.transform(line => { if (!line.toString().startsWith('CMFILE1_READY:')) { const value = JSON.parse(line.toString()); if (value.kind === 'upload') operation = { namespace: f.files.namespace, protocol: 1, token: value.operation }; } return line; });
  async function* waiting(): AsyncGenerator<Uint8Array> { await new Promise(() => {}); }
  const pending = f.files.upload(join(f.directory, 'active'), waiting(), { size: 1, sha256: sha(Buffer.from('x')), expectedVersion: null, signal: controller.signal }).catch(error => error);
  await until(() => !!operation);
  try {
    expect(f.files.discardUpload).toBeTypeOf('function'); await expect(f.files.discardUpload(operation)).rejects.toMatchObject({ code: 'version' });
    expect(await f.files.queryUpload(operation)).toMatchObject({ state: 'receiving', size: 0 });
  } finally { controller.abort(); await pending; }
});

it('discard与release均拒绝同名替换的锁文件，不能借新锁误证原写者已结束', async () => {
  const f = await prepared(); const result = await f.files.upload(join(f.directory, 'lock-replaced'), input(Buffer.from('ok')), { size: 2, sha256: sha(Buffer.from('ok')), expectedVersion: null });
  const lock = join(result.operation.token.directory as string, 'lock'); await rename(lock, lock + '.original'); await writeFile(lock, 'user replacement');
  await expect(f.files.discardUpload(result.operation)).rejects.toMatchObject({ code: 'version' });
  await expect(f.files.releaseUpload(result.operation)).rejects.toMatchObject({ code: 'version' }); expect(await readFile(lock, 'utf8')).toBe('user replacement');
});

it('写入不把已存在的悬空symlink误判为空目标而覆盖', async () => {
  const f = await prepared(); const path = join(f.directory, 'broken-link'); const missing = join(f.directory, 'missing-original'); await symlink(missing, path);
  const outcome = await f.files.upload(path, input(Buffer.from('x')), { size: 1, sha256: sha(Buffer.from('x')), expectedVersion: null }).then(() => 'unexpected-success', error => error);
  expect(outcome).toMatchObject({ code: 'version' }); expect(await readlink(path)).toBe(missing);
});

it('release拒绝同名替换的暂存目录，不删除替换目录或用户目的文件', async () => {
  const f = await prepared(); const path = join(f.directory, 'release-safe'); const result = await f.files.upload(path, input(Buffer.from('ok')), { size: 2, sha256: sha(Buffer.from('ok')), expectedVersion: null });
  const directory = result.operation.token.directory as string; await rename(directory, directory + '.preserved'); await mkdir(directory); await writeFile(join(directory, 'receipt'), 'user replacement');
  await expect(f.files.releaseUpload(result.operation)).rejects.toMatchObject({ code: 'version' }); expect(await readFile(join(directory, 'receipt'), 'utf8')).toBe('user replacement'); expect(await readFile(path, 'utf8')).toBe('ok');
});

it('受控Windows协议只传递目标原始路径，不以网关规则改写或本地回退', async () => {
  const f = await fixture({ codexHome: 'C:\\Users\\名字\\.codex', platformFamily: 'windows', platformOs: 'windows', userAgent: 'controlled-not-windows-machine' });
  const { RemoteFiles } = await import('../../server/remote/files.js'); const files = await RemoteFiles.create(f.session, scope); cleanup.push(() => files.close());
  const path = 'C:\\Users\\名字\\a\\..\\data.bin'; await expect(files.stat(path)).rejects.toMatchObject({ code: 'invalid-input', mayHaveBeenSent: true });
  const frame = f.frames.filter(frame => frame.method === 'command/exec/write').at(-1)!; const payload = JSON.parse(Buffer.from((frame.params as Record<string, string>).deltaBase64!, 'base64').toString()); expect(payload.path).toBe(path);
  const command = f.frames.filter(frame => frame.method === 'command/exec').at(-1)!; expect((command.params as Record<string, string>).cwd).toBe('C:\\Users\\名字\\.codex');
});

it('Python3不支持和同session跨scope改绑均明确失败且没有替代连接', async () => {
  const f = await fixture(undefined, true); const { RemoteFiles } = await import('../../server/remote/files.js');
  await expect(RemoteFiles.create(f.session, scope)).rejects.toMatchObject({ code: 'python3-required' }); expect(f.frames.filter(frame => frame.method === 'command/exec')).toHaveLength(1);
  const other = await prepared(); const before = other.frames.length;
  await expect(RemoteFiles.create(other.session, { ...scope, target: { ...scope.target, installationId: 'other' } })).rejects.toMatchObject({ code: 'binding', mayHaveBeenSent: false }); expect(other.frames).toHaveLength(before);
});

it('commit收据末行因进程中断不完整时可凭初始收据与目标内容对账', async () => {
  const f = await prepared(); const path = join(f.directory, 'torn-receipt'); const result = await f.files.upload(path, input(Buffer.from('done')), { size: 4, sha256: sha(Buffer.from('done')), expectedVersion: null });
  const receipt = join(result.operation.token.directory as string, 'receipt'); const raw = await readFile(receipt); await truncate(receipt, raw.indexOf(10, raw.indexOf(10) + 1) + 11);
  expect(await f.files.queryUpload(result.operation)).toMatchObject({ state: 'committed', currentMatches: true }); await f.files.releaseUpload(result.operation);
});

it.each(['chunk-hash', 'chunk-size', 'base64', 'total-hash', 'truncated', 'extra-partial'] as const)('不接受%s损坏作为完整下载证明', async fault => {
  const f = await prepared(); const path = join(f.directory, 'proof'); await writeFile(path, Buffer.alloc(700000, 7));
  f.transform(line => {
    if (line.toString().startsWith('CMFILE1_READY:')) return line;
    const value = JSON.parse(line.toString());
    if (value.kind === 'chunk') {
      if (fault === 'chunk-hash') value.sha256 = '0'.repeat(64);
      if (fault === 'chunk-size') value.size++;
      if (fault === 'base64') value.base64 = '!!!!';
    }
    if (value.kind === 'done') {
      if (fault === 'total-hash') value.sha256 = '0'.repeat(64);
      if (fault === 'truncated') return line.subarray(0, line.length - 3);
      if (fault === 'extra-partial') return Buffer.concat([line, Buffer.from('unproved-tail')]);
    }
    return Buffer.from(JSON.stringify(value) + '\n');
  });
  const outcome = await bytes(f.files.read(path, { timeoutMs: 1000 })).then(() => 'unexpected-success', error => error);
  expect(outcome).toMatchObject({ mayHaveBeenSent: true, outcome: 'unknown' });
});

it('外层exec提前exit0也立即失败，不能冒充完整文件证明', async () => {
  const f = await prepared(); f.exitFilesWithoutProof();
  await expect(f.files.stat(join(f.directory, 'never-read'), { timeoutMs: 1000 })).rejects.toMatchObject({ code: 'protocol', mayHaveBeenSent: true });
});

it.each(['hash', 'size', 'nonce', 'raw'] as const)('DONE的%s损坏不得作为跨stream成功屏障', async fault => {
  const f = await prepared(); const path = join(f.directory, 'done'); await writeFile(path, 'proof');
  f.control(bytes => Buffer.from(fault === 'hash' ? bytes.toString().replace(/[a-f0-9]{64}/, '0'.repeat(64)) : fault === 'size' ? bytes.toString().replace(/:[1-9][0-9]*:/, ':1:') : fault === 'nonce' ? bytes.toString().replace(/DONE:[^:]+:/, 'DONE:wrong:') : 'untrusted-error-payload'));
  const error = await bytes(f.files.read(path, { timeoutMs: 1000 })).then(() => 'unexpected-success', error => error);
  expect(error).toMatchObject({ mayHaveBeenSent: true, outcome: 'unknown' });
});

it('完整输出后仍等待原exec实际终结，终结同步迟到也不交付', async () => {
  const f = await prepared(); const path = join(f.directory, 'final-barrier'); await writeFile(path, 'final'); f.holdFinal();
  let delivered = false; const pending = bytes(f.files.read(path, { timeoutMs: 500 })).then(value => { delivered = true; return value; });
  await until(() => f.processes.size === 0);
  expect(delivered).toBe(false); f.releaseFinal(); expect((await pending).toString()).toBe('final');
});

it('命令已结束但最终窗口尚未消费时仍占全局预算，取消释放窗口且不能迟到交付', async () => {
  const f = await prepared(); const path = join(f.directory, 'retained-final'); await writeFile(path, Buffer.alloc(1500000, 1));
  const controllers = Array.from({ length: 4 }, () => new AbortController()); const iterators = controllers.map(controller => f.files.read(path, { signal: controller.signal })[Symbol.asyncIterator]());
  for (const iterator of iterators) await iterator.next(); expect(f.processes.size).toBe(0);
  const fifth = await bytes(f.files.read(path)).then(() => 'unexpected-success', error => error); expect(fifth).toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  controllers.forEach(controller => controller.abort());
  for (const iterator of iterators) await expect(iterator.next()).rejects.toMatchObject({ code: 'cancelled' });
  expect((await bytes(f.files.read(path))).length).toBe(1500000);
});

it('目录最后一页暂停期间取消后不能以正常结束返回', async () => {
  const f = await prepared(); await writeFile(join(f.directory, 'item'), ''); const controller = new AbortController();
  const iterator = f.files.list(f.directory, { signal: controller.signal })[Symbol.asyncIterator](); await iterator.next(); controller.abort();
  const result = await iterator.next().then(() => 'unexpected-success', error => error); expect(result).toMatchObject({ code: 'cancelled' });
});

it('旧stream操作从READY时刻收紧到网关剩余期限，不用异机时钟或每块重置期限', async () => {
  const f = await prepared(); const path = join(f.directory, 'ready-budget'); await writeFile(path, 'x'); const before = f.frames.length;
  await f.files.stat(path, { timeoutMs: 1000 });
  const payloads = f.frames.slice(before).filter(frame => frame.method === 'command/exec/write').map(frame => JSON.parse(Buffer.from((frame.params as Record<string, string>).deltaBase64!, 'base64').toString()));
  expect(typeof payloads[0].readyBudgetMs).toBe('number'); expect(payloads[0].readyBudgetMs).toBeGreaterThan(0); expect(payloads[0].readyBudgetMs).toBeLessThanOrEqual(1000);
  expect(payloads.slice(1).every(payload => payload.readyBudgetMs === undefined)).toBe(true);
});

it('100MiB逐块上传下载验证总SHA，命令数/RPC数和双层帧尺寸有固定上界', async () => {
  const f = await prepared(); const path = join(f.directory, '100MiB'); const block = Buffer.alloc(512 * 1024); for (let i = 0; i < block.length; i++) block[i] = i % 251;
  const expected = createHash('sha256'); for (let i = 0; i < 200; i++) expected.update(block); const digest = expected.digest('hex');
  let produced = 0; async function* source() { for (let i = 0; i < 200; i++) for (let n = 0; n < block.length; n += 65536) { produced++; yield block.subarray(n, n + 65536); } }
  const before = f.frames.length; const started = performance.now(); f.summarizeFrames(); f.packets(4096);
  const result = await f.files.upload(path, source(), { size: 100 * 1024 * 1024, sha256: digest, expectedVersion: null, timeoutMs: 180000 });
  expect(produced).toBe(1600); const uploadNotifications = f.notifications(); const hash = createHash('sha256'); let size = 0; let largest = 0;
  for await (const part of f.files.read(path, { version: result.version, timeoutMs: 180000 })) { largest = Math.max(largest, part.length); size += part.length; hash.update(part); }
  expect(size).toBe(100 * 1024 * 1024); expect(hash.digest('hex')).toBe(digest); expect(largest).toBe(512 * 1024);
  const frames = f.frames.slice(before); expect(frames.filter(frame => frame.method === 'command/exec')).toHaveLength(51);
  expect(frames.filter(frame => frame.method === 'command/exec/write')).toHaveLength(203);
  const maxFrame = f.maxFrameBytes(); expect(maxFrame).toBeLessThan(1024 * 1024);
  expect(f.notifications()).toBe(uploadNotifications); expect(f.notifications()).toBeGreaterThan(0); expect(f.notifications()).toBeLessThan(65536);
  expect(f.captures).toHaveLength(50); expect(f.captures.every(value => value.stdoutBytes <= 3 * 1024 * 1024 && value.stderrBytes <= 256 && value.cap === 3 * 1024 * 1024)).toBe(true);
  process.stdout.write(JSON.stringify({ test: 'real-python-100MiB', elapsedMs: Math.round(performance.now() - started), commandCount: 51, writeRpcCount: 203, bufferedReadWindows: f.captures.length, sourceChunkBytes: 65536, sourceChunks: produced, maxFrameBytes: maxFrame, outputNotifications: f.notifications(), packetBytes: 4096, sha256: digest }) + '\n');
  await f.files.releaseUpload(result.operation);
}, 30000);


it('读取固定为每2MiB窗口一个自然退出buffered短进程，cap逐stream为3MiB且没有stdin写入', async () => {
  const f = await prepared(); const path = join(f.directory, 'buffered-窗口'); const data = Buffer.alloc(4 * 1024 * 1024 + 17, 63); await writeFile(path, data);
  const before = f.frames.length; const notifications = f.notifications();
  expect(await bytes(f.files.read(path))).toEqual(data);
  const frames = f.frames.slice(before); const executions = frames.filter(frame => frame.method === 'command/exec');
  expect(executions).toHaveLength(3);
  for (const frame of executions) expect(frame.params).toMatchObject({ streamStdin: false, streamStdoutStderr: false, outputBytesCap: 3 * 1024 * 1024 });
  expect(frames.filter(frame => frame.method === 'command/exec/write' || frame.method === 'command/exec/terminate')).toHaveLength(0);
  expect(f.notifications()).toBe(notifications); expect(f.processes.size).toBe(0);
});


function reproveBuffered(value: { exitCode: number; stdout: string; stderr: string }, mutate: (records: Record<string, unknown>[]) => void) {
  const records = value.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
  mutate(records); const stdout = records.map(item => JSON.stringify(item) + '\n').join('');
  return { ...value, stdout, stderr: value.stderr.replace(/:[1-9][0-9]*:[a-f0-9]{64}\n$/, ':' + Buffer.byteLength(stdout) + ':' + sha(Buffer.from(stdout)) + '\n') };
}

it.each(['window', 'position', 'offset', 'order', 'sequence', 'nonce', 'fields', 'chunk-short', 'base64-canonical', 'final-independent-hash'] as const)('buffered读取拒绝重签完整输出后的%s错误，最终窗不交付', async fault => {
  const f = await prepared(); const path = join(f.directory, 'strict-buffered'); await writeFile(path, Buffer.alloc(700003, 42));
  f.buffered(value => reproveBuffered(value, records => {
    const meta = records.find(row => row.kind === 'meta')!; const chunks = records.filter(row => row.kind === 'chunk'); const tail = records.at(-1)!;
    if (fault === 'window') meta.window = 1;
    if (fault === 'position') meta.position = 1;
    if (fault === 'offset') chunks[0]!.offset = 1;
    if (fault === 'order') [records[1], records[2]] = [records[2]!, records[1]!];
    if (fault === 'sequence') chunks[0]!.seq = 10;
    if (fault === 'nonce') tail.n = 'other';
    if (fault === 'fields') tail.unrequested = true;
    if (fault === 'chunk-short') { const part = Buffer.alloc(7, 42); Object.assign(chunks[0]!, { base64: part.toString('base64'), size: part.length, sha256: sha(part) }); }
    if (fault === 'base64-canonical') chunks[1]!.base64 = String(chunks[1]!.base64) + '=';
    if (fault === 'final-independent-hash') tail.sha256 = '0'.repeat(64);
  }));
  const iterator = f.files.read(path)[Symbol.asyncIterator]();
  await expect(iterator.next()).rejects.toMatchObject({ mayHaveBeenSent: true });
  expect(f.captures).toHaveLength(1);
});

it('buffered每窗重新打开原path且在读取前后验证FD和路径，跨窗同内容touch也失败', async () => {
  const f = await prepared(); const path = join(f.directory, 'window-version'); await writeFile(path, Buffer.alloc(2 * 1024 * 1024 + 1, 9));
  const iterator = f.files.read(path)[Symbol.asyncIterator](); for (let n = 0; n < 4; n++) expect((await iterator.next()).value).toHaveLength(512 * 1024);
  await utimes(path, new Date(), new Date(Date.now() + 5000));
  await expect(iterator.next()).rejects.toMatchObject({ code: 'version' }); expect(f.captures).toHaveLength(2);
});

it.each(['fd', 'path'] as const)('buffered最终目标独立重读前的%s版本竞争不能交付末窗', async race => {
  const f = await prepared(); const path = join(f.directory, 'hash-version'); await writeFile(path, Buffer.alloc(700001, 9));
  f.script(source => source.replace("f.seek(offset);whole=hashlib.sha256()", (race === 'fd' ? "os.utime(path,None)" : "os.rename(path,path+'.old');open(path,'wb').write(b'replaced')") + "\n            f.seek(offset);whole=hashlib.sha256()"));
  await expect(bytes(f.files.read(path))).rejects.toMatchObject({ code: 'version' });
});

it.each(['cancel', 'disconnect', 'late-response'] as const)('buffered读取%s后仅终止自有进程，不调度下一窗或接受迟到结果', async mode => {
  const f = await prepared(); const path = join(f.directory, 'cancel-buffered'); await writeFile(path, Buffer.alloc(3 * 1024 * 1024, 9));
  const controller = new AbortController(); f.holdFinal(); const before = f.frames.length;
  const pending = bytes(f.files.read(path, { signal: controller.signal, timeoutMs: 500 })).catch(error => error);
  await until(() => f.processes.size === 0 && f.frames.slice(before).some(frame => frame.method === 'command/exec'));
  if (mode === 'cancel') controller.abort();
  if (mode === 'disconnect') f.stream.emit('disconnect', { reason: 'network', mayHaveBeenSent: true });
  if (mode === 'late-response') await new Promise(resolve => setTimeout(resolve, 550));
  f.releaseFinal(); expect(await pending).toMatchObject({ code: mode === 'cancel' ? 'cancelled' : mode === 'disconnect' ? 'disconnected' : 'timeout' });
  const sent = f.frames.slice(before); expect(sent.filter(frame => frame.method === 'command/exec')).toHaveLength(1);
  const ids = new Set(sent.filter(frame => frame.method === 'command/exec').map(frame => (frame.params as Record<string, unknown>).processId));
  expect(sent.filter(frame => frame.method === 'command/exec/terminate').every(frame => ids.has((frame.params as Record<string, unknown>).processId))).toBe(true);
});

it('buffered目标忽略terminate时取消保留全局额度直到原exec实际结束', async () => {
  const f = await prepared(); const path = join(f.directory, 'ignore-stop'); await writeFile(path, 'x');
  f.script(source => 'import time\ntime.sleep(.4)\n' + source); f.ignoreTermination();
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const pending = controllers.map(controller => bytes(f.files.read(path, { signal: controller.signal, timeoutMs: 2000 })).catch(error => error));
  await until(() => f.processes.size === 4); controllers.forEach(controller => controller.abort());
  await expect(f.files.stat(path)).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  for (const item of pending) expect(await item).toMatchObject({ code: 'cancelled' });
  await until(() => f.processes.size === 0); f.script(undefined); f.ignoreTermination(false); expect((await f.files.stat(path)).size).toBe(1);
});

it('buffered与旧upload/list/stat在多个适配器和session共用四文件额度', async () => {
  const f = await prepared(); const other = await prepared(); const { RemoteFiles } = await import('../../server/remote/files.js'); const another = await RemoteFiles.create(f.session, scope); cleanup.push(() => another.close());
  const path = join(f.directory, 'shared-budget'); await writeFile(path, Buffer.alloc(3 * 1024 * 1024, 5));
  const one = f.files.read(path)[Symbol.asyncIterator](); const two = another.read(path)[Symbol.asyncIterator](); const three = other.files.list(other.directory, { pageSize: 1 })[Symbol.asyncIterator]();
  await writeFile(join(other.directory, 'item-a'), ''); await writeFile(join(other.directory, 'item-b'), '');
  await one.next(); await two.next(); await three.next();
  let entered = false; const controller = new AbortController(); async function* blocked(): AsyncGenerator<Uint8Array> { entered = true; await new Promise(() => {}); }
  const upload = other.files.upload(join(other.directory, 'new'), blocked(), { size: 1, sha256: '0'.repeat(64), expectedVersion: null, signal: controller.signal }).catch(error => error);
  await until(() => entered); await expect(another.stat(path)).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  controller.abort(); await upload; await one.return(undefined); await two.return(undefined); await three.return(undefined);
  expect((await another.stat(path)).size).toBe(3 * 1024 * 1024);
});

it('buffered窗口沿用原绝对期限且暂停消费不重置目标预算', async () => {
  const f = await prepared(); const path = join(f.directory, 'single-deadline'); await writeFile(path, Buffer.alloc(2 * 1024 * 1024 + 3, 4));
  const iterator = f.files.read(path, { timeoutMs: 1000 })[Symbol.asyncIterator](); for (let i = 0; i < 4; i++) await iterator.next();
  await new Promise(resolve => setTimeout(resolve, 100)); await iterator.next();
  const commands = f.frames.filter(frame => frame.method === 'command/exec' && (frame.params as Record<string, unknown>).streamStdin === false);
  expect(commands).toHaveLength(2); const budgets = commands.map(frame => Number(((frame.params as Record<string, unknown>).command as string[])[6]));
  expect(budgets[1]).toBeLessThan(budgets[0]! - 50); await iterator.return(undefined);
});

it('buffered读取适配器close后原共享session仍能执行RPC', async () => {
  const f = await prepared(); const path = join(f.directory, 'shared-session'); await writeFile(path, 'x');
  await bytes(f.files.read(path)); await f.files.close(); expect(f.session.ready).toBe(true);
  expect(await f.session.call('command/exec', { command: ['python3', '-c', 'print("alive")'], processId: 'owned-by-caller', streamStdin: false, streamStdoutStderr: false, outputBytesCap: 100, cwd: f.directory, timeoutMs: 1000 })).toMatchObject({ exitCode: 0, stdout: 'alive\n' });
});


it.each(['read', 'upload'] as const)('取消%s目标超过1s忽略terminate时仍占新旧共享预算，原期限才允许回收', async mode => {
  const f = await prepared(); const path = join(f.directory, 'long-ignored-stop'); await writeFile(path, Buffer.alloc(3 * 1024 * 1024, 3));
  const held = Array.from({ length: 3 }, () => f.files.read(path)[Symbol.asyncIterator]()); for (const iterator of held) await iterator.next();
  const controller = new AbortController(); f.ignoreTermination();
  let entered = false; const deadline = performance.now() + 2600;
  async function* blocked(): AsyncGenerator<Uint8Array> { entered = true; await new Promise(() => {}); }
  if (mode === 'read') f.script(source => source.replace('threading.Thread(target=watchdog,daemon=True).start()', 'time.sleep(3.5)'));
  const operation = mode === 'read' ? bytes(f.files.read(path, { signal: controller.signal, timeoutMs: 2600 })) : f.files.upload(join(f.directory, 'active-upload'), blocked(), { size: 1, sha256: '0'.repeat(64), expectedVersion: null, signal: controller.signal, timeoutMs: 2600 });
  const pending = operation.catch(error => error); await until(() => mode === 'read' ? f.processes.size === 1 : entered);
  const cancelled = performance.now(); controller.abort();
  if (mode === 'read') { expect(await pending).toMatchObject({ code: 'cancelled' }); expect(performance.now() - cancelled).toBeLessThan(500); }
  await new Promise(resolve => setTimeout(resolve, 1150));
  expect(f.processes.size).toBe(1); await expect(f.files.stat(path)).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  if (mode === 'upload') expect(await pending).toMatchObject({ code: 'cancelled' });
  await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - performance.now() + 40))); f.script(undefined); f.ignoreTermination(false);
  expect((await f.files.stat(path)).size).toBe(3 * 1024 * 1024);
  for (const iterator of held) await iterator.return(undefined);
});

it('buffered断线拒绝原exec的RPC时不能冒充实际退出而提前释放活动进程额度', async () => {
  const f = await prepared(); const path = join(f.directory, 'disconnected-active'); await writeFile(path, 'x');
  f.ignoreTermination(); f.script(source => source.replace('threading.Thread(target=watchdog,daemon=True).start()', 'time.sleep(2.5)'));
  const before = f.frames.length; const started = performance.now();
  const pending = Array.from({ length: 4 }, () => bytes(f.files.read(path, { timeoutMs: 1600 })).catch(error => error));
  await until(() => f.processes.size === 4); f.stream.emit('disconnect', { reason: 'network', mayHaveBeenSent: true });
  for (const value of pending) expect(await value).toMatchObject({ code: 'disconnected' });
  await new Promise(resolve => setTimeout(resolve, 1100));
  expect(f.processes.size).toBe(4); await expect(f.files.stat(path)).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  expect(f.frames.slice(before).filter(frame => frame.method === 'command/exec')).toHaveLength(4);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, started + 1640 - performance.now()))); f.script(undefined); f.ignoreTermination(false); expect((await f.files.stat(path)).size).toBe(1);
});

it('buffered最终窗口保留到原期限，close与期限都清除未消费窗口并拒绝迟到消费', async () => {
  for (const mode of ['deadline', 'close'] as const) {
    const f = await prepared(); const path = join(f.directory, 'retained-budget'); await writeFile(path, Buffer.alloc(700000, 5));
    const reads = Array.from({ length: 4 }, () => f.files.read(path, { timeoutMs: 700 })[Symbol.asyncIterator]()); for (const iterator of reads) await iterator.next();
    if (mode === 'close') await f.files.close(); else await new Promise(resolve => setTimeout(resolve, 750));
    for (const iterator of reads) await expect(iterator.next()).rejects.toMatchObject({ code: mode === 'close' ? 'closed' : 'timeout' });
    const { RemoteFiles } = await import('../../server/remote/files.js'); const other = await RemoteFiles.create(f.session, scope); cleanup.push(() => other.close()); expect((await other.stat(path)).size).toBe(700000);
  }
});


it.each(['read', 'stat'] as const)('%s返回不合法exec终结字段不能当实际结束事实释放原期限内的额度', async mode => {
  const f = await prepared(); const path = join(f.directory, 'malformed-termination'); await writeFile(path, 'x'); const started = performance.now();
  f.result(value => ({ ...value, exitCode: .5 }));
  const failed = Array.from({ length: 4 }, () => (mode === 'read' ? bytes(f.files.read(path, { timeoutMs: 800 })) : f.files.stat(path, { timeoutMs: 800 })).catch(error => error));
  for (const pending of failed) expect(await pending).toMatchObject({ code: 'protocol', mayHaveBeenSent: true });
  await expect(f.files.stat(path)).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  await new Promise(resolve => setTimeout(resolve, Math.max(0, started + 840 - performance.now()))); f.result(undefined);
  expect((await f.files.stat(path)).size).toBe(1);
});

it('buffered真实Python完整输出被128字节capture截断，即使exit0也拒绝交付', async () => {
  const f = await prepared(); const path = join(f.directory, 'upstream-truncated'); await writeFile(path, Buffer.alloc(4096, 7)); f.captureCap(128);
  await expect(bytes(f.files.read(path))).rejects.toMatchObject({ code: 'integrity', mayHaveBeenSent: true });
  expect(f.captures).toHaveLength(1); expect(f.captures[0]).toMatchObject({ stdoutBytes: 128, cap: 3 * 1024 * 1024 });
});

it('受控Windows buffered读取保留原路径JSON并自然退出，不声称Windows实机', async () => {
  const f = await fixture({ codexHome: 'C:\\Users\\名字\\.codex', platformFamily: 'windows', platformOs: 'windows', userAgent: 'controlled-not-windows-machine' });
  const { RemoteFiles } = await import('../../server/remote/files.js'); const files = await RemoteFiles.create(f.session, scope); cleanup.push(() => files.close());
  const path = 'C:\\Users\\名字\\a\\..\\data.bin'; const local = join(f.directory, 'controlled-windows'); await writeFile(local, Buffer.alloc(700003, 4));
  f.script(source => 'import builtins,os,ntpath\n_open=builtins.open;_stat=os.stat\n_original=' + JSON.stringify(path) + '\n_local=' + JSON.stringify(local) + '\nbuiltins.open=lambda p,*a,**kw:_open(_local if p==_original else p,*a,**kw)\nos.stat=lambda p,*a,**kw:_stat(_local if p==_original else p,*a,**kw)\nos.path.isabs=ntpath.isabs\n' + source);
  expect(await bytes(files.read(path))).toEqual(Buffer.alloc(700003, 4));
  const command = f.frames.filter(frame => frame.method === 'command/exec').at(-1)!.params as Record<string, unknown>;
  expect(command).toMatchObject({ streamStdin: false, streamStdoutStderr: false, cwd: 'C:\\Users\\名字\\.codex', outputBytesCap: 3 * 1024 * 1024 });
  expect(JSON.parse((command.command as string[])[7]!).path).toBe(path); expect(f.captures).toHaveLength(1); expect(f.processes.size).toBe(0);
});


it('已消费buffered窗口的RPC结果可回收，最终窗口暂停不经failure Promise持有整个文件', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'remote-read-retention-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'eight-MiB'); await writeFile(path, Buffer.alloc(8 * 1024 * 1024, 7));
  const child = spawn(process.execPath, ['--expose-gc', '--import', 'tsx', new URL('./fixtures/remote-files-recover-worker.ts', import.meta.url).pathname], { stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage' } });
  let stdout = ''; let stderr = ''; child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
  child.stdin.end(JSON.stringify({ directory, path, action: 'read-retention', ...(process.env.REMOTE_FILE_RETENTION_SNAPSHOT ? { snapshot: process.env.REMOTE_FILE_RETENTION_SNAPSHOT } : {}) }));
  const exit = await new Promise<number | null>(resolve => child.on('close', resolve)); expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' });
  const result = JSON.parse(stdout); process.stdout.write(JSON.stringify({ test: 'real-rpc-response-retention', ...result }) + '\n');
  expect(result).toEqual({ windows: 4, previousResults: 3, livePreviousResults: 0, activeTargetProcesses: 0, finalPaused: true });
});

it('父guard在buffered exec调用前失败不终止未启动进程或占用共享额度', async () => {
  const f = await prepared(); const path = join(f.directory, 'parent-before-exec'); await writeFile(path, 'x');
  const { RemoteFileError } = await import('../../server/remote/files.js');
  const channels = (f.files as unknown as { channels: Set<{ current?: unknown }> }).channels;
  const started = performance.now(); const before = f.frames.length; const failures: unknown[] = [];
  try {
    for (let n = 0; n < 4; n++) {
      const previous = new Set(channels);
      failures.push(await withRemoteOperation(() => {
        // 精确注入进程记录建立后的最后发送前边界，不依赖assert调用次数。
        if ([...channels].some(channel => !previous.has(channel) && channel.current)) throw new RemoteFileError('timeout', false);
      }, () => bytes(f.files.read(path, { timeoutMs: 1000 }))).catch(error => error));
    }
    const sent = f.frames.slice(before); const stat = await f.files.stat(path).catch(error => error);
    const evidence = { failures: failures.map(error => (error as { code: string }).code), fileExecs: sent.filter(frame => frame.method === 'command/exec').length, terminates: sent.filter(frame => frame.method === 'command/exec/terminate').length, activeChildren: f.processes.size, channels: channels.size, nextStat: stat.code ?? stat.size };
    process.stdout.write(JSON.stringify({ test: 'parent-before-exec', ...evidence }) + '\n');
    expect(evidence).toEqual({ failures: ['timeout', 'timeout', 'timeout', 'timeout'], fileExecs: 0, terminates: 0, activeChildren: 0, channels: 0, nextStat: 1 });
  } finally { await new Promise(resolve => setTimeout(resolve, Math.max(0, started + 1050 - performance.now()))); }
});

it.each(['deadline', 'close'] as const)('保留8个%s后暂停iterator时未交付parsed块和Buffer可回收，消费者首块仍有效', async mode => {
  const directory = await mkdtemp(join(tmpdir(), 'remote-paused-retention-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'two-MiB'); await writeFile(path, Buffer.alloc(2 * 1024 * 1024, 7));
  const child = spawn(process.execPath, ['--expose-gc', '--import', 'tsx', new URL('./fixtures/remote-files-recover-worker.ts', import.meta.url).pathname], { stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage' } });
  let stdout = ''; let stderr = ''; child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
  child.stdin.end(JSON.stringify({ directory, path, action: 'read-paused-retention', mode, ...(process.env.REMOTE_FILE_PAUSED_SNAPSHOT ? { snapshot: process.env.REMOTE_FILE_PAUSED_SNAPSHOT + '-' + mode + '.heapsnapshot' } : {}) }));
  const exit = await new Promise<number | null>(resolve => child.on('close', resolve)); expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' });
  const result = JSON.parse(stdout); process.stdout.write(JSON.stringify({ test: 'paused-payload-retention', ...result }) + '\n');
  expect(result).toEqual({ mode, heldIterators: 8, parsedChunks: 32, decodedBuffers: 32, liveParsedChunks: 0, liveUnyieldedBuffers: 0, liveCallerBuffers: 8, channels: 0, activeTargetProcesses: 0, rawResultsAlive: 0, listenersBackToBase: true, allPermitsReusable: true });
}, 15000);
