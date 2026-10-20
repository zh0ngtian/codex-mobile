import { describe, expect, it } from 'vitest';
import { applyTurnCommentary } from '../../src/app-server/thread-session';
import { appendConversationTitleRequest } from '../../src/app-server/conversation-title';
import { applyCompletedTurn, applyTurnItem, applyTurnStarted, createPendingTurn, reconcileRecentTurns } from '../../src/ui/conversation';
import { projectConversation } from '../../src/native-ui/projection';
import { compactTurnCommentary } from '../../server/turn-details';
import { decodeUserMessage, encodeUserMessage } from '../../server/user-message-format';

const user = (id: string, text = '发布吧', extra: Record<string, any> = {}) => ({ id, type: 'userMessage', content: [{ type: 'text', text }], ...extra });
const turn = (items: any[], extra: Record<string, any> = {}) => ({ id: 'turn', status: 'inProgress', items, ...extra });
const bubbles = (turns: any[]) => projectConversation({ id: 'thread', turns }, path => path).filter(item => item.role === 'user');
const snapshot = (current: any[], incoming: any[]) => reconcileRecentTurns([turn(current)], [turn(incoming, { itemsView: 'summary' })]);

describe('用户输入跨来源身份对账', () => {
  it('正式摘要后的占位回填只显示一条，并保留正式身份和历史顺序', () => {
    const reply = { id: 'c', type: 'agentMessage', phase: 'commentary', text: '正在执行' };
    const detail = { turnId: 'turn', items: [user('item-1'), reply], messageOrder: ['item-1', 'c'] };
    const result = applyTurnCommentary([turn([user('official')])], detail);
    expect(result[0].items.map((item: any) => item.id)).toEqual(['official', 'c']);
    expect(bubbles(result)).toHaveLength(1);
    expect(applyTurnCommentary(result, detail)).toEqual(result);
  });

  it('先收到占位回填，随后正式摘要升级身份，旧回填再次到达也不会复活副本', () => {
    const detail = { turnId: 'turn', items: [user('item-1')], messageOrder: ['item-1'] };
    const initial = applyTurnCommentary([turn([])], detail);
    const result = reconcileRecentTurns(initial, [turn([user('official')], { itemsView: 'summary' })]);
    expect(bubbles(result).map(item => item.itemId)).toEqual(['official']);
    expect(bubbles(applyTurnCommentary(result, detail))).toHaveLength(1);
  });

  it('两个真实同文输入与完整占位快照按次序一对一确认', () => {
    const current = [user('official-one'), user('official-two')];
    const detail = { turnId: 'turn', items: [user('item-1'), user('item-8')], messageOrder: ['item-1', 'item-8'] };
    const result = applyTurnCommentary([turn(current)], detail);
    expect(bubbles(result).map(item => item.itemId)).toEqual(['official-one', 'official-two']);
    expect(bubbles(applyTurnCommentary(result, detail))).toHaveLength(2);
  });

  it('不同正式身份即使同文也不合并，不同 clientId 也不认领占位副本', () => {
    expect(bubbles(snapshot([user('official-one')], [user('official-two')]))).toHaveLength(2);
    const result = applyTurnCommentary([turn([user('official', '继续', { clientId: 'request-a' })])], {
      turnId: 'turn', items: [user('item-1', '继续', { clientId: 'request-b' })],
    });
    expect(bubbles(result)).toHaveLength(2);
  });

  it('占位别名不能吞掉后来真实发送的相同文字', () => {
    const detail = { turnId: 'turn', items: [user('item-1')], messageOrder: ['item-1'] };
    const initial = applyTurnCommentary([turn([user('official-one')])], detail);
    const updated = applyTurnItem({ id: 'thread', turns: initial }, { threadId: 'thread', turnId: 'turn', item: user('official-two') });
    expect(bubbles(updated.turns).map(item => item.itemId)).toEqual(['official-one', 'official-two']);
    expect(bubbles(applyTurnCommentary(updated.turns, detail))).toHaveLength(2);
  });

  it('有请求身份时，先到的占位回填和后到的单条正式事件精确关联', () => {
    const initial = [turn([user('item-1', '发布吧', { clientId: 'send-request' })])];
    const result = applyTurnItem({ id: 'thread', turns: initial }, { threadId: 'thread', turnId: 'turn', item: user('official', '发布吧', { clientId: 'send-request' }) });
    expect(bubbles(result.turns).map(item => item.itemId)).toEqual(['official']);
    const repeated = applyTurnItem(result, { threadId: 'thread', turnId: 'turn', item: user('other', '发布吧', { clientId: 'other-request' }) });
    expect(bubbles(repeated.turns)).toHaveLength(2);
  });

  it('占位编号被另一份不同输入复用时不能沿用旧别名', () => {
    const initial = applyTurnCommentary([turn([user('official-one')])], { turnId: 'turn', items: [user('item-1')] });
    const result = applyTurnCommentary(initial, { turnId: 'turn', items: [user('item-1', '另一个问题')] });
    expect(bubbles(result).map(item => item.text)).toEqual(['发布吧', '另一个问题']);
  });

  it('完成快照直接确认占位插话，不等待下一轮摘要才清理', () => {
    const initial = applyTurnCommentary([turn([user('official-one')])], {
      turnId: 'turn', items: [user('item-1'), user('item-8', '继续检查')],
    });
    const result = applyCompletedTurn({ id: 'thread', turns: initial }, { threadId: 'thread', turn: turn([
      user('official-one'), user('official-two', '继续检查'),
    ], { status: 'completed' }) });
    expect(bubbles(result.turns).map(item => item.itemId)).toEqual(['official-one', 'official-two']);
  });

  it('正式空回合先到后，用户实时确认同时消耗原 pending 回合', () => {
    const pending = createPendingTurn('pending-one', user('local-one'), 1);
    const initial = reconcileRecentTurns([pending], [turn([], { itemsView: 'summary' })]);
    const result = applyTurnItem({ id: 'thread', turns: initial }, { threadId: 'thread', turnId: 'turn', item: user('official') });
    expect(result.turns.map((entry: any) => entry.id)).toEqual(['turn']);
    expect(bubbles(result.turns)).toHaveLength(1);
  });

  it('同样的空回合竞态经摘要恢复也只留下正式回合', () => {
    const pending = createPendingTurn('pending-one', user('local-one'), 1);
    const initial = reconcileRecentTurns([pending], [turn([], { itemsView: 'summary' })]);
    const result = reconcileRecentTurns(initial, [turn([user('official')], { itemsView: 'summary' })], { discardPendingThrough: -1 });
    expect(result.map(entry => entry.id)).toEqual(['turn']);
    expect(bubbles(result)).toHaveLength(1);
  });

  it('空正式回合先到且仅收到完成快照时也消耗原 pending', () => {
    const pending = createPendingTurn('pending-one', user('local-one'), 1);
    const initial = reconcileRecentTurns([pending], [turn([], { itemsView: 'summary' })]);
    const result = applyCompletedTurn({ id: 'thread', turns: initial }, { threadId: 'thread', turn: turn([user('official')], { status: 'completed' }) });
    expect(result.turns.map((entry: any) => entry.id)).toEqual(['turn']);
    expect(bubbles(result.turns)).toHaveLength(1);
  });

  it('认领空正式回合时仍保留图片上传前后路径转换的确认上下文', () => {
    const local = user('local-one', '图片', { content: [{ type: 'text', text: '图片' }, { type: 'image', url: 'data:image/png;base64,photo' }] });
    const official = user('official', '图片', { content: [{ type: 'text', text: '图片' }, { type: 'localImage', path: '/tmp/photo.png' }] });
    const pending = createPendingTurn('pending-one', local, 1);
    const initial = reconcileRecentTurns([pending], [turn([], { itemsView: 'summary' })]);
    const result = reconcileRecentTurns(initial, [turn([official], { itemsView: 'summary' })], { discardPendingThrough: -1 });
    expect(bubbles(result)).toHaveLength(1);
    expect(bubbles(result)[0].itemId).toBe('official');
  });

  it('多条同文 pending 与部分摘要存在歧义时不猜测对应关系', () => {
    const current = [createPendingTurn('pending-one', user('local-one'), 1), createPendingTurn('pending-two', user('local-two'), 2)];
    const result = reconcileRecentTurns(current, [turn([user('official')], { itemsView: 'summary' })], { discardPendingThrough: -1 });
    expect(result.filter(entry => entry.id.startsWith('pending-'))).toHaveLength(2);
  });

  it('空发送回执绑定原 pending，不认领另一条未确认发送', () => {
    const state = { id: 'thread', turns: [turn([user('official')]),
      createPendingTurn('pending-one', user('local-one'), 1),
      createPendingTurn('pending-two', user('local-two', '另一个问题'), 2),
    ] };
    const result = applyTurnStarted(state, { threadId: 'thread', turn: turn([]) }, { pendingTurnId: 'pending-one' });
    expect(result.turns.map((entry: any) => entry.id)).toEqual(['turn', 'pending-two']);
    expect(bubbles(result.turns).map(item => item.text)).toEqual(['发布吧', '另一个问题']);
  });

  it('迟到开始回执认领原 pending 时不能把已完成回合改回运行', () => {
    const known = turn([user('official')], { status: 'completed', completedAt: 999 });
    const pending = createPendingTurn('pending-one', user('local-one'), 1);
    const result = applyTurnStarted({ id: 'thread', turns: [known, pending] }, { threadId: 'thread', turn: turn([]) }, { pendingTurnId: 'pending-one' });
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({ status: 'completed', completedAt: 999 });
    expect(bubbles(result.turns)).toHaveLength(1);
  });

  it('标题包装和用户正文按同一规范匹配 pending 回合', () => {
    const pending = createPendingTurn('pending-one', user('local-one'), 1);
    const result = reconcileRecentTurns([pending], [turn([user('official', appendConversationTitleRequest('发布吧'))], { itemsView: 'summary' })], { discardPendingThrough: -1 });
    expect(result.map(entry => entry.id)).toEqual(['turn']);
    expect(bubbles(result)).toHaveLength(1);
  });

  it('同文不同文件不能把新 pending 认作较早发送', () => {
    const local = user('local-new', encodeUserMessage('检查', [{ name: 'new.pdf', path: '/tmp/new.pdf' }]));
    const old = user('official-old', encodeUserMessage('检查', [{ name: 'old.pdf', path: '/tmp/old.pdf' }]));
    const result = reconcileRecentTurns([createPendingTurn('pending-new', local, 1)], [turn([old], { itemsView: 'summary' })], { discardPendingThrough: -1 });
    expect(result).toHaveLength(2);
    expect(bubbles(result)).toHaveLength(2);
  });

  it('已存在的旧回合与新 pending 同文时继续显示两次真实发送', () => {
    const old = turn([user('official-old')], { status: 'completed' });
    const pending = createPendingTurn('pending-new', user('local-new'), 2);
    const result = reconcileRecentTurns([old, pending], [{ ...old, itemsView: 'summary' }], { discardPendingThrough: -1 });
    expect(bubbles(result)).toHaveLength(2);
  });

  it('纯图片经真实压缩回填后确认同一次输入，图片不丢失', () => {
    const content = [{ type: 'localImage', path: '/tmp/photo.jpg' }];
    const initial = applyTurnStarted({ id: 'thread', turns: [createPendingTurn('pending-one', user('local-one', '', { content }))] }, { threadId: 'thread', turn: turn([]) });
    const detail = compactTurnCommentary({ data: [turn([user('official', '', { content })])] }, 'turn');
    const result = applyTurnCommentary(initial.turns, detail);
    expect(bubbles(result)).toHaveLength(1);
    expect(bubbles(result)[0]).toMatchObject({ itemId: 'official', blocks: [{ kind: 'image' }] });
  });

  it('旧回填完全没有图片和正文时不额外绘制空用户锚点', () => {
    const content = [{ type: 'localImage', path: '/tmp/photo.jpg' }];
    const result = applyTurnCommentary([turn([user('local-one', '', { content })])], { turnId: 'turn', items: [user('official', '', { content: [] })] });
    expect(bubbles(result)).toHaveLength(1);
    expect(bubbles(result)[0].blocks?.[0].kind).toBe('image');
  });

  it('同一正式身份的精简回填不能清掉已确认的引用与附件声明', () => {
    const references = [{ text: '之前的原文', source: { messageId: 'source', startOffset: 0, endOffset: 6 } }];
    const files = [{ name: '说明.pdf', path: '/tmp/request.pdf' }];
    const initial = user('official', encodeUserMessage('检查', files, references));
    const result = applyTurnCommentary([turn([initial])], { turnId: 'turn', items: [user('official', '检查')] });
    expect(bubbles(result)).toHaveLength(1);
    expect(bubbles(result)[0].references).toEqual(references);
    expect(decodeUserMessage(result[0].items[0].content[0].text).attachments).toEqual(files);
  });
});
