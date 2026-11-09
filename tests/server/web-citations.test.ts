import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { MessageWebCitations } from '../../server/web-citations.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const threadId = '01a1bf54-1117-7350-b953-0b84498dda7d';
const ids = ['turn480194view0', 'turn480194view1'];
const source = (id: string, url = 'https://example.com/guide') => `文档标题 (${url})\n【${id}】 [wordlim: 200] Content type: text/html;\n正文不应传给客户端`;
const output = (value: unknown, type = 'custom_tool_call_output') => JSON.stringify({ type: 'response_item', payload: { type, output: value } }) + '\n';
async function fixture(archived = false, meta = threadId) {
  const root = await mkdtemp(join(tmpdir(), 'web-citations-')); roots.push(root);
  const dir = archived ? join(root, 'archived_sessions') : join(root, 'sessions', '2026', '11', '09');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `rollout-2026-11-09T16-02-00-${threadId}.jsonl`);
  await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id: meta } }) + '\n');
  return { root, path, reader: new MessageWebCitations(root) };
}
it.each([false, true])('从本会话活动或归档工具输出恢复来源，不传工具正文也不改原文件 %s', async archived => {
  const f = await fixture(archived);
  await appendFile(f.path, output([{ type: 'input_text', text: source(ids[0]) + '\n\n' + source(ids[1], 'https://example.com/code') }]));
  const before = await readFile(f.path);
  const item = { id: 'answer', type: 'agentMessage', text: `回答。cite${ids.join('')}`, phase: 'final_answer' };
  const result = await f.reader.result(threadId, { initialTurnsPage: { data: [{ id: 'turn', items: [item] }] } });
  expect(result.initialTurnsPage.data[0].items[0]).toEqual({ ...item, webCitations: [
    { refId: ids[0], url: 'https://example.com/guide', title: '文档标题' },
    { refId: ids[1], url: 'https://example.com/code', title: '文档标题' },
  ] });
  expect(JSON.stringify(result)).not.toContain('正文不应传给客户端');
  expect(item).not.toHaveProperty('webCitations');
  expect(await readFile(f.path)).toEqual(before);
  const event = { method: 'item/completed', params: { threadId, item } };
  expect((await f.reader.notification<any>(event)).params.item.webCitations).toHaveLength(2);
  expect((await f.reader.result(threadId, { thread: { id: threadId, turns: [{ items: [item] }] } })).thread.turns[0].items[0].webCitations).toHaveLength(2);
});
it('追加与未完成行会失效缓存，兼容 JSON MCP content 和普通 function 输出', async () => {
  const f = await fixture();
  expect(await f.reader.read(threadId, ids)).toEqual([]);
  const line = output(JSON.stringify({ content: [{ type: 'text', text: source(ids[0]) }] }), 'function_call_output');
  await appendFile(f.path, line.slice(0, 50));
  expect(await f.reader.read(threadId, ids)).toEqual([]);
  await appendFile(f.path, line.slice(50));
  expect(await f.reader.read(threadId, ids)).toHaveLength(1);
  expect(await f.reader.read(threadId, ids)).toHaveLength(1);
});
it('跨日期续写可使用原文件来源，冲突的同名来源不生成错误链接', async () => {
  const f = await fixture();
  await appendFile(f.path, output(source(ids[0])));
  const dir = join(f.root, 'sessions', '2026', '11', '12'); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `rollout-next-${threadId}_01a1bf54-1117-7350-b953-0b84498dda7d.jsonl`),
    JSON.stringify({ type: 'session_meta', payload: { id: threadId } }) + '\n' + output(source(ids[1])));
  expect(await f.reader.read(threadId, ids)).toHaveLength(2);
  await appendFile(f.path, output(source(ids[0], 'https://example.com/conflict')));
  expect((await f.reader.read(threadId, ids)).map(source => source.refId)).toEqual([ids[1]]);
});
it('不从用户或助手正文猜网址，不借用其他会话，不接受危险协议及无效请求', async () => {
  const f = await fixture();
  for (const role of ['user', 'assistant']) await appendFile(f.path, JSON.stringify({ type: 'response_item', payload: { type: 'message', role, content: [{ text: source(ids[0]) }] } }) + '\n');
  await appendFile(f.path, output(source(ids[0], 'javascript:alert(1)')) + output(source(ids[1], 'https://user:password@example.com')));
  expect(await f.reader.read(threadId, ids)).toEqual([]);
  expect(await f.reader.read('../sessions', ids)).toEqual([]);
  expect(await f.reader.read(threadId, ['__proto__', '../id'])).toEqual([]);
  const wrong = await fixture(false, 'another-thread');
  await appendFile(wrong.path, output(source(ids[0])));
  expect(await wrong.reader.read(threadId, ids)).toEqual([]);
});
