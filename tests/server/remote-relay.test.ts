// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { RemoteRelay, RemoteAuthRequiredError, type RemoteRelayOptions } from '../../server/remote/relay.js';
import { type RpcMessage, type ServerMessageChunk } from '../../server/remote/envelope.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0; });
async function until(check: () => boolean, timeout = 1500): Promise<void> {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error('等待条件超时'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function server(options: { autoPong?: boolean; challenge?: boolean } = {}) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, autoPong: options.autoPong ?? true });
  await new Promise<void>(resolve => wss.once('listening', resolve));
  const connections: WebSocket[] = []; const frames: Record<string, any>[] = []; const headers: (string | undefined)[] = [];
  wss.on('connection', (socket, request) => {
    connections.push(socket); headers.push(request.headers['x-codex-subscribe-cursor'] as string | undefined);
    socket.on('message', raw => frames.push(JSON.parse(raw.toString())));
    socket.on('error', () => {});
    if (options.challenge !== false) socket.send(JSON.stringify({ type: 'device_key_challenge', nonce: 'challenge' }));
  });
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of wss.clients) socket.terminate(); wss.close(() => resolve()); }));
  return { url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`, connections, frames, headers, wss };
}
function relay(url: string, options: Partial<RemoteRelayOptions> = {}) {
  const value = new RemoteRelay({ clientId: 'client', authProvider: { async prepareConnection() {
    return { url, headers: {}, async signChallenge(challenge) { expect(challenge.nonce).toBe('challenge'); return { signature: 'proof' }; } };
  } }, reconnectMinMs: 15, reconnectMaxMs: 30, streamPingMs: 10000, nativePingMs: 10000, ...options });
  cleanup.push(() => value.close()); return value;
}
function incoming(streamId: string, environmentId: string, seqId: number, message: RpcMessage, cursor?: string | null) {
  return { type: 'server_message', client_id: 'client', stream_id: streamId, env_id: environmentId, seq_id: seqId, message, ...(cursor === undefined ? {} : { cursor }) };
}
function send(socket: WebSocket, frame: unknown) { socket.send(JSON.stringify(frame)); }
function incomingChunks(streamId: string, message: RpcMessage, count: number): ServerMessageChunk[] {
  const bytes = Buffer.from(JSON.stringify(message));
  return Array.from({ length: count }, (_, index) => ({
    type: 'server_message_chunk', client_id: 'client', stream_id: streamId, env_id: 'mac', seq_id: 1,
    segment_id: index, segment_count: count, message_size_bytes: bytes.length,
    message_chunk_base64: bytes.subarray(Math.floor(index * bytes.length / count), Math.floor((index + 1) * bytes.length / count)).toString('base64'),
  }));
}

it('两目标三条逻辑 stream 共用一条常驻物理连接，按完整路由隔离并分别递增 seq', async () => {
  const upstream = await server(); const value = relay(upstream.url);
  const a = value.createStream({ environmentId: 'mac-a' });
  const b = value.createStream({ environmentId: 'mac-b' });
  const c = value.createStream({ environmentId: 'mac-a' });
  const received: unknown[][] = [[], [], []];
  [a, b, c].forEach((stream, i) => stream.on('message', message => received[i].push(message)));
  await until(() => value.state === 'online' && upstream.frames.length === 1);
  expect(upstream.frames[0]).toEqual({ type: 'device_key_proof', signature: 'proof' });
  await a.send({ id: 1, method: 'initialize' }); await b.send({ id: 2, method: 'turn/start' }); await c.send({ method: 'event' }); await a.send({ id: 3, method: 'thread/read' });
  await until(() => upstream.frames.length === 5);
  expect(upstream.connections).toHaveLength(1);
  expect(upstream.frames.slice(1).map(frame => [frame.stream_id, frame.env_id, frame.seq_id])).toEqual([[a.streamId, 'mac-a', 1], [b.streamId, 'mac-b', 1], [c.streamId, 'mac-a', 1], [a.streamId, 'mac-a', 2]]);
  const socket = upstream.connections[0];
  send(socket, incoming(a.streamId, 'mac-a', 1, { result: 'one' })); send(socket, incoming(a.streamId, 'mac-a', 2, { result: 'two' }));
  send(socket, incoming(a.streamId, 'mac-a', 1, { result: 'duplicate' }));
  send(socket, incoming(b.streamId, 'mac-b', 1, { result: 'b' })); send(socket, incoming(c.streamId, 'mac-a', 1, { result: 'c' }));
  send(socket, incoming(a.streamId, 'mac-b', 4, { result: 'wrong-env' }));
  send(socket, { ...incoming(a.streamId, 'mac-a', 5, { result: 'wrong-client' }), client_id: 'other' });
  send(socket, incoming('unknown', 'mac-a', 6, { result: 'wrong-stream' }));
  await until(() => received[2].length === 1);
  expect(received).toEqual([[{ result: 'one' }, { result: 'two' }], [{ result: 'b' }], [{ result: 'c' }]]);
  await a.close(); await b.send({ method: 'still-alive' });
  await until(() => upstream.frames.some(frame => frame.type === 'client_closed'));
  expect(upstream.frames.find(frame => frame.type === 'client_closed')).toEqual({ type: 'client_closed', client_id: 'client', stream_id: a.streamId, env_id: 'mac-a', seq_id: 3 });
  await b.close(); await c.close();
  await new Promise(resolve => setTimeout(resolve, 35));
  expect(value.state).toBe('online'); expect(upstream.connections).toHaveLength(1); expect(socket.readyState).toBe(1);
});

it('未 online 或超出背压预算明确拒绝，既不缓存也不发送业务请求', async () => {
  const upstream = await server({ challenge: false }); const value = relay(upstream.url, { maxBufferedBytes: 300 });
  const stream = value.createStream({ environmentId: 'mac' });
  await expect(stream.send({ method: 'write' })).rejects.toMatchObject({ mayHaveBeenSent: false });
  await until(() => upstream.connections.length === 1); send(upstream.connections[0], { type: 'device_key_challenge', nonce: 'challenge' });
  await until(() => value.state === 'online');
  await expect(stream.send({ method: 'write', params: 'x'.repeat(1000) })).rejects.toMatchObject({ mayHaveBeenSent: false });
  await stream.send({ method: 'small' }); await until(() => upstream.frames.length === 2);
  expect(upstream.frames[1]).toMatchObject({ seq_id: 1, message: { method: 'small' } });
});

it('真实 WS 普通及分块消息完整往返保留时间戳和任意安全扩展字段', async () => {
  const upstream = await server(); const value = relay(upstream.url); const stream = value.createStream({ environmentId: 'mac' });
  const received: RpcMessage[] = []; const errors: Error[] = [];
  stream.on('message', message => received.push(message)); value.on('protocolError', error => errors.push(error));
  await until(() => value.state === 'online');
  const messages: RpcMessage[] = [
    { method: 'remoteControl/status/changed', params: { enabled: true }, emittedAtMs: 1794530000000, extension: { flags: ['future', 1, null] } },
    { jsonrpc: '2.0', id: 2, result: { text: '中🙂'.repeat(50000) }, emittedAtMs: 1794530000123, futureMetadata: { opaque: true } },
    { type: 'error', code: 'permission_denied', message: '请重新授权', extra: { retryable: false } },
  ];
  for (const [index, message] of messages.entries()) {
    const seqId = index + 1; await stream.send(message);
    const matching = () => upstream.frames.filter(frame => frame.stream_id === stream.streamId && frame.seq_id === seqId);
    await until(() => matching().length > 0 && matching().length === (matching()[0].segment_count ?? 1));
    const frames = matching();
    expect(frames[0].type).toBe(index === 1 ? 'client_message_chunk' : 'client_message');
    for (const frame of [...frames].reverse()) send(upstream.connections[0], { ...frame, type: frame.type === 'client_message' ? 'server_message' : 'server_message_chunk' });
    await until(() => received.length === seqId); expect(received[index]).toEqual(message);
  }
  expect(errors).toHaveLength(0); expect(upstream.connections).toHaveLength(1);
});

it.each([0, 1, 4])('unknown pong seq=%s 始终通知两层，不推进服务端序列或 cursor，也不中断其他流', async seqId => {
  const upstream = await server(); const value = relay(upstream.url);
  const stream = value.createStream({ environmentId: 'mac' }); const other = value.createStream({ environmentId: 'other-mac' });
  const received: RpcMessage[] = []; const otherReceived: RpcMessage[] = []; const pongs: unknown[] = []; const relayPongs: unknown[] = []; const errors: Error[] = [];
  stream.on('message', message => received.push(message)); other.on('message', message => otherReceived.push(message));
  stream.on('pong', pong => pongs.push(pong)); value.on('pong', pong => relayPongs.push(pong)); value.on('protocolError', error => errors.push(error));
  await until(() => value.state === 'online'); await stream.send({ method: 'initialize' });
  send(upstream.connections[0], incoming(stream.streamId, 'mac', 1, { result: 'one' }, 'c1'));
  send(upstream.connections[0], incoming(stream.streamId, 'mac', 2, { result: 'two' }, 'safe'));
  await until(() => received.length === 2);
  const unknown = { type: 'pong', client_id: 'client', stream_id: stream.streamId, env_id: 'mac', seq_id: seqId, status: 'unknown', cursor: 'unsafe-unknown' };
  send(upstream.connections[0], unknown); await until(() => pongs.length === 1 && relayPongs.length === 1);
  expect(pongs).toEqual([unknown]); expect(relayPongs).toEqual([unknown]); expect(stream.lastServerSeqId).toBe(2);
  send(upstream.connections[0], incoming(other.streamId, 'other-mac', 1, { result: 'still-alive' }));
  await until(() => otherReceived.length === 1); expect(value.state).toBe('online'); expect(upstream.connections).toHaveLength(1); expect(errors).toHaveLength(0);
  upstream.connections[0].terminate(); await until(() => upstream.connections.length === 2 && value.state === 'online');
  expect(upstream.headers[1]).toBe('safe'); expect(upstream.frames.filter(frame => frame.type === 'client_message')).toHaveLength(1);
});

it('unknown pong 不解除跨重连的缺失历史责任，上层显式 close 后才释放该流 barrier', async () => {
  const upstream = await server(); const value = relay(upstream.url);
  const a = value.createStream({ environmentId: 'mac-a' }); const b = value.createStream({ environmentId: 'mac-b' });
  const receivedB: RpcMessage[] = []; const receivedA: RpcMessage[] = []; const pongs: unknown[] = [];
  b.on('message', message => receivedB.push(message)); a.on('message', message => receivedA.push(message)); b.on('pong', pong => pongs.push(pong));
  await until(() => value.state === 'online'); send(upstream.connections[0], incoming(b.streamId, 'mac-b', 1, { result: 'safe' }, 'safe')); await until(() => receivedB.length === 1);
  send(upstream.connections[0], { type: 'server_message_chunk', client_id: 'client', stream_id: b.streamId, env_id: 'mac-b', seq_id: 2,
    segment_id: 0, segment_count: 2, message_size_bytes: 20, message_chunk_base64: 'ew==', cursor: 'partial' });
  await until(() => b.hasPartialMessage); upstream.connections[0].terminate();
  await until(() => upstream.connections.length === 2 && value.state === 'online');
  send(upstream.connections[1], { type: 'pong', client_id: 'client', stream_id: b.streamId, env_id: 'mac-b', seq_id: 2, status: 'unknown', cursor: 'unsafe-unknown' });
  await until(() => pongs.length === 1); expect(b.lastServerSeqId).toBe(1); expect(b.hasUnrecoveredHistory).toBe(true);
  send(upstream.connections[1], incoming(a.streamId, 'mac-a', 1, { result: 'a1' }, 'unsafe-a'));
  await until(() => receivedA.length === 1); upstream.connections[1].terminate();
  await until(() => upstream.connections.length === 3 && value.state === 'online'); expect(upstream.headers[2]).toBe('safe');
  await b.close(); send(upstream.connections[2], incoming(a.streamId, 'mac-a', 2, { result: 'a2' }, 'now-safe'));
  await until(() => receivedA.length === 2); upstream.connections[2].terminate();
  await until(() => upstream.connections.length === 4 && value.state === 'online'); expect(upstream.headers[3]).toBe('now-safe');
});

it('断线沿用安全 cursor/seq 并自动重连，不重发 initialize 或写入', async () => {
  const upstream = await server(); const value = relay(upstream.url); const stream = value.createStream({ environmentId: 'mac' });
  const disconnected: unknown[] = []; const received: unknown[] = [];
  stream.on('disconnect', event => disconnected.push(event)); stream.on('message', message => received.push(message));
  await until(() => value.state === 'online'); await stream.send({ id: 1, method: 'initialize' }); await stream.send({ id: 2, method: 'turn/start' });
  send(upstream.connections[0], incoming(stream.streamId, 'mac', 1, { result: 'complete' }, 'safe'));
  await until(() => received.length === 1); upstream.connections[0].terminate();
  await until(() => upstream.connections.length === 2 && value.state === 'online');
  expect(upstream.headers).toEqual([undefined, 'safe']);
  expect(upstream.frames.filter(frame => frame.type === 'client_message')).toHaveLength(2);
  expect(disconnected[0]).toMatchObject({ mayHaveBeenSent: true, lastSentSeqId: 2 });
  send(upstream.connections[1], incoming(stream.streamId, 'mac', 1, { result: 'duplicate' }, 'again'));
  send(upstream.connections[1], incoming(stream.streamId, 'mac', 2, { result: 'next' }, 'later'));
  await until(() => received.length === 2); expect(received).toEqual([{ result: 'complete' }, { result: 'next' }]);
  await stream.send({ id: 3, method: 'thread/read' }); await until(() => upstream.frames.some(frame => frame.seq_id === 3));
});

it('服务端 seq 缺口阻止响应和 cursor 越过，重连只补历史且按序交付', async () => {
  const upstream = await server(); const value = relay(upstream.url); const stream = value.createStream({ environmentId: 'mac' });
  const received: RpcMessage[] = []; stream.on('message', message => received.push(message)); await until(() => value.state === 'online');
  await stream.send({ id: 1, method: 'initialize' }); await stream.send({ id: 2, method: 'command/exec' });
  send(upstream.connections[0], incoming(stream.streamId, 'mac', 1, { method: 'started' }, 'safe'));
  await until(() => received.length === 1);
  send(upstream.connections[0], incoming(stream.streamId, 'mac', 3, { id: 2, result: 'done' }, 'unsafe'));
  await until(() => upstream.connections.length === 2 && value.state === 'online');
  expect(received).toEqual([{ method: 'started' }]); expect(upstream.headers[1]).toBe('safe');
  send(upstream.connections[1], incoming(stream.streamId, 'mac', 2, { method: 'stdout', params: 'output' }, 'output'));
  send(upstream.connections[1], incoming(stream.streamId, 'mac', 3, { id: 2, result: 'done' }, 'done'));
  await until(() => received.length === 3);
  expect(received).toEqual([{ method: 'started' }, { method: 'stdout', params: 'output' }, { id: 2, result: 'done' }]);
  expect(upstream.frames.filter(frame => frame.type === 'client_message')).toHaveLength(2);
});

it('当前 seq 分块未完整时后续完整响应不能提前交付，重连补齐后恢复', async () => {
  const upstream = await server(); const value = relay(upstream.url); const stream = value.createStream({ environmentId: 'mac' });
  const received: RpcMessage[] = []; stream.on('message', message => received.push(message)); await until(() => value.state === 'online');
  send(upstream.connections[0], incoming(stream.streamId, 'mac', 1, { method: 'started' }, 'safe')); await until(() => received.length === 1);
  const bytes = Buffer.from(JSON.stringify({ method: 'stdout', params: '中🙂' }));
  const parts = [bytes.subarray(0, 12), bytes.subarray(12)].map((bytesPart, index) => ({ type: 'server_message_chunk', client_id: 'client', stream_id: stream.streamId, env_id: 'mac', seq_id: 2,
    segment_id: index, segment_count: 2, message_size_bytes: bytes.length, message_chunk_base64: bytesPart.toString('base64'), cursor: `partial-${index}` }));
  send(upstream.connections[0], parts[1]); send(upstream.connections[0], incoming(stream.streamId, 'mac', 3, { result: 'done' }, 'unsafe'));
  await until(() => upstream.connections.length === 2 && value.state === 'online'); expect(received).toHaveLength(1); expect(upstream.headers[1]).toBe('safe');
  send(upstream.connections[1], parts[1]); send(upstream.connections[1], parts[0]);
  send(upstream.connections[1], incoming(stream.streamId, 'mac', 3, { result: 'done' }, 'done'));
  await until(() => received.length === 3); expect(received).toEqual([{ method: 'started' }, { method: 'stdout', params: '中🙂' }, { result: 'done' }]);
});

it('ack 的客户端 seq 与服务端消息/pong 序列独立，重复 pong 不重复交付', async () => {
  const upstream = await server(); const value = relay(upstream.url); const stream = value.createStream({ environmentId: 'mac' });
  const received: RpcMessage[] = []; const acknowledgements: unknown[] = []; const pongs: unknown[] = [];
  stream.on('message', message => received.push(message)); stream.on('ack', ack => acknowledgements.push(ack)); stream.on('pong', pong => pongs.push(pong));
  await until(() => value.state === 'online');
  send(upstream.connections[0], incoming(stream.streamId, 'mac', 1, { method: 'started' }));
  send(upstream.connections[0], { type: 'ack', client_id: 'client', stream_id: stream.streamId, env_id: 'mac', seq_id: 99 });
  const pong = { type: 'pong', client_id: 'client', stream_id: stream.streamId, env_id: 'mac', seq_id: 2, status: 'active' };
  send(upstream.connections[0], pong); send(upstream.connections[0], pong);
  send(upstream.connections[0], incoming(stream.streamId, 'mac', 3, { result: 'done' }));
  await until(() => received.length === 2); expect(acknowledgements).toHaveLength(1); expect(pongs).toHaveLength(1); expect(upstream.connections).toHaveLength(1);
});

it('跨流 partial chunk 阻止全局 cursor 越过，断线后完整重放组装且不重复交付其他流', async () => {
  const upstream = await server(); const value = relay(upstream.url);
  const a = value.createStream({ environmentId: 'mac-a' }); const b = value.createStream({ environmentId: 'mac-b' });
  const receivedA: unknown[] = []; const receivedB: unknown[] = [];
  a.on('message', message => receivedA.push(message)); b.on('message', message => receivedB.push(message));
  await until(() => value.state === 'online'); send(upstream.connections[0], incoming(a.streamId, 'mac-a', 1, { result: 'safe' }, 'safe'));
  await until(() => receivedA.length === 1);
  const content = Buffer.from(JSON.stringify({ result: '中'.repeat(100000) }));
  const chunked = Array.from({ length: Math.ceil(content.length / 100000) }, (_, index) => ({
    type: 'server_message_chunk', client_id: 'client', stream_id: b.streamId, env_id: 'mac-b', seq_id: 1,
    segment_id: index, segment_count: Math.ceil(content.length / 100000), message_size_bytes: content.length,
    message_chunk_base64: content.subarray(index * 100000, (index + 1) * 100000).toString('base64'),
  }));
  send(upstream.connections[0], { ...chunked[0], cursor: 'partial' }); send(upstream.connections[0], incoming(a.streamId, 'mac-a', 2, { result: 'after-partial' }, 'unsafe'));
  await until(() => receivedA.length === 2); upstream.connections[0].terminate();
  await until(() => upstream.connections.length === 2 && value.state === 'online'); expect(upstream.headers[1]).toBe('safe');
  [...chunked].reverse().forEach((frame, index) => send(upstream.connections[1], { ...frame, cursor: `restored-${index}` }));
  send(upstream.connections[1], incoming(a.streamId, 'mac-a', 2, { result: 'duplicate' }, 'now-safe'));
  await until(() => receivedB.length === 1); upstream.connections[1].terminate();
  await until(() => upstream.connections.length === 3 && value.state === 'online');
  expect(upstream.headers[2]).toBe('now-safe'); expect(receivedA).toHaveLength(2); expect(receivedB).toEqual([{ result: '中'.repeat(100000) }]);
});

it.each(['partial', 'gap'])('跨重连保留 B 的 %s 恢复责任，A 先收到完整消息也不能提前推进 cursor', async mode => {
  const upstream = await server(); const value = relay(upstream.url);
  const a = value.createStream({ environmentId: 'mac-a' }); const b = value.createStream({ environmentId: 'mac-b' });
  const receivedA: unknown[] = []; const receivedB: unknown[] = [];
  a.on('message', message => receivedA.push(message)); b.on('message', message => receivedB.push(message));
  await until(() => value.state === 'online');
  send(upstream.connections[0], incoming(a.streamId, 'mac-a', 1, { result: 'a1' }, 'first'));
  send(upstream.connections[0], incoming(b.streamId, 'mac-b', 1, { result: 'b1' }, 'safe'));
  await until(() => receivedB.length === 1);
  if (mode === 'partial') {
    send(upstream.connections[0], { type: 'server_message_chunk', client_id: 'client', stream_id: b.streamId, env_id: 'mac-b', seq_id: 2,
      segment_id: 0, segment_count: 2, message_size_bytes: 20, message_chunk_base64: 'ew==', cursor: 'partial' });
    await new Promise(resolve => setTimeout(resolve, 10)); upstream.connections[0].terminate();
  } else send(upstream.connections[0], incoming(b.streamId, 'mac-b', 3, { result: 'b3' }, 'gap'));
  await until(() => upstream.connections.length === 2 && value.state === 'online'); expect(upstream.headers[1]).toBe('safe');
  send(upstream.connections[1], incoming(a.streamId, 'mac-a', 2, { result: 'a2' }, 'unsafe-a'));
  await until(() => receivedA.length === 2); upstream.connections[1].terminate();
  await until(() => upstream.connections.length === 3 && value.state === 'online'); expect(upstream.headers[2]).toBe('safe');
  send(upstream.connections[2], incoming(b.streamId, 'mac-b', 2, { result: 'b2' }, 'b2'));
  let socketIndex = 2; let nextASeq = 3;
  if (mode === 'gap') {
    send(upstream.connections[2], incoming(a.streamId, 'mac-a', 3, { result: 'a3' }, 'still-unsafe'));
    await until(() => receivedA.length === 3); upstream.connections[2].terminate();
    await until(() => upstream.connections.length === 4 && value.state === 'online'); expect(upstream.headers[3]).toBe('safe');
    socketIndex = 3; nextASeq = 4;
    send(upstream.connections[socketIndex], incoming(b.streamId, 'mac-b', 3, { result: 'b3' }, 'b3'));
  }
  send(upstream.connections[socketIndex], incoming(a.streamId, 'mac-a', nextASeq, { result: `a${nextASeq}` }, 'now-safe'));
  await until(() => receivedA.length === nextASeq); upstream.connections[socketIndex].terminate();
  await until(() => upstream.connections.length === socketIndex + 2 && value.state === 'online'); expect(upstream.headers[socketIndex + 1]).toBe('now-safe');
  expect(receivedB).toEqual(mode === 'gap' ? [{ result: 'b1' }, { result: 'b2' }, { result: 'b3' }] : [{ result: 'b1' }, { result: 'b2' }]);
});

it('auth-required 停止网络重试，普通 provider 网络故障指数退避后恢复', async () => {
  const upstream = await server(); let authAttempts = 0;
  const blocked = relay(upstream.url, { authProvider: { async prepareConnection() { authAttempts++; throw new RemoteAuthRequiredError(); } } });
  await until(() => blocked.state === 'auth-required'); await new Promise(resolve => setTimeout(resolve, 65));
  expect(authAttempts).toBe(1); expect(upstream.connections).toHaveLength(0);
  let attempts = 0;
  const recovering = relay(upstream.url, { authProvider: { async prepareConnection() {
    if (++attempts < 3) throw new Error('network'); return { url: upstream.url, headers: {}, async signChallenge() { return {}; } };
  } } });
  await until(() => recovering.state === 'online'); expect(attempts).toBe(3); expect(upstream.connections).toHaveLength(1);
});

it('连续 proof 后短连使用指数退避，只有稳定窗口完成后才重置', async () => {
  const upstream = await server(); const connectedAt: number[] = []; const disconnectedAt: number[] = [];
  upstream.wss.on('connection', socket => {
    const index = connectedAt.push(Date.now()) - 1;
    socket.on('message', raw => {
      if (JSON.parse(raw.toString()).type === 'device_key_proof' && index < 3) setTimeout(() => {
        disconnectedAt[index] = Date.now(); socket.terminate();
      }, 2);
    });
  });
  const value = relay(upstream.url, { reconnectMinMs: 40, reconnectMaxMs: 320, stableConnectionMs: 80 });
  await until(() => connectedAt.length === 4 && value.state === 'online');
  const gaps = connectedAt.slice(1).map((time, index) => time - disconnectedAt[index]);
  expect(gaps[0]).toBeGreaterThanOrEqual(30); expect(gaps[1]).toBeGreaterThanOrEqual(60); expect(gaps[2]).toBeGreaterThanOrEqual(120);
  await new Promise(resolve => setTimeout(resolve, 110)); const stableDisconnect = Date.now(); upstream.connections[3].terminate();
  await until(() => connectedAt.length === 5 && value.state === 'online');
  expect(connectedAt[4] - stableDisconnect).toBeLessThan(100);
  value.close(); const count = connectedAt.length; await new Promise(resolve => setTimeout(resolve, 110));
  expect(connectedAt).toHaveLength(count); expect(value.state).toBe('closed');
});

it.each(['ordinary', 'chunk'])('%s 入站消息统一遵守 UTF8 JSON 消息预算，拒绝时不推进 cursor 或 seq', async mode => {
  const upstream = await server(); const value = relay(upstream.url, { maxMessageBytes: 100, assembly: { maxMessageBytes: 1000 } }); const stream = value.createStream({ environmentId: 'mac' });
  const received: RpcMessage[] = []; const errors: Error[] = [];
  stream.on('message', message => received.push(message)); value.on('protocolError', error => errors.push(error));
  await until(() => value.state === 'online'); send(upstream.connections[0], incoming(stream.streamId, 'mac', 1, { result: 'safe' }, 'safe'));
  await until(() => received.length === 1);
  const message = { result: '中🙂'.repeat(50) }; const bytes = Buffer.from(JSON.stringify(message)); expect(bytes.length).toBeGreaterThan(100);
  if (mode === 'ordinary') send(upstream.connections[0], incoming(stream.streamId, 'mac', 2, message, 'unsafe'));
  else send(upstream.connections[0], { type: 'server_message_chunk', client_id: 'client', stream_id: stream.streamId, env_id: 'mac', seq_id: 2,
    segment_id: 0, segment_count: 1, message_size_bytes: bytes.length, message_chunk_base64: bytes.toString('base64'), cursor: 'unsafe' });
  await until(() => upstream.connections.length === 2 && value.state === 'online');
  expect(received).toEqual([{ result: 'safe' }]); expect(stream.lastServerSeqId).toBe(1); expect(upstream.headers[1]).toBe('safe'); expect(errors).toHaveLength(1);
  send(upstream.connections[1], incoming(stream.streamId, 'mac', 2, { result: 'within-budget' }, 'recovered')); await until(() => received.length === 2);
});

it('真实 WS 接受 100–150 KiB 普通服务端帧，153600+1 字节拒绝且保留安全 cursor', async () => {
  const upstream = await server(); const value = relay(upstream.url); const stream = value.createStream({ environmentId: 'mac' });
  const received: RpcMessage[] = []; stream.on('message', message => received.push(message));
  await until(() => value.state === 'online');
  for (const [index, size] of [128000, 153600].entries()) {
    const empty = incoming(stream.streamId, 'mac', index + 1, { result: '' }, `safe-${index}`);
    const message = { result: 'a'.repeat(size - Buffer.byteLength(JSON.stringify(empty))) };
    const frame = { ...empty, message }; expect(Buffer.byteLength(JSON.stringify(frame))).toBe(size);
    send(upstream.connections[0], frame); await until(() => received.length === index + 1); expect(received[index]).toEqual(message);
  }
  const empty = incoming(stream.streamId, 'mac', 3, { result: '' }, 'unsafe');
  const oversized = { ...empty, message: { result: 'a'.repeat(153601 - Buffer.byteLength(JSON.stringify(empty))) } };
  expect(Buffer.byteLength(JSON.stringify(oversized))).toBe(153601); send(upstream.connections[0], oversized);
  await until(() => upstream.connections.length === 2 && value.state === 'online');
  expect(received).toHaveLength(2); expect(stream.lastServerSeqId).toBe(2); expect(upstream.headers[1]).toBe('safe-1');
});

it('relay close 最终通知后终止所有流并清理监听器，重入 close 不发送请求或重复事件', async () => {
  const upstream = await server(); const value = relay(upstream.url);
  const a = value.createStream({ environmentId: 'mac-a' }); const b = value.createStream({ environmentId: 'mac-b' });
  const events: string[] = []; const reentrant: Promise<void>[] = [];
  const remember = (pending: Promise<void>) => { reentrant.push(pending); void pending.catch(() => undefined); };
  for (const [name, stream] of [['a', a], ['b', b]] as const) {
    stream.on('disconnect', () => { events.push(`disconnect-${name}`); value.close(); remember(stream.close()); });
    stream.on('close', () => { events.push(`close-${name}`); remember(stream.close()); value.close(); });
  }
  value.on('disconnect', () => { events.push('disconnect-relay'); remember(a.close()); remember(b.close()); });
  await until(() => value.state === 'online'); value.close();
  expect(a.closed).toBe(true); expect(b.closed).toBe(true);
  expect(events).toEqual(['disconnect-a', 'disconnect-b', 'disconnect-relay', 'close-a', 'close-b']);
  expect((await Promise.allSettled(reentrant)).every(result => result.status === 'fulfilled')).toBe(true);
  expect(a.eventNames()).toHaveLength(0); expect(b.eventNames()).toHaveLength(0); expect(value.eventNames()).toHaveLength(0);
  value.close(); await a.close(); await b.close(); await new Promise(resolve => setTimeout(resolve, 45));
  expect(events).toHaveLength(5); expect(upstream.frames.filter(frame => frame.type === 'client_closed')).toHaveLength(0); expect(upstream.connections).toHaveLength(1);
});

it('主动 stream close 与 relay close 并发保留原发送失败语义且只关闭一次', async () => {
  const upstream = await server(); const value = relay(upstream.url); const a = value.createStream({ environmentId: 'mac-a' }); const b = value.createStream({ environmentId: 'mac-b' });
  let aClosed = 0; let bClosed = 0; a.on('close', () => aClosed++); b.on('close', () => bClosed++);
  await until(() => value.state === 'online'); const explicit = a.close(); value.close();
  await expect(explicit).rejects.toMatchObject({ mayHaveBeenSent: true }); expect(a.close()).toBe(explicit);
  expect(a.closed).toBe(true); expect(b.closed).toBe(true); expect(aClosed).toBe(1); expect(bClosed).toBe(1);
  expect(a.eventNames()).toHaveLength(0); expect(b.eventNames()).toHaveLength(0); await b.close();
  await new Promise(resolve => setTimeout(resolve, 30)); expect(upstream.frames.filter(frame => frame.type === 'client_closed' && frame.stream_id === b.streamId)).toHaveLength(0);
});

it('关闭监听器抛错仍终止全部流并释放监听器，完成清理后传播首个异常', async () => {
  const upstream = await server(); const value = relay(upstream.url);
  const a = value.createStream({ environmentId: 'mac-a' }); const b = value.createStream({ environmentId: 'mac-b' });
  const firstError = new Error('first close failed'); const secondError = new Error('second close failed'); const events: string[] = [];
  a.on('close', () => { events.push('close-a'); throw firstError; });
  b.on('close', () => { events.push('close-b'); throw secondError; });
  value.on('disconnect', () => events.push('disconnect-relay'));
  await until(() => value.state === 'online'); expect(() => value.close()).toThrow(firstError);
  expect(events).toEqual(['disconnect-relay', 'close-a', 'close-b']); expect(a.closed).toBe(true); expect(b.closed).toBe(true); expect(value.state).toBe('closed');
  expect(a.eventNames()).toHaveLength(0); expect(b.eventNames()).toHaveLength(0); expect(value.eventNames()).toHaveLength(0);
  await a.close(); await b.close(); value.close(); await new Promise(resolve => setTimeout(resolve, 40));
  expect(upstream.frames.filter(frame => frame.type === 'client_closed')).toHaveLength(0); expect(upstream.connections).toHaveLength(1);
});

it.each([401, 403])('HTTP upgrade %s 进入 auth-required 并停止连接重试', async status => {
  const http = createServer(); let attempts = 0;
  http.on('upgrade', (_request, socket) => { attempts++; socket.end(`HTTP/1.1 ${status} Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => http.close(() => resolve())));
  const value = relay(`ws://127.0.0.1:${(http.address() as { port: number }).port}`);
  await until(() => value.state === 'auth-required'); await new Promise(resolve => setTimeout(resolve, 60)); expect(attempts).toBe(1);
});

