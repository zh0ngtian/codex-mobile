import { describe, expect, it } from "vitest";
import {
  applyPinnedThreadState,
  readPinnedThreadIds,
  replacePinnedThreadIds,
  writeThreadPinned,
} from "../../src/features/threads/thread-pinning";

describe("桌面置顶的本地缓存", () => {
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

  it("首次以桌面集合替换旧关注且按机器隔离，不向桌面迁移", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    writeThreadPinned(storage, "mini", "phone-old", true);
    writeThreadPinned(storage, "book", "book-pin", true);
    replacePinnedThreadIds(storage, "mini", ["desktop-pin"]);
    expect(readPinnedThreadIds(storage, "mini")).toEqual(new Set(["desktop-pin"]));
    expect(readPinnedThreadIds(storage, "book")).toEqual(new Set(["book-pin"]));
    replacePinnedThreadIds(storage, "mini", []);
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

  it("列表只使用已完整同步的分组集合，忽略旧 isPinned 字段", () => {
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
