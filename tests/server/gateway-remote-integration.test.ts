// @vitest-environment node
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OperationQueue } from '../../server/operation-queue.js';
import { HOSTED_SESSION_ID } from '../../server/http-session.js';
import { rpcSignatureInput } from '../../server/rpc-replay.js';
import { canonical } from '../../server/follow-ups.js';
import { until } from './remote-session-fixture.js';
import WebSocket from 'ws';
import { expect, it, vi } from 'vitest';
import { createGateway } from '../../server/gateway.js';
import * as projectReader from '../../server/codex-projects.js';
import { gatewayRemote } from './fixtures/gateway-remote.js';

it('另一台设备正在握手时，公开项目目录和会话初始化都返回成功', async () => {
  const f = await gatewayRemote();
  const other = { environmentId: 'remote-env', installationId: 'remote-install' };
  await f.runtime.acceptTarget(other);
  const reference = (await f.resolver.directory()).data.targets.find(target => !target.isGatewayHost)!.reference;
  const gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external', upstreamUrl: 'ws://127.0.0.1:1',
    staticDir: null, codexHome: f.gatewayHome, targetResolver: f.resolver });
  const endpoint = new URL(`http://127.0.0.1:${gateway.port}/api/projects`);
  endpoint.searchParams.set('mode', 'remote');
  endpoint.searchParams.set('target', JSON.stringify(f.reference));
  await writeFile(join(f.targetHome, '.codex-global-state.json'), JSON.stringify({ 'local-projects': { p: { id: 'p', rootPaths: [f.targetHome] } } }));
  let releaseProjects!: () => void; let releaseHandshake!: () => void;
  const projectsGate = new Promise<void>(resolve => { releaseProjects = resolve; });
  const handshakeGate = new Promise<void>(resolve => { releaseHandshake = resolve; });
  let reading = false; let opening = false;
  const reader = projectReader.readCodexProjectState;
  vi.spyOn(projectReader, 'readCodexProjectState').mockImplementation(async (...args) => {
    const state = await reader(...args);
    reading = true;
    await projectsGate;
    return state;
  });
  const controller = (f.runtime as any).bundle.controller;
  const original = controller.createManagementSession.bind(controller);
  vi.spyOn(controller, 'createManagementSession').mockImplementation(async (...args: any[]) => {
    if (args[0].environmentId === other.environmentId) { opening = true; await handshakeGate; }
    return original(...args);
  });
  let session: ReturnType<typeof f.runtime.createManagementSession> | undefined;
  const response = fetch(endpoint);
  void response.catch(() => undefined);
  try {
    await until(() => reading);
    const target = await f.resolver.resolve(reference);
    session = target.createManagementSession();
    void session.catch(() => undefined);
    await until(() => opening);
    const rpc = new URL(endpoint);
    rpc.pathname = '/api/rpc';
    rpc.searchParams.set('sessionId', randomUUID());
    const initialized = fetch(rpc, { method: 'POST', body: JSON.stringify({ requestId: randomUUID(),
      message: { id: 1, method: 'initialize', params: { clientInfo: { name: 'test', version: '1' } } } }) });
    releaseProjects();
    const [returned, connected] = await Promise.all([response, initialized]);
    expect([returned.status, connected.status]).toEqual([200, 200]);
    expect(await returned.json()).toMatchObject({ projects: [f.targetHome] });
    expect(await connected.json()).toMatchObject({ result: { codexHome: f.targetHome } });
  } finally {
    releaseProjects(); releaseHandshake();
    await (await session?.catch(() => undefined))?.settled();
    await gateway.close();
  }
}, 15000);

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
    const proof = vi.spyOn((f.runtime as any).bundle.provider, 'verifyBinding');
    try {
      const snapshotUrl = url('/api/read-snapshot'); snapshotUrl.searchParams.set('sessionId', session);
      const snapshot = await fetch(snapshotUrl, { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), message: { id: 5, method: 'thread/read', params: { threadId: 'thread' } } }) });
      expect(snapshot.status).toBe(200);
      expect(await snapshot.json()).toMatchObject({ message: { result: { ok: true } } });
      expect(proof).toHaveBeenCalledTimes(4);
    } finally { proof.mockRestore(); }
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
    expect([201, 202]).toContain(response.status);
    let upload = await response.json() as any;
    const untilUpload = Date.now() + 15000;
    while (upload.accepted === true && Date.now() < untilUpload) {
      // 耐久 ACK 可先于物理上传完成；仅查询原 UUID，绝不重新 POST。
      const query = url('/api/uploads/operations'); query.searchParams.set('requestId', uploadId);
      const completed = await fetch(query); expect([201, 202]).toContain(completed.status);
      upload = await completed.json();
      if (upload.accepted === true) await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(upload.path).toContain(f.targetHome);
    const download = url('/api/files/download/sample.txt'); download.searchParams.set('path', upload.path);
    expect(await (await fetch(download)).text()).toBe('gateway upload bytes');
    expect(f.connections).toHaveLength(1);
    expect(f.frames.filter(message => message.method === 'thread/read')).toHaveLength(2);
    f.setManaged({ accountUserId: 'different-user' });
    expect((await fetch(download)).status).toBe(503);
  } finally { socket?.terminate(); await gateway.close(); }
}, 30000);

