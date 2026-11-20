// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { OperationScheduler } from '../../server/operation-scheduler.js';
import { GatewayRemoteServices } from '../../server/gateway-remote-services.js';
import { gatewayRemote } from './fixtures/gateway-remote.js';

it('唯一调度器并发打开同目标只装配一次真实消费者并派发到原 Remote', async () => {
  const f = await gatewayRemote(); let services: GatewayRemoteServices | undefined; let creations = 0;
  const scheduler = new OperationScheduler({ directory: join(f.gatewayHome, 'ledger'), gatewayId: 'gateway',
    gatewayCodexHome: f.gatewayHome, resolver: f.resolver, upstreamUrl: 'ws://127.0.0.1:1',
    remoteConsumers: async (_context, target, call) => { creations++; services = await GatewayRemoteServices.create(target, f.gatewayHome, call.signal); return { projections: services.projections, sidechatReplay: services.sidechatReplay }; } });
  try {
    const context = await f.resolver.operationContext(f.reference); const call = { deadline: performance.now() + 10000 };
    const [a, b] = await Promise.all([scheduler.sessionsForTarget(context, call), scheduler.sessionsForTarget(context, call)]);
    expect(a).toBe(b); expect(creations).toBe(1);
    const sessionId = randomUUID();
    const initialized = await scheduler.protocol({ context, sessionId, requestId: randomUUID(), message: { id: 1, method: 'initialize', params: { clientInfo: { name: 'test', version: '1' } } } });
    expect(initialized.outcome).toBe('response');
    await scheduler.protocol({ context, sessionId, requestId: randomUUID(), message: { method: 'initialized' } });
    const id = randomUUID(); await scheduler.submit({ id, context, conversationId: 'thread', sessionId, requestId: id,
      message: { id: 2, method: 'thread/read', params: { threadId: 'thread' } }, settings: {}, attachmentRefs: [] });
    await scheduler.runOnce();
    expect(await scheduler.result(id)).toMatchObject({ outcome: 'response', message: { id: 2, result: { ok: true } } });
    expect(f.connections).toHaveLength(1);
    expect(f.frames.filter(message => message.method === 'thread/read')).toHaveLength(1);
  } finally { await scheduler.close(); await services?.close(); }
}, 15000);

it('后台会话快照合并为一个队列项，同一真实 hosted epoch 只恢复一次订阅', async () => {
  const f = await gatewayRemote(message => message.method === 'thread/turns/list' ? { data: [] } : ['thread/read', 'thread/resume'].includes(message.method) ? { thread: { id: 'thread', status: 'idle' } } : undefined);
  let services: GatewayRemoteServices | undefined;
  const scheduler = new OperationScheduler({ directory: join(f.gatewayHome, 'ledger'), gatewayId: 'gateway', gatewayCodexHome: f.gatewayHome,
    resolver: f.resolver, upstreamUrl: 'ws://127.0.0.1:1', remoteConsumers: async (_context, target, call) => {
      services ??= await GatewayRemoteServices.create(target, f.gatewayHome, call.signal); return { projections: services.projections, sidechatReplay: services.sidechatReplay };
    } });
  try {
    const context = await f.resolver.operationContext(f.reference);
    for (let i = 0; i < 2; i++) {
      const response = await scheduler.hostedRpc(context, { method: 'mobile/thread/observe', params: { threadId: 'thread' } }, { deadline: performance.now() + 5000 }).catch(error => {
        throw new Error(`snapshot failed: ${String(scheduler.lastError)}; methods=${f.frames.map(message => message.method).join(',')}`, { cause: error });
      });
      expect(response).toMatchObject({ result: { thread: { id: 'thread' }, data: [] } });
    }
    expect(f.frames.filter(message => message.method === 'thread/resume')).toHaveLength(1);
    expect(f.frames.filter(message => message.method === 'thread/read')).toHaveLength(2); expect(f.connections).toHaveLength(1);
  } finally { await scheduler.close(); await services?.close(); }
}, 15000);

it('上游离线且后台等待预算多次结束时复用原 queued 读取，不不断扩张队列', async () => {
  const f = await gatewayRemote(); f.setTargets([{ env_id: 'local-env', installation_id: 'local-install', kind: 'single', online: false, busy: false }]); await f.runtime.refreshTargets();
  const directory = join(f.gatewayHome, 'ledger');
  const scheduler = new OperationScheduler({ directory, gatewayId: 'gateway', gatewayCodexHome: f.gatewayHome, resolver: f.resolver,
    upstreamUrl: 'ws://127.0.0.1:1', attemptTimeoutMs: 250, remoteConsumers: async () => { throw new Error('offline'); } });
  try {
    const context = await f.resolver.operationContext(f.reference);
    for (let i = 0; i < 3; i++) await expect(scheduler.hostedRpc(context, { id: randomUUID(), method: 'thread/read', params: { threadId: 'thread' } })).rejects.toThrow();
    const ledger = JSON.parse(await readFile(join(directory, 'operations.json'), 'utf8')); expect(ledger.records).toHaveLength(1);
  } finally { await scheduler.close(); }
}, 15000);

it('普通发送在真实 active 时留队，idle 后才派发原正文', async () => {
  let active = true;
  const f = await gatewayRemote(message => message.method === 'thread/read'
    ? { thread: { id: 'thread', status: active ? 'active' : 'idle' } }
    : message.method === 'turn/start' ? { turn: { id: 'turn' } } : undefined);
  let services: GatewayRemoteServices | undefined;
  const scheduler = new OperationScheduler({ directory: join(f.gatewayHome, 'ledger'), gatewayId: 'gateway', gatewayCodexHome: f.gatewayHome,
    resolver: f.resolver, upstreamUrl: 'ws://127.0.0.1:1', remoteConsumers: async (_context, target, call) => {
      services ??= await GatewayRemoteServices.create(target, f.gatewayHome, call.signal);
      return { projections: services.projections, sidechatReplay: services.sidechatReplay };
    } });
  try {
    const context = await f.resolver.operationContext(f.reference); const sessionId = randomUUID();
    await scheduler.protocol({ context, sessionId, requestId: randomUUID(), message: { id: 1, method: 'initialize', params: { clientInfo: { name: 'test', version: '1' } } } });
    await scheduler.protocol({ context, sessionId, requestId: randomUUID(), message: { method: 'initialized' } });
    const id = randomUUID(); await scheduler.submit({ id, context, conversationId: 'thread', sessionId, requestId: id,
      message: { id: 2, method: 'turn/start', params: { threadId: 'thread', input: [{ type: 'text', text: 'original body' }] } }, settings: { source: 'public-rpc-v1' }, attachmentRefs: [] });
    await scheduler.runOnce();
    expect((await scheduler.operation(id, context, sessionId)).operation.state).toBe('queued');
    expect(f.frames.filter(message => message.method === 'turn/start')).toHaveLength(0);
    active = false; await scheduler.runOnce();
    expect(await scheduler.result(id)).toMatchObject({ outcome: 'response', message: { result: { turn: { id: 'turn' } } } });
    expect(f.frames.filter(message => message.method === 'turn/start')).toHaveLength(1);
    expect(f.frames.filter(message => message.method === 'thread/resume')).toHaveLength(1);
  } finally { await scheduler.close(); await services?.close(); }
}, 15000);
