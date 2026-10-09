import { describe, expect, it, vi } from "vitest";
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
    const client = { request: vi.fn(async (_method: string, params: any) => {
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
    expect(onPinnedData.mock.calls[0][0]).toHaveLength(3);
    expect(onPinnedData.mock.calls[0][0].every((thread: any) => !("turns" in thread))).toBe(true);
    expect(client.request.mock.calls.filter(([method, params]) => method === "thread/read" && params.threadId === "manual")).toHaveLength(1);
    expect(client.request).toHaveBeenCalledWith("thread/loaded/list", { limit: 100, cursor: "next" });
    expect(onProjectData).toHaveBeenCalledWith("/a", records.slice(3), false, null);
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

  it("旧客户端被动置顶摘要迟到不会覆盖新客户端或触发旧项目请求", async () => {
    const oldRead = deferred<{ thread: { id: string; status: { type: string } } }>();
    const oldClient = { request: vi.fn((method: string) => method === "thread/loaded/list"
      ? Promise.resolve({ data: ["old"], nextCursor: null })
      : oldRead.promise) };
    const newClient = { request: vi.fn(async (method: string) => method === "thread/loaded/list"
      ? { data: ["new"], nextCursor: null }
      : method === "thread/read" ? { thread: { id: "new", status: { type: "active" } } }
      : { data: [], nextCursor: null }) };
    const onPinnedData = vi.fn();
    const loader = createLatestThreadListLoader({ onPinnedData });
    const oldLoad = loader.load(oldClient, ["/old"], [], { includeRunningThreads: true });
    await loader.load(newClient, ["/new"], [], { includeRunningThreads: true });
    oldRead.resolve({ thread: { id: "old", status: { type: "active" } } });
    await oldLoad;
    expect(onPinnedData).toHaveBeenCalledOnce();
    expect(onPinnedData).toHaveBeenCalledWith([{ id: "new", status: { type: "active" } }]);
    expect(oldClient.request.mock.calls.some(([method]) => method === "thread/list")).toBe(false);
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
    const client = { request: vi.fn().mockResolvedValue({ data: records, nextCursor: null }) };
    const result = await loadProjectlessThreadRecords(client, records.map((thread) => thread.id), 5, new Set(["pin"]));
    expect(result.threads.map((thread) => thread.id)).toEqual(Array.from({ length: 5 }, (_, i) => `regular-${i}`));
    expect(result.hasMore).toBe(true);
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
      method === "thread/read" ? { thread: { id: params.threadId } } : { data: records, nextCursor: null }) };
    const onData = vi.fn();
    const onProjectData = vi.fn();
    const onPinnedData = vi.fn();
    await createLatestThreadListLoader({ onData, onProjectData, onPinnedData })
      .load(client, [], records.map((thread) => thread.id), { pinnedThreadIds: ["pin"] });
    expect(onData).not.toHaveBeenCalled();
    expect(onProjectData).toHaveBeenCalledWith(PROJECTLESS_GROUP_ID,
      records.slice(1, 6).map((thread) => ({ ...thread, isProjectless: true })), true, null);
    expect(onPinnedData).toHaveBeenCalledWith([{ id: "pin", isProjectless: true }]);
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
    expect(client.request).toHaveBeenCalledWith("thread/read", { threadId: "old-pin", includeTurns: false });
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

  it("无项目历史收集到目标数量后停止，不读取剩余全部", async () => {
    const client = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            { id: "projectless-1", updatedAt: 30 },
            { id: "project-1", updatedAt: 20 },
          ],
          nextCursor: "older-page",
        })
        .mockResolvedValueOnce({
          data: [
            { id: "projectless-2", updatedAt: 10 },
            { id: "projectless-3", updatedAt: 5 },
          ],
          nextCursor: "remaining-page",
        }),
    };

    await expect(
      loadProjectlessThreadRecords(
        client,
        ["projectless-1", "projectless-2", "projectless-3"],
        2,
      ),
    ).resolves.toEqual({
      threads: [
        { id: "projectless-1", updatedAt: 30, isProjectless: true },
        { id: "projectless-2", updatedAt: 10, isProjectless: true },
      ],
      hasMore: true,
    });
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it("无项目目标数量不超过已知会话数", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [{ id: "only-projectless", updatedAt: 10 }],
        nextCursor: "unneeded-page",
      }),
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
    });
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
    });
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
      request: vi.fn((_method: string, params: { cwd?: string }) => {
        if (!params.cwd) {
          return Promise.resolve({
            data: [{
              id: "projectless-thread",
              cwd: "/workspace/project",
              updatedAt: 30,
            }],
            nextCursor: null,
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

    expect(client.request).toHaveBeenCalledWith("thread/list", {
      limit: 50,
      sortKey: "recency_at",
    });
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
