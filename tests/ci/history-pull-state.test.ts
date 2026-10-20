import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin')('历史仅在用户第二次下拉加载并隔离程序滚动、并发与会话切换', () => {
  const directory = mkdtempSync(join(tmpdir(), 'history-pull-'));
  try {
    const compile = spawnSync('xcrun', ['swiftc', 'mobile/ios/AgentUI/Chat/HistoryPullState.swift', 'tests/ci/history-pull-state-smoke.swift', '-o', join(directory, 'smoke')], { encoding: 'utf8', timeout: 60000 });
    expect(compile.status, compile.stderr).toBe(0);
    const result = spawnSync(join(directory, 'smoke'), [], { encoding: 'utf8', timeout: 15000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('History pull state smoke passed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
