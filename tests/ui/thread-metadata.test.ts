import { describe, expect, it, vi } from "vitest";
import {
  activeThreadAfterArchive,
  applyThreadNameUpdate,
  applyThreadNameUpdateToList,
  duplicateThread,
} from "../../src/app-server/thread-metadata";

describe("线程元数据", () => {
  it("通过 thread/fork 复制完整会话", async () => {
    const thread = { id: "thread-copy", forkedFromId: "thread-1" };
    const request = vi.fn(async () => ({ thread }));

    await expect(
      duplicateThread({ request } as any, "thread-1"),
    ).resolves.toBe(thread);
    expect(request).toHaveBeenCalledWith("thread/fork", {
      threadId: "thread-1",
      excludeTurns: true,
    });
  });

  it("复制响应没有新会话时报告响应异常", async () => {
    const request = vi.fn(async () => ({ thread: { id: "thread-1" } }));

    await expect(
      duplicateThread({ request } as any, "thread-1"),
    ).rejects.toThrow("复制会话响应无效");
  });

  it("旧归档响应不会清空后来打开的会话", () => {
    const newerThread = { id: "thread-2", turns: [{ id: "turn-2" }] };

    expect(activeThreadAfterArchive(newerThread, "thread-1")).toBe(
      newerThread,
    );
    expect(activeThreadAfterArchive(newerThread, "thread-2")).toBeNull();
  });

  it("会话名称通知同时更新列表和当前会话且不修改原对象", () => {
    const threads = [
      { id: "thread-1", name: "旧名称" },
      { id: "thread-2", name: "其他会话" },
    ];
    const active = { id: "thread-1", name: "旧名称", turns: [] };

    const nextThreads = applyThreadNameUpdateToList(
      threads,
      "thread-1",
      "服务端名称",
    );
    const nextActive = applyThreadNameUpdate(
      active,
      "thread-1",
      "服务端名称",
    );

    expect(nextThreads[0]).toEqual({ id: "thread-1", name: "服务端名称" });
    expect(nextThreads[1]).toBe(threads[1]);
    expect(nextActive).toEqual({
      id: "thread-1",
      name: "服务端名称",
      turns: [],
    });
    expect(threads[0].name).toBe("旧名称");
    expect(active.name).toBe("旧名称");
  });

  it("空名称通知清除自定义名称并保留不匹配的会话", () => {
    const target = { id: "thread-1", name: "旧名称", preview: "预览" };
    const other = { id: "thread-2", name: "其他会话" };

    expect(applyThreadNameUpdate(target, "thread-1", null)).toEqual({
      id: "thread-1",
      preview: "预览",
    });
    expect(applyThreadNameUpdate(other, "thread-1", null)).toBe(other);
  });
});
