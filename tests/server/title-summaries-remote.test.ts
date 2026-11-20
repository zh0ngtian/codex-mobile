// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { RemoteStream } from '../../server/remote/relay.js';
import { RemoteRpcSession, type RemoteRpcSessionOptions } from '../../server/remote/rpc-session.js';
import type { RpcMessage } from '../../server/remote/envelope.js';
import { TitleSummaries } from '../../server/title-summaries.js';
import { encodeUserMessage } from '../../server/user-message-format.js';
import { CONVERSATION_TITLE_REQUEST } from '../../server/conversation-title-format.js';
import { assertRemoteOperation, withRemoteOperation } from '../../server/remote/operation-guard.js';
const cleanup: Array<() => unknown> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
async function fixture(options: { hang?: boolean; request?: boolean; loop?: boolean; text?: string; title?: string; ephemeral?: boolean; single?: boolean; disconnect?: boolean; images?: boolean; guard?: boolean } = {}) {
  const frames: Array<{ stream: string; message: RpcMessage }> = []; const streams: RemoteStream[] = []; let sequence = 0; let n = 0; const rpcOptions: RemoteRpcSessionOptions[] = [];
  const make = async (id: string, config: RemoteRpcSessionOptions = {}) => {
    const stream = new RemoteStream('same-environment', id, async (_stream, frame) => {
      if (!frame) return { seqId: 0 };
      if (options.guard) assertRemoteOperation();
      // 真实JSON编解码，保留response与request的字节差异。
      const message = JSON.parse(JSON.stringify(frame)); frames.push({ stream: id, message });
      const send = (value: RpcMessage) => queueMicrotask(() => stream.emit('message', JSON.parse(JSON.stringify(value)), { seqId: ++sequence }));
      if (message.method === 'initialize') send({ id: message.id, result: { codexHome: '/target', platformFamily: 'unix', platformOs: 'linux', userAgent: 'fixture' } });
      else if (message.method === 'thread/turns/list') send({ id: message.id, result: { data: [{ items: [{ type: 'userMessage', content: [{ type: 'text', text: options.text ?? (message.params.cursor ? '第二页' : '修复登录') }, ...(options.images ? [{ type: 'image', url: 'private-image-bytes' }] : [])] }, { type: 'agentMessage', text: 'private assistant' }] }], nextCursor: options.loop ? 'loop' : options.single || message.params.cursor ? null : 'second' } });
      else if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'summary-' + id, ephemeral: options.ephemeral !== false } } });
      else if (message.method === 'turn/start') {
        send({ id: message.id, result: { turn: { id: 'turn-' + id } } });
        send({ method: 'turn/completed', params: { threadId: 'summary-' + id, turn: { id: 'unrelated-turn', status: 'completed', items: [{ type: 'agentMessage', text: '{"title":"错误回合"}' }] } } });
        if (options.disconnect) queueMicrotask(() => stream.emit('disconnect', { reason: 'network', mayHaveBeenSent: true }));
        else if (options.request) send({ id: 42, method: 'item/tool/requestUserInput', params: { threadId: 'summary-' + id, turnId: 'turn-' + id } });
        else if (!options.hang) send({ method: 'turn/completed', params: { threadId: 'summary-' + id, turn: { id: 'turn-' + id, status: 'completed', items: [{ type: 'agentMessage', text: JSON.stringify({ title: options.title ?? '目标标题' }) }] } } });
      } else if (message.method && message.id) send({ id: message.id, result: 42 });
      return { seqId: sequence };
    }, () => {});
    streams.push(stream); const session = RemoteRpcSession.fromRemoteStream(stream, config); await session.initialize(); return session;
  };
  const caller = await make('caller'); cleanup.push(() => { caller.close(); for (const s of streams) void s.close(); });
  const factory = async (_signal: AbortSignal, config: RemoteRpcSessionOptions) => { rpcOptions.push(config); return make('owned-' + ++n, config); };
  return { caller, factory, frames, streams, rpcOptions };
}
it('每次使用独立同目标ready逻辑会话，不重复initialize，保留全部分页和模型沙箱，caller继续42', async () => {
  const f = await fixture(); const summaries = new TitleSummaries(f.factory);
  expect(await summaries.summarize('source')).toBe('目标标题'); expect(await summaries.summarize('source')).toBe('目标标题');
  const owned = f.frames.filter(x => x.stream !== 'caller');
  for (const stream of ['owned-1', 'owned-2']) expect(owned.filter(x => x.stream === stream && x.message.method === 'initialize')).toHaveLength(1);
  expect(owned.filter(x => x.message.method === 'thread/turns/list').map(x => (x.message.params as any).cursor)).toEqual([null, 'second', null, 'second']);
  expect(owned.find(x => x.message.method === 'thread/start')?.message.params).toMatchObject({ model: 'gpt-6-luna', serviceTier: 'priority', ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', config: { project_doc_max_bytes: 0, model_reasoning_effort: 'low' } });
  const turn = owned.find(x => x.message.method === 'turn/start')!.message.params as any;
  expect(turn).toMatchObject({ effort: 'low', model: 'gpt-6-luna', serviceTier: 'priority' }); expect(turn.input[0].text).toContain('第二页'); expect(turn.input[0].text).not.toContain('private assistant');
  expect(f.rpcOptions).toEqual([{ maxRequestBytes: 16 * 1024 * 1024, maxInboundBytes: 16 * 1024 * 1024 }, { maxRequestBytes: 16 * 1024 * 1024, maxInboundBytes: 16 * 1024 * 1024 }]);
  expect(f.streams.slice(1).every(s => s.closed)).toBe(true); expect(await f.caller.call('alive')).toBe(42);
});
it('tools/questions真实错误响应拒绝，关闭自有流而caller存活', async () => {
  const f = await fixture({ request: true }); await expect(new TitleSummaries(f.factory).summarize('source')).rejects.toThrow();
  expect(f.frames.find(x => x.message.id === 42 && !x.message.method)?.message).toEqual({ id: 42, error: { code: -32601, message: 'Title summary does not support tools' } });
  expect(f.frames.some(x => x.message.method === 'turn/interrupt')).toBe(true); expect(await f.caller.call('alive')).toBe(42);
});
it.each([{ loop: true }, { ephemeral: false }, { title: 'x'.repeat(41) }, { title: 'bad\nline' }])('真实协议失败不推理重放 %j', async options => {
  const f = await fixture(options); await expect(new TitleSummaries(f.factory).summarize('source')).rejects.toThrow();
  expect(f.frames.filter(x => x.message.method === 'turn/start').length).toBeLessThanOrEqual(1); expect(await f.caller.call('alive')).toBe(42);
});
it('超时/取消只终结自有回合和流，并释放并发额度', async () => {
  const f = await fixture({ hang: true }); const summaries = new TitleSummaries(f.factory, 60);
  await expect(summaries.summarize('source')).rejects.toThrow('超时');
  const abort = new AbortController(); const op = summaries.summarize('source', abort.signal); abort.abort(); await expect(op).rejects.toThrow();
  expect(f.streams.slice(1).every(s => s.closed)).toBe(true); expect(await f.caller.call('alive')).toBe(42);
});
it('父Runtime操作结束后仍有限interrupt自有未完成回合并unsubscribe，caller存活', async () => {
  const f = await fixture({ hang: true, guard: true }); const abort = new AbortController(); let live = true;
  const op = withRemoteOperation(() => { if (!live) throw new Error('parent ended'); }, () => new TitleSummaries(f.factory).summarize('source', abort.signal));
  void op.catch(() => {});
  while (!f.frames.some(x => x.message.method === 'turn/start')) await new Promise(r => setTimeout(r, 1));
  await new Promise(r => setTimeout(r, 1)); live = false; abort.abort(); await expect(op).rejects.toThrow();
  expect(f.frames.filter(x => x.message.method === 'turn/interrupt').map(x => x.message.params)).toEqual([{ threadId: 'summary-owned-1', turnId: 'turn-owned-1' }]);
  expect(f.frames.some(x => x.message.method === 'thread/unsubscribe')).toBe(true); expect(f.streams.slice(1).every(s => s.closed)).toBe(true); expect(await f.caller.call('alive')).toBe(42);
});
it('原16MiB历史/请求预算仅应用自有会话，超过共享默认1MiB的用户消息仍完整总结', async () => {
  const f = await fixture({ text: 'x'.repeat(2 * 1024 * 1024) });
  expect(await new TitleSummaries(f.factory).summarize('source')).toBe('目标标题');
  const prompt = (f.frames.find(x => x.message.method === 'turn/start')!.message.params as any).input[0].text;
  expect(prompt.length).toBeGreaterThan(4 * 1024 * 1024); expect(await f.caller.call('alive')).toBe(42);
});
it('四并发在工厂等待时就占用额度，close及时释放并关闭迟到自有session', async () => {
  const f = await fixture(); let resolve!: () => void; const gate = new Promise<void>(r => { resolve = r; });
  const summaries = new TitleSummaries(async (signal, options) => { await gate; return f.factory(signal, options); });
  const pending = Array.from({ length: 4 }, () => summaries.summarize('source').catch(e => e));
  await expect(summaries.summarize('source')).rejects.toThrow('繁忙'); summaries.close();
  expect((await Promise.all(pending)).every(x => x instanceof Error)).toBe(true); resolve();
  await new Promise(r => setTimeout(r, 10)); expect(f.streams.slice(1).every(s => s.closed)).toBe(true); expect(await f.caller.call('alive')).toBe(42);
});
it('接近原16MiB的完整历史/请求成功，越过16MiB的响应失败且caller存活', async () => {
  const good = await fixture({ single: true, text: 'x'.repeat(16 * 1024 * 1024 - 8192) });
  expect(await new TitleSummaries(good.factory).summarize('source')).toBe('目标标题');
  const turn = good.frames.find(x => x.message.method === 'turn/start')!; expect(Buffer.byteLength(JSON.stringify(turn.message))).toBeGreaterThan(16 * 1024 * 1024 - 8192);
  expect(await good.caller.call('alive')).toBe(42);
  const bad = await fixture({ single: true, text: 'x'.repeat(16 * 1024 * 1024 + 1) });
  await expect(new TitleSummaries(bad.factory).summarize('source')).rejects.toThrow();
  expect(bad.frames.some(x => x.message.method === 'turn/start')).toBe(false); expect(await bad.caller.call('alive')).toBe(42);
}, 30000);
it('同自有逻辑流真实断线后不重放推理，caller继续RPC', async () => {
  const f = await fixture({ disconnect: true }); await expect(new TitleSummaries(f.factory).summarize('source')).rejects.toThrow('断开');
  expect(f.frames.filter(x => x.message.method === 'turn/start')).toHaveLength(1); expect(f.streams.slice(1).every(s => s.closed)).toBe(true); expect(await f.caller.call('alive')).toBe(42);
});
it('用户消息只投影解码正文、附件名、引用text/annotation和images标记', async () => {
  const text = encodeUserMessage(`修复登录\n\n${CONVERSATION_TITLE_REQUEST}`, [{ name: '截图.png', path: '/private/target/image.png' }], [{ text: '之前的建议', annotation: '请落实', source: { messageId: 'secret-source', startOffset: 0, endOffset: 2 } }]);
  const f = await fixture({ text, images: true, single: true }); expect(await new TitleSummaries(f.factory).summarize('source')).toBe('目标标题');
  const prompt = (f.frames.find(x => x.message.method === 'turn/start')!.message.params as any).input[0].text;
  const messages = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
  expect(messages).toEqual([{ text: '修复登录', attachments: ['截图.png'], references: [{ text: '之前的建议', annotation: '请落实' }], images: true }]);
  expect(prompt).not.toContain('/private/target'); expect(prompt).not.toContain('secret-source'); expect(prompt).not.toContain('private-image-bytes');
});
