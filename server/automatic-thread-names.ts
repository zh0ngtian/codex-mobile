type PendingName = { promise: Promise<void>; finish: () => void; candidate?: string };

/** 只协调自动命名与通知，不保存标题；名称仍由已确认的 RPC / metadata 提供。 */
export class AutomaticThreadNames {
  private pending = new Map<string, PendingName>();
  private closed = false;
  constructor(private timeoutMs = 125_000) {}
  begin(threadId: string) {
    let entry = this.pending.get(threadId);
    if (!entry && !this.closed) {
      let resolve!: () => void;
      let timer: ReturnType<typeof setTimeout>;
      const value: PendingName = { promise: new Promise<void>(done => { resolve = done; }), finish: () => {
        if (this.pending.get(threadId) !== value) return;
        this.pending.delete(threadId); clearTimeout(timer); resolve();
      } };
      this.pending.set(threadId, value);
      timer = setTimeout(value.finish, this.timeoutMs); timer.unref?.(); entry = value;
    }
    const current = entry;
    return {
      candidate: (title: string) => { if (current && this.pending.get(threadId) === current) current.candidate = title; },
      fail: () => { if (current && this.pending.get(threadId) === current) current.finish(); },
    };
  }
  wait(threadId: string) { return this.pending.get(threadId)?.promise ?? Promise.resolve(); }
  saved(threadId: string) { this.pending.get(threadId)?.finish(); }
  failedSave(threadId: string, name: unknown) {
    const entry = this.pending.get(threadId);
    if (entry?.candidate !== undefined && entry.candidate === name) entry.finish();
  }
  close() { this.closed = true; for (const entry of this.pending.values()) entry.finish(); }
}
