import { timingSafeEqual } from 'node:crypto';
export function createControlHandler({ token, runtime, requestStop }) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('无效的本机控制凭据');
  const expected = Buffer.from(`Bearer ${token}`);
  const send = (res, code, value) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  return async (req, res) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/__service/')) return false;
    if (req.headers.origin !== undefined) { send(res, 403, { error: 'origin-not-allowed' }); return true; }
    const actual = Buffer.from(req.headers.authorization ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { send(res, 401, { error: 'unauthorized' }); return true; }
    try {
      if (path === '/__service/status' && req.method === 'GET') { send(res, 200, runtime.status()); return true; }
      if (!['/__service/restart', '/__service/stop'].includes(path)) { send(res, 404, { error: 'not-found' }); return true; }
      if (req.method !== 'POST') { send(res, 405, { error: 'method-not-allowed' }); return true; }
      let input = '', size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 1024) { send(res, 413, { error: 'body-too-large' }); return true; } input += chunk; }
      let value;
      try { value = JSON.parse(input || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object' || (value.force !== undefined && typeof value.force !== 'boolean')) throw new Error(); }
      catch { send(res, 400, { error: 'invalid-request' }); return true; }
      const result = path.endsWith('/restart') ? await runtime.restart({ force: value.force === true }) : await runtime.prepareStop({ force: value.force === true });
      send(res, result.changed ? 200 : result.reason === 'update-failed' ? 503 : 409, result);
      if (result.changed && path.endsWith('/stop')) setImmediate(requestStop);
    } catch { send(res, 503, { error: 'service-operation-failed' }); }
    return true;
  };
}
