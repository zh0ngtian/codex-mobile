import { WebSocket } from 'ws';

export class RpcClient {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map();
    socket.on('message', (bytes) => {
      let value; try { value = JSON.parse(bytes.toString()); } catch { socket.terminate(); return; }
      if (value.method) {
        if (Object.hasOwn(value, 'id')) socket.send(JSON.stringify({ id: value.id, error: { code: -32601, message: 'Monitor does not handle approvals' } }));
        return;
      }
      const entry = this.pending.get(value.id);
      if (entry) {
        this.pending.delete(value.id); clearTimeout(entry.timer);
        if (value.error) entry.reject(new Error('上游 RPC 查询失败')); else entry.resolve(value.result);
      }
    });
    const fail = () => { for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('上游连接断开')); } this.pending.clear(); };
    socket.on('error', fail); socket.on('close', fail);
  }
  static async connect(url) {
    const socket = new WebSocket(url, { handshakeTimeout: 5000 });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const client = new RpcClient(socket);
    try {
      await client.request('initialize', { clientInfo: { name: 'codex_mobile_service', title: 'Codex Mobile service monitor', version: '1' }, capabilities: { experimentalApi: true } });
      socket.send(JSON.stringify({ method: 'initialized' }));
      return client;
    } catch (error) { client.close(); throw error; }
  }
  request(method, params = {}, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) { reject(new Error('上游未连接')); return; }
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('上游 RPC 查询超时')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }), (error) => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error('上游 RPC 发送失败')); } });
    });
  }
  close() { this.socket.terminate(); }
}
