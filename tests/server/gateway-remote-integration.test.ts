// @vitest-environment node
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { expect, it } from 'vitest';
import { createGateway } from '../../server/gateway.js';
import { gatewayRemote } from './fixtures/gateway-remote.js';

it('公开网关目录、HTTP、WS 与附件均沿唯一 Runtime，网关本机在 Remote 模式也不使用 Local', async () => {
  const f = await gatewayRemote();
  const gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external', upstreamUrl: 'ws://127.0.0.1:1',
    staticDir: null, codexHome: f.gatewayHome, targetResolver: f.resolver, accessToken: 'test-token' });
  const origin = `http://127.0.0.1:${gateway.port}`;
  const url = (path: string) => {
    const url = new URL(path, origin); url.searchParams.set('token', 'test-token'); url.searchParams.set('mode', 'remote'); url.searchParams.set('target', JSON.stringify(f.reference)); return url;
  };
  let socket: WebSocket | undefined;
  try {
    const host = await (await fetch(url('/api/host'))).json() as any;
    expect(host.remote).toMatchObject({ version: 1, supported: true, authorized: true, paired: true });
    expect(host.remote.targets[0].reference.mode).toBe('remote');
    const session = randomUUID();
    const rpc = async (message: unknown) => {
      const input = url('/api/rpc'); input.searchParams.set('sessionId', session);
      const response = await fetch(input, { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), message }) });
      return { status: response.status, body: await response.json() as any };
    };
    expect((await rpc({ id: 1, method: 'initialize', params: { clientInfo: { name: 'test', version: '1' } } })).body.result.codexHome).toBe(f.targetHome);
    await rpc({ method: 'initialized' });
    expect((await rpc({ id: 2, method: 'thread/read', params: { threadId: 'thread' } })).body).toMatchObject({ result: { ok: true } });
    const wsUrl = url('/ws'); wsUrl.protocol = 'ws:'; socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject); });
    const request = (message: unknown) => new Promise<any>((resolve, reject) => {
      socket!.once('message', data => resolve(JSON.parse(data.toString()))); socket!.once('error', reject); socket!.send(JSON.stringify(message));
    });
    expect((await request({ id: 3, method: 'initialize', params: { clientInfo: { name: 'stream-test', version: '1' } } })).result.codexHome).toBe(f.targetHome);
    socket.send(JSON.stringify({ method: 'initialized' }));
    expect(await request({ id: 4, method: 'thread/read', params: { threadId: 'thread' } })).toMatchObject({ id: 4, result: { ok: true } });
    const uploadId = randomUUID(); const response = await fetch(url('/api/uploads/file'), { method: 'POST',
      headers: { 'x-codex-upload-id': uploadId, 'x-codex-file-name': 'sample.txt', 'content-type': 'text/plain' }, body: 'gateway upload bytes' });
    expect(response.status).toBe(201); const upload = await response.json() as any; expect(upload.path).toContain(f.targetHome);
    const download = url('/api/files/download/sample.txt'); download.searchParams.set('path', upload.path);
    expect(await (await fetch(download)).text()).toBe('gateway upload bytes');
    expect(f.connections).toHaveLength(1);
    expect(f.frames.filter(message => message.method === 'thread/read')).toHaveLength(2);
    f.setManaged({ accountUserId: 'different-user' });
    expect((await fetch(download)).status).toBe(503);
  } finally { socket?.terminate(); await gateway.close(); }
}, 30000);

