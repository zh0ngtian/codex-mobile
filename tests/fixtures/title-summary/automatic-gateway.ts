// 自动命名全链路夹具：真实网关与 App 业务，不调用真实模型或生产服务。
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { createGateway } from '../../../server/gateway.js';
import { DESKTOP_PINNED_SECTION_ID as PIN } from '../../../server/desktop-thread-pins.js';

const root = await mkdtemp(join(tmpdir(), 'codex-auto-title-ui-'));
const id = '01984de2-8f74-7c91-a3b2-5c5e937cf322';
let created = false, name: string | null = null, summaries = 0, namesWritten = 0;
let summarySocket: WebSocket | undefined;
let pendingUser: any;
const turns: any[] = [];
const thread = () => ({ id, name, preview: '', cwd: '', createdAt: 1, updatedAt: 2, turns, status: { type: turns.length ? 'active' : 'idle' } });
const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await new Promise<void>(resolve => upstream.once('listening', resolve));
upstream.on('connection', socket => socket.on('message', raw => {
  const request = JSON.parse(raw.toString()); if (request.id == null) return;
  let result: any = { data: [], nextCursor: null };
  const { method, params } = request;
  if (method === 'initialize') result = { userAgent: 'codex/0.163.0-alpha.11' };
  else if (method === 'threadSection/list') result.data = [{ id: PIN, name: 'Pinned' }];
  else if (method === 'thread/list') result.data = !params.sectionId && created ? [thread()] : [];
  else if (method === 'thread/read') result = { thread: thread() };
  else if (method === 'thread/resume') result = { thread: thread(), model: 'test', initialTurnsPage: { data: turns, nextCursor: null } };
  else if (method === 'thread/turns/list') result.data = turns;
  else if (method === 'thread/start') {
    if (params.ephemeral) result = { thread: { id: 'summary', ephemeral: true }, model: 'test' };
    else { created = true; result = { thread: thread(), model: 'test' }; }
  } else if (method === 'turn/start') {
    if (params.threadId === 'summary') { summaries++; summarySocket = socket; result = { turn: { id: 'summary-turn' } }; }
    else {
      pendingUser = { id: 'main-user', type: 'userMessage', clientId: params.clientUserMessageId, content: params.input };
      const turn = { id: 'main-turn', status: 'inProgress', items: [] };
      turns.push(turn); result = { turn };
    }
  } else if (method === 'thread/name/set') { name = params.name; namesWritten++; result = {}; }
  else if (method === 'model/list') result.data = [{ model: 'test', displayName: 'Test', isDefault: true, supportedReasoningEfforts: [] }];
  else if (method === 'permissionProfile/list') result.data = [{ id: ':read-only', allowed: true }];
  else if (method === 'config/read') result = { config: { model: 'test', sandbox_mode: 'read-only' } };
  socket.send(JSON.stringify({ id: request.id, result }));
}));
const gateway = await createGateway({ host: '127.0.0.1', port: Number(process.env.CODEX_TITLE_GATEWAY_PORT ?? 0), mode: 'external', staticDir: null, upstreamUrl: `ws://127.0.0.1:${(upstream.address() as any).port}`, codexHome: root,
  displayName: '验收 Mac', readProjectState: async () => ({ projects: [], projectlessThreadIds: created ? [id] : [] }) });
const control = createServer((req, res) => {
  if (req.url === '/confirm-user' && pendingUser && !turns[0]?.items.length) {
    turns[0].items.push(pendingUser);
    for (const socket of upstream.clients) if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ method: 'item/completed', params: { threadId: id, turnId: 'main-turn', item: pendingUser } }));
    }
  }
  if (req.url === '/save-title-without-event' && created) {
    name = '服务端已保存的模型标题'; namesWritten++;
    if (turns[0]) turns[0].status = 'completed';
    for (const socket of upstream.clients) if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ method: 'thread/status/changed', params: { threadId: id, status: { type: 'idle' } } }));
    }
  }
  if (req.url === '/release-summary' && summarySocket && summarySocket.readyState === summarySocket.OPEN) {
    summarySocket.send(JSON.stringify({ method: 'turn/completed', params: { threadId: 'summary', turn: { id: 'summary-turn', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: '{"title":"停留页面实时更新标题"}' }] } } }));
  }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ name, summaries, namesWritten, created }));
});
await new Promise<void>(resolve => control.listen(Number(process.env.CODEX_TITLE_CONTROL_PORT ?? 0), '127.0.0.1', resolve));
console.log(JSON.stringify({ gateway: `http://127.0.0.1:${gateway.port}?token=automatic-title-fixture`, control: `http://127.0.0.1:${(control.address() as any).port}` }));
const close = async () => {
  await gateway.close(); for (const socket of upstream.clients) socket.terminate();
  await new Promise<void>(resolve => upstream.close(() => resolve()));
  await new Promise<void>(resolve => control.close(() => resolve()));
  await rm(root, { recursive: true, force: true }); process.exit();
};
process.on('SIGTERM', close); process.on('SIGINT', close);