it('没有新位置的 null cursor 不会清除最后已验证的安全游标', async () => {
  const upstream = await server(); const value = relay(upstream.url); const stream = value.createStream({ environmentId: 'mac' });
  const received: unknown[] = []; stream.on('message', message => received.push(message)); await until(() => value.state === 'online');
  send(upstream.connections[0], incoming(stream.streamId, 'mac', 1, { result: 'safe' }, 'safe'));
  send(upstream.connections[0], { type: 'pong', client_id: 'client', stream_id: stream.streamId, env_id: 'mac', seq_id: 1, status: 'active', cursor: null });
  await until(() => received.length === 1); await new Promise(resolve => setTimeout(resolve, 10)); upstream.connections[0].terminate();
  await until(() => upstream.connections.length === 2 && value.state === 'online'); expect(upstream.headers[1]).toBe('safe');
});

it('关闭期间迟到的连接认证结果不能创建 socket 或恢复 state', async () => {
  const upstream = await server(); let finish!: (value: any) => void;
  const value = relay(upstream.url, { authProvider: { prepareConnection: () => new Promise(resolve => { finish = resolve; }) } });
  await until(() => Boolean(finish)); value.close(); finish({ url: upstream.url, headers: {}, signChallenge: async () => ({}) });
  await new Promise(resolve => setTimeout(resolve, 50)); expect(value.state).toBe('closed'); expect(upstream.connections).toHaveLength(0);
});

