// @vitest-environment node
import { getEventListeners } from 'node:events';
import { performance as nodePerformance } from 'node:perf_hooks';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { RemoteSendError, RemoteStream } from '../../server/remote/relay.js';
import { encodeClientMessage, type JsonValue, type RpcMessage } from '../../server/remote/envelope.js';
import { RemoteRpcError, RemoteRpcSession } from '../../server/remote/rpc-session.js';

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

it.each(['canonical', 'RemoteStream'].flatMap(transport => ['入口', '序列化', '登记pending后'].map(phase => ({ transport, phase }))))('可信绝对期限在$transport的$phase耗尽时零发送，清理等待并保留共享session', async ({ transport, phase }) => {
  let session: RemoteRpcSession; let messages: RpcMessage[];
  if (transport === 'canonical') {
    const f = await initialized({ maxPending: 1 }); session = f.session; messages = f.server.frames;
    f.server.sockets[0]!.on('message', raw => { const message = JSON.parse(raw.toString()) as RpcMessage; if (message.id) send(f.server.sockets[0]!, { id: message.id, result: true }); });
  } else {
    const f = remote(async (stream, message) => { if (message) { f.frames.push(message); if (message.id) queueMicrotask(() => stream.emit('message', { id: message.id, result: message.method === 'initialize' ? {} : true }, { seqId: f.frames.length })); } return { seqId: f.frames.length }; });
    session = RemoteRpcSession.fromRemoteStream(f.stream, { maxPending: 1 }); cleanup.push(() => session.close()); messages = f.frames; await session.initialize();
  }
  let now = 600007; let jumped = false; const before = messages.length; const clock = vi.spyOn(nodePerformance, 'now').mockImplementation(() => {
    if (phase === '入口' && !jumped && new Error().stack?.includes('RemoteRpcSession.submit')) { now = 600017; jumped = true; } return now;
  });
  const rpcTimers: ReturnType<typeof setTimeout>[] = []; const cleared = vi.spyOn(globalThis, 'clearTimeout');
  const setTimeoutActual = setTimeout; const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((...args: Parameters<typeof setTimeout>) => {
    const result = setTimeoutActual(...args); if (new Error().stack?.includes('rpc-session.ts')) {
      rpcTimers.push(result); if (phase === '登记pending后' && !jumped) { now = 600017; jumped = true; }
    } return result;
  });
  try {
    const params = phase === '序列化' ? { toJSON() { now = 600017; jumped = true; return {}; } } as unknown as JsonValue : {};
    const options = { timeoutMs: 100, deadline: 600017 }; const failure = await session.call('deadline-barrier', params, options).catch(error => error);
    expect(failure).toBeInstanceOf(RemoteRpcError); expect(failure).toMatchObject({ code: 'timeout', mayHaveBeenSent: false }); expect(jumped).toBe(true);
    expect(messages.slice(before).filter(message => message.method === 'deadline-barrier')).toHaveLength(0);
    const state = session as unknown as { pending: Set<unknown>; responses: Map<unknown, unknown>; writes: Map<unknown, unknown>; writingBytes: number };
    expect([state.pending.size, state.responses.size, state.writes.size, state.writingBytes]).toEqual([0, 0, 0, 0]);
    expect(rpcTimers).toHaveLength(phase === '登记pending后' ? 1 : 0); for (const rpcTimer of rpcTimers) expect(cleared).toHaveBeenCalledWith(rpcTimer);
    timer.mockRestore(); cleared.mockRestore(); clock.mockRestore(); const next = session.call('after-barrier'); expect(await next).toBe(true); expect(session.ready).toBe(true);
  } finally { timer.mockRestore(); cleared.mockRestore(); clock.mockRestore(); }
});

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


it.each(['getter', 'toJSON'] as const)('RemoteStream发送已验证的JSON快照，%s二次求值不能改变内容或绕过字节预算', async source => {
  const messages: RpcMessage[] = [];
  const f = remote(async (stream, message) => {
    if (message) {
      const frames = encodeClientMessage({ clientId: 'client', streamId: stream.streamId, environmentId: stream.environmentId, seqId: messages.length + 1 }, message);
      messages.push(JSON.parse(frames[0]!).message);
    }
    return { seqId: messages.length };
  });
  const session = RemoteRpcSession.fromRemoteStream(f.stream, { maxRequestBytes: 256 }); cleanup.push(() => session.close());
  const init = session.initialize(); await until(() => messages.length === 1);
  f.stream.emit('message', { id: messages[0]!.id, result: {} }, { seqId: 1 }); await init;
  let evaluations = 0;
  const params = source === 'getter' ? { get text() { evaluations++; Object.defineProperty(this, 'text', { enumerable: true, configurable: true, value: 'x'.repeat(2048) }); return 'small'; } }
    : { toJSON() { evaluations++; return { text: evaluations === 1 ? 'small' : 'x'.repeat(2048) }; } };
  await session.notify('test', params as unknown as JsonValue);
  const actual = messages.at(-1)!;
  expect(Buffer.byteLength(JSON.stringify(actual))).toBeLessThanOrEqual(256);
  expect(actual.params).toEqual({ text: 'small' }); expect(evaluations).toBe(1);
});

