// @vitest-environment node
import { getEventListeners } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteStream } from '../../server/remote/relay.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';
import type { JsonValue, RpcMessage } from '../../server/remote/envelope.js';
import { RemoteCommands, decodeRemoteCommandText, type RemoteCommandScope } from '../../server/remote/commands.js';

const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
const scope = (): RemoteCommandScope => ({ managed: { codexHome: '/managed/canonical', accountId: 'account', accountUserId: 'member', userId: 'user' }, target: { environmentId: 'environment', installationId: 'installation' } });
async function until(check: () => boolean, ms = 2000): Promise<void> {
  const start = performance.now(); while (!check()) { if (performance.now() - start > ms) throw new Error('等待测试条件超时'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
type Fault = 'bad-probe-python' | 'truncate' | 'cap' | 'bad-base64' | 'bad-utf8' | 'bad-json' | 'bad-digest' | 'extra' | 'raw-stderr' | 'wrapper-exit' | 'wrong-stream' | 'wrong-kind' | 'bad-size' | 'bad-payload-base64' | 'bad-ending' | undefined;
async function fixture(metadata?: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), 'remote-command-test-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const processes = new Map<string, ChildProcessWithoutNullStreams>();
  const frames: RpcMessage[] = []; const ready = new Set<string>(); let fault: Fault; let missingPython = false; let pauseReady = false; let beforeWrite: (() => void) | undefined; let terminateFault: 'invalid' | 'reject' | 'no-final' | undefined; let holdFinal = false; let controlFault: 'reorder' | 'bad-hash' | 'bad-size' | 'bad-nonce' | undefined; const finalResponses: (() => void)[] = [];
  let sequence = 0;
  const respond = (message: RpcMessage, result: unknown) => stream.emit('message', { id: message.id!, result: result as JsonValue }, { seqId: ++sequence });
  const notify = (processId: string, streamName: string, data: Buffer, capReached = false, encoded?: string) => stream.emit('message', { method: 'command/exec/outputDelta', params: { processId, stream: streamName, deltaBase64: encoded ?? data.toString('base64'), capReached } }, { seqId: ++sequence });
  const kill = (child: ChildProcessWithoutNullStreams) => { try { if (process.platform === 'win32') child.kill('SIGTERM'); else if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { /* 已退出。 */ } };
  const stream = new RemoteStream('environment', 'test-stream', async (_stream, message) => {
    if (!message) return { seqId: 0 };
    frames.push(message);
    const params = (message.params ?? {}) as Record<string, JsonValue>;
    if (message.method === 'initialize') queueMicrotask(() => respond(message, metadata ?? { codexHome: directory, platformFamily: 'unix', platformOs: process.platform === 'darwin' ? 'macos' : 'linux', userAgent: 'test' }));
    else if (message.method === 'command/exec') {
      const processId = params.processId as string;
      if (missingPython) queueMicrotask(() => respond(message, { exitCode: 127, stdout: '', stderr: 'synthetic-secret PATH /private/user' }));
      else {
        const argv = params.command as string[];
        const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, CMDC_INHERITED: 'must-remove', CMDC_KEEP: 'inherited', PYTHONPATH: directory };
        for (const [key, value] of Object.entries((params.env ?? {}) as Record<string, string | null>)) { if (value === null) delete env[key]; else env[key] = value; }
        const child = spawn(argv[0]!, argv.slice(1), { cwd: params.cwd as string, env, stdio: 'pipe', detached: process.platform !== 'win32' }); processes.set(processId, child);
        let first = Buffer.alloc(0); const output: Buffer[] = [];
        const flushOutput = (data: Buffer) => {
          if (!data.length) return;
          if (fault === 'wrapper-exit') { respond(message, { exitCode: 9, stdout: '', stderr: '' }); kill(child); return; }
          if (fault === 'bad-probe-python') { const record = JSON.parse(data.toString('utf8')); record.python = '/synthetic/python-\ud800'; data = Buffer.from(JSON.stringify(record) + '\n'); }
          if (fault === 'truncate') data = data.subarray(0, Math.max(0, data.length - 20));
          if (fault === 'bad-utf8') data = Buffer.from([0xff]);
          if (fault === 'bad-json') data = Buffer.from('not-json\n');
          if (fault === 'bad-digest') data = Buffer.from(data.toString('utf8').replace(/"sha256":"[0-9a-f]+"/, '"sha256":"' + '0'.repeat(64) + '"'));
          if (fault === 'wrong-kind') { const record = JSON.parse(data.toString()); data = Buffer.from(JSON.stringify({ version: 1, kind: 'probe', nonce: record.nonce, end: record.end, python: '/synthetic/python3', major: 3 }) + '\n'); }
          if (fault === 'bad-size') data = Buffer.from(data.toString().replace(/"size":\d+/, '"size":99999'));
          if (fault === 'bad-payload-base64') data = Buffer.from(data.toString().replace(/"base64":"[^"]*"/, '"base64":"!!!"'));
          if (fault === 'bad-ending') data = Buffer.from(data.toString().replace(/"end":"[^"]*"/, '"end":"wrong"'));
          if (fault === 'extra') data = Buffer.concat([data, Buffer.from('extra')]);
          if (data.length) notify(processId, fault === 'wrong-stream' ? 'other' : 'stdout', data, fault === 'cap', fault === 'bad-base64' ? '!!!' : undefined);
        };
        child.stdin.on('error', () => {});
        child.stdout.on('data', (chunk: Buffer) => {
          if (ready.has(processId)) {
            output.push(chunk);
            if (chunk.at(-1) === 10 && controlFault !== 'reorder') { flushOutput(Buffer.concat(output)); output.length = 0; }
            return;
          }
          first = Buffer.concat([first, chunk]); const end = first.indexOf(10);
          if (end >= 0) {
            ready.add(processId); const initial = first.subarray(0, end + 1); const rest = first.subarray(end + 1); if (rest.length) output.push(rest); first = Buffer.alloc(0);
            if (!pauseReady) {
              notify(processId, 'stdout', initial.subarray(0, 3)); notify(processId, 'stdout', initial.subarray(3));
            }
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          let value = chunk;
          if (controlFault === 'bad-hash') value = Buffer.from(chunk.toString().replace(/[a-f0-9]{64}/, '0'.repeat(64)));
          if (controlFault === 'bad-size') value = Buffer.from(chunk.toString().replace(/:([1-9][0-9]*):/, ':999999999:'));
          if (controlFault === 'bad-nonce') value = Buffer.from(chunk.toString().replace(/DONE:[^:]+:/, 'DONE:other:'));
          notify(processId, 'stderr', fault === 'raw-stderr' ? Buffer.from('synthetic-secret') : value);
        });
        child.on('error', () => respond(message, { exitCode: 127, stdout: '', stderr: 'synthetic-secret spawn-error' }));
        child.on('close', code => {
          processes.delete(processId);
          flushOutput(first.length ? first : Buffer.concat(output));
          if (terminateFault === 'no-final') return;
          const final = () => respond(message, { exitCode: code ?? -1, stdout: '', stderr: '' });
          if (holdFinal) finalResponses.push(final); else final();
        });
      }
    } else if (message.method === 'command/exec/write') {
      beforeWrite?.();
      const processId = params.processId as string; const child = processes.get(processId);
      if (!ready.has(processId)) throw new Error('stdin在READY之前发送');
      if (child) {
        if (params.deltaBase64) child.stdin.write(Buffer.from(params.deltaBase64 as string, 'base64'));
        if (params.closeStdin) child.stdin.end();
      }
      queueMicrotask(() => respond(message, {}));
    } else if (message.method === 'command/exec/terminate') {
      const child = processes.get(params.processId as string); if (child) kill(child);
      queueMicrotask(() => {
        if (terminateFault === 'reject') stream.emit('message', { id: message.id!, error: { code: 1, message: 'synthetic-secret terminate failure' } }, { seqId: ++sequence });
        else respond(message, terminateFault === 'invalid' ? { unexpected: true } : {});
      });
    }
    return { seqId: frames.length };
  }, () => {});
  const session = RemoteRpcSession.fromRemoteStream(stream, { responseTimeoutMs: 25 });
  cleanups.push(async () => { for (const child of processes.values()) kill(child); session.close(); await until(() => processes.size === 0); });
  await session.initialize();
  return { directory, session, stream, frames, processes, setControlFault(value: typeof controlFault) { controlFault = value; }, setTerminateFault(value: typeof terminateFault) { terminateFault = value; }, holdFinal() { holdFinal = true; }, releaseFinal() { holdFinal = false; for (const fn of finalResponses.splice(0)) fn(); }, setFault(value: Fault) { fault = value; }, missingPython() { missingPython = true; }, pauseReady() { pauseReady = true; }, beforeWrite(fn: () => void) { beforeWrite = fn; } };
}
async function prepared() {
  const f = await fixture(); const adapter = await RemoteCommands.create(f.session, scope()); cleanups.push(() => adapter.close()); return { ...f, adapter };
}
const py = (source: string, ...args: string[]) => ['python3', '-I', '-c', source, ...args];

it('通过实际Python3包装器握手后传入argv/cwd/env null，保留字节和真实非零退出', async () => {
  const f = await prepared(); const cwd = join(f.directory, '目录 空格;$()'); await mkdir(cwd);
  const values = ['a b', '引号"\'`$()', 'C:\\Users\\名字\\a b', '\nline', '😀'];
  const result = await f.adapter.execute({ argv: py('import os,sys,json; print(json.dumps([sys.argv[1:],os.getcwd(),os.getenv("CMDC_INHERITED"),os.getenv("CMDC_KEEP"),os.getenv("X")],ensure_ascii=False)); sys.stderr.buffer.write(bytes([0,255,10])); sys.exit(17)', ...values), cwd, env: { CMDC_INHERITED: null, X: '秘密以外的测试值' } });
  expect(result.exitCode).toBe(17); expect(JSON.parse(decodeRemoteCommandText(result.stdout))).toEqual([values, await realpath(cwd), null, 'inherited', '秘密以外的测试值']); expect(result.stderr).toEqual(Buffer.from([0,255,10]));
  for (const frame of f.frames.filter(value => value.method === 'command/exec')) {
    const params = frame.params as Record<string, JsonValue>;
    expect(params).not.toHaveProperty('sandboxPolicy'); expect(params).not.toHaveProperty('permissionProfile'); expect(params).not.toHaveProperty('disableOutputCap'); expect(params).not.toHaveProperty('disableTimeout');
    expect(params.command).toEqual(expect.arrayContaining(['-I', '-u', '-c']));
  }
  expect(f.adapter.metadata.codexHome).toBe(f.directory); expect(f.adapter.scope.managed.codexHome).toBe('/managed/canonical');
});

it('输入JSON按stdin小块发送，数据不进入静态源码或大单argv', async () => {
  const f = await prepared();
  const args = Array.from({ length: 18 }, (_, i) => `${i}:${'中'.repeat(700)}`);
  const result = await f.adapter.execute({ argv: py('import sys,json; print(json.dumps(sys.argv[1:],ensure_ascii=False))', ...args), cwd: f.directory, stdoutBytesCap: 100000 });
  expect(JSON.parse(decodeRemoteCommandText(result.stdout))).toEqual(args);
  const commands = f.frames.filter(value => value.method === 'command/exec').map(value => (value.params as Record<string, JsonValue>).command as string[]);
  expect(commands[1]![4]).toBe(commands[0]![4]); expect(commands[1]!.join('')).not.toContain(args[0]);
  for (const argv of commands) { expect(Math.max(...argv.map(value => Buffer.byteLength(value)))).toBeLessThan(16384); expect(Buffer.byteLength(JSON.stringify(argv))).toBeLessThan(24000); }
  const writes = f.frames.filter(value => value.method === 'command/exec/write'); expect(writes.length).toBeGreaterThan(3);
  for (const frame of writes) expect(Buffer.from((frame.params as Record<string, string>).deltaBase64!, 'base64').length).toBeLessThanOrEqual(16384);
});

it('Python隔离参数阻止目标cwd/PYTHONPATH劫持stdlib，业务env仍明确继承', async () => {
  const f = await fixture(); await writeFile(join(f.directory, 'json.py'), 'raise Exception("cwd-hijack")');
  const adapter = await RemoteCommands.create(f.session, scope()); cleanups.push(() => adapter.close());
  const result = await adapter.execute({ argv: py('print("safe")'), cwd: f.directory, env: { PYTHONPATH: f.directory } }); expect(decodeRemoteCommandText(result.stdout)).toBe('safe\n');
});

it.each(['truncate', 'cap', 'bad-base64', 'bad-utf8', 'bad-json', 'bad-digest', 'extra', 'raw-stderr', 'wrapper-exit', 'wrong-stream', 'wrong-kind', 'bad-size', 'bad-payload-base64', 'bad-ending'] as const)('不把exit0及%s输出当完整业务结果', async fault => {
  const f = await prepared(); f.setFault(fault);
  await expect(f.adapter.execute({ argv: py('print("complete")'), cwd: f.directory })).rejects.toMatchObject({ code: fault === 'cap' ? 'output-limit' : 'protocol', mayHaveBeenSent: true, outcome: 'unknown' });
  expect(f.frames.filter(value => value.method === 'command/exec')).toHaveLength(2);
});

it('stdout/stderr分别在字节上限内完整返回，越界即失败并终止自己的进程', async () => {
  const f = await prepared();
  const exactly = await f.adapter.execute({ argv: py('import sys; sys.stdout.buffer.write(b"a"*30); sys.stderr.buffer.write(b"b"*20)'), cwd: f.directory, stdoutBytesCap: 30, stderrBytesCap: 20 });
  expect(exactly.stdout).toHaveLength(30); expect(exactly.stderr).toHaveLength(20);
  for (const stream of ['stdout', 'stderr']) await expect(f.adapter.execute({ argv: py(`import sys; sys.${stream}.buffer.write(b"x"*200000); sys.${stream}.flush()`), cwd: f.directory, stdoutBytesCap: 30, stderrBytesCap: 20 })).rejects.toMatchObject({ code: 'output-limit', mayHaveBeenSent: true });
  const ids = new Set(f.frames.filter(value => value.method === 'command/exec').map(value => (value.params as Record<string, JsonValue>).processId));
  for (const terminate of f.frames.filter(value => value.method === 'command/exec/terminate')) expect(ids.has((terminate.params as Record<string, JsonValue>).processId)).toBe(true);
});

it.each([16383, 16384, 20000, 524288])('QUALITY复现：stdout上限%i仅越界一字节且管道保持开启时立即报输出越界', async cap => {
  const f = await prepared();
  await expect(f.adapter.execute({
    argv: py('import sys,time; sys.stdout.buffer.write(b"x"*int(sys.argv[1])); sys.stdout.flush(); time.sleep(5)', String(cap + 1)),
    cwd: f.directory, ...(cap === 524288 ? {} : { stdoutBytesCap: cap }), timeoutMs: 1200,
  })).rejects.toMatchObject({ code: 'output-limit', mayHaveBeenSent: true, outcome: 'unknown' });
  await until(() => f.processes.size === 0);
  expect(f.frames.filter(frame => frame.method === 'command/exec/terminate')).toHaveLength(1);
  for (const name of ['notification', 'disconnect', 'close']) expect(f.session.listenerCount(name)).toBe(0);
  expect(f.session.ready).toBe(true);
});

it('QUALITY复现：stderr上限20000仅越界一字节且管道保持开启时立即报输出越界', async () => {
  const f = await prepared();
  await expect(f.adapter.execute({
    argv: py('import sys,time; sys.stderr.buffer.write(b"x"*20001); sys.stderr.flush(); time.sleep(5)'),
    cwd: f.directory, stderrBytesCap: 20000, timeoutMs: 1200,
  })).rejects.toMatchObject({ code: 'output-limit', mayHaveBeenSent: true, outcome: 'unknown' });
  await until(() => f.processes.size === 0);
  expect(f.frames.filter(frame => frame.method === 'command/exec/terminate')).toHaveLength(1);
  for (const name of ['notification', 'disconnect', 'close']) expect(f.session.listenerCount(name)).toBe(0);
  expect(f.session.ready).toBe(true);
});

it('文本解码严格拒绝无效UTF8，二进制命令结果仍保留原字节', async () => {
  const f = await prepared(); const result = await f.adapter.execute({ argv: py('import sys; sys.stdout.buffer.write(bytes([255,0,128]))'), cwd: f.directory });
  expect(result.stdout).toEqual(Buffer.from([255,0,128])); expect(() => decodeRemoteCommandText(result.stdout)).toThrow();
});

it('未找到Python3明确报能力缺失，无python别名/本地/SSH回退且错误脱敏', async () => {
  const f = await fixture(); f.missingPython();
  const error = await RemoteCommands.create(f.session, scope()).catch(error => error);
  expect(error).toMatchObject({ code: 'python3-required' }); expect(error.message).not.toContain('synthetic-secret');
  const commands = f.frames.filter(value => value.method === 'command/exec'); expect(commands).toHaveLength(1); expect(((commands[0]!.params as Record<string, JsonValue>).command as string[])[0]).toBe('python3'); expect(f.session.ready).toBe(true);
});

it('目标默认权限下不能启动业务命令时返回能力缺失，业务非零不混同', async () => {
  const f = await prepared(); await expect(f.adapter.execute({ argv: ['missing-synthetic-command-93844'], cwd: f.directory })).rejects.toMatchObject({ code: 'capability', mayHaveBeenSent: true });
});

it('取消在READY之前不发送stdin，不重放且不关闭共享session', async () => {
  const f = await prepared(); f.pauseReady(); const controller = new AbortController();
  const pending = f.adapter.execute({ argv: py('print("never")'), cwd: f.directory, signal: controller.signal }).catch(error => error);
  await until(() => f.processes.size === 1); controller.abort();
  expect(await pending).toMatchObject({ code: 'cancelled', mayHaveBeenSent: true, outcome: 'unknown' }); expect(f.session.ready).toBe(true);
  expect(f.frames.filter(value => value.method === 'command/exec')).toHaveLength(2);
  expect(f.frames.filter(value => value.method === 'command/exec/write')).toHaveLength(1); await until(() => f.processes.size === 0);
});

it('预取消和已关闭适配器都是未发送错误；close只清自己的资源', async () => {
  const f = await prepared(); const controller = new AbortController(); controller.abort();
  await expect(f.adapter.execute({ argv: py('print(1)'), cwd: f.directory, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled', mayHaveBeenSent: false, outcome: 'not-sent' });
  await f.adapter.close(); await expect(f.adapter.execute({ argv: py('print(1)'), cwd: f.directory })).rejects.toMatchObject({ code: 'closed', mayHaveBeenSent: false });
  expect(f.session.ready).toBe(true); expect(f.frames.filter(value => value.method === 'command/exec')).toHaveLength(1);
  for (const name of ['notification', 'disconnect', 'close']) expect(f.session.listenerCount(name)).toBe(0);
});

it('发送后断线/close与期限均结果未知，无自动重放', async () => {
  for (const kind of ['disconnect', 'timeout', 'close'] as const) {
    const f = await prepared(); const pending = f.adapter.execute({ argv: py('import time; time.sleep(10)'), cwd: f.directory, timeoutMs: kind === 'timeout' ? 100 : 2000 }).catch(error => error);
    await until(() => f.frames.filter(frame => frame.method === 'command/exec/write').length === 2);
    if (kind === 'disconnect') f.stream.emit('disconnect', { reason: 'network', mayHaveBeenSent: true });
    if (kind === 'close') await f.adapter.close();
    expect(await pending).toMatchObject({ code: kind === 'close' ? 'closed' : kind === 'timeout' ? 'timeout' : 'disconnected', mayHaveBeenSent: true, outcome: 'unknown' });
    expect(f.frames.filter(frame => frame.method === 'command/exec')).toHaveLength(2); expect(f.session.ready).toBe(true);
    for (const name of ['notification', 'disconnect', 'close']) expect(f.session.listenerCount(name)).toBe(0);
  }
});

it('同步写入阻塞跨越期限不得成功或继续发送后续stdin', async () => {
  const f = await prepared(); let blocked = false;
  f.beforeWrite(() => { if (blocked) return; blocked = true; const end = performance.now() + 140; while (performance.now() < end) { /* 模拟阻塞。 */ } });
  await expect(f.adapter.execute({ argv: py('print(1)'), cwd: f.directory, timeoutMs: 100 })).rejects.toMatchObject({ code: 'timeout', mayHaveBeenSent: true });
});

it('全局并发预算跨适配器共享，拒绝第五个操作且清理后恢复容量', async () => {
  const f = await prepared(); const other = await RemoteCommands.create(f.session, scope()); cleanups.push(() => other.close());
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const pending = controllers.map((controller, i) => (i % 2 ? other : f.adapter).execute({ argv: py('import time; time.sleep(10)'), cwd: f.directory, signal: controller.signal }).catch(error => error));
  await until(() => f.processes.size === 4);
  await expect(other.execute({ argv: py('print(1)'), cwd: f.directory })).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  controllers.forEach(controller => controller.abort()); expect((await Promise.all(pending)).every(error => error.code === 'cancelled')).toBe(true);
  const result = await f.adapter.execute({ argv: py('print(1)'), cwd: f.directory }); expect(result.exitCode).toBe(0);
});

it('全局输出内存预留独立于并发条数，不容许多个最大捕获绕过预算', async () => {
  const f = await prepared(); const controllers = [new AbortController(), new AbortController()];
  const pending = controllers.map(controller => f.adapter.execute({ argv: py('import time; time.sleep(10)'), cwd: f.directory, stdoutBytesCap: 2 * 1024 * 1024, stderrBytesCap: 2 * 1024 * 1024, signal: controller.signal }).catch(error => error));
  await until(() => f.processes.size === 2);
  await expect(f.adapter.execute({ argv: py('print(1)'), cwd: f.directory, stdoutBytesCap: 2 * 1024 * 1024, stderrBytesCap: 2 * 1024 * 1024 })).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  controllers.forEach(controller => controller.abort()); await Promise.all(pending);
});

it.each([
  { codexHome: 'relative', platformFamily: 'unix', platformOs: 'linux' },
  { codexHome: '/target', platformFamily: 'windows', platformOs: 'windows' },
  { codexHome: '/target', platformFamily: 'unix' },
  { codexHome: '/target', platformFamily: 'unix', platformOs: 'windows' },
])('无效initialize事实在任何命令发送前拒绝', async metadata => {
  const f = await fixture({ userAgent: 'fixture', ...metadata }); await expect(RemoteCommands.create(f.session, scope())).rejects.toMatchObject({ code: 'metadata', mayHaveBeenSent: false }); expect(f.frames.filter(frame => frame.method === 'command/exec')).toHaveLength(0);
});

it('Windows初始化路径按目标规则保留，不调用Mac路径规范化', async () => {
  const f = await fixture({ codexHome: 'C:\\Users\\名字\\.codex', platformFamily: 'windows', platformOs: 'windows', userAgent: 'fixture' }); f.missingPython();
  await expect(RemoteCommands.create(f.session, scope())).rejects.toMatchObject({ code: 'python3-required' });
  const command = f.frames.find(frame => frame.method === 'command/exec')!; expect((command.params as Record<string, JsonValue>).cwd).toBe('C:\\Users\\名字\\.codex');
});

it('完整scope复制冻结，账号/受管home/目标tuple均不可在同一session改绑', async () => {
  const f = await fixture(); const original = scope(); const adapter = await RemoteCommands.create(f.session, original); cleanups.push(() => adapter.close());
  original.managed.accountId = 'mutated'; original.target.installationId = 'mutated'; expect(adapter.scope).toEqual(scope()); expect(Object.isFrozen(adapter.scope.managed)).toBe(true); expect(Object.isFrozen(adapter.scope.target)).toBe(true);
  for (const changed of [
    { ...scope(), managed: { ...scope().managed, accountId: 'other' } },
    { ...scope(), managed: { ...scope().managed, accountUserId: 'other' } },
    { ...scope(), managed: { ...scope().managed, userId: 'other' } },
    { ...scope(), managed: { ...scope().managed, codexHome: '/other' } },
    { ...scope(), target: { ...scope().target, installationId: 'other' } },
    { ...scope(), target: { ...scope().target, environmentId: 'other' } },
  ]) await expect(RemoteCommands.create(f.session, changed)).rejects.toMatchObject({ code: 'binding', mayHaveBeenSent: false });
  expect(f.frames.filter(frame => frame.method === 'command/exec')).toHaveLength(1);
});

it.each([
  { managed: { codexHome: '/x', accountId: 'a' }, target: scope().target },
  { managed: scope().managed, target: { environmentId: 'e' } },
  { ...scope(), sandboxPolicy: { type: 'dangerFullAccess' } },
])('不完整或扩展scope不能进入命令层', async value => {
  const f = await fixture(); await expect(RemoteCommands.create(f.session, value as RemoteCommandScope)).rejects.toMatchObject({ code: 'binding', mayHaveBeenSent: false });
});

it.each([
  { argv: [] }, { argv: ['x\0y'] }, { argv: ['x'.repeat(17000)] }, { argv: Array.from({ length: 100 }, () => 'a'.repeat(1000)) },
  { cwd: 'relative' }, { env: { X: 1 } }, { env: { 'X=Y': 'z' } }, { env: { X: 'x'.repeat(20000) } },
  { stdoutBytesCap: 0 }, { stderrBytesCap: 3 * 1024 * 1024 }, { timeoutMs: 180001 },
  { sandboxPolicy: { type: 'readOnly', networkAccess: true } }, { permissionProfile: 'override' },
])('非法输入/容量/任意权限字段均在发送前拒绝', async patch => {
  const f = await prepared(); await expect(f.adapter.execute({ argv: ['unused'], cwd: f.directory, ...patch } as Parameters<RemoteCommands['execute']>[0])).rejects.toMatchObject({ mayHaveBeenSent: false, outcome: 'not-sent' }); expect(f.frames.filter(frame => frame.method === 'command/exec')).toHaveLength(1);
});


it('输出证明的同步解码跨越绝对期限也不得返回成功', async () => {
  const f = await prepared(); const original = Buffer.prototype.toString; let delayed = false;
  const spy = vi.spyOn(Buffer.prototype, 'toString').mockImplementation(function (this: Buffer, ...parameters: unknown[]) {
    const args = parameters as Parameters<Buffer['toString']>;
    if (!delayed && this.length === 1234 && args[0] === 'base64') { delayed = true; const end = performance.now() + 160; while (performance.now() < end) {} }
    return original.apply(this, args);
  });
  try {
    await expect(f.adapter.execute({ argv: py('import sys; sys.stdout.buffer.write(b"x"*1234)'), cwd: f.directory, timeoutMs: 100 })).rejects.toMatchObject({ code: 'timeout', mayHaveBeenSent: true });
    expect(delayed).toBe(true);
  } finally { spy.mockRestore(); }
});


it('输出越界立即终止官方自有命令组，包装器退出前清除业务子进程', async () => {
  const f = await prepared(); const marker = join(f.directory, 'escaped-child');
  const grandchild = 'import time,pathlib; time.sleep(.35); pathlib.Path(' + JSON.stringify(marker) + ').write_text("escaped")';
  await expect(f.adapter.execute({ argv: py('import subprocess,sys,time; subprocess.Popen([sys.executable,"-I","-c",sys.argv[1]]); sys.stdout.buffer.write(b"x"*10000); sys.stdout.flush(); time.sleep(10)', grandchild), cwd: f.directory, stdoutBytesCap: 10 })).rejects.toMatchObject({ code: 'output-limit' });
  await new Promise(resolve => setTimeout(resolve, 400));
  await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('执行入口的同步参数处理也继承同一绝对期限', async () => {
  const f = await prepared(); const original = Buffer.byteLength; let delayed = false;
  const spy = vi.spyOn(Buffer, 'byteLength').mockImplementation((...args: Parameters<typeof Buffer.byteLength>) => {
    if (!delayed && args[0] === 'late-validation') { delayed = true; const end = performance.now() + 100; while (performance.now() < end) {} }
    return original(...args);
  });
  try {
    const error = await f.adapter.execute({ argv: py('print(1)', 'late-validation'), cwd: f.directory, timeoutMs: 50 }).then(() => null, error => error);
    expect(error).toMatchObject({ code: 'timeout', mayHaveBeenSent: false });
  } finally { spy.mockRestore(); }
});


it('稀疏argv和可执行访问器在发送前拒绝，不能混入数据载荷', async () => {
  const f = await prepared(); const sparse = ['python3', , 'data'] as string[];
  let evaluated = false; const accessor = ['python3', 'data']; Object.defineProperty(accessor, '1', { enumerable: true, get() { evaluated = true; return 'mutated'; } });
  for (const argv of [sparse, accessor]) await expect(f.adapter.execute({ argv, cwd: f.directory })).rejects.toMatchObject({ mayHaveBeenSent: false });
  expect(evaluated).toBe(false); expect(f.frames.filter(frame => frame.method === 'command/exec')).toHaveLength(1);
});

it('受管scope的canonical home必须为明确绝对来源', async () => {
  const f = await fixture(); await expect(RemoteCommands.create(f.session, { ...scope(), managed: { ...scope().managed, codexHome: 'relative' } })).rejects.toMatchObject({ code: 'binding', mayHaveBeenSent: false });
});

it('两路最大允许捕获仍可验证完整字节，成功后撤销自有signal监听', async () => {
  const f = await prepared(); const controller = new AbortController();
  const size = 2 * 1024 * 1024;
  const result = await f.adapter.execute({ argv: py('import sys; sys.stdout.buffer.write(b"a"*2097152); sys.stderr.buffer.write(b"b"*2097152)'), cwd: f.directory, stdoutBytesCap: size, stderrBytesCap: size, signal: controller.signal });
  expect(result.stdout.equals(Buffer.alloc(size, 'a'))).toBe(true); expect(result.stderr.equals(Buffer.alloc(size, 'b'))).toBe(true);
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  for (const name of ['notification', 'disconnect', 'close']) expect(f.session.listenerCount(name)).toBe(0);
});


it('SPEC复现：已发送probe的孤立surrogate路径失败保留结果未知', async () => {
  const f = await fixture(); f.setFault('bad-probe-python');
  const error = await RemoteCommands.create(f.session, scope()).catch(error => error);
  expect(error).toMatchObject({ code: 'protocol', mayHaveBeenSent: true, outcome: 'unknown' });
});

it('SPEC复现：正常退出且关闭stdio的后台孙进程在成功交付前回收', async () => {
  const f = await prepared(); const marker = join(f.directory, 'successful-background-child');
  const descendant = 'import time,pathlib; time.sleep(.4); pathlib.Path(' + JSON.stringify(marker) + ').write_text("escaped")';
  const result = await f.adapter.execute({ argv: py('import subprocess,sys; subprocess.Popen([sys.executable,"-I","-c",sys.argv[1]],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); print("done")', descendant), cwd: f.directory });
  expect(result.exitCode).toBe(0); expect(decodeRemoteCommandText(result.stdout)).toBe('done\n'); await f.adapter.close();
  await new Promise(resolve => setTimeout(resolve, 500));
  await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
});


it.each(['invalid', 'reject', 'no-final'] as const)('成功输出后的%s收尾故障不得交付业务成功，保留结果未知', async fault => {
  const f = await prepared(); f.setTerminateFault(fault);
  const error = await f.adapter.execute({ argv: py('print("result")'), cwd: f.directory, timeoutMs: 250 }).catch(error => error);
  expect(error).toMatchObject({ mayHaveBeenSent: true, outcome: 'unknown' });
  if (fault === 'invalid') expect(error.code).toBe('protocol');
  expect(f.frames.filter(frame => frame.method === 'command/exec/terminate')).toHaveLength(1);
  expect(f.session.ready).toBe(true);
});

it('自有terminate已确认但原exec尚未实际终结时不能成功交付', async () => {
  const f = await prepared(); f.holdFinal(); let delivered = false;
  const pending = f.adapter.execute({ argv: py('print("result")'), cwd: f.directory }).then(value => { delivered = true; return value; }).catch(error => error);
  await until(() => f.frames.some(frame => frame.method === 'command/exec/terminate') && f.processes.size === 0);
  expect(delivered).toBe(false); f.releaseFinal();
  expect((await pending).exitCode).toBe(0); expect(delivered).toBe(true);
});

it('正常收尾或关闭一个适配器不能终止另一适配器的命令', async () => {
  const f = await prepared(); const other = await RemoteCommands.create(f.session, scope()); cleanups.push(() => other.close());
  const first = f.adapter.execute({ argv: py('import time; time.sleep(10)'), cwd: f.directory }).catch(error => error);
  const second = other.execute({ argv: py('import time; time.sleep(.15); print("unaffected")'), cwd: f.directory });
  await until(() => f.processes.size === 2); await f.adapter.close();
  expect(await first).toMatchObject({ code: 'closed', outcome: 'unknown' });
  expect(decodeRemoteCommandText((await second).stdout)).toBe('unaffected\n'); expect(f.session.ready).toBe(true);
});


it('DONE先于stdout通知时等待原exec全部输出完成，再证明字节并成功收尾', async () => {
  const f = await prepared(); f.setControlFault('reorder');
  const result = await f.adapter.execute({ argv: py('print("reordered")'), cwd: f.directory });
  expect(decodeRemoteCommandText(result.stdout)).toBe('reordered\n');
  expect(f.processes.size).toBe(0); expect(f.session.ready).toBe(true);
});

it.each(['bad-hash', 'bad-size', 'bad-nonce'] as const)('DONE的%s不是成功证明，收尾后仍返回未知结果', async fault => {
  const f = await prepared(); f.setControlFault(fault);
  await expect(f.adapter.execute({ argv: py('print("result")'), cwd: f.directory })).rejects.toMatchObject({ code: 'protocol', mayHaveBeenSent: true, outcome: 'unknown' });
  expect(f.session.ready).toBe(true); await until(() => f.processes.size === 0);
});
