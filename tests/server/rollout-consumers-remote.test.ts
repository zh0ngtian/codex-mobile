// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, open, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { MessageTimestamps } from '../../server/message-timestamps.js';
import { MessageWebCitations } from '../../server/web-citations.js';
import { messageRolloutFiles } from '../../server/message-rollout-files.js';
import { readLocalThreadMetadata } from '../../server/local-thread-metadata.js';
import { readImageGenerationError } from '../../server/image-generation-error.js';
import { BarkNotifications } from '../../server/bark-notifications.js';
import { rolloutRemote } from './fixtures/rollout-remote.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); }, 30000);
const id = '01a1260e-bb6b-79c3-abdb-cfdf41878cfc';
const time = '2026-10-10T13:44:22.123Z'; const seconds = Date.parse(time) / 1000;
const meta = (thread = id, extra = {}) => JSON.stringify({ type: 'session_meta', payload: { id: thread, ...extra } }) + '\n';
const message = (item = 'answer', stamp = time) => JSON.stringify({ type: 'response_item', timestamp: stamp, payload: { type: 'message', role: 'assistant', id: item, content: ['private body'] } }) + '\n';
const output = (value: unknown) => JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', output: value } }) + '\n';
const cite = (url = 'https://example.com/guide', ref = 'turn1view0') => `标题 (${url})\n【${ref}】 [wordlim: 200]\nprivate tool body`;
async function api() { const m = await import('../../server/rollout-source.js').catch(() => null); expect(m?.remoteRollouts, '缺少可信目标rollout投影来源').toBeTypeOf('function'); return m!; }
async function target(options?: Parameters<typeof rolloutRemote>[0]) { const f = await rolloutRemote(options); cleanup.push(() => f.close()); return f; }
async function source(f: Awaited<ReturnType<typeof target>>, gateway = 'gateway', options = {}) {
  const m = await api(); const s = m.remoteRollouts(f.session, f.commands, gateway, options); cleanup.push(() => s.close()); return s;
}
async function file(f: { root: string }, content: string, date = '2026/10/10', thread = id, suffix = '') {
  const directory = join(f.root, date === 'archive' ? 'archived_sessions' : `sessions/${date}`); await mkdir(directory, { recursive: true });
  const path = join(directory, `rollout-2026-10-10T13-44-22-${thread}${suffix}.jsonl`); await writeFile(path, content); return path;
}

it.each([false, true])('目标 rollout 同帧读取历史 commentary 正文和顺序锚点，受控Windows=%s', async windows => {
  const f = await target({ windows }); const s = await source(f);
  const row = (type: string, payload: object) => JSON.stringify({ type, timestamp: time, payload }) + '\n';
  const start = (turn: string) => row('event_msg', { type: 'task_started', turn_id: turn });
  const item = (id: string, role: string, phase: string | null, text: string) => row('response_item', {
    type: 'message', role, phase, id, content: [{ type: 'output_text', text }],
  });
  await file(f, meta() + start('wanted') + item('prompt', 'user', null, 'private prompt') +
    output(['tool leaks must stay on target', 'x'.repeat(500000)]) +
    item('progress', 'assistant', 'commentary', '进度') + item('final', 'assistant', 'final_answer', 'private final') +
    start('other') + item('different', 'assistant', 'commentary', 'other turn'));
  const startFrame = f.frames.length;
  const data = await s.commentary(id, ['wanted']);
  expect(f.frames.slice(startFrame).map(frame => frame.method)).toEqual(['command/exec', 'command/exec']);
  expect(f.frames.slice(startFrame).every(frame => (frame.params as any)?.streamStdin === false)).toBe(true);
  expect(data.get('wanted')).toEqual({ items: [{ id: 'progress', type: 'agentMessage', phase: 'commentary', text: '进度', timestamp: seconds }],
    messageOrder: ['prompt', 'progress', 'final'] });
  expect(data.has('other')).toBe(false);
});

it('可信目标同路径的时间、网关namespace和目标元数据彼此隔离', async () => {
  const a = await target({ target: 'A' }); const b = await target({ target: 'B' });
  await file(a, meta() + message()); await file(b, meta() + message('answer', '2026-10-11T00:00:00Z'));
  const sa = await source(a); const sb = await source(b); const other = await source(a, 'other-gateway');
  expect(sa.namespace).not.toBe(sb.namespace); expect(sa.namespace).not.toBe(other.namespace);
  expect(await new MessageTimestamps('/gateway-never-read', sa).read(id, ['answer'])).toEqual({ answer: seconds });
  expect(await new MessageTimestamps(a.root, sb).read(id, ['answer'])).toEqual({ answer: Date.parse('2026-10-11T00:00:00Z') / 1000 });
  expect(a.frames.filter(x => x.method === 'command/exec').every(x => {
    const params = x.params;
    return params !== null && typeof params === 'object' && !Array.isArray(params) && !Object.hasOwn(params, 'permissionProfile');
  })).toBe(true);
});

it('定位目标local/UTC日期、v4、归档与跨日期续写，不递归非日期目录且不负缓存missing', async () => {
  const f = await target({ timezone: 'Pacific/Kiritimati' }); const s = await source(f);
  await file(f, meta() + message('utc')); await file(f, meta() + message('target-local'), '2026/10/11'); await file(f, meta() + message('previous-utc'), '2026/10/09');
  await file(f, meta() + message('continued'), '2026/10/18', id, '_' + randomUUID());
  await file(f, meta() + message('archive'), 'archive'); await file(f, meta() + message('nested'), '2026/10/18/nested');
  const v4 = randomUUID(); await file(f, meta(v4) + message('v4'), '2025/01/02', v4);
  const paths = []; for await (const p of messageRolloutFiles('/wrong', id, s)) paths.push(p);
  expect(paths).toHaveLength(5); expect(paths[0]).toContain('2026/10/10'); expect(paths[1]).toContain('2026/10/11'); expect(paths[2]).toContain('2026/10/09'); expect(paths[3]).toContain('archived_sessions');
  expect(await new MessageTimestamps('/wrong', s).read(v4, ['v4'])).toEqual({ v4: seconds });
  const reader = new MessageTimestamps('/wrong', s); expect(await reader.read(id, ['later'])).toEqual({});
  await file(f, meta() + message('later'), '2026/10/21'); expect(await reader.read(id, ['later'])).toEqual({ later: seconds });
});

