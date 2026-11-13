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
it('有界close之后实际迟到存储与清理仍保留归属屏障', async () => {
 const lifecycle = new RemoteRuntimeLifecycle(5, 5, 5);
 let finishWrite!: () => void; let finishDrain!: () => void;
 const write = new Promise<void>(resolve => finishWrite = resolve);
 const drain = new Promise<void>(resolve => finishDrain = resolve);
 const operation = lifecycle.run(undefined, op => lifecycle.wait(op, () => write));
 await expect(operation).rejects.toMatchObject({ code: 'timeout' }); lifecycle.close();
 await lifecycle.cleanup(() => drain);
 let settled = false; const barrier = lifecycle.settled().then(() => settled = true);
 await Promise.resolve(); expect(settled).toBe(false);
 finishWrite(); await Promise.resolve(); expect(settled).toBe(false);
 finishDrain(); await barrier; expect(settled).toBe(true);
});
