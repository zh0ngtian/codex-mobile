// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createGateway } from '../../server/gateway.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const reference = {
  mode: 'remote', gatewayId: 'gateway',
  account: { accountId: 'account', accountUserId: 'account-user', userId: 'user' },
  target: { environmentId: 'environment', installationId: 'installation' },
};
const remoteQuery = () => new URLSearchParams({ mode: 'remote', target: JSON.stringify(reference), token: 'secret' });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'gateway-routing-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const uploads = join(root, 'uploads'); await mkdir(uploads);
  const decoy = join(root, 'local-only.txt'); await writeFile(decoy, 'LOCAL PRIVATE CONTENT');
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => upstream.once('listening', resolve));
  const connections = vi.fn();
  const messages = vi.fn();
  upstream.on('connection', socket => {
    connections(); socket.on('error', () => {});
    socket.on('message', data => {
      const message = JSON.parse(data.toString()); messages(message);
      socket.send(JSON.stringify({ id: message.id, result: { method: message.method } }));
    });
  });
  cleanups.push(() => new Promise<void>(resolve => {
    for (const socket of upstream.clients) socket.terminate();
    upstream.close(() => resolve());
  }));
  const projects = vi.fn(async () => ['/LOCAL/PRIVATE/PROJECT']);
  const ready = vi.fn(async () => true);
  const gateway = await createGateway({
    host: '127.0.0.1', port: 0, mode: 'external', staticDir: null,
    upstreamUrl: `ws://127.0.0.1:${(upstream.address() as { port: number }).port}`,
    codexHome: root, uploadDir: uploads, accessToken: 'secret',
    readProjectDirectories: projects, appServerReady: ready,
  });
  cleanups.push(() => gateway.close());
  return { base: `http://127.0.0.1:${gateway.port}`, root, decoy, uploads, connections, messages, projects, ready };
}

it.each([
  ['/api/status', 'GET'], ['/api/projects', 'GET'], ['/api/notifications/settings', 'GET'],
  ['/api/notifications/settings', 'POST'], ['/api/uploads/file', 'POST'],
  ['/api/files/preview', 'GET'], ['/api/files/download/local.txt', 'GET'],
  ['/api/files/download/local.txt', 'HEAD'], ['/api/images/preview', 'GET'],
  ['/api/image-generation-error', 'GET'], ['/api/rpc', 'POST'], ['/api/events', 'GET'],
  ['/api/operations', 'GET'], ['/api/follow-ups', 'GET'], ['/api/follow-ups', 'POST'],
  ['/api/threads/title-summary', 'POST'], ['/api/unknown', 'GET'],
])('Remote %s %s 在任何本地消费者执行前明确拒绝', async (path, method) => {
  const f = await setup(); const query = remoteQuery(); query.set('path', f.decoy);
  query.set('sessionId', randomUUID());
  const response = await fetch(`${f.base}${path}?${query}`, {
    method, headers: { Origin: 'http://mobile.local', 'content-type': 'application/json', 'x-codex-file-name': 'remote.txt' },
    ...(['POST', 'PUT'].includes(method) ? { body: JSON.stringify(path === '/api/rpc'
      ? { requestId: randomUUID(), message: { id: 1, method: 'initialize', params: { clientInfo: { name: 'test', version: '1' } } } }
      : { threadId: 'thread', input: 'hello' }) } : {}),
  });
  expect(response.status).toBe(503);
  if (method !== 'HEAD') expect(await response.json()).toEqual({ error: {
    code: 'remote-not-supported', message: '此网关尚未开放远程模式，请使用支持远程模式的网关',
  } });
  expect(response.headers.get('access-control-allow-origin')).toBe('http://mobile.local');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(f.connections).not.toHaveBeenCalled(); expect(f.projects).not.toHaveBeenCalled();
  expect(f.ready).not.toHaveBeenCalled();
  expect(await readdir(f.uploads)).toEqual([]);
  expect(await readFile(f.decoy, 'utf8')).toBe('LOCAL PRIVATE CONTENT');
});

it.each([
  'mode=', 'mode=other', 'mode=local&mode=remote', 'mode=local&mode=local',
  'target=%7B%7D', 'mode=local&target=%7B%7D', 'mode=remote',
  'mode=remote&target=', 'mode=remote&target=null', 'mode=remote&target=%7B%22mode%22%3A%22local%22%7D',
  `mode=remote&target=${encodeURIComponent(JSON.stringify({ ...reference, target: { environmentId: 'environment' } }))}`,
  `mode=remote&target=${encodeURIComponent(JSON.stringify({ ...reference, extra: 'ignored?' }))}`,
  `mode=remote&target=${encodeURIComponent(JSON.stringify(reference))}&target=${encodeURIComponent(JSON.stringify(reference))}`,
])('无效路由 %s 不得默认为本地模式', async query => {
  const f = await setup();
  const response = await fetch(`${f.base}/api/projects?token=secret&${query}`);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { code: 'invalid-reference', message: '连接模式或目标参数无效' } });
  expect(f.projects).not.toHaveBeenCalled(); expect(f.connections).not.toHaveBeenCalled();
});

