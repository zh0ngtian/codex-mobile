import { expect, it } from 'vitest';
import { turnResponsePresentation } from '../../src/ui/turn-response-presentation';

it('展示整理保留原 item 引用，截图归属在移动引导前确定', () => {
  const first = { id: 'c1', type: 'agentMessage', phase: 'commentary', text: '检查' };
  const attached = { id: 'attached', type: 'imageView', path: '/attached.png' };
  const old = { id: 'old', type: 'agentMessage', phase: 'final_answer', text: '旧回答' };
  const steering = { id: 'steer', type: 'userMessage', text: '继续', content: [{ type: 'localImage', path: '/user.png' }] };
  const independent = { id: 'independent', type: 'imageView', path: '/independent.png' };
  const final = { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '最终回答' };
  const items = [first, attached, old, steering, independent, final];
  const before = JSON.stringify(items);
  const result = turnResponsePresentation(items, { running: false });
  expect(result.entries.map(entry => entry.item)).toEqual([steering, first, old, independent, final]);
  expect(result.entries[0].item).toBe(steering);
  expect(result.entries[1]).toMatchObject({ media: [attached], history: true });
  expect(result.entries[1].item).toBe(first);
  expect(result.entries[1].media[0]).toBe(attached);
  expect(result.entries[2]).toMatchObject({ history: true, supersededAnswer: true });
  expect(result.entries[2].item).toBe(old);
  expect(result.entries[3]).toMatchObject({ item: independent, history: false });
  expect(result.final).toBe(final);
  expect(result.historyCount).toBe(2);
  expect(JSON.stringify(items)).toBe(before);
});

it.each([true, false])('最后引导后没有回答时不复用旧 final，running=%s', running => {
  const result = turnResponsePresentation([
    { id: 'old', type: 'agentMessage', phase: 'final_answer', text: '旧回答' },
    { id: 'steer', type: 'userMessage', text: '继续' },
    { id: 'live', type: 'agentMessage', phase: 'commentary', text: '继续检查' },
  ], { running });
  expect(result.final).toBeNull();
  expect(result.entries.map(entry => [entry.item.id, entry.history])).toEqual([['steer', false], ['old', true], ['live', false]]);
});

it('已完成的旧协议消息只将最后引导后的最后一条作为回答', () => {
  const old = { id: 'old', type: 'agentMessage', text: '旧协议旧回答' };
  const final = { id: 'final', type: 'agentMessage', text: '旧协议最终回答' };
  const result = turnResponsePresentation([old, { id: 'steer', type: 'userMessage', text: '继续' }, final], { running: false });
  expect(result.final).toBe(final);
  expect(result.entries.find(entry => entry.item === old)?.supersededAnswer).toBe(true);
  expect(result.entries.find(entry => entry.item === final)?.history).toBe(false);
});

it('没有引导的延续回答沿用原顺序与可见性', () => {
  const items = [{ id: 'first', type: 'agentMessage', phase: 'final_answer', text: '第一段' },
    { id: 'last', type: 'agentMessage', phase: 'final_answer', text: '补充段' }];
  const result = turnResponsePresentation(items, { running: false });
  expect(result.entries.map(entry => entry.item)).toEqual(items);
  expect(result.entries.every(entry => !entry.history && !entry.supersededAnswer)).toBe(true);
});

it('运行中的旧协议新回复保持实时可见，不因为缺少phase就收入旧过程', () => {
  const current = { id: 'current', type: 'agentMessage', text: '正在生成的新正文' };
  const result = turnResponsePresentation([
    { id: 'old', type: 'agentMessage', phase: 'final_answer', text: '旧回答' },
    { id: 'steer', type: 'userMessage', text: '继续' }, current,
  ], { running: true });
  expect(result.final).toBeNull();
  expect(result.entries.find(entry => entry.item === current)).toMatchObject({ history: false, supersededAnswer: false });
});
