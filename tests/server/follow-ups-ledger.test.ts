// @vitest-environment node
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { FollowUps } from '../../server/follow-ups.js';
import { OperationScheduler } from '../../server/operation-scheduler.js';
import { HttpSessions, HOSTED_SESSION_ID } from '../../server/http-session.js';
import { TargetResolver } from '../../server/targets.js';
import { withRemoteOperation } from '../../server/remote/operation-guard.js';

const cleanup: (() => unknown)[] = [];
let qualityEvidence = 0;
afterEach(async ({ task }) => {
  if (task.name.startsWith('QUALITY Q')) {
    const sequence = ++qualityEvidence;
    for (const name of ['Q1-outcome.json', 'Q1-durable-preparation.json', 'Q2-outcome.json', 'Q2-real-old-source.json']) {
      const bytes = await readFile(join(process.env.HOME!, name)).catch(() => undefined);
      if (bytes) await writeFile(join(process.env.HOME!, `QUALITY-${sequence}-${name}`), bytes);
    }
  }
  for (const close of cleanup.splice(0).reverse()) await close();
});
const canonical = (v: any): string => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',') + '}' : JSON.stringify(v);
function legacy(state = 'queued', overrides: any = {}) {
  const content = { threadId: 'thread', inputText: '原正文', text: '原预览', attachmentCount: 0, extraInput: [], settings: { model: '原模型' } };
  return { ...content, id: randomUUID(), operationId: randomUUID(), fingerprint: createHash('sha256').update(canonical(content)).digest('hex'), state, revision: 7, ...overrides };
}
async function fixture(records: any[] = [], attemptTimeoutMs = 2000) {
  const root = await mkdtemp(join(tmpdir(), 'h-ledger-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'ledger'); const legacyDirectory = join(root, 'codex-mobile-follow-ups'); await mkdir(legacyDirectory, { mode: 0o700 });
  const path = join(legacyDirectory, 'queue.json'); const source = JSON.stringify({ version: 1, records }); await writeFile(path, source, { mode: 0o600 });
  const active = new Map<string, string>([['thread', 'original-turn']]); const received: any[] = []; let reject = false;
  let afterMessage = (_message: any) => {}; let drop = false, dropRead = false; let errorMessage = '真实错误';
  const http = createServer(); const ws = new WebSocketServer({ server: http });
  ws.on('connection', socket => socket.on('message', data => {
    const m = JSON.parse(data.toString()); received.push(m); if (m.id == null || !m.method) return;
    if (drop && ['turn/start', 'turn/steer'].includes(m.method)) return;
    if (dropRead && m.method === 'thread/read') return;
    const threadId = m.params?.threadId; const turn = active.get(threadId); let result: any = {};
    if (['thread/read', 'thread/resume'].includes(m.method)) result = { thread: { id: threadId, status: { type: turn ? 'active' : 'idle' } } };
    if (m.method === 'thread/turns/list') result = { data: turn ? [{ id: turn, status: 'inProgress' }] : [] };
    if (['turn/start', 'turn/steer'].includes(m.method) && !reject) { const id = m.method === 'turn/steer' ? turn : randomUUID(); active.set(threadId, id!); result = { turnId: id, turn: { id } }; }
    socket.send(JSON.stringify({ id: m.id, ...(reject && ['turn/start', 'turn/steer'].includes(m.method) ? { error: { code: -1, message: errorMessage } } : { result }) }));
    afterMessage(m);
  }));
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  cleanup.push(async () => { for (const socket of ws.clients) socket.terminate(); await new Promise<void>(r => ws.close(() => r())); await new Promise<void>(r => http.close(() => r())); });
  const identity = { version: 1 as const, gatewayId: 'h-gateway', localHostId: 'h-local' }; const resolver = new TargetResolver({ identity });
  const options = { directory, gatewayId: identity.gatewayId, gatewayCodexHome: root, resolver, upstreamUrl: `ws://127.0.0.1:${(http.address() as any).port}`, attemptTimeoutMs, scanIntervalMs: 100_000, remoteConsumers: () => { throw new Error('禁止Remote'); } };
  const scheduler = new OperationScheduler(options); cleanup.push(() => scheduler.close());
  const sessions = new HttpSessions({ codexHome: root, upstreamUrl: options.upstreamUrl }); cleanup.push(() => sessions.close());
  const subscribed = vi.spyOn(sessions, 'subscribeHosted');
  const open = async (value = scheduler, home = root) => {
    expect(value).toHaveProperty('openFollowUps', expect.any(Function));
    const facade = await FollowUps.open(home, sessions, { scheduler: value }); cleanup.push(() => facade.close()); return facade;
  };
  const disk = async () => JSON.parse(await readFile(join(directory, 'operations.json'), 'utf8'));
  const serve = async (facade: FollowUps) => {
    const api = createServer((request, response) => { void facade.handle(request, response); }); await new Promise<void>(r => api.listen(0, '127.0.0.1', r));
    cleanup.push(() => new Promise<void>(r => api.close(() => r()))); const url = `http://127.0.0.1:${(api.address() as any).port}`;
    return { url, list: async () => (await (await fetch(url)).json() as any).items, post: (body: any) => fetch(url, { method: 'POST', body: JSON.stringify(body) }) };
  };
  return { root, directory, path, source, records, active, received, options, resolver, scheduler, sessions, subscribed, open, disk, serve, sockets: ws.clients, reject(value: boolean) { reject = value; }, error(value: string) { errorMessage = value; }, drop(value: boolean) { drop = value; }, dropRead(value: boolean) { dropRead = value; }, after(fn: typeof afterMessage) { afterMessage = fn; } };
}

it('接管整批v1保留原id、上游UUID、revision、原数组顺序和终态收据，旧owner完全不启动', async () => {
  const records = ['queued', 'failed', 'uncertain', 'sent', 'cancelled'].map((state, n) => legacy(state, { threadId: `t-${n}` }));
  const f = await fixture(records); await f.open(); const disk = await f.disk();
  expect(f.subscribed).not.toHaveBeenCalled(); expect(disk.records).toHaveLength(5);
  expect(disk.records.map((r: any) => r.id)).toEqual(records.map(r => r.id));
  expect(disk.records.map((r: any) => r.revision)).toEqual(records.map(r => r.revision));
  expect(disk.records.map((r: any) => r.receiveOrder)).toEqual([1, 2, 3, 4, 5]);
  for (let i = 0; i < records.length; i++) expect(disk.records[i].followUp).toMatchObject({ fingerprint: records[i].fingerprint, operationId: records[i].operationId });
  expect(await readFile(f.path, 'utf8')).toBe(f.source); expect(disk.followUpsImport).toBeDefined();
});
it('真实idle才发送普通追问，ACK后下一项仍等实际turn完成，原epoch仅resume一次', async () => {
  const a = legacy(), b = legacy(); const f = await fixture([a, b]); await f.open();
  await f.scheduler.runOnce(); expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(0);
  f.active.delete('thread'); await f.scheduler.runOnce();
  const starts = () => f.received.filter(m => m.method === 'turn/start'); expect(starts()).toHaveLength(1); expect(starts()[0].params.clientUserMessageId).toBe(a.id);
  expect(starts()[0].params.model).toBe(a.settings.model); expect(starts()[0].params.input[0].text).toBe(a.inputText);
  await f.scheduler.runOnce(); expect(starts()).toHaveLength(1);
  f.active.delete('thread'); await f.scheduler.runOnce(); expect(starts()).toHaveLength(2);
  expect(f.received.filter(m => m.method === 'thread/resume')).toHaveLength(1);
  expect(f.received.filter(m => m.method === 'thread/read').every(m => m.params.includeTurns === false)).toBe(true);
  const wal = JSON.parse(await readFile(join(f.root, 'codex-mobile-http', HOSTED_SESSION_ID, `${a.operationId}.json`), 'utf8'));
  expect(wal.status).toBe('completed'); expect(wal.requestId).not.toBe(a.id); expect((await f.disk()).records[0]).not.toHaveProperty('body');
});
it('HTTP新增先耐久再确认；重复原请求幂等，失败retry稳定公共id并更新上游UUID', async () => {
  const f = await fixture(); const api = await f.serve(await f.open()); const original = legacy();
  const body = { ...original, action: 'enqueue' }; expect((await api.post(body)).status).toBe(200);
  expect((await f.disk()).records[0].id).toBe(body.id); expect((await api.post(body)).status).toBe(200);
  f.active.delete('thread'); f.reject(true); await f.scheduler.runOnce(); let item = (await api.list())[0]; expect(item.state).toBe('failed');
  for (const action of ['edit', 'cancel']) expect((await api.post({ action, id: item.id, revision: item.revision, inputText: 'x', text: 'x', mentions: [] })).status).toBe(409);
  const oldOperation = (await f.disk()).records[0].followUp.operationId; f.reject(false);
  expect((await api.post({ action: 'retry', id: item.id, revision: item.revision })).status).toBe(200);
  expect((await f.disk()).records[0].followUp.operationId).not.toBe(oldOperation); await f.scheduler.runOnce();
  expect(await api.list()).toEqual([]); expect(f.received.filter(m => m.method === 'turn/start').every(m => m.params.clientUserMessageId === body.id)).toBe(true);
});
it.each(['queued', 'failed'])('B立即引导越过%s的A，返回真实turnId且A继续等待', async state => {
  const a = legacy(state), b = legacy(); const f = await fixture([a, b]); const api = await f.serve(await f.open());
  const response = await api.post({ action: 'steer', id: b.id, revision: b.revision }); expect({ status: response.status, response: await response.clone().json(), lastError: String(f.scheduler.lastError) }).toMatchObject({ status: 200 }); expect(await response.json()).toMatchObject({ turnId: 'original-turn' });
  expect(f.received.filter(m => m.method === 'turn/steer')).toMatchObject([{ params: { expectedTurnId: 'original-turn', clientUserMessageId: b.id } }]);
  expect(f.received.filter(m => m.method === 'turn/start')).toEqual([]); expect((await api.list())[0]).toMatchObject({ id: a.id, state });
});
it('引导耐久固定原turn，发送前已失效则明确失败且绝不改投新turn/start', async () => {
  const b = legacy(); const f = await fixture([b]); const api = await f.serve(await f.open()); let observed = false;
  f.after(m => { if (m.method === 'thread/turns/list' && !observed) { observed = true; f.active.set('thread', 'replacement-turn'); } });
  expect((await api.post({ action: 'steer', id: b.id, revision: b.revision })).status).toBe(409);
  expect(f.received.filter(m => ['turn/start', 'turn/steer'].includes(m.method))).toEqual([]);
  expect((await api.list())[0]).toMatchObject({ id: b.id, state: 'failed' });
});
it.each(['completed', 'error', 'pending', 'uncertain', 'missing', 'corrupt', 'io'])('旧sending仅按原UUID的真实WAL %s恢复', async status => {
  const item = legacy('sending', { method: 'turn/start' }); const f = await fixture([item]); const walDirectory = join(f.root, 'codex-mobile-http', HOSTED_SESSION_ID); await mkdir(walDirectory, { recursive: true });
  const path = join(walDirectory, `${item.operationId}.json`);
  if (status === 'io') await mkdir(path);
  else if (status === 'corrupt') await writeFile(path, '{bad');
  else if (status !== 'missing') await writeFile(path, JSON.stringify({ requestId: item.operationId, signature: 'a'.repeat(64), status: ['completed', 'error'].includes(status) ? 'completed' : status, ...(['completed', 'error'].includes(status) ? { message: { id: item.operationId, ...(status === 'error' ? { error: { message: '原错误' } } : { result: { turnId: 'old' } }) } } : {}) }));
  await f.open(); await f.scheduler.runOnce(); const api = await f.serve(await f.open()); const items = await api.list();
  const expected = ({ completed: undefined, error: 'failed', pending: 'uncertain', uncertain: 'uncertain', missing: 'queued', corrupt: 'sending', io: 'sending' } as any)[status];
  if (expected) expect(items[0]).toMatchObject({ id: item.id, state: expected }); else expect(items).toEqual([]);
  expect(f.received.filter(m => ['turn/start', 'turn/steer'].includes(m.method))).toEqual([]);
  if (['pending', 'uncertain'].includes(status)) expect((await api.post({ action: 'cancel', id: item.id, revision: items[0].revision })).status).toBe(409);
  if (['pending', 'uncertain'].includes(status)) expect((await f.disk()).records[0].followUp).not.toHaveProperty('error');
});
it('legacy未知对账保留原error，显示提示不作为新持久字段扩大生命周期字节', async () => {
  const item = legacy('sending', { error: '原恢复错误' }); const f = await fixture([item]); f.drop(true);
  const send = f.sessions.hostedRpc({ id: item.operationId, method: 'turn/start', params: { threadId: 'thread' } }, item.operationId, { deadline: performance.now() + 100 }).catch(() => undefined);
  await vi.waitFor(() => expect(f.received.some(m => m.method === 'turn/start')).toBe(true)); await send;
  const api = await f.serve(await f.open()); await f.scheduler.runOnce(); expect((await api.list())[0]).toMatchObject({ state: 'uncertain', error: '原恢复错误' });
  expect((await f.disk()).records[0].followUp.error).toBe('原恢复错误');
});
it('旧steer真404恢复原failed而非猜测当前turn，保留原公共id与中间态字段', async () => {
  const item = legacy('sending', { method: 'turn/steer', restoreState: 'failed' }); const f = await fixture([item]); const api = await f.serve(await f.open()); await f.scheduler.runOnce();
  expect((await api.list())[0]).toMatchObject({ id: item.id, state: 'failed' }); expect((await f.disk()).records[0].followUp.operationId).toBe(item.operationId);
  expect(f.received).toEqual([]);
});
it('导入fsync故障不启动旧owner、不发RPC，重开只采用同一ledger事务', async () => {
  const f = await fixture([legacy()]); const handle = await open(f.path, 'r'); const proto = Object.getPrototypeOf(handle); await handle.close();
  const sync = vi.spyOn(proto, 'sync').mockRejectedValueOnce(new Error('导入sync故障'));
  try { await expect(f.open()).rejects.toThrow(); } finally { sync.mockRestore(); }
  expect(f.subscribed).not.toHaveBeenCalled(); expect(f.received).toEqual([]); expect(await readFile(f.path, 'utf8')).toBe(f.source);
  const reopened = new OperationScheduler(f.options); cleanup.push(() => reopened.close()); await f.open(reopened); expect((await f.disk()).records).toHaveLength(1);
});
it('容量整批拒绝原文件不丢，普通RPC UUID碰撞不能覆盖', async () => {
  const records = Array.from({ length: 129 }, () => legacy()); const f = await fixture(records); await expect(f.open()).rejects.toThrow(); expect(await readFile(f.path, 'utf8')).toBe(f.source);
  await expect(readFile(join(f.directory, 'operations.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  const one = await fixture([legacy()]); await one.scheduler.submit({ id: one.records[0].id, context: await one.resolver.operationContext(), conversationId: 'thread', sessionId: HOSTED_SESSION_ID, requestId: randomUUID(), message: { id: randomUUID(), method: 'thread/read', params: { threadId: 'thread' } }, settings: {}, attachmentRefs: [] });
  await expect(one.open()).rejects.toThrow(); expect((await one.disk()).records[0]).not.toHaveProperty('followUp');
});
it('同source并发接管及重复open只导入一次，保全后旧文件变化不能重新覆盖ledger', async () => {
  const record = legacy(); const f = await fixture([record]);
  const other = new OperationScheduler(f.options); cleanup.push(() => other.close()); await Promise.all([f.open(), f.open(other)]);
  await writeFile(f.path, '{保全后的文件已变化'); await f.open(); expect((await f.disk()).records).toHaveLength(1);
});
it('不同canonical home与不合法v1均拒绝接管并保全原文件', async () => {
  const f = await fixture([legacy()]); const foreign = await mkdtemp(join(tmpdir(), 'h-foreign-')); cleanup.push(() => rm(foreign, { recursive: true, force: true }));
  await expect(f.open(f.scheduler, foreign)).rejects.toThrow(); expect(await readFile(f.path, 'utf8')).toBe(f.source);
  await writeFile(f.path, JSON.stringify({ version: 1, records: [legacy('invalid')] })); await expect(f.open()).rejects.toThrow();
  await expect(readFile(join(f.directory, 'operations.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('HTTP读取和queued编辑保留接收指纹、附件设置与CAS，取消只修改ledger', async () => {
  const image = { type: 'image', url: 'data:image/png;base64,eA==' }; const record = legacy('queued', { extraInput: [image, { type: 'skill', name: '旧', path: '/old' }], attachmentCount: 1 });
  const f = await fixture([record]); const api = await f.serve(await f.open());
  expect(await api.list()).toMatchObject([{ id: record.id, inputText: record.inputText, revision: 7 }]);
  expect((await api.post({ action: 'edit', id: record.id, revision: 7, inputText: '编辑', text: '编辑预览', mentions: [{ type: 'mention', name: '新', path: 'plugin://new' }] })).status).toBe(200);
  const saved = (await f.disk()).records[0]; expect(saved.followUp.fingerprint).toBe(record.fingerprint); expect(saved.settings).toEqual(record.settings);
  expect((await api.post({ action: 'cancel', id: record.id, revision: 7 })).status).toBe(409);
  const item = (await api.list())[0]; expect((await api.post({ action: 'cancel', id: record.id, revision: item.revision })).status).toBe(200);
  expect(await api.list()).toEqual([]); expect(await readFile(f.path, 'utf8')).toBe(f.source);
});
it.each(['completed', 'error', 'pending', 'uncertain'])('真实旧HttpSessions生成%s原WAL后接管不重复发送', async status => {
  const item = legacy('sending', { method: 'turn/start' }); const f = await fixture([item]); f.reject(status === 'error'); f.drop(['pending', 'uncertain'].includes(status));
  const send = f.sessions.hostedRpc({ id: item.operationId, method: 'turn/start', params: { threadId: item.threadId, input: [{ type: 'text', text: item.inputText }], clientUserMessageId: item.id } }, item.operationId, { deadline: performance.now() + 1000 }).catch(() => undefined);
  const walPath = join(f.root, 'codex-mobile-http', HOSTED_SESSION_ID, `${item.operationId}.json`);
  if (status === 'pending') {
    for (let i = 0; i < 100; i++) { try { if (JSON.parse(await readFile(walPath, 'utf8')).status === 'pending' && f.received.filter(m => m.method === 'turn/start').length === 1) break; } catch {} await new Promise(r => setTimeout(r, 10)); }
    expect(JSON.parse(await readFile(walPath, 'utf8')).status).toBe('pending');
  } else await send;
  if (status === 'uncertain') expect(JSON.parse(await readFile(walPath, 'utf8')).status).toBe('uncertain');
  const before = f.received.filter(m => m.method === 'turn/start').length; expect(before).toBe(1);
  await f.open(); await f.scheduler.runOnce(); expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(before);
  const api = await f.serve(await f.open()); const items = await api.list();
  if (status === 'completed') expect(items).toEqual([]); else expect(items[0].state).toBe(status === 'error' ? 'failed' : 'uncertain');
  await send;
});
it('真实OS进程并发接管及两次重启同一source只发送一次', async () => {
  const f = await fixture([legacy()]); f.active.delete('thread');
  const worker = async () => {
    const argv = [process.execPath, '--import', 'tsx', new URL('./fixtures/follow-ups-ledger-worker.ts', import.meta.url).pathname, f.root, f.options.upstreamUrl]; const env = { ...process.env }; const cwd = process.cwd();
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    const exit = await new Promise<number | null>(resolve => child.on('exit', resolve));
    await writeFile(join(process.env.HOME!, `os-worker-${randomUUID()}.json`), JSON.stringify({ argv, cwd, env, exit, stdout, stderr, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr), stdoutSha256: createHash('sha256').update(stdout).digest('hex'), stderrSha256: createHash('sha256').update(stderr).digest('hex') }));
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' }); return JSON.parse(stdout);
  };
  await Promise.all([worker(), worker()]); expect((await worker()).items).toEqual([]); expect((await worker()).items).toEqual([]);
  expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(1); expect((await f.disk()).records).toHaveLength(1);
});
it('耐久绑定后的引导对外sending且不可再edit/cancel/retry/steer', async () => {
  const b = legacy(); const f = await fixture([b]); const api = await f.serve(await f.open());
  const run = f.scheduler.runOnce.bind(f.scheduler); let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let entered = false;
  const wrapped = vi.spyOn(f.scheduler, 'runOnce').mockImplementation(async () => { entered = true; await gate; return run(); });
  const pending = api.post({ action: 'steer', id: b.id, revision: b.revision });
  for (let i = 0; i < 100 && !entered; i++) await new Promise(r => setTimeout(r, 10)); expect(entered).toBe(true);
  try {
    const item = (await api.list())[0]; expect(item.state).toBe('sending');
    for (const action of ['edit', 'cancel', 'retry', 'steer']) expect((await api.post({ action, id: item.id, revision: item.revision, inputText: '改投', text: '改投', mentions: [] })).status).toBe(409);
  } finally { release(); wrapped.mockRestore(); }
  expect((await pending).status).toBe(200);
});
it('HTTP实际交付前scheduler关闭不得泄露已读items正文', async () => {
  const f = await fixture([legacy()]); const api = await f.serve(await f.open()); const original = f.scheduler.listFollowUps.bind(f.scheduler);
  const wrapper = vi.spyOn(f.scheduler, 'listFollowUps').mockImplementation((...args) => original(...args).then(value => { queueMicrotask(() => { void f.scheduler.close(); }); return value; }));
  try { const items = await api.list(); expect(items).toBeUndefined(); } finally { wrapper.mockRestore(); }
});
it.each([false, true])('近64MiB按确定必需字节接收/拒绝，真实成功或完整无界error结算=%s', async fail => {
  const f = await fixture([], 30_000); const api = await f.serve(await f.open());
  const size = 16 * 1024 * 1024 - 6000; const body = legacy('queued', { extraInput: [{ type: 'image', url: 'x'.repeat(size) }], attachmentCount: 1 });
  for (let i = 0; i < 4; i++) expect((await api.post({ ...body, action: 'enqueue', id: randomUUID(), threadId: `big-${i}` })).status).toBe(200);
  const disk = await f.disk(); const bytes = (value: any) => Buffer.byteLength(JSON.stringify(value));
  const future = (record: any) => ({ ...record, revision: Number.MAX_SAFE_INTEGER, state: 'uncertain', claimToken: '00000000-0000-0000-0000-000000000000', claimPid: Number.MAX_SAFE_INTEGER,
    followUp: { ...record.followUp, method: 'turn/start' }, rpcReceipt: { sessionId: HOSTED_SESSION_ID, requestId: record.followUp.operationId, signature: 'a'.repeat(64) } });
  const used = disk.records.reduce((n: number, record: any) => n + bytes(future(record)), 0);
  const template = structuredClone(disk.records[0]); template.id = randomUUID(); template.receiveOrder = 5; template.conversationId = 'small'; template.body.extraInput[0].url = '';
  const budget = 64 * 1024 * 1024; const fillSize = budget - used - bytes(future(template)); expect(fillSize).toBeGreaterThan(0);
  const fill = { ...body, action: 'enqueue', id: template.id, threadId: template.conversationId, extraInput: [{ type: 'image', url: 'z'.repeat(fillSize) }] };
  expect(used + bytes(future({ ...template, body: { ...template.body, extraInput: fill.extraInput } }))).toBe(budget);
  expect((await api.post(fill)).status).toBe(200);
  expect((await api.post({ ...legacy(), action: 'enqueue', id: randomUUID() })).status).toBe(429);
  f.active.set('small', '原"\\\n'.repeat(12_000));
  expect((await api.post({ action: 'steer', id: fill.id, revision: 1 })).status).toBe(429);
  expect((await f.disk()).records[4]).toMatchObject({ revision: 1, state: 'queued' }); f.active.delete('small');
  const fullError = '错"\\\n'.repeat(12_000); f.reject(fail); f.error(fullError);
  await f.scheduler.runOnce(); expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(5);
  expect((await f.disk()).records.every((r: any) => r.state === (fail ? 'failed' : 'succeeded'))).toBe(true);
  if (fail) { const items = await api.list(); expect(items).toHaveLength(5); expect(items.every((r: any) => r.error === fullError)).toBe(true); }
}, 60_000);
it.each(['sent', 'cancelled'])('旧真实最小%s收据保留，按旧HTTP正文重交幂等且冲突409', async state => {
  const original = legacy(state); const { id, fingerprint, threadId, revision, operationId } = original;
  const f = await fixture([{ id, fingerprint, threadId, revision, operationId, state }]); const api = await f.serve(await f.open());
  const body = { ...original, action: 'enqueue' };
  expect((await api.post(body)).status).toBe(200); expect(await api.list()).toEqual([]);
  expect((await api.post({ ...body, inputText: '冲突' })).status).toBe(409);
  expect(f.received).toEqual([]); expect((await f.disk()).records[0].followUp).not.toHaveProperty('inputText');
});
it.each(['missing', 'corrupt', 'io', 'signature'])('新failed完整错误仅原WAL读取，%s不可伪成功或空错误', async damage => {
  const f = await fixture([legacy()]); const api = await f.serve(await f.open()); f.active.clear(); f.reject(true); await f.scheduler.runOnce();
  const record = (await f.disk()).records[0]; expect(record.followUp).not.toHaveProperty('error'); expect((await api.list())[0].error).toBe('真实错误');
  const path = join(f.root, 'codex-mobile-http', HOSTED_SESSION_ID, `${record.followUp.operationId}.json`);
  if (damage === 'signature') { const value = JSON.parse(await readFile(path, 'utf8')); value.signature = 'b'.repeat(64); await writeFile(path, JSON.stringify(value)); }
  else { await rm(path); if (damage === 'corrupt') await writeFile(path, '{'); if (damage === 'io') await mkdir(path); }
  const response = await fetch(api.url); expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty('items');
});
it('失败的旧steer不阻用户再次明确引导，仍绑定真实原回合', async () => {
  const a = legacy('failed', { method: 'turn/steer' }), b = legacy(); const f = await fixture([a, b]); const api = await f.serve(await f.open());
  // 原数据没有expectedTurnId，不补猜；这里先用真实动作形成已绑定但失效的失败项。
  let once = false; f.after(m => { if (!once && m.method === 'thread/turns/list') { once = true; f.active.set('thread', 'changed'); } });
  expect((await api.post({ action: 'steer', id: a.id, revision: a.revision })).status).toBe(409); f.after(() => {});
  expect((await api.post({ action: 'steer', id: b.id, revision: b.revision })).status).toBe(200);
  expect(f.received.filter(m => m.method === 'turn/steer')).toMatchObject([{ params: { expectedTurnId: 'changed', clientUserMessageId: b.id } }]);
});
it.each(['utf8', 'unknown-field', 'count', 'duplicate', 'array-id', 'array-operationId', 'array-fingerprint'])('损坏或不合法v1 %s整批拒绝且保全', async kind => {
  const item = legacy(); const f = await fixture();
  const records = kind === 'duplicate' ? [item, item] : [{ ...item, ...(kind === 'unknown-field' ? { unexpected: true } : {}), ...(kind === 'count' ? { attachmentCount: 1 } : {}) }];
  if (kind.startsWith('array-')) { const field = kind.slice(6) as keyof typeof item; (records[0] as any)[field] = [item[field]]; }
  const bytes = kind === 'utf8' ? Buffer.concat([Buffer.from('{"version":1,"records":[],"bad":"'), Buffer.from([0xff]), Buffer.from('"}')]) : Buffer.from(JSON.stringify({ version: 1, records }));
  await writeFile(f.path, bytes); await expect(f.open()).rejects.toThrow(); expect(await readFile(f.path)).toEqual(bytes);
  await expect(readFile(join(f.directory, 'operations.json'))).rejects.toMatchObject({ code: 'ENOENT' }); expect(f.subscribed).not.toHaveBeenCalled();
});
it('marker同source不同Local context拒绝，原ledger和源文件不改', async () => {
  const f = await fixture([legacy()]); await f.open(); const before = await readFile(join(f.directory, 'operations.json'));
  const resolver = new TargetResolver({ identity: { version: 1, gatewayId: 'h-gateway', localHostId: 'different-local' } });
  const other = new OperationScheduler({ ...f.options, resolver }); cleanup.push(() => other.close());
  await expect(f.open(other)).rejects.toThrow(); expect(await readFile(join(f.directory, 'operations.json'))).toEqual(before); expect(await readFile(f.path, 'utf8')).toBe(f.source);
});
it('普通RPC与追问同ledger排序，忙会话不阻其他会话，重连真实epoch重新resume一次', async () => {
  const a = legacy(); const f = await fixture([a]); await f.open(); const context = await f.resolver.operationContext();
  const submit = (conversationId: string) => f.scheduler.submit({ id: randomUUID(), context, conversationId, sessionId: HOSTED_SESSION_ID, requestId: randomUUID(), message: { id: randomUUID(), method: 'turn/start', params: { threadId: conversationId, input: [] } }, settings: {}, attachmentRefs: [] });
  await submit('thread'); await submit('other'); await f.scheduler.runOnce(); expect(f.received.filter(m => m.method === 'turn/start').map(m => m.params.threadId)).toEqual(['other']);
  for (const socket of f.sockets) socket.terminate(); await new Promise(r => setTimeout(r, 25));
  await f.scheduler.runOnce(); expect(f.received.filter(m => m.method === 'thread/resume' && m.params.threadId === 'thread')).toHaveLength(2);
  f.active.delete('thread'); await f.scheduler.runOnce(); expect(f.received.filter(m => m.method === 'turn/start' && m.params.threadId === 'thread').map(m => m.params.clientUserMessageId)).toEqual([a.id, undefined]);
});
it('实际Session广播mobile/turn/accepted且HTTPsteer保留原输入与公共id', async () => {
  const b = legacy(); const f = await fixture([b]); const api = await f.serve(await f.open()); const context = await f.resolver.operationContext(), sessionId = randomUUID();
  await f.scheduler.protocol({ context, sessionId, requestId: randomUUID(), message: { id: 1, method: 'initialize', params: { clientInfo: { name: 'h', version: '1' } } } });
  await f.scheduler.protocol({ context, sessionId, requestId: randomUUID(), message: { method: 'initialized' } });
  expect((await api.post({ action: 'steer', id: b.id, revision: b.revision })).status).toBe(200);
  const events = await f.scheduler.events(context, sessionId, 0); expect(events.messages.find(m => m.method === 'mobile/turn/accepted')).toEqual({ method: 'mobile/turn/accepted', params: { request: { method: 'turn/steer', params: { threadId: 'thread', expectedTurnId: 'original-turn' } }, response: { result: { turn: { id: 'original-turn' }, turnId: 'original-turn' } } } });
  expect(f.received.find(m => m.method === 'turn/steer')).toMatchObject({ params: { input: [{ type: 'text', text: b.inputText, text_elements: [] }], clientUserMessageId: b.id } });
});
it('已绑定steer仍让原stop与审批先发送，不占其专用优先槽', async () => {
  const b = legacy(); const f = await fixture([b]); const api = await f.serve(await f.open()); const context = await f.resolver.operationContext();
  const run = f.scheduler.runOnce.bind(f.scheduler); let release!: () => void, entered = false; const gate = new Promise<void>(r => { release = r; });
  const wrapper = vi.spyOn(f.scheduler, 'runOnce').mockImplementation(async () => { entered = true; await gate; return run(); });
  const steer = api.post({ action: 'steer', id: b.id, revision: b.revision });
  for (let i = 0; i < 100 && !entered; i++) await new Promise(r => setTimeout(r, 10)); expect(entered).toBe(true);
  const epoch = (await f.scheduler.events(context, HOSTED_SESSION_ID, 0)).epoch;
  for (const socket of f.sockets) socket.send(JSON.stringify({ id: 42, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'original-turn' } }));
  for (let i = 0; i < 100; i++) { const e = await f.scheduler.events(context, HOSTED_SESSION_ID, 0); if (e.requests.some(m => m.id === 42 && m.method)) break; await new Promise(r => setTimeout(r, 10)); }
  await f.scheduler.submit({ id: randomUUID(), context, conversationId: 'thread', sessionId: HOSTED_SESSION_ID, requestId: randomUUID(), message: { id: 43, method: 'turn/interrupt', params: { threadId: 'thread', turnId: 'original-turn' } }, settings: {}, attachmentRefs: [], control: { kind: 'stop', turnId: 'original-turn', expiresAt: Date.now() + 10_000 } });
  await f.scheduler.submit({ id: randomUUID(), context, conversationId: 'thread', sessionId: HOSTED_SESSION_ID, requestId: randomUUID(), epoch, message: { id: 42, result: { decision: 'accept' } }, settings: {}, attachmentRefs: [], control: { kind: 'approval', turnId: 'original-turn', requestId: `request:${epoch}:42`, expiresAt: Date.now() + 10_000 } });
  release(); wrapper.mockRestore(); expect((await steer).status).toBe(200);
  expect(f.received.filter(m => m.method === 'turn/interrupt' || (m.id === 42 && !m.method) || m.method === 'turn/steer').map(m => m.method ?? 'approval')).toEqual(['turn/interrupt', 'approval', 'turn/steer']);
});
it('HTTP16MiB及输入附件settings校验沿用，unknown不能cancel或自动重发', async () => {
  const f = await fixture(); const api = await f.serve(await f.open()); const body = { ...legacy(), action: 'enqueue' };
  for (const bad of [{ settings: { unknown: 'x' } }, { attachmentCount: 1 }, { extraInput: [{ type: 'unknown' }] }, { inputText: 'x'.repeat(32769) }]) expect((await api.post({ ...body, ...bad })).status).toBe(400);
  expect((await fetch(api.url, { method: 'POST', body: ' '.repeat(16 * 1024 * 1024 + 1) })).status).toBe(413);
  expect((await api.post(body)).status).toBe(200); f.active.clear(); f.drop(true); await f.scheduler.runOnce(); const item = (await api.list())[0]; expect(item.state).toBe('uncertain');
  await rm(join(f.root, 'codex-mobile-http', HOSTED_SESSION_ID, `${(await f.disk()).records[0].followUp.operationId}.json`));
  expect((await api.post({ action: 'cancel', id: item.id, revision: item.revision })).status).toBe(409); await f.scheduler.runOnce(); expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(1);
}, 10_000);
it.each(['open', 'list', 'steer'])('原父授权最后await后失效%s不交付正文或成功ACK', async kind => {
  const b = legacy(); const f = await fixture([b]); let live = true;
  const assert = () => { if (!live) throw new Error('原父授权已撤销'); };
  if (kind === 'open') {
    const original = f.scheduler.openFollowUps.bind(f.scheduler); const wrapper = vi.spyOn(f.scheduler, 'openFollowUps').mockImplementation((...args) => original(...args).then(value => { queueMicrotask(() => { live = false; }); return value; }));
    try { await expect(withRemoteOperation(assert, () => f.open())).rejects.toThrow(); } finally { wrapper.mockRestore(); } return;
  }
  const facade = await f.open(); const method = kind === 'list' ? 'listFollowUps' : 'mutateFollowUp'; const original = f.scheduler[method].bind(f.scheduler) as (...args: any[]) => Promise<any>;
  const wrapper = vi.spyOn(f.scheduler, method).mockImplementation(((...args: any[]) => original(...args).then(value => { queueMicrotask(() => { live = false; }); return value; })) as any);
  let status = 0, bytes = ''; const response = { setHeader() {}, set statusCode(value: number) { status = value; }, end(value: string) { bytes = value; } };
  const request = kind === 'list' ? { method: 'GET' } : { method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ action: 'steer', id: b.id, revision: b.revision })); } };
  try { await expect(withRemoteOperation(assert, () => facade.handle(request as any, response as any))).rejects.toThrow('原父授权已撤销'); expect(status).toBe(503); expect(bytes).not.toContain('原正文'); expect(JSON.parse(bytes)).not.toHaveProperty('turnId'); } finally { wrapper.mockRestore(); }
});
it('B显式steer越过排队普通RPC A后，claimed/uncertain B仍阻同会话A，其他会话继续', async () => {
  const f = await fixture([], 1000); const api = await f.serve(await f.open()); const context = await f.resolver.operationContext();
  const submit = (conversationId: string) => f.scheduler.submit({ id: randomUUID(), context, conversationId, sessionId: HOSTED_SESSION_ID, requestId: randomUUID(), message: { id: randomUUID(), method: 'turn/start', params: { threadId: conversationId, input: [] } }, settings: {}, attachmentRefs: [] });
  await submit('thread'); const b = legacy(); expect((await api.post({ ...b, action: 'enqueue' })).status).toBe(200); await submit('other'); f.drop(true);
  const response = await api.post({ action: 'steer', id: b.id, revision: 1 }); expect(response.status).toBe(503);
  expect(f.received.filter(m => m.method === 'turn/steer')).toHaveLength(1); expect(f.received.filter(m => m.method === 'turn/start' && m.params.threadId === 'thread')).toHaveLength(0);
  expect(f.received.filter(m => m.method === 'turn/start' && m.params.threadId === 'other')).toHaveLength(1);
  await f.scheduler.runOnce(); expect(f.received.filter(m => m.method === 'turn/start' && m.params.threadId === 'thread')).toHaveLength(0);
}, 10_000);
it.each(['operationId', 'array-operationId', 'array-fingerprint', 'method', 'restoreState', 'expectedTurnId', 'legacyRecovery', 'walError', 'text', 'count', 'retainedLegacy', 'body', 'settings', 'receipt'])('ledger坏盘追问元数据%s拒绝，不借伪字段调度', async bad => {
  const f = await fixture([legacy()]); const api = await f.serve(await f.open()); const disk = await f.disk(); const r = disk.records[0];
  if (bad === 'operationId') r.followUp.operationId = 'not-a-uuid';
  if (bad === 'array-operationId') r.followUp.operationId = [r.followUp.operationId];
  if (bad === 'array-fingerprint') r.followUp.fingerprint = [r.followUp.fingerprint];
  if (bad === 'method') r.followUp.method = 'arbitrary/rpc';
  if (bad === 'restoreState') r.followUp.restoreState = 'sent';
  if (bad === 'expectedTurnId') r.followUp.expectedTurnId = 42;
  if (bad === 'legacyRecovery') r.followUp.legacyRecovery = 'true';
  if (bad === 'walError') r.followUp.walError = true;
  if (bad === 'text') r.followUp.text = {};
  if (bad === 'count') r.followUp.attachmentCount = -1;
  if (bad === 'retainedLegacy') r.followUp.retainedLegacy = { inputText: '第二事实来源' };
  if (bad === 'body') r.body.kind = 'rpc-v1';
  if (bad === 'settings') r.settings = { unknown: 'x' };
  if (bad === 'receipt') r.rpcReceipt = { sessionId: randomUUID(), requestId: r.followUp.operationId, signature: 'a'.repeat(64) };
  await writeFile(join(f.directory, 'operations.json'), JSON.stringify(disk)); const response = await fetch(api.url); expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty('items');
  expect(f.received).toEqual([]);
});
it('真实原turn超过4096并含JSON转义仍按实际值冻结和发送，不猜长度上界', async () => {
  const b = legacy(); const f = await fixture([b]); const api = await f.serve(await f.open()); const turn = '回合"\\\n'.repeat(3000); f.active.set('thread', turn);
  expect((await api.post({ action: 'steer', id: b.id, revision: b.revision })).status).toBe(200);
  expect(f.received.find(m => m.method === 'turn/steer').params.expectedTurnId).toBe(turn);
});
it.each([false, true])('steer按真实turn与确定失效错误字节耐久接收，预留已知错误=%s', async reserveError => {
  const f = await fixture([], 30_000); const api = await f.serve(await f.open()); const body = legacy('queued', { extraInput: [{ type: 'image', url: 'x'.repeat(16 * 1024 * 1024 - 6000) }], attachmentCount: 1 });
  for (let i = 0; i < 4; i++) f.active.set(`big-${i}`, 'busy');
  for (let i = 0; i < 4; i++) expect((await api.post({ ...body, action: 'enqueue', id: randomUUID(), threadId: `big-${i}` })).status).toBe(200);
  const records = (await f.disk()).records; const bytes = (value: any) => Buffer.byteLength(JSON.stringify(value));
  const future = (r: any) => ({ ...r, revision: Number.MAX_SAFE_INTEGER, state: 'uncertain', claimToken: '00000000-0000-0000-0000-000000000000', claimPid: Number.MAX_SAFE_INTEGER,
    followUp: { ...r.followUp, method: r.followUp.method ?? 'turn/start' }, rpcReceipt: { sessionId: HOSTED_SESSION_ID, requestId: r.followUp.operationId, signature: 'a'.repeat(64) } });
  const used = records.reduce((n: number, r: any) => n + bytes(future(r)), 0); const turn = '原"\\\n'.repeat(2000);
  const template = structuredClone(records[0]); template.id = randomUUID(); template.receiveOrder = 5; template.conversationId = 'thread'; template.body.extraInput[0].url = '';
  const bound = future(template); bound.followUp = { ...bound.followUp, method: 'turn/steer', restoreState: 'queued', expectedTurnId: turn, ...(reserveError ? { error: '原运行回合已失效，未发送引导' } : {}) };
  const size = 64 * 1024 * 1024 - used - bytes(bound); expect(size).toBeGreaterThan(0);
  expect(used + bytes({ ...bound, body: { ...bound.body, extraInput: [{ type: 'image', url: 'z'.repeat(size) }] } })).toBe(64 * 1024 * 1024);
  expect((await api.post({ ...body, action: 'enqueue', id: template.id, extraInput: [{ type: 'image', url: 'z'.repeat(size) }] })).status).toBe(200);
  f.active.set('thread', turn); let read = false; f.after(m => { if (!read && m.method === 'thread/turns/list') { read = true; f.active.set('thread', 'replacement'); } });
  const response = await api.post({ action: 'steer', id: template.id, revision: 1 });
  if (!reserveError) { expect(response.status).toBe(429); expect((await f.disk()).records[4]).toMatchObject({ state: 'queued', revision: 1 }); return; }
  expect(response.status).toBe(409);
  expect((await f.disk()).records[4]).toMatchObject({ state: 'failed', followUp: { error: '原运行回合已失效，未发送引导' } });
  expect(f.received.filter(m => m.method === 'turn/steer')).toEqual([]);
}, 60_000);
it('未知只读RPC不新建同会话普通写屏障，沿用原读旁路', async () => {
  const f = await fixture([], 700); await f.open(); const context = await f.resolver.operationContext();
  const submit = (method: string) => f.scheduler.submit({ id: randomUUID(), context, conversationId: 'thread', sessionId: HOSTED_SESSION_ID, requestId: randomUUID(), message: { id: randomUUID(), method, params: { threadId: 'thread' } }, settings: {}, attachmentRefs: [] });
  f.dropRead(true); await submit('thread/read'); await f.scheduler.runOnce(); expect((await f.disk()).records[0].state).toBe('uncertain');
  await submit('turn/start'); await f.scheduler.runOnce(); expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(1);
});
it('并发显式引导同真实epoch只resume一次，已有scheduler启动后唯一自动发送', async () => {
  const a = legacy(), b = legacy(); const f = await fixture([a, b]); const api = await f.serve(await f.open());
  let release!: () => void, entered = 0; const gate = new Promise<void>(r => { release = r; }); const original = HttpSessions.prototype.hostedRpc;
  const wrapper = vi.spyOn(HttpSessions.prototype, 'hostedRpc').mockImplementation(async function (this: HttpSessions, ...args) { if (args[0].method === 'thread/resume') { entered++; await gate; } return original.apply(this, args); });
  const pending = Promise.all([api.post({ action: 'steer', id: a.id, revision: a.revision }), api.post({ action: 'steer', id: b.id, revision: b.revision })]);
  for (let i = 0; i < 100 && !entered; i++) await new Promise(r => setTimeout(r, 10)); await new Promise(r => setTimeout(r, 50)); release(); const responses = await pending; wrapper.mockRestore();
  expect(responses.map(r => r.status)).toEqual([200, 200]); expect(f.received.filter(m => m.method === 'thread/resume')).toHaveLength(1);
  const next = legacy(); expect((await api.post({ ...next, action: 'enqueue' })).status).toBe(200); f.active.clear(); f.scheduler.start();
  await vi.waitFor(() => expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(1)); await new Promise(r => setTimeout(r, 275));
  expect(f.subscribed).not.toHaveBeenCalled(); expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(1);
});
it('手动steer真实上游error保留完整HTTP错误及failed列表，不误报原turn失效', async () => {
  const b = legacy(); const f = await fixture([b]); const api = await f.serve(await f.open()); f.reject(true); f.error('原上游引导错误');
  const response = await api.post({ action: 'steer', id: b.id, revision: b.revision }); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: { message: '原上游引导错误' } });
  expect((await api.list())[0]).toMatchObject({ state: 'failed', error: '原上游引导错误' });
});
it('真实resume成功后越过原预算的迟到响应不缓存，下一调用必须重新resume', async () => {
  const b = legacy(); const f = await fixture([b], 250); const api = await f.serve(await f.open());
  let release!: () => void, entered = false; const gate = new Promise<void>(r => { release = r; }); const original = HttpSessions.prototype.hostedRpc;
  const wrapper = vi.spyOn(HttpSessions.prototype, 'hostedRpc').mockImplementation(async function (this: HttpSessions, ...args) { const result = await original.apply(this, args); if (args[0].method === 'thread/resume') { entered = true; await gate; } return result; });
  let settled = false; const pending = api.post({ action: 'steer', id: b.id, revision: b.revision }).then(response => { settled = true; return response; });
  for (let i = 0; i < 100 && !entered; i++) await new Promise(r => setTimeout(r, 5)); expect(entered).toBe(true);
  await new Promise(r => setTimeout(r, 300)); const settledBeforeRelease = settled; release(); expect((await pending).status).toBe(503); wrapper.mockRestore();
  expect(settledBeforeRelease).toBe(true);
  await api.post({ action: 'steer', id: b.id, revision: b.revision }); expect(f.received.filter(m => m.method === 'thread/resume')).toHaveLength(2);
});
it('legacy原WAL失败后取得确定成功能结算并重开，不残留恢复标记', async () => {
  const b = legacy('sending'); const f = await fixture([b]); f.reject(true); await f.sessions.hostedRpc({ id: b.operationId, method: 'turn/start', params: { threadId: b.threadId } }, b.operationId);
  await f.open(); await f.scheduler.runOnce(); const api = await f.serve(await f.open()); expect((await api.list())[0].error).toBe('真实错误');
  const path = join(f.root, 'codex-mobile-http', HOSTED_SESSION_ID, `${b.operationId}.json`); const wal = JSON.parse(await readFile(path, 'utf8')); wal.message = { id: b.operationId, result: { turnId: 'confirmed' } }; await writeFile(path, JSON.stringify(wal));
  await f.scheduler.runOnce(); expect(await api.list()).toEqual([]); expect((await f.disk()).records[0].followUp).not.toHaveProperty('walError');
});
it('SPEC F1: 实际旧HTTP带附件cancelled收据正常升级应接管', async () => {
  const f = await fixture();
  const oldOwner = await FollowUps.open(f.root, f.sessions); cleanup.push(() => oldOwner.close());
  const api = await f.serve(oldOwner);
  const original = legacy('queued', { extraInput: [{ type: 'image', url: 'data:image/png;base64,AA==' }], attachmentCount: 1 });
  expect((await api.post({ ...original, action: 'enqueue' })).status).toBe(200);
  const queued = (await api.list())[0];
  expect((await api.post({ action: 'cancel', id: queued.id, revision: queued.revision })).status).toBe(200);
  await oldOwner.close();
  const source = await readFile(f.path, 'utf8');
  await writeFile(join(process.env.HOME!, 'F1-real-old-cancelled-source.json'), source);
  const item = JSON.parse(source).records[0];
  expect(item).toMatchObject({ state: 'cancelled', attachmentCount: 1 });
  expect(item).not.toHaveProperty('inputText'); expect(item).not.toHaveProperty('extraInput'); expect(item).not.toHaveProperty('settings');
  let outcome = 'accepted';
  try { await f.open(); } catch (error) { outcome = (error as Error).message; }
  await writeFile(join(process.env.HOME!, 'F1-outcome.json'), JSON.stringify({ outcome, sourceUnchanged: (await readFile(f.path, 'utf8')) === source }));
  expect(outcome).toBe('accepted');
});
it('F1兼容：真实旧cancelled/sent/queued同批保全计数收据并支持幂等、冲突及重开', async () => {
  const f = await fixture(); const oldOwner = await FollowUps.open(f.root, f.sessions); cleanup.push(() => oldOwner.close()); const oldApi = await f.serve(oldOwner);
  const cancelled = legacy('queued', { extraInput: [{ type: 'image', url: '[image omitted]' }], attachmentCount: 1 });
  const sent = legacy('queued', { threadId: 'sent-thread', extraInput: [{ type: 'image', url: '[image omitted]' }], attachmentCount: 1 });
  const queued = legacy('queued');
  expect((await oldApi.post({ ...cancelled, action: 'enqueue' })).status).toBe(200);
  const item = (await oldApi.list())[0]; expect((await oldApi.post({ action: 'cancel', id: item.id, revision: item.revision })).status).toBe(200);
  expect((await oldApi.post({ ...sent, action: 'enqueue' })).status).toBe(200); expect((await oldApi.post({ ...queued, action: 'enqueue' })).status).toBe(200);
  await vi.waitFor(async () => expect(JSON.parse(await readFile(f.path, 'utf8')).records.find((record: any) => record.id === sent.id).state).toBe('sent'), { timeout: 5000 });
  await oldOwner.close(); const source = await readFile(f.path, 'utf8'); const original = JSON.parse(source).records;
  expect(original[0]).toMatchObject({ id: cancelled.id, state: 'cancelled', attachmentCount: 1 });
  expect(Object.keys(original[1]).sort()).toEqual(['id', 'fingerprint', 'threadId', 'state', 'revision', 'operationId', 'method'].sort());
  const baseline = f.received.filter(message => message.method === 'turn/start').length; expect(baseline).toBe(1);
  const api = await f.serve(await f.open()); const records = (await f.disk()).records;
  for (let i = 0; i < original.length; i++) expect(records[i]).toMatchObject({ id: original[i].id, revision: original[i].revision, receiveOrder: i + 1, followUp: { fingerprint: original[i].fingerprint, operationId: original[i].operationId } });
  expect(records[0].followUp.attachmentCount).toBe(1); expect(records[1].followUp).not.toHaveProperty('attachmentCount');
  for (const body of [cancelled, sent, queued]) {
    expect((await api.post({ ...body, action: 'enqueue' })).status).toBe(200);
    expect((await api.post({ ...body, action: 'enqueue', inputText: '不同原内容' })).status).toBe(409);
  }
  expect((await api.list()).map((record: any) => record.id)).toEqual([queued.id]); await f.scheduler.close();
  const reopened = new OperationScheduler(f.options); cleanup.push(() => reopened.close()); const again = await f.serve(await f.open(reopened)); await reopened.runOnce();
  expect((await again.list()).map((record: any) => record.id)).toEqual([queued.id]); expect((await f.disk()).records).toHaveLength(3);
  expect(f.received.filter(message => message.method === 'turn/start')).toHaveLength(baseline); expect(await readFile(f.path, 'utf8')).toBe(source);
});
it('F1兼容：终态计数仍拒绝负数、非整数、非number和不完整安全整数，完整payload须一致', async () => {
  const records = [-1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1].map(attachmentCount => legacy('cancelled', { inputText: undefined, text: undefined, extraInput: undefined, settings: undefined, attachmentCount }));
  records.push(legacy('cancelled', { extraInput: [{ type: 'image', url: '[image omitted]' }], attachmentCount: 2 }));
  for (const record of records) {
    const f = await fixture([record]); await expect(f.open()).rejects.toThrow('旧追问附件数量无效'); expect(await readFile(f.path, 'utf8')).toBe(f.source);
  }
});

