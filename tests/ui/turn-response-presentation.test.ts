import { expect, it } from 'vitest';
import { turnResponsePresentation } from '../../src/ui/turn-response-presentation';

const question = (phase: string | undefined = 'final_answer') => ({ id: 'question', type: 'agentMessage', phase,
  delivery: 'async', questions: [{ title: '重新进入后显示哪种标题？', options: ['模型总结出的标题', '第一条消息原文', '没留意'] }],
  text: '重新进入后显示哪种标题？\n\n- 模型总结出的标题\n- 第一条消息原文\n- 没留意' });

it.each(['final_answer', undefined])('中途结构化提问按过程收纳，保留正文、身份和媒体，phase=%s', phase => {
  const prompt = { ...question(), phase };
  const media = { id: 'shot', type: 'imageView', path: '/question.png' };
  const final = { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '已修复标题刷新。' };
  const items = [prompt, media, { id: 'c', type: 'agentMessage', phase: 'commentary', text: '继续检查' }, final];
  const before = JSON.stringify(items);
  const result = turnResponsePresentation(items, { running: false });
  expect(result.final).toBe(final);
  expect(result.entries[0]).toMatchObject({ history: true, supersededAnswer: true, media: [] });
  expect(result.entries[1].item).toBe(media);
  expect(result.entries[0].item).toBe(prompt);
  expect(result.historyCount).toBe(2);
  expect(JSON.stringify(items)).toBe(before);
});

it.each([true, false])('只有待回答提问时保持正文可见，running=%s', running => {
  const prompt = question();
  const result = turnResponsePresentation([prompt], { running });
  expect(result.entries[0]).toMatchObject({ item: prompt, history: false, supersededAnswer: false });
});

it.each([true, false])('较新的待回答提问不能代替真实final或收起自己，steering=%s', steering => {
  const final = { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '已完成检查。' };
  const prompt = question();
  const result = turnResponsePresentation([...(steering ? [{ id: 'steer', type: 'userMessage', text: '继续检查' }] : []), final, prompt], { running: false });
  expect(result.final).toBe(final);
  expect(result.entries.at(-1)).toMatchObject({ item: prompt, history: false, supersededAnswer: false });
});

it('普通问句没有结构化提问标记时不按文字猜测折叠', () => {
  const items = [{ id: 'first', type: 'agentMessage', phase: 'final_answer', text: '要继续吗？' },
    { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '完成。' }];
  expect(turnResponsePresentation(items, { running: false }).entries.every(entry => !entry.history)).toBe(true);
});

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

it.each([
  [false, true, true], [false, false, false], [true, true, false],
] as const)('纯commentary保留显式历史策略，running=%s collapseWithoutFinal=%s', (running, collapseWithoutFinal, history) => {
  const item = { id: 'commentary', type: 'agentMessage', phase: 'commentary', text: '真实过程' };
  const result = turnResponsePresentation([item], { running, collapseWithoutFinal });
  expect(result.final).toBeNull();
  expect(result.entries).toMatchObject([{ item, history }]);
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
