// 真实网关 + 隔离 app-server 协议替身，不启动模型、不访问用户会话。
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { createGateway } from '../../../server/gateway.js';
import { DESKTOP_PINNED_SECTION_ID as PIN } from '../../../server/desktop-thread-pins.js';

const root = await mkdtemp(join(tmpdir(), 'codex-title-ui-'));
const id = '01984de2-8f74-7c91-a3b2-5c5e937cf320';
let name = '真实桥接总结验收', summaries = 0, namesWritten = 0;
const thread = () => ({ id, name, preview: '隔离协议夹具', cwd: '', createdAt: 1, updatedAt: 2, status: { type: 'idle' } });
const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await new Promise<void>(resolve => upstream.once('listening', resolve));
upstream.on('connection', socket => socket.on('message', raw => {
  const request = JSON.parse(raw.toString()); if (request.id == null) return;
  let result: any = { data: [], nextCursor: null };
  const { method, params } = request;
  if (method === 'initialize') result = { userAgent: 'codex/0.163.0-alpha.11' };
  else if (method === 'threadSection/list') result.data = [{ id: PIN, name: 'Pinned' }];
  else if (method === 'thread/list') result.data = params.sectionId ? [] : [thread()];
  else if (method === 'thread/read') result = { thread: thread() };
  else if (method === 'thread/resume') result = { thread: thread(), model: 'test', initialTurnsPage: { data: [], nextCursor: null } };
  else if (method === 'thread/turns/list') result.data = [{ id: 'user-turn', items: [{ type: 'userMessage', content: [{ type: 'text', text: '验证模型总结回填名称' }] }] }];
  else if (method === 'thread/start') result = { thread: { id: 'summary', ephemeral: true }, model: 'test' };
  else if (method === 'turn/start') { summaries++; result = { turn: { id: 'summary-turn' } }; }
  else if (method === 'thread/name/set') { name = params.name; namesWritten++; result = {}; }
  else if (method === 'model/list') result.data = [{ model: 'test', displayName: 'Test', isDefault: true, supportedReasoningEfforts: [] }];
  else if (method === 'permissionProfile/list') result.data = [{ id: ':read-only', allowed: true }];
  else if (method === 'config/read') result = { config: { model: 'test', sandbox_mode: 'read-only' } };
  socket.send(JSON.stringify({ id: request.id, result }));
  if (method === 'turn/start') setTimeout(() => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ method: 'turn/completed', params: { threadId: 'summary', turn: { id: 'summary-turn', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: '{"title":"真实网关候选名称"}' }] } } }));
  }, 1200);
}));
const gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external', staticDir: null, upstreamUrl: `ws://127.0.0.1:${(upstream.address() as any).port}`, codexHome: root,
  displayName: '验收 Mac', readProjectState: async () => ({ projects: [], projectlessThreadIds: [id] }) });
const control = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ name, summaries, namesWritten })); });
await new Promise<void>(resolve => control.listen(0, '127.0.0.1', resolve));
console.log(JSON.stringify({ gateway: `http://127.0.0.1:${gateway.port}?token=title-fixture`, control: `http://127.0.0.1:${(control.address() as any).port}` }));
const close = async () => {
  await gateway.close(); for (const socket of upstream.clients) socket.terminate();
  await new Promise<void>(resolve => upstream.close(() => resolve()));
  await new Promise<void>(resolve => control.close(() => resolve()));
  await rm(root, { recursive: true, force: true }); process.exit();
};
process.on('SIGTERM', close); process.on('SIGINT', close);