// 原Q1及增强Q1仅纠正事务门闩；原Q2保持逐字，原完整探针/块另封存。
import { OperationQueue } from '../../server/operation-queue.js';
// 原全局sync门闩可被并发inventory抢占；仅标识本次追问准备事务，原预算与断言不变。
function receiptPreparationScope() {
  const scope = new AsyncLocalStorage<{ id: string; revision: number }>();
  const original = OperationQueue.prototype.changeFollowUp;
  const change = vi.spyOn(OperationQueue.prototype, 'changeFollowUp').mockImplementation(function (this: OperationQueue, ...args) {
    return scope.run({ id: args[0], revision: args[1] }, () => original.apply(this, args));
  });
  cleanup.push(() => change.mockRestore()); return scope;
}
it('QUALITY Q1: receipt准备已耐久但交付超时后应保留精确未发送claim恢复能力', async () => {
  const item = legacy(); const f = await fixture([item], 700); await f.open(); f.active.clear();
  const preparation = receiptPreparationScope();
  const handle = await open(f.path, 'r'); const proto = Object.getPrototypeOf(handle); await handle.close();
  const original = proto.sync; let delayed = false;
  const sync = vi.spyOn(proto, 'sync').mockImplementation(async function (this: any, ...args: any[]) {
    const result = await original.apply(this, args);
    const disk = await f.disk().catch(() => undefined); const r = disk?.records[0];
    if (preparation.getStore()?.id === item.id && !delayed && r?.state === 'claimed' && r.rpcReceipt) {
      delayed = true; await writeFile(join(process.env.HOME!, 'Q1-durable-preparation.json'), JSON.stringify(disk));
      await new Promise(resolve => setTimeout(resolve, 850));
    }
    return result;
  });
  try { await f.scheduler.runOnce(); } finally { sync.mockRestore(); }
  const first = await f.disk(); const sendsBefore = f.received.filter(m => ['turn/start', 'turn/steer'].includes(m.method));
  let wal: unknown; try { wal = JSON.parse(await readFile(join(f.root, 'codex-mobile-http', HOSTED_SESSION_ID, `${item.operationId}.json`), 'utf8')); } catch (error: any) { wal = { code: error.code }; }
  await f.scheduler.close();
  const rebuilt = new OperationScheduler(f.options); cleanup.push(() => rebuilt.close()); await f.open(rebuilt); await rebuilt.runOnce();
  const outcome = { delayed, pid: process.pid, first: first.records[0], rebuilt: (await f.disk()).records[0], wal, sendsBefore, sendsAfter: f.received.filter(m => ['turn/start', 'turn/steer'].includes(m.method)), lastError: String(f.scheduler.lastError), rebuiltLastError: String(rebuilt.lastError) };
  await writeFile(join(process.env.HOME!, 'Q1-outcome.json'), JSON.stringify(outcome));
  expect(delayed).toBe(true); expect(sendsBefore).toEqual([]);
  expect(outcome.sendsAfter).toHaveLength(1);
}, 10_000);

