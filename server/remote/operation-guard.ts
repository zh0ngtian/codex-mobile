import { AsyncLocalStorage } from 'node:async_hooks';

interface Guard { assert?: () => void; failed: boolean }
const guards = new AsyncLocalStorage<Guard[]>();

/** 仅可信内部精确资源清理使用；清理自己持有的资源，不继承已结束业务的期限或live检查。 */
export function runRemoteCleanup<T>(operation: () => T): T { return guards.run([], operation); }

/** 仅可信新资源边界调用；检查闭包不做FS，不影响close/kill/settled。 */
export function assertRemoteOperation(): void {
  for (const guard of guards.getStore() ?? []) {
    guard.assert?.();
    if (guard.failed) throw new Error('Remote 操作已结束');
  }
}

/** 仅同次派生后台任务显式保留原父检查；普通成功退役规则保持不变。 */
export function captureRemoteOperation(): () => void {
  const parents = (guards.getStore() ?? []).map(guard => ({ guard, assert: guard.assert }));
  return () => {
    for (const { guard, assert } of parents) {
      assert?.();
      if (guard.failed) throw new Error('Remote 操作已结束');
    }
  };
}

/** 保留原父期限；最终成功才退役并清除闭包，失败继续约束迟到任务。 */
export function withRemoteOperation<T>(assert: () => void, operation: () => Promise<T>): Promise<T> {
  const guard: Guard = { assert, failed: false };
  const parents = (guards.getStore() ?? []).filter(value => value.assert || value.failed);
  return guards.run([...parents, guard], async () => {
    try {
      assertRemoteOperation();
      const value = await operation();
      assertRemoteOperation();
      guard.assert = undefined;
      return value;
    } catch (error) {
      guard.failed = true;
      throw error;
    }
  });
}

/** ledger耐久ACK后的新执行有独立真实预算，不继承已结束的提交调用。 */
export function withIndependentRemoteOperation<T>(assert: () => void, operation: () => Promise<T>): Promise<T> {
  return guards.run([], () => withRemoteOperation(assert, operation));
}
