import { describe, expect, it, vi } from "vitest";
import { createLatestClientRefresh } from "../../src/app-server/latest-client-refresh";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("整轮连接刷新去重", () => {
  it("目录和列表同属一个在途任务，完成后允许重新读取", async () => {
    const refresh = createLatestClientRefresh<object>(), client = {}, gate = deferred();
    const operation = vi.fn(() => gate.promise);
    const first = refresh.run(client, operation), second = refresh.run(client, operation);
    expect(second).toBe(first);
    expect(operation).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(operation).toHaveBeenCalledOnce();
    gate.resolve(); await first;
    await refresh.run(client, operation);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("旧连接结束不释放新连接任务，新连接失败后仍可重试", async () => {
    const refresh = createLatestClientRefresh<object>(), old = deferred(), current = deferred();
    const a = {}, b = {}, next = vi.fn(() => current.promise);
    const before = refresh.run(a, () => old.promise), after = refresh.run(b, next);
    old.resolve(); await before;
    expect(refresh.run(b, next)).toBe(after);
    current.resolve(); await after;
    await expect(refresh.run(b, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    await expect(refresh.run(b, async () => undefined)).resolves.toBeUndefined();
  });

  it("同步失败也会释放在途任务", async () => {
    const refresh = createLatestClientRefresh<object>(), client = {};
    await expect(refresh.run(client, () => { throw new Error("sync failure"); })).rejects.toThrow("sync failure");
    await expect(refresh.run(client, async () => undefined)).resolves.toBeUndefined();
  });
});
