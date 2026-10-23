// 真实 HTTP 网关与隔离 app-server 协议替身；不启动模型、不读取生产会话。
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { createGateway } from '../../../server/gateway.js';
import { DESKTOP_PINNED_SECTION_ID as PIN } from '../../../server/desktop-thread-pins.js';

const root = await mkdtemp(join(tmpdir(), 'codex-async-question-ui-'));
const id = '01984de2-8f74-7c91-a3b2-5c5e937cf321';
let sequence = 0, generation = 0, running = false, failNext = false;
const replies: any[] = [], turns: any[] = [{ id: 'initial', status: 'completed', items: [{ id: 'initial-user', type: 'userMessage', content: [{ type: 'text', text: '请调整模型总结按钮的位置。' }] }] }];
const thread = () => ({ id, name: '模型提问选择窗口', section: { id: PIN }, preview: '隔离协议预览', cwd: '', createdAt: 1, updatedAt: 2, turns, status: { type: running ? 'active' : 'idle' } });
const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await new Promise<void>(resolve => upstream.once('listening', resolve));
const emit = (method: string, params: any) => {
  for (const socket of upstream.clients) if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ method, params }));
};
upstream.on('connection', socket => socket.on('message', raw => {
  const request = JSON.parse(raw.toString()); if (request.id == null) return;
  const { method, params } = request; let result: any = { data: [], nextCursor: null };
  if (method === 'initialize') result = { userAgent: 'codex/0.163.0-alpha.11' };
  else if (method === 'threadSection/list') result.data = [{ id: PIN, name: 'Pinned' }];
  else if (method === 'thread/list') result.data = params.sectionId ? [thread()] : [];
  else if (method === 'thread/read') result = { thread: thread() };
  else if (method === 'thread/loaded/list') result.data = [id];
  else if (method === 'thread/resume') result = { thread: thread(), model: 'test', initialTurnsPage: { data: [...turns].reverse(), nextCursor: null } };
  else if (method === 'thread/turns/list') result.data = [...turns].reverse();
  else if (method === 'model/list') result.data = [{ model: 'test', displayName: 'GPT', isDefault: true, supportedReasoningEfforts: [] }];
  else if (method === 'permissionProfile/list') result.data = [{ id: ':workspace', allowed: true }];
  else if (method === 'config/read') result = { config: { model: 'test', sandbox_mode: 'workspace-write' } };
  else if (method === 'turn/start' || method === 'turn/steer') {
    replies.push({ method, params });
    if (failNext) { failNext = false; socket.send(JSON.stringify({ id: request.id, error: { code: -32000, message: '预览发送失败，答案已保留' } })); return; }
    const turn = method === 'turn/steer' ? turns.at(-1) : { id: `answer-turn-${generation}-${sequence}`, status: 'inProgress', items: [] };
    const item = { id: `answer-${generation}-${sequence}`, clientId: params.clientUserMessageId, type: 'userMessage', content: params.input };
    turn.items.push(item); if (method === 'turn/start') turns.push(turn);
    running = true; result = method === 'turn/steer' ? { turnId: turn.id } : { turn };
    socket.send(JSON.stringify({ id: request.id, result }));
    emit('item/started', { threadId: id, turnId: turn.id, item }); return;
  }
  socket.send(JSON.stringify({ id: request.id, result }));
}));
const gateway = await createGateway({ host: '127.0.0.1', port: Number(process.env.CODEX_QUESTION_GATEWAY_PORT ?? 0), mode: 'external', staticDir: null, upstreamUrl: `ws://127.0.0.1:${(upstream.address() as any).port}`, codexHome: root,
  displayName: '验收 Mac', readProjectState: async () => ({ projects: [], projectlessThreadIds: [id] }) });
const control = createServer((req, res) => {
  const url = new URL(req.url!, 'http://localhost');
  if (url.pathname === '/reset') {
    generation++; sequence = 0; running = false; failNext = false; replies.length = 0; turns.splice(1);
  }
  if (url.pathname === '/question') {
    sequence++; running = url.searchParams.get('running') !== '0'; failNext = url.searchParams.get('fail') === '1';
    for (const turn of turns) turn.status = 'completed';
    const questions = url.searchParams.get('many') === '1' ? Array.from({ length: 8 }, (_, index) => ({ title: `请补充第 ${index + 1} 项限制与需要保留的行为。`, options: null }))
      : url.searchParams.get('free') === '1' ? [{ title: '还有哪些需要保留的行为？', options: null }]
      : [{ title: '你想把“模型总结”放在哪个位置？', options: ['放在“取消／保存”下面，单独占一行', '与“取消／保存”放在同一排'] }];
    const item = { id: `async-call-${generation}-${sequence}`, type: 'agentMessage', phase: 'final_answer', delivery: 'async', questions,
      text: questions.map(q => q.title + (q.options ? '\n' + q.options.map(option => '- ' + option).join('\n') : '')).join('\n\n') };
    const turn = { id: `question-turn-${generation}-${sequence}`, status: running ? 'inProgress' : 'completed', items: [item] }; turns.push(turn);
    emit('turn/started', { threadId: id, turn: { ...turn, items: [] } });
    emit('item/completed', { threadId: id, turnId: turn.id, item });
    if (!running) emit('turn/completed', { threadId: id, turn });
  }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ replies, running, sequence }));
});
await new Promise<void>(resolve => control.listen(Number(process.env.CODEX_QUESTION_CONTROL_PORT ?? 0), '127.0.0.1', resolve));
console.log(JSON.stringify({ gateway: `http://127.0.0.1:${gateway.port}?token=async-fixture`, control: `http://127.0.0.1:${(control.address() as any).port}` }));
const close = async () => {
  await gateway.close(); for (const socket of upstream.clients) socket.terminate();
  await new Promise<void>(resolve => upstream.close(() => resolve()));
  await new Promise<void>(resolve => control.close(() => resolve()));
  await rm(root, { recursive: true, force: true }); process.exit();
};
process.on('SIGTERM', close); process.on('SIGINT', close);