it('真实canonical暂停读取时未完成写入的超时关闭连接，串行调用不能累积无界socket缓冲', async () => {
  const budget = 1024 * 1024;
  const { session, server } = await initialized({ maxPending: 1, maxRequestBytes: budget, responseTimeoutMs: 20 });
  const socket = (session as unknown as { transport: WebSocket }).transport;
  server.sockets[0]!.pause();
  const failures: unknown[] = []; let peakBuffered = 0;
  for (let index = 0; index < 24 && !session.closed; index++) {
    failures.push(await session.call('synthetic/write', { payload: 'x'.repeat(900000) }).catch(error => error));
    peakBuffered = Math.max(peakBuffered, socket.bufferedAmount);
  }
  expect(failures.length).toBeGreaterThan(0);
  for (const failure of failures) expect(failure).toMatchObject({ code: 'timeout', mayHaveBeenSent: true });
  expect(peakBuffered).toBeLessThanOrEqual(budget); expect(session.closed).toBe(true);
  await expect(session.call('no-replay')).rejects.toMatchObject({ code: 'closed', mayHaveBeenSent: false });
  await until(() => socket.readyState === socket.CLOSED);
  expect(socket.bufferedAmount).toBe(0);
  for (const event of ['message', 'error', 'close']) expect(socket.listenerCount(event)).toBe(0);
});

it('响应先到不会释放未完成写入的额度或期限，晚写回调不能恢复已关闭的canonical', async () => {
  const { session, server } = await initialized({ maxPending: 1, responseTimeoutMs: 80 });
  const socket = (session as unknown as { transport: WebSocket }).transport;
  const actualSend = socket.send.bind(socket); const completions: (() => void)[] = [];
  // 保留真实WS发送与响应，只延迟本地写回调，确定性覆盖响应早于回调的边界。
  socket.send = (data, optionsOrCallback?, callback?) => {
    const complete = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    actualSend(data, error => completions.push(() => { if (typeof complete === 'function') complete(error); }));
  };
  const first = session.call('early-response'); await until(() => server.frames.length === 3 && completions.length === 1);
  send(server.sockets[0]!, { id: server.frames[2]!.id, result: true }); expect(await first).toBe(true);
  await expect(session.call('over-write-capacity')).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  expect(server.frames).toHaveLength(3);
  await until(() => session.closed);
  for (const complete of completions) complete();
  expect(session.closed).toBe(true); expect(session.ready).toBe(false);
  await expect(session.notify('late')).rejects.toMatchObject({ code: 'closed', mayHaveBeenSent: false });
});

it('canonical逐帧预算包括WS头，写回调完成后才释放字节额度供下次调用使用', async () => {
  const { session, server } = await initialized({ maxPending: 2, maxRequestBytes: 256, responseTimeoutMs: 100 });
  const socket = (session as unknown as { transport: WebSocket }).transport;
  const actualSend = socket.send.bind(socket); const completions: (() => void)[] = [];
  socket.send = (data, optionsOrCallback?, callback?) => {
    const complete = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    actualSend(data, error => completions.push(() => { if (typeof complete === 'function') complete(error); }));
  };
  const length = Buffer.byteLength(JSON.stringify({ id: server.frames[0]!.id, method: 'bounded', params: { payload: '' } }));
  const params = { payload: 'x'.repeat(256 - length) };
  const first = session.call('bounded', params); await until(() => server.frames.length === 3 && completions.length === 1);
  expect(Buffer.byteLength(JSON.stringify(server.frames[2]))).toBe(256);
  send(server.sockets[0]!, { id: server.frames[2]!.id, result: true }); expect(await first).toBe(true);
  // 尚未完成的写入只有一个，小于maxPending；两帧及其WS头会超过512字节。
  await expect(session.call('bounded', params)).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  expect(server.frames).toHaveLength(3);
  completions[0]!(); socket.send = actualSend;
  const next = session.call('bounded', params); await until(() => server.frames.length === 4);
  send(server.sockets[0]!, { id: server.frames[3]!.id, result: 'next' }); expect(await next).toBe('next');
  await new Promise(resolve => setTimeout(resolve, 110)); expect(session.ready).toBe(true);
});

it('显式close拒绝所有未完成写入的调用和通知，晚回调与旧期限不重复关闭', async () => {
  const { session, server } = await initialized({ maxPending: 2, responseTimeoutMs: 80 });
  const socket = (session as unknown as { transport: WebSocket }).transport;
  const actualSend = socket.send.bind(socket); const completions: (() => void)[] = [];
  socket.send = (data, optionsOrCallback?, callback?) => {
    const complete = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    actualSend(data, error => completions.push(() => { if (typeof complete === 'function') complete(error); }));
  };
  const call = session.call('write').catch(error => error); const notification = session.notify('notice').catch(error => error);
  await until(() => server.frames.length === 4 && completions.length === 2);
  let closed = 0; session.on('close', () => { closed++; }); session.close();
  for (const failure of await Promise.all([call, notification])) expect(failure).toMatchObject({ code: 'closed', mayHaveBeenSent: true });
  for (const complete of completions) complete();
  await new Promise(resolve => setTimeout(resolve, 90)); expect(closed).toBe(1);
  expect(session.closed).toBe(true); expect(server.frames).toHaveLength(4);
  await until(() => socket.readyState === socket.CLOSED);
  for (const event of ['message', 'error', 'close']) expect(socket.listenerCount(event)).toBe(0);
});

