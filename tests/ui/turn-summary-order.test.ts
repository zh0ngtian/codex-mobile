import { describe, expect, it } from 'vitest';
import { applyCompletedTurn, reconcileRecentTurns } from '../../src/ui/conversation';
import { applyTurnChangeStats } from '../../src/app-server/thread-session';
import { projectConversation } from '../../src/native-ui/projection';

const user = { id: 'u', type: 'userMessage', text: '检查项目' };
const commentary = { id: 'c', type: 'agentMessage', phase: 'commentary', text: '检查过程' };
const final = { id: 'f', type: 'agentMessage', phase: 'final_answer', text: '最终回答' };
const turn = (items: Record<string, any>[], extra = {}) => ({ id: 'turn', status: 'completed', items, ...extra });
const summary = (items = [user, final]) => turn(items, { itemsView: 'summary' });
const itemIDs = (value: Record<string, any>) => value.items.map((item: Record<string, any>) => item.id);

describe('完成后的摘要同步顺序', () => {
  it('完成通知、摘要同步及详情回填全过程都把过程入口放在回答前', () => {
    const live = { id: 'thread', turns: [turn([user, commentary, final], { status: 'inProgress' })] };
    const completed = applyCompletedTurn(live, { threadId: 'thread', turn: turn([]) });
    const reconciled = reconcileRecentTurns(completed.turns, [summary()]);
    const recovered = applyTurnChangeStats(reconciled, { turn: {
      images: [], commentaryItems: [commentary], messageOrder: ['u', 'c', 'f'],
    } });
    for (const turns of [completed.turns, reconciled, recovered]) {
      expect(itemIDs(turns[0])).toEqual(['u', 'c', 'f']);
      expect(projectConversation({ turns }, path => path).map(message => message.id))
        .toEqual(['turn:u', 'turn:c:history', 'turn:f']);
    }
  });

  it('摘要首次带回漏收的最终回答时，已有过程仍在回答前', () => {
    const current = turn([user, commentary], { status: 'inProgress' });
    const [result] = reconcileRecentTurns([current], [summary()]);
    expect(itemIDs(result)).toEqual(['u', 'c', 'f']);
    expect(result.status).toBe('completed');
  });

  it('多次摘要同步保留引导、旧回答、工具及过程媒体的原始顺序', () => {
    const oldFinal = { ...final, id: 'old-final' };
    const steer = { ...user, id: 'steer', text: '继续检查' };
    const tool = { id: 'tool', type: 'commandExecution', command: 'pwd' };
    const image = { id: 'image', type: 'imageView', path: '/screen.png' };
    const second = { ...commentary, id: 'c2', text: '继续检查过程' };
    const current = turn([user, commentary, image, oldFinal, steer, tool, second, final]);
    const incoming = summary([user, oldFinal, steer, final]);
    const once = reconcileRecentTurns([current], [incoming]);
    expect(itemIDs(once[0])).toEqual(itemIDs(current));
    expect(reconcileRecentTurns(once, [incoming])).toEqual(once);
    expect(projectConversation({ turns: once }, path => path).find(message => message.id === 'turn:c:history')?.commentary?.[0].blocks)
      .toMatchObject([{ kind: 'image', value: '/screen.png' }]);
  });

  it('摘要补入的新消息按已有公共消息锚点插入，更新正文但不截短流式内容', () => {
    const steer = { ...user, id: 'steer', text: '继续检查' };
    const current = turn([user, commentary, { ...final, text: '最终回答已经完整输出' }]);
    const [result] = reconcileRecentTurns([current], [summary([user, steer, final])]);
    expect(itemIDs(result)).toEqual(['u', 'c', 'steer', 'f']);
    expect(result.items.at(-1)?.text).toBe('最终回答已经完整输出');
  });

  it('完整历史仍可纠正本地顺序，不把摘要保序规则套到权威完整窗口', () => {
    const [result] = reconcileRecentTurns([turn([final, user, commentary])], [turn([user, commentary, final])]);
    expect(itemIDs(result)).toEqual(['u', 'c', 'f']);
  });

  it('摘要确认本地用户身份时去重，保留用户与过程在回答之前的位置', () => {
    const current = turn([{ ...user, id: 'local-u' }, commentary, final]);
    const [result] = reconcileRecentTurns([current], [summary()]);
    expect(itemIDs(result)).toEqual(['u', 'c', 'f']);
    expect(result.items.filter((item: Record<string, any>) => item.type === 'userMessage')).toHaveLength(1);
  });

  it('摘要中相同文字的不同正式用户消息仍独立保留，不因保序误合并', () => {
    const steer = { ...user, id: 'steer' };
    const [result] = reconcileRecentTurns([turn([user, commentary, final])], [summary([user, steer, final])]);
    expect(itemIDs(result)).toEqual(['u', 'c', 'steer', 'f']);
  });
});