it('QUALITY Q2: 真实旧failed steer retry生成的queued应可正常接管并读取', async () => {
  const f = await fixture(); const old = await FollowUps.open(f.root, f.sessions); cleanup.push(() => old.close()); const api = await f.serve(old);
  const item = legacy(); expect((await api.post({ ...item, action: 'enqueue' })).status).toBe(200);
  let queued = (await api.list())[0]; f.reject(true);
  const failedSteer = await api.post({ action: 'steer', id: item.id, revision: queued.revision }); expect(failedSteer.status).toBe(502);
  const failed = (await api.list())[0]; expect(failed.state).toBe('failed');
  expect((await api.post({ action: 'retry', id: item.id, revision: failed.revision })).status).toBe(200);
  await old.close(); const source = await readFile(f.path, 'utf8'); await writeFile(join(process.env.HOME!, 'Q2-real-old-source.json'), source);
  const sourceRecord = JSON.parse(source).records[0]; expect(sourceRecord.state).toBe('queued'); expect(sourceRecord.restoreState).toBe('queued'); expect(sourceRecord.method).toBeUndefined();
  const target = await f.serve(await f.open()); const response = await fetch(target.url); const result = await response.json();
  await writeFile(join(process.env.HOME!, 'Q2-outcome.json'), JSON.stringify({ sourceRecord, status: response.status, result, sourceUnchanged: (await readFile(f.path, 'utf8')) === source, disk: await f.disk(), received: f.received }));
  expect(response.status).toBe(200); expect((result as any).items[0]).toMatchObject({ id: item.id, state: 'queued' });
}, 10_000);

