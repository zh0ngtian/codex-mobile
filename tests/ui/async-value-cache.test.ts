import { describe, expect, it, vi } from "vitest";
import { AsyncValueCache } from "../../src/lib/async-value-cache";

describe("异步目录缓存", () => {
  it("合并同 key 并发请求并复用已完成结果", async () => {
    let complete!: (value: string[]) => void;
    const loader = vi.fn(
      () => new Promise<string[]>((resolve) => {
        complete = resolve;
      }),
    );
    const cache = new AsyncValueCache<string[]>();

    const first = cache.load("backend\0/tmp/project", loader);
    const second = cache.load("backend\0/tmp/project", loader);
    expect(first).toBe(second);
    expect(loader).toHaveBeenCalledOnce();

    complete(["cached"]);
    await expect(first).resolves.toEqual(["cached"]);
    await expect(cache.load("backend\0/tmp/project", loader)).resolves.toEqual([
      "cached",
    ]);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("强制刷新替换缓存且失效后重新请求", async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("forced")
      .mockResolvedValueOnce("after-invalidate");
    const cache = new AsyncValueCache<string>();

    await expect(cache.load("key", loader)).resolves.toBe("first");
    await expect(cache.load("key", loader, true)).resolves.toBe("forced");
    cache.invalidate("key");
    await expect(cache.load("key", loader)).resolves.toBe("after-invalidate");
    expect(loader).toHaveBeenCalledTimes(3);
  });
});