it('关闭期间迟到的 challenge 签名不能发送 proof，也不会产生未处理 rejection', async () => {
  const upstream = await server(); let finish!: (value: object) => void;
  const value = relay(upstream.url, { authProvider: { async prepareConnection() { return {
    url: upstream.url, headers: {}, signChallenge: () => new Promise(resolve => { finish = resolve; }),
  }; } } });
  await until(() => Boolean(finish)); value.close(); finish({ signature: 'late' });
  await new Promise(resolve => setTimeout(resolve, 40)); expect(value.state).toBe('closed'); expect(upstream.frames).toHaveLength(0);
});

it('可选 device_key_authenticated 核对 clientId，未知认证帧安全拒绝', async () => {
  const upstream = await server(); const value = relay(upstream.url); const errors: Error[] = [];
  value.on('protocolError', error => errors.push(error)); await until(() => value.state === 'online');
  send(upstream.connections[0], { type: 'device_key_authenticated', clientId: 'client' });
  await new Promise(resolve => setTimeout(resolve, 15)); expect(value.state).toBe('online'); expect(errors).toHaveLength(0);
  send(upstream.connections[0], { type: 'device_key_authenticated', clientId: 'other', secret: 'do-not-leak' });
  await until(() => value.state === 'auth-required'); expect(errors.every(error => !error.message.includes('do-not-leak'))).toBe(true);
  const unknown = relay(upstream.url); unknown.on('protocolError', error => errors.push(error));
  await until(() => unknown.state === 'online'); send(upstream.connections.at(-1)!, { type: 'unknown_auth_secret', secret: 'do-not-leak' });
  await until(() => errors.length > 0); expect(errors.at(-1)!.message).not.toContain('do-not-leak');
});

