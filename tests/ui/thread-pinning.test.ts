import { beforeEach, describe, expect, it } from "vitest";
import {
  applyPinnedThreadState,
  readPinnedThreadIds,
  writeThreadPinned,
} from "../../src/features/threads/thread-pinning";

describe("会话置顶本地兼容状态", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("按照机器保存和恢复置顶会话", () => {
    writeThreadPinned(window.localStorage, "mini", "thread-1", true);
    writeThreadPinned(window.localStorage, "mini", "thread-2", true);
    writeThreadPinned(window.localStorage, "mini", "thread-1", false);

    expect(readPinnedThreadIds(window.localStorage, "mini")).toEqual(
      new Set(["thread-2"]),
    );
    expect(readPinnedThreadIds(window.localStorage, "macbook")).toEqual(
      new Set(),
    );
  });

  it("服务端没有置顶字段时应用本地状态", () => {
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

  it("服务端返回原生置顶字段时以服务端状态为准", () => {
    expect(
      applyPinnedThreadState(
        [
          { id: "thread-1", isPinned: false },
          { id: "thread-2", isPinned: true },
        ],
        new Set(["thread-1"]),
      ),
    ).toEqual([
      { id: "thread-1", isPinned: false },
      { id: "thread-2", isPinned: true },
    ]);
  });
});