it.each(['v4', 'v7'])('定位RPC不随无关目录项和日期目录增长，%s引用仍完整检查跨文件冲突', async version => {
  const thread = version === 'v4' ? randomUUID() : id; const f = await target(); const s = await source(f);
  const first = await file(f, meta(thread) + output(cite()), 'archive', thread);
  const reader = new MessageWebCitations('/gateway', s);
  expect(await reader.read(thread, ['turn1view0'])).toEqual([{ refId: 'turn1view0', title: '标题', url: 'https://example.com/guide' }]);
  const before = f.requests.filter(request => request.mode !== 'scan').length;
  const archive = join(f.root, 'archived_sessions');
  for (let i = 0; i < 512; i++) await writeFile(join(archive, `rollout-unrelated-${randomUUID()}.jsonl`), '{private unrelated body}');
  for (let month = 1; month <= 2; month++) for (let day = 1; day <= 20; day++) {
    await mkdir(join(f.root, `sessions/2023/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`), { recursive: true });
  }
  await file(f, meta(thread) + output(cite('https://example.com/second', 'turn2view0')), '2023/02/20', thread, '_' + randomUUID());
  const start = f.requests.length;
  expect(await reader.read(thread, ['turn1view0', 'turn2view0'])).toEqual([
    { refId: 'turn1view0', title: '标题', url: 'https://example.com/guide' },
    { refId: 'turn2view0', title: '标题', url: 'https://example.com/second' },
  ]);
  const after = f.requests.slice(start).filter(request => request.mode !== 'scan').length;
  await appendFile(first, output(cite('https://example.com/conflict', 'turn2view0')));
  expect(await reader.read(thread, ['turn2view0'])).toEqual([]);
  expect(after, '必要候选仍在一个窗口，无关目录不能增加定位RPC').toBe(before);
}, 60000);

it.each(['permission', 'capacity'])('惰性目录错误%s仅在继续消费时抛出，归档首结果仍可终止', async code => {
  const thread = randomUUID(); const f = await target(); const s = await source(f);
  const failed = JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { kind: 'image_gen.generation', id: 'image', status: 'failed' } } }) + '\n';
  await file(f, meta(thread) + message() + output(cite()) + failed + output('unknown'), 'archive', thread);
  const late = join(f.root, 'sessions/2023/01/01'); await mkdir(late, { recursive: true });
  if (code === 'capacity') for (let i = 0; i < 10001; i++) await writeFile(join(late, `unrelated-${i}`), '');
  else await writeFile(join(f.root, '.deny'), late);
  expect(await readLocalThreadMetadata('/gateway', thread, s)).toEqual({ id: thread });
  expect(await new MessageTimestamps('/gateway', s).read(thread, ['answer'])).toEqual({ answer: seconds });
  expect(await readImageGenerationError('/gateway', thread, 'image', s)).toBeNull();
  await expect(new MessageWebCitations('/gateway', s).read(thread, ['turn1view0'])).rejects.toMatchObject({ code });
}, 30000);

it.each(['archive', 'sessions', 'v7-direct', 'fallback-child'])('受信定位保留旧symlink语义%s，fallback子日期不跟随', async mode => {
  const thread = mode === 'fallback-child' ? randomUUID() : id; const f = await target(); const s = await source(f);
  await file(f, meta(thread) + message(), mode === 'archive' ? 'archive' : mode === 'fallback-child' ? '2023/01/01' : '2026/10/10', thread);
  const path = join(f.root, mode === 'archive' ? 'archived_sessions' : mode === 'sessions' ? 'sessions' : mode === 'fallback-child' ? 'sessions/2023/01/01' : 'sessions/2026/10/10');
  await rename(path, join(f.root, 'detached')); await symlink(join(f.root, 'detached'), path, 'dir');
  expect(await new MessageTimestamps('/gateway', s).read(thread, ['answer'])).toEqual(mode === 'fallback-child' ? {} : { answer: seconds });
});

