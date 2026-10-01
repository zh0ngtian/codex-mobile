import { describe, expect, it, vi } from "vitest";
import {
  activeThreadAfterArchive,
  setThreadPinned,
} from "../../src/app-server/thread-metadata";

describe("线程元数据", () => {
  it("通过 app-server 持久化置顶状态并返回刷新线程", async () => {
    const thread = { id: "thread-1", isPinned: true };
    const request = vi.fn(async () => ({ thread }));

    await expect(
      setThreadPinned({ request } as any, "thread-1", true),
    ).resolves.toEqual({ thread, persistence: "server" });
    expect(request).toHaveBeenCalledWith("thread/metadata/update", {
      threadId: "thread-1",
      isPinned: true,
    });
  });

  it("旧版 app-server 不支持置顶字段时降级为本地持久化", async () => {
    const request = vi.fn(async () => {
      throw new Error(
        "thread metadata update must include at least one field",
      );
    });

    await expect(
      setThreadPinned({ request } as any, "thread-1", true),
    ).resolves.toEqual({
      thread: { id: "thread-1", isPinned: true },
      persistence: "local",
    });
  });

  it("非兼容性错误仍向上报告", async () => {
    const request = vi.fn(async () => {
      throw new Error("connection closed");
    });

    await expect(
      setThreadPinned({ request } as any, "thread-1", true),
    ).rejects.toThrow("connection closed");
  });

  it("服务端没有返回目标置顶状态时报告响应异常", async () => {
    const request = vi.fn(async () => ({
      thread: { id: "thread-1" },
    }));

    await expect(
      setThreadPinned({ request } as any, "thread-1", true),
    ).rejects.toThrow("置顶状态不一致");
  });

  it("旧归档响应不会清空后来打开的会话", () => {
    const newerThread = { id: "thread-2", turns: [{ id: "turn-2" }] };

    expect(activeThreadAfterArchive(newerThread, "thread-1")).toBe(
      newerThread,
    );
    expect(activeThreadAfterArchive(newerThread, "thread-2")).toBeNull();
  });
});