// 增强 Q1：精确证明 receipt 准备后尚未跨潜在发送边界。
it('QUALITY Q1: receipt准备已耐久但交付超时后应保留精确未发送claim恢复能力', async () => {
  const item = legacy(); const f = await fixture([item], 700); await f.open(); f.active.clear();
  const preparation = receiptPreparationScope();
  const handle = await open(f.path, 'r'); const proto = Object.getPrototypeOf(handle); await handle.close();
  const original = proto.sync; let delayed = false;
  const mark = vi.spyOn(OperationQueue.prototype, 'markPotentialSend'); const dispatch = vi.spyOn(HttpSessions.prototype, 'dispatchRpc');
  const sync = vi.spyOn(proto, 'sync').mockImplementation(async function (this: any, ...args: any[]) {
    const result = await original.apply(this, args);
    const disk = await f.disk().catch(() => undefined); const r = disk?.records[0];
    if (preparation.getStore()?.id === item.id && !delayed && r?.state === 'claimed' && r.rpcReceipt) {
      delayed = true; await writeFile(join(process.env.HOME!, 'Q1-durable-preparation.json'), JSON.stringify(disk));
      await new Promise(resolve => setTimeout(resolve, 850));
    }
    return result;
  });
  try { await f.scheduler.runOnce(); } finally { sync.mockRestore(); }
  const first = await f.disk(); const sendsBefore = f.received.filter(m => ['turn/start', 'turn/steer'].includes(m.method));
  const beforeCalls = { markPotentialSend: mark.mock.calls.length, dispatchRpc: dispatch.mock.calls.length };
  let wal: unknown; try { wal = JSON.parse(await readFile(join(f.root, 'codex-mobile-http', HOSTED_SESSION_ID, `${item.operationId}.json`), 'utf8')); } catch (error: any) { wal = { code: error.code }; }
  await f.scheduler.close();
  const rebuilt = new OperationScheduler(f.options); cleanup.push(() => rebuilt.close()); await f.open(rebuilt); await rebuilt.runOnce();
  const outcome = { delayed, pid: process.pid, first: first.records[0], rebuilt: (await f.disk()).records[0], wal, beforeCalls, afterCalls: { markPotentialSend: mark.mock.calls.length, dispatchRpc: dispatch.mock.calls.length }, sendsBefore, sendsAfter: f.received.filter(m => ['turn/start', 'turn/steer'].includes(m.method)), lastError: String(f.scheduler.lastError), rebuiltLastError: String(rebuilt.lastError) };
  mark.mockRestore(); dispatch.mockRestore();
  await writeFile(join(process.env.HOME!, 'Q1-outcome.json'), JSON.stringify(outcome));
  expect(delayed).toBe(true); expect(sendsBefore).toEqual([]); expect(beforeCalls).toEqual({ markPotentialSend: 0, dispatchRpc: 0 });
  expect(outcome.sendsAfter).toHaveLength(1);
}, 10_000);