it.each([false, true])('候选定位按64KiB窗口证明特殊路径和全部候选，受控Windows=%s', async windows => {
  const home = windows ? "C:\\rollout 空格'" : "/rollout 空格'\""; const f = await target({ windows, home }); const s = await source(f); const paths = windows ? win32 : posix;
  const directory = join(f.root, 'archived_sessions'); await mkdir(directory);
  const expected = [];
  for (let i = 0; i < 600; i++) {
    const name = `rollout-中文 空格'${windows ? '' : '"\\\n'}-${String(i).padStart(3, '0')}-${id}.jsonl`;
    await writeFile(join(directory, name), '{unrelated body is not parsed by locator}'); expected.push(paths.join(home, 'archived_sessions', name));
  }
  const found = []; for await (const path of messageRolloutFiles('/gateway', id, s)) found.push(path);
  expect(found).toEqual(expected);
  const ascii = expected.map(path => JSON.stringify(path).replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')) + '\n').join('');
  const count = Math.ceil(Buffer.byteLength(ascii) / 65536); expect(count).toBeGreaterThan(1);
  expect(f.requests.filter(request => request.mode === 'locate').map(request => request.offset)).toEqual(Array.from({ length: count }, (_, i) => i * 65536));
}, 30000);

it('受控Windows保留32个wanted摘要与跨页token的scan argv余量', async () => {
  const f = await target({ windows: true }); const s = await source(f);
  const ids = Array.from({ length: 32 }, (_, i) => `answer-${i}-` + 'x'.repeat(160));
  await file(f, meta() + ids.flatMap(value => Array.from({ length: 16 }, () => message(value))).join(''));
  expect(await new MessageTimestamps('/gateway', s).read(id, ids)).toEqual(Object.fromEntries(ids.map(value => [value, seconds])));
  const scans = f.requests.filter(request => request.mode === 'scan');
  expect(scans.every(request => Array.isArray(request.wanted) && request.wanted.length === 32)).toBe(true);
  expect(scans.some(request => Number(request.offset) > 0 && !!request.token)).toBe(true);
});

it('活动追加、半行补完和EOF完整记录可重扫；truncate/replace/原地改写不会复用旧结果', async () => {
  const f = await target(); const s = await source(f); const p = await file(f, meta() + message()); const reader = new MessageTimestamps('/wrong', s);
  expect(await reader.read(id, ['answer'])).toEqual({ answer: seconds });
  const tail = message('later'); await appendFile(p, tail.slice(0, 55)); expect(await reader.read(id, ['later'])).toEqual({});
  await appendFile(p, tail.slice(55).trimEnd()); expect(await reader.read(id, ['later'])).toEqual({ later: seconds });
  await writeFile(p, meta() + message('new')); expect(await reader.read(id, ['answer', 'new'])).toEqual({ new: seconds });
  const replacement = p + '.new'; await writeFile(replacement, meta() + message('replace')); await rename(replacement, p);
  expect(await reader.read(id, ['new', 'replace'])).toEqual({ replace: seconds });
  await writeFile(p, meta('wrong') + message('replace')); expect(await reader.read(id, ['replace'])).toEqual({});
});

it('巨大工具正文只在目标解析，嵌套JSON/CRLF/冲突引用与Local差分一致', async () => {
  const f = await target(); const s = await source(f);
  const content = meta() + output([{ text: 'x'.repeat(3 * 1024 * 1024) + '\n' + cite() }]) +
    output([{ text: JSON.stringify({ status: 'fulfilled', value: { content: [{ text: cite('https://example.com/other', 'turn2view0') }] } }) }]) + '{bad}\r\n';
  const p = await file(f, content.replaceAll('\n', '\r\n')); const remote = new MessageWebCitations('/wrong', s); const local = new MessageWebCitations(f.root);
  expect(await remote.read(id, ['turn1view0', 'turn2view0'])).toEqual(await local.read(id, ['turn1view0', 'turn2view0']));
  expect(await remote.read(id, ['turn1view0'])).toHaveLength(1);
  await appendFile(p, output(cite('https://example.com/conflict')));
  expect(await remote.read(id, ['turn1view0'])).toEqual([]);
  expect(JSON.stringify(f.requests)).not.toContain('private tool body');
});

it('64KiB完整首行分类保留隐藏source，missing/无效为普通缺失，真实权限失败传播', async () => {
  const f = await target(); const s = await source(f); const p = await file(f, meta(id, { source: { subagent: 'review' }, thread_source: 'subagent', parent_thread_id: 'parent', ephemeral: true }) + message());
  expect(await readLocalThreadMetadata('/gateway', id, s)).toEqual({ id, source: { subagent: 'review' }, threadSource: 'subagent', parentThreadId: 'parent', ephemeral: true });
  await writeFile(p, meta(id, { extra: 'x'.repeat(65536) })); expect(await readLocalThreadMetadata('/gateway', id, s)).toBeUndefined();
  expect(await readLocalThreadMetadata('/gateway', randomUUID(), s)).toBeUndefined();
  await writeFile(join(f.root, '.deny'), ''); await expect(new MessageTimestamps('/gateway', s).read(id, ['answer'])).rejects.toMatchObject({ code: 'permission' });
});

it.each(['1e999', '-1e999'])('目标metadata的%s投影解码失败归为脱敏协议错误，Local数值语义不变', async number => {
  const f = await target(); const s = await source(f); const { RolloutSourceError } = await api();
  await file(f, meta(id, { source: { subagent: 'review', privateField: 'projection-private-marker', weight: 'overflow' } }).replace('"overflow"', number));
  const local = await readLocalThreadMetadata(f.root, id);
  expect(local?.source).toEqual({ subagent: 'review', privateField: 'projection-private-marker', weight: number.startsWith('-') ? -Infinity : Infinity });
  const error: unknown = await readLocalThreadMetadata('/gateway', id, s).then(() => undefined, reason => reason);
  expect(error).toBeInstanceOf(RolloutSourceError);
  expect(error).toMatchObject({ code: 'protocol', message: 'Remote rollout读取未完成：protocol' });
});

it('图像诊断验证会话与item归属，只接受后继双JSON结构化审核错误', async () => {
  const f = await target(); const s = await source(f);
  const failed = (item: string) => JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { kind: 'image_gen.generation', id: item, status: 'failed' } } }) + '\n';
  const error = { error: { code: 'moderation_blocked', message: 'request ID req-one.', moderation_details: { moderation_stage: 'output', categories: ['sexual', 'x'.repeat(41), 1] } } };
  const p = await file(f, meta() + failed('other') + output('unrelated') + failed('image') + output([{ text: `Some(${JSON.stringify(JSON.stringify(error))})` }]));
  expect(await readImageGenerationError('/wrong', id, 'image', s)).toEqual({ code: 'moderation_blocked', stage: 'output', categories: ['sexual'], requestId: 'req-one' });
  await writeFile(p, meta('wrong') + failed('image') + output([{ text: `Some(${JSON.stringify(JSON.stringify(error))})` }]));
  expect(await readImageGenerationError('/wrong', id, 'image', s)).toBeNull();
});

