// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { RemoteRelay } from '../../server/remote/relay.js';
import { withRemoteOperation } from '../../server/remote/operation-guard.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function until(check: () => boolean) { await expect.poll(check, { timeout: 2500, interval: 5 }).toBe(true); }

it.each(['首帧前', '首帧后'] as const)('统计读取live guard在真实Relay%s同步失效时停止后续业务物理分片，控制关闭与共享流仍可用', async phase => {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise<void>(resolve => wss.once('listening', resolve));
  const frames: Record<string, unknown>[] = [];
  wss.on('connection', socket => { socket.on('error', () => {}); socket.on('message', raw => frames.push(JSON.parse(raw.toString()))); socket.send(JSON.stringify({ type: 'device_key_challenge', nonce: 'test' })); });
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of wss.clients) socket.terminate(); wss.close(() => resolve()); }));
  const relay = new RemoteRelay({ clientId: 'client', authProvider: { async prepareConnection() { return { url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`, headers: {}, async signChallenge() { return { signature: 'test' }; } }; } }, streamPingMs: 10000, nativePingMs: 10000 });
  cleanup.push(() => relay.close()); const stream = relay.createStream({ environmentId: 'environment' }); await until(() => relay.state === 'online');
  const state = relay as unknown as { socket: WebSocket; writes: Set<unknown>; queuedBytes: number };
  const actual = state.socket.send.bind(state.socket); let live = true; let physical = 0;
  const send = vi.spyOn(state.socket, 'send').mockImplementation((...args: Parameters<WebSocket['send']>) => { physical++; const result = actual(...args); if (phase === '首帧后') live = false; return result; });
  const addActual = state.writes.add.bind(state.writes); const add = vi.spyOn(state.writes, 'add').mockImplementation(value => { const result = addActual(value); if (phase === '首帧前') live = false; return result; });
  const outcome = await withRemoteOperation(() => { if (!live) throw new Error('cancelled'); }, () => stream.send({ method: 'command/exec', params: 'x'.repeat(300000) })).catch(error => error);
  expect(physical).toBe(phase === '首帧后' ? 1 : 0); expect(outcome).toMatchObject({ mayHaveBeenSent: phase === '首帧后' });
  expect(stream.lastSentSeqId).toBe(phase === '首帧后' ? 1 : 0); expect([state.writes.size, state.queuedBytes]).toEqual([0, 0]);
  add.mockRestore(); send.mockRestore();
  await withRemoteOperation(() => { if (!live) throw new Error('already ended'); }, async () => {}).catch(() => stream.close());
  await until(() => frames.some(frame => frame.type === 'client_closed'));
  const shared = relay.createStream({ environmentId: 'other' }); await shared.send({ method: 'still/alive' });
  await until(() => frames.some(frame => (frame.message as { method?: string })?.method === 'still/alive')); expect(relay.state).toBe('online');
});
