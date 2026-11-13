import { PrivateStore } from './private-store.js';
import { RemoteAdminError } from './admin-protocol.js';
/** 复用现有 PID/nonce 初始化锁，持有到实际收尾；进程被杀后由同一协议回收。 */
export async function acquireRemoteOwner(store: PrivateStore, options: {
  timeoutMs?: number;
} = {}): Promise<{
  close(): Promise<void>;
}> {
  let release!: () => void;
  let acquired!: () => void;
  let failed!: (error: unknown) => void;
  const hold = new Promise<void>(resolve => release = resolve);
  const ready = new Promise<void>((resolve, reject) => {
    acquired = resolve;
    failed = reject;
  });
  const flight = store.withInitialization('gateway-owner', async () => {
    acquired();
    await hold;
  }, { timeoutMs: options.timeoutMs ?? 1000 });
  void flight.catch(() => failed(new RemoteAdminError('busy')));
  await ready;
  return { close() {
      release();
      return flight;
    } };
}
