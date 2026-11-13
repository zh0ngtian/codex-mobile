import { PrivateStore } from './private-store.js';
import { RemoteAdminError } from './admin-protocol.js';
import { AdminDeadline } from './admin-deadline.js';
export interface RemoteOwner {
  close(): Promise<void>;
}
export type RemoteOwnerAcquisition = Promise<RemoteOwner> & {
  /** 失败/取消后等待迟到的锁准备、取得和精确释放；不释放已交付的归属。 */
  settled(): Promise<void>;
};
/** 复用现有 PID/nonce 初始化锁；首次FS前开始计时，实际收尾由可信入口跟踪。 */
export function acquireRemoteOwner(store: PrivateStore, options: {
  timeoutMs?: number;
  signal?: AbortSignal;
} = {}): RemoteOwnerAcquisition {
  const phase = new AdminDeadline(options.timeoutMs ?? 1000, options.signal);
  let release!: () => void;
  let acquired!: () => void;
  let failed!: (error: unknown) => void;
  let delivered = false;
  const hold = new Promise<void>(resolve => release = resolve);
  const ready = new Promise<void>((resolve, reject) => { acquired = resolve; failed = reject; });
  // Registry等其他初始化事务仍使用原语义；仅网关归属在实际回调交付前校验期限。
  const actual = Promise.resolve().then(() => {
    phase.assert();
    return store.withInitialization('gateway-owner', async () => {
      phase.assert();
      acquired();
      await hold;
    }, { timeoutMs: options.timeoutMs ?? 1000 });
  });
  void actual.catch(() => {
    if (!phase.signal.aborted) failed(new RemoteAdminError('busy'));
  });
  const pending = phase.wait(() => ready).then(() => {
    phase.assert();
    delivered = true;
    return { close() { release(); return actual; } };
  }).catch(error => {
    release();
    throw error instanceof RemoteAdminError && error.code === 'timeout' ? new RemoteAdminError('busy') : error;
  }).finally(() => phase.dispose());
  return Object.assign(pending, {
    async settled() {
      await pending.catch(() => undefined);
      if (!delivered) {
        try { await actual; }
        catch (error) { if (error !== phase.signal.reason) throw error; }
      }
    },
  });
}