it('普通操作离线直接失败，只有排队消息跨手机共享、CAS编辑并在重启恢复后发送', async () => {
  const f = await gatewayRemote(message => message.method === 'turn/start' ? { turn: { id: 'turn', status: 'inProgress' } } : undefined);
  const targets = [{ env_id: 'local-env', installation_id: 'local-install', kind: 'single', online: false, busy: false }];
  f.setTargets(targets); await f.runtime.refreshTargets();
  const options = { host: '127.0.0.1', port: 0, mode: 'external' as const, upstreamUrl: 'ws://127.0.0.1:1', staticDir: null,
    codexHome: f.gatewayHome, targetResolver: f.resolver, accessToken: 'token' };
  let gateway = await createGateway(options); let origin = `http://127.0.0.1:${gateway.port}`;
  const url = (path: string, remote = true) => { const endpoint = new URL(path, origin); endpoint.searchParams.set('token', 'token'); if (remote) { endpoint.searchParams.set('mode', 'remote'); endpoint.searchParams.set('target', JSON.stringify(f.reference)); } return endpoint; };
  const sessionId = randomUUID();
  const post = async (path: string, body: unknown) => { const endpoint = url(path); endpoint.searchParams.set('sessionId', sessionId); const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify(body) }); return { status: response.status, body: await response.json() as any }; };
  const input = { action: 'enqueue', id: randomUUID(), threadId: 'thread', inputText: 'original', text: 'original', attachmentCount: 0, extraInput: [], settings: {} };
  try {
    expect((await post('/api/rpc', { requestId: randomUUID(), message: { id: 1, method: 'initialize', params: {} } })).status).toBe(503);
    for (const method of ['turn/start', 'thread/start']) expect((await post('/api/rpc', { requestId: randomUUID(), message: { id: 2, method, params: { threadId: 'thread', input: [] } } })).status).toBe(503);
    expect((await (await fetch(url('/api/queue'))).json() as any).items).toEqual([]);
    expect((await post('/api/follow-ups', input)).status).toBe(200);
    const local = await (await fetch(url('/api/follow-ups', false))).json() as any;
    expect(local.items).toMatchObject([{ id: input.id, state: 'queued', text: 'original' }]);
    expect(JSON.stringify(local)).not.toMatch(/codexHome|authorizationKey|generation/);
    expect((await post('/api/follow-ups', { action: 'edit', id: input.id, revision: 1, inputText: 'edited by another phone', text: 'edited by another phone', mentions: [] })).status).toBe(200);
    expect((await post('/api/follow-ups', { action: 'cancel', id: input.id, revision: 1 })).status).toBe(409);
    const query = url('/api/follow-ups'); query.searchParams.set('requestId', input.id);
    expect(await (await fetch(query)).json()).toMatchObject({ accepted: true, operation: { id: input.id } });
    await gateway.close(); f.setTargets(targets.map(value => ({ ...value, online: true }))); await f.runtime.refreshTargets();
    gateway = await createGateway(options); origin = `http://127.0.0.1:${gateway.port}`;
    await until(() => f.frames.some(message => message.method === 'turn/start'), 15000);
    const sent = f.frames.filter(message => message.method === 'turn/start'); expect(sent).toHaveLength(1);
    expect(sent[0].params).toMatchObject({ clientUserMessageId: input.id, input: [{ text: 'edited by another phone' }] });
    expect(f.frames.filter(message => message.method === 'thread/start')).toHaveLength(0); expect(f.connections).toHaveLength(1);
    await gateway.close(); gateway = await createGateway(options); origin = `http://127.0.0.1:${gateway.port}`;
    expect((await post('/api/follow-ups', input)).status).toBe(200); // 原接收指纹在编辑和终态后仍幂等。
    expect(f.frames.filter(message => message.method === 'turn/start')).toHaveLength(1);
  } finally { await gateway.close(); }
}, 30000);

