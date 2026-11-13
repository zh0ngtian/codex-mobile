import { execFile } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { TextDecoder } from 'node:util';
import { validateManagedAuth, validateStepUp, type ManagedAuth } from './auth-protocol.js';
import type { ManagedAuthIdentity } from './managed-auth.js';

type Port = 1455 | 1457;
export type RemoteOAuthFailure = 'configuration' | 'auth-required' | 'identity-changed' | 'ports-unavailable' | 'browser' | 'denied' | 'http-rejected' | 'network' | 'response-invalid' | 'timeout' | 'cancelled' | 'closed';
const MESSAGES: Record<RemoteOAuthFailure, string> = {
  configuration: 'Remote 授权配置无效', 'auth-required': '受管账号不可用，需要重新认证', 'identity-changed': '授权期间受管账号或目录已变化，请重新认证',
  'ports-unavailable': 'Remote 授权回调端口均被占用', browser: '无法打开 Remote 授权浏览器', denied: 'Remote 授权被拒绝',
  'http-rejected': 'Remote 授权服务拒绝请求', network: 'Remote 授权网络暂时不可用', 'response-invalid': 'Remote 授权响应无效',
  timeout: 'Remote 授权已超时，请重新发起', cancelled: 'Remote 授权已取消', closed: 'Remote 授权已关闭',
};
/** 只含固定分类与中文文本，不保留外部错误或凭据。 */
export class RemoteOAuthError extends Error {
  constructor(readonly code: RemoteOAuthFailure) { super(MESSAGES[code]); this.name = 'RemoteOAuthError'; }
}
export interface RemoteOAuthOptions {
  assertOwnership?: () => void;
  managedAuth: { load(): Promise<ManagedAuth>; readonly currentIdentity: Readonly<ManagedAuthIdentity> | undefined; verifyIdentity(expected?: ManagedAuthIdentity): Promise<Readonly<ManagedAuthIdentity>> };
  /** 仅用于 JWT 新鲜度；操作期限始终使用内部单调时钟。 */
  now?: () => number; timeoutMs?: number; browserTimeoutMs?: number; exchangeTimeoutMs?: number;
  /** 受信任进程边界；不可打印 URL，signal 必须交给子进程。 */
  openBrowser?: (url: string, signal: AbortSignal) => Promise<void>;
  fetch?: typeof fetch;
  /** 仅供受信任的隔离测试映射 socket；产品不应将其暴露为 host/port/redirect 配置。 */
  bindListener?: (server: Server, binding: { host: '127.0.0.1'; port: Port; signal: AbortSignal }) => Promise<void>;
}
type Callback = { code: string } | { denied: true };
interface Flow {
  abort: AbortController; transportAbort: AbortController; active: boolean; consumed: boolean; servers: Set<Server>; sockets: Set<Socket>;
  deadline: number; phaseDeadline?: number; transportClosed: boolean; releasing?: Promise<void>;
  removers: (() => void)[]; timer?: NodeJS.Timeout; response?: ServerResponse; body?: ReadableStream<Uint8Array>; reader?: ReadableStreamDefaultReader<Uint8Array>;
  callback: Promise<Callback>; accept(value: Callback): void;
}
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const MAX_RESPONSE_BYTES = 128 * 1024;
function duration(value: number | undefined, fallback: number, max: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > max) throw new RemoteOAuthError('configuration'); return result;
}
function identity(value: Readonly<ManagedAuthIdentity> | undefined): Readonly<ManagedAuthIdentity> {
  if (!value || typeof value.codexHome !== 'string' || !isAbsolute(value.codexHome) || value.codexHome.length > 4096 || /[\u0000-\u001f\u007f]/.test(value.codexHome)) throw new RemoteOAuthError('identity-changed');
  for (const key of ['accountId', 'accountUserId', 'userId'] as const) {
    const field = value[key]; if (key === 'userId' && field === undefined) continue;
    if (typeof field !== 'string' || !field.length || field.length > 1024 || /[\u0000-\u001f\u007f]/.test(field)) throw new RemoteOAuthError('identity-changed');
  }
  return Object.freeze({ codexHome: value.codexHome, accountId: value.accountId, accountUserId: value.accountUserId, ...(value.userId === undefined ? {} : { userId: value.userId }) });
}
function same(a: Readonly<ManagedAuthIdentity>, b: Readonly<ManagedAuthIdentity>): boolean {
  return a.codexHome === b.codexHome && a.accountId === b.accountId && a.accountUserId === b.accountUserId && a.userId === b.userId;
}
function discard(value: unknown): void {
  try { const body = (value as Response | undefined)?.body; if (body && !body.locked) void body.cancel().catch(() => undefined); } catch { /* 不采用外部响应的错误。 */ }
}
function closeServer(server: Server): void {
  try { server.close(); } catch { /* 未绑定或已经关闭。 */ }
}
function page(response: ServerResponse, status: number, success = false): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", 'X-Content-Type-Options': 'nosniff', Connection: 'close' });
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Remote 授权</title><p>${success ? '授权成功，请返回网关。' : '授权未完成，请返回网关重新发起。'}</p></html>`);
}
function bind(server: Server, binding: { host: '127.0.0.1'; port: Port; signal: AbortSignal }): Promise<void> {
  return new Promise((resolve, reject) => {
    const error = (value: Error) => { server.off('listening', listening); reject(value); };
    const listening = () => { server.off('error', error); resolve(); };
    server.once('error', error); server.once('listening', listening); server.listen({ host: binding.host, port: binding.port, exclusive: true });
  });
}
function openBrowser(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') { reject(new RemoteOAuthError('browser')); return; }
    execFile('/usr/bin/open', [url], { signal, timeout: 10000, maxBuffer: 1024, windowsHide: true }, error => { if (error) reject(new RemoteOAuthError('browser')); else resolve(); });
  });
}

/** 一次性 Remote step-up：无持久化、无 enroll，也不拥有传入 loader 的生命周期。 */
export class RemoteStepUpOAuth {
  private readonly timeout: number;
  private readonly browserTimeout: number;
  private readonly exchangeTimeout: number;
  private closed = false;
  private flow?: Flow;
  private flight?: Promise<string>;
  constructor(private readonly options: RemoteOAuthOptions) {
    this.timeout = duration(options.timeoutMs, 600000, 600000);
    this.browserTimeout = duration(options.browserTimeoutMs, 10000, 60000);
    this.exchangeTimeout = duration(options.exchangeTimeoutMs, 20000, 60000);
  }
  private cancel(flow: Flow, code: RemoteOAuthFailure): void {
    if (!flow.abort.signal.aborted) flow.abort.abort(new RemoteOAuthError(code));
    if (!flow.transportAbort.signal.aborted) flow.transportAbort.abort(new RemoteOAuthError(code));
  }
  private assert(flow: Flow): void {
    this.options.assertOwnership?.();
    // timer 只负责唤醒挂起操作；同步外部代码阻塞事件循环时，仍按绝对期限拒绝晚结果。
    if (flow.active && !flow.abort.signal.aborted && performance.now() >= Math.min(flow.deadline, flow.phaseDeadline ?? Infinity)) this.cancel(flow, 'timeout');
    if (!flow.active || flow.abort.signal.aborted) throw flow.abort.signal.reason instanceof RemoteOAuthError ? flow.abort.signal.reason : new RemoteOAuthError('closed');
  }
  /** 每个外部 await 都被全局取消/deadline截断，且外部异常只采用本地固定分类。 */
  private async wait<T>(flow: Flow, operation: () => Promise<T>, failure: RemoteOAuthFailure): Promise<T> {
    this.assert(flow); let abort!: () => void;
    try {
      const pending = Promise.resolve().then(() => { this.assert(flow); return operation(); });
      const result = await Promise.race([pending, new Promise<never>((_resolve, reject) => {
        abort = () => reject(flow.abort.signal.reason); flow.abort.signal.addEventListener('abort', abort, { once: true });
        if (flow.abort.signal.aborted) abort();
      })]);
      this.assert(flow); return result;
    } catch { this.assert(flow); throw new RemoteOAuthError(failure); }
    finally { if (abort) flow.abort.signal.removeEventListener('abort', abort); }
  }
  private join(flow: Flow, signal?: AbortSignal): void {
    if (!signal) return;
    const abort = () => this.cancel(flow, 'cancelled');
    signal.addEventListener('abort', abort, { once: true }); flow.removers.push(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  }
  private async proof(flow: Flow, expected: Readonly<ManagedAuthIdentity>): Promise<void> {
    const value = await this.wait(flow, () => this.options.managedAuth.verifyIdentity(expected), 'identity-changed');
    try {
      if (!same(expected, identity(value)) || !same(expected, identity(this.options.managedAuth.currentIdentity))) throw new RemoteOAuthError('identity-changed');
    } catch { this.assert(flow); throw new RemoteOAuthError('identity-changed'); }
    this.assert(flow);
  }
  private stepUp(flow: Flow, token: string, auth: ManagedAuth): void {
    this.assert(flow);
    try {
      const now = (this.options.now ?? Date.now)(); if (!Number.isSafeInteger(now) || now < 0) throw new Error();
      validateStepUp(token, auth, now);
    } catch { this.assert(flow); throw new RemoteOAuthError('response-invalid'); }
    this.assert(flow);
  }
  private callback(flow: Flow, port: Port, state: string, request: IncomingMessage, response: ServerResponse): void {
    response.on('error', () => undefined);
    try {
      this.assert(flow);
      if (flow.transportClosed) throw new Error();
      const raw = request.url ?? ''; const headers = request.rawHeaders;
      if (request.method !== 'GET' || raw.length > 8192 || raw.includes('#') || raw.split('?')[0] !== '/auth/callback' || headers.length > 64 || headers.reduce((sum, part) => sum + Buffer.byteLength(part), 0) > 8192) throw new Error();
      if (headers.filter((_value, index) => index % 2 === 0 && headers[index]!.toLowerCase() === 'host').length !== 1 || request.headers.host !== `localhost:${port}` || request.headers['transfer-encoding'] !== undefined || (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')) throw new Error();
      const query = raw.slice('/auth/callback?'.length); if (!raw.startsWith('/auth/callback?') || !query || query.length > 8192) throw new Error();
      // URLSearchParams 会替换无效 UTF-8；先严格解码，避免接受被替换的 code/state。
      decodeURIComponent(query.replaceAll('+', ' '));
      const params = new URLSearchParams(query); const entries = [...params];
      if (entries.length > 16 || new Set(entries.map(([key]) => key)).size !== entries.length || entries.some(([key, value]) => key.length > 64 || value.length > 4096)) throw new Error();
      const received = params.get('state');
      if (!received || !/^[A-Za-z0-9_-]+$/.test(received)) throw new Error();
      const actual = Buffer.from(received, 'utf8'); const expected = Buffer.from(state, 'utf8');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
      if (params.has('code') === params.has('error')) throw new Error();
      const code = params.get('code');
      if (params.has('code') && (!code || !/^[\x21-\x7e]{1,4096}$/.test(code) || params.has('error_description'))) throw new Error();
      if (params.has('error') && !/^[\x21-\x7e]{1,256}$/.test(params.get('error') ?? '')) throw new Error();
      if (flow.consumed) { page(response, 409); return; }
      flow.consumed = true; flow.response = response;
      flow.accept(code ? { code } : { denied: true });
    } catch { page(response, 400); }
  }
  private async listener(flow: Flow, state: string): Promise<Port> {
    for (const port of [1455, 1457] as const) {
      this.assert(flow);
      const server = createServer({ maxHeaderSize: 8192 }, (request, response) => this.callback(flow, port, state, request, response));
      flow.servers.add(server); server.maxConnections = 4; server.maxHeadersCount = 32; server.maxRequestsPerSocket = 1;
      server.headersTimeout = 10000; server.requestTimeout = 10000; server.keepAliveTimeout = 1;
      server.on('error', () => undefined);
      server.on('listening', () => { if (!flow.active || flow.transportClosed || flow.abort.signal.aborted) closeServer(server); });
      server.on('connection', socket => {
        if (!flow.active || flow.transportClosed || flow.abort.signal.aborted || flow.sockets.size >= 4) { socket.destroy(); return; }
        flow.sockets.add(socket); socket.on('error', () => undefined); socket.once('close', () => flow.sockets.delete(socket)); socket.setTimeout(Math.min(this.timeout, 10000), () => socket.destroy());
      });
      server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Length: 0\r\n\r\n'); });
      let occupied = false;
      const pending = Promise.resolve().then(() => {
        this.assert(flow);
        return (this.options.bindListener ?? bind)(server, { host: '127.0.0.1', port, signal: flow.transportAbort.signal });
      }).catch(error => { occupied = !!error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EADDRINUSE'; throw new RemoteOAuthError('network'); });
      void pending.then(() => { if (!flow.active || flow.transportClosed || flow.abort.signal.aborted) closeServer(server); }, () => undefined);
      try { await this.wait(flow, () => pending, 'network'); return port; }
      catch (error) { closeServer(server); this.assert(flow); if (!occupied) throw error; }
    }
    throw new RemoteOAuthError('ports-unavailable');
  }
  private async exchange(flow: Flow, code: string, verifier: string, redirect: string, auth: ManagedAuth, expected: Readonly<ManagedAuthIdentity>): Promise<string> {
    flow.phaseDeadline = performance.now() + this.exchangeTimeout;
    const timer = setTimeout(() => this.cancel(flow, 'timeout'), this.exchangeTimeout);
    try {
      const pending = Promise.resolve().then(() => {
        this.assert(flow);
        return (this.options.fetch ?? globalThis.fetch)('https://auth.openai.com/oauth/token', { method: 'POST', redirect: 'error', signal: flow.transportAbort.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: CLIENT_ID, code_verifier: verifier }).toString() });
      });
      void pending.then(value => { try { this.assert(flow); } catch { discard(value); } }, () => undefined);
      const response = await this.wait(flow, () => pending, 'network');
      let status: number;
      try { flow.body = response.body ?? undefined; status = response.status; if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error(); }
      catch { throw new RemoteOAuthError('response-invalid'); }
      await this.proof(flow, expected);
      if (status === 401 || status === 403) throw new RemoteOAuthError('denied');
      if (status < 200 || status >= 300) throw new RemoteOAuthError('http-rejected');
      try { if (!flow.body) throw new Error(); flow.reader = flow.body.getReader(); }
      catch { throw new RemoteOAuthError('response-invalid'); }
      const chunks: Uint8Array[] = []; let bytes = 0;
      for (;;) {
        const chunk = await this.wait(flow, () => flow.reader!.read(), 'network');
        if (!chunk || typeof chunk.done !== 'boolean') throw new RemoteOAuthError('response-invalid');
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array) || (bytes += chunk.value.byteLength) > MAX_RESPONSE_BYTES) throw new RemoteOAuthError('response-invalid');
        chunks.push(chunk.value);
      }
      await this.proof(flow, expected);
      try {
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        const token = (value as { access_token?: unknown }).access_token;
        if (typeof token !== 'string' || token.length > 65536) throw new Error();
        this.stepUp(flow, token, auth); return token;
      } catch { this.assert(flow); throw new RemoteOAuthError('response-invalid'); }
    } finally { clearTimeout(timer); flow.phaseDeadline = undefined; }
  }
  /** 先收回自有传输并 flush；总期限与调用方取消一直保留到后续最后身份复核结束。 */
  private release(flow: Flow, success: boolean): Promise<void> {
    if (flow.releasing) return flow.releasing;
    flow.transportClosed = true;
    flow.releasing = (async () => {
      if (!flow.transportAbort.signal.aborted) flow.transportAbort.abort(new RemoteOAuthError('closed'));
      try {
        if (flow.reader) {
          try { void flow.reader.cancel().catch(() => undefined); }
          finally { flow.reader.releaseLock(); }
        } else if (flow.body) discard({ body: flow.body });
      } catch { /* reader 自身也可能失败或永不完成；清理不能等待它。 */ }
      for (const server of flow.servers) closeServer(server);
      const response = flow.response;
      for (const socket of flow.sockets) if (socket !== response?.socket) socket.destroy();
      try {
        if (response && !response.destroyed && !response.writableEnded) {
          let timer: NodeJS.Timeout | undefined;
          try { await Promise.race([new Promise<void>(resolve => { response.once('finish', resolve); response.once('close', resolve); page(response, success ? 200 : 400, success); }), new Promise<void>(resolve => { timer = setTimeout(resolve, 50); })]); }
          finally { clearTimeout(timer); }
        }
      } finally { for (const socket of flow.sockets) socket.destroy(); }
    })();
    return flow.releasing;
  }
  /** 最后身份复核之后仅执行同步、内部终结，不再 await 或触发受信任传输回调。 */
  private finish(flow: Flow): void {
    flow.active = false; clearTimeout(flow.timer);
    if (!flow.abort.signal.aborted) flow.abort.abort(new RemoteOAuthError('closed'));
    for (const remove of flow.removers.splice(0)) remove();
    if (this.flow === flow) { this.flow = undefined; this.flight = undefined; }
  }
  private async run(flow: Flow): Promise<string> {
    try {
      const raw = await this.wait(flow, () => this.options.managedAuth.load(), 'auth-required');
      let auth: ManagedAuth; let expected: Readonly<ManagedAuthIdentity>;
      try {
        auth = validateManagedAuth(raw);
        expected = identity(await this.wait(flow, () => this.options.managedAuth.verifyIdentity(), 'auth-required'));
        if (auth.accountId !== expected.accountId || auth.accountUserId !== expected.accountUserId || auth.userId !== expected.userId || !same(expected, identity(this.options.managedAuth.currentIdentity))) throw new Error();
      } catch { this.assert(flow); throw new RemoteOAuthError('auth-required'); }
      const state = randomBytes(32).toString('base64url'); const verifier = randomBytes(32).toString('base64url');
      const port = await this.listener(flow, state); await this.proof(flow, expected);
      const redirect = `http://localhost:${port}/auth/callback`;
      const url = new URL('https://auth.openai.com/oauth/authorize');
      url.search = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirect, scope: 'codex.remote_control.enroll', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state, originator: 'Codex Mobile Gateway', reauth: 'remote_control', max_age: '0', codex_cli_simplified_flow: 'true', allowed_workspace_id: expected.accountId, current_workspace_id: expected.accountId }).toString();
      flow.phaseDeadline = performance.now() + this.browserTimeout;
      const timer = setTimeout(() => this.cancel(flow, 'timeout'), this.browserTimeout);
      try { await this.wait(flow, () => (this.options.openBrowser ?? openBrowser)(url.toString(), flow.transportAbort.signal), 'browser'); }
      finally { clearTimeout(timer); flow.phaseDeadline = undefined; }
      await this.proof(flow, expected);
      const callback = await this.wait(flow, () => flow.callback, 'network'); await this.proof(flow, expected);
      if ('denied' in callback) throw new RemoteOAuthError('denied');
      const token = await this.exchange(flow, callback.code, verifier, redirect, auth, expected);
      this.assert(flow);
      await this.release(flow, true);
      await this.proof(flow, expected);
      this.stepUp(flow, token, auth); return token;
    } catch (error) {
      try { await this.release(flow, false); } catch { /* 传输清理的 finally 仍会销毁自有 socket。 */ }
      throw error instanceof RemoteOAuthError ? new RemoteOAuthError(error.code) : new RemoteOAuthError('network');
    } finally { this.finish(flow); }
  }
  /** 同实例 singleflight；任一加入调用者取消即取消共享流。失败后仅下一次显式调用重试。 */
  authorize(signal?: AbortSignal): Promise<string> {
    if (this.closed) return Promise.reject(new RemoteOAuthError('closed'));
    if (this.flight && this.flow) { this.join(this.flow, signal); return this.flight; }
    if (signal?.aborted) return Promise.reject(new RemoteOAuthError('cancelled'));
    let accept!: (value: Callback) => void;
    const flow: Flow = { abort: new AbortController(), transportAbort: new AbortController(), active: true, consumed: false, servers: new Set(), sockets: new Set(), removers: [], deadline: performance.now() + this.timeout, transportClosed: false, callback: new Promise(resolve => { accept = resolve; }), accept: value => accept(value) };
    this.flow = flow; this.join(flow, signal); flow.timer = setTimeout(() => this.cancel(flow, 'timeout'), this.timeout);
    const flight = this.run(flow);
    this.flight = flight; return flight;
  }
  /** 永久关闭；不关闭调用方持有的 managedAuth，也不触碰其他 listener/进程。 */
  close(): void { this.closed = true; if (this.flow) this.cancel(this.flow, 'closed'); }
}
