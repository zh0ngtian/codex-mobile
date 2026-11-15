import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { RemoteCommands, RemoteCommandError, decodeRemoteCommandText } from './remote/commands.js';
import { RemoteRpcSession } from './remote/rpc-session.js';
import { ROLLOUT_LOCATOR_PYTHON, ROLLOUT_PYTHON } from './remote/rollout-python.js';

export type RolloutProjection = 'timestamps' | 'citations' | 'metadata' | 'cwd' | 'image';
export interface RolloutRead {
  files(threadId: string): AsyncGenerator<string>;
  project(path: string, threadId: string, projection: RolloutProjection, wanted: string[]): AsyncGenerator<{ reset: true } | { value: Record<string, any> }>;
}
export class RolloutSourceError extends Error {
  constructor(readonly code: string) { super(`Remote rollout读取未完成：${code}`); this.name = 'RolloutSourceError'; }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
// readline在不同Node版本对原始Unicode分隔符的处理不同；跟随当前Local运行时。
let unicodeLines: Promise<boolean> | undefined;
function runtimeUnicodeLines(): Promise<boolean> {
  return unicodeLines ??= (async () => {
    const lines = createInterface({ input: Readable.from(['{}\u2028{}']), crlfDelay: Infinity });
    let count = 0;
    try { for await (const _line of lines) count++; } finally { lines.close(); }
    return count === 2;
  })();
}

/** 可信目标绑定的只读rollout能力；没有Local/SSH回退，也不拥有caller连接。 */
export class RemoteRolloutSource {
  readonly kind = 'remote';
  readonly namespace: string;
  private readonly binding: ReturnType<RemoteCommands['fileTransportBinding']>;
  private readonly paths: typeof posix;
  private readonly timeoutMs: number;
  private readonly abort = new AbortController();
  private readonly flights = new Set<Promise<unknown>>();
  private closed = false;
  private closing?: Promise<void>;
  constructor(private session: RemoteRpcSession, private commands: RemoteCommands, gatewayId: string, private options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
    if (!(session instanceof RemoteRpcSession) || !(commands instanceof RemoteCommands) || typeof gatewayId !== 'string' || !gatewayId.length || gatewayId.length > 4096 || /[\u0000-\u001f\u007f]/.test(gatewayId)) throw new RolloutSourceError('binding');
    if (!object(options) || Object.keys(options).some(key => !['timeoutMs', 'signal'].includes(key)) || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) throw new RolloutSourceError('invalid-input');
    this.timeoutMs = options.timeoutMs ?? 20000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 180000) throw new RolloutSourceError('capacity');
    try { this.binding = commands.fileTransportBinding(session); }
    catch (error) { throw new RolloutSourceError(error instanceof RemoteCommandError ? error.code : 'binding'); }
    this.paths = this.binding.metadata.platformFamily === 'windows' ? win32 : posix;
    this.namespace = createHash('sha256').update(JSON.stringify(['remote-rollout-v1', gatewayId, this.binding.scope, this.binding.metadata])).digest('hex');
  }
  /** 业务消费者只能复用同一个已证明的Commands/session与网关namespace。 */
  assertBinding(session: RemoteRpcSession, commands: RemoteCommands, gatewayId: string): void {
    const binding = commands.fileTransportBinding(session);
    const expected = createHash('sha256').update(JSON.stringify(['remote-rollout-v1', gatewayId, binding.scope, binding.metadata])).digest('hex');
    if (session !== this.session || commands !== this.commands || expected !== this.namespace) throw new RolloutSourceError('binding');
  }
  begin(signal?: AbortSignal): RolloutRead {
    // 整次目录+文件读取共享原绝对期限，翻页/文件变化不会续期。
    const deadline = performance.now() + this.timeoutMs;
    const combined = AbortSignal.any([this.abort.signal, ...(this.options.signal ? [this.options.signal] : []), ...(signal ? [signal] : [])]);
    const call = async (request: Record<string, unknown>): Promise<Record<string, any>> => {
      const remaining = () => {
        if (this.closed) throw new RolloutSourceError('closed');
        if (combined.aborted) throw new RolloutSourceError('cancelled');
        if (performance.now() >= deadline) throw new RolloutSourceError('timeout');
        return Math.max(1, Math.floor(deadline - performance.now()));
      };
      remaining();
      try {
        this.commands.fileTransportBinding(this.session);
        const wireRequest = { ...request, unicodeLines: await runtimeUnicodeLines() };
        const flight = this.commands.execute({ argv: [this.binding.python, '-I', '-c', request.mode === 'locate' ? ROLLOUT_LOCATOR_PYTHON : ROLLOUT_PYTHON, JSON.stringify(wireRequest)], cwd: this.binding.metadata.codexHome,
          timeoutMs: remaining(), stdoutBytesCap: 131072, stderrBytesCap: 16384, signal: combined });
        this.flights.add(flight); let result;
        try { result = await flight; } finally { this.flights.delete(flight); }
        remaining();
        if (result.exitCode !== 0 || result.stderr.length) throw new RolloutSourceError('capability');
        const value: unknown = JSON.parse(decodeRemoteCommandText(result.stdout));
        if (!object(value)) throw new RolloutSourceError('protocol');
        if (Object.hasOwn(value, 'error')) {
          if (Object.keys(value).length !== 1 || !['missing', 'permission', 'changed', 'capacity', 'capability', 'protocol'].includes(value.error)) throw new RolloutSourceError('protocol');
          throw new RolloutSourceError(value.error);
        }
        return value;
      } catch (error) {
        if (this.closed) throw new RolloutSourceError('closed');
        if (combined.aborted) throw new RolloutSourceError('cancelled');
        throw error instanceof RolloutSourceError ? error : new RolloutSourceError(error instanceof RemoteCommandError ? error.code : 'protocol');
      }
    };
    const paths = this.paths; const home = this.binding.metadata.codexHome;
    return {
      async *files(threadId) {
        if (!UUID.test(threadId)) return;
        const filename = new RegExp(`-${threadId}(?:_[a-f0-9-]{36})*\\.jsonl$`, 'i');
        for (;;) {
          const candidates: Array<string | RolloutSourceError> = []; const digest = createHash('sha256');
          let offset = 0; let version: string | undefined; let signature: string | undefined; let pending = '';
          try {
            for (;;) {
              const value = await call({ mode: 'locate', path: home, windows: paths === win32, threadId, offset, ...(version ? { version } : {}) });
              if (typeof value.version !== 'string' || !HASH.test(value.version) || value.offset !== offset || !Number.isSafeInteger(value.total) || value.total < offset || typeof value.sha256 !== 'string' || !HASH.test(value.sha256) || typeof value.base64 !== 'string') throw new RolloutSourceError('protocol');
              const current = JSON.stringify([value.version, value.total, value.sha256]);
              if (signature !== undefined && signature !== current) throw new RolloutSourceError('changed'); signature = current; version = value.version;
              const bytes = Buffer.from(value.base64, 'base64');
              if (bytes.length > 65536 || bytes.toString('base64') !== value.base64 || bytes.length !== Math.min(65536, value.total - offset)) throw new RolloutSourceError('protocol');
              digest.update(bytes); pending += decodeRemoteCommandText(bytes); offset += bytes.length;
              let end: number;
              while ((end = pending.indexOf('\n')) >= 0) {
                const path: unknown = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
                if (candidates.at(-1) instanceof RolloutSourceError) throw new RolloutSourceError('protocol');
                if (object(path) && Object.keys(path).length === 1 && ['permission', 'capacity', 'capability'].includes(path.error)) { candidates.push(new RolloutSourceError(path.error)); continue; }
                if (typeof path !== 'string') throw new RolloutSourceError('protocol');
                const parts = paths.relative(home, path).split(paths.sep); const name = parts.at(-1)!;
                if (paths.join(home, ...parts) !== path || !(parts.length === 2 && parts[0] === 'archived_sessions' || parts.length === 5 && parts[0] === 'sessions' && /^[0-9]{4}$/.test(parts[1]) && /^(0[1-9]|1[0-2])$/.test(parts[2]) && /^(0[1-9]|[12][0-9]|3[01])$/.test(parts[3])) || !name.startsWith('rollout-') || !filename.test(name)) throw new RolloutSourceError('protocol');
                candidates.push(path);
              }
              if (offset === value.total) {
                if (pending.length || digest.digest('hex') !== value.sha256) throw new RolloutSourceError('protocol');
                break;
              }
            }
            // 完成所有窗口的目录版本/输出摘要证明后才交付，首结果读取也不跳过证明。
            for (const candidate of candidates) { if (candidate instanceof RolloutSourceError) throw candidate; yield candidate; }
            return;
          } catch (error) {
            if (error instanceof RolloutSourceError && error.code === 'changed') continue;
            if (error instanceof RolloutSourceError && error.code === 'missing') return;
            throw error instanceof RolloutSourceError ? error : new RolloutSourceError('protocol');
          }
        }
      },
      async *project(path, threadId, projection, wanted) {
        // 请求也按固定窗口传送；摘要保持任意长度合法引用ID的精确匹配语义。
        const batches: string[][] = [];
        for (let i = 0; i < wanted.length; i += 32) batches.push(wanted.slice(i, i + 32).map(id => createHash('sha256').update(id).digest('hex')));
        if (!batches.length) batches.push([]);
        for (;;) {
          yield { reset: true };
          let token: unknown;
          try {
            for (const batch of batches) {
              let offset = 0; let signature: string | undefined; let pending = ''; const digest = createHash('sha256');
              for (;;) {
                const value = await call({ mode: 'scan', path, threadId, projection, wanted: batch, ...(projection === 'image' ? { itemId: wanted[0] } : {}), offset, ...(token ? { token } : {}) });
                if (!object(value.token) || !Array.isArray(value.token.identity) || value.token.identity.length !== 2 || value.token.identity.some((v: unknown) => typeof v !== 'string' || !/^\d+$/.test(v)) || !Number.isSafeInteger(value.token.size) || value.token.size < 0 || typeof value.token.sha256 !== 'string' || !HASH.test(value.token.sha256) || value.offset !== offset || !Number.isSafeInteger(value.total) || value.total < offset || typeof value.sha256 !== 'string' || !HASH.test(value.sha256) || typeof value.base64 !== 'string') throw new RolloutSourceError('protocol');
                const current = JSON.stringify([value.token, value.total, value.sha256]);
                if (signature !== undefined && signature !== current) throw new RolloutSourceError('changed'); signature = current; token = value.token;
                const bytes = Buffer.from(value.base64, 'base64');
                if (bytes.length > 65536 || bytes.toString('base64') !== value.base64 || bytes.length !== Math.min(65536, value.total - offset)) throw new RolloutSourceError('protocol');
                digest.update(bytes); pending += decodeRemoteCommandText(bytes); offset += bytes.length;
                let end: number;
                while ((end = pending.indexOf('\n')) >= 0) {
                  const line = pending.slice(0, end); pending = pending.slice(end + 1); const projected: unknown = JSON.parse(line);
                  if (!object(projected)) throw new RolloutSourceError('protocol'); yield { value: projected };
                }
                if (offset === value.total) { if (pending.length || digest.digest('hex') !== value.sha256) throw new RolloutSourceError('protocol'); break; }
              }
            }
            return;
          } catch (error) {
            if (error instanceof RolloutSourceError && error.code === 'changed') continue;
            if (error instanceof RolloutSourceError && error.code === 'missing') { yield { reset: true }; return; }
            throw error instanceof RolloutSourceError ? error : new RolloutSourceError('protocol');
          }
        }
      },
    };
  }
  close(): Promise<void> {
    if (this.closing) return this.closing; this.closed = true; this.abort.abort();
    this.closing = Promise.allSettled([...this.flights]).then(() => undefined); return this.closing;
  }
}
export function remoteRollouts(session: RemoteRpcSession, commands: RemoteCommands, gatewayId: string, options?: { timeoutMs?: number; signal?: AbortSignal }): RemoteRolloutSource {
  return new RemoteRolloutSource(session, commands, gatewayId, options);
}
