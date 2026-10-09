import { describe, expect, it } from "vitest";
import {
  aggregateThreads,
  filterAggregatedThreads,
  groupThreadsByProject,
  mergeAggregatedThreadSearchResults,
  splitAllThreads,
} from "../../src/features/threads/thread-list-model";
import { PROJECTLESS_GROUP_ID } from "../../src/app-server/thread-list-loader";

const backends = [
  { id: "book", name: "MacBook" },
  { id: "mini", name: "Mac mini" },
];

describe("会话列表派生", () => {
  it("查看或恢复旧会话后列表、项目和合并搜索仍按最近任务排序", () => {
    const history = { id: "01a10657-66b0-7e30-97d8-62d853b8a3dc", cwd: "/project", recencyAt: 10, updatedAt: 10 };
    const recent = { id: "recent-task", cwd: "/project", recencyAt: 20, updatedAt: 20 };
    const list = (updatedAt: number) => aggregateThreads(backends.slice(0, 1), {
      book: [{ ...history, updatedAt }, recent],
    });
    expect(list(10).map((item) => item.threadId)).toEqual([recent.id, history.id]);
    const refreshed = list(100);
    expect(refreshed.map((item) => item.threadId)).toEqual([recent.id, history.id]);
    expect(groupThreadsByProject(refreshed)[0].threads.map((item) => item.threadId))
      .toEqual([recent.id, history.id]);
    expect(mergeAggregatedThreadSearchResults(refreshed, list(10)).map((item) => item.threadId))
      .toEqual([recent.id, history.id]);
    const started = aggregateThreads(backends.slice(0, 1), {
      book: [{ ...history, recencyAt: 30, updatedAt: 100 }, recent],
    });
    expect(started[0].threadId).toBe(history.id);
  });

  it("活动时间缺失时兼容更新时间和创建时间，并保留有效的零值", () => {
    const result = aggregateThreads(backends.slice(0, 1), { book: [
      { id: "legacy", updatedAt: 30, createdAt: 1 },
      { id: "created", recencyAt: null, createdAt: 20 },
      { id: "zero", recencyAt: 0, updatedAt: 100 },
      { id: "empty" },
    ] });
    expect(result.map((item) => item.timestamp)).toEqual([30, 20, 0, 0]);
  });

  const items = aggregateThreads(backends, {
    book: [
      {
        id: "book-pinned",
        preview: "优化移动端会话列表",
        cwd: "/Users/me/codex-web-mobile",
        updatedAt: 30,
        isPinned: true,
      },
      {
        id: "book-recent",
        preview: "查看 Docker 配置",
        cwd: "/Users/me/infra",
        recencyAt: 50,
        updatedAt: 50,
      },
    ],
    mini: [
      {
        id: "mini-pinned",
        preview: "HA运维",
        cwd: "/srv/home-assistant",
        updatedAt: 40,
        isPinned: true,
      },
      {
        id: "mini-recent",
        preview: "查找 TTS Key",
        cwd: "/srv/sub2api/",
        updatedAt: 10,
      },
      {
        id: "mini-unknown",
        preview: "无项目任务",
        cwd: null,
        isProjectless: true,
        createdAt: 5,
      },
    ],
  });

  it("为线程附加机器和项目来源并按时间降序汇总", () => {
    expect(items.map((item) => item.threadId)).toEqual([
      "book-recent",
      "mini-pinned",
      "book-pinned",
      "mini-recent",
      "mini-unknown",
    ]);
    expect(items[1]).toMatchObject({
      backendId: "mini",
      backendName: "Mac mini",
      projectName: "home-assistant",
      pinned: true,
    });
    expect(items.at(-1)?.projectName).toBe("无项目");
  });

  it("运行中的会话不派生未读状态", () => {
    const [running] = aggregateThreads(backends.slice(0, 1), {
      book: [
        {
          id: "running-unread",
          preview: "正在执行",
          cwd: "/tmp/project",
          updatedAt: 60,
          isUnread: true,
          status: { type: "active" },
        },
      ],
    });

    expect(running.unread).toBe(false);
  });

  it("全部视图把置顶和最近拆分且不重复", () => {
    const groups = splitAllThreads(items);
    expect(groups.pinned.map((item) => item.threadId)).toEqual([
      "mini-pinned",
      "book-pinned",
    ]);
    expect(groups.recent.map((item) => item.threadId)).toEqual([
      "book-recent",
      "mini-recent",
      "mini-unknown",
    ]);
  });

  it("单机视图按项目分组并按组内最新时间排序", () => {
    const groups = groupThreadsByProject(
      items.filter((item) => item.backendId === "mini"),
    );
    expect(groups.map((group) => group.projectName)).toEqual([
      "home-assistant",
      "sub2api",
      "无项目",
    ]);
    expect(groups[0].threads.map((item) => item.threadId)).toEqual([
      "mini-pinned",
    ]);
  });

  it("配置中的无会话项目也会出现在项目分组", () => {
    const groups = groupThreadsByProject(
      items.filter((item) => item.backendId === "mini"),
      ["/srv/home-assistant", "/srv/empty-project"],
    );
    expect(groups.some((group) => group.cwd === "/srv/empty-project")).toBe(true);
  });

  it("有桌面项目顺序时按目录顺序展示，组内仍按会话时间倒序", () => {
    const groups = groupThreadsByProject(
      items.filter((item) => item.backendId === "mini"),
      ["/srv/sub2api/", "/srv/home-assistant"],
    );
    expect(groups.map((group) => group.cwd)).toEqual([
      "/srv/sub2api/",
      "/srv/home-assistant",
      PROJECTLESS_GROUP_ID,
    ]);
    expect(groups[0].threads.map((item) => item.threadId)).toEqual([
      "mini-recent",
    ]);
  });

  it("全部搜索覆盖标题、机器和项目，单机可复用过滤结果", () => {
    expect(
      filterAggregatedThreads(items, "MacBook").map((item) => item.threadId),
    ).toEqual(["book-recent", "book-pinned"]);
    expect(
      filterAggregatedThreads(items, "sub2api").map((item) => item.threadId),
    ).toEqual(["mini-recent"]);
    expect(
      filterAggregatedThreads(items, "HA运维").map((item) => item.threadId),
    ).toEqual(["mini-pinned"]);
    expect(filterAggregatedThreads(items, "MacBook", false)).toEqual([]);
  });

  it("把服务端全文结果与设备项目匹配合并为一个去重列表", () => {
    const serverMatches = aggregateThreads(backends, {
      book: [
        {
          id: "book-recent",
          preview: "查看 Docker 配置",
          cwd: "/Users/me/infra",
          recencyAt: 50,
          updatedAt: 50,
          searchSnippet: "正文命中了容器部署错误",
        },
      ],
    });
    const metadataMatches = filterAggregatedThreads(items, "MacBook");

    const merged = mergeAggregatedThreadSearchResults(
      serverMatches,
      metadataMatches,
    );

    expect(merged.map((item) => item.threadId)).toEqual([
      "book-recent",
      "book-pinned",
    ]);
    expect(
      merged.find((item) => item.threadId === "book-recent")?.searchSnippet,
    ).toBe("正文命中了容器部署错误");
  });
});
