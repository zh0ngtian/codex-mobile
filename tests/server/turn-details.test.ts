import { describe, expect, it } from 'vitest';
import { compactTurnDetails, compactTurnCommentary } from '../../server/turn-details.js';

describe('历史统计可用性', () => {
  it('命令执行缺少 diff 时不能把未知改动写成 0', () => {
    expect(compactTurnDetails({ data: [{ id: 'shell', items: [{ type: 'commandExecution', exitCode: 0 }] }] }).data[0])
      .toEqual({ id: 'shell', changeStatsUnavailable: true, items: [] });
  });
  it('保存的快照统计可补回没有 fileChange 的回合', () => {
    expect(compactTurnDetails({ data: [{ id: 'shell', items: [{ type: 'commandExecution' }] }] }, {
      shell: { additions: 1679, deletions: 69 },
    }).data[0]).toMatchObject({ loadedChangeStats: { additions: 1679, deletions: 69 } });
  });
  it('纯文字回合与完整空 diff 可以确认是 0', () => {
    const result = compactTurnDetails({ data: [
      { id: 'text', items: [{ type: 'agentMessage', text: '解释代码' }] },
      { id: 'empty', liveDiff: '', items: [{ type: 'commandExecution' }] },
    ] });
    expect(result.data.map((turn: any) => turn.loadedChangeStats)).toEqual([
      { additions: 0, deletions: 0 }, { additions: 0, deletions: 0 },
    ]);
  });
  it('不同协议版本的子 Agent 工具也不能误报 0', () => {
    const result = compactTurnDetails({ data: ['collabToolCall', 'collabAgentToolCall'].map((type) => ({
      id: type, items: [{ type }],
    })) });
    expect(result.data.every((turn: any) => turn.changeStatsUnavailable === true)).toBe(true);
  });
  it('没有截断标记但 hunk 行数不完整也不可用', () => {
    const result = compactTurnDetails({ data: [{ id: 'partial',
      liveDiff: 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1,3 @@\n-old\n+new\n', items: [],
    }] });
    expect(result.data[0]).toMatchObject({ changeStatsUnavailable: true });
    expect(result.data[0].loadedChangeStats).toBeUndefined();
  });
  it('截断的 diff 和只有路径的 fileChange 不算完整统计', () => {
    const result = compactTurnDetails({ data: [
      { id: 'truncated', liveDiff: '@@ -1 +1 @@\n-old\n+new\n[truncated]', items: [] },
      { id: 'missing', items: [{ type: 'fileChange', changes: [{ path: 'a.ts' }] }] },
    ] });
    expect(result.data.every((turn: any) => turn.changeStatsUnavailable === true && !turn.loadedChangeStats)).toBe(true);
  });
});


describe('运行回合文本投影', () => {
  const turn = { id: 'live', status: 'inProgress', items: [
    { id: 'u', type: 'userMessage', content: [{ type: 'text', text: '继续' }, { type: 'image', url: 'secret-pixels' }] },
    { id: 'c', type: 'agentMessage', phase: 'commentary', text: '检查文件', toolBody: 'secret' },
    { id: 'cmd', type: 'commandExecution', aggregatedOutput: 'x'.repeat(7_000_000) },
    { id: 'r', type: 'reasoning', text: '不返回' },
  ] };
  it('只保留请求回合的 commentary 与用户文字锚点，剔除工具和图片', () => {
    const result = compactTurnCommentary({ data: [turn, { ...turn, id: 'other' }], nextCursor: 'older' }, 'live');
    expect(result).toEqual({ turnId: 'live', items: [
      { id: 'u', type: 'userMessage', content: [{ type: 'text', text: '继续' }] },
      { id: 'c', type: 'agentMessage', phase: 'commentary', text: '检查文件' },
    ], messageOrder: ['u', 'c'] });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1024);
  });
  it('回合已结束、final 已开始或最近回合已变化时不回填', () => {
    for (const data of [[{ ...turn, status: 'completed' }], [{ ...turn, items: [...turn.items, { id: 'f', type: 'agentMessage', phase: 'final_answer' }] }], [{ ...turn, id: 'next' }]]) {
      expect(compactTurnCommentary({ data }, 'live')).toEqual({ turnId: 'live', items: [] });
    }
  });
});


