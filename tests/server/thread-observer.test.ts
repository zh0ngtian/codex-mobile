// @vitest-environment node
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ThreadObserver } from '../../server/thread-observer.js';
import type { OperationContext } from '../../server/operation-queue.js';

const roots: string[] = []; afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const context: OperationContext = { mode: 'local', gatewayId: 'g', businessKey: 'b', authorizationKey: 'a', localHostId: 'h' };
it('真实内容的时钟跨重启保持，离线不清理，24h 后只撤销逻辑订阅', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'observer-'))); roots.push(directory);
  let now = 1000; let offline = false; let text = 'first'; const sent: any[] = [];
  const scheduler = {
    async hostedRpc(_context: unknown, message: any) {
      if (offline) throw new Error('offline');
      return { result: { data: [{ id: 'turn', status: 'completed', items: [{ text }] }], thread: { id: 'thread', updatedAt: now, status: { type: 'idle' } } } };
    }, async hasPending() { return false; }, async submit(value: any) { sent.push(value); return {} as any; }, async runOnce() {}, async operation() { return { status: 'completed', message: { result: {} } } as any; },
  };
  const options = { directory, resolver: { async authorizeOperation() { return () => {}; } }, scheduler, now: () => now };
  let observer = new ThreadObserver(options);
  await observer.opened(context, 'thread'); await observer.poll(); await observer.close();
  now += 86399000; observer = new ThreadObserver(options); await observer.poll(); expect(sent).toHaveLength(0);
  await observer.close(); now += 61000; offline = true; observer = new ThreadObserver(options);
  await observer.poll(); expect(sent).toHaveLength(0);
  offline = false; now += 3000; text = 'new business content'; await observer.poll(); expect(sent).toHaveLength(0);
  now += 86400000; await observer.poll(); expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ context, message: { method: 'thread/unsubscribe', params: { threadId: 'thread' } } });
  await observer.close(); observer = new ThreadObserver(options); await observer.poll(); expect(sent).toHaveLength(1); await observer.close();
});
it('活跃手机、队列、运行及关注责任阻止 24h 清理', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'observer-'))); roots.push(directory);
  let now = 0; let pending = true; let followed = false; const sent: any[] = [];
  const observer = new ThreadObserver({ directory, now: () => now, resolver: { async authorizeOperation() { return () => {}; } },
    followed: () => followed, scheduler: {
      async hostedRpc() { return { result: { data: [], thread: { id: 'thread', status: 'idle' } } }; },
      async hasPending() { return pending; }, async submit(value) { sent.push(value); return {} as any; }, async runOnce() {}, async operation() { return { status: 'completed', message: { result: {} } } as any; },
    } });
  await observer.opened(context, 'thread', 'phone'); await observer.poll();
  now = 86400001; await observer.poll(); expect(sent).toHaveLength(0);
  pending = false; followed = true; now += 3000; await observer.poll(); expect(sent).toHaveLength(0);
  followed = false; observer.touch(context, 'phone'); now += 3000; await observer.opened(context, 'thread', 'phone'); await observer.poll(); expect(sent).toHaveLength(0);
  now += 61000; await observer.poll(); expect(sent).toHaveLength(1); await observer.close();
});

it('取消订阅的未知结果跨重启只对账原 UUID，不提前清理或重新恢复订阅', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'observer-release-'))); roots.push(directory);
  let now = 0; let complete = false; let snapshots = 0; const ids: string[] = [];
  const options = { directory, now: () => now, resolver: { async authorizeOperation() { return () => {}; } }, scheduler: {
    async hostedRpc() { snapshots++; return { result: { data: [], thread: { id: 'thread', status: 'idle' } } }; },
    async hasPending() { return false; }, async submit(value: any) { ids.push(value.id); return {} as any; }, async runOnce() {},
    async operation() { return complete ? { status: 'completed', message: { result: {} } } as any : { status: 'uncertain' } as any; },
  } };
  let observer = new ThreadObserver(options); await observer.opened(context, 'thread'); await observer.poll();
  now = 86400001; await observer.poll(); expect(ids).toHaveLength(1); expect(snapshots).toBe(2); await observer.close();
  observer = new ThreadObserver(options); now += 3000; await observer.poll(); expect(ids).toHaveLength(2); expect(snapshots).toBe(2);
  complete = true; now += 3000; await observer.poll(); expect(new Set(ids).size).toBe(1); expect(snapshots).toBe(2); await observer.close();
  observer = new ThreadObserver(options); now += 86400000; await observer.poll(); expect(snapshots).toBe(2); expect(ids).toHaveLength(3); await observer.close();
});

it('只有成功的业务变化刷新已缓存读取，心跳和失败不伪造更新', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'observer-snapshot-'))); roots.push(directory);
  let now = 0; let text = 'one'; const updates: string[] = [];
  const observer = new ThreadObserver({ directory, now: () => now, resolver: { async authorizeOperation() { return () => {}; } },
    async onChanged(scope, id) { expect(scope).toEqual(context); updates.push(id); }, scheduler: {
      async hostedRpc() { return { result: { thread: { id: 'thread', updatedAt: now }, data: [{ id: 'turn', items: [{ text }] }] } }; },
      async hasPending() { return false; }, async submit() { return {} as any; }, async runOnce() {}, async operation() { return {} as any; },
    } });
  try {
    await observer.opened(context, 'thread', 'phone'); await observer.poll(); expect(updates).toEqual(['thread']);
    now += 3001; await observer.poll(); expect(updates).toEqual(['thread']);
    text = 'two'; now += 3001; await observer.poll(); expect(updates).toEqual(['thread', 'thread']);
  } finally { await observer.close(); }
});
