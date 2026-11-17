// @vitest-environment node
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadObserver } from '../../server/thread-observer.js';
import { PrivateStore } from '../../server/remote/private-store.js';
import type { OperationContext } from '../../server/operation-queue.js';

const roots: string[] = []; afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const localContext: OperationContext = { mode: 'local', gatewayId: 'g', businessKey: 'b', authorizationKey: 'a', localHostId: 'h' };
const context: OperationContext = { mode: 'remote', gatewayId: 'g', businessKey: 'b', authorizationKey: 'remote-a',
  managed: { accountId: 'account', accountUserId: 'user', codexHome: '/target/.codex' },
  target: { environmentId: 'environment', installationId: 'installation' }, generation: 'generation' };
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

it('本地打开、事件及在线触碰不登记持续观察，不读取上游或写观察状态', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'observer-local-'))); roots.push(directory);
  let now = 0;
  const authorizeOperation = vi.fn(async () => () => {});
  const scheduler = { hostedRpc: vi.fn(), hasPending: vi.fn(), submit: vi.fn(), runOnce: vi.fn(), operation: vi.fn() };
  const observer = new ThreadObserver({ directory, now: () => now, resolver: { authorizeOperation }, scheduler });
  try {
    await observer.poll();
    const before = await readdir(directory);
    await observer.opened(localContext, 'local-thread', 'phone');
    observer.event(localContext, { method: 'turn/started', params: { threadId: 'local-thread' } });
    observer.touch(localContext, 'phone');
    await observer.poll(); now += 86400001; await observer.poll();
    expect(authorizeOperation).not.toHaveBeenCalled();
    for (const method of Object.values(scheduler)) expect(method).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual(before);
    expect(before).not.toContain('index.json');
  } finally { await observer.close(); }
});

it('重启跳过旧本地观察及待确认释放，保留原文件，同时继续观察Remote', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'observer-legacy-local-'))); roots.push(directory);
  const id = createHash('sha256').update(JSON.stringify([localContext, 'legacy-local'], Object.keys(localContext).sort())).digest('hex');
  const store = new PrivateStore(directory);
  await store.writeJson(id + '.json', { version: 1, id, context: localContext, threadId: 'legacy-local',
    lastBusinessUpdate: 0, released: false, releaseOperationId: '12345678-1234-4234-8234-123456789012' });
  await store.writeJson('index.json', [id]);
  const originalRecord = await readFile(join(directory, id + '.json'), 'utf8');
  const originalIndex = await readFile(join(directory, 'index.json'), 'utf8');
  const authorizeOperation = vi.fn(async (_context: OperationContext) => () => {});
  const scheduler = {
    hostedRpc: vi.fn(async () => ({ result: { data: [], thread: { id: 'remote-thread', status: 'idle' } } })),
    hasPending: vi.fn(async () => false), submit: vi.fn(), runOnce: vi.fn(), operation: vi.fn(),
  };
  const observer = new ThreadObserver({ directory, now: () => 86400001, resolver: { authorizeOperation }, scheduler });
  try {
    await observer.poll();
    expect(authorizeOperation).not.toHaveBeenCalled();
    for (const method of Object.values(scheduler)) expect(method).not.toHaveBeenCalled();
    expect(await readFile(join(directory, 'index.json'), 'utf8')).toBe(originalIndex);
    await observer.opened(context, 'remote-thread'); await observer.poll();
    expect(scheduler.hostedRpc).toHaveBeenCalledExactlyOnceWith(context,
      expect.objectContaining({ method: 'mobile/thread/observe', params: { threadId: 'remote-thread' } }), expect.anything());
    expect(scheduler.hasPending).toHaveBeenCalledExactlyOnceWith(context, 'remote-thread', expect.anything());
    expect(authorizeOperation.mock.calls.every(([value]) => value.mode === 'remote')).toBe(true);
    expect(scheduler.submit).not.toHaveBeenCalled(); expect(scheduler.operation).not.toHaveBeenCalled();
    expect(await readFile(join(directory, id + '.json'), 'utf8')).toBe(originalRecord);
  } finally { await observer.close(); }
});
