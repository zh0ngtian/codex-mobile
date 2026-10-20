import { describe, expect, it, vi } from "vitest";
import { AppServerRpcError } from "../../src/app-server/client";
import {
  createLatestThreadListLoader,
  dedupeThreadsById,
  mergeThreadListPage,
  loadProjectlessThreadRecords,
  loadProjectThreadRecords,
  nextProjectThreadLimit,
  PROJECTLESS_GROUP_ID,
} from "../../src/app-server/thread-list-loader";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("会话列表轮询加载器", () => {
  it("全部折叠只更新摘要，不预取普通项目和无项目首批；显式展开再取五条", async () => {
    const request = vi.fn(async (method: string, params: any): Promise<any> => method === "mobile/sidebar/summaries"
      ? { data: [{ id: "running", cwd: "/a", status: { type: "active" } }] }
      : { data: Array.from({ length: 5 }, (_, i) => ({ id: `row-${i}` })), nextCursor: "more" });
    const client = { sidebarIndex: true, request }, onProjectData = vi.fn(), onPinnedData = vi.fn(), onSettled = vi.fn();
    const loader = createLatestThreadListLoader({ onProjectData, onPinnedData, onSettled });
    await loader.load(client, ["/a", "/b"], ["n"], { expandedProjectCwds: [], includeRunningThreads: true });
    expect(request.mock.calls.map(([m]) => m)).toEqual(["mobile/sidebar/summaries"]);
    expect(onProjectData).not.toHaveBeenCalled(); expect(onPinnedData).toHaveBeenCalled(); expect(onSettled).toHaveBeenCalledOnce();
    await loader.loadProject(client, "/a");
    expect(request.mock.calls.at(-1)).toMatchObject(["thread/list", { cwd: "/a", limit: 5 }]);
    await loader.loadProjectless(client, ["n"]);
    expect(request.mock.calls.at(-1)?.[0]).toBe("mobile/sidebar/projectless");
  });

  it("自动刷新仅拉展开的分组，含无项目，不改变目录顺序", async () => {
    const request = vi.fn(async () => ({ data: [], nextCursor: null }));
    await createLatestThreadListLoader({}).load({ request, sidebarIndex: true }, ["/a", "/b", "/c"], ["n"], {
      expandedProjectCwds: ["/b", PROJECTLESS_GROUP_ID], includeRunningThreads: true,
    });
    expect(request.mock.calls.filter(([method]: any) => method === "thread/list").map(([, params]: any) => params.cwd)).toEqual(["/b"]);
    expect(request.mock.calls.filter(([method]: any) => method === "mobile/sidebar/projectless")).toHaveLength(1);
  });
  it("批量摘要失败仍等待项目任务收尾，不提前解除整轮在途状态", async () => {
    const project = deferred<any>(), onSettled = vi.fn();
    const client = { sidebarIndex: true, request: vi.fn((method: string) => method === "thread/list"
      ? project.promise : Promise.reject(new Error("摘要失败"))) };
    let ended = false;
    const pending = createLatestThreadListLoader({ onSettled }).load(client, ["/a"], [], { includeRunningThreads: true })
      .catch(error => { ended = true; return error; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(ended).toBe(false);
    project.resolve({ data: [], nextCursor: null });
    expect(await pending).toEqual(new Error("摘要失败"));
    expect(onSettled).not.toHaveBeenCalled();
  });
  it("真实网关客户端以批量摘要和五条游标分页替代逐条读取", async () => {
    const request = vi.fn(async (method: string, params: any): Promise<any> => {
      if (method === "thread/list") return { data: [{ id: "project" }], nextCursor: null };
      if (method === "mobile/sidebar/summaries") return { data: [{ id: "running", status: { type: "active" } }] };
      if (method === "mobile/sidebar/projectless") return { data: Array.from({ length: 5 }, (_, i) => ({ id: `${params.cursor ? "next" : "first"}-${i}` })), nextCursor: params.cursor ? null : "next" };
      throw new Error("不应逐条扫描");
    });
    const client = { sidebarIndex: true, request }, onProjectData = vi.fn(), onPinnedData = vi.fn();
    await createLatestThreadListLoader({ onProjectData, onPinnedData }).load(client, ["/a"], ["known"], { includeRunningThreads: true });
    expect(onPinnedData).toHaveBeenCalledWith([{ id: "running", status: { type: "active" } }]);
    expect(onProjectData).toHaveBeenCalledWith(PROJECTLESS_GROUP_ID, expect.any(Array), true, "next");
    const more = await loadProjectlessThreadRecords(client, ["known"], 10, new Set(), new Set(), "next");
    expect(more.threads).toHaveLength(5); expect(more.hasMore).toBe(false);
    expect(request.mock.calls.map(([m]) => m)).toEqual(["thread/list", "mobile/sidebar/projectless", "mobile/sidebar/summaries", "mobile/sidebar/projectless"]);
  });
  it("旧运行摘要变为空闲时仍更新状态，但不再从五条分页中排除", async () => {
    const records = [{ id: "ended", status: { type: "idle" } }, ...Array.from({ length: 4 }, (_, i) => ({ id: `row-${i}` }))];
    const onPinnedData = vi.fn(), onProjectData = vi.fn();
    const request = vi.fn(async (method: string) => method === "thread/read"
      ? { thread: records[0] } : { data: records, nextCursor: null });
    await createLatestThreadListLoader({ onPinnedData, onProjectData }).load({ request }, ["/a"], [], { rememberedRunningThreadIds: ["ended"] });
    expect(onPinnedData).toHaveBeenCalledWith([records[0]]);
    expect(onProjectData).toHaveBeenCalledWith("/a", records, false, null);
  });
  it("运行中的旧未读占五条名额，手动关注和无项目仍从项目页排除", async () => {
    const records = [
      { id: "running-unread", status: { type: "active" } },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `regular-${i}` })),
    ];
    const request = vi.fn(async () => ({ data: records.slice(0, 5), nextCursor: "5" }));
    const result = await loadProjectThreadRecords({ request }, "/a", null, new Set(["running-unread"]), new Set());
    expect(result.threads).toEqual(records.slice(0, 5));
    expect(request).toHaveBeenCalledOnce();
    const loose = { request: vi.fn(async (_method: string, params: any) => ({ thread: records.find(t => t.id === params.threadId) })) };
    expect((await loadProjectlessThreadRecords(loose, records.map(t => t.id), 5, new Set(["running-unread"]), new Set())).threads)
      .toHaveLength(5);
  });
  it("展开项目跳过空闲未读补足五条时，后续游标请求仍走可见后台通道", async () => {
    const records = [{ id: "unread" },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `regular-${i}` }))];
    const request = vi.fn(async (method: string, params: any, _options?: { priority?: string }) => {
      if (method === "thread/read") return { thread: { id: params.threadId } };
      const offset = Number(params.cursor ?? 0), end = offset + params.limit;
      return { data: records.slice(offset, end), nextCursor: end < records.length ? String(end) : null };
    });
    await createLatestThreadListLoader({}).load({ request }, ["/collapsed", "/visible"], [], { preferredProjectCwds: ["/visible"], prioritizedThreadIds: ["unread"] });
    const visible = request.mock.calls.filter(([, params]) => params.cwd === "/visible");
    expect(visible).toHaveLength(2);
    expect(visible.every(([, , options]) => options?.priority === "background-visible")).toBe(true);
    expect(request.mock.calls.filter(([, params]) => params.cwd === "/collapsed").every(([, , options]) => options?.priority === "background")).toBe(true);
  });

  it("新连接尚在读取目录时立即隔离旧连接分页与摘要", async () => {
    const page = deferred<{ data: { id: string }[]; nextCursor: null }>();
    const discovery = deferred<{ data: string[]; nextCursor: null }>();
    const request = vi.fn((method: string) => method === "thread/list" ? page.promise : discovery.promise);
    const onProjectData = vi.fn(), onPinnedData = vi.fn(), onSettled = vi.fn();
    const loader = createLatestThreadListLoader({ onProjectData, onPinnedData, onSettled });
    const pending = loader.load({ request }, ["/old"], [], { includeRunningThreads: true });
    loader.invalidate();
    page.resolve({ data: [{ id: "old" }], nextCursor: null });
    discovery.resolve({ data: ["old"], nextCursor: null });
    await pending;
    expect(onProjectData).not.toHaveBeenCalled();
    expect(onPinnedData).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
    expect(request.mock.calls).toHaveLength(2);
  });

  it("运行摘要发现挂起时仍提交项目首批，页内运行会话计入首批五条", async () => {
    const discovery = deferred<{ data: string[]; nextCursor: null }>();
    const records = [{ id: "running", status: { type: "active" } },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `regular-${i}` }))];
    const client = { request: vi.fn(async (method: string, params: any) => {
      if (method === "thread/loaded/list") return discovery.promise;
      if (method === "thread/read") return { thread: records[0] };
      const offset = Number(params.cursor ?? 0), end = offset + params.limit;
      return { data: records.slice(offset, end), nextCursor: end < records.length ? String(end) : null };
    }) };
    const onProjectData = vi.fn(), onSettled = vi.fn();
    const pending = createLatestThreadListLoader({ onProjectData, onSettled })
      .load(client, ["/a"], [], { includeRunningThreads: true });
    await vi.waitFor(() => expect(onProjectData).toHaveBeenCalled());
    expect(onProjectData).toHaveBeenLastCalledWith("/a", records.slice(0, 5), true, "5");
    expect(onSettled).not.toHaveBeenCalled();
    discovery.resolve({ data: ["running"], nextCursor: null });
    await pending;
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("慢优先摘要不挡住其他摘要与普通项目，展开项目先入队且不改变目录展示顺序", async () => {
    const slow = deferred<{ thread: { id: string } }>();
    const onPinnedData = vi.fn(), onProjectData = vi.fn();
    const request = vi.fn(async (method: string, params: any) => method === "thread/read"
      ? params.threadId === "slow" ? slow.promise : { thread: { id: params.threadId } }
      : { data: [{ id: `${params.cwd}-recent` }], nextCursor: null });
    const pending = createLatestThreadListLoader({ onPinnedData, onProjectData }).load(
      { request }, ["/collapsed", "/expanded"], [],
      { pinnedThreadIds: ["slow", "fast"], preferredProjectCwds: ["/expanded"] },
    );
    await vi.waitFor(() => expect(onProjectData).toHaveBeenCalledTimes(2));
    expect(request.mock.calls.filter(([method]) => method === "thread/list").map(([, params]) => params.cwd))
      .toEqual(["/expanded", "/collapsed"]);
    expect(onPinnedData).toHaveBeenCalledWith([{ id: "fast" }]);
    slow.resolve({ thread: { id: "slow" } });
    await pending;
    expect(onPinnedData).toHaveBeenLastCalledWith(expect.arrayContaining([{ id: "slow" }, { id: "fast" }]));
  });

  it("无项目与运行发现共用同轮摘要，运行记录计入五条且新一轮重新读取", async () => {
    const records = [{ id: "running", status: { type: "active" }, updatedAt: 99 },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `regular-${i}`, updatedAt: 90 - i }))];
    const request = vi.fn(async (method: string, params: any) => method === "thread/loaded/list"
      ? { data: ["running"], nextCursor: null }
      : { thread: records.find((thread) => thread.id === params.threadId) });
    const onProjectData = vi.fn();
    const loader = createLatestThreadListLoader({ onProjectData });
    const load = () => loader.load({ request }, [], records.map(thread => thread.id), { includeRunningThreads: true });
    await load();
    expect(onProjectData).toHaveBeenLastCalledWith(PROJECTLESS_GROUP_ID,
      records.slice(0, 5).map(thread => ({ ...thread, isProjectless: true })), true, null);
    expect(request.mock.calls.filter(([method, params]) => method === "thread/read" && params.threadId === "running")).toHaveLength(1);
    await load();
    expect(request.mock.calls.filter(([method, params]) => method === "thread/read" && params.threadId === "running")).toHaveLength(2);
  });

  it("自动刷新摘要与项目均让出前台通道，手动加载项目仍使用前台", async () => {
    const request = vi.fn(async (method: string, _params: unknown, _options?: { priority?: string }) => method === "thread/loaded/list"
      ? { data: ["running"], nextCursor: null }
      : method === "thread/read"
        ? { thread: { id: "running", status: { type: "active" } } }
        : { data: [], nextCursor: null });
    const client = { request };
    const loader = createLatestThreadListLoader({});
    await loader.load(client, ["/project"], ["loose"], { includeRunningThreads: true });
    expect(request.mock.calls.length).toBeGreaterThan(3);
    expect(request.mock.calls.every((call) => call[2]?.priority === "background")).toBe(true);
    request.mockClear();
    await loader.loadProject(client, "/project");
    expect(request.mock.calls.every((call) => call[2] === undefined)).toBe(true);
  });

  it("运行中补取和显式置顶不会重新带出子 Agent", async () => {
    const records: Record<string, any> = {
      child: { id: "child", source: { subAgent: "review" }, status: { type: "active" } },
      temporary: { id: "temporary", ephemeral: true },
      main: { id: "main", source: "vscode", status: { type: "active" } },
    };
    const client = { request: vi.fn(async (method: string, params: any) => {
      if (method === "thread/loaded/list") return { data: ["child", "main"], nextCursor: null };
      if (method === "thread/read") return { thread: records[params.threadId] };
      return { data: Object.values(records), nextCursor: null };
    }) };
    const onPinnedData = vi.fn();
    const onData = vi.fn();
    await createLatestThreadListLoader({ onPinnedData, onData }).load(client, [], [], {
      pinnedThreadIds: ["child", "temporary"], includeRunningThreads: true,
    });
    expect(onPinnedData).toHaveBeenCalledWith([records.main]);
    expect(onData).toHaveBeenCalledWith([records.main]);
  });

  it("项目分页过滤子 Agent 后继续补足五条，不需要显式排除 ID", async () => {
    const records = [
      { id: "child", parentThreadId: "main" },
      { id: "internal", ephemeral: true },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `regular-${i}` })),
    ];
    const client = { request: vi.fn(async (method: string, params: any) => {
      if (method === "thread/read") return { thread: records.find((thread) => thread.id === params.threadId) };
      const offset = Number(params.cursor ?? 0);
      const end = offset + params.limit;
      return { data: records.slice(offset, end), nextCursor: end < records.length ? String(end) : null };
    }) };
    const result = await loadProjectThreadRecords(client, "/a");
    expect(result.threads.map((thread) => thread.id)).toEqual(Array.from({ length: 5 }, (_, i) => `regular-${i}`));
    expect(result.nextCursor).toBe("7");
    expect(result.hasMore).toBe(true);
    const projectless = await loadProjectlessThreadRecords(client, records.map((thread) => thread.id), 5);
    expect(projectless.threads.map((thread) => thread.id)).toEqual(Array.from({ length: 5 }, (_, i) => `regular-${i}`));
  });

  it("刷新保留和去重不会因稀疏的新摘要丢失同批子会话分类", () => {
    const child = { id: "child", parentThreadId: "main", status: { type: "active" }, updatedAt: 1 };
    expect(dedupeThreadsById([child, { id: "child", updatedAt: 2 }, { id: "main" }]))
      .toEqual([{ id: "main" }]);
    expect(mergeThreadListPage([child], [{ id: "main" }], new Set(["child"])))
      .toEqual([{ id: "main" }]);
  });

  it("同批更新尚未同步置顶 ID 时，普通分页仍保留主动和被动置顶，并采用最新结束状态", () => {
    const current = [
      { id: "manual", isPinned: true }, { id: "unread", isUnread: true },
      { id: "running", status: { type: "active" } }, { id: "older" },
    ];
    const incoming = [{ id: "recent" }];
    expect(mergeThreadListPage(current, incoming, new Set()).map((thread) => thread.id))
      .toEqual(["recent", "manual", "unread", "running"]);
    expect(mergeThreadListPage(current, [{ id: "running", status: { type: "idle" } }], new Set())
      .find((thread) => thread.id === "running")?.status).toEqual({ type: "idle" });
  });

  it("主动置顶、未读和全部运行中摘要独立加载，不受项目五条限制", async () => {
    const records = ["manual", "unread", "running", ...Array.from({ length: 5 }, (_, i) => `regular-${i}`)]
      .map((id) => ({ id, cwd: "/a", status: { type: id === "running" ? "active" : "idle" } }));
    const client = { request: vi.fn(async (method: string, params: any) => {
      if (method === "thread/loaded/list") return params.cursor
        ? { data: ["running", "idle", "missing"], nextCursor: null }
        : { data: ["manual"], nextCursor: "next" };
      if (method === "thread/read") {
        if (params.threadId === "missing") throw new Error("unavailable");
        return { thread: { ...(records.find((thread) => thread.id === params.threadId) ?? { id: "idle", status: { type: "idle" } }), turns: [] } };
      }
      const offset = Number(params.cursor ?? 0);
      const end = offset + params.limit;
      return { data: records.slice(offset, end), nextCursor: end < records.length ? String(end) : null };
    }) };
    const onPinnedData = vi.fn();
    const onProjectData = vi.fn();
    const loader = createLatestThreadListLoader({ onPinnedData, onProjectData });
    await loader.load(client, ["/a"], ["unread"], {
      pinnedThreadIds: ["manual"], prioritizedThreadIds: ["unread", "manual"], includeRunningThreads: true,
    });
    expect(onPinnedData).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: "manual" }),
      expect.objectContaining({ id: "unread", isProjectless: true }),
      expect.objectContaining({ id: "running", status: { type: "active" } }),
    ]));
    expect(onPinnedData.mock.calls.at(-1)![0]).toHaveLength(3);
    expect(onPinnedData.mock.calls.every(([data]) => data.every((thread: any) => !("turns" in thread)))).toBe(true);
    expect(client.request.mock.calls.filter(([method, params]) => method === "thread/read" && params.threadId === "manual")).toHaveLength(1);
    expect(client.request).toHaveBeenCalledWith("thread/loaded/list", { limit: 100, cursor: "next" }, { priority: "background" });
    expect(onProjectData).toHaveBeenCalledWith("/a", records.slice(2, 7), true, "7");
  });

  it("已加载列表不可用时仍补取本机未读和主动置顶", async () => {
    const client = { request: vi.fn(async (method: string, params: any) => {
      if (method === "thread/loaded/list") throw new Error("unsupported");
      if (method === "thread/read") return { thread: { id: params.threadId } };
      return { data: [], nextCursor: null };
    }) };
    const onPinnedData = vi.fn();
    await createLatestThreadListLoader({ onPinnedData }).load(client, [], [], {
      pinnedThreadIds: ["manual"], prioritizedThreadIds: ["unread"], includeRunningThreads: true,
    });
    expect(onPinnedData).toHaveBeenCalledWith([{ id: "manual" }, { id: "unread" }]);
  });

  it("旧客户端被动置顶摘要迟到不会覆盖新客户端或继续触发旧项目请求", async () => {
    const oldRead = deferred<{ thread: { id: string; status: { type: string } } }>();
    const oldClient = { request: vi.fn((method: string) => method === "thread/loaded/list"
      ? Promise.resolve({ data: ["old"], nextCursor: null })
      : method === "thread/read" ? oldRead.promise : Promise.resolve({ data: [], nextCursor: null })) };
    const newClient = { request: vi.fn(async (method: string) => method === "thread/loaded/list"
      ? { data: ["new"], nextCursor: null }
      : method === "thread/read" ? { thread: { id: "new", status: { type: "active" } } }
      : { data: [], nextCursor: null }) };
    const onPinnedData = vi.fn();
    const loader = createLatestThreadListLoader({ onPinnedData });
    const oldLoad = loader.load(oldClient, ["/old"], [], { includeRunningThreads: true });
    await loader.load(newClient, ["/new"], [], { includeRunningThreads: true });
    const oldCalls = oldClient.request.mock.calls.length;
    oldRead.resolve({ thread: { id: "old", status: { type: "active" } } });
    await oldLoad;
    expect(onPinnedData).toHaveBeenCalledOnce();
    expect(onPinnedData).toHaveBeenCalledWith([{ id: "new", status: { type: "active" } }]);
    expect(oldClient.request.mock.calls.length).toBe(oldCalls);
  });

  it("每项目跳过置顶和无项目记录，补足五条普通对话并保留下一批游标", async () => {
    const records = ["pin-a", "pin-b", "projectless", ...Array.from({ length: 10 }, (_, i) => `regular-${i}`)]
      .map((id, i) => ({ id, updatedAt: 100 - i }));
    const client = { request: vi.fn(async (_method: string, params: any) => {
      const offset = Number(params.cursor ?? 0);
      const end = offset + params.limit;
      return { data: records.slice(offset, end), nextCursor: end < records.length ? String(end) : null };
    }) };
    const excluded = new Set(["pin-a", "pin-b", "projectless"]);
    const first = await loadProjectThreadRecords(client, "/a", null, excluded);
    expect(first.threads.map((thread) => thread.id)).toEqual(Array.from({ length: 5 }, (_, i) => `regular-${i}`));
    expect(first.nextCursor).toBe("8");
    expect(first.hasMore).toBe(true);
    const second = await loadProjectThreadRecords(client, "/a", first.nextCursor, excluded);
    expect(second.threads.map((thread) => thread.id)).toEqual(Array.from({ length: 5 }, (_, i) => `regular-${i + 5}`));
    expect(second.hasMore).toBe(false);
  });

  it("整页置顶继续补取，历史不足五条普通对话时返回实际数量", async () => {
    const client = { request: vi.fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 5 }, (_, i) => ({ id: `pin-${i}` })), nextCursor: "older" })
      .mockResolvedValueOnce({ data: [{ id: "ordinary" }], nextCursor: null }) };
    const result = await loadProjectThreadRecords(client, "/a", null, new Set(Array.from({ length: 5 }, (_, i) => `pin-${i}`)));
    expect(result).toEqual({ threads: [{ id: "ordinary" }], hasMore: false, nextCursor: null });
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it("重复游标的全置顶页停止补取", async () => {
    const client = { request: vi.fn().mockResolvedValue({ data: [{ id: "pin" }], nextCursor: "repeat" }) };
    expect(await loadProjectThreadRecords(client, "/a", "repeat", new Set(["pin"])))
      .toEqual({ threads: [], hasMore: false, nextCursor: null });
    expect(client.request).toHaveBeenCalledOnce();
  });

  it("无项目置顶不占普通对话目标数量", async () => {
    const records = ["pin", ...Array.from({ length: 6 }, (_, i) => `regular-${i}`)].map((id, i) => ({ id, updatedAt: 100 - i }));
    const client = { request: vi.fn(async (_method: string, params: any) => ({ thread: records.find((thread) => thread.id === params.threadId) })) };
    const result = await loadProjectlessThreadRecords(client, records.map((thread) => thread.id), 5, new Set(["pin"]));
    expect(result.threads.map((thread) => thread.id)).toEqual(Array.from({ length: 5 }, (_, i) => `regular-${i}`));
    expect(result.hasMore).toBe(true);
    expect(client.request.mock.calls.some(([, params]) => params.threadId === "pin")).toBe(false);
    const pinsOnly = { request: vi.fn() };
    expect(await loadProjectlessThreadRecords(pinsOnly, ["pin"], 5, new Set(["pin"])))
      .toEqual({ threads: [], hasMore: false });
    expect(pinsOnly.request).not.toHaveBeenCalled();
  });

  it("初始加载和项目重试均跳过置顶，置顶摘要完整独立提交", async () => {
    const regular = Array.from({ length: 5 }, (_, i) => ({ id: `regular-${i}`, updatedAt: 10 - i }));
    const records = [{ id: "pin", updatedAt: 20 }, ...regular];
    const client = { request: vi.fn(async (method: string, params: any) => {
      if (method === "thread/read") return { thread: { id: params.threadId } };
      const offset = Number(params.cursor ?? 0);
      const end = offset + params.limit;
      return { data: records.slice(offset, end), nextCursor: end < records.length ? String(end) : null };
    }) };
    const onProjectData = vi.fn();
    const onPinnedData = vi.fn();
    const loader = createLatestThreadListLoader({ onProjectData, onPinnedData });
    await loader.load(client, ["/a"], [], { pinnedThreadIds: ["pin", "old-pin"] });
    expect(onProjectData).toHaveBeenLastCalledWith("/a", regular, false, null);
    expect(onPinnedData).toHaveBeenCalledWith([{ id: "pin" }, { id: "old-pin" }]);
    await loader.loadProject(client, "/a");
    expect(onProjectData).toHaveBeenLastCalledWith("/a", regular, false, null);
  });

  it("只有无项目分组时仍只提交五条普通对话，避免全局列表覆盖分页", async () => {
    const records = ["pin", ...Array.from({ length: 6 }, (_, i) => `regular-${i}`)]
      .map((id, i) => ({ id, updatedAt: 100 - i }));
    const client = { request: vi.fn(async (method: string, params: any) =>
      method === "thread/read" ? { thread: records.find((thread) => thread.id === params.threadId) } : { data: records, nextCursor: null }) };
    const onData = vi.fn();
    const onProjectData = vi.fn();
    const onPinnedData = vi.fn();
    await createLatestThreadListLoader({ onData, onProjectData, onPinnedData })
      .load(client, [], records.map((thread) => thread.id), { pinnedThreadIds: ["pin"] });
    expect(onData).not.toHaveBeenCalled();
    expect(onProjectData).toHaveBeenCalledWith(PROJECTLESS_GROUP_ID,
      records.slice(1, 6).map((thread) => ({ ...thread, isProjectless: true })), true, null);
    expect(onPinnedData).toHaveBeenCalledWith([{ ...records[0], isProjectless: true }]);
  });

  it("最近五条之外的置顶对话独立补取摘要并恢复无项目标记", async () => {
    const recent = Array.from({ length: 5 }, (_, index) => ({ id: `recent-${index}`, cwd: "/project/a" }));
    const client = {
      request: vi.fn(async (method: string, params: any) => {
        if (method === "thread/list") return { data: recent, nextCursor: "older" };
        return { thread: { id: params.threadId, cwd: "/project/a", turns: [{ id: "unused-history" }] } };
      }),
    };
    const onProjectData = vi.fn();
    const onPinnedData = vi.fn();
    const loader = createLatestThreadListLoader({ onProjectData, onPinnedData });
    await loader.load(client, ["/project/a"], ["old-pin"], { pinnedThreadIds: ["old-pin", "old-pin"] });
    expect(client.request).toHaveBeenCalledWith("thread/read", { threadId: "old-pin", includeTurns: false }, { priority: "background" });
    expect(client.request.mock.calls.filter(([method]) => method === "thread/read")).toHaveLength(1);
    expect(onPinnedData).toHaveBeenCalledWith([{ id: "old-pin", cwd: "/project/a", isProjectless: true }]);
    expect(onProjectData).toHaveBeenCalledWith("/project/a", recent, true, "older");
  });

  it("单条置顶读取失败不阻塞其他置顶和最近列表", async () => {
    const onPinnedData = vi.fn();
    const onData = vi.fn();
    const client = {
      request: vi.fn(async (method: string, params: any) => {
        if (method === "thread/list") return { data: [{ id: "recent" }] };
        if (params.threadId === "missing") throw new Error("not found");
        return { thread: { id: params.threadId } };
      }),
    };
    await createLatestThreadListLoader({ onData, onPinnedData }).load(client, [], [], { pinnedThreadIds: ["missing", "available"] });
    expect(onData).toHaveBeenCalledWith([{ id: "recent" }]);
    expect(onPinnedData).toHaveBeenCalledWith([{ id: "available" }]);
  });

  it("忽略旧客户端迟到的置顶摘要", async () => {
    const oldPinned = deferred<{ thread: { id: string } }>();
    const oldClient = { request: vi.fn((method: string) => method === "thread/read" ? oldPinned.promise : Promise.resolve({ data: [] })) };
    const newClient = { request: vi.fn(async (method: string) => method === "thread/read" ? { thread: { id: "new-pin" } } : { data: [] }) };
    const onPinnedData = vi.fn();
    const loader = createLatestThreadListLoader({ onPinnedData });
    const oldLoad = loader.load(oldClient, [], [], { pinnedThreadIds: ["old-pin"] });
    await loader.load(newClient, [], [], { pinnedThreadIds: ["new-pin"] });
    oldPinned.resolve({ thread: { id: "old-pin" } });
    await oldLoad;
    expect(onPinnedData).toHaveBeenCalledTimes(1);
    expect(onPinnedData).toHaveBeenCalledWith([{ id: "new-pin" }]);
  });

  it("列表刷新保留分页之外的置顶对话且不重复或保留已取消置顶的旧记录", () => {
    const current = [{ id: "old-pin", updatedAt: 1 }, { id: "recent", updatedAt: 1 }, { id: "unpinned" }];
    const incoming = [{ id: "recent", updatedAt: 2 }];
    expect(mergeThreadListPage(current, incoming, new Set(["old-pin", "recent"]))).toEqual([
      { id: "recent", updatedAt: 2 }, { id: "old-pin", updatedAt: 1 },
    ]);
    expect(mergeThreadListPage(incoming, current.slice(0, 1), new Set(["recent"]))).toEqual([
      { id: "recent", updatedAt: 2 }, { id: "old-pin", updatedAt: 1 },
    ]);
  });

  it("查看旧会话只更新元数据时间，不超过最近开始任务的会话", () => {
    expect(
      dedupeThreadsById([
        {
          id: "opened-history",
          recencyAt: 10,
          updatedAt: 100,
        },
        {
          id: "recent-activity",
          recencyAt: 20,
          updatedAt: 20,
        },
      ]),
    ).toEqual([
      { id: "recent-activity", recencyAt: 20, updatedAt: 20 },
      { id: "opened-history", recencyAt: 10, updatedAt: 100 },
    ]);
  });

  it("按逻辑 thread id 合并续接日志并保留更新时间最新的记录", () => {
    expect(
      dedupeThreadsById([
        {
          id: "continued-thread",
          path: "/sessions/original.jsonl",
          recencyAt: 25,
          updatedAt: 10,
        },
        {
          id: "other-thread",
          path: "/sessions/other.jsonl",
          updatedAt: 20,
        },
        {
          id: "continued-thread",
          path: "/sessions/continued.jsonl",
          recencyAt: 25,
          updatedAt: 30,
        },
      ]),
    ).toEqual([
      {
        id: "continued-thread",
        path: "/sessions/continued.jsonl",
        recencyAt: 25,
        updatedAt: 30,
      },
      {
        id: "other-thread",
        path: "/sessions/other.jsonl",
        updatedAt: 20,
      },
    ]);
  });

  it("项目历史每次只读取 5 条，不沿 nextCursor 加载剩余全部", async () => {
    const client = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            { id: "same", updatedAt: 30 },
            { id: "first-page", updatedAt: 20 },
            { id: "same", updatedAt: 10 },
          ],
          nextCursor: "older-page",
        }),
    };

    await expect(
      loadProjectThreadRecords(client, "/project/a", "current-page"),
    ).resolves.toEqual({
      threads: [
        { id: "same", updatedAt: 30 },
        { id: "first-page", updatedAt: 20 },
      ],
      hasMore: true,
      nextCursor: "older-page",
    });
    expect(client.request).toHaveBeenCalledOnce();
    expect(client.request).toHaveBeenCalledWith("thread/list", {
      limit: 5,
      cwd: "/project/a",
      sortKey: "recency_at",
      cursor: "current-page",
    });
  });

  it("每次把项目会话目标数量增加 5 条", () => {
    expect(nextProjectThreadLimit(0)).toBe(5);
    expect(nextProjectThreadLimit(5)).toBe(10);
    expect(nextProjectThreadLimit(10)).toBe(15);
  });

  it("无项目只核对去重后的已知摘要，乱序 ID 按任务时间返回前五条和前十条", async () => {
    const records = Array.from({ length: 12 }, (_, index) => ({
      id: `recent-${index}`, recencyAt: 100 - index, updatedAt: index,
      turns: [{ id: "must-not-be-returned" }],
    }));
    const ids = [9, 5, 2, 11, 0, 4, 7, 1, 6, 3, 10, 8, 9].map((index) => records[index].id);
    const request = vi.fn(async (method: string, params: any) => {
      if (method !== "thread/read") throw new Error("不得扫描全局会话");
      return { thread: records.find((thread) => thread.id === params.threadId) };
    });
    const expected = records.map(({ turns: _turns, ...thread }) => ({ ...thread, isProjectless: true }));
    expect(await loadProjectlessThreadRecords({ request }, ids, 5))
      .toEqual({ threads: expected.slice(0, 5), hasMore: true });
    expect(request).toHaveBeenCalledTimes(12);
    expect(request.mock.calls.every(([method, params]) => method === "thread/read" &&
      params.includeTurns === false && Object.keys(params).length === 2)).toBe(true);
    request.mockClear();
    expect(await loadProjectlessThreadRecords({ request }, ids, 10))
      .toEqual({ threads: expected.slice(0, 10), hasMore: true });
    expect(request).toHaveBeenCalledTimes(12);
    expect(await loadProjectlessThreadRecords({ request }, ids, 15))
      .toEqual({ threads: expected, hasMore: false });
  });

  it("无项目排序回退更新时间和创建时间，同一时间按 ID 稳定排序并保留零任务时间", async () => {
    const records = [
      { id: "tie-b", recencyAt: 10 }, { id: "zero", recencyAt: 0, updatedAt: 100 },
      { id: "created", createdAt: 20 }, { id: "tie-a", recencyAt: 10 },
      { id: "updated", recencyAt: null, updatedAt: 30 },
    ];
    const client = { request: vi.fn(async (_method: string, params: any) => ({ thread: records.find((thread) => thread.id === params.threadId) })) };
    const result = await loadProjectlessThreadRecords(client, records.map((thread) => thread.id), 5);
    expect(result.threads.map((thread) => thread.id)).toEqual(["updated", "created", "tie-a", "tie-b", "zero"]);
    expect(result.hasMore).toBe(false);
  });

  it("无项目过滤明确归档、归档路径和辅助会话，剩余有效摘要决定是否还有更多", async () => {
    const records = [
      { id: "archived-flag", archived: true },
      { id: "archived-unix", path: "/home/.codex/archived_sessions/rollout.jsonl" },
      { id: "archived-windows", path: "C:\\Users\\me\\.codex\\archived_sessions\\rollout.jsonl" },
      { id: "child", parentThreadId: "main" },
      { id: "temporary", ephemeral: true },
      { id: "review", source: { subAgent: "review" } },
      { id: "main", archived: false, path: "/home/.codex/sessions/rollout.jsonl", updatedAt: 20 },
      { id: "older", updatedAt: 10 },
    ];
    const client = { request: vi.fn(async (_method: string, params: any) => ({ thread: params.threadId === "mismatched"
      ? { id: "unrelated", updatedAt: 100 } : records.find((thread) => thread.id === params.threadId) })) };
    const result = await loadProjectlessThreadRecords(client, [...records.map((thread) => thread.id), "mismatched"], 5);
    expect(result).toEqual({ threads: records.slice(-2).map((thread) => ({ ...thread, isProjectless: true })), hasMore: false });
    expect(client.request.mock.calls.every(([method, params]) => method === "thread/read" && params.includeTurns === false)).toBe(true);
  });

  it.each([
    new Error("network unavailable"),
    new AppServerRpcError("access denied", -32000),
    new AppServerRpcError("thread not loaded: another-id", -32600),
    new AppServerRpcError("thread not loaded: unloaded", -32000),
    new AppServerRpcError("cannot read thread: unloaded", -32600),
    new Error("thread not loaded: unloaded"),
  ])("无项目非确定缺失的读取错误原样上抛：%s", async (failure) => {
    const client = { request: vi.fn(async () => { throw failure; }) };
    await expect(loadProjectlessThreadRecords(client, ["unloaded"], 5)).rejects.toBe(failure);
    expect(client.request).toHaveBeenCalledOnce();
    expect(client.request).toHaveBeenCalledWith("thread/read", { threadId: "unloaded", includeTurns: false });
  });

  it("无项目精确跳过上游已不可读取的遗留 ID，未 loaded 的持久化摘要仍保留", async () => {
    const request = vi.fn(async (_method: string, params: any) => {
      if (params.threadId === "missing") throw new AppServerRpcError("thread not loaded: missing", -32600);
      return { thread: { id: params.threadId, updatedAt: 10, turns: [] } };
    });
    expect(await loadProjectlessThreadRecords({ request }, ["missing", "persisted-unloaded"], 5))
      .toEqual({ threads: [{ id: "persisted-unloaded", updatedAt: 10, isProjectless: true }], hasMore: false });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([method, params]) => method === "thread/read" && params.includeTurns === false)).toBe(true);
  });

  it("无项目普通批次先排除关注和未读，独立摘要各读取一次且不占五条名额", async () => {
    const records = ["pin", "unread", ...Array.from({ length: 6 }, (_, index) => `regular-${index}`)]
      .map((id, index) => ({ id, updatedAt: 100 - index }));
    const request = vi.fn(async (_method: string, params: any) => ({ thread: records.find((thread) => thread.id === params.threadId) }));
    const onPinnedData = vi.fn();
    const onProjectData = vi.fn();
    await createLatestThreadListLoader({ onPinnedData, onProjectData })
      .load({ request }, [], records.map((thread) => thread.id), {
        pinnedThreadIds: ["pin"], prioritizedThreadIds: ["unread", "pin"],
      });
    expect(onPinnedData).toHaveBeenCalledWith(records.slice(0, 2).map((thread) => ({ ...thread, isProjectless: true })));
    expect(onProjectData).toHaveBeenCalledWith(PROJECTLESS_GROUP_ID,
      records.slice(2, 7).map((thread) => ({ ...thread, isProjectless: true })), true, null);
    expect(request.mock.calls.every(([method, params]) => method === "thread/read" && params.includeTurns === false)).toBe(true);
    expect(request.mock.calls.filter(([, params]) => params.threadId === "pin")).toHaveLength(1);
    expect(request.mock.calls.filter(([, params]) => params.threadId === "unread")).toHaveLength(1);
  });

  it("无项目网络失败提交现有分组错误状态，不回退全局扫描", async () => {
    const failure = new Error("network unavailable");
    const request = vi.fn(async () => { throw failure; });
    const onProjectError = vi.fn();
    const onProjectData = vi.fn();
    const onSettled = vi.fn();
    await createLatestThreadListLoader({ onProjectError, onProjectData, onSettled }).load({ request }, [], ["loose"]);
    expect(onProjectError).toHaveBeenCalledWith(PROJECTLESS_GROUP_ID, failure);
    expect(onProjectData).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledExactlyOnceWith("thread/read", { threadId: "loose", includeTurns: false }, { priority: "background" });
  });

  it("无项目目标为零或候选全被独立摘要排除时不发送请求", async () => {
    const client = { request: vi.fn() };
    expect(await loadProjectlessThreadRecords(client, ["loose"], 0)).toEqual({ threads: [], hasMore: false });
    expect(await loadProjectlessThreadRecords(client, ["pin", "unread", "pin"], 5, new Set(["pin", "unread"])))
      .toEqual({ threads: [], hasMore: false });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("无项目目标数量不超过已知会话数", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ thread: { id: "only-projectless", updatedAt: 10 } }),
    };

    await expect(
      loadProjectlessThreadRecords(client, ["only-projectless"], 5),
    ).resolves.toEqual({
      threads: [
        { id: "only-projectless", updatedAt: 10, isProjectless: true },
      ],
      hasMore: false,
    });
    expect(client.request).toHaveBeenCalledOnce();
  });

  it("按配置项目分别获取最新 5 条会话并独立提交结果", async () => {
    const projectA = deferred<{
      data: Array<{ id: string; cwd: string; updatedAt?: number }>;
      nextCursor: string | null;
    }>();
    const projectB = deferred<{
      data: Array<{ id: string; cwd: string }>;
      nextCursor: string | null;
    }>();
    const client = {
      request: vi.fn((_method: string, params: { cwd: string }) =>
        params.cwd === "/project/a" ? projectA.promise : projectB.promise,
      ),
    };
    const onProjectStart = vi.fn();
    const onProjectData = vi.fn();
    const onSettled = vi.fn();
    const loader = createLatestThreadListLoader({
      onProjectStart,
      onProjectData,
      onSettled,
    });

    const loading = loader.load(client, ["/project/a", "/project/b"]);

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.request).toHaveBeenNthCalledWith(1, "thread/list", {
      limit: 5,
      cwd: "/project/a",
      sortKey: "recency_at",
    }, { priority: "background" });
    expect(onProjectStart).toHaveBeenCalledWith("/project/a");
    expect(onProjectStart).toHaveBeenCalledWith("/project/b");

    projectB.resolve({
      data: [{ id: "thread-b", cwd: "/project/b" }],
      nextCursor: null,
    });
    await vi.waitFor(() => {
      expect(onProjectData).toHaveBeenCalledOnce();
    });

    expect(onProjectData).toHaveBeenLastCalledWith(
      "/project/b",
      [{ id: "thread-b", cwd: "/project/b" }],
      false,
      null,
    );
    expect(onSettled).not.toHaveBeenCalled();

    projectA.resolve({
      data: [
        { id: "thread-a", cwd: "/project/a", updatedAt: 20 },
        { id: "thread-a", cwd: "/project/a", updatedAt: 10 },
      ],
      nextCursor: "older-project-a",
    });
    await loading;

    expect(onProjectData).toHaveBeenLastCalledWith(
      "/project/a",
      [{ id: "thread-a", cwd: "/project/a", updatedAt: 20 }],
      true,
      "older-project-a",
    );
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("静默刷新提交最新项目数据但不发布加载状态", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [{ id: "thread-new", cwd: "/project/a" }],
        nextCursor: null,
      }),
    };
    const onProjectStart = vi.fn();
    const onProjectData = vi.fn();
    const loader = createLatestThreadListLoader({
      onProjectStart,
      onProjectData,
    });

    await loader.load(client, ["/project/a"], [], { silent: true });

    expect(client.request).toHaveBeenCalledWith("thread/list", {
      limit: 5,
      cwd: "/project/a",
      sortKey: "recency_at",
    }, { priority: "background" });
    expect(onProjectStart).not.toHaveBeenCalled();
    expect(onProjectData).toHaveBeenCalledWith(
      "/project/a",
      [{ id: "thread-new", cwd: "/project/a" }],
      false,
      null,
    );
  });

  it("读取桌面端标记的无项目会话并从项目分组排除", async () => {
    const client = {
      request: vi.fn((method: string, _params: { cwd?: string }) => {
        if (method === "thread/read") {
          return Promise.resolve({
            thread: {
              id: "projectless-thread",
              cwd: "/workspace/project",
              updatedAt: 30,
            },
          });
        }
        return Promise.resolve({
          data: [
            {
              id: "project-thread",
              cwd: "/workspace/project",
              updatedAt: 20,
            },
            {
              id: "projectless-thread",
              cwd: "/workspace/project",
              updatedAt: 30,
            },
          ],
          nextCursor: null,
        });
      }),
    };
    const onProjectData = vi.fn();
    const loader = createLatestThreadListLoader({ onProjectData });

    await loader.load(
      client,
      ["/workspace/project"],
      ["projectless-thread"],
    );

    expect(client.request).toHaveBeenCalledWith("thread/read", {
      threadId: "projectless-thread",
      includeTurns: false,
    }, { priority: "background" });
    expect(onProjectData).toHaveBeenCalledWith(
      "/workspace/project",
      [
        {
          id: "project-thread",
          cwd: "/workspace/project",
          updatedAt: 20,
        },
      ],
      false,
      null,
    );
    expect(onProjectData).toHaveBeenCalledWith(
      PROJECTLESS_GROUP_ID,
      [
        {
          id: "projectless-thread",
          cwd: "/workspace/project",
          updatedAt: 30,
          isProjectless: true,
        },
      ],
      false,
      null,
    );
  });

  it("单个项目失败不阻塞其他项目并在整轮结束后收口", async () => {
    const onProjectData = vi.fn();
    const onProjectError = vi.fn();
    const onSettled = vi.fn();
    const client = {
      request: vi.fn((_method: string, params: { cwd: string }) =>
        params.cwd === "/project/a"
          ? Promise.reject(new Error("project a failed"))
          : Promise.resolve({
              data: [{ id: "thread-b", cwd: "/project/b" }],
            }),
      ),
    };
    const loader = createLatestThreadListLoader({
      onProjectData,
      onProjectError,
      onSettled,
    });

    await expect(
      loader.load(client, ["/project/a", "/project/b"]),
    ).resolves.toBeUndefined();

    expect(onProjectError).toHaveBeenCalledWith(
      "/project/a",
      expect.objectContaining({ message: "project a failed" }),
    );
    expect(onProjectData).toHaveBeenCalledWith(
      "/project/b",
      [{ id: "thread-b", cwd: "/project/b" }],
      false,
      null,
    );
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("项目重试后忽略同一项目旧请求的迟到结果", async () => {
    const firstResult =
      deferred<{ data: Array<{ id: string; cwd: string }> }>();
    const retryResult =
      deferred<{ data: Array<{ id: string; cwd: string }> }>();
    const client = {
      request: vi
        .fn()
        .mockReturnValueOnce(firstResult.promise)
        .mockReturnValueOnce(retryResult.promise),
    };
    const onProjectData = vi.fn();
    const loader = createLatestThreadListLoader({ onProjectData });

    const first = loader.loadProject(client, "/project/a");
    const retry = loader.loadProject(client, "/project/a");
    retryResult.resolve({
      data: [{ id: "retry", cwd: "/project/a" }],
    });
    await retry;
    firstResult.resolve({
      data: [{ id: "stale", cwd: "/project/a" }],
    });
    await first;

    expect(onProjectData).toHaveBeenCalledOnce();
    expect(onProjectData).toHaveBeenCalledWith(
      "/project/a",
      [{ id: "retry", cwd: "/project/a" }],
      false,
      null,
    );
  });

  it("同一客户端的慢请求只保留一个在途请求", async () => {
    const result = deferred<{ data: Array<{ id: string }> }>();
    const client = { request: vi.fn(() => result.promise) };
    const onData = vi.fn();
    const loader = createLatestThreadListLoader({ onData });

    const first = loader.load(client);
    const second = loader.load(client);

    expect(client.request).toHaveBeenCalledOnce();
    result.resolve({ data: [{ id: "thread-1" }] });
    await Promise.all([first, second]);
    expect(onData).toHaveBeenCalledWith([{ id: "thread-1" }]);
  });

  it("忽略旧客户端晚于新客户端返回的列表", async () => {
    const oldResult = deferred<{ data: Array<{ id: string }> }>();
    const newResult = deferred<{ data: Array<{ id: string }> }>();
    const oldClient = { request: vi.fn(() => oldResult.promise) };
    const newClient = { request: vi.fn(() => newResult.promise) };
    const onData = vi.fn();
    const loader = createLatestThreadListLoader({ onData });

    const oldLoad = loader.load(oldClient);
    const newLoad = loader.load(newClient);
    newResult.resolve({ data: [{ id: "new" }] });
    await newLoad;
    oldResult.resolve({ data: [{ id: "old" }] });
    await oldLoad;

    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenLastCalledWith([{ id: "new" }]);
  });
});