it.each(['before-sync', 'cleanup-sync', 'authorization'])('Q1边界：receipt准备%s受阻后原CAS事实可跨同PID重建恢复', async kind => {
  const item = legacy(); const f = await fixture([item], 700); await f.open(); f.active.clear();
  const handle = await open(f.path, 'r'); const proto = Object.getPrototypeOf(handle); await handle.close();
  const originalSync = proto.sync; const originalChange = OperationQueue.prototype.changeFollowUp; const originalRelease = OperationQueue.prototype.releaseClaim;
  const originalAuthorize = f.resolver.authorizeOperation.bind(f.resolver);
  const transaction = new AsyncLocalStorage<'preparation' | 'release'>();
  let preparing = false, preparingGate = false, cleanupGate = false, denied = false;
  const change = vi.spyOn(OperationQueue.prototype, 'changeFollowUp').mockImplementation(function (this: OperationQueue, ...args) {
    const update = args[3]; args[3] = current => { update(current); if (current.rpcReceipt && current.state === 'claimed') preparing = true; };
    return transaction.run('preparation', () => originalChange.apply(this, args));
  });
  const release = vi.spyOn(OperationQueue.prototype, 'releaseClaim').mockImplementation(function (this: OperationQueue, ...args) { return transaction.run('release', () => originalRelease.apply(this, args)); });
  const authorize = vi.spyOn(f.resolver, 'authorizeOperation').mockImplementation(async (...args) => {
    if (denied) throw new Error('真实原context暂时撤权'); const fence = await originalAuthorize(...args);
    return () => { if (denied) throw new Error('真实原context暂时撤权'); fence(); };
  });
  const sync = vi.spyOn(proto, 'sync').mockImplementation(async function (this: any, ...args: any[]) {
    if (transaction.getStore() === 'preparation' && preparing && !preparingGate && kind === 'before-sync') { preparingGate = true; throw new Error('receipt临时文件sync失败，尚未发布'); }
    if (transaction.getStore() === 'release' && kind === 'cleanup-sync' && !cleanupGate) { cleanupGate = true; throw new Error('未发送清理文件sync失败'); }
    const result = await originalSync.apply(this, args);
    const record = (await f.disk()).records[0];
    if (transaction.getStore() === 'preparation' && preparing && !preparingGate && record.state === 'claimed' && record.rpcReceipt) {
      preparingGate = true;
      if (kind === 'authorization') denied = true;
      else await new Promise(resolve => setTimeout(resolve, 850));
    }
    return result;
  });
  const mark = vi.spyOn(OperationQueue.prototype, 'markPotentialSend'); const dispatch = vi.spyOn(HttpSessions.prototype, 'dispatchRpc');
  cleanup.push(() => { sync.mockRestore(); change.mockRestore(); release.mockRestore(); authorize.mockRestore(); mark.mockRestore(); dispatch.mockRestore(); });
  let firstError: unknown;
  try { await f.scheduler.runOnce(); } catch (error) { firstError = error; } finally { sync.mockRestore(); change.mockRestore(); release.mockRestore(); }
  if (kind === 'before-sync') {
    expect(firstError).toMatchObject({ status: 503 });
    // 同轮在途读可能先报告已poison的reopen-required；两者均是明确存储拒绝。
    expect(['storage', 'reopen-required']).toContain((firstError as any).code);
  }
  const first = (await f.disk()).records[0]; expect(preparingGate).toBe(true); expect(first.state).toBe('claimed');
  expect(first.revision).toBe(kind === 'before-sync' ? 8 : 9); expect(!!first.rpcReceipt).toBe(kind !== 'before-sync');
  expect(mark).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled(); expect(f.received.filter(m => m.method === 'turn/start')).toEqual([]);
  if (kind === 'cleanup-sync') expect(cleanupGate).toBe(true);
  denied = false; authorize.mockRestore(); await f.scheduler.close();
  const rebuilt = new OperationScheduler(f.options); cleanup.push(() => rebuilt.close()); await f.open(rebuilt); await rebuilt.runOnce();
  expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(1); expect((await f.disk()).records[0].state).toBe('succeeded');
  mark.mockRestore(); dispatch.mockRestore(); expect(await readFile(f.path, 'utf8')).toBe(f.source);
}, 10_000);

