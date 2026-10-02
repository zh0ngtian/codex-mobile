interface PendingValue<T> {
  generation: number;
  promise: Promise<T>;
}

export class AsyncValueCache<T> {
  private readonly values = new Map<string, T>();
  private readonly pending = new Map<string, PendingValue<T>>();
  private readonly generations = new Map<string, number>();

  get(key: string) {
    return this.values.get(key);
  }

  load(
    key: string,
    loader: () => Promise<T>,
    forceReload = false,
  ): Promise<T> {
    if (!forceReload && this.values.has(key)) {
      return Promise.resolve(this.values.get(key)!);
    }
    if (!forceReload) {
      const existing = this.pending.get(key);
      if (existing) return existing.promise;
    }

    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    const promise = loader().then((value) => {
      if (this.generations.get(key) === generation) {
        this.values.set(key, value);
      }
      return value;
    }).finally(() => {
      if (this.pending.get(key)?.generation === generation) {
        this.pending.delete(key);
      }
    });
    this.pending.set(key, { generation, promise });
    return promise;
  }

  invalidate(key: string) {
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    this.values.delete(key);
    this.pending.delete(key);
  }
}
