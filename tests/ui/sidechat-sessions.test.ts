import { describe, expect, it, vi } from 'vitest';
import { SidechatSessions, SIDECHAT_INSTRUCTIONS } from '../../src/sidechat/sessions';

function fixture() {
  let now = 1000;
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
  let sequence = 0;
  const request = vi.fn(async (method: string, params: any): Promise<any> => {
    if (method === 'thread/turns/list') return { data: [{ id: 'running', status: 'inProgress' }, { id: 'done', status: 'completed' }], nextCursor: null };
    if (method === 'thread/fork') return { thread: { id: `side-${++sequence}`, cwd: '/work', ephemeral: true, turns: [{ id: 'done', items: [{ text: '继承正文' }] }] }, model: 'gpt', reasoningEffort: 'high' };
    if (method === 'turn/start') return { turn: { id: `new-${sequence}`, status: 'inProgress', items: [] } };
    return {};
  });
  const sessions = new SidechatSessions('host', storage, () => now);
  return { sessions, request, data, tick: (ms: number) => { now += ms; } };
}

describe('Sidechat 生命周期', () => {
  it('精确分叉最近结束回合，隐藏继承消息并注入边界', async () => {
    const f = fixture();
    const side = await f.sessions.create({ request: f.request }, { id: 'main', cwd: '/work', name: '主聊天' });
    expect(f.request).toHaveBeenCalledWith('thread/fork', expect.objectContaining({ threadId: 'main', lastTurnId: 'done', ephemeral: true, excludeTurns: true, developerInstructions: SIDECHAT_INSTRUCTIONS, config: { 'features.multi_agent': false } }));
    expect(side.thread.turns).toEqual([]);
    expect(side.settings.model).toBe('gpt');
    expect(SIDECHAT_INSTRUCTIONS).toContain('不得创建子代理');
  });
  it('无结束回合时拒绝创建，不能省略分叉边界回退', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce({ data: [{ id: 'run', status: 'inProgress' }], nextCursor: null });
    await expect(f.sessions.create({ request: f.request }, { id: 'main' })).rejects.toThrow('已结束');
    expect(f.request).not.toHaveBeenCalledWith('thread/fork', expect.anything());
  });
  it('多分支事件互不串入，正文仅驻留内存', async () => {
    const f = fixture(); const a = await f.sessions.create({ request: f.request }, { id: 'main' }); const b = await f.sessions.create({ request: f.request }, { id: 'main' });
    f.sessions.observe({ method: 'turn/started', params: { threadId: a.id, turn: { id: 'a-turn', status: 'inProgress', items: [] } } });
    f.sessions.observe({ method: 'item/completed', params: { threadId: a.id, turnId: 'a-turn', item: { id: 'answer', type: 'agentMessage', text: '秘密正文' } } });
    expect(a.thread.turns[0].items[0].text).toBe('秘密正文'); expect(b.thread.turns).toEqual([]);
    const persisted = [...f.data.values()].join(''); expect(persisted).toContain('a-turn'); expect(persisted).not.toContain('秘密正文'); expect(persisted).not.toContain('继承正文'); expect(persisted).not.toContain('developerInstructions');
  });
  it('运行中不超时，结束后重新计算24小时', async () => {
    const f = fixture(); const a = await f.sessions.create({ request: f.request }, { id: 'main' });
    f.sessions.observe({ method: 'turn/started', params: { threadId: a.id, turn: { id: 'a', status: 'inProgress', items: [] } } });
    f.tick(25 * 3600000); await f.sessions.expire({ request: f.request }); expect(f.sessions.get(a.id)).toBe(a);
    f.sessions.observe({ method: 'turn/completed', params: { threadId: a.id, turn: { id: 'a', status: 'completed' } } });
    f.tick(23 * 3600000); await f.sessions.expire({ request: f.request }); expect(f.sessions.get(a.id)).toBe(a);
    f.tick(3600000); await f.sessions.expire({ request: f.request }); expect(f.sessions.get(a.id)).toBeUndefined();
  });
  it('关闭正在执行的分支先中断再取消订阅，失败不能假成功', async () => {
    const f = fixture(); const a = await f.sessions.create({ request: f.request }, { id: 'main' });
    f.sessions.observe({ method: 'turn/started', params: { threadId: a.id, turn: { id: 'a', status: 'inProgress', items: [] } } });
    await f.sessions.close({ request: f.request }, a.id);
    expect(f.request.mock.calls.slice(-2)).toEqual([['turn/interrupt', { threadId: a.id, turnId: 'a' }], ['thread/unsubscribe', { threadId: a.id }]]);
    expect(f.sessions.get(a.id)).toBeUndefined();
    const b = await f.sessions.create({ request: f.request }, { id: 'main' }); f.request.mockRejectedValueOnce(new Error('offline'));
    await expect(f.sessions.close({ request: f.request }, b.id)).rejects.toThrow('offline'); expect(f.sessions.get(b.id)).toBe(b);
  });
  it('忙碌分支将输入仅排在内存，完成后独立发送', async () => {
    const f = fixture(); const a = await f.sessions.create({ request: f.request }, { id: 'main' });
    await f.sessions.submit({ request: f.request }, a.id, [{ type: 'text', text: '第一条' }], {});
    await f.sessions.submit({ request: f.request }, a.id, [{ type: 'text', text: '第二条' }], {});
    expect(f.request.mock.calls.filter(call => call[0] === 'turn/start')).toHaveLength(1);
    expect([...f.data.values()].join('')).not.toContain('第二条');
    f.sessions.observe({ method: 'turn/completed', params: { threadId: a.id, turn: { id: 'new-1', status: 'completed' } } });
    await vi.waitFor(() => expect(f.request.mock.calls.filter(call => call[0] === 'turn/start')).toHaveLength(2));
  });
});

