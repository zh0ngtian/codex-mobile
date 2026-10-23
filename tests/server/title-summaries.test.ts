import { afterEach, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { TitleSummaries } from '../../server/title-summaries.js';
import { CONVERSATION_TITLE_REQUEST } from '../../server/conversation-title-format.js';
import { encodeUserMessage } from '../../server/user-message-format.js';
import { createGateway } from '../../server/gateway.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function upstream(options: { empty?: boolean; invalid?: boolean; disconnect?: boolean; hang?: boolean } = {}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  cleanups.push(() => new Promise<void>(resolve => { for (const client of server.clients) client.terminate(); server.close(() => resolve()); }));
  const requests: any[] = [];
  const send = (socket: WebSocket, message: unknown) => socket.send(JSON.stringify(message));
  server.on('connection', socket => socket.on('message', data => {
    const request = JSON.parse(data.toString()); requests.push(request);
    if (request.id == null) return;
    if (options.disconnect) { socket.close(); return; }
    const method = request.method;
    let result: any = {};
    if (method === 'thread/turns/list') result = options.empty ? { data: [], nextCursor: null } : {
      data: [{ id: request.params.cursor ? 'turn2' : 'turn1', items: request.params.cursor
        ? [{ type: 'userMessage', content: [{ type: 'text', text: '还要支持手机' }] }]
        : [{ type: 'userMessage', content: [{ type: 'text', text: encodeUserMessage(`修复登录\n\n${CONVERSATION_TITLE_REQUEST}`, [{ name: '截图.png', path: '/tmp/screenshot.png' }]) }] },
          { type: 'agentMessage', text: '不要把助手回复发送给总结模型' }] }], nextCursor: request.params.cursor ? null : 'page2',
    };
    if (method === 'thread/start') result = { thread: { id: 'summary', ephemeral: true }, model: 'gateway-default' };
    if (method === 'turn/start') result = { turn: { id: 'summary-turn' } };
    send(socket, { id: request.id, result });
    if (method === 'turn/start' && !options.hang) {
      send(socket, { method: 'item/completed', params: { threadId: 'unrelated', item: { id: 'other', type: 'agentMessage', text: '{"title":"不相关标题"}' } } });
      send(socket, { method: 'turn/completed', params: { threadId: 'summary', turn: { id: 'summary-turn', status: 'completed', items: [{ id: 'a', type: 'agentMessage', text: options.invalid ? '{"title":""}' : '{"title":"修复手机登录"}' }] } } });
    }
  }));
  return { url: `ws://127.0.0.1:${(server.address() as any).port}`, requests, server };
}

it('完整分页所有用户消息，固定GPT-6-Luna低强度Fast执行独立问答且不修改源会话', async () => {
  const mock = await upstream();
  const summaries = new TitleSummaries(mock.url);
  expect(await summaries.summarize('source')).toBe('修复手机登录');
  const pages = mock.requests.filter(r => r.method === 'thread/turns/list');
  expect(pages.map(r => r.params.cursor)).toEqual([null, 'page2']);
  expect(pages.every(r => r.params.sortDirection === 'asc' && r.params.itemsView === 'full')).toBe(true);
  const start = mock.requests.find(r => r.method === 'thread/start');
  expect(start.params).toMatchObject({ ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only',
    model: 'gpt-6-luna', serviceTier: 'priority', config: { project_doc_max_bytes: 0, model_reasoning_effort: 'low' } });
  const turns = mock.requests.filter(r => r.method === 'turn/start');
  expect(turns).toHaveLength(1);
  expect(turns[0].params.threadId).toBe('summary');
  expect(turns[0].params).toMatchObject({ model: 'gpt-6-luna', effort: 'low', serviceTier: 'priority' });
  const text = turns[0].params.input[0].text;
  expect(text).toContain('修复登录'); expect(text).toContain('截图.png'); expect(text).toContain('还要支持手机');
  expect(text).not.toContain('conversation_title_request'); expect(text).not.toContain('助手回复');
  expect(mock.requests.some(r => r.method === 'thread/name/set')).toBe(false);
  expect(mock.requests.some(r => r.method === 'config/value/write' || r.method === 'config/batchWrite')).toBe(false);
});
it.each([{ empty: true }, { invalid: true }, { disconnect: true }])('失败时不编造标题并关闭独立连接 %j', async options => {
  const mock = await upstream(options);
  await expect(new TitleSummaries(mock.url).summarize('source')).rejects.toThrow();
});
it('总结超时释放连接，后续请求可重新发起', async () => {
  const mock = await upstream({ hang: true });
  const summaries = new TitleSummaries(mock.url, 60);
  await expect(summaries.summarize('source')).rejects.toThrow('超时');
  await expect(summaries.summarize('source')).rejects.toThrow('超时');
});
it.each([false, true])('网关总结路由使用既有鉴权并固定模型、low和Fast，automatic=%s', async automatic => {
  const mock = await upstream();
  const home = await mkdtemp(join(tmpdir(), 'title-summary-test-'));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  const gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external', upstreamUrl: mock.url, staticDir: null, accessToken: 'secret', codexHome: home });
  cleanups.push(() => gateway.close());
  const url = `http://127.0.0.1:${gateway.port}/api/threads/title-summary`;
  expect((await fetch(url, { method: 'POST' })).status).toBe(401);
  const preflight = await fetch(url + '?token=secret', { method: 'OPTIONS', headers: { origin: 'https://mobile.invalid' } });
  expect(preflight.status).toBe(204); expect(preflight.headers.get('access-control-allow-origin')).toBe('https://mobile.invalid');
  expect((await fetch(url + '?token=secret', { method: 'POST', body: '{}' })).status).toBe(400);
  const response = await fetch(url + '?token=secret', { method: 'POST', body: JSON.stringify({ threadId: 'source', ...(automatic ? { automatic: true } : {}) }) });
  expect(await response.json()).toEqual({ title: '修复手机登录' });
  expect(mock.requests.find(r => r.method === 'thread/start').params).toMatchObject({ model: 'gpt-6-luna', serviceTier: 'priority', config: { model_reasoning_effort: 'low' } });
  expect(mock.requests.find(r => r.method === 'turn/start').params).toMatchObject({ model: 'gpt-6-luna', effort: 'low', serviceTier: 'priority' });
});
