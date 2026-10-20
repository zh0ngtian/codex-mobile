import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IdleUpdatePolicy, readIdleState } from '../../scripts/windows/service/idle-state.mjs';

function fixture({ states = { parent: { type: 'idle' }, child: { type: 'idle' } }, terminals = {}, fail, repeatCursor = false } = {}) {
  return async (method, params = {}) => {
    if (method === fail) throw new Error('offline');
    if (method === 'thread/loaded/list') return params.cursor
      ? { data: ['child'], nextCursor: repeatCursor ? 'second' : null }
      : { data: ['parent'], nextCursor: 'second' };
    if (method === 'thread/read') return { thread: { id: params.threadId, status: states[params.threadId] } };
    if (method === 'thread/backgroundTerminals/list') return { data: terminals[params.threadId] ?? [], nextCursor: null };
    throw new Error(`unexpected method ${method}`);
  };
}

test('完整检查分页中的子会话，等待审批和用户输入都阻止更新', async () => {
  for (const activeFlags of [[], ['waitingOnApproval'], ['waitingOnUserInput']]) {
    assert.equal((await readIdleState(fixture({ states: { parent: { type: 'idle' }, child: { type: 'active', activeFlags } } }))).idle, false);
  }
  assert.equal((await readIdleState(fixture())).idle, true);
});

test('后台终端、未知状态和查询失败不会被判断为空闲', async () => {
  assert.equal((await readIdleState(fixture({ terminals: { child: [{ processId: '42' }] } }))).idle, false);
  assert.equal((await readIdleState(fixture({ states: { parent: { type: 'futureState' }, child: { type: 'idle' } } }))).idle, false);
  assert.equal((await readIdleState(fixture({ fail: 'thread/read' }))).idle, false);
  assert.equal((await readIdleState(fixture({ fail: 'thread/backgroundTerminals/list' }))).idle, false);
  assert.equal((await readIdleState(fixture({ repeatCursor: true }))).idle, false);
});

test('版本不一致必须连续空闲，期间变忙或目标变化都会重新计时', () => {
  const p = new IdleUpdatePolicy({ idleMs: 30_000 });
  const observe = (now, idle = true, target = 'new') => p.observe({ current: 'old', target, idle, now });
  assert.equal(observe(0), false);
  assert.equal(observe(29_999), false);
  assert.equal(observe(30_000, false), false);
  assert.equal(observe(30_001), false);
  assert.equal(observe(60_000), false);
  assert.equal(observe(60_001), true);
  assert.equal(observe(60_002, true, 'newer'), false);
  assert.equal(observe(90_002, true, 'newer'), true);
});

test('已对齐不重启，失败的目标版本需要退避后重新等待空闲', () => {
  const p = new IdleUpdatePolicy({ idleMs: 30, cooldownMs: 100 });
  assert.equal(p.observe({ current: 'a', target: 'a', idle: true, now: 0 }), false);
  assert.equal(p.observe({ current: 'a', target: 'b', idle: true, now: 0 }), false);
  assert.equal(p.observe({ current: 'a', target: 'b', idle: true, now: 30 }), true);
  p.failed('b', 30);
  assert.equal(p.observe({ current: 'a', target: 'b', idle: true, now: 129 }), false);
  assert.equal(p.observe({ current: 'a', target: 'b', idle: true, now: 130 }), false);
  assert.equal(p.observe({ current: 'a', target: 'b', idle: true, now: 160 }), true);
});

test('读取过程中出现新的会话时取消空闲结论', async () => {
  let enumerations = 0;
  const rpc = async (method, params = {}) => {
    if (method === 'thread/loaded/list') return { data: ++enumerations === 1 ? ['a'] : ['a', 'b'], nextCursor: null };
    if (method === 'thread/read') return { thread: { id: params.threadId, status: { type: 'idle' } } };
    return { data: [], nextCursor: null };
  };
  assert.equal((await readIdleState(rpc)).idle, false);
});