it.each(['other-owner', 'uncertain', 'terminal'])('Q1边界：准备后已成为%s的记录不被旧清理候选修改', async kind => {
  const f = await fixture([legacy()]); await f.open(); f.active.clear();
  const queue = new OperationQueue({ directory: f.directory, gatewayId: f.options.gatewayId, authorize: (context, action) => f.resolver.authorizeOperation(context as any, action) });
  const original = OperationQueue.prototype.changeFollowUp; let protectedRecord: any;
  const change = vi.spyOn(OperationQueue.prototype, 'changeFollowUp').mockImplementation(async function (this: OperationQueue, ...args) {
    const prepared = await original.apply(this, args); const record = (await f.disk()).records[0];
    if (!protectedRecord && record.state === 'claimed' && record.rpcReceipt) {
      if (kind === 'other-owner') {
        await queue.releaseClaim(record.id, record.revision, record.claimToken); await queue.claimNext(record.context.businessKey);
      } else {
        const marked = await queue.markPotentialSend(record.id, record.revision, record.claimToken);
        if (kind === 'terminal') await queue.settle(record.id, marked.revision, record.claimToken, 'succeeded');
      }
      protectedRecord = (await f.disk()).records[0]; throw new Error('准备结果最后交付拒绝');
    }
    return prepared;
  });
  try { await f.scheduler.runOnce(); } finally { change.mockRestore(); }
  expect(protectedRecord).toBeDefined(); expect((await f.disk()).records[0]).toEqual(protectedRecord);
  expect(f.received.filter(m => ['turn/start', 'turn/steer'].includes(m.method))).toEqual([]);
  await f.scheduler.close(); const rebuilt = new OperationScheduler(f.options); cleanup.push(() => rebuilt.close()); await f.open(rebuilt); await rebuilt.runOnce();
  expect((await f.disk()).records[0]).toEqual(protectedRecord); expect(f.received.filter(m => m.method === 'turn/start')).toEqual([]);
});

