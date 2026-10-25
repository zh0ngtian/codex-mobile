import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket, { WebSocketServer } from 'ws';
import { startManagedAppServer } from '../../server/app-server-manager.js';

// 显式提供本机 CLI 时运行；只访问隔离的假模型服务，不使用真实账户或模型额度。
it.skipIf(!process.env.CODEX_MODEL_UPLOAD_SMOKE_BIN).each(['http', 'websocket', 'api'])(
  '真实 Codex 经受管转发器使用 %s 连续完成两轮，计量与上游实收载荷逐字节相等', async transport => {
    const root = await mkdtemp(join(tmpdir(), 'upload-real-codex-'));
    const oldHome = process.env.CODEX_HOME; const oldPath = process.env.PATH;
    const received: Array<{ bytes: number; turn: string }> = [];
    const completed = () => ({ type: 'response.completed', response: { id: 'resp_' + received.length, status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
    const model = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.end('{"models":[]}'); return; }
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
      const metadata = JSON.parse(String(req.headers['x-codex-turn-metadata']));
      received.push({ bytes: Buffer.concat(chunks).byteLength, turn: metadata.turn_id });
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: ' + JSON.stringify(completed()) + '\n\n');
    });
    const wss = new WebSocketServer({ server: model });
    wss.on('connection', socket => socket.on('message', raw => {
      const body = JSON.parse(raw.toString());
      if (body.generate !== false) received.push({ bytes: Buffer.byteLength(raw.toString()), turn: body.client_metadata.turn_id });
      socket.send(JSON.stringify(completed()));
    }));
    model.listen(0, '127.0.0.1'); await once(model, 'listening');
    let managed: Awaited<ReturnType<typeof startManagedAppServer>> | undefined;
    let socket: WebSocket | undefined;
    try {
      await mkdir(join(root, 'bin')); await symlink(process.env.CODEX_MODEL_UPLOAD_SMOKE_BIN!, join(root, 'bin/codex'));
      process.env.CODEX_HOME = root; process.env.PATH = join(root, 'bin') + ':' + oldPath;
      if (transport === 'api') {
        await writeFile(join(root, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-local-probe-only' }), { mode: 0o600 });
        await writeFile(join(root, 'config.toml'), `openai_base_url="http://127.0.0.1:${(model.address() as any).port}/v1"\n`);
      } else {
        await writeFile(join(root, 'config.toml'), `model_provider="probe"\n[model_providers.probe]\nname="Probe"\nbase_url="http://127.0.0.1:${(model.address() as any).port}/v1"\nwire_api="responses"\nsupports_websockets=${transport === 'websocket'}\nrequires_openai_auth=false\n`);
      }
      const reservation = createTcpServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
      const port = (reservation.address() as any).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
      managed = await startManagedAppServer(port);
      socket = new WebSocket(`ws://127.0.0.1:${port}`); await once(socket, 'open');
      let sequence = 0;
      const request = (method: string, params: unknown) => {
        const id = ++sequence;
        const reply = new Promise<any>((resolve, reject) => {
          const listener = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.id === id) { socket!.off('message', listener); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
          socket!.on('message', listener);
        });
        socket!.send(JSON.stringify({ id, method, params })); return reply;
      };
      await request('initialize', { clientInfo: { name: 'upload-smoke', version: '1' } }); socket.send('{"method":"initialized"}');
      const threadId = (await request('thread/start', { cwd: root, model: 'gpt-6.1-sol', approvalPolicy: 'never', sandbox: 'read-only' })).thread.id;
      for (let turn = 0; turn < 2; turn++) {
        const finished = new Promise<string>(resolve => {
          const listener = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.method === 'turn/completed') { socket!.off('message', listener); resolve(m.params.turn.id); } }; socket!.on('message', listener);
        });
        await request('turn/start', { threadId, input: [{ type: 'text', text: 'Say ok.' }] });
        const id = await finished;
        const requests = received.filter(r => r.turn === id);
        expect(requests.length).toBeGreaterThan(0);
        expect(managed.uploadMeter.read(threadId)).toMatchObject({ turnId: id, lastRequestBytes: requests.at(-1)!.bytes,
          turnBytes: requests.reduce((total, r) => total + r.bytes, 0), requestCount: requests.length });
      }
      await request('thread/archive', { threadId });
    } finally {
      socket?.terminate(); await managed?.close();
      if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome;
      process.env.PATH = oldPath;
      for (const client of wss.clients) client.terminate();
      model.closeAllConnections(); await new Promise<void>(resolve => model.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }, 45_000,
);