it('maxStreams 限制同时占用，反复关闭后释放名额及未完成分块', async () => {
  const upstream = await server(); const value = relay(upstream.url, { maxStreams: 1, assembly: { timeoutMs: 25 } });
  await until(() => value.state === 'online');
  for (let index = 0; index < 5; index++) {
    const stream = value.createStream({ environmentId: 'mac' });
    expect(() => value.createStream({ environmentId: 'mac' })).toThrow();
    send(upstream.connections[0], { type: 'server_message_chunk', client_id: 'client', stream_id: stream.streamId, env_id: 'mac', seq_id: 1,
      segment_id: 0, segment_count: 2, message_size_bytes: 20, message_chunk_base64: Buffer.from('{').toString('base64'), cursor: `discard-${index}` });
    await new Promise(resolve => setTimeout(resolve, 5)); await stream.close();
  }
  await new Promise(resolve => setTimeout(resolve, 45)); expect(upstream.connections).toHaveLength(1); expect(value.state).toBe('online');
});

it('关闭正在写入的物理 socket 报告可能已发送且不重发', async () => {
  const upstream = await server(); const value = relay(upstream.url); const stream = value.createStream({ environmentId: 'mac' });
  await until(() => value.state === 'online');
  const writing = stream.send({ method: 'turn/start', params: 'x'.repeat(1000000) }); value.close();
  await expect(writing).rejects.toMatchObject({ mayHaveBeenSent: true, seqId: 1 });
  await new Promise(resolve => setTimeout(resolve, 40)); expect(upstream.connections).toHaveLength(1);
});