it('close仅取消自有读取并保留caller RPC/Commands，外部取消也明确失败', async () => {
  const f = await target(); const s = await source(f); await file(f, meta() + message());
  f.delay(5000); const reading = new MessageTimestamps('/wrong', s).read(id, ['answer']);
  while (!f.requests.length) await new Promise(resolve => setTimeout(resolve, 5));
  await s.close(); await expect(reading).rejects.toMatchObject({ code: 'closed' });
  const deadline = Date.now() + 3000; while (f.active && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  expect(f.active).toBe(0); expect(f.session.ready).toBe(true);
  f.delay(0); expect((await f.commands.execute({ argv: ['python3', '-I', '-c', 'print(42)'], cwd: f.home })).stdout.toString().trim()).toBe('42');
  const next = await source(f); const controller = new AbortController(); controller.abort();
  await expect(new MessageTimestamps('/wrong', next).read(id, ['answer'], controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
});

it('Windows受控路径夹具按目标分隔符定位，未声称Windows实机验证', async () => {
  const f = await target({ windows: true }); const s = await source(f); await file(f, meta() + message());
  expect(await new MessageTimestamps('/wrong', s).read(id, ['answer'])).toEqual({ answer: seconds });
  const paths = []; for await (const p of messageRolloutFiles('/wrong', id, s)) paths.push(p); expect(paths[0]).toContain('C:\\rollout\\sessions\\2026\\10\\10\\');
});

async function bark(f: Awaited<ReturnType<typeof target>>, s: Awaited<ReturnType<typeof source>>) {
  const gateway = await mkdtemp(join(tmpdir(), 'bark-rollout-gateway-')); cleanup.push(() => rm(gateway, { recursive: true, force: true }));
  await mkdir(join(gateway, 'codex-mobile-notifications'));
  await writeFile(join(gateway, 'codex-mobile-notifications', 'state.json'), JSON.stringify({ subscriptions: [{ clientId: randomUUID(), backendId: 'backend', barkUrl: 'https://example.com/fixture-key' }], delivered: [] }));
  const pushes: unknown[] = []; const failures: unknown[] = [];
  const value = new BarkNotifications({ codexHome: gateway, displayName: 'fixture', rolloutSource: s,
    fetch: async (_url: unknown, init: RequestInit) => { pushes.push(JSON.parse(init.body as string)); return new Response('{}'); },
    onMetadataError: (error: unknown) => failures.push(error),
  } as any);
  cleanup.push(() => value.close()); await value.initialized(); value.setFollowedThreadIds([id]);
  return { value, gateway, pushes, failures, f };
}
async function until(test: () => boolean) { const deadline = Date.now() + 5000; while (!test()) { if (Date.now() >= deadline) throw new Error('有限等待条件未满足'); await new Promise(resolve => setTimeout(resolve, 5)); } }

it('Bark对嵌套metadata投影解码失败只回调一次脱敏协议错误且不发送', async () => {
  const f = await target(); const s = await source(f); const { RolloutSourceError } = await api();
  await file(f, meta(id, { source: { subagent: 'review', privateField: { weight: 'overflow', text: 'projection-private-marker' } } }).replace('"overflow"', '-1e999'));
  const b = await bark(f, s); b.value.notifyFollowedCompletion(id, 'overflow');
  await until(() => f.requests.some(request => request.projection === 'metadata'));
  await until(() => f.active === 0); await b.value.close();
  expect(b.pushes).toEqual([]); expect(b.failures).toHaveLength(1);
  expect(b.failures[0]).toBeInstanceOf(RolloutSourceError);
  expect(b.failures[0]).toMatchObject({ code: 'protocol', message: 'Remote rollout读取未完成：protocol' });
});

it('Bark分类只读目标隐藏source，订阅与去重仍在网关，missing维持普通通知策略', async () => {
  const f = await target(); const s = await source(f); const p = await file(f, meta(id, { source: { subagent: 'review' } }) + message());
  const b = await bark(f, s); b.value.notifyFollowedCompletion(id, 'hidden');
  await until(() => f.requests.some(r => r.projection === 'metadata') || b.pushes.length > 0);
  // 等待分类命令实际终结，再观察整个投递队列；不以固定sleep猜测结果。
  await until(() => f.active === 0); await b.value.close();
  expect(b.pushes).toHaveLength(0);
  await rm(p); const ordinary = await bark(f, s); ordinary.value.notifyFollowedCompletion(id, 'ordinary'); await until(() => ordinary.pushes.length === 1);
  const state = JSON.parse(await readFile(join(ordinary.gateway, 'codex-mobile-notifications', 'state.json'), 'utf8'));
  expect(state.delivered).toHaveLength(1); expect(ordinary.failures).toEqual([]);
  await expect(readFile(join(f.root, 'codex-mobile-notifications', 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('Bark真实读取失败可识别且不发送，close取消自有分类任务后不发送且来源仍可使用', async () => {
  const f = await target(); const s = await source(f); await file(f, meta() + message()); const b = await bark(f, s);
  await writeFile(join(f.root, '.deny'), ''); b.value.notifyFollowedCompletion(id, 'denied');
  await until(() => b.failures.length > 0 || b.pushes.length > 0); expect(b.failures[0]).toMatchObject({ code: 'permission' }); expect(b.pushes).toEqual([]);
  await rm(join(f.root, '.deny')); f.delay(5000); b.value.notifyFollowedCompletion(id, 'closing');
  await until(() => f.active > 0); await b.value.close(); f.delay(0); expect(b.pushes).toEqual([]);
  expect(await new MessageTimestamps('/wrong', s).read(id, ['answer'])).toEqual({ answer: seconds }); expect(f.session.ready).toBe(true);
});

it('长wanted IDs跨请求批次仍返回全部真实时间，不受单命令argv容量误伤', async () => {
  const f = await target(); const s = await source(f); const ids = Array.from({ length: 100 }, (_, i) => `id-${i}-` + 'x'.repeat(240));
  await file(f, meta() + ids.map(value => message(value)).join(''));
  expect(await new MessageTimestamps('/wrong', s).read(id, ids)).toEqual(Object.fromEntries(ids.map(value => [value, seconds])));
});

it('超过2MiB的必要引用投影逐窗交付，中文大stage跨ASCII协议窗口保持完整', async () => {
  const f = await target(); const s = await source(f, 'gateway', { timeoutMs: 180000 });
  const refs = Array.from({ length: 280 }, (_, i) => `turn${i}view0`);
  const url = 'https://example.com/' + 'a'.repeat(7900);
  const p = await file(f, meta() + output(refs.map(ref => ({ text: cite(url, ref) }))));
  const values = await new MessageWebCitations('/wrong', s).read(id, refs);
  expect(values).toHaveLength(refs.length); expect(values.every(value => value.url === url)).toBe(true);
  expect(f.requests.filter(r => r.mode === 'scan').length).toBeGreaterThan(32);
  const stage = '前'.repeat(10921) + '😀中'.repeat(12000);
  const error = { error: { code: 'moderation_blocked', moderation_details: { moderation_stage: stage, categories: [] } } };
  await writeFile(p, meta() + JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { kind: 'image_gen.generation', id: 'image', status: 'failed' } } }) + '\n' + output([{ text: `Some(${JSON.stringify(JSON.stringify(error))})` }]));
  expect((await readImageGenerationError('/wrong', id, 'image', s))?.stage).toBe(stage);
}, 60000);

it('跨窗口持续append仍交付已验证前缀，后续读取发现新完整记录', async () => {
  const f = await target(); const s = await source(f); const p = await file(f, meta() + message('answer').repeat(1500)); let appended = 0;
  f.beforeRequest(async r => { if (r.mode === 'scan') { await appendFile(p, message('later')); appended++; } });
  const result = await new MessageTimestamps('/wrong', s).read(id, ['answer', 'later']);
  expect(result.answer).toBe(seconds); expect(appended).toBeGreaterThan(1);
  f.beforeRequest(); expect(await new MessageTimestamps('/wrong', s).read(id, ['later'])).toEqual({ later: seconds });
});

it.each(['truncate', 'replace', 'rewrite'] as const)('跨窗口%s后清空旧文件投影并重建基线', async mode => {
  const f = await target(); const s = await source(f); const old = meta() + message('old').repeat(1500); const p = await file(f, old); let changed = false;
  f.beforeRequest(async r => {
    if (r.mode !== 'scan' || !r.offset || changed) return; changed = true;
    const next = meta() + message('new').repeat(mode === 'truncate' ? 1 : 1500);
    if (mode === 'replace') { await writeFile(p + '.replacement', next); await rename(p + '.replacement', p); }
    else if (mode === 'rewrite') { const handle = await open(p, 'r+'); try { await handle.write(next, 0, 'utf8'); } finally { await handle.close(); } }
    else await writeFile(p, next);
  });
  expect(await new MessageTimestamps('/wrong', s).read(id, ['old', 'new'])).toEqual({ new: seconds }); expect(changed).toBe(true);
});

it('目录分页改变时整目录重建，超过既有10000条容量不得伪装局部成功', async () => {
  const f = await target(); const s = await source(f); const paths: string[] = []; const found: string[] = [];
  for (let i = 0; i < 600; i++) paths.push(await file(f, meta(), '2026/10/10', id, '_' + randomUUID()));
  let changed = false; let replacement = '';
  f.beforeRequest(async r => {
    if (r.mode === 'locate' && Number(r.offset) > 0 && !changed) {
      expect(found).toEqual([]); changed = true; await rm(paths[0]);
      replacement = await file(f, meta(), '2026/10/10', id, '_' + randomUUID());
    }
  });
  for await (const path of messageRolloutFiles('/wrong', id, s)) found.push(path);
  expect(found).toHaveLength(600); expect(new Set(found).size).toBe(600); expect(changed).toBe(true);
  expect(found).not.toContain(paths[0].replace(f.root, f.home)); expect(found).toContain(replacement.replace(f.root, f.home));
  expect(f.requests.filter(r => r.mode === 'locate' && r.offset === 0).length).toBeGreaterThan(1);
  f.beforeRequest(); const directory = join(f.root, 'archived_sessions'); await mkdir(directory);
  for (let i = 0; i < 10000; i++) await writeFile(join(directory, `other-${i}`), '');
  const reading = async () => { const result = []; for await (const path of messageRolloutFiles('/wrong', id, s)) result.push(path); return result; };
  expect(await reading()).toHaveLength(600);
  await writeFile(join(directory, 'other-10000'), ''); await expect(reading()).rejects.toMatchObject({ code: 'capacity' });
}, 30000);

it('多页共享绝对期限，已有局部时间结果不能掩盖后续权限失败', async () => {
  const f = await target(); const s = await source(f, 'gateway', { timeoutMs: 1000 }); await file(f, meta() + message().repeat(8000));
  f.delay(200); await expect(new MessageTimestamps('/wrong', s).read(id, ['answer'])).rejects.toMatchObject({ code: 'timeout' });
  expect(f.requests.some(request => request.mode === 'scan' && Number(request.offset) > 0)).toBe(true);
  f.delay(0); const next = await source(f); const p = await file(f, meta() + message('old').repeat(1500));
  f.beforeRequest(async r => { if (r.mode === 'scan' && Number(r.offset) > 0) await writeFile(join(f.root, '.deny'), ''); });
  await expect(new MessageTimestamps('/wrong', next).read(id, ['old'])).rejects.toMatchObject({ code: 'permission' });
  expect((await readFile(p)).length).toBeGreaterThan(65536);
});

it('候选定位变化重试共享原期限，失败前不交付候选且caller仍存活', async () => {
  const f = await target(); const s = await source(f, 'gateway', { timeoutMs: 700 }); const found: string[] = [];
  for (let i = 0; i < 600; i++) await file(f, meta(), 'archive', id, '_' + randomUUID());
  let changes = 0; f.delay(60);
  f.beforeRequest(async request => { if (request.mode === 'locate' && Number(request.offset) > 0) { changes++; await file(f, meta(), 'archive', id, '_' + randomUUID()); } });
  const reading = async () => { for await (const path of messageRolloutFiles('/gateway', id, s)) found.push(path); };
  await expect(reading()).rejects.toMatchObject({ code: 'timeout' }); expect(changes).toBeGreaterThan(0); expect(found).toEqual([]);
  f.beforeRequest(); f.delay(0); await until(() => f.active === 0); expect(f.session.ready).toBe(true);
  expect((await f.commands.execute({ argv: ['python3', '-I', '-c', 'print(42)'], cwd: f.home })).stdout.toString().trim()).toBe('42');
}, 30000);

it.each(['digest', 'encoding'])('候选定位完整证明拒绝%s损坏，首metadata也不得提前交付', async fault => {
  const f = await target(); const s = await source(f); await file(f, meta()); const execute = f.commands.execute.bind(f.commands); let corrupted = false;
  f.commands.execute = async options => {
    const result = await execute(options); const value = JSON.parse(result.stdout.toString());
    if (!value.version) return result;
    corrupted = true;
    if (fault === 'digest') value.sha256 = '0'.repeat(64);
    else { value.total = 1; value.base64 = '/w=='; }
    return { ...result, stdout: Buffer.from(JSON.stringify(value) + '\n') };
  };
  await expect(readLocalThreadMetadata('/gateway', id, s)).rejects.toMatchObject({ code: 'protocol', message: 'Remote rollout读取未完成：protocol' }); expect(corrupted).toBe(true);
});

it('来源拒绝跨session绑定，取消/关闭/能力错误不落回网关同路径', async () => {
  const a = await target({ target: 'A' }); const b = await target({ target: 'B' }); const m = await api();
  expect(() => m.remoteRollouts(b.session, a.commands, 'gateway')).toThrow(); expect(() => m.remoteRollouts(a.session, a.commands, '')).toThrow();
  const s = await source(a); await file(a, meta() + message()); await a.commands.close();
  await expect(new MessageTimestamps(a.root, s).read(id, ['answer'])).rejects.toMatchObject({ code: 'closed' });
});

it('目标JSON解析资源失败明确报能力错误，不把有效深嵌套记录伪装missing', async () => {
  const f = await target(); const s = await source(f);
  const deep = message().replace('"private body"', '['.repeat(2000) + '0' + ']'.repeat(2000));
  await file(f, meta() + deep);
  expect(await new MessageTimestamps(f.root).read(id, ['answer'])).toEqual({ answer: seconds });
  await expect(new MessageTimestamps('/wrong', s).read(id, ['answer'])).rejects.toMatchObject({ code: 'capability' });
});

const largeInteger = '9'.repeat(5000);
const largeIntegerMeta = () => meta(id, { source: { subagent: 'review' } }).trimEnd().replace(/}$/, `,"unused":${largeInteger}}`) + '\n';

it('有效消息无关字段的大整数转换资源失败不得伪装missing', async () => {
  const f = await target(); const s = await source(f);
  await file(f, meta() + message().replace('"private body"', largeInteger));
  expect((await new MessageTimestamps(f.root).read(id, ['answer'])).answer).toBe(seconds);
  await expect(new MessageTimestamps('/wrong', s).read(id, ['answer'])).rejects.toMatchObject({ code: 'capability' });
});

it('64KiB内完整metadata的大整数资源失败不得抹去隐藏source', async () => {
  const f = await target(); const s = await source(f); const content = largeIntegerMeta();
  expect(Buffer.byteLength(content)).toBeLessThan(65536); await file(f, content);
  expect((await readLocalThreadMetadata(f.root, id))?.source).toEqual({ subagent: 'review' });
  await expect(readLocalThreadMetadata('/wrong', id, s)).rejects.toMatchObject({ code: 'capability' });
});

it('Bark不把metadata整数资源失败当普通missing放行隐藏会话通知', async () => {
  const f = await target(); const s = await source(f); await file(f, largeIntegerMeta());
  const b = await bark(f, s); b.value.notifyFollowedCompletion(id, 'integer-resource');
  await until(() => b.failures.length > 0 || b.pushes.length > 0);
  expect(b.failures[0]).toMatchObject({ code: 'capability' }); expect(b.pushes).toEqual([]);
});

it('引用嵌套JSON的整数资源失败必须传播，不回退普通工具文本', async () => {
  const f = await target(); const s = await source(f);
  const nested = `{"status":"fulfilled","unused":${largeInteger},"value":{"text":${JSON.stringify(cite())}}}`;
  await file(f, meta() + output([{ text: nested }]));
  expect(await new MessageWebCitations(f.root).read(id, ['turn1view0'])).toHaveLength(1);
  await expect(new MessageWebCitations('/wrong', s).read(id, ['turn1view0'])).rejects.toMatchObject({ code: 'capability' });
});

it('图像Some双JSON的整数资源失败必须传播，不猜测为未知错误', async () => {
  const f = await target(); const s = await source(f);
  const failed = JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { kind: 'image_gen.generation', id: 'image', status: 'failed' } } }) + '\n';
  const inner = `{"error":{"code":"moderation_blocked","moderation_details":{"moderation_stage":"output","categories":[]}},"unused":${largeInteger}}`;
  await file(f, meta() + failed + output([{ text: `Some(${JSON.stringify(inner)})` }]));
  expect((await readImageGenerationError(f.root, id, 'image'))?.code).toBe('moderation_blocked');
  await expect(readImageGenerationError('/wrong', id, 'image', s)).rejects.toMatchObject({ code: 'capability' });
});

it('大整数后仍畸形或未完成的JSON保持忽略，嵌套畸形JSON仍按工具文本提取', async () => {
  const f = await target(); const s = await source(f);
  const complete = message().replace('"private body"', largeInteger).trimEnd();
  const invalid = [complete.slice(0, -1), complete + 'garbage', ...['NaN', 'Infinity', '-Infinity'].map(value => complete.replace(/}$/, `,"invalid":${value}}`))];
  const p = await file(f, meta() + invalid.join('\n') + '\n' + message('valid').trimEnd());
  expect(await new MessageTimestamps('/wrong', s).read(id, ['answer', 'valid'])).toEqual(await new MessageTimestamps(f.root).read(id, ['answer', 'valid']));
  await writeFile(p, meta() + output([{ text: `{"unused":${largeInteger},broken}\n` + cite() }]));
  expect(await new MessageWebCitations('/wrong', s).read(id, ['turn1view0'])).toEqual(await new MessageWebCitations(f.root).read(id, ['turn1view0']));
  expect(await new MessageWebCitations('/wrong', s).read(id, ['turn1view0'])).toHaveLength(1);
  await writeFile(p, largeIntegerMeta().trimEnd().slice(0, -1) + '\n');
  expect(await readLocalThreadMetadata('/wrong', id, s)).toBeUndefined();
  await writeFile(p, largeIntegerMeta().trimEnd());
  expect(await readLocalThreadMetadata(f.root, id)).toBeUndefined();
  expect(await readLocalThreadMetadata('/wrong', id, s)).toBeUndefined();
});

