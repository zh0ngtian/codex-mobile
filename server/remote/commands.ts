import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { TextDecoder } from 'node:util';
import { RemoteRpcError, type RemoteRpcSession } from './rpc-session.js';
import { assertRemoteOperation, withRemoteOperation } from './operation-guard.js';
import type { ManagedAuthIdentity } from './managed-auth.js';
import type { RemoteTargetIdentity } from './catalog.js';
import type { JsonValue, RpcMessage } from './envelope.js';

/** 只接受可信服务端在Runtime已核验来源下交付的session及完整身份，不能来自客户端请求。 */
export interface RemoteCommandScope { managed: ManagedAuthIdentity; target: RemoteTargetIdentity }
export interface RemoteCommandOptions {
  argv: string[]; cwd: string; env?: Record<string, string | null>;
  timeoutMs?: number; stdoutBytesCap?: number; stderrBytesCap?: number; signal?: AbortSignal;
}
export interface RemoteCommandResult { exitCode: number; stdout: Buffer; stderr: Buffer }
export interface RemoteCommandMetadata { codexHome: string; platformFamily: string; platformOs: string; userAgent: string }
export type RemoteCommandFailure = 'binding' | 'metadata' | 'python3-required' | 'capability' | 'invalid-input' | 'capacity' | 'output-limit' | 'protocol' | 'encoding' | 'timeout' | 'cancelled' | 'disconnected' | 'closed';
/** 失败不包含原始上游payload/错误。取消已执行的写入不代表回滚；未知结果不得自动重放。 */
export class RemoteCommandError extends Error {
  readonly outcome: 'not-sent' | 'unknown';
  constructor(readonly code: RemoteCommandFailure, readonly mayHaveBeenSent: boolean) {
    super(code === 'python3-required' ? '目标需要支持 Python3 隔离执行' : 'Remote 目标命令未完成');
    this.name = 'RemoteCommandError'; this.outcome = mayHaveBeenSent ? 'unknown' : 'not-sent';
  }
}
const MAX_CAPTURE = 2 * 1024 * 1024;
const DEFAULT_CAPTURE = 512 * 1024;
const MAX_INPUT = 128 * 1024;
const MAX_CONCURRENT = 4;
const GLOBAL_MEMORY = 64 * 1024 * 1024;
let activeCommands = 0;
let reservedMemory = 0;
const bindings = new WeakMap<RemoteRpcSession, string>();
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function data(value: unknown, keys: string[], code: RemoteCommandFailure): Record<string, unknown> {
  if (!object(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'))) throw new RemoteCommandError(code, false);
  return value;
}
function string(value: unknown, max: number, code: RemoteCommandFailure, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.length) || value.length > max || value.includes('\0') || Buffer.from(value).toString('utf8') !== value) throw new RemoteCommandError(code, false);
  return value;
}
function identifier(value: unknown): string {
  const result = string(value, 4096, 'binding'); if (/[\u0000-\u001f\u007f]/.test(result)) throw new RemoteCommandError('binding', false); return result;
}
function absolute(value: string, family: string): boolean {
  return family === 'unix' ? value.startsWith('/') : /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(value);
}
function copyScope(value: RemoteCommandScope): RemoteCommandScope {
  const raw = data(value, ['managed', 'target'], 'binding');
  const managed = data(raw.managed, ['codexHome', 'accountId', 'accountUserId', 'userId'], 'binding');
  const target = data(raw.target, ['environmentId', 'installationId'], 'binding');
  const home = identifier(managed.codexHome); if (!absolute(home, 'unix') && !absolute(home, 'windows')) throw new RemoteCommandError('binding', false);
  return Object.freeze({
    managed: Object.freeze({ codexHome: home, accountId: identifier(managed.accountId), accountUserId: identifier(managed.accountUserId), ...(managed.userId === undefined ? {} : { userId: identifier(managed.userId) }) }),
    target: Object.freeze({ environmentId: identifier(target.environmentId), installationId: identifier(target.installationId) }),
  });
}
function metadata(value: unknown): Readonly<RemoteCommandMetadata> {
  if (!object(value)) throw new RemoteCommandError('metadata', false);
  const result = { codexHome: string(value.codexHome, 16384, 'metadata'), platformFamily: string(value.platformFamily, 32, 'metadata'), platformOs: string(value.platformOs, 64, 'metadata'), userAgent: string(value.userAgent, 16384, 'metadata') };
  if (!['unix', 'windows'].includes(result.platformFamily) || !/^[a-z][a-z0-9_-]*$/.test(result.platformOs) || (result.platformFamily === 'windows') !== (result.platformOs === 'windows') || !absolute(result.codexHome, result.platformFamily)) throw new RemoteCommandError('metadata', false);
  return Object.freeze(result);
}
function limit(value: unknown, fallback: number, max: number): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 1 || result > max) throw new RemoteCommandError('capacity', false); return result;
}
function base64(value: unknown, max: number): Buffer {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) throw new RemoteCommandError('protocol', true);
  // 不使用重复捕获组正则：合法多MiB数据也会触发V8正则栈溢出。
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (value.indexOf('=') !== (padding ? value.length - padding : -1)) throw new RemoteCommandError('protocol', true);
  const result = Buffer.from(value, 'base64'); if (result.length > max || result.toString('base64') !== value) throw new RemoteCommandError('protocol', true); return result;
}
export function decodeRemoteCommandText(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new RemoteCommandError('encoding', true); }
}