it('网络断开期间旧签名未结束，不会并发启动第二个认证任务', async () => {
  const upstream = await server(); let attempts = 0; let finish!: (value: object) => void;
  const value = relay(upstream.url, { authProvider: { async prepareConnection() {
    attempts++; return { url: upstream.url, headers: {}, signChallenge: () => new Promise(resolve => { finish = resolve; }) };
  } } });
  await until(() => Boolean(finish)); upstream.connections[0].terminate();
  await new Promise(resolve => setTimeout(resolve, 60)); expect(attempts).toBe(1); expect(upstream.connections).toHaveLength(1);
  finish({}); await until(() => attempts === 2); value.close();
});

it('零逻辑 stream 时正常原生 pong 持续保活', async () => {
  const upstream = await server(); const value = relay(upstream.url, { nativePingMs: 10, nativePongTimeoutMs: 30 });
  const applicationPongs: unknown[] = []; value.on('pong', frame => applicationPongs.push(frame));
  await until(() => value.state === 'online'); await new Promise(resolve => setTimeout(resolve, 90));
  expect(value.state).toBe('online'); expect(upstream.connections).toHaveLength(1); expect(applicationPongs).toEqual([]);
});

it('真实 WS 新分块持续到达时续期存活并持续发原生 ping，停止进度后仍按原超时断开', async () => {
  const upstream = await server({ autoPong: false });
  const value = relay(upstream.url, { nativePingMs: 40, nativePongTimeoutMs: 180, reconnectMinMs: 10000 });
  const stream = value.createStream({ environmentId: 'mac' }); const message = { result: 'x'.repeat(800) };
  const received: RpcMessage[] = []; const pings: number[] = []; const disconnected: { reason: string; at: number }[] = [];
  const progress: number[] = []; const errors: Error[] = [];
  stream.on('message', frame => received.push(frame)); value.on('protocolError', error => errors.push(error));
  value.on('disconnect', event => disconnected.push({ reason: event.reason, at: Date.now() }));
  await until(() => value.state === 'online'); const socket = upstream.connections[0];
  socket.on('ping', () => pings.push(Date.now())); await until(() => pings.length > 0);
  for (const frame of incomingChunks(stream.streamId, message, 8)) {
    if (value.state !== 'online') break;
    send(socket, frame); progress.push(Date.now());
    await new Promise(resolve => setTimeout(resolve, 45));
  }
  const evidence = { pings: pings.length, sentNewSegments: progress.length, disconnects: disconnected, protocolErrors: errors.map(error => error.message) };
  process.stdout.write(JSON.stringify({ test: 'native-liveness-new-chunks', ...evidence }) + '\n');
  expect(disconnected, JSON.stringify(evidence)).toEqual([]);
  await until(() => received.length === 1); expect(received).toEqual([message]); expect(pings.length).toBeGreaterThan(3);
  expect(errors).toEqual([]); expect(upstream.connections).toHaveLength(1);
  await until(() => disconnected.length === 1);
  expect(disconnected[0].reason).toBe('network');
  expect(disconnected[0].at - progress.at(-1)!).toBeGreaterThanOrEqual(160);
  expect(disconnected[0].at - progress.at(-1)!).toBeLessThan(450);
});