const resourceRecords = [
  ['integer', `{"unused":${largeInteger}}\n`],
  ['recursion', '{"unused":' + '['.repeat(2000) + '0' + ']'.repeat(2000) + '}\n'],
] as const;
const excludedCandidates = [
  ['wrong-session', meta('other-session')], ['malformed-first', '{bad}\n'],
] as const;
it.each(excludedCandidates.flatMap(([firstName, first]) => resourceRecords.flatMap(([resource, tail]) =>
  ['timestamps', 'citations'].map(consumer => ({ firstName, first, resource, tail, consumer })),
)))('业务解析范围：已排除候选 $firstName/$resource 不阻断 $consumer 的真实候选', async ({ first, tail, consumer }) => {
  const f = await target(); const s = await source(f); const directory = join(f.root, 'sessions/2026/10/10');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `rollout-0-${id}.jsonl`), first + tail);
  await writeFile(join(directory, `rollout-1-${id}.jsonl`), meta() + message() + output(cite()));
  if (consumer === 'timestamps') {
    const local = await new MessageTimestamps(f.root).read(id, ['answer']); expect(local.answer).toBe(seconds);
    expect(await new MessageTimestamps('/wrong', s).read(id, ['answer'])).toEqual(local);
  } else {
    const local = await new MessageWebCitations(f.root).read(id, ['turn1view0']); expect(local).toHaveLength(1);
    expect(await new MessageWebCitations('/wrong', s).read(id, ['turn1view0'])).toEqual(local);
  }
});

