export interface SettledResource {
  close?(): unknown;
  settled?(): Promise<void>;
}
/** close的同步部分立即执行；抛错或拒绝也不能跳过可信实际屏障。 */
export function closeRemoteResource(resource: SettledResource | undefined): Promise<void> {
  let closing: unknown;
  try { closing = resource?.close?.(); } catch { /* 仍独立等待实际settled。 */ }
  return Promise.resolve(closing).catch(() => undefined).then(() => resource?.settled?.()).then(() => undefined);
}
/** 仅内部持有者使用：保留迟到工厂和被摘除资源，不改变公共操作的有界返回。 */
export class ResourceSettlement {
  private readonly work = new Set<Promise<unknown>>();
  track<T>(promise: Promise<T>): Promise<T> {
    const actual = promise.then(() => undefined, () => undefined)
      .then(() => (promise as Promise<T> & { settled?(): Promise<void> }).settled?.());
    this.work.add(actual);
    void actual.finally(() => this.work.delete(actual)).catch(() => undefined);
    return promise;
  }
  create<T>(factory: () => Promise<T>): Promise<T> {
    // 保留connectCanonical等原始Promise的可信装饰，不能被Promise同化丢掉。
    return this.track(Promise.resolve().then(() => this.track(factory())));
  }
  close(resource: SettledResource | undefined): Promise<void> {
    const actual = this.track(closeRemoteResource(resource));
    void actual.catch(() => undefined);
    return actual;
  }
  async settled(): Promise<void> {
    while (this.work.size) await Promise.allSettled(this.work);
  }
}