it.each(['message', 'active-pong'] as const)('真实 WS 新序号 %s 续期存活，业务进度不冒充原生 pong', async mode => {
  const upstream = await server({ autoPong: false });
  const value = relay(upstream.url, { nativePingMs: 40, nativePongTimeoutMs: 180, reconnectMinMs: 10000 });
  const stream = value.createStream({ environmentId: 'mac' }); let pings = 0; let messages = 0; let pongs = 0;
  stream.on('message', () => messages++); value.on('pong', () => pongs++);
  await until(() => value.state === 'online'); const socket = upstream.connections[0];
  socket.on('ping', () => pings++); await until(() => pings > 0);
  for (let seq = 1; seq <= 6; seq++) {
    send(socket, mode === 'message' ? incoming(stream.streamId, 'mac', seq, { result: seq }) :
      { type: 'pong', client_id: 'client', stream_id: stream.streamId, env_id: 'mac', seq_id: seq, status: 'active' });
    await until(() => stream.lastServerSeqId === seq); await new Promise(resolve => setTimeout(resolve, 50));
  }
  expect(value.state).toBe('online'); expect(upstream.connections).toHaveLength(1); expect(pings).toBeGreaterThan(3);
  expect(messages).toBe(mode === 'message' ? 6 : 0); expect(pongs).toBe(mode === 'active-pong' ? 6 : 0);
  // 有效数据只续期当前等待，不伪装收到原生 pong。
  expect((value as unknown as { awaitingNativePong: boolean }).awaitingNativePong).toBe(true);
});

