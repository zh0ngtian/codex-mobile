// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { mkdtemp, readFile, rm, writeFile, rename, readdir, truncate, mkdir, symlink, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteStream } from '../../server/remote/relay.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';
import type { JsonValue, RpcMessage } from '../../server/remote/envelope.js';
import { withRemoteOperation } from '../../server/remote/operation-guard.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0; });
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const scope = { managed: { codexHome: '/managed', accountId: 'account', accountUserId: 'member' }, target: { environmentId: 'environment', installationId: 'installation' } };
async function until(test: () => boolean) { const start = performance.now(); while (!test()) { if (performance.now() - start > 3000) throw new Error('测试条件超时'); await new Promise(resolve => setTimeout(resolve, 5)); } }
async function fixture(metadata?: Record<string, unknown>, missingPython = false) {
  const directory = await mkdtemp(join(tmpdir(), 'remote-files-'));
  const frames: RpcMessage[] = []; const processes = new Map<string, ChildProcessWithoutNullStreams>();
  let seq = 0; let outputTransform: ((bytes: Buffer) => Buffer) | undefined; let beforeWrite: (() => void) | undefined;
  let dropCommit = false; let finalHold = false; let summary = false; let maxFrameBytes = 0; let exitZero = false;
  let controlTransform: ((bytes: Buffer) => Buffer) | undefined; const finals: (() => void)[] = [];
  let scriptTransform: ((source: string) => string) | undefined;
  let packetBytes = 0;
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
      if (id.includes('file:') && scriptTransform) argv[4] = scriptTransform(argv[4]!);
      const child = spawn(argv[0]!.startsWith('C:\\Fixture\\') ? 'python3' : argv[0]!, argv.slice(1), { cwd: metadata?.platformFamily === 'windows' ? directory : p.cwd as string, env: { PATH: process.env.PATH }, detached: true }); processes.set(id, child); child.stdin.on('error', () => {});
      let lineBuffer = Buffer.alloc(0);
      child.stdout.on('data', (data: Buffer) => {
        if (metadata?.platformFamily === 'windows' && !id.includes('file:')) {
          lineBuffer = Buffer.concat([lineBuffer, data]); let end: number;
          while ((end = lineBuffer.indexOf(10)) >= 0) {
            const line = lineBuffer.subarray(0, end + 1); lineBuffer = lineBuffer.subarray(end + 1);
            if (line.toString().startsWith('CMDC1_READY:')) notify(id, 'stdout', line);
            else { const value = JSON.parse(line.toString()); value.python = 'C:\\Fixture\\python3.exe'; notify(id, 'stdout', Buffer.from(JSON.stringify(value) + '\n')); }
          } return;
        }
        if (id.includes('file:') && exitZero) { notify(id, 'stdout', data); kill(child); return; }
        if (!id.includes('file:') || !outputTransform) { notify(id, 'stdout', data); return; }
        lineBuffer = Buffer.concat([lineBuffer, data]); let end: number;
        while ((end = lineBuffer.indexOf(10)) >= 0) { const line = lineBuffer.subarray(0, end + 1); lineBuffer = lineBuffer.subarray(end + 1); const result = outputTransform(line); if (result.length) notify(id, 'stdout', result); }
      });
      child.stderr.on('data', (data: Buffer) => { const value = id.includes('file:') && controlTransform ? controlTransform(data) : data; if (value.length) notify(id, 'stderr', value); });
      child.on('error', () => respond(message, { exitCode: 127, stdout: '', stderr: '' }));
      child.on('close', code => { processes.delete(id); const final = () => respond(message, { exitCode: id.includes('file:') && exitZero ? 0 : code ?? -1, stdout: '', stderr: '' }); if (finalHold) finals.push(final); else final(); });
    } else if (message.method === 'command/exec/write') {
      beforeWrite?.(); const child = processes.get(p.processId as string); const bytes = Buffer.from(p.deltaBase64 as string, 'base64');
      if (child) { child.stdin.write(bytes); if (p.closeStdin) child.stdin.end(); }
      if (dropCommit && bytes.includes(Buffer.from('"op":"commit"'))) { dropCommit = false; setTimeout(() => stream.emit('disconnect', { reason: 'network', mayHaveBeenSent: true }), 40); }
      else queueMicrotask(() => respond(message, {}));
    } else if (message.method === 'command/exec/terminate') { const child = processes.get(p.processId as string); if (child) kill(child); queueMicrotask(() => respond(message, {})); }
    return { seqId: frames.length };
  }, () => {});
  const session = RemoteRpcSession.fromRemoteStream(stream);
  cleanup.push(async () => { for (const child of processes.values()) kill(child); session.close(); await until(() => processes.size === 0); await rm(directory, { recursive: true, force: true }); });
  await session.initialize();
  return { directory, session, stream, frames, processes, notifications() { return fileNotifications; }, packets(size: number) { packetBytes = size; }, script(fn: typeof scriptTransform) { scriptTransform = fn; }, exitFilesWithoutProof() { exitZero = true; }, control(fn: typeof controlTransform) { controlTransform = fn; }, summarizeFrames() { summary = true; }, maxFrameBytes() { return maxFrameBytes; }, transform(fn: typeof outputTransform) { outputTransform = fn; }, beforeWrite(fn: typeof beforeWrite) { beforeWrite = fn; }, dropCommit() { dropCommit = true; }, holdFinal() { finalHold = true; }, releaseFinal() { finalHold = false; for (const fn of finals.splice(0)) fn(); } };
}
async function prepared() {
  const implementation = await import('../../server/remote/files.js').catch(() => null);
  expect(implementation?.RemoteFiles, '缺少 Remote 目标文件基础').toBeTypeOf('function');
  const f = await fixture(); const files = await implementation!.RemoteFiles.create(f.session, scope);
  cleanup.push(() => files.close()); return { ...f, files };
}
async function bytes(source: AsyncIterable<Uint8Array>) { const parts: Buffer[] = []; for await (const part of source) parts.push(Buffer.from(part)); return Buffer.concat(parts); }
async function* input(data: Uint8Array) { for (let n = 0; n < data.length; n += 512 * 1024) yield data.subarray(n, n + 512 * 1024); }

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
    await expect(f.files.upload(join(f.directory, 'cancelled'), source(), { size: 1, sha256: sha(Buffer.from('x')), expectedVersion: null, signal: controller.signal, timeoutMs: mode === 'timeout' || mode === 'late' ? 50 : 1000 })).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : mode === 'disconnect' ? 'disconnected' : 'timeout', mayHaveBeenSent: true });
    if (mode !== 'late') expect(sent).toBe(true);
    expect(f.frames.filter(frame => frame.method === 'command/exec').length).toBeLessThanOrEqual(3);
    await expect(readFile(join(f.directory, 'cancelled'))).rejects.toMatchObject({ code: 'ENOENT' });
  }
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