it('可信每调用预算可长于默认响应超时且不改变后续默认值', async () => {
  const { session, server } = await initialized({ responseTimeoutMs: 20 });
  const pending = session.call('longer', {}, { timeoutMs: 150 }).catch(error => error);
  await until(() => server.frames.length === 3);
  await new Promise(resolve => setTimeout(resolve, 40));
  send(server.sockets[0]!, { id: server.frames[2]!.id, result: true });
  expect(await pending).toBe(true);
  await expect(session.call('default')).rejects.toMatchObject({ code: 'timeout', mayHaveBeenSent: true });
});

it('每调用取消只撤销自己的等待，不关闭共享会话且不重放', async () => {
  const { session, server } = await initialized({ responseTimeoutMs: 100 });
  const controller = new AbortController();
  const pending = session.call('write', {}, { signal: controller.signal }).catch(error => error);
  await until(() => server.frames.length === 3); controller.abort();
  expect(await pending).toMatchObject({ code: 'cancelled', mayHaveBeenSent: true });
  expect(session.ready).toBe(true);
  send(server.sockets[0]!, { id: server.frames[2]!.id, result: 'late' });
  const stopped = new AbortController(); stopped.abort();
  await expect(session.call('never', {}, { signal: stopped.signal })).rejects.toMatchObject({ code: 'cancelled', mayHaveBeenSent: false });
  expect(server.frames.filter(frame => frame.method === 'write')).toHaveLength(1);
  expect(server.frames.filter(frame => frame.method === 'never')).toHaveLength(0);
});

it('每调用实际绝对期限覆盖同步传输阻塞和晚响应，notify保留兼容', async () => {
  const frames: RpcMessage[] = [];
  const f = remote(async (stream, message) => {
    if (message) frames.push(message);
    if (message?.method === 'blocked') {
      const end = performance.now() + 40; while (performance.now() < end) { /* 模拟同步阻塞。 */ }
      stream.emit('message', { id: message.id, result: true }, { seqId: 2 });
    }
    return { seqId: frames.length };
  });
  const session = RemoteRpcSession.fromRemoteStream(f.stream); cleanup.push(() => session.close());
  const init = session.initialize(); await until(() => frames.length === 1);
  f.stream.emit('message', { id: frames[0]!.id, result: {} }, { seqId: 1 }); await init;
  await expect(session.call('blocked', {}, { timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout', mayHaveBeenSent: true });
  await session.notify('compatible'); expect(session.ready).toBe(true);
});

it('取消已提交canonical调用仍保留未完成写入的额度和期限，实际回调才释放', async () => {
  const { session, server } = await initialized({ maxPending: 1, responseTimeoutMs: 300 });
  const socket = (session as unknown as { transport: WebSocket }).transport;
  const sendActual = socket.send.bind(socket); const completions: (() => void)[] = [];
  socket.send = (value, optionsOrCallback?, callback?) => {
    const complete = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    sendActual(value, error => completions.push(() => { if (typeof complete === 'function') complete(error); }));
  };
  const controller = new AbortController();
  const pending = session.call('cancel-write', {}, { signal: controller.signal }).catch(error => error);
  await until(() => server.frames.length === 3 && completions.length === 1); controller.abort();
  expect(await pending).toMatchObject({ code: 'cancelled', mayHaveBeenSent: true });
  await expect(session.call('capacity-held')).rejects.toMatchObject({ code: 'capacity', mayHaveBeenSent: false });
  completions[0]!(); socket.send = sendActual;
  const next = session.call('next'); await until(() => server.frames.length === 4);
  send(server.sockets[0]!, { id: server.frames[3]!.id, result: true }); expect(await next).toBe(true); expect(session.ready).toBe(true);
});

it('取消后的迟到响应/写回调不能撤销原写入超时，signal监听器及时清理', async () => {
  const { session, server } = await initialized({ maxPending: 1, responseTimeoutMs: 60 });
  const socket = (session as unknown as { transport: WebSocket }).transport;
  const sendActual = socket.send.bind(socket); const completions: (() => void)[] = [];
  socket.send = (value, optionsOrCallback?, callback?) => {
    const complete = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    sendActual(value, error => completions.push(() => { if (typeof complete === 'function') complete(error); }));
  };
  const controller = new AbortController();
  const pending = session.call('cancel-stuck', {}, { signal: controller.signal }).catch(error => error);
  await until(() => server.frames.length === 3 && completions.length === 1); controller.abort();
  expect(await pending).toMatchObject({ code: 'cancelled', mayHaveBeenSent: true }); expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  send(server.sockets[0]!, { id: server.frames[2]!.id, result: true }); await until(() => session.closed);
  completions[0]!(); expect(session.closed).toBe(true);
});
