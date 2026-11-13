// @vitest-environment node
import { expect, it } from 'vitest';
import { RemoteRuntimeLifecycle } from '../../server/remote/runtime-lifecycle.js';
it('最后await期间取消仍失败，同步阻塞按单调绝对期限拒绝晚成功', async () => {
  const lifecycle = new RemoteRuntimeLifecycle(100, 100, 10);
  const abort = new AbortController();
  await expect(
    lifecycle.run(abort.signal, async () => {
      await Promise.resolve();
      abort.abort();
      return true;
    }),
  ).rejects.toMatchObject({ code: 'cancelled' });
  const bounded = new RemoteRuntimeLifecycle(5, 5, 10);
  await expect(
    bounded.run(undefined, async (op) =>
      bounded.wait(op, async () => {
        const end = performance.now() + 15;
        while (performance.now() < end) {}
        return true;
      }),
    ),
  ).rejects.toMatchObject({ code: 'timeout' });
});
it('所有管理操作互斥且close永久中止挂起操作，有界清理独立于已取消操作', async () => {
  const lifecycle = new RemoteRuntimeLifecycle(100, 100, 5);
  let entered = false;
  const pending = lifecycle.run(undefined, async (op) =>
    lifecycle.wait(op, () => {
      entered = true;
      return new Promise(() => {});
    }),
  );
  const checked = expect(pending).rejects.toMatchObject({ code: 'closed' });
  await Promise.resolve();
  await expect(lifecycle.run(undefined, async () => true)).rejects.toMatchObject({ code: 'busy' });
  expect(entered).toBe(true);
  lifecycle.close();
  await checked;
  await lifecycle.cleanup(() => new Promise(() => {}));
  await expect(lifecycle.run(undefined, async () => true)).rejects.toMatchObject({ code: 'closed' });
});