// 固定源码只接收小型长度/摘要参数；用户argv/cwd/env均经stdin JSON传入，不参与代码求值。
// -I排除cwd及PYTHONPATH对包装器stdlib的劫持；业务进程仍使用明确的env继承/取消规则。
const PYTHON = String.raw`import base64,hashlib,json,os,subprocess,sys,threading,time
nonce,length,expected=sys.argv[1],int(sys.argv[2]),sys.argv[3]
deadline=time.monotonic()+int(sys.argv[4])/1000
child=None
def emit(value):
    value.update(version=1,nonce=nonce,end=nonce)
    sys.stdout.write(json.dumps(value,separators=(',',':'),ensure_ascii=True)+'\n');sys.stdout.flush()
def fail(code):
    emit(dict(kind='failure',code=code))
    if child is not None:
        try: child.kill()
        except OSError: pass
        # 留给调用方在连接范围内terminate整个自有命令；独立官方timeout仍为有限值。
        time.sleep(max(0,deadline-time.monotonic())+1)
    raise SystemExit(0)
sys.stdout.write('CMDC1_READY:'+nonce+'\n');sys.stdout.flush()
try:
    if length<1 or length>131072: fail('protocol')
    raw=sys.stdin.buffer.read(length+1)
    if len(raw)!=length or hashlib.sha256(raw).hexdigest()!=expected: fail('protocol')
    request=json.loads(raw.decode('utf-8','strict'))
    if time.monotonic()>=deadline: fail('timeout')
    if request['mode']=='probe':
        if sys.version_info[0]!=3: fail('capability')
        emit(dict(kind='probe',python=sys.executable,major=sys.version_info[0]));raise SystemExit(0)
    env=os.environ.copy()
    for key,value in request['env'].items():
        if value is None: env.pop(key,None)
        else: env[key]=value
    argv=request['argv']
    if os.name=='nt':
        if len(subprocess.list2cmdline(argv))>24000 or sum(len(k)+len(v)+2 for k,v in env.items())>30000: fail('capability')
    elif sum(len(os.fsencode(x))+1 for x in argv)+sum(len(os.fsencode(k))+len(os.fsencode(v))+2 for k,v in env.items())>131072:
        fail('capability')
    try: child=subprocess.Popen(argv,cwd=request['cwd'],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,shell=False)
    except (OSError,ValueError): fail('capability')
    caphit=threading.Event();readerror=threading.Event();outputs=[bytearray(),bytearray()];done=[threading.Event(),threading.Event()]
    def capture(index,pipe,cap):
        try:
            while True:
                part=pipe.read(min(16384,cap+1))
                if not part: break
                if len(outputs[index])+len(part)>cap: caphit.set();break
                outputs[index].extend(part)
        except (OSError,ValueError): readerror.set()
        finally: done[index].set()
    for index,pipe,cap in [(0,child.stdout,request['stdoutCap']),(1,child.stderr,request['stderrCap'])]:
        threading.Thread(target=capture,args=(index,pipe,cap),daemon=True).start()
    while child.poll() is None or not all(event.is_set() for event in done):
        if caphit.is_set(): fail('output-limit')
        if readerror.is_set(): fail('capability')
        if time.monotonic()>=deadline: fail('timeout')
        time.sleep(.005)
    if caphit.is_set(): fail('output-limit')
    if readerror.is_set(): fail('capability')
    def captured(value):
        return dict(base64=base64.b64encode(value).decode('ascii'),size=len(value),sha256=hashlib.sha256(value).hexdigest())
    emit(dict(kind='result',exitCode=child.returncode,stdout=captured(outputs[0]),stderr=captured(outputs[1])))
except SystemExit: raise
except BaseException: fail('protocol')
`;
interface Operation {
  abort: AbortController; deadline: number; sent: boolean; processId: string;
  error?: RemoteCommandError; fail: (code: RemoteCommandFailure) => void;
}