it('App重连只读daemon内存投影，失效不重建或调用官方持久历史', async () => {
 const f = fixture(); const side = await f.sessions.create({ request: f.request }, { id: 'main' });
 const request = vi.fn(async (method: string) => {
  expect(method).toBe('mobile/sidechat/read');
  return { parentId: 'main', forkTurnId: 'done', busy: false, thread: { id: side.id, ephemeral: true, turns: [{ id: 'restored', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: '恢复正文' }] }] } };
 });
 const restored = new SidechatSessions('host', { getItem: key => f.data.get(key) ?? null, setItem: (key,value) => f.data.set(key,value) }, () => 1000);
 await restored.restore({ request }); expect(restored.get(side.id)?.thread.turns[0].items[0].text).toBe('恢复正文');
 expect([...f.data.values()].join('')).not.toContain('恢复正文');
 request.mockRejectedValueOnce(new Error('Sidechat 已失效'));
 await expect(restored.restore({ request })).rejects.toThrow('失效'); expect(restored.all()).toHaveLength(0);
});

it('发送结果待确认时禁止重新发送，按原请求UUID恢复确认结果', async () => {
 const { HttpOperationPendingError } = await import('../../src/backends/http-transport');
 const f = fixture();const side = await f.sessions.create({request:f.request},{id:'main'});
 const request = { method:'mobile/sidechat/rpc',params:{method:'turn/start',params:{threadId:side.id}} };
 f.request.mockRejectedValueOnce(new HttpOperationPendingError('request-uncertain',request));
 await expect(f.sessions.submit({request:f.request},side.id,[{type:'text',text:'只发送一次'}],{})).rejects.toThrow();
 await expect(f.sessions.retry(side.id)).rejects.toThrow('待确认');
 f.sessions.observe({method:'mobile/operation/confirmed',params:{requestId:'request-uncertain',request,response:{result:{turn:{id:'confirmed',status:'inProgress',items:[]}}}}});
 expect(side.queue).toHaveLength(0);expect(side.thread.turns.at(-1).id).toBe('confirmed');expect(side.busy).toBe(true);
});

it('摘要误标完成时按fork的权威拒绝排除运行回合，仍精确选择最近结束回合', async () => {
 const { AppServerRpcError } = await import('../../src/app-server/client');
 const f = fixture(); const forks: string[] = [];
 const request = vi.fn(async (method: string, params: any) => {
  if (method === 'thread/turns/list') return { data: [{id:'actually-running',status:'completed'},{id:'real-done',status:'completed'}],nextCursor:null };
  if (method === 'thread/fork') { forks.push(params.lastTurnId); if (params.lastTurnId === 'actually-running') throw new AppServerRpcError("lastTurnId 'actually-running' identifies an in-progress turn", -32600); }
  return f.request(method,params);
 });
 const side = await f.sessions.create({request},{id:'main'});
 expect(forks).toEqual(['actually-running','real-done']);expect(side.forkTurnId).toBe('real-done');
});
