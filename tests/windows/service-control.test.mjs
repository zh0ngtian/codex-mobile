import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createControlHandler } from '../../scripts/windows/service/control.mjs';

test('本机控制接口需要独立凭据，拒绝网页来源且错误输出不包含敏感信息', async () => {
  const token = 'a'.repeat(64);
  const runtime = { status: () => ({ ready: true, currentVersion: 'old' }), restart: async () => { throw new Error('secret-content'); } };
  const handler = createControlHandler({ token, runtime, requestStop: () => {} });
  const server = createServer(async (req, res) => { if (!(await handler(req, res))) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}/__service/`;
  try {
    assert.equal((await fetch(base + 'status')).status, 401);
    assert.equal((await fetch(base + 'status', { headers: { authorization: `Bearer ${token}`, origin: 'http://evil.invalid' } })).status, 403);
    const status = await fetch(base + 'status', { headers: { authorization: `Bearer ${token}` } }); assert.equal(status.status, 200); assert.equal((await status.json()).ready, true);
    const failed = await fetch(base + 'restart', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' });
    assert.equal(failed.status, 503); assert.equal((await failed.text()).includes('secret-content'), false);
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
});

test('并发更新或忙碌时控制接口明确拒绝，不把请求当作重启成功', async () => {
  const token = 'b'.repeat(64), runtime = { restart: async () => ({ changed: false, reason: 'operation-in-progress' }) };
  const handler = createControlHandler({ token, runtime, requestStop: () => {} });
  const server = createServer(async (req, res) => { await handler(req, res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/__service/restart`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' });
    assert.equal(response.status, 409); assert.equal((await response.json()).changed, false);
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
});
