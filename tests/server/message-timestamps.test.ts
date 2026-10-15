import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { MessageTimestamps } from '../../server/message-timestamps.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const threadId = '01a12457-49bd-79c3-abdb-cfdf41878cfc';
const stamp = '2026-10-10T13:44:22.123Z';
const seconds = Date.parse(stamp) / 1000;
const line = (id: string, extra = {}) => JSON.stringify({ timestamp: stamp, type: 'response_item', payload: { type: 'message', role: 'assistant', id, content: [{ text: 'private body' }] }, ...extra }) + '\n';
async function fixture(archived = false, metaId = threadId) {
  const root = await mkdtemp(join(tmpdir(), 'message-timestamps-')); roots.push(root);
  const directory = archived ? join(root, 'archived_sessions') : join(root, 'sessions', '2026', '10', '10');
  await mkdir(directory, { recursive: true });
  const file = join(directory, `rollout-2026-10-10T13-44-22-${threadId}.jsonl`);
  await writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id: metaId } }) + '\n');
  return { root, file, reader: new MessageTimestamps(root) };
}
it.each([false, true])('活动及归档原始消息按精确 ID 返回真实秒时间，且不改源文件 archived=%s', async archived => {
  const f = await fixture(archived);
  await appendFile(f.file, line('c-prefix') + line('c') + line('other') + '{broken}\n' + line('invalid', { timestamp: 'invalid' }) +
    line('user', { payload: { type: 'message', role: 'user', id: 'user' } }) +
    line('event', { type: 'event_msg' }));
  const before = await readFile(f.file);
  expect(await f.reader.read(threadId, ['c', 'missing', 'invalid', 'user', 'event'])).toEqual({ c: seconds });
  expect(await readFile(f.file)).toEqual(before);
});
it('缓存允许文件追加、补齐部分行并读取新 ID', async () => {
  const f = await fixture();
  await appendFile(f.file, line('c'));
  expect(await f.reader.read(threadId, ['c', 'later'])).toEqual({ c: seconds });
  const later = line('later');
  await appendFile(f.file, later.slice(0, 40));
  expect(await f.reader.read(threadId, ['later'])).toEqual({});
  await appendFile(f.file, later.slice(40));
  expect(await f.reader.read(threadId, ['later'])).toEqual({ later: seconds });
  expect(await f.reader.read(threadId, ['c'])).toEqual({ c: seconds });
});
it.each(['wrong-thread', null])('元数据线程不匹配或损坏时不借用文件名时间 %s', async metaId => {
  const f = await fixture(false, metaId as any);
  await appendFile(f.file, line('c'));
  expect(await f.reader.read(threadId, ['c'])).toEqual({});
  await writeFile(f.file, '{broken}\n' + line('c'));
  expect(await f.reader.read(threadId, ['c'])).toEqual({});
});
it('未知线程及路径不猜时间', async () => {
  const f = await fixture();
  expect(await f.reader.read('../sessions', ['c'])).toEqual({});
  expect(await f.reader.read(threadId, ['../c'])).toEqual({});
});

it('续写文件沿用原线程元数据，合并最初文件和 _UUID 文件中的消息', async () => {
  const f = await fixture();
  await appendFile(f.file, line('original'));
  await writeFile(f.file.replace('.jsonl', '_01a1396f-d4a4-7431-9c9b-85f85528d46b.jsonl'),
    JSON.stringify({ type: 'session_meta', payload: { id: threadId } }) + '\n' + line('continued'));
  expect(await f.reader.read(threadId, ['original', 'continued'])).toEqual({ original: seconds, continued: seconds });
});
it('消息 ID 与对象属性同名时仍按精确记录读取，不借用原型属性', async () => {
  const f = await fixture();
  expect(await f.reader.read(threadId, ['toString'])).toEqual({});
  expect(await f.reader.read(threadId, ['toString'])).toEqual({});
  await appendFile(f.file, line('constructor') + line('__proto__'));
  expect(await f.reader.read(threadId, ['constructor', '__proto__'])).toEqual(
    Object.fromEntries([['constructor', seconds], ['__proto__', seconds]]),
  );
  expect(await f.reader.read(threadId, ['constructor', '__proto__'])).toEqual(
    Object.fromEntries([['constructor', seconds], ['__proto__', seconds]]),
  );
});