const imageFailed = () => JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { kind: 'image_gen.generation', id: 'picture-item', status: 'failed' } } }) + '\n';
const imageModeration = () => output([{ text: `Some(${JSON.stringify(JSON.stringify({ error: { code: 'moderation_blocked', moderation_details: { moderation_stage: 'output', categories: ['safe'] } } }))})` }]);
const imageExpected = { code: 'moderation_blocked', stage: 'output', categories: ['safe'], requestId: null };
const imageTerminals = [
  ['moderation', imageModeration(), imageExpected],
  ['unknown', output('unknown error'), null],
  ['malformed', '{"type":"response_item","payload":{"type":"custom_tool_call_output",broken}\n', null],
] as const;
it.each(imageTerminals.flatMap(([terminal, value, expected]) => resourceRecords.map(([resource, tail]) => ({ terminal, value, expected, resource, tail }))))(
  '业务解析范围：image 首结果 $terminal 后的 $resource 和后续输出不再改变结果', async ({ value, expected, tail }) => {
    const f = await target(); const s = await source(f); await file(f, meta() + imageFailed() + value + tail + imageModeration());
    const local = await readImageGenerationError(f.root, id, 'picture-item'); expect(local).toEqual(expected);
    expect(await readImageGenerationError('/wrong', id, 'picture-item', s)).toEqual(local);
  },
);