describe('已完成回合的历史过程恢复', () => {
  it('同一次详情投影补回 commentary 和文字顺序，工具大正文与用户附件不下发', () => {
    const result = compactTurnDetails({ data: [{ id: 'done', status: 'completed', items: [
      { id: 'u', type: 'userMessage', content: [{ type: 'image', url: 'secret-pixels' }, { type: 'text', text: '用户原文' }] },
      { id: 'c1', type: 'agentMessage', phase: 'commentary', text: '检查结构', toolBody: 'secret' },
      { id: 'cmd', type: 'commandExecution', aggregatedOutput: 'x'.repeat(7_000_000) },
      { id: 'f1', type: 'agentMessage', phase: 'final_answer', text: '第一段最终答复'.repeat(1000) },
      { id: 'steer', type: 'userMessage', text: '继续' },
      { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '检查修改' },
      { id: 'r', type: 'reasoning', text: '内部信息' },
      { id: 'f2', type: 'agentMessage', phase: 'final_answer', text: '完成' },
    ] }], nextCursor: 'older' });
    expect(result.data[0]).toMatchObject({ id: 'done', commentaryItems: [
      { id: 'c1', type: 'agentMessage', phase: 'commentary', text: '检查结构' },
      { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '检查修改' },
    ], messageOrder: ['u', 'c1', 'f1', 'steer', 'c2', 'f2'] });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1024);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.nextCursor).toBe('older');
  });
});

it('详情保留真实时间及媒体锚点，只有媒体时仍有顺序且过滤敏感正文', () => {
  const result = compactTurnDetails({ data: [{ id: 'media', items: [
    { id: 'c', type: 'agentMessage', phase: 'commentary', text: '图片如下', timestamp: 123.45 },
    { id: 'image', type: 'imageView', path: '/tmp/image.png' },
    { id: 'generated', type: 'imageGeneration', savedPath: '/tmp/generated.png' },
    { id: 'video', type: 'videoGeneration', result: 'secret video body' },
    { id: 'u', type: 'userMessage', content: [{ type: 'image', url: 'private attachment' }] },
    { id: 'f', type: 'agentMessage', phase: 'final_answer', text: 'private final' },
  ] }, { id: 'only-media', items: [{ id: 'v', type: 'videoGeneration' }] }] });
  expect(result.data[0].commentaryItems[0].timestamp).toBe(123.45);
  expect(result.data[0].messageOrder).toEqual(['c', 'image', 'generated', 'video', 'u', 'f']);
  expect(result.data[1].messageOrder).toEqual(['v']);
  expect(JSON.stringify(result)).not.toMatch(/secret|private/);
  expect(compactTurnCommentary({ data: [{ id: 'live', status: 'inProgress', items: [
    { id: 'c', type: 'agentMessage', phase: 'commentary', text: '图片如下', timestamp: 123.45 },
  ] }] }, 'live').items[0].timestamp).toBe(123.45);
});
it('运行回合含媒体时仅附消息与媒体 ID 顺序，图片正文和工具均不回填', () => {
  const result = compactTurnCommentary({ data: [{ id: 'live', status: 'inProgress', items: [
    { id: 'u', type: 'userMessage', text: '开始', content: [{ type: 'image', url: 'private-user-attachment' }] },
    { id: 'c1', type: 'agentMessage', phase: 'commentary', text: '第一张' },
    { id: 'image1', type: 'imageView', path: '/private/image1.png' },
    { id: 'tool', type: 'mcpToolCall', result: 'private-tool-body' },
    { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '第二张' },
    { id: 'image2', type: 'imageGeneration', result: 'private-image-body' },
    { id: 'video', type: 'videoGeneration', result: 'private-video-body' },
  ] }] }, 'live');
  expect(result.messageOrder).toEqual(['u', 'c1', 'image1', 'c2', 'image2', 'video']);
  expect(result.items.map(item => item.id)).toEqual(['u', 'c1', 'c2']);
  expect(JSON.stringify(result)).not.toContain('private');
});

it('纯文字运行回合保留稀疏过程及重复文字插话的精确 ID 顺序', () => {
  const result = compactTurnCommentary({ data: [{ id: 'live', status: 'inProgress', items: [
    { id: 'c1', type: 'agentMessage', phase: 'commentary' },
    { id: 'u1', type: 'userMessage', text: '继续' },
    { id: 'tool', type: 'commandExecution', aggregatedOutput: 'private-tool-body' },
    { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '检查中' },
    { id: 'u2', type: 'userMessage', text: '继续' },
    { id: 'c3', type: 'agentMessage', phase: 'commentary' },
  ] }] }, 'live');
  expect(result.messageOrder).toEqual(['c1', 'u1', 'c2', 'u2', 'c3']);
  expect(result.items.map(item => item.id)).toEqual(['u1', 'c2', 'u2']);
  expect(JSON.stringify(result)).not.toContain('private-tool-body');
});
