// @vitest-environment node
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { PrivateStore } from '../../server/remote/private-store.js';
import { RemoteRuntimeStateStore } from '../../server/remote/runtime-state.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const managed = {
  codexHome: '/synthetic/codex',
  accountId: 'workspace',
  accountUserId: 'account-user',
  userId: 'user',
};
const old = { environmentId: 'environment', installationId: 'old' };
const next = { ...old, installationId: 'new' };
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'remote-runtime-state-')));
  roots.push(root);
  const store = new PrivateStore(join(root, 'private'));
  return {
    store,
    state: new RemoteRuntimeStateStore(store, 'generation', managed),
  };
}
it('按完整tuple保留同environment旧installation暂停，重启不静默去重', async () => {
  const f = await fixture();
  await f.state.write({
    version: 1,
    generation: 'generation',
    managed,
    paused: false,
    reason: 'reauthorization',
    pending: [old, next],
  });
  await expect(new RemoteRuntimeStateStore(f.store, 'generation', managed).read()).resolves.toMatchObject({
    pending: [old, next],
  });
});
it('拒绝不同generation、managed或超限暂停集合，原记录不变', async () => {
  const f = await fixture();
  const valid = {
    version: 1 as const,
    generation: 'generation',
    managed,
    paused: true,
    reason: 'manual' as const,
    pending: [old],
  };
  await f.state.write(valid);
  for (const change of [
    { generation: 'other' },
    { managed: { ...managed, userId: 'other' } },
    {
      pending: Array.from({ length: 4097 }, (_, index) => ({
        ...old,
        installationId: String(index),
      })),
    },
  ])
    await expect(f.state.write({ ...valid, ...change })).rejects.toThrow('Remote 运行暂停记录不可用');
  await expect(f.state.read()).resolves.toEqual(valid);
});
it('磁盘未知字段、重复tuple和身份错配不能自动清除暂停', async () => {
  const f = await fixture();
  for (const change of [
    { token: 'private' },
    { pending: [old, old] },
    { managed: { ...managed, accountId: 'other' } },
  ]) {
    await f.store.writeJson('runtime-state.json', {
      version: 1,
      generation: 'generation',
      managed,
      paused: false,
      reason: 'manual',
      pending: [old],
      ...change,
    });
    await expect(f.state.read()).rejects.toThrow('Remote 运行暂停记录不可用');
  }
});
