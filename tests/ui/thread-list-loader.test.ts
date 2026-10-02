import { describe, expect, it, vi } from "vitest";
import {
  createLatestThreadListLoader,
  dedupeThreadsById,
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
  it("使用会话活动时间排序，不把单纯打开导致的更新时间当成最新活动", () => {
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
      {
        id: "recent-activity",
        recencyAt: 20,
        updatedAt: 20,
      },
      {
        id: "opened-history",
        recencyAt: 10,
        updatedAt: 100,
      },
    ]);
  });

  it("按逻辑 thread id 合并续接日志并保留更新时间最新的记录", () => {
    expect(
      dedupeThreadsById([
        {
          id: "continued-thread",
          path: "/sessions/original.jsonl",
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
          updatedAt: 30,
        },
      ]),
    ).toEqual([
      {
        id: "continued-thread",
        path: "/sessions/continued.jsonl",
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
