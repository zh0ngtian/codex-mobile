import { performance } from 'node:perf_hooks';
import { RemoteAdminError } from './admin-protocol.js';
/** 从首次FS证明前开始计时；race有界返回，晚结果仍由拥有者实际收尾。 */
export class AdminDeadline {
  readonly deadline: number;
  private readonly abort = new AbortController();
  readonly signal = this.abort.signal;
  private readonly timer: NodeJS.Timeout;
  private readonly cancel: () => void;
  constructor(timeoutMs: number, private readonly parent?: AbortSignal) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 620000) {
      throw new RemoteAdminError('configuration');
    }
    this.deadline = performance.now() + timeoutMs;
    this.cancel = () => this.abort.abort(new RemoteAdminError('cancelled'));
    parent?.addEventListener('abort', this.cancel, { once: true });
    this.timer = setTimeout(() => this.abort.abort(new RemoteAdminError('timeout')), timeoutMs);
    if (parent?.aborted) {
      this.cancel();
    }
  }
  assert(): void {
    if (performance.now() >= this.deadline && !this.signal.aborted) {
      this.abort.abort(new RemoteAdminError('timeout'));
    }
    if (this.signal.aborted) {
      throw this.signal.reason;
    }
  }
  async wait<T>(operation: () => Promise<T>): Promise<T> {
    this.assert();
    let cancel: (() => void) | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          this.assert();
          return operation();
        }),
        new Promise<never>((_resolve, reject) => {
          cancel = () => reject(this.signal.reason);
          this.signal.addEventListener('abort', cancel, { once: true });
          if (this.signal.aborted) {
            cancel();
          }
        }),
      ]);
      this.assert();
      return result;
    }
    finally {
      if (cancel) {
        this.signal.removeEventListener('abort', cancel);
      }
    }
  }
  dispose(): void {
    clearTimeout(this.timer);
    this.parent?.removeEventListener('abort', this.cancel);
  }
}
