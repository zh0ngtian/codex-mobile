import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import WebSocket, { WebSocketServer } from 'ws';
import { ModelUploadMeter, modelRequestIdentity } from '../../server/model-upload-meter.js';
import { createModelUploadProxy } from '../../server/model-upload-proxy.js';
import { modelUploadRoutes } from '../../server/model-upload-routing.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const identity = (thread_id = 'thread-a', turn_id = 'turn-a') => ({ thread_id, turn_id });

describe('模型请求上传计量', () => {
  it('按回合累计续跑和重试，隔离会话与迟到的旧请求', () => {
    const meter = new ModelUploadMeter();
    expect(meter.read('thread-a')).toBeNull();
    const first = meter.begin({ threadId: 'thread-a', turnId: 'turn-a' }); first(100);
    const retry = meter.begin({ threadId: 'thread-a', turnId: 'turn-a' }); retry(200); first(50);
    expect(meter.read('thread-a')).toMatchObject({ lastRequestBytes: 200, turnBytes: 350, requestCount: 2 });
    meter.begin({ threadId: 'thread-b', turnId: 'turn-a' })(900);
    meter.begin({ threadId: 'thread-a', turnId: 'turn-b' })(40);
    first(100); meter.begin({ threadId: 'thread-a', turnId: 'turn-a' })(10);
    expect(meter.read('thread-a')).toMatchObject({ turnId: 'turn-b', lastRequestBytes: 40, turnBytes: 40 });
    expect(meter.read('thread-b')?.turnBytes).toBe(900);
    const copy = meter.read('thread-a')!; copy.turnBytes = 999;
    expect(meter.read('thread-a')?.turnBytes).toBe(40);
    expect(modelRequestIdentity('{broken')).toBeUndefined();
    expect(modelRequestIdentity({ session_id: 'thread-a' })).toBeUndefined();
  });

  it('HTTP 原样转发压缩/多字节载荷，保留认证、SSE、状态码和请求参数', async () => {
    const payload = gzipSync(Buffer.from(JSON.stringify({ text: '中文😀', tools: ['tool'] })));
    const bodies: Buffer[] = []; const paths: string[] = [];
    const upstream = createServer(async (req, res) => {
      const parts: Buffer[] = []; for await (const chunk of req) parts.push(chunk);
      bodies.push(Buffer.concat(parts)); paths.push(req.url!);
      expect(req.headers.authorization).toBe('Bearer opaque-test-token');
      expect(req.headers['content-encoding']).toBe('gzip');
      res.writeHead(bodies.length === 1 ? 429 : 200, { 'content-type': 'text/event-stream', 'retry-after': '1' });
      res.write('data: first\n\n'); res.end('data: second\n\n');
    });
    upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
    cleanup.push(async () => { upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
    const proxy = await createModelUploadProxy([{ key: 'openai_base_url', baseUrl: `http://127.0.0.1:${(upstream.address() as any).port}/v1?api-version=test` }]);
    cleanup.push(() => proxy.close());
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await fetch(proxy.overrides[0][1] + '/responses?stream=true', { method: 'POST', body: payload,
        headers: { authorization: 'Bearer opaque-test-token', 'content-encoding': 'gzip', 'x-codex-turn-metadata': JSON.stringify(identity()) } });
      expect(reply.status).toBe(attempt === 0 ? 429 : 200);
      expect(reply.headers.get('retry-after')).toBe('1');
      expect(await reply.text()).toBe('data: first\n\ndata: second\n\n');
    }
    expect(bodies).toEqual([payload, payload]);
    expect(paths).toEqual(['/v1/responses?api-version=test&stream=true', '/v1/responses?api-version=test&stream=true']);
    expect(proxy.meter.read('thread-a')).toMatchObject({ lastRequestBytes: payload.byteLength, turnBytes: payload.byteLength * 2, requestCount: 2 });
    const publicData = JSON.stringify(proxy.meter.read('thread-a'));
    expect(publicData).not.toContain('opaque-test-token'); expect(publicData).not.toContain('tools');
    expect((await fetch(proxy.overrides[0][1] + '/responses', { headers: { origin: 'https://untrusted.example' } })).status).toBe(403);
    expect((await fetch(new URL('/invalid/responses', proxy.overrides[0][1]))).status).toBe(403);
  });

  it('WebSocket 同一连接跨回合保持增量载荷和升级头，排除预热及未知归属', async () => {
    const server = createServer(); const wss = new WebSocketServer({ server, perMessageDeflate: false });
    const forwarded: string[] = [];
    wss.on('headers', headers => headers.push('x-codex-turn-state: opaque-state'));
    wss.on('connection', socket => socket.on('message', (raw, binary) => {
      expect(binary).toBe(false); forwarded.push(raw.toString()); socket.send(raw, { binary: false });
    }));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    cleanup.push(async () => { for (const socket of wss.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); });
    const proxy = await createModelUploadProxy([{ key: 'openai_base_url', baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1` }]);
    cleanup.push(() => proxy.close());
    const client = new WebSocket(proxy.overrides[0][1].replace('http:', 'ws:') + '/responses', { headers: { 'x-codex-turn-metadata': JSON.stringify(identity('thread-a', 'obsolete-handshake-turn')) } });
    const upgrade = once(client, 'upgrade'); await once(client, 'open');
    expect((await upgrade)[0].headers['x-codex-turn-state']).toBe('opaque-state');
    for (const message of [
      { type: 'response.create', generate: false, client_metadata: identity() },
      { type: 'response.create', input: ['中文😀'], client_metadata: identity() },
      { type: 'response.create', previous_response_id: 'resp-a', input: [], client_metadata: { 'x-codex-turn-metadata': JSON.stringify(identity()) } },
      { type: 'response.create', previous_response_id: 'resp-b', input: ['b'], client_metadata: identity('thread-a', 'turn-b') },
      { type: 'response.create', input: ['no identity'] },
    ]) {
      const raw = JSON.stringify(message); const received = once(client, 'message'); client.send(raw);
      expect((await received)[0].toString()).toBe(raw);
    }
    const last = forwarded[3];
    expect(proxy.meter.read('thread-a')).toMatchObject({ turnId: 'turn-b', lastRequestBytes: Buffer.byteLength(last), turnBytes: Buffer.byteLength(last), requestCount: 1 });
    const closed = once(client, 'close'); client.close(1000); expect((await closed)[0]).toBe(1000);
    expect(forwarded).toHaveLength(5);
  });

  it('模型路由复用有效配置，不改变登录、认证和其他服务端点', () => {
    expect(modelUploadRoutes({}, {})[0].defaultTargets?.chatgpt).toBe('https://chatgpt.com/backend-api/codex');
    expect(modelUploadRoutes({}, {})).toMatchObject([{ key: 'openai_base_url', baseUrl: 'https://api.openai.com/v1' }]);
    expect(modelUploadRoutes({ openai_base_url: 'https://configured/v1', model_providers: {
      'custom-provider': { base_url: 'https://custom/v1', wire_api: 'responses' }, bedrock: { base_url: 'https://bedrock', wire_api: 'bedrock' },
    } }, { OPENAI_BASE_URL: 'https://environment/v1' })).toEqual([
      { key: 'openai_base_url', baseUrl: 'https://configured/v1' },
      { key: 'model_providers."custom-provider".base_url', baseUrl: 'https://custom/v1' },
    ]);
  });

  it('默认路由跟随 ChatGPT/API 认证切换，显式配置的上游保持原值', async () => {
    const server = createServer((req, res) => res.end(req.url));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    const proxy = await createModelUploadProxy([
      { key: 'openai_base_url', baseUrl: origin + '/api', defaultTargets: { api: origin + '/api', chatgpt: origin + '/chatgpt/codex' } },
      { key: 'custom', baseUrl: origin + '/fixed' },
    ]);
    cleanup.push(() => proxy.close());
    const read = (index = 0) => fetch(proxy.overrides[index][1] + '/models').then(response => response.text());
    expect(await read()).toBe('/api/models');
    proxy.setAuthMode('chatgpt'); expect(await read()).toBe('/chatgpt/codex/models');
    expect(await read(1)).toBe('/fixed/models');
    proxy.setAuthMode('apikey'); expect(await read()).toBe('/api/models');
    expect(await (await fetch(proxy.overrides[0][1] + '/models', { headers: { 'chatgpt-account-id': 'probe-account' } })).text()).toBe('/chatgpt/codex/models');
  });
});
