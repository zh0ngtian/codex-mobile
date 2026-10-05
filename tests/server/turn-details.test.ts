import { describe, expect, it } from 'vitest';
import { compactTurnDetails } from '../../server/turn-details.js';

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
