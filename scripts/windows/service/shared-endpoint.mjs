import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

export class SharedEndpoint {
  constructor({ port, upstreamUrl, onActivity = () => {}, handleHttp = () => false }) {
    const upstream = new URL(upstreamUrl);
    if (upstream.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname)) throw new Error('需要本机上游地址');
    this.port = port; this.upstreamUrl = upstreamUrl; this.onActivity = onActivity;
    this.accepting = true; this.connections = new Set(); this.waiters = new Set(); this.runningProcesses = new Set();
    this.server = createServer(async (req, res) => {
      if (await handleHttp(req, res)) return;
      if (req.url === '/readyz' || req.url === '/healthz') {
        if (req.headers.origin !== undefined) { res.writeHead(403); res.end(); return; }
        let ready = false;
        try { ready = this.accepting && (await fetch(new URL('/readyz', upstreamUrl.replace(/^ws:/, 'http:')), { signal: AbortSignal.timeout(2000) })).ok; } catch { }
        res.writeHead(ready ? 200 : 503); res.end(ready ? 'ready' : 'unavailable');
      } else { res.writeHead(404); res.end(); }
    });
    this.wss = new WebSocketServer({ server: this.server, maxPayload: 100 * 1024 * 1024 });
    this.wss.on('connection', (client, request) => this.connect(client, request));
  }
  get url() { return `ws://127.0.0.1:${this.server.address().port}`; }
  get pendingCount() { return [...this.connections].reduce((n, c) => n + c.pending.size + c.serverRequests.size, 0); }
  get runningWorkCount() { return this.runningProcesses.size; }
  async listen() {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => { this.server.removeListener('error', reject); resolve(); });
    });
  }
  settle() { if (!this.pendingCount) for (const resolve of this.waiters) resolve(); }
  connect(client, request) {
    if (!this.accepting) { client.close(1013, 'service restarting'); return; }
    const headers = {};
    for (const name of ['origin', 'authorization']) if (request?.headers[name]) headers[name] = request.headers[name];
    const upstream = new WebSocket(this.upstreamUrl, { headers, maxPayload: 100 * 1024 * 1024, handshakeTimeout: 5000 });
    const connection = { client, upstream, pending: new Map(), serverRequests: new Set(), processes: new Map(), queue: [] };
    this.connections.add(connection);
    const fail = () => { client.close(1011, 'upstream unavailable'); upstream.terminate(); };
    client.on('error', () => {}); upstream.on('error', fail);
    client.on('close', () => { this.onActivity(); upstream.close(); });
    upstream.on('close', () => {
      // process/spawn 归该上游连接所有，服务端在连接结束时终止它们。
      for (const marker of connection.processes.values()) this.runningProcesses.delete(marker);
      this.connections.delete(connection); this.onActivity(); this.settle();
      client.close(1012, 'upstream disconnected');
    });
    upstream.on('open', () => { for (const bytes of connection.queue) upstream.send(bytes, { binary: false }); connection.queue = []; });
    client.on('message', (bytes, binary) => {
      let value;
      try { if (binary) throw new Error(); value = JSON.parse(bytes.toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); }
      catch { client.close(1008, 'invalid RPC'); return; }
      if (value.method) {
        if (!this.accepting) {
          if (Object.hasOwn(value, 'id')) client.send(JSON.stringify({ id: value.id, error: { code: -32002, message: 'Service restarting; request not sent' } }));
          return;
        }
        if (Object.hasOwn(value, 'id')) {
          const id = JSON.stringify(value.id);
          if (connection.pending.has(id) || connection.pending.size >= 256) { client.close(1008, 'RPC request limit'); return; }
          connection.pending.set(id, value.method);
          if (value.method === 'process/spawn') {
            const handle = value.params?.processHandle;
            const marker = { handle };
            connection.processes.set(id, marker); this.runningProcesses.add(marker);
          }
        }
        // 保守识别可能发起工作的方法，读请求不会阻止持续空闲计时。
        if (!/(?:\/read|\/list|\/get)$/.test(value.method) && value.method !== 'initialize' && value.method !== 'initialized') this.onActivity();
      } else if (Object.hasOwn(value, 'id')) { connection.serverRequests.delete(JSON.stringify(value.id)); this.settle(); }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(bytes, { binary: false });
      else if (upstream.readyState === WebSocket.CONNECTING && connection.queue.length < 32) connection.queue.push(bytes);
      else fail();
    });
    upstream.on('message', (bytes, binary) => {
      let value;
      try { if (binary) throw new Error(); value = JSON.parse(bytes.toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); } catch { fail(); return; }
      if (!value.method && Object.hasOwn(value, 'id')) {
        const id = JSON.stringify(value.id), process = connection.processes.get(id);
        if (process) {
          if (value.error) { this.runningProcesses.delete(process); connection.processes.delete(id); }
          else if (!process.handle && typeof value.result?.processId === 'string') process.handle = value.result.processId;
        }
        connection.pending.delete(id); this.settle();
      }
      if (value.method && Object.hasOwn(value, 'id')) connection.serverRequests.add(JSON.stringify(value.id));
      if (value.method === 'serverRequest/resolved') { connection.serverRequests.delete(JSON.stringify(value.params?.requestId)); this.settle(); }
      if (value.method === 'process/exited') {
        const handle = value.params?.processHandle ?? value.params?.processId;
        for (const [id, marker] of connection.processes) if (handle && marker.handle === handle) { this.runningProcesses.delete(marker); connection.processes.delete(id); }
      }
      if (value.method === 'thread/status/changed' && value.params?.status?.type !== 'idle') this.onActivity();
      if (client.readyState === WebSocket.OPEN) client.send(bytes, { binary: false });
    });
  }
  async drain(timeoutMs = 10_000) {
    this.accepting = false;
    if (!this.pendingCount) return;
    await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); this.waiters.delete(done); resolve(); };
      const timer = setTimeout(() => { this.waiters.delete(done); reject(new Error('在途请求尚未完成')); }, timeoutMs);
      this.waiters.add(done);
    });
  }
  resume() { this.accepting = true; }
  resetGeneration() { this.runningProcesses.clear(); }
  disconnectClients() { for (const c of this.connections) { c.client.close(1012, 'service updated'); c.upstream.terminate(); } }
  async close() {
    this.accepting = false;
    for (const c of this.connections) { c.client.terminate(); c.upstream.terminate(); }
    await new Promise((resolve) => this.wss.close(resolve));
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }
}
