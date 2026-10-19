export type HttpRequestPriority = "foreground" | "background" | "background-visible";

interface QueuedRequest {
  priority: HttpRequestPriority;
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
    const channel = priority === "foreground" ? "foreground" : "background";
    const idle = () => {
      if (!current.foreground && !current.background && !current.queued.length) this.origins.delete(origin);
    };
    const drain = () => {
      while (!current.foreground && current.background < 2 && current.queued.length) current.queued.shift()!.start();
      idle();
    };
    return new Promise<T>((resolve, reject) => {
      const queued: QueuedRequest = {
        priority,
        start: () => {
          signal?.removeEventListener("abort", cancel);
          current[channel]++;
          void (async () => {
            try { resolve(await operation()); }
            catch (error) { reject(error); }
            finally { current[channel]--; drain(); }
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
        const ordinary = priority === "background-visible"
          ? current.queued.findIndex(request => request.priority === "background") : -1;
        if (ordinary < 0) current.queued.push(queued);
        else current.queued.splice(ordinary, 0, queued);
        signal?.addEventListener("abort", cancel, { once: true });
        drain();
      }
    });
  }
}

export const httpRequestScheduler = new HttpRequestScheduler();
