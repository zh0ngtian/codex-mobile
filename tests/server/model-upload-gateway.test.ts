import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket, { WebSocketServer } from 'ws';
import { ModelUploadMeter } from '../../server/model-upload-meter.js';
import { createGateway } from '../../server/gateway.js';
import { publishDesktopModelUsage } from '../../server/model-upload-ipc.js';
import { desktopMeterSocketPath, externalDesktopModelUsage } from '../../server/desktop-model-upload.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

it('external 网关从同来源桌面 socket 读取实测值，远端 external 不读取本机统计', async () => {
  const root = await mkdtemp('/tmp/upload-ext-'); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const upstreamUrl = 'ws://127.0.0.1:14550/rpc';
  const meter = new ModelUploadMeter();
  const publisher = await publishDesktopModelUsage({ socketPath: desktopMeterSocketPath(root), upstreamUrl, meter });
  cleanup.push(() => publisher.close());
  expect(externalDesktopModelUsage('ws://other-host:14550/rpc', root)).toBeUndefined();
  const source = externalDesktopModelUsage(upstreamUrl, root)!; cleanup.push(() => source.close());
  const gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external', upstreamUrl, staticDir: null, codexHome: root, uploadMeter: source });
  cleanup.push(() => gateway.close());
  const url = `http://127.0.0.1:${gateway.port}/api/rpc?sessionId=${randomUUID()}`;
  const read = async () => (await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), message: { id: 1, method: 'mobile/uploadUsage/read', params: { threadId: 'desktop-thread' } } }) })).json() as any).result.usage;
  expect(await read()).toBeNull();
  meter.begin({ threadId: 'desktop-thread', turnId: 'desktop-turn' })(321);
  await expect.poll(async () => (await read())?.turnBytes).toBe(321);
  await publisher.close();
  await expect.poll(async () => read()).toBeNull();
});

