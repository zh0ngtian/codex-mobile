import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { startDesktopModelUpload, desktopMeterSocketPath, externalDesktopModelUsage, desktopConfigFlags } from '../../server/desktop-model-upload.js';
import { readModelUploadRoutes } from '../../server/model-upload-routing.js';
import { createGateway } from '../../server/gateway.js';

it.skipIf(!process.env.CODEX_MODEL_UPLOAD_SMOKE_BIN)('紧凑 -c 参数经真实CLI读取后保留原模型上游', async () => {
  const root = await mkdtemp('/tmp/dc-');
  try {
    const routes = await readModelUploadRoutes({ ...process.env, CODEX_HOME: root }, {
      executable: process.env.CODEX_MODEL_UPLOAD_SMOKE_BIN!, args: desktopConfigFlags(['-copenai_base_url="http://127.0.0.1:54321/compact"', 'app-server']),
    });
    expect(routes[0].baseUrl).toBe('http://127.0.0.1:54321/compact');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.skipIf(!process.env.CODEX_MODEL_UPLOAD_SMOKE_BIN).each(['http', 'websocket'])(
  '真实共享 Codex 的桌面和手机两轮 %s 模型请求均经桌面计量，external 网关读数等于上游实收载荷', async transport => {
    const root = await mkdtemp('/tmp/du-');
    const received: Array<{ turnId: string; bytes: number }> = [];
    const done = () => ({ type: 'response.completed', response: { id: 'r' + received.length, status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
    const upstream = createServer(async (request, response) => {
      if (request.method !== 'POST') { response.end('{}'); return; }
      const parts: Buffer[] = []; for await (const part of request) parts.push(part);
      const metadata = JSON.parse(String(request.headers['x-codex-turn-metadata']));
      received.push({ turnId: metadata.turn_id, bytes: Buffer.concat(parts).byteLength });
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end('data: ' + JSON.stringify(done()) + '\n\n');
    });
    const wss = new WebSocketServer({ server: upstream });
    wss.on('connection', socket => socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.generate !== false) received.push({ turnId: message.client_metadata.turn_id, bytes: Buffer.byteLength(raw.toString()) });
      socket.send(JSON.stringify(done()));
    }));
    upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
    const reservation = createTcpServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = (reservation.address() as any).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
    const upstreamUrl = `ws://127.0.0.1:${port}`;
    await writeFile(join(root, 'config.toml'), `model_provider="probe"\n[model_providers.probe]\nname="Probe"\nbase_url="http://127.0.0.1:${(upstream.address() as any).port}/v1"\nwire_api="responses"\nsupports_websockets=${transport === 'websocket'}\nrequires_openai_auth=false\n`);
    const adapter = join(root, 'desktop-adapter.cjs');
    // 隔离替身保留桌面所有权：只启动一个真实 app-server，双客户端接入同一服务。
    await writeFile(adapter, `const {spawn}=require('node:child_process');const child=spawn(process.env.PROBE_REAL_CODEX,[...process.argv.slice(2),'--listen',process.env.PROBE_LISTEN],{env:process.env,stdio:'inherit'});for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exit(code??1));`);
    let run: Awaited<ReturnType<typeof startDesktopModelUpload>> | undefined;
    let gateway: Awaited<ReturnType<typeof createGateway>> | undefined;
    let source: ReturnType<typeof externalDesktopModelUsage>;
    const clients: WebSocket[] = [];
    let sequence = 0;
    const all: Array<{ socket: WebSocket; message: any }> = [];
    const connect = async (url: string) => {
      const socket = new WebSocket(url); clients.push(socket);
      socket.on('message', raw => all.push({ socket, message: JSON.parse(raw.toString()) }));
      await once(socket, 'open'); return socket;
    };
    const request = (socket: WebSocket, method: string, params: unknown) => new Promise<any>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { socket.off('message', listener); reject(new Error('RPC timeout: ' + method)); }, 10_000);
      const listener = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.id === id) { clearTimeout(timer); socket.off('message', listener); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
      socket.on('message', listener); socket.send(JSON.stringify({ id, method, params }));
    });
    let threadId: string | undefined;
    try {
      run = await startDesktopModelUpload({ originalAdapter: adapter, codexExecutable: process.env.CODEX_MODEL_UPLOAD_SMOKE_BIN!, nodeExecutable: process.execPath,
        socketPath: desktopMeterSocketPath(root), upstreamUrl }, ['app-server'], { ...process.env, CODEX_HOME: root, CODEX_APP_TOOLS_PIPE_PATH: '/tmp/probe-tools-only', PROBE_REAL_CODEX: process.env.CODEX_MODEL_UPLOAD_SMOKE_BIN!, PROBE_LISTEN: upstreamUrl });
      await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/readyz`)).ok; } catch { return false; } }).toBe(true);
      source = externalDesktopModelUsage(upstreamUrl, root);
      gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external', upstreamUrl, staticDir: null, codexHome: root, uploadMeter: source });
      const desktop = await connect(upstreamUrl); const mobile = await connect(`ws://127.0.0.1:${gateway.port}/ws`);
      for (const socket of [desktop, mobile]) {
        await request(socket, 'initialize', { clientInfo: { name: 'desktop-meter-smoke', version: '1' } }); socket.send('{"method":"initialized"}');
      }
      threadId = (await request(desktop, 'thread/start', { cwd: root, model: 'gpt-6.1-sol', approvalPolicy: 'never', sandbox: 'read-only' })).thread.id;
      for (const [index, socket] of [desktop, mobile].entries()) {
        if (index) await request(socket, 'thread/resume', { threadId, excludeTurns: true });
        const offset = all.length;
        await request(socket, 'turn/start', { threadId, input: [{ type: 'text', text: '只回复ok。' }] });
        await expect.poll(() => all.slice(offset).some(entry => entry.socket === socket && entry.message.method === 'turn/completed')).toBe(true);
        const turn = all.slice(offset).find(entry => entry.socket === socket && entry.message.method === 'turn/completed')!.message.params.turn;
        const matching = received.filter(entry => entry.turnId === turn.id);
        expect(matching.length).toBeGreaterThan(0);
        await expect.poll(async () => (await request(mobile, 'mobile/uploadUsage/read', { threadId })).usage?.turnBytes).toBe(matching.reduce((n, entry) => n + entry.bytes, 0));
        expect((await request(mobile, 'mobile/uploadUsage/read', { threadId })).usage).toMatchObject({ turnId: turn.id, requestCount: matching.length, lastRequestBytes: matching.at(-1)!.bytes });
      }
      await request(desktop, 'thread/archive', { threadId }); threadId = undefined;
    } finally {
      if (threadId && clients[0]?.readyState === WebSocket.OPEN) await request(clients[0], 'thread/archive', { threadId }).catch(() => {});
      for (const client of clients) client.terminate();
      await gateway?.close(); await source?.close(); await run?.close();
      for (const socket of wss.clients) socket.terminate(); upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve())); await rm(root, { recursive: true, force: true });
    }
  }, 45_000,
);
