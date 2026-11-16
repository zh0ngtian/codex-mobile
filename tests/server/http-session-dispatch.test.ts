// @vitest-environment node
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { HttpSessions } from '../../server/http-session.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
async function localFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sd-local-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const http = createServer(); const wss = new WebSocketServer({ server: http }); const sockets: WebSocket[] = []; const messages: any[] = [];
  let respond = (socket: WebSocket, message: any) => { if (message.method && message.id != null) socket.send(JSON.stringify({ id: message.id, result: { ok: true } })); };
  wss.on('connection', socket => { sockets.push(socket); socket.on('message', bytes => { const message = JSON.parse(bytes.toString()); messages.push(message); respond(socket, message); }); });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { for (const socket of sockets) socket.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); await new Promise<void>(resolve => http.close(() => resolve())); });
  const options = { upstreamUrl: `ws://127.0.0.1:${(http.address() as any).port}`, codexHome: root };
  let sessions = new HttpSessions(options); cleanup.push(() => sessions.close()); const sessionId = randomUUID();
  const init = async () => { const session = (sessions as any).session(sessionId); await session.rpc(randomUUID(), { id: 'init', method: 'initialize', params: {} }); return session; };
  return { root, sessionId, messages, init, get sessions() { return sessions; }, respond(fn: typeof respond) { respond = fn; },
    async restart() { await sessions.close(); sessions = new HttpSessions(options); } };
}
const attemptFor = (sessionId: string, requestId = randomUUID()) => ({ sessionId, requestId, attemptId: randomUUID() });
const write = { id: 'business', method: 'turn/start', params: { threadId: 't' } };
it('可信派发Local新执行发送前失败能证明本次neverSent，伪造结果与其他UUID/session/attempt均拒绝', async () => {
  const f = await localFixture(); const session = await f.init(); const attempt = attemptFor(f.sessionId);
  session.storedOperations = 65_536;
  const result = await f.sessions.dispatchRpc(attempt, write);
  expect(result).toMatchObject({ outcome: 'neverSent', error: { status: 507 } });
  expect(await f.sessions.provesNeverSent(result, attempt)).toBe(true);
  for (const different of [{ ...attempt, requestId: randomUUID() }, { ...attempt, sessionId: randomUUID() }, { ...attempt, attemptId: randomUUID() }]) expect(await f.sessions.provesNeverSent(result, different)).toBe(false);
  expect(await f.sessions.provesNeverSent({ ...result }, attempt)).toBe(false);
  expect(await f.sessions.provesNeverSent(result, { ...attempt })).toBe(false);
  const next = await f.sessions.dispatchRpc(attempt, write); expect(next.outcome).toBe('neverSent');
  expect(await f.sessions.provesNeverSent(result, attempt)).toBe(false);
  expect(await f.sessions.provesNeverSent(next, attempt)).toBe(true);
  expect(await f.sessions.provesNeverSent({ outcome: 'neverSent', error: { mayHaveBeenSent: false } } as any, attempt)).toBe(false);
  await expect(session.operation(attempt.requestId)).rejects.toMatchObject({ status: 404 });
  expect(f.messages.filter(m => m.method === 'turn/start')).toHaveLength(0);
});
it('可信派发Local已提交失败保守unknown，uncertain和重启pending都不生成本次证明', async () => {
  const f = await localFixture(); const session = await f.init(); const attempt = attemptFor(f.sessionId);
  vi.spyOn(session.socket, 'send').mockImplementation(((_bytes: string, callback: (error?: Error) => void) => callback(new Error('local-send-failed'))) as any);
  const result = await f.sessions.dispatchRpc(attempt, write);
  expect(result).toMatchObject({ outcome: 'unknown', error: { code: -32004 } }); expect(await f.sessions.provesNeverSent(result, attempt)).toBe(false);
  const second = await f.sessions.dispatchRpc({ ...attempt, attemptId: randomUUID() }, write); expect(second.outcome).toBe('unknown');
  const path = join(f.root, 'codex-mobile-http', f.sessionId, `${attempt.requestId}.json`); const record = JSON.parse(await readFile(path, 'utf8')); record.status = 'pending'; await writeFile(path, JSON.stringify(record));
  await f.restart(); const restarted = { ...attempt, attemptId: randomUUID() }; const third = await f.sessions.dispatchRpc(restarted, write);
  expect(third.outcome).toBe('unknown'); expect(await f.sessions.provesNeverSent(third, restarted)).toBe(false); expect(f.messages.filter(m => m.method === 'turn/start')).toHaveLength(0);
});
it('可信派发Local cached completed和RPC error均为确定response，签名冲突保持409', async () => {
  const f = await localFixture(); await f.init(); f.respond((socket, message) => { if (message.id != null) socket.send(JSON.stringify({ id: message.id, error: { code: 123, message: 'upstream-rejected' } })); });
  const attempt = attemptFor(f.sessionId); const result = await f.sessions.dispatchRpc(attempt, write);
  expect(result).toMatchObject({ outcome: 'response', message: { id: 'business', error: { code: 123 } } });
  expect((await f.sessions.dispatchRpc({ ...attempt, attemptId: randomUUID() }, write))).toEqual(result);
  expect((await f.sessions.dispatchRpc({ ...attempt, attemptId: randomUUID() }, { ...write, params: { threadId: 'other' } }))).toMatchObject({ outcome: 'unknown', error: { status: 409 } });
  expect(f.messages.filter(m => m.method === 'turn/start')).toHaveLength(1);
});
it('可信派发Local同UUID并发等待原执行失败不能借用其fresh neverSent，清理失败亦不出证明', async () => {
  const f = await localFixture(); const session = await f.init(); let release!: () => void; let entered = false; const gate = new Promise<void>(resolve => { release = resolve; });
  const save = session.save.bind(session); session.storedOperations = 65_536;
  vi.spyOn(session, 'save').mockImplementation(async (operation: any) => { entered = true; await gate; await save(operation); });
  const first = attemptFor(f.sessionId); const one = f.sessions.dispatchRpc(first, write); await vi.waitFor(() => expect(entered).toBe(true));
  const second = { ...first, attemptId: randomUUID() }; const two = f.sessions.dispatchRpc(second, write); await new Promise(resolve => setTimeout(resolve, 20)); release();
  const result = await one; const reused = await two; expect(result.outcome).toBe('neverSent'); expect(reused.outcome).toBe('unknown'); expect(await f.sessions.provesNeverSent(reused, second)).toBe(false);
  const other = await localFixture(); const otherSession = await other.init(); vi.spyOn(otherSession, 'discard').mockRejectedValue(new Error('cleanup-failed'));
  vi.spyOn(otherSession.changeHistory, 'beforeStart').mockImplementation(async () => { await otherSession.close(); });
  const cleanupAttempt = attemptFor(other.sessionId); const cleanupResult = await other.sessions.dispatchRpc(cleanupAttempt, write); expect(cleanupResult.outcome).toBe('unknown');
});
it.each(['signal', 'deadline'] as const)('可信派发Local最后异步收尾%s失效不交付completed正文', async kind => {
  const f = await localFixture(); const session = await f.init(); const original = session.save.bind(session); const abort = new AbortController();
  vi.spyOn(session, 'save').mockImplementation(async (operation: any) => { await original(operation); if (operation.status === 'completed') { if (kind === 'signal') abort.abort(); else await new Promise(resolve => setTimeout(resolve, 100)); } });
  const result = await f.sessions.dispatchRpc(attemptFor(f.sessionId), write, { signal: abort.signal, deadline: performance.now() + (kind === 'deadline' ? 80 : 2000) });
  expect(result.outcome).toBe('unknown'); expect(result).not.toHaveProperty('message');
});

