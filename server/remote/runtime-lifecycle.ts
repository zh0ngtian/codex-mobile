import { performance } from 'node:perf_hooks';
import { RemoteAuthRequiredError } from './relay.js';

export type RemoteRuntimeFailure =
  | 'configuration'
  | 'closed'
  | 'busy'
  | 'not-configured'
  | 'already-configured'
  | 'unavailable'
  | 'identity-changed'
  | 'target-unaccepted'
  | 'target-unavailable'
  | 'pending-resume'
  | 'storage'
  | 'timeout'
  | 'cancelled'
  | 'commit-pending';
const MESSAGES: Record<RemoteRuntimeFailure, string> = {
  configuration: 'Remote 运行配置无效',
  closed: 'Remote 运行实例已关闭',
  busy: 'Remote 管理操作正在进行',
  'not-configured': '网关尚未授权 Remote',
  'already-configured': '网关已有 Remote 身份，请显式重新授权',
  unavailable: 'Remote 当前不可用',
  'identity-changed': 'Remote 原账号或本机身份已变化',
  'target-unaccepted': 'Remote 完整目标尚未接受',
  'target-unavailable': 'Remote 完整目标没有当前有效配对',
  'pending-resume': 'Remote 目标需要在 Mac 显式恢复',
  storage: 'Remote 运行记录不可用',
  timeout: 'Remote 管理操作已超时',
  cancelled: 'Remote 管理操作已取消',
  'commit-pending': 'Remote 身份提交结果尚待核对',
};
export class RemoteRuntimeError extends Error {
  constructor(readonly code: RemoteRuntimeFailure) {
    super(MESSAGES[code]);
    this.name = 'RemoteRuntimeError';
  }
}
export interface RemoteRuntimeOperation {
  epoch: number;
  abort: AbortController;
  deadline: number;
  removers: (() => void)[];
  timer?: NodeJS.Timeout;
}
export { closeRemoteResource } from './resource-settlement.js';
export function classifyRemoteRuntimeFailure(error: unknown): RemoteRuntimeFailure {
  if (error instanceof RemoteRuntimeError && Object.hasOwn(MESSAGES, error.code)) return error.code;
  if (error instanceof RemoteAuthRequiredError) return 'identity-changed';
  return 'unavailable';
}

/** 私有运行边界：身份互斥、实际单调期限、取消和有界清理。 */
export class RemoteRuntimeLifecycle {
  closed = false;
  epoch = 0;
  operation?: RemoteRuntimeOperation;
  pending?: Promise<unknown>;
  private readonly work = new Set<Promise<unknown>>();
  /** 可信进程归属屏障使用实际Promise，不能用超时后的race代替。 */
  track<T>(promise: Promise<T>): Promise<T> {
    this.work.add(promise);
    void promise.finally(() => this.work.delete(promise)).catch(() => undefined);
    return promise;
  }
  constructor(
    private readonly timeout: number,
    private readonly interactionTimeout: number,
    private readonly cleanupTimeout: number,
  ) {}
  assert(op: RemoteRuntimeOperation, phaseDeadline = Infinity): void {
    if (performance.now() >= Math.min(op.deadline, phaseDeadline) && !op.abort.signal.aborted)
      op.abort.abort(new RemoteRuntimeError('timeout'));
    if (this.closed || op.epoch !== this.epoch) throw new RemoteRuntimeError('closed');
    if (op.abort.signal.aborted)
      throw op.abort.signal.reason instanceof RemoteRuntimeError
        ? op.abort.signal.reason
        : new RemoteRuntimeError('cancelled');
  }
  async wait<T>(op: RemoteRuntimeOperation, callback: () => Promise<T>, limit = this.timeout): Promise<T> {
    this.assert(op);
    let timer: NodeJS.Timeout | undefined;
    let abort: (() => void) | undefined;
    const phaseDeadline = performance.now() + limit;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => {
          this.assert(op, phaseDeadline);
          return this.track(Promise.resolve(callback()));
        }),
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(op.abort.signal.reason);
          op.abort.signal.addEventListener('abort', abort, { once: true });
          timer = setTimeout(
            () => op.abort.abort(new RemoteRuntimeError('timeout')),
            Math.min(limit, Math.max(1, op.deadline - performance.now())),
          );
          if (op.abort.signal.aborted) abort();
        }),
      ]);
      this.assert(op, phaseDeadline);
      return value;
    } catch (error) {
      this.assert(op, phaseDeadline);
      throw new RemoteRuntimeError(classifyRemoteRuntimeFailure(error));
    } finally {
      clearTimeout(timer);
      if (abort) op.abort.signal.removeEventListener('abort', abort);
    }
  }
  async cleanup(callback: () => Promise<unknown>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve()
          .then(() => this.track(Promise.resolve(callback())))
          .catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.cleanupTimeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  run<T>(
    signal: AbortSignal | undefined,
    callback: (op: RemoteRuntimeOperation) => Promise<T>,
    interactive = false,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new RemoteRuntimeError('closed'));
    if (this.operation) return Promise.reject(new RemoteRuntimeError('busy'));
    if (signal?.aborted) return Promise.reject(new RemoteRuntimeError('cancelled'));
    const op: RemoteRuntimeOperation = {
      epoch: ++this.epoch,
      abort: new AbortController(),
      deadline: performance.now() + (interactive ? this.interactionTimeout : this.timeout),
      removers: [],
    };
    this.operation = op;
    if (signal) {
      const abort = () => op.abort.abort(new RemoteRuntimeError('cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      op.removers.push(() => signal.removeEventListener('abort', abort));
    }
    op.timer = setTimeout(
      () => op.abort.abort(new RemoteRuntimeError('timeout')),
      Math.max(1, op.deadline - performance.now()),
    );
    const flight = (async () => {
      try {
        const value = await callback(op);
        this.assert(op);
        return value;
      } catch (error) {
        throw new RemoteRuntimeError(classifyRemoteRuntimeFailure(error));
      } finally {
        clearTimeout(op.timer);
        for (const remove of op.removers) {
          try {
            remove();
          } catch {
            /* 清理继续。 */
          }
        }
        op.abort.abort();
        if (this.operation === op) this.operation = undefined;
      }
    })();
    this.pending = flight;
    void flight
      .finally(() => {
        if (this.pending === flight) this.pending = undefined;
      })
      .catch(() => undefined);
    return flight;
  }
  async settled(): Promise<void> {
    if (!this.closed) throw new RemoteRuntimeError('configuration');
    while (this.pending || this.work.size) {
      await Promise.allSettled([...(this.pending ? [this.pending] : []), ...this.work]);
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.epoch++;
    this.operation?.abort.abort(new RemoteRuntimeError('closed'));
  }
}
