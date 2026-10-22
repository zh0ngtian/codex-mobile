// 专用于独立模拟器的协议边界；不启动模型、不访问真实会话或生产网关。
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { createGateway } from '../../../server/gateway.js';
import { DESKTOP_PINNED_SECTION_ID as PIN } from '../../../server/desktop-thread-pins.js';
const root = await mkdtemp(join(tmpdir(), 'codex-pin-ui-'));
let pinned = true, writes = 0;
const id = '01984de2-8f74-7c91-a3b2-5c5e937cf319';
const thread = () => ({ id, name: '桌面同步验收', preview: '独立协议夹具', cwd: '', createdAt: 1, updatedAt: 2, recencyAt: 2,
 status: { type: 'idle' }, section: pinned ? { id: PIN, name: 'Pinned', appearance: null } : null });
const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await new Promise<void>(resolve => upstream.once('listening', resolve));
upstream.on('connection', socket => socket.on('message', raw => {
 const { id: requestId, method, params } = JSON.parse(raw.toString()); if (requestId == null) return;
 let result: any = { data: [], nextCursor: null };
 if (method === 'initialize') result = { userAgent: 'codex/0.163.0-alpha.11' };
 else if (method === 'threadSection/list') result.data = [{ id: PIN, name: 'Pinned' }];
 else if (method === 'thread/list') result.data = params.sectionId ? (pinned ? [thread()] : []) : [thread()];
 else if (method === 'thread/read') result = { thread: thread() };
 else if (method === 'thread/resume') result = { thread: thread(), model: 'test', initialTurnsPage: { data: [], nextCursor: null } };
 else if (method === 'thread/section/move') { pinned = params.sectionId === PIN; writes++; result = {}; }
 else if (method === 'thread/archive') { pinned = false; result = {}; }
 else if (method === 'model/list') result.data = [{ model: 'test', displayName: 'Test', isDefault: true, supportedReasoningEfforts: [] }];
 else if (method === 'permissionProfile/list') result.data = [{ id: ':read-only', allowed: true }];
 else if (method === 'config/read') result = { config: { model: 'test', sandbox_mode: 'read-only' } };
 socket.send(JSON.stringify({ id: requestId, result }));
}));
const gateway = await createGateway({ host: '127.0.0.1', port: 0, mode: 'external', staticDir: null, upstreamUrl: `ws://127.0.0.1:${(upstream.address() as any).port}`, codexHome: root,
 displayName: '验收 Mac', readProjectState: async () => ({ projects: [], projectlessThreadIds: [id] }) });
const control = createServer((req, res) => { const url = new URL(req.url!, 'http://localhost'); if (url.searchParams.has('pinned')) pinned = url.searchParams.get('pinned') === 'true'; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ pinned, writes })); });
await new Promise<void>(resolve => control.listen(0, '127.0.0.1', resolve));
console.log(JSON.stringify({ gateway: `http://127.0.0.1:${gateway.port}?token=desktop-pin-fixture`, control: `http://127.0.0.1:${(control.address() as any).port}` }));
const close = async () => { await gateway.close(); for (const socket of upstream.clients) socket.terminate(); await new Promise<void>(resolve => upstream.close(() => resolve())); await new Promise<void>(resolve => control.close(() => resolve())); await rm(root, { recursive: true, force: true }); process.exit(); };
process.on('SIGTERM', close); process.on('SIGINT', close);