it('可信派发复用既有hosted身份和原UUID收据，旧pending不发neverSent证明', async () => {
  const f = await localFixture(); const sessionId = 'c0dec000-0000-4000-8000-000000000001'; const attempt = attemptFor(sessionId);
  const result = await f.sessions.dispatchRpc(attempt, write); expect(result.outcome).toBe('response');
  expect((await f.sessions.hostedOperation(attempt.requestId)).status).toBe('completed');
  const path = join(f.root, 'codex-mobile-http', sessionId, `${attempt.requestId}.json`); const record = JSON.parse(await readFile(path, 'utf8')); record.status = 'pending'; delete record.message; await writeFile(path, JSON.stringify(record));
  await f.restart(); const second = { ...attempt, attemptId: randomUUID() }; const pending = await f.sessions.dispatchRpc(second, write); expect(pending.outcome).toBe('unknown'); expect(await f.sessions.provesNeverSent(pending, second)).toBe(false);
  expect(f.messages.filter(m => m.method === 'turn/start')).toHaveLength(1);
});

it.each(['signal', 'deadline', 'close'] as const)('可信派发Local零发送证明签发后原%s失效不可继续使用', async kind => {
  const f = await localFixture(); const session = await f.init(); session.storedOperations = 65_536; const abort = new AbortController(); const attempt = attemptFor(f.sessionId);
  const result = await f.sessions.dispatchRpc(attempt, write, { deadline: performance.now() + (kind === 'deadline' ? 150 : 2000), signal: abort.signal }); expect(result.outcome).toBe('neverSent');
  if (kind === 'signal') abort.abort(); else if (kind === 'deadline') await new Promise(resolve => setTimeout(resolve, 180)); else await f.sessions.close();
  expect(await f.sessions.provesNeverSent(result, attempt)).toBe(false);
});
it('可信派发Local异步收尾只使用原attempt快照，调用方修改不换绑Session或UUID', async () => {
  const f = await localFixture(); const session = await f.init(); session.storedOperations = 65_536; const attempt = attemptFor(f.sessionId); const original = { ...attempt }; const save = session.save.bind(session);
  vi.spyOn(session, 'save').mockImplementation(async (operation: any) => { attempt.sessionId = randomUUID(); attempt.requestId = randomUUID(); await save(operation); });
  const result = await f.sessions.dispatchRpc(attempt, write); expect(result.outcome).toBe('neverSent'); expect(await f.sessions.provesNeverSent(result, attempt)).toBe(false);
  Object.assign(attempt, original); expect(await f.sessions.provesNeverSent(result, attempt)).toBe(true);
});