it.each(['before-no-item', 'before-no-kind', 'after-no-output'].flatMap(phase => resourceRecords.map(([resource, tail]) => ({ phase, resource, tail }))))(
  '业务解析范围：image $phase 的无关 $resource 保持 Local 原始行过滤', async ({ phase, tail }) => {
    const f = await target(); const s = await source(f);
    const ignored = phase === 'before-no-item' ? tail.replace('"unused"', '"image_gen.generation"') : phase === 'before-no-kind' ? tail.replace('"unused"', '"picture-item"') : tail;
    await file(f, meta() + (phase.startsWith('before') ? ignored : '') + imageFailed() + (phase.startsWith('after') ? ignored : '') + imageModeration());
    const local = await readImageGenerationError(f.root, id, 'picture-item'); expect(local).toEqual(imageExpected);
    expect(await readImageGenerationError('/wrong', id, 'picture-item', s)).toEqual(local);
  },
);

it.each(['failed-event', 'matching-output'].flatMap(phase => resourceRecords.map(([resource, tail]) => ({ phase, resource, tail }))))(
  '业务解析范围：image 仍需解析的 $phase/$resource 明确能力失败', async ({ phase, tail }) => {
    const f = await target(); const s = await source(f); const required = phase === 'failed-event' ? imageFailed() : imageModeration();
    const withResource = required.trimEnd().replace(/}$/, ',' + tail.trim().slice(1));
    await file(f, meta() + (phase === 'matching-output' ? imageFailed() : '') + withResource + '\n' + (phase === 'failed-event' ? imageModeration() : ''));
    expect(await readImageGenerationError(f.root, id, 'picture-item')).toEqual(imageExpected);
    await expect(readImageGenerationError('/wrong', id, 'picture-item', s)).rejects.toMatchObject({ code: 'capability' });
  },
);

const laterImageCandidates = [
  ['moderation', meta() + imageFailed() + imageModeration()],
  ...resourceRecords.map(([resource, tail]) => [resource, meta() + imageFailed().trimEnd().replace(/}$/, ',' + tail.trim().slice(1)) + '\n' + imageModeration()] as const),
] as const;
it.each(imageTerminals.flatMap(([terminal, value, expected]) => laterImageCandidates.map(([later, content]) => ({ terminal, value, expected, later, content }))))(
  '跨文件首结果：$terminal 确定后不读取后一 $later 候选', async ({ value, expected, content }) => {
    const f = await target(); const s = await source(f); const directory = join(f.root, 'sessions/2026/10/10'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `rollout-0-${id}.jsonl`), meta() + imageFailed() + value);
    await writeFile(join(directory, `rollout-1-${id}.jsonl`), content);
    const local = await readImageGenerationError(f.root, id, 'picture-item'); expect(local).toEqual(expected);
    expect(await readImageGenerationError('/wrong', id, 'picture-item', s)).toEqual(local);
  },
);

it.each([['no-item', meta()], ['no-output', meta() + imageFailed()], ...resourceRecords.map(([resource, tail]) => ['wrong-session-' + resource, meta('other-session') + tail + imageFailed() + imageModeration()])])(
  '跨文件首结果：尚未匹配的 %s 仍允许读取后一真实候选', async (kind, first) => {
    const f = await target(); const s = await source(f); const directory = join(f.root, 'sessions/2026/10/10'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `rollout-0-${id}.jsonl`), first!);
    await writeFile(join(directory, `rollout-1-${id}.jsonl`), meta() + imageFailed() + imageModeration());
    // Local旧image只读首locator且不验证session；Remote既有定位允许尚未匹配时继续。
    expect(await readImageGenerationError(f.root, id, 'picture-item')).toEqual(kind!.startsWith('wrong-session') ? imageExpected : null);
    expect(await readImageGenerationError('/wrong', id, 'picture-item', s)).toEqual(imageExpected);
  },
);

it('跨文件首结果：终止null仍耗尽当前投影并拒绝输出摘要损坏', async () => {
  const f = await target(); const s = await source(f); await file(f, meta() + imageFailed() + output('unknown'));
  const execute = f.commands.execute.bind(f.commands); let corrupted = false;
  f.commands.execute = async options => {
    const result = await execute(options); const value = JSON.parse(result.stdout.toString());
    if (!value.token) return result;
    corrupted = true; value.sha256 = '0'.repeat(64);
    return { ...result, stdout: Buffer.from(JSON.stringify(value) + '\n') };
  };
  await expect(readImageGenerationError('/wrong', id, 'picture-item', s)).rejects.toMatchObject({ code: 'protocol' }); expect(corrupted).toBe(true);
});

it('跨文件首结果：活动文件分页变化reset后不携带旧诊断或匹配状态', async () => {
  const f = await target(); const s = await source(f); const directory = join(f.root, 'sessions/2026/10/10'); await mkdir(directory, { recursive: true });
  const first = join(directory, `rollout-0-${id}.jsonl`); const stage = '变'.repeat(20000);
  const error = { error: { code: 'moderation_blocked', moderation_details: { moderation_stage: stage, categories: [] } } };
  await writeFile(first, meta() + imageFailed() + output([{ text: `Some(${JSON.stringify(JSON.stringify(error))})` }]));
  await writeFile(join(directory, `rollout-1-${id}.jsonl`), meta() + imageFailed() + imageModeration()); let changed = false;
  f.beforeRequest(async request => {
    if (!changed && request.mode === 'scan' && String(request.path).endsWith(`rollout-0-${id}.jsonl`) && Number(request.offset) > 0) { changed = true; await writeFile(first, meta()); }
  });
  expect(await readImageGenerationError('/wrong', id, 'picture-item', s)).toEqual(imageExpected); expect(changed).toBe(true);
  expect(f.requests.filter(request => request.mode === 'scan' && String(request.path).endsWith(`rollout-0-${id}.jsonl`) && request.offset === 0).length).toBeGreaterThan(1);
});