it('两个合法记录交界处的64KiB通知分片不扩大单条记录限制', async () => {
  const f = await prepared(); const path = join(f.directory, 'packet-boundary'); const data = Buffer.alloc(1048576, 37); await writeFile(path, data); f.packets(65536);
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
    directory = join(f.directory, (await readdir(f.directory)).find(name => name.startsWith('.codex-mobile-'))!);
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
  const f = await prepared();
  f.script(source => String.raw`import os
_rename=os.rename;_unlink=os.unlink;_raced=False
def _race(path):
    global _raced
    payload=os.path.join(path,'payload') if os.path.basename(path).startswith('.codex-mobile-upload-') else path
    if not _raced and os.path.basename(payload)=='payload' and '.codex-mobile-upload-' in payload and os.path.isfile(payload):
        _raced=True;_rename(payload,payload+'.original')
        with open(payload,'wb') as f: f.write(b'user replacement')
def _racing_rename(src,dst,*a,**kw):
    _race(src);return _rename(src,dst,*a,**kw)
def _racing_unlink(path,*a,**kw):
    _race(path);return _unlink(path,*a,**kw)
os.rename=_racing_rename;os.unlink=_racing_unlink
` + source);
  async function* failed(): AsyncGenerator<Uint8Array> { throw new Error('source-failed'); }
  const outcome = await f.files.upload(join(f.directory, 'never-created'), failed(), { size: 1, sha256: sha(Buffer.from('x')), expectedVersion: null }).catch(error => error);
  expect(outcome).toMatchObject({ mayHaveBeenSent: true });
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
  f.script(source => String.raw`import os
_rename=os.rename;_replace=os.replace;_raced=False
def _commit_race(src):
    global _raced
    if not _raced and os.path.basename(src)=='payload' and os.path.basename(os.path.dirname(src)).startswith('.codex-mobile-upload-'):
        _raced=True;_rename(src,src+'.original')
        with open(src,'wb') as f: f.write(b'BAD')
def _racing_rename(src,dst,*a,**kw):
    _commit_race(src);return _rename(src,dst,*a,**kw)
def _racing_replace(src,dst,*a,**kw):
    _commit_race(src);return _replace(src,dst,*a,**kw)
os.rename=_racing_rename;os.replace=_racing_replace
` + source);
  const error = await f.files.upload(path, input(Buffer.from('new')), { size: 3, sha256: sha(Buffer.from('new')), expectedVersion: stat.version }).catch(error => error);
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
  await until(() => f.processes.size === 0 && f.frames.some(frame => frame.method === 'command/exec/terminate' && (frame.params as Record<string, string>).processId?.startsWith('codex-mobile-file:')));
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

it('目标从READY时刻收紧到网关剩余期限，不用异机时钟或每块重置期限', async () => {
  const f = await prepared(); const path = join(f.directory, 'ready-budget'); await writeFile(path, 'x'); const before = f.frames.length;
  await bytes(f.files.read(path, { timeoutMs: 1000 }));
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
  expect(produced).toBe(1600); const hash = createHash('sha256'); let size = 0; let largest = 0;
  for await (const part of f.files.read(path, { version: result.version, timeoutMs: 180000 })) { largest = Math.max(largest, part.length); size += part.length; hash.update(part); }
  expect(size).toBe(100 * 1024 * 1024); expect(hash.digest('hex')).toBe(digest); expect(largest).toBe(512 * 1024);
  const frames = f.frames.slice(before); expect(frames.filter(frame => frame.method === 'command/exec')).toHaveLength(2);
  expect(frames.filter(frame => frame.method === 'command/exec/write')).toHaveLength(254);
  const maxFrame = f.maxFrameBytes(); expect(maxFrame).toBeLessThan(1024 * 1024);
  expect(f.notifications()).toBeGreaterThan(34134); expect(f.notifications()).toBeLessThan(65536);
  process.stdout.write(JSON.stringify({ test: 'real-python-100MiB', elapsedMs: Math.round(performance.now() - started), commandCount: 2, writeRpcCount: 254, sourceChunkBytes: 65536, sourceChunks: produced, maxFrameBytes: maxFrame, outputNotifications: f.notifications(), packetBytes: 4096, sha256: digest }) + '\n');
  await f.files.releaseUpload(result.operation);
}, 30000);
