import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { SharedEndpoint } from '../../scripts/windows/service/shared-endpoint.mjs';

async function open(url) { const ws = new WebSocket(url); await once(ws, 'open'); return ws; }
function message(ws) { return once(ws, 'message').then(([data]) => JSON.parse(data.toString())); }

test('桌面与手机入口一起停止接单，排空先前请求后才能切换', async () => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(upstream, 'listening');
  const received = [];
  let complete;
  upstream.on('connection', (ws) => ws.on('message', (bytes) => {
    const request = JSON.parse(bytes.toString()); received.push(request);
    if (request.method === 'slow') complete = () => ws.send(JSON.stringify({ id: request.id, result: 'finished' }));
    else if (request.id != null) ws.send(JSON.stringify({ id: request.id, result: request.method }));
  }));
  const endpoint = new SharedEndpoint({ port: 0, upstreamUrl: `ws://127.0.0.1:${upstream.address().port}` });
  await endpoint.listen();
  const desktop = await open(endpoint.url);
  const mobile = await open(endpoint.url);
  try {
    const answer = message(desktop); desktop.send(JSON.stringify({ id: 1, method: 'slow' }));
    while (!complete) await new Promise((r) => setTimeout(r, 5));
    let drained = false; const barrier = endpoint.drain().then(() => { drained = true; });
    await new Promise((r) => setTimeout(r, 10)); assert.equal(drained, false);
    const rejected = message(mobile); mobile.send(JSON.stringify({ id: 2, method: 'turn/start' }));
    assert.equal((await rejected).error.code, -32002);
    assert.equal(received.some((r) => r.method === 'turn/start'), false);
    complete(); assert.equal((await answer).result, 'finished'); await barrier;
    assert.equal(endpoint.pendingCount, 0);
    endpoint.resume();
    const accepted = message(mobile); mobile.send(JSON.stringify({ id: 3, method: 'turn/start' }));
    assert.equal((await accepted).result, 'turn/start');
  } finally {
    desktop.terminate(); mobile.terminate(); await endpoint.close();
    for (const ws of upstream.clients) ws.terminate(); await new Promise((r) => upstream.close(r));
  }
});

test('保留反向审批请求和回复，排空期间也允许已有审批回复', async () => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(upstream, 'listening');
  let upstreamReply;
  upstream.on('connection', (ws) => {
    ws.on('message', (bytes) => { const x = JSON.parse(bytes.toString()); if (!x.method) upstreamReply = x; });
    ws.send(JSON.stringify({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'a' } }));
  });
  const endpoint = new SharedEndpoint({ port: 0, upstreamUrl: `ws://127.0.0.1:${upstream.address().port}` }); await endpoint.listen();
  const ws = new WebSocket(endpoint.url); const approval = message(ws); await once(ws, 'open');
  try {
    assert.equal((await approval).id, 'approval');
    let drained = false;
    const barrier = endpoint.drain().then(() => { drained = true; });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(drained, false);
    ws.send(JSON.stringify({ id: 'approval', result: { decision: 'accept' } }));
    while (!upstreamReply) await new Promise((r) => setTimeout(r, 5));
    await barrier;
    assert.deepEqual(upstreamReply, { id: 'approval', result: { decision: 'accept' } });
  } finally { ws.terminate(); await endpoint.close(); for (const c of upstream.clients) c.terminate(); await new Promise((r) => upstream.close(r)); }
});

test('独立进程仍在运行时保持忙碌，收到退出通知后才释放', async () => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(upstream, 'listening');
  let peer;
  upstream.on('connection', (ws) => { peer = ws; ws.on('message', (bytes) => { const x = JSON.parse(bytes.toString()); ws.send(JSON.stringify({ id: x.id, result: {} })); }); });
  const endpoint = new SharedEndpoint({ port: 0, upstreamUrl: `ws://127.0.0.1:${upstream.address().port}` }); await endpoint.listen();
  const ws = await open(endpoint.url);
  try {
    const accepted = message(ws); ws.send(JSON.stringify({ id: 1, method: 'process/spawn', params: { processHandle: 'running' } })); await accepted;
    assert.equal(endpoint.runningWorkCount, 1);
    const exited = message(ws); peer.send(JSON.stringify({ method: 'process/exited', params: { processHandle: 'running', exitCode: 0 } })); await exited;
    assert.equal(endpoint.runningWorkCount, 0);
  } finally { ws.terminate(); await endpoint.close(); for (const c of upstream.clients) c.terminate(); await new Promise((r) => upstream.close(r)); }
});

test('上游发送无效消息时关闭该连接，服务不会因空消息崩溃', async () => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(upstream, 'listening');
  upstream.on('connection', (ws) => ws.send('null'));
  const endpoint = new SharedEndpoint({ port: 0, upstreamUrl: `ws://127.0.0.1:${upstream.address().port}` }); await endpoint.listen();
  const ws = new WebSocket(endpoint.url); const closed = once(ws, 'close');
  try { assert.equal((await closed)[0], 1011); }
  finally { await endpoint.close(); for (const c of upstream.clients) c.terminate(); await new Promise((r) => upstream.close(r)); }
});
