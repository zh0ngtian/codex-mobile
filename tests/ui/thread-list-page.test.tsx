import { act, fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThreadListPage } from "../../src/features/threads/ThreadListPage";
import { aggregateThreads } from "../../src/features/threads/thread-list-model";
import type {
  BackendConfig,
  BackendRuntimeSummary,
} from "../../src/backends/types";

const backend: BackendConfig = {
  id: "mini",
  name: "Mac mini",
  baseUrl: "http://mini.local:4173",
  token: "",
  enabled: true,
  order: 0,
};
const summaries: Record<string, BackendRuntimeSummary> = {
  mini: {
    backendId: "mini",
    connection: "online",
    busy: false,
    approvalCount: 0,
    error: "",
  },
};
const threads = aggregateThreads([backend], {
  mini: [
    {
      id: "pinned",
      preview: "置顶会话",
      cwd: "/tmp/project-a",
      updatedAt: 30,
      isPinned: true,
      status: { type: "idle" },
    },
    {
      id: "recent",
      preview: "最近会话",
      cwd: "/tmp/project-b",
      updatedAt: 20,
      status: { type: "active" },
    },
  ],
});

function renderList(
  selectedBackendId: string,
  {
    collapsedProjectKeys = new Set<string>(),
    loadingBackendIds = new Set<string>(),
    refreshing = false,
    hasProjectlessThreads = false,
    projectDirectories = ["/tmp/project-a", "/tmp/project-b"],
    projectThreadStates = {},
    projectHasMore = {},
    projectVisibleCounts = {},
    query = "",
    searching = false,
    onRetryProject = () => undefined,
    onToggleProjectCollapsed = () => undefined,
    onOpenThread = () => undefined,
    onManageThread = async () => true,
  }: {
    collapsedProjectKeys?: Set<string>;
    loadingBackendIds?: Set<string>;
    refreshing?: boolean;
    hasProjectlessThreads?: boolean;
    projectDirectories?: string[];
    projectThreadStates?: Record<string, "loading" | "ready" | "error">;
    projectHasMore?: Record<string, boolean>;
    projectVisibleCounts?: Record<string, number>;
    query?: string;
    searching?: boolean;
    onRetryProject?: (backendId: string, cwd: string) => void;
    onToggleProjectCollapsed?: (backendId: string, cwd: string) => void;
    onOpenThread?: (thread: (typeof threads)[number]) => void;
    onManageThread?: (
      thread: (typeof threads)[number],
      action: "pin" | "refresh" | "duplicate" | "rename" | "archive",
    ) => Promise<boolean>;
  } = {},
) {
  return render(
    <ThreadListPage
      backends={[backend]}
      summaries={summaries}
      selectedBackendId={selectedBackendId}
      threadListState="ready"
      visibleThreads={threads}
      totalThreadCount={threads.length}
      projectDirectories={projectDirectories}
      hasProjectlessThreads={hasProjectlessThreads}
      projectHasMore={projectHasMore}
      projectVisibleCounts={projectVisibleCounts}
      collapsedProjectKeys={collapsedProjectKeys}
      loadingProjectKeys={new Set()}
      loadingBackendIds={loadingBackendIds}
      refreshing={refreshing}
      projectThreadStates={projectThreadStates}
      openingThreadId=""
      query={query}
      searching={searching}
      error=""
      onQueryChange={() => undefined}
      onOpenThread={onOpenThread}
      onManageThread={onManageThread}
      onNewChat={() => undefined}
      onSelectBackend={() => undefined}
      onManageBackends={() => undefined}
      onRefresh={() => undefined}
      onRetryProject={onRetryProject}
      onToggleProject={() => undefined}
      onToggleProjectCollapsed={onToggleProjectCollapsed}
    />,
  );
}