it.each(['duplicate-chunk', 'wrong-client', 'wrong-stream', 'wrong-env', 'old-message', 'old-pong', 'closed-stream', 'ack', 'cursor'] as const)(
  '真实 WS %s 不续期存活，即使持续收到帧也按原超时断开', async mode => {
    const upstream = await server({ autoPong: false });
    const value = relay(upstream.url, { nativePingMs: 40, nativePongTimeoutMs: 180, reconnectMinMs: 10000 });
    const stream = value.createStream({ environmentId: 'mac' }); const disconnected: { reason: string; at: number }[] = []; const errors: Error[] = [];
    value.on('disconnect', event => disconnected.push({ reason: event.reason, at: Date.now() })); value.on('protocolError', error => errors.push(error));
    await until(() => value.state === 'online'); const socket = upstream.connections[0];
    send(socket, incoming(stream.streamId, 'mac', 1, { result: 'first' })); await until(() => stream.lastServerSeqId === 1);
    if (mode === 'closed-stream') await stream.close();
    let firstPing = 0; socket.on('ping', () => { firstPing ||= Date.now(); }); await until(() => firstPing > 0);
    const chunk = { ...incomingChunks(stream.streamId, { result: 'incomplete' }, 2)[0], seq_id: 2 };
    let lastActualProgress = firstPing; let attempts = 0;
    while (!disconnected.length && Date.now() - firstPing < 700) {
      const seq = ++attempts + 1;
      const frame = mode === 'duplicate-chunk' ? chunk : mode === 'old-pong' ?
        { type: 'pong', client_id: 'client', stream_id: stream.streamId, env_id: 'mac', seq_id: 1, status: 'active', cursor: `c${seq}` } :
        mode === 'ack' ? { type: 'ack', client_id: 'client', stream_id: stream.streamId, env_id: 'mac', seq_id: seq, cursor: `c${seq}` } :
        { ...incoming(stream.streamId, 'mac', mode === 'old-message' || mode === 'cursor' ? 1 : seq, { result: seq }, `c${seq}`),
          ...(mode === 'wrong-client' ? { client_id: 'other' } : {}), ...(mode === 'wrong-stream' ? { stream_id: 'other' } : {}),
          ...(mode === 'wrong-env' ? { env_id: 'other' } : {}) };
      send(socket, frame); if (mode === 'duplicate-chunk' && attempts === 1) lastActualProgress = Date.now();
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    expect(errors).toEqual([]); expect(disconnected).toHaveLength(1); expect(disconnected[0].reason).toBe('network'); expect(attempts).toBeGreaterThan(3);
    expect(disconnected[0].at - lastActualProgress).toBeGreaterThanOrEqual(160);
    expect(disconnected[0].at - lastActualProgress).toBeLessThan(450);
  });

it('原生 pong 后旧等待轮次的 ping 写回调不能断开新等待', async () => {
  const upstream = await server({ autoPong: false }); const value = relay(upstream.url, { nativePingMs: 50, nativePongTimeoutMs: 200, reconnectMinMs: 10000 });
  await until(() => value.state === 'online');
  const socket = (value as unknown as { socket: WebSocket }).socket;
  const pingActual = socket.ping.bind(socket); const completions: ((error?: Error) => void)[] = [];
  socket.ping = (data, mask, callback) => { pingActual(data, mask, error => completions.push(failure => callback?.(failure ?? error))); };
  await until(() => completions.length === 1);
  upstream.connections[0].pong(); await until(() => !(value as unknown as { awaitingNativePong: boolean }).awaitingNativePong);
  await until(() => completions.length === 2);
  // 模拟上一轮已排队、在下一轮才到达的失败回调。
  completions[0](new Error('stale ping callback'));
  expect(value.state).toBe('online');
});

it('撤销的存活定时器和旧 socket 的事件不能影响当前连接及计时', async () => {
  const upstream = await server({ autoPong: false }); const value = relay(upstream.url, { nativePingMs: 40, nativePongTimeoutMs: 200 });
  const stream = value.createStream({ environmentId: 'mac' }); const state = value as unknown as {
    socket: WebSocket; pongTimer?: NodeJS.Timeout & { _onTimeout: () => void }; nativeTimer?: NodeJS.Timeout & { _onTimeout: () => void };
  };
  await until(() => value.state === 'online'); const oldSocket = state.socket;
  const oldPong = oldSocket.listeners('pong')[0]; const oldMessage = oldSocket.listeners('message')[0]; const oldTick = state.nativeTimer!._onTimeout;
  await until(() => Boolean(state.pongTimer)); const cancelled = state.pongTimer!._onTimeout;
  send(upstream.connections[0], incoming(stream.streamId, 'mac', 1, { result: 'progress' })); await until(() => stream.lastServerSeqId === 1);
  cancelled(); expect(value.state).toBe('online');
  const oldTimeout = state.pongTimer!._onTimeout; upstream.connections[0].terminate();
  await until(() => upstream.connections.length === 2 && value.state === 'online');
  await until(() => Boolean(state.pongTimer)); const currentTimer = state.pongTimer;
  oldTick(); oldTimeout(); oldPong.call(oldSocket, Buffer.alloc(0));
  oldMessage.call(oldSocket, Buffer.from(JSON.stringify(incoming(stream.streamId, 'mac', 2, { result: 'stale' }))), false);
  expect(value.state).toBe('online'); expect(state.pongTimer).toBe(currentTimer); expect(stream.lastServerSeqId).toBe(1);
  // 当前连接没有有效入站进度，旧 pong 不能取消其原本的 network 超时。
  let network = 0; value.on('disconnect', event => { if (event.reason === 'network') network++; });
  await until(() => network === 1);
});

it('持续有效传输不能刷新 RPC 绝对期限，取消仍只撤销自己的调用', async () => {
  const upstream = await server({ autoPong: false }); const value = relay(upstream.url, { nativePingMs: 40, nativePongTimeoutMs: 180, reconnectMinMs: 10000 });
  const stream = value.createStream({ environmentId: 'mac' });
  const session = RemoteRpcSession.fromRemoteStream(stream, { responseTimeoutMs: 120 }); cleanup.push(() => session.close());
  await until(() => value.state === 'online'); const socket = upstream.connections[0]; const initialized = session.initialize();
  await until(() => upstream.frames.some(frame => frame.message?.method === 'initialize'));
  const init = upstream.frames.find(frame => frame.message?.method === 'initialize')!.message;
  send(socket, incoming(stream.streamId, 'mac', 1, { id: init.id, result: {} })); await initialized;
  const controller = new AbortController(); const defaultDeadline = session.call('default-deadline').catch(error => error);
  const longerDeadline = session.call('longer-deadline', {}, { timeoutMs: 220 }).catch(error => error);
  const cancelled = session.call('cancel-only-me', {}, { signal: controller.signal }).catch(error => error);
  await until(() => upstream.frames.some(frame => frame.message?.method === 'cancel-only-me')); controller.abort();
  expect(await cancelled).toMatchObject({ code: 'cancelled', mayHaveBeenSent: true });
  for (let seq = 2; seq <= 8; seq++) {
    send(socket, incoming(stream.streamId, 'mac', seq, { method: 'progress', params: { seq } }));
    await until(() => stream.lastServerSeqId === seq); await new Promise(resolve => setTimeout(resolve, 40));
  }
  expect(await defaultDeadline).toMatchObject({ code: 'timeout', mayHaveBeenSent: true });
  expect(await longerDeadline).toMatchObject({ code: 'timeout', mayHaveBeenSent: true });
  expect(value.state).toBe('online'); expect(session.ready).toBe(true);
  for (const method of ['default-deadline', 'longer-deadline', 'cancel-only-me']) expect(upstream.frames.filter(frame => frame.message?.method === method)).toHaveLength(1);
});

it('其他流持续传输和原生保活不能遮蔽 unknown pong 对管理会话的立即失效', async () => {
  const upstream = await server(); const value = relay(upstream.url, { nativePingMs: 30, nativePongTimeoutMs: 150 });
  const stream = value.createStream({ environmentId: 'mac' }); const other = value.createStream({ environmentId: 'peer' });
  const session = RemoteRpcSession.fromRemoteStream(stream); cleanup.push(() => session.close()); const pongs: unknown[] = []; value.on('pong', frame => pongs.push(frame));
  await until(() => value.state === 'online'); const socket = upstream.connections[0]; const initialized = session.initialize();
  await until(() => upstream.frames.some(frame => frame.message?.method === 'initialize'));
  const init = upstream.frames.find(frame => frame.message?.method === 'initialize')!.message;
  send(socket, incoming(stream.streamId, 'mac', 1, { id: init.id, result: {} })); await initialized;
  const pending = session.call('write-once').catch(error => error); await until(() => upstream.frames.some(frame => frame.message?.method === 'write-once'));
  for (let seq = 1; seq <= 3; seq++) { send(socket, incoming(other.streamId, 'peer', seq, { result: seq })); await new Promise(resolve => setTimeout(resolve, 35)); }
  send(socket, { type: 'pong', client_id: 'client', stream_id: stream.streamId, env_id: 'mac', seq_id: 0, status: 'unknown' });
  expect(await pending).toMatchObject({ code: 'protocol', mayHaveBeenSent: true });
  expect(session.closed).toBe(true); expect(stream.closed).toBe(true); expect(value.state).toBe('online'); expect(pongs).toHaveLength(1);
  await expect(session.call('never-send')).rejects.toMatchObject({ code: 'closed', mayHaveBeenSent: false });
  expect(upstream.frames.filter(frame => frame.message?.method === 'write-once')).toHaveLength(1);
  send(socket, incoming(other.streamId, 'peer', 4, { result: 'still-active' })); await until(() => other.lastServerSeqId === 4);
});

it('原生定期 ping 保留归属检查，归属撤销后关闭且不重连', async () => {
  let owned = true; const upstream = await server();
  const value = relay(upstream.url, { nativePingMs: 30, nativePongTimeoutMs: 150, assertOwnership() { if (!owned) throw new Error('ownership revoked'); } });
  await until(() => value.state === 'online'); owned = false; await until(() => value.state === 'closed');
  await new Promise(resolve => setTimeout(resolve, 60)); expect(upstream.connections).toHaveLength(1);
});

it('每流 ping 使用连续 seq，公开 active/unknown pong，不自动重发业务', async () => {
  const upstream = await server(); const value = relay(upstream.url, { streamPingMs: 20 }); const stream = value.createStream({ environmentId: 'mac' });
  const pongs: unknown[] = []; stream.on('pong', pong => pongs.push(pong));
  await until(() => value.state === 'online'); await stream.send({ method: 'initialize' });
  await until(() => upstream.frames.some(frame => frame.type === 'ping'));
  const ping = upstream.frames.find(frame => frame.type === 'ping')!;
  expect(ping).toMatchObject({ client_id: 'client', env_id: 'mac', stream_id: stream.streamId, seq_id: 2, state: 'foreground', skip_history: true });
  for (const [index, status] of ['active', 'unknown'].entries()) send(upstream.connections[0], { ...ping, type: 'pong', status, seq_id: index + 1, cursor: null });
  await until(() => pongs.length === 2); expect(pongs.map((pong: any) => pong.status)).toEqual(['active', 'unknown']);
  expect(upstream.frames.filter(frame => frame.type === 'client_message')).toHaveLength(1);
});

it('没有手机时仍用原生 ping/pong 保持物理连接，死链自动重连，close 停止所有重试', async () => {
  const upstream = await server({ autoPong: false }); const value = relay(upstream.url, { nativePingMs: 15, nativePongTimeoutMs: 15 });
  await until(() => upstream.connections.length >= 2); value.close(); const count = upstream.connections.length;
  await new Promise(resolve => setTimeout(resolve, 80)); expect(upstream.connections).toHaveLength(count); expect(value.state).toBe('closed');
});

it('分块超时重连保留安全 cursor，关闭 relay 清理 partial 且不发送离线内容', async () => {
  const upstream = await server(); const value = relay(upstream.url, { assembly: { timeoutMs: 20 } }); const stream = value.createStream({ environmentId: 'mac' });
  await until(() => value.state === 'online');
  const bytes = Buffer.from('{"result":"incomplete"}');
  send(upstream.connections[0], { type: 'server_message_chunk', client_id: 'client', stream_id: stream.streamId, env_id: 'mac', seq_id: 1, segment_id: 0, segment_count: 2, message_size_bytes: bytes.length, message_chunk_base64: bytes.subarray(0, 5).toString('base64'), cursor: 'unsafe' });
  await until(() => upstream.connections.length === 2 && value.state === 'online'); expect(upstream.headers[1]).toBeUndefined();
  value.close(); await expect(stream.send({ method: 'write-after-close' })).rejects.toMatchObject({ mayHaveBeenSent: false });
  await new Promise(resolve => setTimeout(resolve, 60)); expect(upstream.connections).toHaveLength(2); expect(upstream.frames.filter(frame => frame.type === 'client_message')).toHaveLength(0);
});