it.each([false, true])('Q2边界：目的表示不合法整批storage拒绝，已有ledger=%s也不写marker或部分项', async existing => {
  const f = await fixture([legacy(), legacy('queued', { method: 'turn/steer', restoreState: 'queued' })]);
  let before: string | undefined;
  if (existing) {
    const context = await f.resolver.operationContext();
    await f.scheduler.submit({ id: randomUUID(), context, conversationId: 'ordinary', sessionId: HOSTED_SESSION_ID, requestId: randomUUID(), message: { id: 1, method: 'thread/read', params: { threadId: 'ordinary' } }, settings: {}, attachmentRefs: [] });
    before = await readFile(join(f.directory, 'operations.json'), 'utf8');
  }
  let failure: unknown; try { await f.open(); } catch (error) { failure = error; }
  expect(String(failure)).toContain('storage'); expect(await readFile(f.path, 'utf8')).toBe(f.source);
  if (existing) expect(await readFile(join(f.directory, 'operations.json'), 'utf8')).toBe(before);
  else expect(await readFile(join(f.directory, 'operations.json')).then(() => 'present', (error: any) => error.code)).toBe('ENOENT');
  expect(f.subscribed).not.toHaveBeenCalled(); expect(f.received).toEqual([]);
});

it('Q2边界：真实旧retry遗留字段可继续普通失败、取消及重开，源字段保持原值', async () => {
  const f = await fixture(); const old = await FollowUps.open(f.root, f.sessions); cleanup.push(() => old.close()); const oldApi = await f.serve(old);
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    const item = legacy(); ids.push(item.id); expect((await oldApi.post({ ...item, action: 'enqueue' })).status).toBe(200);
    const queued = (await oldApi.list()).find((record: any) => record.id === item.id); f.reject(true);
    expect((await oldApi.post({ action: 'steer', id: item.id, revision: queued.revision })).status).toBe(502);
    const failed = (await oldApi.list()).find((record: any) => record.id === item.id);
    expect((await oldApi.post({ action: 'retry', id: item.id, revision: failed.revision })).status).toBe(200);
    if (index === 1) {
      const retried = (await oldApi.list()).find((record: any) => record.id === item.id);
      expect((await oldApi.post({ action: 'cancel', id: item.id, revision: retried.revision })).status).toBe(200);
    }
  }
  await old.close(); const source = await readFile(f.path, 'utf8'); const originals = JSON.parse(source).records;
  const api = await f.serve(await f.open()); const imported = (await f.disk()).records;
  for (let index = 0; index < 2; index++) expect(imported[index]).toMatchObject({ id: originals[index].id, revision: originals[index].revision, receiveOrder: index + 1, followUp: { operationId: originals[index].operationId, fingerprint: originals[index].fingerprint, restoreState: 'queued' } });
  f.active.clear(); await f.scheduler.runOnce(); const failed = (await api.list())[0]; expect(failed).toMatchObject({ id: ids[0], state: 'failed', error: '真实错误' });
  const settled = (await f.disk()).records; expect(settled[0].followUp).toMatchObject({ restoreState: 'queued', method: 'turn/start' });
  expect(settled[1]).toMatchObject({ state: 'cancelled', followUp: { restoreState: 'queued' } });
  await f.scheduler.close(); const rebuilt = new OperationScheduler(f.options); cleanup.push(() => rebuilt.close()); const again = await f.serve(await f.open(rebuilt));
  expect((await again.list())[0]).toMatchObject({ id: ids[0], state: 'failed', error: '真实错误' });
  expect((await f.disk()).records).toEqual(settled); expect(await readFile(f.path, 'utf8')).toBe(source);
});

it('SPEC Q3: 真实旧HTTP接受控制字符threadId后接管必须在发布marker之前拒绝', async () => {
  const f = await fixture();
  const old = await FollowUps.open(f.root, f.sessions); cleanup.push(() => old.close());
  const api = await f.serve(old);
  const body = { action: 'enqueue', id: randomUUID(), threadId: 'thread\nlegacy', inputText: '旧真实HTTP正文', text: '旧真实HTTP正文', extraInput: [], settings: {}, attachmentCount: 0 };
  const response = await api.post(body); const oldBody = await response.json();
  expect(response.status).toBe(200); await old.close();
  const source = await readFile(f.path, 'utf8');
  await writeFile(join(process.env.HOME!, 'Q3-real-old-source.json'), source);
  const persisted = JSON.parse(source); expect(persisted.records[0]).toMatchObject({ id: body.id, threadId: body.threadId, state: 'queued' });
  let openError: any, listStatus: number | undefined, listBody: any;
  try {
    const facade = await f.open(); const modern = await f.serve(facade);
    const result = await fetch(modern.url); listStatus = result.status; listBody = await result.json();
  } catch (error: any) { openError = { name: error.name, message: error.message, code: error.code, status: error.status }; }
  const ledger = await readFile(join(f.directory, 'operations.json'), 'utf8').catch(() => undefined);
  if (ledger !== undefined) await writeFile(join(process.env.HOME!, 'Q3-published-ledger.json'), ledger);
  const sourceAfter = await readFile(f.path, 'utf8');
  await writeFile(join(process.env.HOME!, 'Q3-outcome.json'), JSON.stringify({ oldStatus: response.status, oldBody, sourceUnchanged: source===sourceAfter, openError, listStatus, listBody, received: f.received, ledgerExists: ledger!==undefined }, null, 2));
  expect(sourceAfter).toBe(source);
  expect({ openError, ledgerExists: ledger!==undefined, listStatus, listBody }).toMatchObject({ openError: expect.any(Object), ledgerExists: false });
}, 10_000);

it('Q3边界：已有ledger与合法前项不因坏thread后项写入marker或部分记录', async () => {
  for (const threadId of ['thread\nlegacy', 'thread\u007flegacy', 't'.repeat(4097)]) {
    const first = legacy(); const second = legacy('queued', { threadId }); const f = await fixture([first, second]);
    const context = await f.resolver.operationContext();
    await f.scheduler.submit({ id: randomUUID(), context, conversationId: 'ordinary', sessionId: HOSTED_SESSION_ID, requestId: randomUUID(), message: { id: 1, method: 'thread/read', params: { threadId: 'ordinary' } }, settings: {}, attachmentRefs: [] });
    const path = join(f.directory, 'operations.json'); const before = await readFile(path, 'utf8');
    expect(JSON.parse(before)).not.toHaveProperty('followUpsImport');
    await expect(f.open()).rejects.toThrow('storage');
    expect(await readFile(path, 'utf8')).toBe(before); expect(await readFile(f.path, 'utf8')).toBe(f.source);
    const after = await f.disk(); expect(after).not.toHaveProperty('followUpsImport'); expect(after.records).toHaveLength(1);
    expect(after.records.some((item: any) => item.id === first.id || item.id === second.id)).toBe(false);
    expect(f.subscribed).not.toHaveBeenCalled(); expect(f.received).toEqual([]);
  }
});
it('Q3边界：手构旧源4096字符thread满足既有ledger规则并在GET和重开保持可读', async () => {
  const item = legacy('queued', { threadId: 't'.repeat(4096) }); const f = await fixture([item]);
  const facade = await f.open(); const api = await f.serve(facade); const response = await fetch(api.url);
  expect(response.status).toBe(200); expect(((await response.json()) as any).items[0]).toMatchObject({ id: item.id, threadId: item.threadId, revision: item.revision, state: 'queued' });
  await facade.close(); const reopened = await f.serve(await f.open()); const next = await fetch(reopened.url);
  expect(next.status).toBe(200); expect(((await next.json()) as any).items[0]).toMatchObject({ id: item.id, threadId: item.threadId });
  expect((await f.disk()).records[0]).toMatchObject({ id: item.id, conversationId: item.threadId, revision: item.revision, receiveOrder: 1 });
  expect(await readFile(f.path, 'utf8')).toBe(f.source); expect(f.received).toEqual([]); expect(f.subscribed).not.toHaveBeenCalled();
});

it('Q3调查：真实新facade拒绝控制字符threadId且ledger保持可读', async () => {
  const f = await fixture(); const api = await f.serve(await f.open());
  const path = join(f.directory, 'operations.json'); const before = await readFile(path, 'utf8');
  const body = { action: 'enqueue', id: randomUUID(), threadId: 'thread\nnew', inputText: '新真实HTTP正文', text: '新真实HTTP正文', extraInput: [], settings: {}, attachmentCount: 0 };
  const response = await api.post(body); const responseBody = await response.json();
  const after = await readFile(path, 'utf8'); const list = await fetch(api.url); const listBody = await list.json();
  await writeFile(join(process.env.HOME!, 'Q3-new-enqueue-outcome.json'), JSON.stringify({ status: response.status, responseBody, before, after, listStatus: list.status, listBody, received: f.received }, null, 2));
  expect(response.status).toBe(400); expect(after).toBe(before); expect(list.status).toBe(200); expect(f.received).toHaveLength(0);
});

import { encodeUserMessage } from '../../server/user-message-format.js';
it.each(['combined128', 'combined129', 'count-unchanged', 'count-changed'])('QUALITY Q4: 真实HTTP edit完整输入不变量%s不得污染ledger', async kind => {
  const f = await fixture(); const facade = await f.open(); const api = await f.serve(facade);
  const images = kind.startsWith('combined') ? Array.from({ length: kind === 'combined128' ? 127 : 128 }, () => ({ type: 'image', url: 'data:image/png;base64,eA==' })) : [];
  const original = legacy('queued', { extraInput: images, attachmentCount: images.length });
  expect((await api.post({ ...original, action: 'enqueue' })).status).toBe(200);
  const queued = (await api.list())[0]; const path = join(f.directory, 'operations.json'); const before = await readFile(path, 'utf8');
  const inputText = kind === 'count-changed' ? encodeUserMessage('编辑后的正文', [{ name: '文档', path: '/tmp/synthetic.txt' }]) : '编辑后的正文';
  const edit = { action: 'edit', id: original.id, revision: queued.revision, inputText, text: '编辑后的预览', mentions: kind.startsWith('combined') ? [{ type: 'skill', name: '新增技能', path: '/synthetic/skill' }] : [] };
  const response = await api.post(edit); const editBody = await response.json();
  const after = await readFile(path, 'utf8'); const get = await fetch(api.url); const listBody = await get.json();
  await facade.close(); await f.scheduler.close();
  const rebuilt = new OperationScheduler(f.options); cleanup.push(() => rebuilt.close());
  let reopenError: unknown, reopenStatus: number | undefined, reopenBody: unknown;
  try { const next = await f.serve(await f.open(rebuilt)); const result = await fetch(next.url); reopenStatus = result.status; reopenBody = await result.json(); } catch (error: any) { reopenError = { name: error.name, message: error.message, status: error.status, code: error.code }; }
  const outcome = { kind, enqueueExtraInput: images.length, edit, editStatus: response.status, editBody, ledgerChanged: before !== after, listStatus: get.status, listBody, reopenStatus, reopenBody, reopenError, received: f.received, sourceUnchanged: (await readFile(f.path, 'utf8')) === f.source };
  await writeFile(join(process.env.HOME!, `Q4-${kind}-before.json`), before); await writeFile(join(process.env.HOME!, `Q4-${kind}-after.json`), after); await writeFile(join(process.env.HOME!, `Q4-${kind}-outcome.json`), JSON.stringify(outcome, null, 2));
  expect(f.received).toEqual([]); expect(get.status).toBe(200); expect(reopenError).toBeUndefined(); expect(reopenStatus).toBe(200);
}, 10_000);

