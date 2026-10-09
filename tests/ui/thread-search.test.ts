import { describe, expect, it, vi } from "vitest";
import { AppServerRpcError } from "../../src/app-server/client";
import { searchThreadRecords } from "../../src/app-server/thread-search";

describe("App Server 统一会话搜索", () => {
  it("全文结果按任务活动排序，重复记录仍保留查看后的最新标题和片段", async () => {
    const request = vi.fn().mockResolvedValue({ data: [
      { thread: { id: "viewed", recencyAt: 10, updatedAt: 10, name: "旧标题" }, snippet: "旧片段" },
      { thread: { id: "recent", recencyAt: 20, updatedAt: 20 }, snippet: "最近任务" },
      { thread: { id: "viewed", recencyAt: 10, updatedAt: 100, name: "新标题" }, snippet: "新片段" },
    ], nextCursor: null });
    const results = await searchThreadRecords({ request }, "任务");
    expect(results.map((thread) => thread.id)).toEqual(["recent", "viewed"]);
    expect(results[1]).toMatchObject({ name: "新标题", searchSnippet: "新片段", updatedAt: 100 });
  });

  it("标题搜索回退仍不因查看会话改变排序", async () => {
    const request = vi.fn().mockRejectedValueOnce(new AppServerRpcError("method not found", -32601))
      .mockResolvedValueOnce({ data: [
        { id: "viewed", recencyAt: 10, updatedAt: 100 },
        { id: "recent", recencyAt: 20, updatedAt: 20 },
      ], nextCursor: null });
    expect((await searchThreadRecords({ request }, "任务")).map((thread) => thread.id))
      .toEqual(["recent", "viewed"]);
  });

  it("沿 thread/search 游标读取全文结果并排除临时与派生线程", async () => {
    const client = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            {
              thread: {
                id: "matched-thread",
                name: "服务端标题",
                updatedAt: 30,
                ephemeral: false,
              },
              snippet: "这里命中了部署失败",
            },
            {
              thread: {
                id: "ephemeral-thread",
                updatedAt: 20,
                ephemeral: true,
              },
              snippet: "临时结果",
            },
          ],
          nextCursor: "older-page",
        })
        .mockResolvedValueOnce({
          data: [
            {
              thread: {
                id: "child-thread",
                updatedAt: 10,
                parentThreadId: "parent-thread",
              },
              snippet: "子线程结果",
            },
            {
              thread: {
                id: "older-thread",
                preview: "另一个结果",
                updatedAt: 5,
              },
              snippet: "部署失败的更早上下文",
            },
          ],
          nextCursor: null,
        }),
    };

    await expect(
      searchThreadRecords(client, "  部署失败  "),
    ).resolves.toEqual([
      {
        id: "matched-thread",
        name: "服务端标题",
        updatedAt: 30,
        ephemeral: false,
        searchSnippet: "这里命中了部署失败",
      },
      {
        id: "older-thread",
        preview: "另一个结果",
        updatedAt: 5,
        searchSnippet: "部署失败的更早上下文",
      },
    ]);
    expect(client.request).toHaveBeenNthCalledWith(
      1,
      "thread/search",
      {
        searchTerm: "部署失败",
        limit: 50,
        sortKey: "recency_at",
        sortDirection: "desc",
      },
      { timeoutMs: 60_000 },
    );
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      "thread/search",
      {
        searchTerm: "部署失败",
        limit: 50,
        sortKey: "recency_at",
        sortDirection: "desc",
        cursor: "older-page",
      },
      { timeoutMs: 60_000 },
    );
  });

  it("旧服务端不支持全文搜索时回退服务端标题搜索", async () => {
    const client = {
      request: vi
        .fn()
        .mockRejectedValueOnce(
          new AppServerRpcError("method not found", -32601),
        )
        .mockResolvedValueOnce({
          data: [{ id: "title-match", name: "发布流程", updatedAt: 9 }],
          nextCursor: null,
        }),
    };

    await expect(
      searchThreadRecords(client, "发布"),
    ).resolves.toEqual([
      {
        id: "title-match",
        name: "发布流程",
        updatedAt: 9,
        searchSnippet: "发布流程",
      },
    ]);
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      "thread/list",
      {
        searchTerm: "发布",
        limit: 50,
        sortKey: "recency_at",
      },
      { timeoutMs: 60_000 },
    );
  });

  it("空查询不访问服务端", async () => {
    const client = { request: vi.fn() };

    await expect(searchThreadRecords(client, "   ")).resolves.toEqual([]);
    expect(client.request).not.toHaveBeenCalled();
  });
});