it.each([false, true])('引用标题UTF16边界、Unicode行首与畸形/嵌套NaN和Infinity保持Local差分 escaped=%s', async escaped => {
  const f = await target(); const s = await source(f);
  const titles = ['😀'.repeat(500), '😀'.repeat(501), 'x'.repeat(1000), 'x'.repeat(1001), '短标题'];
  const refs = titles.map((_, i) => `turn${i}view0`);
  const content = titles.map((title, i) => `${title} (https://example.com/${i})\n【${refs[i]}】 source`).join('\n');
  const unicode = '\u2028单独标题 (https://example.com/unicode)\n【turn8view0】 source';
  const nan = output(cite('https://example.com/invalid', 'turn9view0')).trimEnd().replace(/}$/, ',"unexpected":NaN}') + '\n';
  const infinity = message('invalid-infinity').trimEnd().replace(/}$/, ',"unexpected":Infinity}') + '\n';
  const line = output(content + unicode); const p = await file(f, meta() + (escaped ? line.replaceAll('\u2028', '\\u2028') : line));
  const wanted = [...refs, 'turn8view0', 'turn9view0'];
  expect((await new MessageWebCitations(f.root).read(id, wanted)).map(value => value.refId)).toEqual(escaped ? ['turn0view0', 'turn2view0', 'turn4view0', 'turn8view0'] : []);
  expect(await new MessageWebCitations('/wrong', s).read(id, wanted)).toEqual(await new MessageWebCitations(f.root).read(id, wanted));
  await appendFile(p, nan + infinity + output([{ text: '{"status":"fulfilled","value":NaN}' }]).trimEnd());
  expect(await new MessageWebCitations('/wrong', s).read(id, wanted)).toEqual(await new MessageWebCitations(f.root).read(id, wanted));
  expect(await new MessageTimestamps('/wrong', s).read(id, ['invalid-infinity'])).toEqual({});
});

it('图像错误类别按UTF16长度过滤，未知/畸形后继不能被后来审核文本误分类', async () => {
  const f = await target(); const s = await source(f);
  const failed = JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { kind: 'image_gen.generation', id: 'image', status: 'failed' } } }) + '\n';
  const error = { error: { code: 'moderation_blocked', moderation_details: { categories: ['😀'.repeat(20), '😀'.repeat(21)], moderation_stage: 'output' } } };
  const tool = output([{ text: `Some(${JSON.stringify(JSON.stringify(error))})` }]);
  const p = await file(f, meta() + failed + tool);
  expect(await readImageGenerationError('/wrong', id, 'image', s)).toEqual(await readImageGenerationError(f.root, id, 'image'));
  await writeFile(p, meta() + failed + '{"type":"response_item","payload":{"type":"custom_tool_call_output",broken}\n' + tool);
  expect(await readImageGenerationError('/wrong', id, 'image', s)).toBeNull();
  const invalid = { error: { code: 'moderation_blocked', moderation_details: { categories: [] }, unexpected: 'REPLACE' } };
  const inner = JSON.stringify(invalid).replace('"REPLACE"', 'NaN');
  await writeFile(p, meta() + failed + output([{ text: `Some(${JSON.stringify(inner)})` }]));
  expect(await readImageGenerationError('/wrong', id, 'image', s)).toBeNull();
});

it('64KiB首行边界按字节计算，缺换行分类仍missing而EOF完整消息/引用兼容', async () => {
  const f = await target(); const s = await source(f); const base = meta(id, { source: 'cli', extra: '' });
  const exact = base.replace('"extra":""', '"extra":"' + 'x'.repeat(65536 - Buffer.byteLength(base)) + '"');
  expect(Buffer.byteLength(exact)).toBe(65536); const p = await file(f, exact + message());
  expect((await readLocalThreadMetadata('/wrong', id, s))?.source).toBe('cli');
  await writeFile(p, exact.trimEnd()); expect(await readLocalThreadMetadata('/wrong', id, s)).toBeUndefined();
  await writeFile(p, meta() + message('__proto__') + message('constructor').trimEnd());
  const reader = new MessageTimestamps('/wrong', s);
  expect(await reader.read(id, ['__proto__', 'constructor'])).toEqual(Object.fromEntries([['__proto__', seconds], ['constructor', seconds]]));
  const event = { method: 'item/completed', params: { threadId: id, item: { id: 'constructor', type: 'agentMessage', phase: 'commentary' } } };
  expect((await reader.notification(event)).params.item).toMatchObject({ timestamp: seconds });
  await writeFile(p, meta() + output(cite()).trimEnd());
  const citations = new MessageWebCitations('/wrong', s); const item = { type: 'agentMessage', text: '回答。citeturn1view0' };
  expect((await citations.result(id, { thread: { turns: [{ items: [item] }] } })).thread.turns[0].items[0].webCitations).toHaveLength(1);
  expect((await citations.notification({ method: 'item/completed', params: { threadId: id, item } })).params.item).toHaveProperty('webCitations');
});

it('删除窗口中的文件不交付旧局部时间，外部取消一个读取不影响同RPC的另一个读取', async () => {
  const f = await target(); const s = await source(f); const p = await file(f, meta() + message('old').repeat(1500));
  f.beforeRequest(async r => { if (r.mode === 'scan' && Number(r.offset) > 0) await rm(p, { force: true }); });
  expect(await new MessageTimestamps('/wrong', s).read(id, ['old'])).toEqual({});
  f.beforeRequest(); await file(f, meta() + message()); f.delay(100); const count = f.requests.length;
  const controller = new AbortController(); const one = new MessageTimestamps('/wrong', s).read(id, ['answer'], controller.signal); const cancelled = one.catch(error => error);
  const two = new MessageTimestamps('/wrong', s).read(id, ['answer']);
  await until(() => f.requests.length >= count + 2); controller.abort();
  expect(await cancelled).toMatchObject({ code: 'cancelled' }); expect(await two).toEqual({ answer: seconds }); expect(f.session.ready).toBe(true);
});
