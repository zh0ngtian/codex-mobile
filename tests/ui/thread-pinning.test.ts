import { describe, expect, it } from "vitest";
import {
  applyPinnedThreadState,
  readPinnedThreadIds,
  toggleThreadPinned,
  writeThreadPinned,
} from "../../src/features/threads/thread-pinning";

describe("会话本地置顶状态", () => {
  it("按照机器保存和恢复置顶会话", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    writeThreadPinned(storage, "mini", "thread-1", true);
    writeThreadPinned(storage, "mini", "thread-2", true);
    writeThreadPinned(storage, "mini", "thread-1", false);

    expect(readPinnedThreadIds(storage, "mini")).toEqual(
      new Set(["thread-2"]),
    );
    expect(readPinnedThreadIds(storage, "macbook")).toEqual(
      new Set(),
    );
  });

  it("本地切换置顶不依赖服务端且按机器隔离", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    expect(toggleThreadPinned(storage, "mini", "thread-1")).toBe(true);
    expect(readPinnedThreadIds(storage, "mini")).toEqual(new Set(["thread-1"]));
    expect(readPinnedThreadIds(storage, "macbook")).toEqual(new Set());
    expect(toggleThreadPinned(storage, "mini", "thread-1")).toBe(false);
    expect(readPinnedThreadIds(storage, "mini")).toEqual(new Set());
  });

  it("从本地状态恢复置顶", () => {
    expect(
      applyPinnedThreadState(
        [{ id: "thread-1" }, { id: "thread-2" }],
        new Set(["thread-2"]),
      ),
    ).toEqual([
      { id: "thread-1", isPinned: false },
      { id: "thread-2", isPinned: true },
    ]);
  });

  it("即使服务端返回置顶字段也只采用本地状态", () => {
    expect(
      applyPinnedThreadState(
        [
          { id: "thread-1", isPinned: false },
          { id: "thread-2", isPinned: true },
        ],
        new Set(["thread-1"]),
      ),
    ).toEqual([
      { id: "thread-1", isPinned: true },
      { id: "thread-2", isPinned: false },
    ]);
  });
});