describe("会话侧边栏列表", () => {
  it("阻止非编辑区域触发原生文字选择并保留搜索框选字", () => {
    const { container } = renderList("all");
    const view = within(container);
    const row = view.getByRole("button", { name: /置顶会话/ });
    const heading = view.getByRole("heading", { name: "Codex Mobile" });
    const search = view.getByRole("textbox", { name: "" });

    const rowSelection = new Event("selectstart", {
      bubbles: true,
      cancelable: true,
    });
    const headingSelection = new Event("selectstart", {
      bubbles: true,
      cancelable: true,
    });
    const searchSelection = new Event("selectstart", {
      bubbles: true,
      cancelable: true,
    });

    row.dispatchEvent(rowSelection);
    heading.dispatchEvent(headingSelection);
    search.dispatchEvent(searchSelection);

    expect(rowSelection.defaultPrevented).toBe(true);
    expect(headingSelection.defaultPrevented).toBe(true);
    expect(searchSelection.defaultPrevented).toBe(false);
  });

  it("长按会话打开与会话内一致的管理菜单且不会误开会话", async () => {
    vi.useFakeTimers();
    const onOpenThread = vi.fn();
    const onManageThread = vi.fn(async () => true);
    const { container } = renderList("all", {
      onOpenThread,
      onManageThread,
    });
    const view = within(container);
    const row = view.getByRole("button", { name: /置顶会话/ });

    fireEvent.pointerDown(row, { button: 0, clientX: 20, clientY: 20 });
    act(() => vi.advanceTimersByTime(550));
    fireEvent.pointerUp(row, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.click(row);

    expect(onOpenThread).not.toHaveBeenCalled();
    expect(view.getByRole("button", { name: "取消置顶" })).not.toBeNull();
    expect(view.getByRole("button", { name: "刷新会话" })).not.toBeNull();
    expect(view.getByRole("button", { name: "复制会话" })).not.toBeNull();
    expect(view.getByRole("button", { name: "复制会话 ID" })).not.toBeNull();
    expect(view.getByRole("button", { name: "重命名" })).not.toBeNull();
    expect(view.getByRole("button", { name: "归档" })).not.toBeNull();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "取消置顶" }));
      await Promise.resolve();
    });
    expect(onManageThread).toHaveBeenCalledWith(
      expect.objectContaining({ backendId: "mini", threadId: "pinned" }),
      "pin",
    );
    expect(view.queryByLabelText("会话操作")).toBeNull();
    vi.useRealTimers();
  });

  it("滚动手势会取消长按并保留普通点击打开会话", () => {
    vi.useFakeTimers();
    const onOpenThread = vi.fn();
    const { container } = renderList("all", { onOpenThread });
    const view = within(container);
    const row = view.getByRole("button", { name: /最近会话/ });

    fireEvent.pointerDown(row, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(row, { clientX: 20, clientY: 40 });
    act(() => vi.advanceTimersByTime(550));
    fireEvent.pointerUp(row, { button: 0, clientX: 20, clientY: 40 });
    fireEvent.click(row);

    expect(view.queryByLabelText("会话操作")).toBeNull();
    expect(onOpenThread).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("头部和机器选项位于同一个吸顶容器", () => {
    const { container } = renderList("mini");
    const sticky = container.querySelector(".thread-list-sticky");

    expect(sticky).not.toBeNull();
    expect(sticky?.querySelector(".list-header")).not.toBeNull();
    expect(sticky?.querySelector(".backend-switcher")).not.toBeNull();
  });

  it("全部视图把置顶独立展示且运行中会话只显示圆环", () => {
    const { container } = renderList("all");
    const view = within(container);

    expect(view.getByRole("heading", { name: "Codex Mobile" })).not.toBeNull();
    expect(view.getByRole("heading", { name: "置顶" })).not.toBeNull();
    expect(view.getByRole("heading", { name: "最近" })).not.toBeNull();
    expect(view.getAllByText("置顶会话")).toHaveLength(1);
    const projectA = view.getByText("Mac mini · project-a");
    const projectB = view.getByText("Mac mini · project-b");
    expect(projectA).not.toBeNull();
    expect(projectB).not.toBeNull();
    expect(projectA.closest(".thread-source")?.querySelector(".status-dot")).toBeNull();
    expect(projectB.closest(".thread-source")?.querySelector(".status-dot")).toBeNull();
    const running = view.getByLabelText("进行中");
    expect(running.querySelector(".running-spinner")).not.toBeNull();
    expect(running.querySelector(".running-dot")).toBeNull();
    expect(running.querySelector(".thread-unread-dot")).toBeNull();
  });

  it("刷新期间只让右上角刷新按钮显示旋转状态", () => {
    const { container } = renderList("all", { refreshing: true });
    const refresh = within(container).getByRole("button", {
      name: "刷新会话列表",
    });

    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(refresh.classList.contains("refreshing")).toBe(true);
    expect(refresh.querySelector(".sidebar-refresh-spinner")).not.toBeNull();
    expect(refresh.querySelector("svg")).toBeNull();
  });

  it("单机视图把置顶独立展示且行内不重复机器项目", () => {
    const { container } = renderList("mini");
    const view = within(container);

    expect(view.getByRole("heading", { name: "置顶" })).not.toBeNull();
    expect(view.getAllByText("置顶会话")).toHaveLength(1);
    expect(view.getByRole("heading", { name: /project-a/ })).not.toBeNull();
    expect(view.getByRole("heading", { name: /project-b/ })).not.toBeNull();
    expect(view.queryByText("Mac mini · project-a")).toBeNull();
  });

  it("单机视图展示无项目会话分组", () => {
    const { container } = renderList("mini", {
      hasProjectlessThreads: true,
      projectThreadStates: {
        "codex-mobile://projectless": "ready",
      },
    });

    expect(
      within(container).getByRole("heading", { name: /无项目/ }),
    ).not.toBeNull();
  });

  it("目录先返回时立即展示全部项目并为未加载项目显示局部骨架", () => {
    const { container } = renderList("mini", {
      projectDirectories: [
        "/tmp/project-a",
        "/tmp/project-b",
        "/tmp/project-c",
      ],
      projectThreadStates: {
        "/tmp/project-a": "ready",
        "/tmp/project-b": "loading",
        "/tmp/project-c": "loading",
      },
    });
    const view = within(container);

    expect(view.getByRole("heading", { name: /project-a/ })).not.toBeNull();
    expect(view.getByRole("heading", { name: /project-b/ })).not.toBeNull();
    expect(view.getByRole("heading", { name: /project-c/ })).not.toBeNull();
    expect(
      view.getAllByLabelText("正在加载项目会话"),
    ).toHaveLength(1);
  });

  it("静默刷新已有项目时保留线程且不显示项目骨架", () => {
    const { container } = renderList("mini", {
      projectDirectories: [
        "/tmp/project-a",
        "/tmp/project-b",
        "/tmp/project-c",
      ],
      projectThreadStates: {
        "/tmp/project-a": "loading",
        "/tmp/project-b": "ready",
      },
    });
    const view = within(container);

    expect(view.getByText("置顶会话")).not.toBeNull();
    expect(view.queryByLabelText("正在加载项目会话")).toBeNull();
  });

  it("首次加载失败时只重试对应项目", () => {
    const onRetryProject = vi.fn();
    const { container } = renderList("mini", {
      projectDirectories: [
        "/tmp/project-a",
        "/tmp/project-b",
        "/tmp/project-c",
      ],
      projectThreadStates: {
        "/tmp/project-a": "ready",
        "/tmp/project-b": "ready",
        "/tmp/project-c": "error",
      },
      onRetryProject,
    });
    const view = within(container);

    fireEvent.click(
      view.getByRole("button", { name: "重试加载 project-c 会话" }),
    );

    expect(onRetryProject).toHaveBeenCalledWith(
      "mini",
      "/tmp/project-c",
    );
  });

  it("首页项目请求未全部结束时在机器前显示 loading", () => {
    const { container } = renderList("mini", {
      loadingBackendIds: new Set(["mini"]),
    });
    const machine = within(container).getByRole("button", {
      name: /Mac mini/,
    });

    expect(
      within(machine).getByLabelText("正在加载机器会话"),
    ).not.toBeNull();
  });

  it("项目首屏去重后不足 5 条但服务端仍有下一页时显示更多", () => {
    const { container } = renderList("mini", {
      projectHasMore: { "/tmp/project-a": true },
    });
    const projectA = within(
      within(container).getByRole("heading", { name: /project-a/ })
        .parentElement as HTMLElement,
    );

    expect(projectA.getByRole("button", { name: "更多" })).not.toBeNull();
  });

  it("项目历史已经完整加载时不再显示更多", () => {
    const { container } = renderList("mini", {
      projectHasMore: {
        "/tmp/project-a": false,
        "/tmp/project-b": false,
      },
      projectVisibleCounts: {
        "mini:/tmp/project-a": Number.MAX_SAFE_INTEGER,
        "mini:/tmp/project-b": Number.MAX_SAFE_INTEGER,
      },
    });

    expect(within(container).queryByRole("button", { name: "更多" })).toBeNull();
  });

  it("点击项目标题切换折叠状态并显示对应文件夹图标", () => {
    const onToggleProjectCollapsed = vi.fn();
    const { container } = renderList("mini", {
      collapsedProjectKeys: new Set(["mini:/tmp/project-a"]),
      onToggleProjectCollapsed,
    });
    const view = within(container);
    const projectButton = view.getByRole("button", { name: /project-a/ });

    expect(projectButton.getAttribute("aria-expanded")).toBe("false");
    expect(projectButton.querySelector('[data-icon="folder"]')).not.toBeNull();
    expect(view.getByText("置顶会话")).not.toBeNull();
    expect(view.getByText("最近会话")).not.toBeNull();

    fireEvent.click(projectButton);
    expect(onToggleProjectCollapsed).toHaveBeenCalledWith(
      "mini",
      "/tmp/project-a",
    );
  });

  it("搜索置顶会话时只保留置顶区且不改变项目折叠缓存", () => {
    const collapsedProjectKeys = new Set(["mini:/tmp/project-a"]);
    const { container } = renderList("mini", {
      collapsedProjectKeys,
      query: "置顶",
    });
    const view = within(container);

    expect(view.getByRole("heading", { name: "置顶" })).not.toBeNull();
    expect(view.getByText("置顶会话")).not.toBeNull();
    expect(view.queryByRole("button", { name: /project-a/ })).toBeNull();
    expect(collapsedProjectKeys.has("mini:/tmp/project-a")).toBe(true);
  });

  it("同一搜索结果行展示服务端全文命中片段", () => {
    const matchingThreads = threads.map((thread) =>
      thread.threadId === "recent"
        ? { ...thread, searchSnippet: "正文里提到了统一全文搜索" }
        : thread,
    );
    const { container } = render(
      <ThreadListPage
        backends={[backend]}
        summaries={summaries}
        selectedBackendId="all"
        threadListState="ready"
        visibleThreads={matchingThreads.filter(
          (thread) => thread.threadId === "recent",
        )}
        totalThreadCount={matchingThreads.length}
        projectDirectories={[]}
        hasProjectlessThreads={false}
        projectHasMore={{}}
        projectVisibleCounts={{}}
        collapsedProjectKeys={new Set()}
        loadingProjectKeys={new Set()}
        loadingBackendIds={new Set()}
        refreshing={false}
        projectThreadStates={{}}
        openingThreadId=""
        query="全文搜索"
        searching={false}
        error=""
        onQueryChange={() => undefined}
        onOpenThread={() => undefined}
        onManageThread={async () => true}
        onNewChat={() => undefined}
        onSelectBackend={() => undefined}
        onManageBackends={() => undefined}
        onRefresh={() => undefined}
        onRetryProject={() => undefined}
        onToggleProject={() => undefined}
        onToggleProjectCollapsed={() => undefined}
      />,
    );

    expect(
      within(container).getByText("正文里提到了统一全文搜索"),
    ).not.toBeNull();
    expect(within(container).getByText("Mac mini · project-b")).not.toBeNull();
  });

  it("统一搜索尚未返回时展示搜索状态而不是空结果", () => {
    const { container } = renderList("all", {
      query: "未返回",
      searching: true,
    });
    const view = within(container);

    expect(view.getByLabelText("正在搜索会话")).not.toBeNull();
    expect(view.queryByText("没有匹配的对话")).toBeNull();
  });

  it("在未查看会话的右侧时间前显示蓝点", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const unreadThreads = threads.map((thread) =>
      thread.threadId === "pinned" ? { ...thread, unread: true } : thread,
    );
    const { container } = render(
      <ThreadListPage
        backends={[backend]}
        summaries={summaries}
        selectedBackendId="mini"
        threadListState="ready"
        visibleThreads={unreadThreads}
        totalThreadCount={unreadThreads.length}
        projectDirectories={["/tmp/project-a", "/tmp/project-b"]}
        hasProjectlessThreads={false}
        projectHasMore={{}}
        projectVisibleCounts={{}}
        collapsedProjectKeys={new Set()}
        loadingProjectKeys={new Set()}
        loadingBackendIds={new Set()}
        refreshing={false}
        projectThreadStates={{}}
        openingThreadId=""
        query=""
        searching={false}
        error=""
        onQueryChange={() => undefined}
        onOpenThread={() => undefined}
        onManageThread={async () => true}
        onNewChat={() => undefined}
        onSelectBackend={() => undefined}
        onManageBackends={() => undefined}
        onRefresh={() => undefined}
        onRetryProject={() => undefined}
        onToggleProject={() => undefined}
        onToggleProjectCollapsed={() => undefined}
      />,
    );

    const unread = within(container).getByLabelText("未读");
    const meta = unread.closest(".thread-row-meta");

    expect(meta).not.toBeNull();
    expect(within(meta as HTMLElement).getByText("1 分钟")).not.toBeNull();
    expect(meta?.firstElementChild).toBe(unread);
    now.mockRestore();
  });
});
