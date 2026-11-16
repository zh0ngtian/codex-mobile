// @vitest-environment node
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { GatewayRpc } from '../../server/gateway-rpc.js';
import { GatewayRemoteServices } from '../../server/gateway-remote-services.js';
import { OperationScheduler } from '../../server/operation-scheduler.js';
import { gatewayRemote } from './fixtures/gateway-remote.js';

it('公开 HTTP 请求经唯一耐久队列；查询原 UUID 不重复发送且不可跨 Session 读取', async () => {
  const f = await gatewayRemote(); let services: GatewayRemoteServices | undefined;
  const scheduler = new OperationScheduler({ directory: join(f.gatewayHome, 'ledger'), gatewayId: 'gateway', gatewayCodexHome: f.gatewayHome,
    resolver: f.resolver, upstreamUrl: 'ws://127.0.0.1:1', remoteConsumers: async (_context, target, call) => {
      services ??= await GatewayRemoteServices.create(target, f.gatewayHome, call.signal); return { projections: services.projections, sidechatReplay: services.sidechatReplay };
    } });
  const rpc = new GatewayRpc(f.resolver, scheduler);
  const server = createServer((req, res) => { void rpc.handle(req, res, new URL(req.url!, 'http://test'), f.reference); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); scheduler.start();
  const origin = `http://127.0.0.1:${(server.address() as any).port}`; const sessionId = randomUUID();
  const post = async (message: unknown, id = randomUUID()) => {
    const response = await fetch(`${origin}/api/rpc?sessionId=${sessionId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: id, message }) });
    return { response, body: await response.json() as any };
  };
  try {
    expect((await post({ id: 1, method: 'initialize', params: { clientInfo: { name: 'test', version: '1' } } })).body.result.codexHome).toBe(f.targetHome);
    await post({ method: 'initialized' });
    const id = randomUUID(); const sent = await post({ id: 2, method: 'thread/read', params: { threadId: 'thread' } }, id);
    expect(sent.response.status).toBe(200); expect(sent.body).toMatchObject({ id: 2, result: { ok: true } });
    const read = await fetch(`${origin}/api/operations?sessionId=${sessionId}&requestId=${id}`);
    expect(await read.json()).toMatchObject({ status: 'completed', message: { id: 2 } });
    const other = await fetch(`${origin}/api/operations?sessionId=${randomUUID()}&requestId=${id}`);
    expect(other.status).toBe(409);
    expect(f.frames.filter(frame => frame.method === 'thread/read')).toHaveLength(1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await scheduler.close(); await services?.close(); }
}, 15000);
