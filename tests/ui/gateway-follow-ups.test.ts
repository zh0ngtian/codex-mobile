import { describe, expect, it, vi } from 'vitest';
import { followUpRequest, HostedQueueSubmission, type HostedFollowUp } from '../../src/backends/follow-ups';

const backend = { id: 'mac', name: 'Mac', baseUrl: 'http://gateway.test:18766', token: 'private', enabled: true, order: 0 };
const item: HostedFollowUp = { id: 'queue-id', threadId: 'thread', inputText: 'next', text: 'next', attachmentCount: 0, state: 'queued', revision: 1 };

describe('网关排队 API', () => {
  it.each(['http', 'stream'] as const)('传输模式 %s 使用同一鉴权 HTTP 队列', async (transportMode) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [item] })));
    expect(await followUpRequest({ ...backend, transportMode }, undefined, fetcher)).toEqual({ items: [item] });
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/follow-ups');
    expect(new URL(url).searchParams.get('token')).toBe('private');
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
  });
  it('修改操作保留幂等 ID 和版本且不依赖 RPC session', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    const action = { action: 'cancel' as const, id: item.id, revision: 1 };
    await followUpRequest(backend, action, fetcher);
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(url).searchParams.has('sessionId')).toBe(false);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(action);
  });
  it('旧网关缺少接口时明确提示升级', async () => {
    await expect(followUpRequest(backend, undefined, async () => new Response('Not found', { status: 404 }))).rejects.toThrow('网关需要升级');
  });
  it('版本冲突保留网关解释', async () => {
    await expect(followUpRequest(backend, { action: 'cancel', id: item.id, revision: 1 }, async () => new Response(JSON.stringify({ error: { message: '消息已开始发送，不能取消' } }), { status: 409 }))).rejects.toThrow('消息已开始发送');
  });
  it('拒绝不完整列表，避免误清空本地展示', async () => {
    await expect(followUpRequest(backend, undefined, async () => new Response('{}'))).rejects.toThrow('响应无效');
  });
});


it("入队确认丢失后复用同一 UUID 和已上传附件，避免重复托管", async () => {
  const submission = new HostedQueueSubmission();
  const prepare = vi.fn(async () => ({ threadId: "thread", inputText: "next", text: "next", attachmentCount: 1, extraInput: [{ type: "text", text: "/tmp/upload-once.txt" }], settings: {} }));
  const first = await submission.prepare("same-draft", prepare);
  const retry = await submission.prepare("same-draft", prepare);
  expect(retry).toEqual(first);
  expect(prepare).toHaveBeenCalledTimes(1);
  submission.confirmed(first.id);
  expect((await submission.prepare("same-draft", prepare)).id).not.toBe(first.id);
});


it('较早动作的确认不能清除后续不同草稿的请求身份', async () => {
  const submission = new HostedQueueSubmission();
  const build = async () => ({ threadId: 'thread', inputText: 'next', text: 'next', attachmentCount: 0, extraInput: [], settings: {} });
  const first = await submission.prepare('first', build);
  const later = await submission.prepare('later', build);
  submission.confirmed(first.id);
  expect(submission.hasPending).toBe(true);
  expect((await submission.prepare('later', build)).id).toBe(later.id);
});
