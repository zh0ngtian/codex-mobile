// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { RemoteSendError, RemoteStream } from '../../server/remote/relay.js';
import type { RpcMessage } from '../../server/remote/envelope.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0; });
async function until(check: () => boolean, timeout = 1500): Promise<void> {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error('等待条件超时'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function upstream() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => wss.once('listening', resolve));
  const frames: RpcMessage[] = []; const sockets: WebSocket[] = [];
  wss.on('connection', socket => { sockets.push(socket); socket.on('error', () => {}); socket.on('message', raw => frames.push(JSON.parse(raw.toString()))); });
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of wss.clients) socket.terminate(); wss.close(() => resolve()); }));
  return { wss, frames, sockets, url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}` };
}
function send(socket: WebSocket, message: unknown) { socket.send(JSON.stringify(message)); }
async function canonical(options: Record<string, number> = {}) {
  const server = await upstream();
  const session = await RemoteRpcSession.connectCanonical(server.url, options); cleanup.push(() => session.close());
  return { session, server };
}
async function initialized(options: Record<string, number> = {}) {
  const f = await canonical(options); const pending = f.session.initialize();
  await until(() => f.server.frames.length === 1);
  send(f.server.sockets[0]!, { id: f.server.frames[0]!.id, result: { codexHome: '/canonical', userAgent: 'actual metadata', extension: 3 } });
  await pending; await until(() => f.server.frames.length === 2); return f;
}
function remote(transmit?: ConstructorParameters<typeof RemoteStream>[2]) {
  const frames: RpcMessage[] = []; let released = 0;
  const stream = new RemoteStream('env', 'stream', transmit ?? (async (_stream, message) => { if (message) frames.push(message); return { seqId: frames.length }; }), () => { released++; });
  cleanup.push(async () => { try { await stream.close(); } catch { /* fake transport 可同步失败。 */ } });
  return { stream, frames, released: () => released };
}

it('真实 canonical WS 仅初始化一次，initialized 写入后就绪并暴露真实 metadata', async () => {
  const { session, server } = await canonical();
  const one = session.initialize(); const two = session.initialize();
  await until(() => server.frames.length === 1);
  expect(session.ready).toBe(false); expect(server.frames[0]).toMatchObject({ method: 'initialize', params: { clientInfo: { name: 'codex-mobile-remote-manager' } } });
  const metadata = { codexHome: '/canonical', userAgent: 'actual metadata', extra: { enabled: true } };
  send(server.sockets[0]!, { id: server.frames[0]!.id, result: metadata });
  expect(await one).toEqual(metadata); expect(await two).toEqual(metadata);
  await until(() => server.frames.length === 2);
  expect(server.frames[1]).toEqual({ method: 'initialized', params: {} }); expect(session.ready).toBe(true); expect(session.metadata).toEqual(metadata);
  await session.initialize(); expect(server.frames).toHaveLength(2);
});

it('只匹配自己的响应 id，带 method 的上游 request 和通知转发且重复/晚响应不污染下一请求', async () => {
  const { session, server } = await initialized(); const events: unknown[] = []; const requests: unknown[] = [];
  session.on('notification', message => events.push(message)); session.on('request', message => requests.push(message));
  const pending = session.call('account/read', { refreshToken: true }); await until(() => server.frames.length === 3);
  const id = server.frames[2]!.id; let resolved = false; void pending.then(() => { resolved = true; });
  send(server.sockets[0]!, { id: 'other', result: 'unrelated' }); send(server.sockets[0]!, { id, method: 'approval', params: {} });
  send(server.sockets[0]!, { method: 'changed', params: { value: 1 } });
  await until(() => events.length === 1 && requests.length === 1); expect(resolved).toBe(false);
  send(server.sockets[0]!, { id, result: { actual: true } }); expect(await pending).toEqual({ actual: true });
  send(server.sockets[0]!, { id, result: 'duplicate' }); const next = session.call('status'); await until(() => server.frames.length === 4);
  expect(server.frames[3]!.id).not.toBe(id); send(server.sockets[0]!, { id: server.frames[3]!.id, result: 'next' }); expect(await next).toBe('next');
});

it('断线与响应超时对已提交调用明确 uncertain，close 清理所有等待且不泄露错误 payload', async () => {
  const { session, server } = await initialized({ responseTimeoutMs: 25 });
  const timeout = session.call('write').catch(error => error); await until(() => server.frames.length === 3);
  expect(await timeout).toMatchObject({ mayHaveBeenSent: true, code: 'timeout' });
  send(server.sockets[0]!, { id: server.frames[2]!.id, result: 'late' });
  const response = session.call('fail').catch(error => error); await until(() => server.frames.length === 4);
  send(server.sockets[0]!, { id: server.frames[3]!.id, error: { code: 1, message: 'Bearer secret https://private.invalid' } });
  const error = await response; expect(error).toMatchObject({ message: expect.not.stringContaining('secret'), code: 'response', mayHaveBeenSent: true });
  const dropped = session.call('write-again').catch(error => error); await until(() => server.frames.length === 5); server.sockets[0]!.terminate();
  expect(await dropped).toMatchObject({ mayHaveBeenSent: true }); expect(session.closed).toBe(true);
  await expect(session.call('offline')).rejects.toMatchObject({ mayHaveBeenSent: false });
});

it('请求、入站和pending预算均有界且拒绝请求不写入上游', async () => {
  const { session, server } = await initialized({ maxPending: 1, maxRequestBytes: 256, maxInboundBytes: 256 });
  const first = session.call('one').catch(error => error); await until(() => server.frames.length === 3);
  await expect(session.call('two')).rejects.toMatchObject({ mayHaveBeenSent: false, code: 'capacity' });
  await expect(session.notify('notification')).rejects.toMatchObject({ mayHaveBeenSent: false, code: 'capacity' });
  expect(server.frames).toHaveLength(3); send(server.sockets[0]!, { id: server.frames[2]!.id, result: true }); expect(await first).toBe(true);
  await expect(session.call('large', { text: 'x'.repeat(500) })).rejects.toMatchObject({ mayHaveBeenSent: false }); expect(server.frames).toHaveLength(3);
  const oversized = session.call('read').catch(error => error); await until(() => server.frames.length === 4);
  send(server.sockets[0]!, { id: server.frames[3]!.id, result: 'x'.repeat(500) });
  expect(await oversized).toMatchObject({ mayHaveBeenSent: true }); expect(session.closed).toBe(true);
});

it('initialize 超时不重放；缺少 metadata 对象、非法 JSON 与非显式 ws URL 均拒绝', async () => {
  for (const url of ['', 'http://127.0.0.1', 'ws://user:secret@127.0.0.1']) {
    await expect(RemoteRpcSession.connectCanonical(url)).rejects.toThrow('Remote');
  }
  const f = await canonical({ initializeTimeoutMs: 20 });
  const pending = f.session.initialize().catch(error => error); await until(() => f.server.frames.length === 1);
  expect(await pending).toMatchObject({ code: 'timeout', mayHaveBeenSent: true }); expect(f.session.closed).toBe(true);
  await expect(f.session.initialize()).rejects.toMatchObject({ mayHaveBeenSent: false }); expect(f.server.frames).toHaveLength(1);
  const g = await canonical(); const invalid = g.session.initialize().catch(error => error); await until(() => g.server.frames.length === 1);
  send(g.server.sockets[0]!, { id: g.server.frames[0]!.id, result: null }); expect(await invalid).toMatchObject({ code: 'protocol' });
  const h = await initialized(); const read = h.session.call('read').catch(error => error); h.server.sockets[0]!.send('not-json');
  expect(await read).toMatchObject({ mayHaveBeenSent: true }); expect(h.session.closed).toBe(true);
});

it('RemoteStream 断线保留历史能力但从不重放initialize，unknown pong使管理session失效并移除监听', async () => {
  const f = remote();
  const session = RemoteRpcSession.fromRemoteStream(f.stream); cleanup.push(() => session.close());
  const init = session.initialize(); await until(() => f.frames.length === 1);
  f.stream.emit('message', { id: f.frames[0]!.id, result: { codexHome: '/remote' } }, { seqId: 1 }); await init;
  const waiting = session.call('write').catch(error => error); await until(() => f.frames.length === 3);
  f.stream.emit('disconnect', { reason: 'network', mayHaveBeenSent: true }); expect(await waiting).toMatchObject({ mayHaveBeenSent: true });
  expect(session.closed).toBe(false); const events: unknown[] = []; session.on('notification', value => events.push(value));
  f.stream.emit('message', { method: 'history' }, { seqId: 2 }); expect(events).toHaveLength(1); expect(f.frames.filter(frame => frame.method === 'initialize')).toHaveLength(1);
  const pending = session.call('read').catch(error => error); await until(() => f.frames.length === 4);
  f.stream.emit('pong', { type: 'pong', client_id: 'client', stream_id: 'stream', env_id: 'env', seq_id: 0, status: 'unknown' });
  expect(await pending).toMatchObject({ mayHaveBeenSent: true }); expect(session.closed).toBe(true); expect(f.stream.closed).toBe(true);
  for (const name of ['message', 'disconnect', 'pong', 'sendError', 'close']) expect(f.stream.listenerCount(name)).toBe(0);
});

it.each([false, true])('RemoteSendError(%s)保留明确发送边界且同步throw/异步reject都脱敏', async mayHaveBeenSent => {
  let fail = false; let synchronous = false; const frames: RpcMessage[] = [];
  const f = remote((_stream, message) => {
    if (fail) { const error = new RemoteSendError('secret Bearer private-url', mayHaveBeenSent); if (synchronous) throw error; return Promise.reject(error); }
    if (message) frames.push(message); return Promise.resolve({ seqId: frames.length });
  });
  const session = RemoteRpcSession.fromRemoteStream(f.stream); cleanup.push(() => session.close());
  const init = session.initialize(); await until(() => frames.length === 1); f.stream.emit('message', { id: frames[0]!.id, result: {} }, { seqId: 1 }); await init;
  fail = true;
  for (const sync of [false, true]) { synchronous = sync; const error = await session.call('write').catch(error => error); expect(error).toMatchObject({ mayHaveBeenSent, message: expect.not.stringContaining('secret') }); }
});


it('canonical仅接受显式loopback，远端URL/query错误完全脱敏', async () => {
  for (const url of ['ws://remote.invalid/rpc?token=synthetic-secret', 'wss://127.0.0.1.evil.invalid/rpc', 'ws://0.0.0.0/rpc']) {
    const error = await RemoteRpcSession.connectCanonical(url, { connectTimeoutMs: 20 }).catch(error => error);
    expect(error).toMatchObject({ code: 'protocol', mayHaveBeenSent: false });
    expect(error.message).not.toContain('synthetic-secret'); expect(error.message).not.toContain('remote.invalid');
  }
});

it('一个Remote逻辑流只能有一个管理session，已关闭流不能重新包装初始化', async () => {
  const f = remote();
  const session = RemoteRpcSession.fromRemoteStream(f.stream); cleanup.push(() => session.close());
  expect(() => RemoteRpcSession.fromRemoteStream(f.stream)).toThrow();
  session.close(); expect(() => RemoteRpcSession.fromRemoteStream(f.stream)).toThrow();
});

it('initialized发送挂起仍受整个初始化期限限制；close异常不留下监听器或pending', async () => {
  const frames: RpcMessage[] = [];
  const f = remote(async (_stream, message) => { if (message) frames.push(message); if (message?.method === 'initialized') return new Promise(() => {}); return { seqId: frames.length }; });
  const session = RemoteRpcSession.fromRemoteStream(f.stream, { initializeTimeoutMs: 20 }); cleanup.push(() => session.close());
  const pending = session.initialize().catch(error => error); await until(() => frames.length === 1);
  f.stream.emit('message', { id: frames[0]!.id, result: {} }, { seqId: 1 });
  expect(await pending).toMatchObject({ code: 'timeout', mayHaveBeenSent: true }); expect(session.ready).toBe(false); expect(session.closed).toBe(true);
  const g = remote(async () => { throw new Error('secret-close'); }); const other = RemoteRpcSession.fromRemoteStream(g.stream);
  other.on('close', () => { throw new Error('observer-secret'); }); expect(() => other.close()).not.toThrow();
  for (const name of ['message', 'disconnect', 'pong', 'sendError', 'close']) expect(g.stream.listenerCount(name)).toBe(0);
});


it('canonical握手超时有界且无请求被发送，close立即移除调用等待', async () => {
  const { createServer } = await import('node:http');
  const http = createServer(); const sockets: import('node:stream').Duplex[] = [];
  http.on('upgrade', (_request, socket) => { sockets.push(socket); });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of sockets) socket.destroy(); http.close(() => resolve()); }));
  const error = await RemoteRpcSession.connectCanonical(`ws://127.0.0.1:${(http.address() as { port: number }).port}`, { connectTimeoutMs: 20 }).catch(error => error);
  expect(error).toMatchObject({ code: 'timeout', mayHaveBeenSent: false });
  const f = await initialized(); const pending = f.session.call('write').catch(error => error); await until(() => f.server.frames.length === 3);
  f.session.close(); expect(await pending).toMatchObject({ code: 'closed', mayHaveBeenSent: true });
});


it('Remote终止鉴权断线仍先通知调用方再清理session事件监听', async () => {
  const f = remote(); const session = RemoteRpcSession.fromRemoteStream(f.stream); cleanup.push(() => session.close());
  const init = session.initialize(); await until(() => f.frames.length === 1);
  f.stream.emit('message', { id: f.frames[0]!.id, result: {} }, { seqId: 1 }); await init;
  const disconnects: unknown[] = []; session.on('disconnect', event => disconnects.push(event));
  f.stream.emit('disconnect', { reason: 'auth-required', mayHaveBeenSent: true });
  expect(disconnects).toEqual([{ reason: 'auth-required', mayHaveBeenSent: true }]); expect(session.closed).toBe(true);
});
