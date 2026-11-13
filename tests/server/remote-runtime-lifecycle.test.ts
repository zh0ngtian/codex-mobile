// @vitest-environment node
import { expect, it } from 'vitest';
import { RemoteRuntimeLifecycle } from '../../server/remote/runtime-lifecycle.js';
import { assertRemoteOperation, withRemoteOperation } from '../../server/remote/operation-guard.js';

it('成功边界先退役再正常finally abort，长期异步任务不保留旧期限检查闭包', async () => {
  const lifecycle = new RemoteRuntimeLifecycle(20, 20, 5);
  let later!: Promise<string>;
  await lifecycle.run(undefined, async op => lifecycle.wait(op, async () => {
    later = new Promise(resolve => setTimeout(() => {
      try { assertRemoteOperation(); resolve('allowed'); } catch { resolve('blocked'); }
    }, 40));
    return true;
  }));
  expect(await later).toBe('allowed');
  lifecycle.close();
  await lifecycle.settled();
});

it.each(['parent', 'phase'] as const)('嵌套guard保留更短%s原预算，失败后迟到任务继续拒绝新资源', async kind => {
  const short = performance.now() + 10;
  const long = performance.now() + 1000;
  const check = (deadline: number) => { if (performance.now() >= deadline) throw new Error('fixed timeout'); };
  let later!: Promise<string>;
  await expect(withRemoteOperation(() => check(kind === 'parent' ? short : long), async () =>
    withRemoteOperation(() => check(kind === 'phase' ? short : long), async () => {
      later = new Promise(resolve => setTimeout(() => {
        try { assertRemoteOperation(); resolve('allowed'); } catch { resolve('blocked'); }
      }, 40));
      const until = performance.now() + 20;
      while (performance.now() < until) {}
      return true;
    }))).rejects.toThrow('fixed timeout');
  expect(await later).toBe('blocked');
});

it('未过期业务失败也固定关闭其迟到资源门禁，不保留外部错误文本', async () => {
  let later!: Promise<string>;
  await expect(withRemoteOperation(() => {}, async () => {
    later = new Promise(resolve => setTimeout(() => {
      try { assertRemoteOperation(); resolve('allowed'); } catch (error) { resolve(String(error)); }
    }, 10));
    throw new Error('synthetic-private-error');
  })).rejects.toThrow('synthetic-private-error');
  expect(await later).toBe('Error: Remote 操作已结束');
});
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
