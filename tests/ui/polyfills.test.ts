import { describe, expect, it, vi } from "vitest";
import { installObjectHasOwnPolyfill } from "../../src/polyfills";

describe("旧版 WebView 兼容补丁", () => {
  it("缺少 Object.hasOwn 时提供等价实现", () => {
    const objectConstructor = {} as typeof Object;
    const inherited = { inherited: true };
    const value = Object.assign(Object.create(inherited), { own: true });

    installObjectHasOwnPolyfill(objectConstructor);

    expect(objectConstructor.hasOwn(value, "own")).toBe(true);
    expect(objectConstructor.hasOwn(value, "inherited")).toBe(false);
  });

  it("浏览器已有实现时不覆盖", () => {
    const hasOwn = vi.fn(() => true);
    const objectConstructor = { hasOwn } as unknown as typeof Object;

    installObjectHasOwnPolyfill(objectConstructor);

    expect(objectConstructor.hasOwn).toBe(hasOwn);
  });
});