it('Q4收据边界：真实准备后零发送释放的queued可编辑、重开并按新正文只发送一次', async () => {
  const item = legacy(); const f = await fixture([item], 700); const api = await f.serve(await f.open()); f.active.clear();
  const preparation = receiptPreparationScope(); const handle = await open(f.path, 'r'); const proto = Object.getPrototypeOf(handle); await handle.close();
  const original = proto.sync; let delayed = false;
  const mark = vi.spyOn(OperationQueue.prototype, 'markPotentialSend'); const dispatch = vi.spyOn(HttpSessions.prototype, 'dispatchRpc');
  const sync = vi.spyOn(proto, 'sync').mockImplementation(async function (this: any, ...args: any[]) {
    const result = await original.apply(this, args); const record = (await f.disk()).records[0];
    if (preparation.getStore()?.id === item.id && !delayed && record.state === 'claimed' && record.rpcReceipt) {
      delayed = true; await new Promise(resolve => setTimeout(resolve, 850));
    }
    return result;
  });
  try { await f.scheduler.runOnce(); } finally { sync.mockRestore(); }
  const before = (await f.disk()).records[0]; expect(delayed).toBe(true); expect(before.state).toBe('queued'); expect(before.rpcReceipt).toBeDefined();
  expect(mark).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled(); mark.mockRestore(); dispatch.mockRestore();
  const inputText = encodeUserMessage('准备后合法编辑', [{ name: '新文档', path: '/tmp/synthetic-edit.txt' }]);
  const response = await api.post({ action: 'edit', id: item.id, revision: before.revision, inputText, text: '新预览', mentions: [] });
  const responseBody = await response.json(); const after = (await f.disk()).records[0];
  await writeFile(join(process.env.HOME!, 'Q4-prepared-edit-outcome.json'), JSON.stringify({ status: response.status, responseBody, before, after, received: f.received }, null, 2));
  expect(response.status).toBe(200); expect(after.followUp.attachmentCount).toBe(1); expect(after.rpcReceipt).toMatchObject({ sessionId: before.rpcReceipt.sessionId, requestId: before.rpcReceipt.requestId });
  expect(after.rpcReceipt.signature).not.toBe(before.rpcReceipt.signature); expect(after.signature).toBe(before.signature); expect(after.followUp.fingerprint).toBe(before.followUp.fingerprint);
  await f.scheduler.close(); const rebuilt = new OperationScheduler({ ...f.options, attemptTimeoutMs: 2000 }); cleanup.push(() => rebuilt.close());
  const next = await f.serve(await f.open(rebuilt)); expect((await next.list())[0]).toMatchObject({ id: item.id, attachmentCount: 1 });
  await rebuilt.runOnce(); expect(await next.list()).toEqual([]); const starts = f.received.filter(m => m.method === 'turn/start'); expect(starts).toHaveLength(1);
  expect(starts[0].params.input[0].text).toContain('准备后合法编辑'); expect(starts[0].params.clientUserMessageId).toBe(item.id);
  expect((await f.disk()).records[0].followUp.operationId).toBe(before.followUp.operationId);
}, 10_000);

it('Q4原WAL边界：真实pending在物理发送前失败须先清除WAL才可confirmNeverSent及编辑', async () => {
  const item = legacy(); const f = await fixture([item]); const api = await f.serve(await f.open()); f.active.clear();
  const scope = new AsyncLocalStorage<HttpSessions>(); const originalDispatch = HttpSessions.prototype.dispatchRpc;
  const dispatch = vi.spyOn(HttpSessions.prototype, 'dispatchRpc').mockImplementation(function (this: HttpSessions, ...args) { return scope.run(this, () => originalDispatch.apply(this, args)); });
  const confirm = vi.spyOn(OperationQueue.prototype, 'confirmNeverSent'); const handle = await open(f.path, 'r'); const proto = Object.getPrototypeOf(handle); await handle.close();
  const originalSync = proto.sync; let pending: any, interrupted = false;
  const walPath = join(f.root, 'codex-mobile-http', HOSTED_SESSION_ID, `${item.operationId}.json`);
  const sync = vi.spyOn(proto, 'sync').mockImplementation(async function (this: any, ...args: any[]) {
    const result = await originalSync.apply(this, args);
    if (scope.getStore() && !interrupted) {
      const wal = await readFile(walPath, 'utf8').then(JSON.parse).catch(() => undefined);
      if (wal?.status === 'pending') {
        interrupted = true; pending = wal;
        const client = (scope.getStore() as any).sessions.get(HOSTED_SESSION_ID).socket;
        const closed = new Promise<void>(resolve => client.once('close', resolve));
        for (const socket of f.sockets) socket.terminate();
        await closed;
      }
    }
    return result;
  });
  try { await f.scheduler.runOnce(); } finally { sync.mockRestore(); dispatch.mockRestore(); }
  const first = (await f.disk()).records[0]; const walAfter = await readFile(walPath, 'utf8').then(JSON.parse).catch((error: any) => ({ code: error.code }));
  await writeFile(join(process.env.HOME!, 'Q4-real-neverSent-outcome.json'), JSON.stringify({ interrupted, pending, first, walAfter, confirmations: confirm.mock.calls.length, received: f.received }, null, 2));
  expect(interrupted).toBe(true); expect(pending.status).toBe('pending'); expect(confirm).toHaveBeenCalledTimes(1); confirm.mockRestore();
  expect(first.state).toBe('queued'); expect(walAfter).toEqual({ code: 'ENOENT' }); expect(f.received.filter(m => m.method === 'turn/start')).toEqual([]);
  const response = await api.post({ action: 'edit', id: item.id, revision: first.revision, inputText: '未发送证明后的编辑', text: '新预览', mentions: [] });
  expect(response.status).toBe(200); expect((await api.list())[0].id).toBe(item.id); await f.scheduler.runOnce();
  expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(1); expect(await api.list()).toEqual([]);
}, 10_000);

it.each(['combined128', 'count-changed'])('Q4合法编辑：%s更新实际计数并保留接收身份、CAS、幂等与真实发送', async kind => {
  const f = await fixture(); const api = await f.serve(await f.open());
  const images = kind === 'combined128' ? Array.from({ length: 127 }, () => ({ type: 'image', url: 'data:image/png;base64,YQ==' })) : [];
  const item = legacy('queued', { extraInput: images, attachmentCount: images.length }); expect((await api.post({ ...item, action: 'enqueue' })).status).toBe(200);
  const before = (await f.disk()).records[0]; const mentions = kind === 'combined128' ? [{ type: 'skill', name: '新技能', path: '/synthetic/skill' }] : [];
  const inputText = kind === 'count-changed' ? encodeUserMessage('新正文', [{ name: '文档', path: '/tmp/synthetic.txt' }]) : '新正文';
  const edit = { action: 'edit', id: item.id, revision: before.revision, inputText, text: '新预览', mentions };
  const response = await api.post(edit); expect(response.status).toBe(200); const after = (await f.disk()).records[0];
  expect(after.followUp.attachmentCount).toBe(kind === 'combined128' ? 127 : 1); expect(after.body.extraInput).toHaveLength(kind === 'combined128' ? 128 : 0);
  expect(after).toMatchObject({ id: before.id, receiveOrder: before.receiveOrder, signature: before.signature, context: before.context, revision: before.revision + 1, followUp: { operationId: before.followUp.operationId, fingerprint: before.followUp.fingerprint } });
  const bytes = await readFile(join(f.directory, 'operations.json'), 'utf8'); expect((await api.post(edit)).status).toBe(409);
  expect((await api.post({ ...item, action: 'enqueue' })).status).toBe(200); expect((await api.post({ ...item, action: 'enqueue', inputText: '不同原请求' })).status).toBe(409);
  expect(await readFile(join(f.directory, 'operations.json'), 'utf8')).toBe(bytes); expect(await readFile(f.path, 'utf8')).toBe(f.source);
  await f.scheduler.close(); const rebuilt = new OperationScheduler(f.options); cleanup.push(() => rebuilt.close()); const next = await f.serve(await f.open(rebuilt));
  expect((await next.list())[0]).toMatchObject({ id: item.id, attachmentCount: after.followUp.attachmentCount }); f.active.clear(); await rebuilt.runOnce();
  expect(await next.list()).toEqual([]); const starts = f.received.filter(m => m.method === 'turn/start'); expect(starts).toHaveLength(1);
  expect(starts[0].params.clientUserMessageId).toBe(item.id); expect(starts[0].params.input[0].text).toContain('新正文');
  expect(starts[0].params.input.filter((entry: any) => entry.type === 'image')).toHaveLength(images.length);
});

it('Q4超限编辑：合并129在提交前400拒绝，整ledger、其他项及原source字节不变', async () => {
  const other = legacy('queued', { threadId: 'other-thread' }); const f = await fixture([other]); const api = await f.serve(await f.open());
  const images = Array.from({ length: 128 }, () => ({ type: 'image', url: 'data:image/png;base64,YQ==' })); const item = legacy('queued', { extraInput: images, attachmentCount: 128 });
  expect((await api.post({ ...item, action: 'enqueue' })).status).toBe(200); const before = (await f.disk()).records.find((r: any) => r.id === item.id);
  const path = join(f.directory, 'operations.json'); const bytes = await readFile(path, 'utf8');
  const response = await api.post({ action: 'edit', id: item.id, revision: before.revision, inputText: '编辑', text: '预览', mentions: [{ type: 'skill', name: '新技能', path: '/synthetic/skill' }] });
  expect(response.status).toBe(400); expect(await readFile(path, 'utf8')).toBe(bytes); expect(await readFile(f.path, 'utf8')).toBe(f.source); expect((await fetch(api.url)).status).toBe(200);
  await f.scheduler.close(); const rebuilt = new OperationScheduler(f.options); cleanup.push(() => rebuilt.close()); const next = await f.serve(await f.open(rebuilt));
  expect((await next.list()).map((r: any) => r.id)).toEqual([other.id, item.id]); expect(await readFile(path, 'utf8')).toBe(bytes); expect(f.received).toEqual([]);
});

it('Q4可信写边界：update后非法表示在同事务拒绝而不持久化', async () => {
  const item = legacy(); const f = await fixture([item]); const api = await f.serve(await f.open()); const path = join(f.directory, 'operations.json'); const bytes = await readFile(path, 'utf8');
  const original = OperationQueue.prototype.changeFollowUp;
  const change = vi.spyOn(OperationQueue.prototype, 'changeFollowUp').mockImplementation(function (this: OperationQueue, id, revision, action, update) {
    return original.call(this, id, revision, action, current => { update(current); current.followUp!.attachmentCount = -1; });
  });
  try { expect((await api.post({ action: 'edit', id: item.id, revision: item.revision, inputText: '合法正文', text: '合法预览', mentions: [] })).status).toBe(400); }
  finally { change.mockRestore(); }
  expect(await readFile(path, 'utf8')).toBe(bytes); expect((await fetch(api.url)).status).toBe(200); expect(await readFile(f.path, 'utf8')).toBe(f.source);
});