/** 只复用调用者已ready的逻辑session，不创建/关闭任何物理连接或执行本地业务。 */
export class RemoteCommands {
  private python = 'python3';
  private closed = false;
  private closing?: Promise<void>;
  private readonly operations = new Set<Operation>();
  private readonly flights = new Set<Promise<unknown>>();
  private readonly prefix = `codex-mobile-command:${randomUUID()}:`;
  private constructor(private readonly session: RemoteRpcSession, readonly scope: RemoteCommandScope, readonly metadata: Readonly<RemoteCommandMetadata>) {}
  static async create(session: RemoteRpcSession, value: RemoteCommandScope, signal?: AbortSignal): Promise<RemoteCommands> {
    const deadline = performance.now() + 20000;
    assertRemoteOperation();
    const scope = copyScope(value); const actual = metadata(session.metadata);
    if (!session.ready) throw new RemoteCommandError('closed', false);
    const binding = JSON.stringify({ scope, metadata: actual }); const previous = bindings.get(session);
    if (previous !== undefined && previous !== binding) throw new RemoteCommandError('binding', false);
    bindings.set(session, binding);
    const adapter = new RemoteCommands(session, scope, actual);
    try {
      const probe = await adapter.run({ mode: 'probe' }, actual.codexHome, undefined, 20000, 16384, 16384, signal, true, deadline);
      if (probe.kind !== 'probe' || probe.major !== 3) throw new RemoteCommandError('python3-required', true);
      const executable = string(probe.python, 16384, 'protocol');
      if (!absolute(executable, actual.platformFamily)) throw new RemoteCommandError('protocol', true);
      adapter.python = executable;
      if (performance.now() >= deadline) throw new RemoteCommandError('timeout', true);
      if (signal?.aborted) throw new RemoteCommandError('cancelled', true);
      return adapter;
    } catch (error) { await adapter.close(); throw error; }
  }
  execute(value: RemoteCommandOptions): Promise<RemoteCommandResult> {
    return this.executeInternal(value);
  }
  private async executeInternal(value: RemoteCommandOptions): Promise<RemoteCommandResult> {
    const started = performance.now();
    const raw = data(value, ['argv', 'cwd', 'env', 'timeoutMs', 'stdoutBytesCap', 'stderrBytesCap', 'signal'], 'invalid-input');
    const cwd = string(raw.cwd, 16384, 'invalid-input'); if (!absolute(cwd, this.metadata.platformFamily)) throw new RemoteCommandError('invalid-input', false);
    if (!Array.isArray(raw.argv) || !raw.argv.length || raw.argv.length > 256) throw new RemoteCommandError('capacity', false);
    const argv: string[] = [];
    if (Reflect.ownKeys(raw.argv).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= (raw.argv as unknown[]).length))) throw new RemoteCommandError('invalid-input', false);
    for (let index = 0; index < raw.argv.length; index++) {
      const entry = Object.getOwnPropertyDescriptor(raw.argv, String(index));
      if (!entry || !Object.hasOwn(entry, 'value')) throw new RemoteCommandError('invalid-input', false);
      argv.push(string(entry.value, 16384, 'invalid-input', true));
    }
    if (!argv[0]) throw new RemoteCommandError('invalid-input', false);
    let argvBytes = 0; for (const arg of argv) { const bytes = Buffer.byteLength(arg); if (bytes > 16384) throw new RemoteCommandError('capacity', false); argvBytes += bytes + 1; }
    if (argvBytes > 49152 || (this.metadata.platformFamily === 'windows' && argv.reduce((size, value) => size + 2 * value.length + 3, 0) > 24000)) throw new RemoteCommandError('capacity', false);
    const env: Record<string, string | null> = Object.create(null) as Record<string, string | null>;
    if (raw.env !== undefined) {
      if (!object(raw.env) || Reflect.ownKeys(raw.env).length > 128) throw new RemoteCommandError('invalid-input', false);
      for (const key of Reflect.ownKeys(raw.env)) {
        if (typeof key !== 'string' || !/^[^=\u0000]+$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new RemoteCommandError('invalid-input', false);
        const descriptor = Object.getOwnPropertyDescriptor(raw.env, key)!; if (!Object.hasOwn(descriptor, 'value')) throw new RemoteCommandError('invalid-input', false);
        const item = descriptor.value as unknown; env[string(key, 1024, 'invalid-input')] = item === null ? null : string(item, 16384, 'invalid-input', true);
      }
      if (Buffer.byteLength(JSON.stringify(env)) > 16384) throw new RemoteCommandError('capacity', false);
    }
    const timeout = limit(raw.timeoutMs, 20000, 180000);
    const stdoutCap = limit(raw.stdoutBytesCap, DEFAULT_CAPTURE, MAX_CAPTURE); const stderrCap = limit(raw.stderrBytesCap, DEFAULT_CAPTURE, MAX_CAPTURE);
    if (raw.signal !== undefined && !(raw.signal instanceof AbortSignal)) throw new RemoteCommandError('invalid-input', false);
    const response = await this.run({ mode: 'execute', argv, cwd, env, stdoutCap, stderrCap }, cwd, env, timeout, stdoutCap, stderrCap, raw.signal as AbortSignal | undefined, false, started + timeout);
    return { exitCode: response.exitCode as number, stdout: response.stdout as Buffer, stderr: response.stderr as Buffer };
  }
  private assert(op: Operation): void {
    if (op.error) throw op.error;
    if (this.closed) throw new RemoteCommandError('closed', op.sent);
    if (performance.now() >= op.deadline) throw new RemoteCommandError('timeout', op.sent);
    if (op.abort.signal.aborted) throw new RemoteCommandError('cancelled', op.sent);
  }
  private run(payload: Record<string, JsonValue>, cwd: string, env: Record<string, string | null> | undefined, timeout: number, stdoutCap: number, stderrCap: number, signal?: AbortSignal, probe = false, deadline = performance.now() + timeout): Promise<Record<string, unknown>> {
    const flight = this.perform(payload, cwd, env, timeout, stdoutCap, stderrCap, signal, probe, deadline);
    this.flights.add(flight); void flight.then(() => this.flights.delete(flight), () => this.flights.delete(flight)); return flight;
  }
  private async perform(payload: Record<string, JsonValue>, cwd: string, env: Record<string, string | null> | undefined, timeout: number, stdoutCap: number, stderrCap: number, signal: AbortSignal | undefined, probe: boolean, deadline: number): Promise<Record<string, unknown>> {
    if (performance.now() >= deadline) throw new RemoteCommandError('timeout', false);
    if (this.closed || !this.session.ready) throw new RemoteCommandError('closed', false);
    if (signal?.aborted) throw new RemoteCommandError('cancelled', false);
    assertRemoteOperation();
    const input = Buffer.from(JSON.stringify(payload)); if (input.length > MAX_INPUT) throw new RemoteCommandError('capacity', false);
    const wireCap = Math.ceil((stdoutCap + stderrCap) / 3) * 4 + 65536;
    // 包括累计块、合并Buffer、UTF8文本、JSON/base64及解码结果的保守峰值与输入。
    const reservation = wireCap * 5 + input.length * 4 + 65536;
    if (activeCommands >= MAX_CONCURRENT || reservedMemory + reservation > GLOBAL_MEMORY) throw new RemoteCommandError('capacity', false);
    activeCommands++; reservedMemory += reservation;
    const nonce = randomUUID(); const processId = this.prefix + randomUUID(); const abort = new AbortController();
    let rejectFailure!: (error: RemoteCommandError) => void;
    const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; }); void failure.catch(() => undefined);
    const op: Operation = { deadline, sent: false, processId, abort, fail: code => {
      if (op.error) return; op.error = new RemoteCommandError(code, op.sent); abort.abort(); rejectFailure(op.error);
    } };
    this.operations.add(op);
    const remaining = () => { this.assert(op); assertRemoteOperation(); return Math.max(1, Math.floor(op.deadline - performance.now())); };
    const cancelled = () => op.fail('cancelled'); const disconnected = () => op.fail('disconnected'); const closed = () => op.fail('disconnected');
    let resolveReady!: () => void; let ready = false; let handshake = Buffer.alloc(0); let bytes = 0; let chunks = 0; const output: Buffer[] = [];
    const readiness = new Promise<void>(resolve => { resolveReady = resolve; });
    const notification = (message: RpcMessage) => {
      if (message.method !== 'command/exec/outputDelta' || !object(message.params) || message.params.processId !== processId || op.error) return;
      try {
        this.assert(op);
        const params = message.params;
        if (!['stdout', 'stderr'].includes(params.stream as string) || typeof params.capReached !== 'boolean' || ++chunks > 8192) throw new RemoteCommandError('protocol', true);
        if (params.capReached) { op.fail('output-limit'); return; }
        const value = base64(params.deltaBase64, wireCap);
        if (params.stream === 'stderr' && value.length) throw new RemoteCommandError('protocol', true);
        if (params.stream !== 'stdout' || !value.length) return;
        if ((bytes += value.length) > wireCap) { op.fail('output-limit'); return; }
        if (!ready) {
          handshake = Buffer.concat([handshake, value]); const end = handshake.indexOf(10);
          if (end < 0) { if (handshake.length > 128) throw new RemoteCommandError('protocol', true); return; }
          if (!handshake.subarray(0, end + 1).equals(Buffer.from(`CMDC1_READY:${nonce}\n`))) throw new RemoteCommandError('protocol', true);
          ready = true; if (handshake.length > end + 1) output.push(handshake.subarray(end + 1)); handshake = Buffer.alloc(0); resolveReady();
        } else output.push(value);
        // 包装器在有子进程时先报告固定失败，再等待自有terminate；不能等退出后才清理进程组。
        if (bytes <= 4096 && output.length && output.at(-1)!.at(-1) === 10) {
          let early: unknown;
          try { early = JSON.parse(decodeRemoteCommandText(Buffer.concat(output))); } catch { /* 最终响应统一校验无效协议。 */ }
          if (object(early) && early.kind === 'failure' && early.version === 1 && early.nonce === nonce && early.end === nonce && Object.keys(early).sort().join(',') === 'code,end,kind,nonce,version') {
            op.fail(['capability', 'output-limit', 'timeout', 'protocol'].includes(early.code as string) ? early.code as RemoteCommandFailure : 'protocol');
          }
        }
      } catch (error) { op.fail(error instanceof RemoteCommandError ? error.code : 'protocol'); }
    };
    const timer = setTimeout(() => op.fail('timeout'), Math.max(1, deadline - performance.now()));
    signal?.addEventListener('abort', cancelled, { once: true }); if (signal?.aborted) cancelled(); this.session.on('notification', notification); this.session.on('disconnect', disconnected); this.session.on('close', closed);
    try {
      return await withRemoteOperation(() => this.assert(op), async () => {
        const params: Record<string, JsonValue> = { command: [this.python, '-I', '-u', '-c', PYTHON, nonce, String(input.length), digest(input), String(remaining())], processId, streamStdin: true, streamStdoutStderr: true, outputBytesCap: wireCap, timeoutMs: remaining(), cwd, ...(env === undefined ? {} : { env }) };
        // 调用开始后保守视为可能发送；RPC明确未发送的拒绝会恢复准确边界。
        const execution = this.session.call('command/exec', params, { timeoutMs: remaining(), signal: abort.signal }); op.sent = true;
        const result = execution.catch((error: unknown) => {
          if (error instanceof RemoteRpcError && !error.mayHaveBeenSent && !ready) op.sent = false;
          throw error;
        }); void result.catch(() => undefined);
        const earlyExit = result.then(response => {
          if (!ready) {
            if (probe && object(response) && typeof response.exitCode === 'number' && response.exitCode !== 0) throw new RemoteCommandError('python3-required', true);
            throw new RemoteCommandError('protocol', op.sent);
          }
        }); void earlyExit.catch(() => undefined);
        await Promise.race([readiness, failure, earlyExit.then(() => { throw new RemoteCommandError('protocol', true); })]);
        for (let offset = 0; offset < input.length; offset += 16384) {
          const part = input.subarray(offset, offset + 16384);
          await Promise.race([this.session.call('command/exec/write', { processId, deltaBase64: part.toString('base64'), closeStdin: offset + part.length === input.length }, { timeoutMs: remaining(), signal: abort.signal }), failure]);
        }
        const response = await Promise.race([result, failure]); remaining();
        if (!object(response) || response.exitCode !== 0 || response.stdout !== '' || response.stderr !== '') throw new RemoteCommandError('protocol', true);
        let record: unknown;
        try {
          const text = decodeRemoteCommandText(Buffer.concat(output)); if (!text.endsWith('\n')) throw new Error();
          record = JSON.parse(text, (key, value: unknown) => { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(); return value; });
        } catch { throw new RemoteCommandError('protocol', true); }
        if (!object(record) || record.version !== 1 || record.nonce !== nonce || record.end !== nonce) throw new RemoteCommandError('protocol', true);
        const keys = record.kind === 'result' ? 'end,exitCode,kind,nonce,stderr,stdout,version' : record.kind === 'probe' ? 'end,kind,major,nonce,python,version' : record.kind === 'failure' ? 'code,end,kind,nonce,version' : '';
        if (Object.keys(record).sort().join(',') !== keys) throw new RemoteCommandError('protocol', true);
        if (record.kind === 'failure') {
          const code = ['capability', 'output-limit', 'timeout', 'protocol'].includes(record.code as string) ? record.code as RemoteCommandFailure : 'protocol'; throw new RemoteCommandError(code, true);
        }
        if (record.kind !== (probe ? 'probe' : 'result')) throw new RemoteCommandError('protocol', true);
        if (record.kind === 'result') {
          if (!Number.isSafeInteger(record.exitCode) || (record.exitCode as number) < -2147483648 || (record.exitCode as number) > 2147483647) throw new RemoteCommandError('protocol', true);
          const captured = (value: unknown, cap: number): Buffer => {
            if (!object(value) || Object.keys(value).sort().join(',') !== 'base64,sha256,size' || !Number.isSafeInteger(value.size) || (value.size as number) < 0 || (value.size as number) > cap || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) throw new RemoteCommandError('protocol', true);
            const bytes = base64(value.base64, cap); if (bytes.length !== value.size || digest(bytes) !== value.sha256) throw new RemoteCommandError('protocol', true); return bytes;
          };
          record.stdout = captured(record.stdout, stdoutCap); record.stderr = captured(record.stderr, stderrCap);
        } else if (record.kind === 'probe') {
          if (record.major !== 3 || typeof record.python !== 'string' || !record.python.length || record.python.length > 16384 || record.python.includes('\0') || !absolute(record.python, this.metadata.platformFamily)) throw new RemoteCommandError('protocol', true);
        }
        remaining();
        return record;
      });
    } catch (error) {
      let classified: RemoteCommandError;
      if (op.error) classified = new RemoteCommandError(op.error.code, op.sent);
      else if (error instanceof RemoteCommandError) classified = error;
      else if (error instanceof RemoteRpcError) classified = new RemoteCommandError(error.code === 'network' || error.code === 'closed' ? 'disconnected' : error.code === 'response' ? 'capability' : error.code === 'cancelled' ? 'cancelled' : error.code === 'timeout' ? 'timeout' : error.code === 'capacity' ? 'capacity' : 'protocol', op.sent || error.mayHaveBeenSent);
      else classified = new RemoteCommandError('protocol', op.sent);
      op.error = classified; abort.abort();
      // cleanup独立于已结束业务期限，只允许本适配器自己生成的processId。不关闭共享session。
      if (op.sent && this.session.ready) await this.session.call('command/exec/terminate', { processId }, { timeoutMs: 1000 }).catch(() => undefined);
      throw classified;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancelled); this.session.off('notification', notification); this.session.off('disconnect', disconnected); this.session.off('close', closed);
      abort.abort(); this.operations.delete(op); activeCommands--; reservedMemory -= reservation;
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; for (const op of this.operations) op.fail('closed');
    this.closing = Promise.allSettled([...this.flights]).then(() => undefined); return this.closing;
  }
}