it('HTTP 与 WebSocket 均可读取、实时接收及恢复统计，不读取或 resume 历史', async () => {
  const root = await mkdtemp(join(tmpdir(), 'upload-gateway-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const server = createServer(); const wss = new WebSocketServer({ server }); const requests: string[] = [];
  wss.on('connection', socket => socket.on('message', raw => {
    const message = JSON.parse(raw.toString()); requests.push(message.method);
    if (message.id != null) socket.send(JSON.stringify({ id: message.id, result: {} }));
  }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanup.push(async () => { for (const socket of wss.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const meter = new ModelUploadMeter();
  const gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external',
    upstreamUrl: `ws://127.0.0.1:${(server.address() as any).port}`, staticDir: null, codexHome: root, accessToken: 'secret', uploadMeter: meter });
  cleanup.push(() => gateway.close());
  const session = randomUUID(); const url = `http://127.0.0.1:${gateway.port}/api/`;
  const rpc = async (message: unknown) => (await fetch(url + `rpc?token=secret&sessionId=${session}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), message }) })).json() as Promise<any>;
  expect((await rpc({ id: 1, method: 'mobile/uploadUsage/read', params: { threadId: 'a' } })).result.usage).toBeNull();
  await rpc({ id: 10, method: 'initialize', params: { clientInfo: { name: 'http-test', version: '1' } } });
  const client = new WebSocket(`ws://127.0.0.1:${gateway.port}/ws?token=secret`); await once(client, 'open');
  const call = async (id: number, method: string, params: unknown) => {
    const response = new Promise<any>(resolve => { const listener = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.id === id) { client.off('message', listener); resolve(m); } }; client.on('message', listener); });
    client.send(JSON.stringify({ id, method, params })); return response;
  };
  await call(2, 'initialize', { clientInfo: { name: 'test', version: '1' } });
  const event = new Promise<any>(resolve => { const listener = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.method === 'mobile/uploadUsage/updated') { client.off('message', listener); resolve(m); } }; client.on('message', listener); });
  meter.begin({ threadId: 'a', turnId: 't' })(123);
  expect((await event).params).toMatchObject({ threadId: 'a', usage: { lastRequestBytes: 123, turnBytes: 123 } });
  expect((await call(3, 'mobile/uploadUsage/read', { threadId: 'a' })).result.usage.turnBytes).toBe(123);
  const events: any = await (await fetch(url + `events?token=secret&sessionId=${session}&after=0`)).json();
  expect(events.messages.some((entry: any) => entry.method === 'mobile/uploadUsage/updated')).toBe(true);
  expect((await rpc({ id: 4, method: 'mobile/uploadUsage/read', params: { threadId: 'a' } })).result.usage.turnBytes).toBe(123);
  expect((await rpc({ id: 5, method: 'mobile/uploadUsage/read', params: { threadId: 'b' } })).result.usage).toBeNull();
  expect(requests).not.toContain('thread/resume'); expect(requests).not.toContain('mobile/uploadUsage/read');
  client.terminate();
});

it('真实桌面IPC失效经HTTP轮询、WS与只读统一返回null，业务连接继续存活', async () => {
  const root = await mkdtemp('/tmp/upload-live-'); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const server = createServer(); const wss = new WebSocketServer({ server });
  wss.on('connection', socket => socket.on('message', raw => { const message = JSON.parse(raw.toString()); if (message.id != null) socket.send(JSON.stringify({ id: message.id, result: { alive: true } })); }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanup.push(async () => { for (const socket of wss.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const upstreamUrl = `ws://127.0.0.1:${(server.address() as any).port}`;
  const meter = new ModelUploadMeter(); meter.begin({ threadId: 'a', turnId: 'turn-a' })(42); meter.begin({ threadId: 'b', turnId: 'turn-b' })(84);
  const publisher = await publishDesktopModelUsage({ socketPath: desktopMeterSocketPath(root), upstreamUrl, meter }); cleanup.push(() => publisher.close());
  const source = externalDesktopModelUsage(upstreamUrl, root)!; cleanup.push(() => source.close());
  const gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external', upstreamUrl, staticDir: null, codexHome: root, uploadMeter: source }); cleanup.push(() => gateway.close());
  const session = randomUUID(); const url = `http://127.0.0.1:${gateway.port}/api/`;
  const rpc = async (message: unknown) => (await fetch(url + `rpc?sessionId=${session}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), message }) })).json() as Promise<any>;
  const read = async (threadId: string) => (await rpc({ id: 1, method: 'mobile/uploadUsage/read', params: { threadId } })).result.usage;
  await rpc({ id: 2, method: 'initialize', params: { clientInfo: { name: 'fixture', version: '1' } } });
  const client = new WebSocket(`ws://127.0.0.1:${gateway.port}/ws`); await once(client, 'open'); cleanup.push(async () => client.terminate());
  const received: any[] = []; client.on('message', raw => received.push(JSON.parse(raw.toString())));
  const call = async (id: number, method: string, params = {}) => {
    client.send(JSON.stringify({ id, method, params })); await expect.poll(() => received.find(message => message.id === id)).toBeDefined(); return received.find(message => message.id === id);
  };
  await call(3, 'initialize', { clientInfo: { name: 'fixture-ws', version: '1' } });
  await expect.poll(async () => (await read('a'))?.turnBytes).toBe(42);
  await publisher.close();
  await expect.poll(() => received.filter(message => message.method === 'mobile/uploadUsage/updated' && message.params.usage === null).map(message => message.params.threadId).sort()).toEqual(['a', 'b']);
  expect(await read('a')).toBeNull(); expect((await call(4, 'mobile/uploadUsage/read', { threadId: 'b' })).result.usage).toBeNull();
  const events = await (await fetch(url + `events?sessionId=${session}&after=0`)).json() as any;
  const invalidations = events.messages.filter((message: any) => message.method === 'mobile/uploadUsage/updated' && message.params.usage === null);
  expect(invalidations.map((message: any) => message.params).sort((a: any, b: any) => a.threadId.localeCompare(b.threadId))).toEqual([{ threadId: 'a', usage: null }, { threadId: 'b', usage: null }]);
  expect(JSON.stringify(invalidations)).not.toContain(root); expect(JSON.stringify(invalidations)).not.toContain('upstreamUrl');
  expect((await call(42, 'test/alive')).result).toEqual({ alive: true }); expect(client.readyState).toBe(WebSocket.OPEN);
});
