import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { posix, win32 } from 'node:path';
import { RemoteCommands, RemoteCommandError, type RemoteCommandScope, type RemoteCommandMetadata } from './commands.js';
import type { RemoteRpcSession } from './rpc-session.js';
import { assertRemoteOperation } from './operation-guard.js';
import { FILE_CHUNK_BYTES, FILE_MAX_BYTES, FILE_WINDOW, RemoteFileChannel, RemoteFileError, fileFailure, fileSha, fileText, record, strictBase64 } from './file-channel.js';
export { RemoteFileError } from './file-channel.js';
export const REMOTE_FILE_LIMITS = Object.freeze({ maxBytes: FILE_MAX_BYTES, chunkBytes: FILE_CHUNK_BYTES, window: FILE_WINDOW, maxConcurrent: 4, reservedBytesPerFile: 16 * 1024 * 1024, globalReservedBytes: 64 * 1024 * 1024, maxTextBytes: 2 * 1024 * 1024 });
export interface RemoteFileOptions { timeoutMs?: number; signal?: AbortSignal }
export interface RemoteReadOptions extends RemoteFileOptions { offset?: number; length?: number; version?: string }
export interface RemoteFileStat { path: string; type: 'file' | 'directory' | 'symlink' | 'other'; size: number; version: string }
export interface RemoteDirectoryEntry { path: string; name: string; type: RemoteFileStat['type'] }
export interface RemoteUploadOptions extends RemoteFileOptions { size: number; sha256: string; expectedVersion: string | null }
export interface RemoteUploadOperation { readonly namespace: string; readonly token: Readonly<Record<string, unknown>>; readonly protocol: 1 }
export interface RemoteUploadResult extends RemoteFileStat { sha256: string; operation: RemoteUploadOperation }
type Facts = Record<'dev' | 'ino' | 'mode' | 'size' | 'mtime' | 'ctime', string>;
function keys(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!record(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'))) throw new RemoteFileError('invalid-input', false);
  return value;
}
function integer(value: unknown, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > maximum) throw new RemoteFileError('capacity', false); return n;
}
function text(value: unknown, max = 16384): string {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > max || value.includes('\0') || Buffer.from(value).toString('utf8') !== value) throw new RemoteFileError('invalid-input', false); return value;
}
function facts(value: unknown): Facts {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'ctime,dev,ino,mode,mtime,size' || Object.values(value).some(n => typeof n !== 'string' || !/^-?[0-9]{1,64}$/.test(n)) || ['dev', 'ino', 'mode', 'size'].some(k => (value[k] as string).startsWith('-')) || !Number.isSafeInteger(Number(value.size))) throw new RemoteFileError('protocol', true);
  return value as Facts;
}
function body(value: Record<string, unknown>, kind: string, fields: string[]): void {
  if (value.kind !== kind || Object.keys(value).sort().join(',') !== ['v', 'n', 'end', 'seq', 'kind', ...fields].sort().join(',')) throw new RemoteFileError('protocol', true);
}
function freeze<T>(value: T): T { if (record(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function directoryKey(value: string, windows: boolean): string {
  // 仅比较分隔符形式及目录尾分隔符；不折叠symlink/..，不改写实际目标路径。
  return windows ? value.replace(/\//g, '\\').replace(/\\+$/, '') : value.replace(/\/+$/, '');
}
/** 内部服务端文件基础；仅使用3a已证明的同一ready session，不初始化或关闭调用者连接。 */
export class RemoteFiles {
  readonly scope: RemoteCommandScope;
  readonly metadata: Readonly<RemoteCommandMetadata>;
  readonly namespace: string;
  private closed = false;
  private closing?: Promise<void>;
  private readonly channels = new Set<RemoteFileChannel>();
  private readonly flights = new Set<Promise<unknown>>();
  private constructor(private readonly session: RemoteRpcSession, private readonly binding: ReturnType<RemoteCommands['fileTransportBinding']>) {
    this.scope = binding.scope; this.metadata = binding.metadata; this.namespace = fileSha(Buffer.from(JSON.stringify(binding.scope)));
  }
  static async create(session: RemoteRpcSession, scope: RemoteCommandScope, signal?: AbortSignal): Promise<RemoteFiles> {
    let commands: RemoteCommands | undefined;
    try {
      commands = await RemoteCommands.create(session, scope, signal);
      const binding = commands.fileTransportBinding(session); const result = new RemoteFiles(session, binding); assertRemoteOperation();
      if (signal?.aborted) throw new RemoteFileError('cancelled', true); return result;
    } catch (error) {
      if (error instanceof RemoteCommandError) throw new RemoteFileError(error.code === 'output-limit' ? 'capacity' : error.code, error.mayHaveBeenSent);
      throw error instanceof RemoteFileError ? error : new RemoteFileError('protocol', false);
    } finally { await commands?.close(); }
  }
  private path(value: unknown): string {
    const path = text(value); const paths = this.metadata.platformFamily === 'windows' ? win32 : posix;
    // 只按真实目标规则判断绝对路径，不resolve/normalize，不访问网关同名路径。
    if (!paths.isAbsolute(path) || (this.metadata.platformFamily === 'windows' && !/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(path))) throw new RemoteFileError('invalid-input', false); return path;
  }
  private options(value: unknown, allowed: string[], started: number): { raw: Record<string, unknown>; deadline: number; signal?: AbortSignal } {
    const raw = keys(value, ['timeoutMs', 'signal', ...allowed]); const timeout = integer(raw.timeoutMs, 20000, 180000);
    if (!timeout || (raw.signal !== undefined && !(raw.signal instanceof AbortSignal))) throw new RemoteFileError('invalid-input', false);
    if (this.closed || !this.session.ready) throw new RemoteFileError('closed', false);
    if ((raw.signal as AbortSignal | undefined)?.aborted) throw new RemoteFileError('cancelled', false);
    assertRemoteOperation(); if (performance.now() >= started + timeout) throw new RemoteFileError('timeout', false);
    return { raw, deadline: started + timeout, signal: raw.signal as AbortSignal | undefined };
  }
  private version(path: string, value: unknown): string { return Buffer.from(JSON.stringify([this.namespace, path, facts(value)])).toString('base64url'); }
  private expected(path: string, token: unknown): Facts {
    try {
      if (typeof token !== 'string' || token.length > 65536 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
      const encoded = Buffer.from(token, 'base64url'); if (encoded.toString('base64url') !== token) throw new Error();
      const decoded: unknown = JSON.parse(fileText(encoded));
      if (!Array.isArray(decoded) || decoded.length !== 3 || decoded[0] !== this.namespace || decoded[1] !== path) throw new Error();
      return facts(decoded[2]);
    } catch { throw new RemoteFileError('binding', false); }
  }
  private statRecord(path: string, value: Record<string, unknown>): RemoteFileStat {
    const f = facts(value.facts); if (value.path !== path || !['file', 'directory', 'symlink', 'other'].includes(value.type as string)) throw new RemoteFileError('protocol', true);
    return { path, type: value.type as RemoteFileStat['type'], size: Number(f.size), version: this.version(path, f) };
  }
  private async channel(deadline: number, signal?: AbortSignal, cleanup = false): Promise<RemoteFileChannel> {
    const channel = new RemoteFileChannel(this.session, this.binding, deadline, signal, cleanup, () => this.channels.delete(channel)); this.channels.add(channel);
    try { await channel.start(); return channel; } catch (error) { await channel.stop(); channel.release(); this.channels.delete(channel); throw error; }
  }
  private async release(channel: RemoteFileChannel | undefined): Promise<void> { if (channel) { await channel.stop(); channel.release(); this.channels.delete(channel); } }
  private track<T>(work: Promise<T>): Promise<T> { this.flights.add(work); void work.then(() => this.flights.delete(work), () => this.flights.delete(work)); return work; }
  async stat(path: string, options: RemoteFileOptions = {}): Promise<RemoteFileStat> {
    const started = performance.now(); let channel: RemoteFileChannel | undefined;
    try {
      path = this.path(path); const o = this.options(options, [], started); channel = await this.channel(o.deadline, o.signal);
      const [result] = await channel.exchange([{ mode: 'stat', path }]); body(result!, 'stat', ['path', 'type', 'facts']); const stat = this.statRecord(path, result!);
      await channel.finish(); return stat;
    } catch (error) { throw fileFailure(error, channel?.sent ?? false); } finally { await this.release(channel); }
  }
  read(path: string, options: RemoteReadOptions = {}): AsyncGenerator<Buffer> {
    const started = performance.now(); return this.readInternal(path, options, started);
  }
  private async *readInternal(path: string, options: RemoteReadOptions, started: number): AsyncGenerator<Buffer> {
    let channel: RemoteFileChannel | undefined;
    try {
      path = this.path(path); const o = this.options(options, ['offset', 'length', 'version'], started);
      const offset = integer(o.raw.offset, 0); const length = o.raw.length === undefined ? undefined : integer(o.raw.length, 0, FILE_MAX_BYTES);
      if (length !== undefined && !Number.isSafeInteger(offset + length)) throw new RemoteFileError('capacity', false);
      const expected = o.raw.version === undefined ? undefined : this.expected(path, o.raw.version);
      channel = await this.channel(o.deadline, o.signal);
      const [meta] = await channel.exchange([{ mode: 'read', path, offset, ...(length === undefined ? {} : { length }), ...(expected ? { expected } : {}) }]);
      body(meta!, 'meta', ['path', 'type', 'facts', 'length', 'offset']); const initial = this.statRecord(path, meta!);
      if (initial.type !== 'file' || meta!.offset !== offset || !Number.isSafeInteger(meta!.length) || (meta!.length as number) < 0 || (meta!.length as number) > FILE_MAX_BYTES || offset + (meta!.length as number) > initial.size || (length !== undefined && meta!.length !== length) || (expected && initial.version !== o.raw.version)) throw new RemoteFileError('protocol', true);
      let total = 0; const hash = createHash('sha256');
      while (true) {
        const batch = await channel.exchange([{ op: 'next', count: FILE_WINDOW }], FILE_WINDOW + 1, r => r.kind === 'done' || r.kind === 'batch-end');
        const tail = batch.pop()!; const decoded: Buffer[] = []; channel.holdWindow(batch, decoded);
        for (const part of batch) {
          body(part, 'chunk', ['offset', 'size', 'sha256', 'base64']);
          const bytes = strictBase64(part.base64, FILE_CHUNK_BYTES);
          if (!bytes.length || part.offset !== offset + total || part.size !== bytes.length || fileSha(bytes) !== part.sha256 || total + bytes.length > (meta!.length as number)) throw new RemoteFileError('integrity', true);
          total += bytes.length; hash.update(bytes); decoded.push(bytes); channel.assert();
        }
        if (tail.kind === 'done') {
          body(tail, 'done', ['total', 'sha256', 'facts']);
          if (tail.total !== total || total !== meta!.length || tail.sha256 !== hash.digest('hex') || this.version(path, tail.facts) !== initial.version) throw new RemoteFileError('integrity', true);
          await channel.finish(); for (const part of decoded) { channel.assert(); yield part; } channel.assert(); return;
        }
        body(tail, 'batch-end', []); if (batch.length !== FILE_WINDOW || total >= (meta!.length as number)) throw new RemoteFileError('protocol', true);
        for (const part of decoded) { channel.assert(); yield part; } channel.assert(); channel.clearWindow();
      }
    } catch (error) { throw fileFailure(error, channel?.sent ?? false); } finally { await this.release(channel); }
  }
  list(path: string, options: RemoteFileOptions & { pageSize?: number } = {}): AsyncGenerator<RemoteDirectoryEntry[]> {
    const started = performance.now(); return this.listInternal(path, options, started);
  }
  private async *listInternal(path: string, options: RemoteFileOptions & { pageSize?: number }, started: number): AsyncGenerator<RemoteDirectoryEntry[]> {
    let channel: RemoteFileChannel | undefined;
    try {
      path = this.path(path); const o = this.options(options, ['pageSize'], started); const pageSize = integer(o.raw.pageSize, 32, 64); if (!pageSize) throw new RemoteFileError('capacity', false);
      channel = await this.channel(o.deadline, o.signal); const [meta] = await channel.exchange([{ mode: 'list', path }]); body(meta!, 'meta', ['path', 'type', 'facts']); const initial = this.statRecord(path, meta!);
      if (initial.type !== 'directory') throw new RemoteFileError('protocol', true);
      while (true) {
        const [result] = await channel.exchange([{ op: 'next', pageSize }]); const done = result!.kind === 'done'; body(result!, done ? 'done' : 'page', done ? ['entries', 'facts'] : ['entries']);
        if (!Array.isArray(result!.entries) || result!.entries.length > pageSize) throw new RemoteFileError('protocol', true);
        const paths = this.metadata.platformFamily === 'windows' ? win32 : posix;
        const entries = result!.entries.map((value: unknown) => {
          if (!record(value) || Object.keys(value).sort().join(',') !== 'name,path,type' || !['file', 'directory', 'symlink', 'other'].includes(value.type as string)) throw new RemoteFileError('protocol', true);
          const entryPath = this.path(value.path); const name = text(value.name);
          if (directoryKey(paths.dirname(entryPath), this.metadata.platformFamily === 'windows') !== directoryKey(path, this.metadata.platformFamily === 'windows') || paths.basename(entryPath) !== name) throw new RemoteFileError('protocol', true);
          return { path: entryPath, name, type: value.type as RemoteFileStat['type'] };
        });
        channel.holdWindow(result!.entries, entries);
        if (done) { if (this.version(path, result!.facts) !== initial.version) throw new RemoteFileError('version', true); await channel.finish(); }
        channel.assert(); if (entries.length) yield entries; channel.assert(); if (done) return;
        channel.clearWindow();
      }
    } catch (error) { throw fileFailure(error, channel?.sent ?? false); } finally { await this.release(channel); }
  }
  private operation(value: unknown, path?: string, id?: string, size?: number, sha256?: string, expected?: Facts | null): RemoteUploadOperation {
    if (!record(value) || !['directory,expected,id,namespace,path,sha256,size', 'cleanupFilesIdentity,cleanupIdentity,cleanupLockIdentity,directory,directoryIdentity,expected,id,lockIdentity,namespace,path,payloadIdentity,receiptIdentity,sha256,size'].includes(Object.keys(value).sort().join(','))) throw new RemoteFileError('protocol', true);
    keys(value, ['directory', 'directoryIdentity', 'expected', 'id', 'namespace', 'path', 'payloadIdentity', 'receiptIdentity', 'lockIdentity', 'cleanupIdentity', 'cleanupLockIdentity', 'cleanupFilesIdentity', 'sha256', 'size']);
    if (value.namespace !== this.namespace || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || !Number.isSafeInteger(value.size) || (value.size as number) < 0 || (value.size as number) > FILE_MAX_BYTES || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new RemoteFileError('protocol', true);
    if (value.expected !== null) facts(value.expected);
    const actualPath = this.path(value.path); const directory = this.path(value.directory); const paths = this.metadata.platformFamily === 'windows' ? win32 : posix;
    if ((path !== undefined && actualPath !== path) || (id !== undefined && value.id !== id) || (size !== undefined && value.size !== size) || (sha256 !== undefined && value.sha256 !== sha256) || (expected !== undefined && JSON.stringify(value.expected) !== JSON.stringify(expected)) || directoryKey(paths.dirname(directory), this.metadata.platformFamily === 'windows') !== directoryKey(paths.dirname(actualPath), this.metadata.platformFamily === 'windows') || paths.basename(directory) !== '.codex-mobile-upload-' + String(value.id)) throw new RemoteFileError('protocol', true);
    for (const field of (Object.hasOwn(value, 'directoryIdentity') ? ['directoryIdentity', 'receiptIdentity', 'payloadIdentity', 'lockIdentity', 'cleanupIdentity', 'cleanupLockIdentity', 'cleanupFilesIdentity'] : [])) {
      const identity = value[field]; keys(identity, ['dev', 'ino', 'mode']); if (!record(identity) || Object.keys(identity).sort().join(',') !== 'dev,ino,mode' || Object.values(identity).some(n => typeof n !== 'string' || !/^[0-9]{1,64}$/.test(n))) throw new RemoteFileError('protocol', true);
    }
    const token = freeze(JSON.parse(JSON.stringify(value)) as Record<string, unknown>); return Object.freeze({ namespace: this.namespace, token, protocol: 1 as const });
  }
  private validateOperation(value: unknown): RemoteUploadOperation {
    try {
      const raw = keys(value, ['namespace', 'token', 'protocol']);
      if (raw.namespace !== this.namespace || raw.protocol !== 1 || !record(raw.token) || raw.token.namespace !== this.namespace) throw new Error();
      return this.operation(raw.token);
    } catch { throw new RemoteFileError('binding', false); }
  }
  upload(path: string, source: AsyncIterable<Uint8Array>, options: RemoteUploadOptions): Promise<RemoteUploadResult> { return this.track(this.uploadInternal(path, source, options, performance.now())); }
  private async uploadInternal(path: string, source: AsyncIterable<Uint8Array>, options: RemoteUploadOptions, started: number): Promise<RemoteUploadResult> {
    let channel: RemoteFileChannel | undefined; let operation: RemoteUploadOperation | undefined; let commitSent = false; let iterator: AsyncIterator<Uint8Array> | undefined;
    try {
      path = this.path(path); const o = this.options(options, ['size', 'sha256', 'expectedVersion'], started); const size = integer(o.raw.size, -1, FILE_MAX_BYTES);
      if (size < 0 || typeof o.raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(o.raw.sha256) || o.raw.expectedVersion === undefined || !source || typeof source[Symbol.asyncIterator] !== 'function') throw new RemoteFileError('invalid-input', false);
      const sha256 = o.raw.sha256; const expected = o.raw.expectedVersion === null ? null : this.expected(path, o.raw.expectedVersion); const id = randomUUID();
      const paths = this.metadata.platformFamily === 'windows' ? win32 : posix; const parent = paths.dirname(path);
      const separator = parent.endsWith(paths.sep) || (this.metadata.platformFamily === 'windows' && parent.endsWith('/')) ? '' : paths.sep;
      const directory = this.path(parent + separator + '.codex-mobile-upload-' + id);
      operation = this.operation({ path, directory, size, sha256, expected, id, namespace: this.namespace });
      channel = await this.channel(o.deadline, o.signal); const [begin] = await channel.exchange([{ mode: 'upload', path, directory, size, sha256, expected, id, namespace: this.namespace }]); body(begin!, 'upload', ['operation']);
      operation = this.operation(begin!.operation, path, id, size, sha256, expected); iterator = source[Symbol.asyncIterator](); let total = 0; let acknowledged = 0; let ended = false; const hash = createHash('sha256');
      let pending: Buffer = Buffer.alloc(0); let pendingOffset = 0;
      while (!ended) {
        const payloads: Record<string, unknown>[] = []; const checks: { total: number; sha256: string }[] = [];
        for (let n = 0; n < FILE_WINDOW; n++) {
          const buffer = Buffer.allocUnsafe(FILE_CHUNK_BYTES); let used = 0;
          // 生产者可以用小块渐进生成；固定大小聚合不把其块数变成Remote往返数。
          while (used < FILE_CHUNK_BYTES) {
            if (pendingOffset === pending.length) {
              const next = await channel.race(Promise.resolve().then(() => iterator!.next())); if (next.done) { ended = true; break; }
              if (!(next.value instanceof Uint8Array) || next.value.byteLength > FILE_CHUNK_BYTES) throw new RemoteFileError('capacity', true);
              if (total + used + next.value.byteLength > size) throw new RemoteFileError('integrity', true);
              pending = Buffer.from(next.value); pendingOffset = 0;
              if (!pending.length) continue;
            }
            const count = Math.min(FILE_CHUNK_BYTES - used, pending.length - pendingOffset);
            pending.copy(buffer, used, pendingOffset, pendingOffset + count); used += count; pendingOffset += count; channel.assert();
          }
          if (!used) break;
          const bytes = buffer.subarray(0, used);
          const digest = fileSha(bytes); payloads.push({ op: 'chunk', offset: total, size: bytes.length, sha256: digest, base64: bytes.toString('base64') }); total += bytes.length; hash.update(bytes); checks.push({ total, sha256: digest }); channel.assert();
          if (ended) break;
        }
        if (!payloads.length) continue;
        const acks = await channel.exchange(payloads);
        acks.forEach((ack, n) => { body(ack, 'ack', ['total', 'sha256']); if (ack.total !== checks[n]!.total || ack.sha256 !== checks[n]!.sha256) throw new RemoteFileError('integrity', true); acknowledged = ack.total as number; }); channel.assert();
      }
      if (total !== size || acknowledged !== size || hash.digest('hex') !== sha256) throw new RemoteFileError('integrity', true);
      const [stage] = await channel.exchange([{ op: 'stage' }]); body(stage!, 'staged', ['total', 'sha256']); if (stage!.total !== size || stage!.sha256 !== sha256) throw new RemoteFileError('integrity', true);
      channel.assert(); commitSent = true; const [result] = await channel.exchange([{ op: 'commit' }]); body(result!, 'done', ['path', 'total', 'sha256', 'facts']);
      if (result!.path !== path || result!.total !== size || result!.sha256 !== sha256 || Number(facts(result!.facts).size) !== size) throw new RemoteFileError('integrity', true);
      await channel.finish(); const version = this.version(path, result!.facts); channel.assert(); return { path, size, type: 'file', sha256, version, operation };
    } catch (error) {
      const classified = fileFailure(error, channel?.sent ?? false);
      if (channel) { await channel.stop(); this.channels.delete(channel); }
      if (operation) {
        classified.operation = operation;
        // 未发送commit且原命令已经实际结束才可清理；断线或未知commit保留查询事实，不盲删或重放。
        if (!commitSent && channel?.settled) await this.cleanupOperation(operation).catch(() => undefined);
      }
      throw classified;
    } finally {
      if (iterator?.return) { try { void Promise.resolve(iterator.return()).catch(() => undefined); } catch { /* 不等待不受控生产者。 */ } }
      await this.release(channel);
    }
  }
  private async cleanupOperation(operation: RemoteUploadOperation): Promise<void> {
    let channel: RemoteFileChannel | undefined;
    try { channel = await this.channel(performance.now() + 1000, undefined, true); const [result] = await channel.exchange([{ mode: 'cleanup', path: operation.token.path, operation: operation.token }]); body(result!, 'cleaned', []); await channel.finish(); } finally { await this.release(channel); }
  }
  async queryUpload(value: unknown, options: RemoteFileOptions = {}): Promise<{ state: 'committed' | 'staged' | 'receiving' | 'missing' | 'unknown'; size?: number; sha256?: string; version?: string; currentMatches?: boolean }> {
    const started = performance.now(); let channel: RemoteFileChannel | undefined;
    try {
      const operation = this.validateOperation(value); const o = this.options(options, [], started); channel = await this.channel(o.deadline, o.signal);
      const [result] = await channel.exchange([{ mode: 'query', path: operation.token.path, operation: operation.token }]);
      if (!['committed', 'staged', 'receiving', 'missing', 'unknown'].includes(result!.state as string)) throw new RemoteFileError('protocol', true);
      const full = result!.state === 'committed'; const content = full || result!.state === 'staged' || result!.state === 'receiving'; body(result!, 'query', ['state', ...(content ? ['size', 'sha256'] : []), ...(full ? ['facts', 'currentMatches'] : [])]);
      if (content && (!Number.isSafeInteger(result!.size) || (result!.size as number) < 0 || (result!.size as number) > FILE_MAX_BYTES || typeof result!.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(result!.sha256))) throw new RemoteFileError('protocol', true);
      if ((full || result!.state === 'staged') && (result!.size !== operation.token.size || result!.sha256 !== operation.token.sha256)) throw new RemoteFileError('integrity', true);
      if (full && typeof result!.currentMatches !== 'boolean') throw new RemoteFileError('protocol', true);
      const version = full ? this.version(operation.token.path as string, result!.facts) : undefined; await channel.finish();
      return { state: result!.state as 'committed' | 'staged' | 'receiving' | 'missing' | 'unknown', ...(content ? { size: result!.size as number, sha256: result!.sha256 as string } : {}), ...(version ? { version, currentMatches: result!.currentMatches as boolean } : {}) };
    } catch (error) { throw fileFailure(error, channel?.sent ?? false); } finally { await this.release(channel); }
  }
  /** 调用者持久保存最终结果后显式回收receipt；目标后来被替换也绝不删除目的文件。 */
  async releaseUpload(value: unknown, options: RemoteFileOptions = {}): Promise<void> {
    return this.removeUpload(value, 'release', options);
  }
  /** 先query并持久记录放弃决定后显式调用；已持久记录的同一次discard也可在清理中断后继续。 */
  async discardUpload(value: unknown, options: RemoteFileOptions = {}): Promise<void> {
    return this.removeUpload(value, 'discard', options);
  }
  private async removeUpload(value: unknown, mode: 'release' | 'discard', options: RemoteFileOptions): Promise<void> {
    const started = performance.now(); let channel: RemoteFileChannel | undefined; let operation: RemoteUploadOperation | undefined;
    try {
      operation = this.validateOperation(value); const o = this.options(options, [], started); channel = await this.channel(o.deadline, o.signal);
      const [result] = await channel.exchange([{ mode, path: operation.token.path, operation: operation.token }]); body(result!, 'cleaned', []); await channel.finish();
    } catch (error) { const failure = fileFailure(error, channel?.sent ?? false); if (operation && channel?.sent) failure.operation = operation; throw failure; } finally { await this.release(channel); }
  }
  async readText(path: string, options: RemoteFileOptions & { maxBytes: number; version?: string }): Promise<{ text: string; version: string; snapshotBytes: number }> {
    const started = performance.now(); let sent = false;
    try {
      const o = this.options(options, ['maxBytes', 'version'], started); const maxBytes = integer(o.raw.maxBytes, -1, REMOTE_FILE_LIMITS.maxTextBytes); if (maxBytes < 0) throw new RemoteFileError('capacity', false);
      const remaining = () => this.helperRemaining(o.deadline, o.signal, sent);
      const stat = await this.stat(path, { timeoutMs: remaining(), signal: o.signal }); sent = true; if (stat.size > maxBytes) throw new RemoteFileError('capacity', true);
      const version = o.raw.version === undefined ? stat.version : text(o.raw.version, 65536); const parts: Buffer[] = [];
      for await (const part of this.read(path, { length: stat.size, version, timeoutMs: remaining(), signal: o.signal })) parts.push(part);
      const result = fileText(Buffer.concat(parts)); remaining(); return { text: result, version, snapshotBytes: stat.size };
    } catch (error) { throw fileFailure(error, sent); }
  }
  /** 有界、严格版本快照；末尾未完成行不解析。活跃追加消费者仍须由3d选择已证明的渐进策略。 */
  async readJsonLines(path: string, options: RemoteFileOptions & { maxBytes: number; maxLines?: number }): Promise<{ values: unknown[]; version: string; snapshotBytes: number; incompleteTail: boolean; truncated: boolean }> {
    const started = performance.now(); let sent = false;
    try {
      const o = this.options(options, ['maxBytes', 'maxLines'], started); const maxBytes = integer(o.raw.maxBytes, -1, REMOTE_FILE_LIMITS.maxTextBytes); const maxLines = integer(o.raw.maxLines, 4096, 16384); if (maxBytes < 0) throw new RemoteFileError('capacity', false);
      const remaining = () => this.helperRemaining(o.deadline, o.signal, sent);
      const stat = await this.stat(path, { timeoutMs: remaining(), signal: o.signal }); sent = true; const length = Math.min(stat.size, maxBytes); const parts: Buffer[] = [];
      for await (const part of this.read(path, { length, version: stat.version, timeoutMs: remaining(), signal: o.signal })) parts.push(part);
      const raw = Buffer.concat(parts); const end = raw.lastIndexOf(10); const complete = fileText(raw.subarray(0, end + 1)); const values: unknown[] = [];
      for (const line of complete.split('\n')) { if (!line.trim()) continue; if (values.length >= maxLines) throw new RemoteFileError('capacity', true); values.push(JSON.parse(line)); remaining(); }
      remaining(); return { values, version: stat.version, snapshotBytes: length, incompleteTail: end + 1 < raw.length, truncated: length < stat.size };
    } catch (error) { throw fileFailure(error, sent); }
  }
  private helperRemaining(deadline: number, signal: AbortSignal | undefined, sent: boolean): number {
    assertRemoteOperation();
    if (this.closed) throw new RemoteFileError('closed', sent);
    if (!this.session.ready) throw new RemoteFileError('disconnected', sent);
    if (signal?.aborted) throw new RemoteFileError('cancelled', sent);
    if (performance.now() >= deadline) throw new RemoteFileError('timeout', sent);
    return Math.max(1, Math.floor(deadline - performance.now()));
  }
  close(): Promise<void> {
    if (this.closing) return this.closing; this.closed = true;
    for (const channel of this.channels) channel.fail('closed');
    this.closing = Promise.allSettled([...this.channels].map(channel => channel.stop())).then(() => Promise.allSettled([...this.flights])).then(() => undefined); return this.closing;
  }
}