it('上游离线仍耐久受理，多手机共享原队列和 CAS；网关重建后仅发送一次编辑后的正文', async () => {
  const f = await gatewayRemote(message => message.method === 'turn/start' ? { turn: { id: 'turn', status: 'inProgress' } } : message.method === 'thread/start' ? { thread: { id: 'created-thread', status: 'idle' } } : undefined);
  const targets = [{ env_id: 'local-env', installation_id: 'local-install', kind: 'single', online: false, busy: false }];
  f.setTargets(targets); await f.runtime.refreshTargets();
  const options = { host: '127.0.0.1', port: 0, mode: 'external' as const, upstreamUrl: 'ws://127.0.0.1:1', staticDir: null,
    codexHome: f.gatewayHome, targetResolver: f.resolver, accessToken: 'token' };
  let gateway = await createGateway(options); let origin = `http://127.0.0.1:${gateway.port}`;
  const url = (path: string) => { const url = new URL(path, origin); url.searchParams.set('token', 'token'); url.searchParams.set('mode', 'remote'); url.searchParams.set('target', JSON.stringify(f.reference)); return url; };
  const sessionId = randomUUID();
  const post = async (path: string, body: unknown) => { const endpoint = url(path); endpoint.searchParams.set('sessionId', sessionId); const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify(body) }); return { status: response.status, body: await response.json() as any }; };
  try {
    expect((await post('/api/rpc', { requestId: randomUUID(), message: { id: 1, method: 'initialize', params: { clientInfo: { name: 'test', version: '1' } } } })).body).toMatchObject({ result: { gateway: { upstreamReady: false, acceptingOffline: true } } });
    await post('/api/rpc', { requestId: randomUUID(), message: { method: 'initialized' } });
    const id = randomUUID(); const queued = await post('/api/rpc', { requestId: id, message: { id: 2, method: 'turn/start', params: { threadId: 'thread', input: [{ type: 'text', text: 'original' }] } } });
    expect(queued.status).toBe(202); expect(queued.body.accepted).toBe(true);
    const shared = await (await fetch(url('/api/queue'))).json() as any; const entry = shared.items.find((row: any) => row.id === id);
    expect(entry).toMatchObject({ threadId: 'thread', params: { input: [{ text: 'original' }] } });
    expect(JSON.stringify(shared)).not.toContain('codexHome'); expect(JSON.stringify(shared)).not.toContain('authorizationKey');
    expect((await post('/api/queue', { action: 'edit', id, revision: entry.revision, inputText: 'edited by another phone' })).status).toBe(200);
    expect((await post('/api/rpc', { requestId: id, message: { id: 2, method: 'turn/start', params: { threadId: 'thread', input: [{ type: 'text', text: 'original' }] } } })).status).toBe(202);
    expect((await post('/api/rpc', { requestId: id, message: { id: 2, method: 'turn/start', params: { threadId: 'thread', input: [{ type: 'text', text: 'unrelated replacement' }] } } })).status).toBe(409);
    expect((await post('/api/queue', { action: 'cancel', id, revision: entry.revision })).status).toBe(409);
    expect(f.frames.filter(message => message.method === 'turn/start')).toHaveLength(0);
    const followId = randomUUID();
    expect((await post('/api/follow-ups', { action: 'enqueue', id: followId, threadId: 'thread-follow', inputText: 'follow body', text: 'follow body', attachmentCount: 0, extraInput: [], settings: {} })).status).toBe(200);
    const queryFollow = url('/api/follow-ups'); queryFollow.searchParams.set('requestId', followId);
    expect(await (await fetch(queryFollow)).json()).toMatchObject({ accepted: true, operation: { id: followId, state: 'queued' } });
    const creationId = randomUUID(); expect((await post('/api/rpc', { requestId: creationId, message: { id: 3, method: 'thread/start', params: { cwd: '/target/project' } } })).status).toBe(202);
    expect((await (await fetch(url('/api/queue'))).json() as any).items.find((row: any) => row.id === creationId)).toMatchObject({ method: 'thread/start', threadId: `pending:${creationId}`, state: 'queued' });
    await gateway.close();
    f.setTargets(targets.map(target => ({ ...target, online: true }))); await f.runtime.refreshTargets();
    gateway = await createGateway(options); origin = `http://127.0.0.1:${gateway.port}`;
    const until = Date.now() + 15000; let result: any;
    do {
      const query = url('/api/operations'); query.searchParams.set('sessionId', sessionId); query.searchParams.set('requestId', id);
      result = await (await fetch(query)).json(); if (result.status === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < until);
    expect(result).toMatchObject({ status: 'completed', message: { result: { turn: { id: 'turn' } } } });
    const sent = f.frames.filter(message => message.method === 'turn/start'); expect(sent).toHaveLength(1);
    expect(sent[0].params.input[0].text).toBe('edited by another phone'); expect(f.connections).toHaveLength(1);
    const untilCreation = Date.now() + 10000; let creation: any;
    do { creation = (await (await fetch(url('/api/queue'))).json() as any).items.find((row: any) => row.id === creationId); if (creation?.state === 'succeeded') break; await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < untilCreation);
    expect(creation).toMatchObject({ threadId: 'created-thread', pendingId: `pending:${creationId}`, state: 'succeeded' });
    expect(f.frames.filter(message => message.method === 'thread/start')).toHaveLength(1);
  } finally { await gateway.close(); }
}, 30000);

it('Remote 标题总结离线时沿原 UUID 受理和查询，不触达 Local 或另建 Relay', async () => {
  const f = await gatewayRemote(); f.setTargets([{ env_id: 'local-env', installation_id: 'local-install', kind: 'single', online: false, busy: false }]); await f.runtime.refreshTargets();
  const gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external', upstreamUrl: 'ws://127.0.0.1:1', staticDir: null, codexHome: f.gatewayHome, targetResolver: f.resolver });
  const endpoint = new URL(`http://127.0.0.1:${gateway.port}/api/threads/title-summary`); endpoint.searchParams.set('mode', 'remote'); endpoint.searchParams.set('target', JSON.stringify(f.reference));
  const id = randomUUID();
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'x-codex-operation-id': id }, body: JSON.stringify({ threadId: 'thread' }) }); expect(response.status).toBe(202);
    endpoint.searchParams.set('requestId', id); endpoint.searchParams.set('threadId', 'thread');
    const queried = await fetch(endpoint); expect(queried.status).toBe(202); expect(await queried.json()).toMatchObject({ operation: { id, state: 'queued' } });
    expect(f.frames.filter(message => message.method === 'thread/start')).toHaveLength(0); expect(f.connections).toHaveLength(1);
  } finally { await gateway.close(); }
}, 15000);
