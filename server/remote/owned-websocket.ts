import { assertRemoteOperation } from './operation-guard.js';
import WebSocket, { type ClientOptions } from 'ws';
/** ws在CONNECTING取消时可先emit close；归属还必须等待已创建的本机TCP/TLS socket。 */
export function ownedWebSocket(url: string, options: Omit<ClientOptions, 'finishRequest'> = {}): {
  socket: WebSocket;
  closed: Promise<void>;
} {
  assertRemoteOperation();
  const requests: Promise<void>[] = [];
  const socket = new WebSocket(url, { ...options, finishRequest(request) {
    requests.push(new Promise<void>(resolve => {
      let assigned = false;
      request.once('socket', native => {
        assigned = true;
        if (native.closed) resolve();
        else native.once('close', () => resolve());
      });
      request.once('close', () => { if (!assigned) resolve(); });
    }));
    request.end();
  } });
  const closed = new Promise<void>(resolve => socket.once('close', () => resolve()))
    .then(async () => { await Promise.all(requests); });
  return { socket, closed };
}
