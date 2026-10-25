import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { randomBytes } from 'node:crypto';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { ModelUploadMeter, modelRequestIdentity } from './model-upload-meter.js';

export interface ModelRoute { key: string; baseUrl: string; defaultTargets?: { api: string; chatgpt: string } }

function forwardingHeaders(source: IncomingHttpHeaders) {
  const headers = { ...source };
  const connection = String(headers.connection ?? '').split(',').map(value => value.trim().toLowerCase());
  for (const key of ['host', 'connection', 'upgrade', 'keep-alive', 'proxy-authorization', 'proxy-authenticate',
    'transfer-encoding', 'te', 'trailer', ...connection]) delete headers[key];
  for (const key of Object.keys(headers)) if (key.startsWith('sec-websocket-')) delete headers[key];
  return headers;
}

function payloadBuffer(data: RawData) {
  return Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
}

/** 固定上游的回环转发器。随机路径仅供受管 Codex 进程使用，不提供任意 URL 代理。 */
export async function createModelUploadProxy(routes: ModelRoute[], meter = new ModelUploadMeter()) {
  const secret = randomBytes(24).toString('hex');
  const registered = new Map(routes.map((route, index) => {
    const target = new URL(route.baseUrl);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash) {
      throw new Error('模型计量上游必须是无内嵌凭据的 HTTP(S) 地址');
    }
    return [`/${secret}/${index}`, { target, defaults: route.defaultTargets }] as [string, { target: URL; defaults?: ModelRoute["defaultTargets"] }];
  }));
  const sockets = new Set<import('node:net').Socket>();
  const upgradeHeaders = new WeakMap<import('node:http').IncomingMessage, IncomingHttpHeaders>();
  const protocols = new WeakMap<import('node:http').IncomingMessage, string>();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 * 1024,
    handleProtocols: (_offered, request) => protocols.get(request) || false });
  wss.on('headers', (headers, request) => {
    for (const [key, value] of Object.entries(upgradeHeaders.get(request) ?? {})) {
      if (value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) headers.push(`${key}: ${item}`);
    }
  });
  const websockets = new Set<WebSocket>();
  function targetFor(path: string | undefined, headers: IncomingHttpHeaders) {
    // 浏览器不能将本机转发器当作跨站凭据出口。
    if (headers.origin || !/^127\.0\.0\.1:\d+$/.test(headers.host ?? '')) return;
    const url = new URL(path ?? '/', 'http://127.0.0.1');
    for (const [prefix, entry] of registered) {
      if (!url.pathname.startsWith(prefix + '/')) continue;
      const base = entry.defaults && headers['chatgpt-account-id'] ? new URL(entry.defaults.chatgpt) : entry.target;
      const target = new URL(base);
      target.pathname = base.pathname.replace(/\/$/, '') + url.pathname.slice(prefix.length);
      for (const [key, value] of url.searchParams) target.searchParams.append(key, value);
      return target;
    }
  }
  const server = createServer((incoming, response) => {
    const target = targetFor(incoming.url, incoming.headers);
    if (!target) { response.writeHead(403).end(); return; }
    const identity = incoming.method === 'POST' && /\/responses(?:\/compact)?\/?$/.test(target.pathname)
      ? modelRequestIdentity(incoming.headers['x-codex-turn-metadata']) : undefined;
    const addBytes = identity ? meter.begin(identity) : undefined;
    const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method: incoming.method, headers: forwardingHeaders(incoming.headers),
    }, reply => {
      response.writeHead(reply.statusCode ?? 502, forwardingHeaders(reply.headers));
      reply.on('error', () => response.destroy());
      reply.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502).end('Model upstream unavailable');
      else response.destroy();
    });
    incoming.on('data', (chunk: Buffer) => {
      if (!upstream.write(chunk, error => { if (!error) addBytes?.(chunk.byteLength); })) {
        incoming.pause(); upstream.once('drain', () => incoming.resume());
      }
    });
    incoming.on('end', () => upstream.end());
    incoming.on('error', () => upstream.destroy());
    incoming.on('aborted', () => upstream.destroy());
    response.on('close', () => { if (!response.writableFinished) upstream.destroy(); });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (incoming, socket, head) => {
    const target = targetFor(incoming.url, incoming.headers);
    if (!target) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    const offered = String(incoming.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim()).filter(Boolean);
    const upstream = new WebSocket(target, offered, { headers: forwardingHeaders(incoming.headers),
      perMessageDeflate: false, maxPayload: 64 * 1024 * 1024, handshakeTimeout: 30_000 });
    websockets.add(upstream);
    upstream.once('close', () => websockets.delete(upstream));
    upstream.once('error', () => socket.destroy());
    upstream.once('upgrade', reply => { upgradeHeaders.set(incoming, forwardingHeaders(reply.headers)); });
    socket.once('close', () => { if (upstream.readyState !== WebSocket.CLOSED) upstream.terminate(); });
    upstream.once('unexpected-response', (_request, reply) => {
      const headers = Object.entries(forwardingHeaders(reply.headers)).flatMap(([key, value]) =>
        value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(item => `${key}: ${item}\r\n`)).join('');
      socket.write(`HTTP/1.1 ${reply.statusCode ?? 502} Upstream response\r\n${headers}Connection: close\r\n\r\n`);
      reply.pipe(socket);
      reply.on('end', () => { socket.end(); upstream.terminate(); });
    });
    upstream.once('open', () => {
      protocols.set(incoming, upstream.protocol);
      // 先接通上游再接受客户端升级；不会缓存未连接时的模型请求。
      wss.handleUpgrade(incoming, socket, head, client => {
        websockets.add(client);
        client.on('error', () => upstream.terminate());
        client.on('close', (code, reason) => {
          websockets.delete(client);
          if (upstream.readyState === WebSocket.OPEN) upstream.close(validClose(code), reason);
        });
        upstream.on('close', (code, reason) => {
          if (client.readyState === WebSocket.OPEN) client.close(validClose(code), reason);
        });
        upstream.on('error', () => client.terminate());
        client.on('message', (raw, binary) => {
          const payload = payloadBuffer(raw);
          let identity;
          if (!binary) {
            try {
              const message = JSON.parse(payload.toString('utf8'));
              if (message.type === 'response.create' && message.generate !== false) {
                const metadata = message.client_metadata;
                // 每条消息独立读取归属；升级请求可能来自预热或前一个回合。
                identity = modelRequestIdentity(metadata?.['x-codex-turn-metadata']) ?? modelRequestIdentity(metadata);
              }
            } catch { /* 非 JSON 消息照常转发，不猜测其归属。 */ }
          }
          const addBytes = identity ? meter.begin(identity) : undefined;
          if (upstream.readyState !== WebSocket.OPEN) { client.close(1011); return; }
          let paused = false;
          upstream.send(payload, { binary, compress: false }, error => {
            if (paused) client.resume();
            if (error) client.terminate(); else addBytes?.(payload.byteLength);
          });
          if (upstream.bufferedAmount > 1024 * 1024) {
            paused = true; client.pause();
          }
        });
        upstream.on('message', (raw, binary) => {
          if (client.readyState !== WebSocket.OPEN) return;
          let paused = false;
          client.send(raw, { binary, compress: false }, error => {
            if (paused) upstream.resume();
            if (error) upstream.terminate();
          });
          if (client.bufferedAmount > 1024 * 1024) { paused = true; upstream.pause(); }
        });
      });
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as import('node:net').AddressInfo).port;
  return {
    meter,
    setAuthMode(authMode: string | null) {
      const chatgpt = ['chatgpt', 'chatgptAuthTokens', 'agentIdentity', 'personalAccessToken'].includes(authMode ?? '');
      for (const entry of registered.values()) if (entry.defaults) entry.target = new URL(chatgpt ? entry.defaults.chatgpt : entry.defaults.api);
    },
    overrides: routes.map((route, index) => [route.key, `http://127.0.0.1:${port}/${secret}/${index}`] as const),
    async close() {
      for (const ws of websockets) ws.terminate();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

function validClose(code: number) {
  return (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) || (code >= 3000 && code <= 4999) ? code : 1011;
}
