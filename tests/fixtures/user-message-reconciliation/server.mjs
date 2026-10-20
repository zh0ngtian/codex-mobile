import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// 只在回环地址模拟协议，经过 App 真实发送、恢复与桥接；不连接任何真实会话。
const port = Number(process.env.RECONCILIATION_PORT ?? 18839);
const steeringMode = process.env.RECONCILIATION_STEERING === '1';
const threadId = 'reconciliation-thread';
const title = '重复气泡模拟器验收';
let epoch, turns, events, cursor, starts, recoveries, sparse, archived;
let queue = [], steers = 0, pendingSteer;
function reset() {
  epoch = randomUUID(); cursor = 0; starts = 0; recoveries = 0; sparse = false; archived = false; events = [];
  turns = [{ id: 'seed', status: 'completed', itemsView: 'summary', startedAt: 100, completedAt: 101, items: [
    { id: 'seed-user', type: 'userMessage', content: [{ type: 'text', text: '准备复现' }] },
    { id: 'seed-answer', type: 'agentMessage', phase: 'final_answer', text: '可以发送测试消息。' },
  ] }];
  queue = []; steers = 0; pendingSteer = undefined;
  if (steeringMode) turns.push({ id: 'running', status: 'inProgress', startedAt: 200, items: [
    { id: 'initial', type: 'userMessage', text: '修复后合入主分支，先不发布' },
    { id: 'progress', type: 'agentMessage', phase: 'commentary', text: '我会检查消息呈现逻辑。' },
  ] });
}
reset();
const thread = () => ({ id: threadId, name: title, cwd: '/reconciliation', createdAt: 100, updatedAt: 101 + starts, status: { type: turns.at(-1).status === 'inProgress' ? 'active' : 'idle' }, turns: [] });
function emit(method, params = {}) { events.push({ cursor: ++cursor, message: { method, params } }); }
function summary() { return turns.map((turn, index) => ({ ...turn, itemsView: 'summary', items: sparse && index === turns.length - 1 ? [] : turn.items.filter(item => item.type === 'userMessage' || item.phase === 'final_answer') })).reverse(); }
function complete() {
  const turn = turns.at(-1);
  if (turn.status !== 'inProgress') return;
  const item = { id: `final-${starts}`, type: 'agentMessage', phase: 'final_answer', text: `第${starts}次发送处理完成。` };
  turn.items.push(item); turn.status = 'completed'; turn.completedAt = turn.startedAt + 2; sparse = false;
  emit('item/completed', { threadId, turnId: turn.id, item });
  emit('turn/completed', { threadId, turn: { ...turn, itemsView: 'summary' } });
}
function rpc(message) {
  const { method, params = {} } = message;
  console.log(JSON.stringify({ method, starts, sparse }));
  switch (method) {
    case 'initialize': return { userAgent: 'Reconciliation Fixture' };
    case 'model/list': return { data: [{ id: 'fixture', model: 'fixture', displayName: 'Fixture', isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] };
    case 'permissionProfile/list': return { data: [{ id: ':workspace', allowed: true }] };
    case 'config/read': return { config: { model: 'fixture', sandbox_mode: 'workspace-write' } };
    case 'thread/list': case 'thread/search': return { data: archived ? [] : [thread()], nextCursor: null };
    case 'thread/read': return { thread: { ...thread(), ...(params.includeTurns ? { turns } : {}) } };
    case 'thread/resume': return { thread: thread(), initialTurnsPage: { data: summary(), nextCursor: null }, model: 'fixture', approvalPolicy: 'on-request', approvalsReviewer: 'user' };
    case 'thread/loaded/list': return { data: [threadId], nextCursor: null };
    case 'thread/turns/list': return { data: params.itemsView === 'full' ? [...turns].reverse() : summary(), nextCursor: null };
    case 'mobile/turns/details': return { data: turns.map(turn => ({ id: turn.id, items: [], changeStatsUnavailable: true })), nextCursor: null };
    case 'mobile/turns/commentary': {
      recoveries++; sparse = false;
      const turn = turns.find(turn => turn.id === params.turnId);
      return { turnId: params.turnId, items: turn?.items ?? [], messageOrder: turn?.items.map(item => item.id) ?? [] };
    }
    case 'turn/start': {
      starts++; sparse = true;
      const turn = { id: `turn-${starts}`, status: 'inProgress', itemsView: 'full', startedAt: 200 + starts * 10, items: [
        { id: `user-${starts}`, type: 'userMessage', content: params.input.filter(item => ['text', 'image', 'localImage'].includes(item.type)) },
        { id: `progress-${starts}`, type: 'agentMessage', phase: 'commentary', text: `第${starts}次回填已到达。` },
      ] };
      turns.push(turn);
      // 模拟用户事件丢失后的游标恢复；开始回执按真实样本返回空 items。
      setTimeout(() => emit('mobile/reset'), 200);
      return { turn: { ...turn, items: [], itemsView: 'notLoaded' } };
    }
    case 'thread/archive': archived = true; return {};
    case 'turn/interrupt': complete(); return {};
    default: return {};
  }
}
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  if (request.method === 'OPTIONS') { response.end(); return; }
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  let result = {};
  if (url.pathname === '/__control/reset') reset();
  else if (url.pathname === '/__control/confirm-steer' && pendingSteer) {
    const { response: held, item } = pendingSteer;
    const turn = turns.at(-1);
    const message = { id: `confirmed-${steers}`, clientId: item.id, type: 'userMessage', content: [{ type: 'text', text: item.inputText }] };
    turn.items.push(message);
    emit('item/completed', { threadId, turnId: turn.id, item: message });
    const progress = { id: `after-steer-${steers}`, type: 'agentMessage', phase: 'commentary', text: '已收到引导，继续处理。' };
    turn.items.push(progress); emit('item/completed', { threadId, turnId: turn.id, item: progress });
    queue = queue.filter(value => value.id !== item.id);
    held.end(JSON.stringify({ items: queue, turnId: turn.id })); pendingSteer = undefined;
  }
  else if (url.pathname === '/__control/reject-steer' && pendingSteer) {
    pendingSteer.response.statusCode = 503;
    pendingSteer.response.end(JSON.stringify({ error: { message: '夹具拒绝本次引导' } })); pendingSteer = undefined;
  }
  else if (url.pathname === '/__control/complete') complete();
  else if (url.pathname === '/__control/status') result = { starts, recoveries, steers, pendingSteer: !!pendingSteer, sparse, archived, turns };
  else if (url.pathname === '/api/host') result = { hostId: 'reconciliation-host', displayName: 'Reconciliation QA', hostname: 'fixture', gatewayVersion: '0.3.18', appServerReady: true, httpPolling: true, followUpQueue: steeringMode };
  else if (url.pathname === '/api/projects') result = { projects: ['/reconciliation'], projectlessThreadIds: [] };
  else if (url.pathname === '/api/events') result = { epoch, cursor, messages: events.filter(event => event.cursor > Number(url.searchParams.get('after') ?? 0)).map(event => event.message), requests: [], active: turns.at(-1).status === 'inProgress', updatedAt: Date.now(), reset: false, hasMore: false };
  else if (url.pathname === '/api/follow-ups') {
    if (request.method === 'POST') {
      let body = ''; for await (const part of request) body += part;
      const action = JSON.parse(body);
      if (action.action === 'enqueue') queue.push({ ...action, state: 'queued', revision: 1 });
      if (action.action === 'steer') {
        steers++; pendingSteer = { response, item: queue.find(item => item.id === action.id) };
        return; // 验收先观察真实待确认状态，再显式确认或拒绝请求。
      }
    }
    result = { items: queue, revision: 0 };
  }
  else if (url.pathname === '/api/rpc') {
    let body = ''; for await (const part of request) body += part;
    const { message } = JSON.parse(body);
    result = { id: message.id, result: rpc(message) };
  }
  response.end(JSON.stringify(result));
});
server.listen(port, '127.0.0.1', () => console.log(`Reconciliation fixture: http://127.0.0.1:${port}`));