it('Remote离线标题和附件不进入普通队列，也不保留待上传文件', async () => {
  const f = await gatewayRemote(); f.setTargets([{ env_id: 'local-env', installation_id: 'local-install', kind: 'single', online: false, busy: false }]); await f.runtime.refreshTargets();
  const gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external', upstreamUrl: 'ws://127.0.0.1:1', staticDir: null, codexHome: f.gatewayHome, targetResolver: f.resolver });
  const url = (path: string) => { const endpoint = new URL(path, `http://127.0.0.1:${gateway.port}`); endpoint.searchParams.set('mode', 'remote'); endpoint.searchParams.set('target', JSON.stringify(f.reference)); return endpoint; };
  try {
    const id = randomUUID(); expect((await fetch(url('/api/threads/title-summary'), { method: 'POST', headers: { 'x-codex-operation-id': id }, body: JSON.stringify({ threadId: 'thread' }) })).status).toBe(503);
    const uploaded = await fetch(url('/api/uploads/file'), { method: 'POST', headers: { 'x-codex-upload-id': randomUUID(), 'x-codex-file-name': 'file.txt' }, body: 'offline bytes' }); expect(uploaded.status).toBe(503);
    await expect(readFile(join(f.gatewayHome, 'codex-mobile-operations', 'operations.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.frames.filter(message => message.method === 'thread/start')).toHaveLength(0);
  } finally { await gateway.close(); }
}, 15000);

it('一次迁移保留追问终态和原UUID，缺WAL的已领取项不重发，旧普通操作保持冻结', async () => {
  const f = await gatewayRemote(); const context = await f.resolver.operationContext(f.reference);
  const directory = join(f.gatewayHome, 'codex-mobile-operations');
  const queue = new OperationQueue({ directory, gatewayId: context.gatewayId, authorize: (value, action) => f.resolver.authorizeOperation(value, action) });
  const record = (threadId: string) => {
    const payload = { threadId, inputText: 'saved body', text: 'saved body', attachmentCount: 0, extraInput: [], settings: {} };
    return { ...payload, id: randomUUID(), operationId: randomUUID(), fingerprint: createHash('sha256').update(canonical(payload)).digest('hex'), revision: 1, state: 'queued' as const };
  };
  const unknown = record('unknown'); const sent = record('sent');
  await queue.enqueueFollowUp(context, unknown); const claimed = await queue.claimNext(context.businessKey); expect(claimed!.id).toBe(unknown.id);
  await queue.enqueueFollowUp(context, sent); await queue.changeFollowUp(sent.id, 1, 'transition', item => { item.state = 'succeeded'; });
  const ordinary = randomUUID(); const ordinaryMessage = { id: 17, method: 'turn/start', params: { threadId: 'ordinary', input: [{ type: 'text', text: 'must stay paused' }] } };
  await queue.submit({ id: ordinary, context, conversationId: 'ordinary',
    body: { kind: 'rpc-v1', sessionId: HOSTED_SESSION_ID, requestId: ordinary, message: ordinaryMessage }, settings: { source: 'public-rpc-v1' }, attachmentRefs: [],
    rpcReceipt: { sessionId: HOSTED_SESSION_ID, requestId: ordinary, method: 'turn/start', signature: createHash('sha256').update(rpcSignatureInput(ordinaryMessage)).digest('hex') } });
  const original = await readFile(join(directory, 'operations.json'), 'utf8');
  await mkdir(join(f.gatewayHome, 'codex-mobile-follow-ups'));
  await writeFile(join(f.gatewayHome, 'codex-mobile-follow-ups', 'queue.json'), JSON.stringify({ version: 1, records: [sent] }));
  const options = { host: '127.0.0.1', port: 0, mode: 'external' as const, upstreamUrl: 'ws://127.0.0.1:1', staticDir: null, codexHome: f.gatewayHome, targetResolver: f.resolver };
  let gateway = await createGateway(options);
  const url = () => { const endpoint = new URL(`http://127.0.0.1:${gateway.port}/api/follow-ups`); endpoint.searchParams.set('mode', 'remote'); endpoint.searchParams.set('target', JSON.stringify(f.reference)); return endpoint; };
  try {
    let state: any;
    for (let i = 0; i < 100; i++) { state = await (await fetch(url())).json(); if (state.items?.[0]?.state === 'uncertain') break; await new Promise(resolve => setTimeout(resolve, 20)); }
    expect(state.items).toMatchObject([{ id: unknown.id, state: 'uncertain' }]);
    const historyUrl = url(); historyUrl.pathname = '/api/queue';
    expect((await (await fetch(historyUrl)).json() as any).items).toMatchObject([{ id: ordinary, legacyPaused: true, state: 'queued' }]);
    expect(f.frames.filter(message => message.method === 'turn/start')).toHaveLength(0);
    expect(await readFile(join(directory, 'operations.json'), 'utf8')).toBe(original);
    await gateway.close(); gateway = await createGateway(options);
    expect((await (await fetch(url())).json() as any).items).toHaveLength(1);
    const duplicate = await fetch(url(), { method: 'POST', body: JSON.stringify({ ...sent, action: 'enqueue' }) }); expect(duplicate.status).toBe(200);
    expect(f.frames.filter(message => message.method === 'turn/start')).toHaveLength(0);
    expect(await readFile(join(directory, 'operations.json'), 'utf8')).toBe(original);
  } finally { await gateway.close(); }
}, 15000);
