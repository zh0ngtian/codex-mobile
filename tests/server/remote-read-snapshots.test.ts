// @vitest-environment node
import { expect, it } from 'vitest';
import { RemoteReadSnapshots } from '../../server/remote-read-snapshots.js';
import type { OperationContext } from '../../server/operation-queue.js';
const context: OperationContext = { mode: 'remote', gatewayId: 'g', businessKey: 'b', authorizationKey: 'a', generation: 'one', managed: { accountId: 'a', accountUserId: 'u', codexHome: '/target' }, target: { environmentId: 'e', installationId: 'i' } };
const message = { id: 1, method: 'thread/read', params: { threadId: 't', includeTurns: false } };
it('两个手机共享读取快照，完整账户/目标/代次隔离，正文与输入输出均为副本', () => {
  const snapshots = new RemoteReadSnapshots(); const response = { id: 1, result: { thread: { id: 't', name: 'first' } } };
  snapshots.put(context, message, response); response.result.thread.name = 'changed';
  const value = snapshots.get(context, { ...message, id: 999 })!;
  expect(value.message).toMatchObject({ id: 999, result: { thread: { name: 'first' } } });
  (value.message.result as any).thread.name = 'phone mutation';
  expect((snapshots.get(context, message)!.message.result as any).thread.name).toBe('first');
  for (const other of [{ ...context, generation: 'two' }, { ...context, authorizationKey: 'other' }, { ...context, target: { ...context.target, installationId: 'other' } }, { ...context, managed: { ...context.managed, accountId: 'other' } }]) expect(snapshots.get(other, message)).toBeUndefined();
});
it('只缓存成功导航读取，拒绝写入、审批、带配置的resume和错误；过期和超限安全逐出', () => {
  let now = 1; const snapshots = new RemoteReadSnapshots({ now: () => now, maxEntries: 2, maxBytes: 1000, ttlMs: 100 });
  for (const request of [{ method: 'turn/start' }, { id: 4, result: {} }, { method: 'thread/resume', params: { threadId: 't', model: 'other' } }, { method: 'fs/readFile', params: { path: '/private' } }]) {
    snapshots.put(context, request, { result: { secret: true } }); expect(snapshots.get(context, request)).toBeUndefined();
  }
  snapshots.put(context, message, { error: { code: 1, message: 'failure' } }); expect(snapshots.get(context, message)).toBeUndefined();
  snapshots.put(context, message, { result: { thread: { id: 't' } } }); now = 101; expect(snapshots.get(context, message)).toBeUndefined();
  now = 102;
  for (let i = 0; i < 3; i++) snapshots.put(context, { ...message, params: { threadId: String(i) } }, { result: { i } });
  expect(snapshots.get(context, { ...message, params: { threadId: '0' } })).toBeUndefined();
  snapshots.put(context, message, { result: { body: 'x'.repeat(1001) } }); expect(snapshots.get(context, message)).toBeUndefined();
});
