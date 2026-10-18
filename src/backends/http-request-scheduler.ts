export type HttpRequestPriority = "foreground" | "background";

interface QueuedRequest {
  start(): void;
}
interface OriginRequests {
  foreground: number;
  background: number;
  queued: QueuedRequest[];
}

/** 同一网关的多个设备配置共享后台名额；前台不排在列表刷新后面。 */
class HttpRequestScheduler {
  private readonly origins = new Map<string, OriginRequests>();

  run<T>(origin: string, priority: HttpRequestPriority, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    let state = this.origins.get(origin);
    if (!state) {
      state = { foreground: 0, background: 0, queued: [] };
      this.origins.set(origin, state);
    }
    const current = state;
    const idle = () => {
      if (!current.foreground && !current.background && !current.queued.length) this.origins.delete(origin);
    };
    const drain = () => {
      while (!current.foreground && current.background < 2 && current.queued.length) current.queued.shift()!.start();
      idle();
    };
    return new Promise<T>((resolve, reject) => {
      const queued: QueuedRequest = {
        start: () => {
          signal?.removeEventListener("abort", cancel);
          current[priority]++;
          void (async () => {
            try { resolve(await operation()); }
            catch (error) { reject(error); }
            finally { current[priority]--; drain(); }
          })();
        },
      };
      const cancel = () => {
        const index = current.queued.indexOf(queued);
        if (index < 0) return;
        current.queued.splice(index, 1);
        signal?.removeEventListener("abort", cancel);
        reject(signal?.reason);
        idle();
      };
      if (priority === "foreground") queued.start();
      else {
        current.queued.push(queued);
        signal?.addEventListener("abort", cancel, { once: true });
        drain();
      }
    });
  }
}

export const httpRequestScheduler = new HttpRequestScheduler();
