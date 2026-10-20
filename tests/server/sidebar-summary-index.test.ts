import { describe, expect, it, vi } from "vitest";
import { SidebarSummaryIndex } from "../../server/sidebar-summary-index.js";

function fixture() {
  const records = new Map(Array.from({ length: 12 }, (_, i) => [String(i), {
    id: String(i), recencyAt: i, status: { type: i === 1 ? "active" : "idle" }, turns: ["private"],
  }]));
  const request = vi.fn(async (method: string, params: any): Promise<any> => method === "thread/loaded/list"
    ? { data: [...records.keys()], nextCursor: null } : { thread: records.get(params.threadId) });
  const index = new SidebarSummaryIndex(request);
  index.setEpoch("one");
  return { index, records, request };
}

describe("网关边栏摘要索引", () => {
  it("冷索引补查一次，热索引只重新核对 loaded 目录；摘要不含正文", async () => {
    const f = fixture();
    expect((await f.index.summaries({ threadIds: ["2"], includeRunning: true })).data.map(t => t.id)).toEqual(["2", "1"]);
    expect(f.request.mock.calls.filter(([m]) => m === "thread/read")).toHaveLength(12);
    f.request.mockClear();
    const second = await f.index.summaries({ threadIds: ["2"], includeRunning: true });
    expect(second.data.every(t => !("turns" in t))).toBe(true);
    expect(f.request.mock.calls.map(([m]) => m)).toEqual(["thread/loaded/list"]);
  });

  it("状态事件使结束运行重新核对；旧运行 ID 即使离开 loaded 仍回填空闲", async () => {
    const f = fixture(); await f.index.summaries({ threadIds: [], includeRunning: true });
    f.records.set("1", { ...f.records.get("1")!, status: { type: "idle" } });
    f.index.observe({ method: "thread/status/changed", params: { threadId: "1", status: { type: "idle" } } });
    f.request.mockClear();
    const result = await f.index.summaries({ threadIds: ["1"], includeRunning: true });
    expect(result.data).toEqual([expect.objectContaining({ id: "1", status: { type: "idle" } })]);
    expect(f.request.mock.calls.filter(([m]) => m === "thread/read")).toHaveLength(1);
    f.index.setEpoch("two"); f.request.mockClear();
    await f.index.summaries({ threadIds: [], includeRunning: true });
    expect(f.request.mock.calls.filter(([m]) => m === "thread/read")).toHaveLength(12);
  });

  it("无项目排序后只下发五条，游标再取五条；运行未读占位，关注和空闲未读排除", async () => {
    const f = fixture();
    const params = { threadIds: [...f.records.keys()].reverse(), excludedThreadIds: ["1", "11"], fixedExcludedThreadIds: ["10"] };
    const first = await f.index.projectless(params);
    expect(first.data.map(t => t.id)).toEqual(["9", "8", "7", "6", "5"]);
    expect(first.nextCursor).toEqual(expect.any(String));
    f.request.mockClear();
    const next = await f.index.projectless({ ...params, cursor: first.nextCursor });
    expect(next.data.map(t => t.id)).toEqual(["4", "3", "2", "1", "0"]);
    expect(next.nextCursor).toBeNull();
    expect(f.request).not.toHaveBeenCalled();
    await expect(f.index.projectless({ ...params, threadIds: ["1"], cursor: first.nextCursor })).rejects.toThrow(/分页/);
  });

  it("未知 ID 摘要按在途去重，过滤归档与辅助会话", async () => {
    const f = fixture();
    (f.records.get("11") as any).archived = true;
    (f.records.get("10") as any).parentThreadId = "parent";
    await Promise.all([
      f.index.summaries({ threadIds: ["10", "11", "8"], includeRunning: false }),
      f.index.projectless({ threadIds: ["10", "11", "8"] }),
    ]);
    expect(f.request.mock.calls.filter(([m]) => m === "thread/read")).toHaveLength(3);
    expect((await f.index.projectless({ threadIds: ["10", "11", "8"] })).data.map(t => t.id)).toEqual(["8"]);
  });

  it("索引断线后旧在途结果不能污染新 epoch", async () => {
    let done!: (value: any) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { done = resolve; }))
      .mockResolvedValue({ thread: { id: "x", status: { type: "idle" } } });
    const index = new SidebarSummaryIndex(request); index.setEpoch("one");
    const old = index.summaries({ threadIds: ["x"], includeRunning: false });
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    index.setEpoch("two");
    expect((await index.summaries({ threadIds: ["x"], includeRunning: false })).data[0].status.type).toBe("idle");
    done({ thread: { id: "x", status: { type: "active" } } });
    await expect(old).rejects.toThrow(/连接/);
    expect((await index.summaries({ threadIds: ["x"], includeRunning: false })).data[0].status.type).toBe("idle");
  });

  it("读取期间的新状态事件触发重核对，失败读取不污染下一轮", async () => {
    let done!: (value: any) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { done = resolve; }))
      .mockResolvedValue({ thread: { id: "x", status: { type: "idle" } } });
    const index = new SidebarSummaryIndex(request); index.setEpoch("one");
    const pending = index.summaries({ threadIds: ["x"], includeRunning: false });
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    index.observe({ method: "thread/status/changed", params: { threadId: "x", status: { type: "idle" } } });
    done({ thread: { id: "x", status: { type: "active" } } });
    expect((await pending).data[0].status.type).toBe("idle");
    index.observe({ method: "thread/name/updated", params: { threadId: "x" } });
    request.mockRejectedValueOnce(new Error("network"));
    await expect(index.summaries({ threadIds: ["x"], includeRunning: false })).rejects.toThrow("network");
    expect((await index.summaries({ threadIds: ["x"], includeRunning: false })).data[0].id).toBe("x");
  });

  it("更多沿游标保序但重新过滤变化记录，过期和重连游标不能复用", async () => {
    const f = fixture(), params = { threadIds: [...f.records.keys()] };
    const first = await f.index.projectless(params);
    (f.records.get("6") as any).archived = true;
    f.index.observe({ method: "thread/archived", params: { threadId: "6" } });
    expect((await f.index.projectless({ ...params, cursor: first.nextCursor })).data.map(t => t.id)).toEqual(["5", "4", "3", "2", "1"]);
    vi.useFakeTimers(); vi.advanceTimersByTime(61_000);
    await expect(f.index.projectless({ ...params, cursor: first.nextCursor })).rejects.toThrow(/分页/);
    vi.useRealTimers();
    const latest = await f.index.projectless(params); f.index.setEpoch("two");
    await expect(f.index.projectless({ ...params, cursor: latest.nextCursor })).rejects.toThrow(/分页/);
  });
});