it.each(['', '&mode=local'])('旧 URL 和显式 Local 继续访问原本机 %s', async query => {
  const f = await setup();
  const response = await fetch(`${f.base}/api/projects?token=secret${query}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ projects: ['/LOCAL/PRIVATE/PROJECT'], projectlessThreadIds: [] });
  expect(f.projects).toHaveBeenCalledTimes(1);
});

it.each(['', '&mode=remote', `&${remoteQuery()}`])('host 如实声明公开 Remote 尚不支持 %s', async query => {
  const f = await setup();
  const response = await fetch(`${f.base}/api/host?token=secret${query}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ appServerReady: true, remote: { version: 1, supported: false } });
  expect(f.connections).not.toHaveBeenCalled();
});

it('路由错误不能越过 token 鉴权，已有 cookie 仍可鉴权', async () => {
  const f = await setup();
  const response = await fetch(`${f.base}/api/projects?mode=other`);
  expect(response.status).toBe(401); expect(await response.text()).toBe('Unauthorized');
  const cookie = await fetch(`${f.base}/api/projects?mode=local`, { headers: { Cookie: 'codex_mobile_token=secret' } });
  expect(cookie.status).toBe(200);
});

async function rejectedWebSocket(url: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const client = new WebSocket(url);
    client.on('error', () => {});
    client.once('open', () => { client.terminate(); reject(new Error('错误升级为本地连接')); });
    client.once('unexpected-response', (_request, response) => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => { client.terminate(); resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }); });
      response.once('error', reject);
    });
  });
}

it.each(['/ws', '/api/realtime'])('%s 的 Remote 升级拒绝且零本地上游连接', async path => {
  const f = await setup();
  const response = await rejectedWebSocket(`${f.base.replace('http:', 'ws:')}${path}?${remoteQuery()}&sessionId=local-session`);
  expect(response.status).toBe(503);
  expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'remote-not-supported' } });
  expect(f.connections).not.toHaveBeenCalled();
});

it.each(['/ws', '/api/realtime'])('%s 同样校验路由且先鉴权', async path => {
  const f = await setup(); const base = f.base.replace('http:', 'ws:');
  expect((await rejectedWebSocket(`${base}${path}?mode=other`)).status).toBe(401);
  const response = await rejectedWebSocket(`${base}${path}?token=secret&mode=other`);
  expect(response.status).toBe(400);
  expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'invalid-reference' } });
  expect(f.connections).not.toHaveBeenCalled();
});

it.each(['', '&mode=local'])('旧 URL 和显式 Local 仍使用原 WebSocket 传输 %s', async query => {
  const f = await setup();
  const client = new WebSocket(`${f.base.replace('http:', 'ws:')}/ws?token=secret${query}`);
  cleanups.push(async () => client.terminate());
  await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
  const message = { id: 42, method: 'model/list' };
  const echoed = new Promise<string>(resolve => client.once('message', data => resolve(data.toString())));
  client.send(JSON.stringify(message));
  expect(JSON.parse(await echoed)).toEqual({ id: message.id, result: { method: message.method } });
  expect(f.connections).toHaveBeenCalledTimes(1);
});

it('Remote 不能借用已有 Local HTTP Session 读取事件或派发 RPC', async () => {
  const f = await setup(); const sessionId = randomUUID();
  const local = new URLSearchParams({ token: 'secret', sessionId });
  const init = await fetch(`${f.base}/api/rpc?${local}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), message: { id: 1, method: 'initialize', params: { clientInfo: { name: 'test', version: '1' } } } }),
  });
  expect(init.status).toBe(200); await init.text();
  const before = f.messages.mock.calls.length;
  const remote = remoteQuery(); remote.set('sessionId', sessionId);
  const events = await fetch(`${f.base}/api/events?${remote}`);
  expect(events.status).toBe(503); await events.text();
  const rpc = await fetch(`${f.base}/api/rpc?${remote}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), message: { id: 2, method: 'turn/start', params: { threadId: 'thread', input: [{ type: 'text', text: 'REMOTE ONLY' }] } } }),
  });
  expect(rpc.status).toBe(503); await rpc.text();
  expect(f.messages.mock.calls).toHaveLength(before);
  expect(f.connections).toHaveBeenCalledTimes(1);
});

it.each(['mode=remote&target=null', 'mode=remote&mode=local'])('host 同样拒绝无效路由 %s', async query => {
  const f = await setup();
  const response = await fetch(`${f.base}/api/host?token=secret&${query}`);
  expect(response.status).toBe(400);
  expect(f.ready).not.toHaveBeenCalled();
});

it('CORS 预检保持原行为且不执行任何目标消费者', async () => {
  const f = await setup();
  const response = await fetch(`${f.base}/api/rpc?${remoteQuery()}`, { method: 'OPTIONS', headers: { Origin: 'http://mobile.local' } });
  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-origin')).toBe('http://mobile.local');
  expect(f.connections).not.toHaveBeenCalled();
});
