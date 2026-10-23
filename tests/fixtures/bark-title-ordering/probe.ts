import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { createGateway } from '../../../server/gateway.js';
import { DESKTOP_PINNED_SECTION_ID as PIN } from '../../../server/desktop-thread-pins.js';

type Scenario = 'name-first' | 'task-first' | 'save-ack-late' | 'summary-failed' | 'candidate-unsaved';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function until(check: () => boolean) { for (let n = 0; n < 200 && !check(); n++) await pause(10); assert(check(), '等待本机接收端超时'); }

async function probe(scenario: Scenario) {
  const root = await mkdtemp(join(tmpdir(), 'bark-title-order-'));
  const source = 'source-thread'; const summary = 'summary-thread';
  const preview = '发送任务时的原始输入'; const generated = '自动总结的新标题';
  let name: string | null = null; let sourceSocket: WebSocket | undefined; let summarySocket: WebSocket | undefined;
  let saveReply: (() => void) | undefined;
  const summaryReady = deferred(), saveRequested = deferred();
  const pushes: any[] = []; const events: Array<{ event: string; ms: number }> = [];
  const started = performance.now();
  const mark = (event: string) => events.push({ event, ms: Math.round((performance.now() - started) * 10) / 10 });
  const bark = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString()); pushes.push(payload); mark('bark:' + payload.body);
    response.end('{}');
  });
  await new Promise<void>(resolve => bark.listen(0, '127.0.0.1', resolve));
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => upstream.once('listening', resolve));
  const thread = () => ({ id: source, name, preview, status: { type: 'active' }, cwd: '' });
  const send = (socket: WebSocket, value: unknown) => socket.send(JSON.stringify(value));
  upstream.on('connection', socket => socket.on('message', raw => {
    const request = JSON.parse(raw.toString()); if (request.id == null) return;
    const params = request.params ?? {}; let result: any = { data: [], nextCursor: null };
    if (request.method === 'initialize') result = { userAgent: 'title-ordering-probe' };
    else if (request.method === 'threadSection/list') result.data = [{ id: PIN, name: 'Pinned' }];
    else if (request.method === 'thread/list') result.data = params.sectionId ? [] : [thread()];
    else if (request.method === 'thread/start') result = params.ephemeral ? { thread: { id: summary, ephemeral: true }, model: 'default' } : { thread: thread(), model: 'default' };
    else if (request.method === 'thread/read') { sourceSocket = socket; result = { thread: thread() }; }
    else if (request.method === 'thread/turns/list') result.data = [{ id: 'task-turn', items: [{ type: 'userMessage', content: [{ type: 'text', text: preview }] }] }];
    else if (request.method === 'turn/start') {
      result = { turn: { id: params.threadId === summary ? 'summary-turn' : 'task-turn', status: 'inProgress' } };
      if (params.threadId === summary) { summarySocket = socket; mark('summary-started'); summaryReady.resolve(); }
      else { sourceSocket = socket; mark('task-started'); }
    } else if (request.method === 'thread/name/set') {
      mark('save-requested'); saveRequested.resolve();
      const accept = () => { name = params.name; mark('name-saved'); send(socket, { id: request.id, result: {} }); };
      if (scenario === 'save-ack-late') { saveReply = accept; return; }
      accept(); return;
    }
    send(socket, { id: request.id, result });
  }));
  const gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external', staticDir: null,
    upstreamUrl: `ws://127.0.0.1:${(upstream.address() as any).port}`, codexHome: root, accessToken: 'probe-token', displayName: '隔离测试' });
  const sessionId = randomUUID(); let id = 0;
  const endpoint = (path: string) => `http://127.0.0.1:${gateway.port}/api/${path}?token=probe-token&sessionId=${sessionId}`;
  const rpc = async (method: string, params: any = {}) => {
    const response = await fetch(endpoint('rpc'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), message: { id: ++id, method, params } }) });
    assert.equal(response.status, 200); const reply = await response.json() as any; assert.equal(reply.error, undefined); return reply.result;
  };
  const finishTask = () => {
    mark('task-completed');
    send(sourceSocket!, { method: 'turn/completed', params: { threadId: source, turn: { id: 'task-turn', status: 'completed', items: [{ id: 'final', type: 'agentMessage', phase: 'final_answer', text: '任务完成' }] } } });
  };
  const finishSummary = () => {
    mark(scenario === 'summary-failed' ? 'summary-failed' : 'summary-returned');
    send(summarySocket!, { method: 'turn/completed', params: { threadId: summary, turn: { id: 'summary-turn', status: scenario === 'summary-failed' ? 'failed' : 'completed', items: [{ id: 'title', type: 'agentMessage', text: JSON.stringify({ title: generated }) }] } } });
  };
  try {
    const settings = await fetch(endpoint('notifications/settings'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: randomUUID(), backendId: 'probe-backend', mode: 'bark', barkUrl: `http://127.0.0.1:${(bark.address() as any).port}/probe-device` }) });
    assert.equal(settings.status, 200);
    await rpc('initialize', { clientInfo: { name: 'probe-client', version: '1' } });
    await rpc('thread/start'); await rpc('thread/read', { threadId: source, includeTurns: false });
    await rpc('turn/start', { threadId: source, input: [{ type: 'text', text: preview }] });
    const naming = fetch(endpoint('threads/title-summary'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: source }) }).then(async response => {
      const result = await response.json() as any;
      if (!response.ok) { mark('summary-request-failed'); return; }
      assert.equal(result.title, generated); mark('candidate-received');
      if (scenario !== 'candidate-unsaved') { await rpc('thread/name/set', { threadId: source, name: result.title }); mark('name-save-acknowledged'); }
    });
    await summaryReady.promise;
    if (scenario === 'name-first') { finishSummary(); await naming; finishTask(); await until(() => pushes.length === 1); }
    else if (scenario === 'candidate-unsaved') { finishSummary(); await naming; finishTask(); await until(() => pushes.length === 1); }
    else if (scenario === 'save-ack-late') { finishSummary(); await saveRequested.promise; finishTask(); await pause(100); saveReply!(); await naming; await until(() => pushes.length === 1); }
    else { finishTask(); await pause(100); finishSummary(); await naming; await until(() => pushes.length === 1); }
    // 重复完成事件与后续名称更新不能再生成第二条完成通知。
    finishTask(); await pause(60);
    assert.equal(pushes.length, 1);
    if (scenario === 'name-first') assert.equal(pushes[0].body, generated);
    if (['summary-failed', 'candidate-unsaved'].includes(scenario)) assert.equal(pushes[0].body, preview);
    // 其余两种只记录实际顺序，不把当前存在的通知竞态固化为正确产品行为。
    assert.equal(name, ['summary-failed', 'candidate-unsaved'].includes(scenario) ? null : generated);
    assert.equal(pushes[0].title, 'Codex 运行结束');
    return { scenario, events, receivedConversationName: pushes[0].body, finalSavedName: name, pushes: pushes.length,
      usesGeneratedName: pushes[0].body === generated, actualHttpGatewayAndBark: true };
  } finally {
    await gateway.close(); for (const socket of upstream.clients) socket.terminate();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    bark.closeAllConnections(); await new Promise<void>(resolve => bark.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

const results = [];
for (const scenario of ['name-first', 'task-first', 'save-ack-late', 'summary-failed', 'candidate-unsaved'] as Scenario[]) {
  const result = await probe(scenario); results.push(result); console.log(JSON.stringify(result));
}
const directory = process.argv[2]; if (!directory) throw new Error('需要提供仓库外测试证据目录'); await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(join(directory, 'ordering-results.json'), JSON.stringify({ baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), testedAt: new Date().toISOString(), realModelUsed: false, userDeviceNotified: false, results }, null, 2));
