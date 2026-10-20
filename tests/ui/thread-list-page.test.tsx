import { act, fireEvent, render, within } from "@testing-library/react";
import { cloneElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { ThreadListPage } from "../../src/features/threads/ThreadListPage";
import { aggregateThreads } from "../../src/features/threads/thread-list-model";
import type {
  BackendConfig,
  BackendRuntimeSummary,
} from "../../src/backends/types";
import { ACTION_MENU_EVENT } from "../../src/ui/native-action-menu";

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
      preview: "关注会话",
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
    visibleThreads = threads,
    hasProjectlessThreads = false,
    projectDirectories = ["/tmp/project-a", "/tmp/project-b"],
    projectThreadStates = {},
    projectHasMore = {},
    query = "",
    searching = false,
    onRetryProject = () => undefined,
    onToggleProject = () => undefined,
    onToggleProjectCollapsed = () => undefined,
    onOpenThread = () => undefined,
    onManageThread = async () => true,
  }: {
    collapsedProjectKeys?: Set<string>;
    loadingBackendIds?: Set<string>;
    refreshing?: boolean;
    visibleThreads?: typeof threads;
    hasProjectlessThreads?: boolean;
    projectDirectories?: string[];
    projectThreadStates?: Record<string, "loading" | "ready" | "error">;
    projectHasMore?: Record<string, boolean>;
    query?: string;
    searching?: boolean;
    onRetryProject?: (backendId: string, cwd: string) => void;
    onToggleProject?: (backendId: string, cwd: string) => void;
    onToggleProjectCollapsed?: (backendId: string, cwd: string) => void;
    onOpenThread?: (thread: (typeof threads)[number]) => void;
    onManageThread?: (
      thread: (typeof threads)[number],
      action: "pin" | "refresh" | "duplicate" | "rename" | "archive",
    ) => Promise<boolean>;
  } = {},
) {
  const element = (
    <ThreadListPage
      backends={[backend]}
      summaries={summaries}
      selectedBackendId={selectedBackendId}
      threadListState="ready"
      visibleThreads={visibleThreads}
      totalThreadCount={visibleThreads.length}
      projectDirectories={projectDirectories}
      hasProjectlessThreads={hasProjectlessThreads}
      projectHasMore={projectHasMore}
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
      onToggleProject={onToggleProject}
      onToggleProjectCollapsed={onToggleProjectCollapsed}
    />
  );
  const result = render(element);
  return {
    ...result,
    element,
    setSidebarOpen: (sidebarOpen: boolean) =>
      result.rerender(cloneElement(element, { sidebarOpen })),
  };
}

describe("会话侧边栏列表", () => {
  it("搜索更多不沿用普通项目首批的加载状态", () => {
    const onToggleProject = vi.fn();
    const { container } = renderList("mini", { query: "最近", projectDirectories: ["/tmp/project-b"],
      projectThreadStates: { "/tmp/project-b": "loading" }, projectHasMore: { "/tmp/project-b": true }, onToggleProject });
    const more = container.querySelector(".project-more") as HTMLButtonElement;
    expect(more.disabled).toBe(false); fireEvent.click(more);
    expect(onToggleProject).toHaveBeenCalledExactlyOnceWith("mini", "/tmp/project-b");
  });
  it("重新展开读取首批时，加载更多不能提前展开旧缓存", () => {
    const data = aggregateThreads([backend], { mini: Array.from({ length: 12 }, (_, i) => ({
      id: `reload-${i}`, preview: `缓存${i + 1}`, cwd: "/a", recencyAt: 20 - i, status: { type: "idle" },
    })) });
    const onToggleProject = vi.fn();
    const { container } = renderList("mini", { visibleThreads: data, projectDirectories: ["/a"],
      projectThreadStates: { "/a": "loading" }, projectHasMore: { "/a": true }, onToggleProject });
    const more = container.querySelector(".project-more") as HTMLButtonElement;
    expect(more.disabled).toBe(true); fireEvent.click(more);
    expect(within(container).queryByText("缓存6")).toBeNull();
    expect(onToggleProject).not.toHaveBeenCalled();
  });
  it("原生重命名取消后同一侧栏会话可再次重命名，保留原后端与目标", async () => {
    const show = vi.fn();
    (window as any).CodexMobileActionMenu = { show, dismiss: vi.fn() };
    try {
      const onManageThread = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const { container, unmount } = renderList("all", { onManageThread });
      const row = within(container).getByRole("button", { name: /关注会话/ });
      for (let attempt = 0; attempt < 2; attempt++) {
        fireEvent.contextMenu(row);
        expect(show).toHaveBeenCalledTimes(attempt + 1);
        const request = JSON.parse(show.mock.calls[attempt][0]);
        await act(async () => window.dispatchEvent(new CustomEvent(ACTION_MENU_EVENT, {
          detail: { requestId: request.requestId, actionId: "rename" },
        })));
        expect(onManageThread).toHaveBeenNthCalledWith(attempt + 1, threads[0], "rename");
      }
      expect(onManageThread.mock.calls[0][0]).toMatchObject({ backendId: "mini", threadId: "pinned" });
      unmount();
    } finally {
      delete (window as any).CodexMobileActionMenu;
    }
  });

  it("草稿入口位于刷新左侧，点击打开草稿列表", () => {
    const { container, element, rerender } = renderList("all");
    const onOpenDrafts = vi.fn();
    rerender(cloneElement(element, { onOpenDrafts }));
    const drafts = within(container).getByRole("button", { name: "草稿" });
    const refresh = within(container).getByRole("button", { name: "刷新会话列表" });
    expect(drafts.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(drafts);
    expect(onOpenDrafts).toHaveBeenCalledOnce();
  });
  it("取消原生长按菜单后，新的一次快速单击进入会话", () => {
    vi.useFakeTimers();
    const show = vi.fn();
    (window as any).CodexMobileActionMenu = { show, dismiss: vi.fn() };
    try {
      const onOpenThread = vi.fn();
      const { container } = renderList("all", { onOpenThread });
      const row = within(container).getByRole("button", { name: /关注会话/ });
      fireEvent.pointerDown(row, { button: 0, clientX: 20, clientY: 20 });
      act(() => vi.advanceTimersByTime(550));
      // 原生菜单接管触摸时，WebView 收到 cancel，不保证产生尾随 click。
      fireEvent.pointerCancel(row);
      expect(onOpenThread).not.toHaveBeenCalled();
      const request = JSON.parse(show.mock.calls[0][0]);
      act(() => window.dispatchEvent(new CustomEvent("codex-mobile-action-menu", {
        detail: { requestId: request.requestId, actionId: null },
      })));
      fireEvent.pointerDown(row, { button: 0, clientX: 20, clientY: 20 });
      fireEvent.pointerUp(row);
      fireEvent.click(row);
      expect(onOpenThread).toHaveBeenCalledTimes(1);
      expect(show).toHaveBeenCalledTimes(1);
    } finally {
      delete (window as any).CodexMobileActionMenu;
      vi.useRealTimers();
    }
  });

  it("原生长按菜单将选择路由到原会话并在关闭侧栏时清理", async () => {
    const show = vi.fn();
    const dismiss = vi.fn();
    (window as any).CodexMobileActionMenu = { show, dismiss };
    try {
      const onManageThread = vi.fn().mockResolvedValue(true);
      const { container, setSidebarOpen } = renderList("all", { onManageThread });
      fireEvent.contextMenu(within(container).getByRole("button", { name: /关注会话/ }));
      expect(show).toHaveBeenCalledTimes(1);
      expect(within(container).queryByLabelText("会话操作")).toBeNull();
      const request = JSON.parse(show.mock.calls[0][0]);
      expect(request.actions.find((a: any) => a.id === "pin").title).toBe("取消关注");
      await act(async () => window.dispatchEvent(new CustomEvent("codex-mobile-action-menu", {
        detail: { requestId: request.requestId, actionId: "pin" },
      })));
      expect(onManageThread).toHaveBeenCalledWith(threads[0], "pin");
      setSidebarOpen(false);
      expect(dismiss).toHaveBeenCalled();
    } finally { delete (window as any).CodexMobileActionMenu; }
  });

  it.each(["all", "mini"])("%s 关注区完整展开且运行未读不自动进入", (selectedBackendId) => {
    const visibleThreads = aggregateThreads([backend], { mini:
      ["manual", "unread", "running"].flatMap((kind) => Array.from({ length: 7 }, (_, i) => ({
        id: `${kind}-${i}`, preview: `${kind}-${i}`, cwd: "/tmp/project-a",
        isPinned: kind === "manual", isUnread: kind === "unread",
        status: { type: kind === "running" ? "active" : "idle" },
      }))),
    });
    const { container } = renderList(selectedBackendId, {
      visibleThreads, collapsedProjectKeys: new Set(["mini:/tmp/project-a"]),
    });
    const section = within(container).getByRole("heading", { name: "关注" }).parentElement as HTMLElement;
    expect(section.querySelectorAll(".thread-row-title")).toHaveLength(7);
    for (const thread of visibleThreads) {
      expect(Boolean(within(section).queryByText(thread.threadId))).toBe(thread.pinned);
    }
    expect(within(section).queryByRole("button", { name: "更多" })).toBeNull();
  });

  it("搜索运行中会话只显示项目结果", () => {
    const { container } = renderList("mini", {
      visibleThreads: threads.filter((thread) => thread.threadId === "recent"), query: "最近会话",
    });
    expect(within(container).queryByRole("heading", { name: "关注" })).toBeNull();
    expect(container.querySelectorAll(".project-group")).toHaveLength(1);
    expect(within(container).getAllByText("最近会话")).toHaveLength(1);
  });

  it.each([false, true])("关注会话只在顶部显示，运行未读留在项目（无项目：%s）", (isProjectless) => {
    const visibleThreads = aggregateThreads([backend], { mini: [
      { id: "manual", preview: "关注任务", cwd: "/tmp/project-a", isProjectless, isPinned: true, updatedAt: 1 },
      { id: "running", preview: "执行任务", cwd: "/tmp/project-a", isProjectless, status: { type: "active" }, updatedAt: 3 },
      { id: "unread", preview: "待阅任务", cwd: "/tmp/project-a", isProjectless, isUnread: true, updatedAt: 2 },
    ] });
    const onOpenThread = vi.fn();
    const { container } = renderList("mini", { visibleThreads, hasProjectlessThreads: isProjectless, onOpenThread });
    const followed = within(container).getByRole("heading", { name: "关注" }).parentElement as HTMLElement;
    const project = within(container).getByRole("button", { name: isProjectless ? "无项目" : "project-a" }).closest(".project-group") as HTMLElement;
    expect([...project.querySelectorAll(".thread-row-title")].map(node => node.textContent)).toEqual(["执行任务", "待阅任务"]);
    expect([...followed.querySelectorAll(".thread-row-title")].map(node => node.textContent)).toEqual(["关注任务"]);
    for (const thread of visibleThreads) {
      const title = String(thread.thread.preview);
      fireEvent.click(within(container).getByRole("button", { name: new RegExp(title) }));
      expect(onOpenThread).toHaveBeenLastCalledWith(thread);
      expect(within(container).getAllByText(title)).toHaveLength(1);
    }
    expect(project.querySelectorAll(".running-spinner")).toHaveLength(1);
    expect(project.querySelectorAll(".thread-unread-dot")).toHaveLength(1);
  });

  it("取消关注后立即显示在项目中，即使仍运行或未读也不自动提升", () => {
    const visibleThreads = aggregateThreads([backend], { mini: [
      { id: "manual", preview: "关注任务", cwd: "/tmp/project-a", isPinned: true, status: { type: "active" } },
      { id: "unread", preview: "待阅任务", cwd: "/tmp/project-a", isUnread: true },
    ] });
    const { container, rerender, element } = renderList("mini", { visibleThreads });
    const project = within(container).getByRole("button", { name: "project-a" }).closest(".project-group") as HTMLElement;
    expect(within(project).queryByText("关注任务")).toBeNull();
    const ordinary = aggregateThreads([backend], { mini: visibleThreads.map(({ thread }) => ({ ...thread, isPinned: false })) });
    rerender(cloneElement(element, { visibleThreads: ordinary }));
    expect(within(container).queryByRole("heading", { name: "关注" })).toBeNull();
    expect(within(project).getAllByText("关注任务")).toHaveLength(1);
    expect(project.querySelectorAll(".running-spinner")).toHaveLength(1);
    expect(project.querySelectorAll(".thread-unread-dot")).toHaveLength(1);
  });

  it.each([false, true])("折叠项目后名称带运行与未读标记，展开时移除（无项目：%s）", (isProjectless) => {
    const visibleThreads = aggregateThreads([backend], { mini: [
      { id: "running", cwd: "/tmp/project-a", isProjectless, status: { type: "active" }, isUnread: true },
      { id: "unread", cwd: "/tmp/project-a", isProjectless, isUnread: true },
    ] });
    const cwd = isProjectless ? "codex-mobile://projectless" : "/tmp/project-a";
    const { container, rerender, element } = renderList("mini", {
      visibleThreads, hasProjectlessThreads: isProjectless, collapsedProjectKeys: new Set([`mini:${cwd}`]),
    });
    const heading = within(container).getByRole("button", { name: new RegExp(isProjectless ? "无项目" : "project-a") });
    expect(within(heading).getByLabelText("进行中")).not.toBeNull();
    expect(within(heading).getByLabelText("未读")).not.toBeNull();
    expect(heading.getAttribute("aria-expanded")).toBe("false");
    rerender(cloneElement(element, { collapsedProjectKeys: new Set() }));
    expect(within(heading).queryByLabelText("进行中")).toBeNull();
    expect(within(heading).queryByLabelText("未读")).toBeNull();
    expect(heading.getAttribute("aria-expanded")).toBe("true");
  });

  it("项目标记不包含移出项目的关注会话，运行中的旧未读不显示未读标记", () => {
    const visibleThreads = aggregateThreads([backend], { mini: [
      { id: "followed", cwd: "/tmp/project-a", isPinned: true, isUnread: true, status: { type: "active" } },
      { id: "active", cwd: "/tmp/project-b", isUnread: true, status: { type: "active" } },
    ] });
    const { container } = renderList("mini", { visibleThreads,
      collapsedProjectKeys: new Set(["mini:/tmp/project-a", "mini:/tmp/project-b"]),
    });
    const view = within(container);
    const first = view.getByRole("button", { name: "project-a" });
    expect(first.querySelector(".running-spinner")).toBeNull();
    expect(first.querySelector(".thread-unread-dot")).toBeNull();
    const second = view.getByRole("button", { name: /project-b/ });
    expect(second.querySelector(".running-spinner")).not.toBeNull();
    expect(second.querySelector(".thread-unread-dot")).toBeNull();
  });

  it("阻止非编辑区域触发原生文字选择并保留搜索框选字", () => {
    const { container } = renderList("all");
    const view = within(container);
    const row = view.getByRole("button", { name: /关注会话/ });
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
    const row = view.getByRole("button", { name: /关注会话/ });

    fireEvent.pointerDown(row, { button: 0, clientX: 20, clientY: 20 });
    act(() => vi.advanceTimersByTime(550));
    fireEvent.pointerUp(row, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.click(row);

    expect(onOpenThread).not.toHaveBeenCalled();
    expect(view.getByRole("button", { name: "取消关注" })).not.toBeNull();
    expect(view.getByRole("button", { name: "刷新会话" })).not.toBeNull();
    expect(view.getByRole("button", { name: "复制会话" })).not.toBeNull();
    expect(view.getByRole("button", { name: "复制会话 ID" })).not.toBeNull();
    expect(view.getByRole("button", { name: "重命名" })).not.toBeNull();
    expect(view.getByRole("button", { name: "归档" })).not.toBeNull();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "取消关注" }));
      await Promise.resolve();
    });
    expect(onManageThread).toHaveBeenCalledWith(
      expect.objectContaining({ backendId: "mini", threadId: "pinned" }),
      "pin",
    );
    expect(view.queryByLabelText("会话操作")).toBeNull();
    vi.useRealTimers();
  });

  it("关闭边栏收起长按菜单，再打开不会恢复旧菜单或吞掉点击", () => {
    vi.useFakeTimers();
    try {
      const onOpenThread = vi.fn();
      const { container, setSidebarOpen } = renderList("all", { onOpenThread });
      const view = within(container);
      const row = view.getByRole("button", { name: /关注会话/ });
      fireEvent.pointerDown(row, { button: 0, clientX: 20, clientY: 20 });
      act(() => vi.advanceTimersByTime(550));
      expect(view.getByLabelText("会话操作")).not.toBeNull();

      setSidebarOpen(false);
      expect(view.queryByLabelText("会话操作")).toBeNull();
      setSidebarOpen(true);
      expect(view.queryByLabelText("会话操作")).toBeNull();
      fireEvent.click(row);
      expect(onOpenThread).toHaveBeenCalledTimes(1);
      fireEvent.contextMenu(row);
      expect(view.getByLabelText("会话操作")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("长按计时期间关闭边栏会取消菜单，重新打开也不补弹", () => {
    vi.useFakeTimers();
    try {
      const { container, setSidebarOpen } = renderList("all");
      const view = within(container);
      const row = view.getByRole("button", { name: /关注会话/ });
      fireEvent.pointerDown(row, { button: 0, clientX: 20, clientY: 20 });
      act(() => vi.advanceTimersByTime(250));
      setSidebarOpen(false);
      setSidebarOpen(true);
      act(() => vi.advanceTimersByTime(550));
      expect(view.queryByLabelText("会话操作")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

  it("全部视图把关注独立展示且运行中会话只显示圆环", () => {
    const { container } = renderList("all");
    const view = within(container);

    expect(view.getByRole("heading", { name: "Codex Mobile" })).not.toBeNull();
    expect(view.getByRole("heading", { name: "关注" })).not.toBeNull();
    expect(view.getByRole("heading", { name: "最近" })).not.toBeNull();
    expect(view.getAllByText("关注会话")).toHaveLength(1);
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

  it("单机视图把关注独立展示且行内不重复机器项目", () => {
    const { container } = renderList("mini");
    const view = within(container);

    expect(view.getByRole("heading", { name: "关注" })).not.toBeNull();
    expect(view.getAllByText("关注会话")).toHaveLength(1);
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

    expect(view.getAllByText("关注会话")).toHaveLength(1);
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

  it("点击更多时只请求对应项目的下一批", () => {
    const onToggleProject = vi.fn();
    const { container } = renderList("mini", {
      projectHasMore: { "/tmp/project-a": true },
      onToggleProject,
    });
    const projectA = within(
      within(container).getByRole("heading", { name: /project-a/ })
        .parentElement as HTMLElement,
    );

    fireEvent.click(projectA.getByRole("button", { name: "更多" }));

    expect(onToggleProject).toHaveBeenCalledOnce();
    expect(onToggleProject).toHaveBeenCalledWith("mini", "/tmp/project-a");
  });

  it("项目缓存首批显示五条，点击更多展示缓存并保留远端入口", () => {
    const loadedThreads = aggregateThreads([backend], {
      mini: Array.from({ length: 8 }, (_, index) => ({
        id: `loaded-${index + 1}`,
        preview: `已加载会话 ${index + 1}`,
        cwd: "/tmp/project-a",
        updatedAt: 100 - index,
      })),
    });
    const { container } = renderList("mini", {
      visibleThreads: loadedThreads,
      projectDirectories: ["/tmp/project-a"],
      projectHasMore: { "/tmp/project-a": true },
    });
    const view = within(container);

    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(5);
    fireEvent.click(view.getByRole("button", { name: "更多" }));
    for (let index = 1; index <= 8; index += 1) {
      expect(view.getByText(`已加载会话 ${index}`)).not.toBeNull();
    }
    expect(view.getByRole("button", { name: "更多" })).not.toBeNull();
  });

  it.each([false, true])("折叠后展开只显示前五条，更多分批展示缓存且再次折叠重置（无项目：%s）", (isProjectless) => {
    const cwd = isProjectless ? "codex-mobile://projectless" : "/tmp/project-a";
    const loadedThreads = aggregateThreads([backend], {
      mini: Array.from({ length: 12 }, (_, index) => ({
        id: `cached-${index + 1}`, preview: `缓存会话 ${index + 1}`,
        cwd: "/tmp/project-a", isProjectless, updatedAt: 100 - index,
      })),
    });
    const onToggleProject = vi.fn();
    const onToggleProjectCollapsed = vi.fn();
    const { container, element, rerender } = renderList("mini", {
      visibleThreads: loadedThreads, hasProjectlessThreads: isProjectless,
      projectDirectories: isProjectless ? [] : [cwd],
      projectHasMore: { [cwd]: false }, onToggleProject, onToggleProjectCollapsed,
    });
    const view = within(container);
    const heading = view.getByRole("button", { name: isProjectless ? "无项目" : "project-a" });
    const titles = () => [...container.querySelectorAll(".project-group .thread-row-title")].map(node => node.textContent);
    expect(titles()).toEqual(loadedThreads.slice(0, 5).map(thread => thread.thread.preview));

    fireEvent.click(heading);
    expect(onToggleProjectCollapsed).toHaveBeenLastCalledWith("mini", cwd);
    rerender(cloneElement(element, { collapsedProjectKeys: new Set([`mini:${cwd}`]) }));
    expect(titles()).toEqual([]);
    fireEvent.click(heading);
    rerender(cloneElement(element, { collapsedProjectKeys: new Set() }));
    expect(titles()).toEqual(loadedThreads.slice(0, 5).map(thread => thread.thread.preview));

    fireEvent.click(view.getByRole("button", { name: "更多" }));
    expect(titles()).toEqual(loadedThreads.slice(0, 10).map(thread => thread.thread.preview));
    fireEvent.click(view.getByRole("button", { name: "更多" }));
    expect(titles()).toHaveLength(12);
    expect(view.queryByRole("button", { name: "更多" })).toBeNull();
    expect(onToggleProject).not.toHaveBeenCalled();

    fireEvent.click(heading);
    rerender(cloneElement(element, { collapsedProjectKeys: new Set([`mini:${cwd}`]) }));
    fireEvent.click(heading);
    rerender(cloneElement(element, { collapsedProjectKeys: new Set() }));
    expect(titles()).toEqual(loadedThreads.slice(0, 5).map(thread => thread.thread.preview));
    expect(view.getByRole("button", { name: "更多" })).not.toBeNull();
  });

  it.each([false, true])("外部折叠状态恢复展开时重置到五条（初始已折叠：%s）", (initiallyCollapsed) => {
    const loadedThreads = aggregateThreads([backend], {
      mini: Array.from({ length: 8 }, (_, index) => ({
        id: `external-${index}`, preview: `外部缓存 ${index}`, cwd: "/tmp/project-a", updatedAt: 100 - index,
      })),
    });
    const collapsedProjectKeys = new Set(["mini:/tmp/project-a"]);
    const { container, element, rerender } = renderList("mini", {
      visibleThreads: loadedThreads, projectDirectories: ["/tmp/project-a"],
      projectHasMore: { "/tmp/project-a": false },
      collapsedProjectKeys: initiallyCollapsed ? collapsedProjectKeys : new Set(),
    });
    if (!initiallyCollapsed) rerender(cloneElement(element, { collapsedProjectKeys }));
    rerender(cloneElement(element, { collapsedProjectKeys: new Set() }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(5);
    expect(within(container).getByRole("button", { name: "更多" })).not.toBeNull();
    expect(collapsedProjectKeys).toEqual(new Set(["mini:/tmp/project-a"]));
  });

  it("更多先展示缓存，缓存不足一批时继续服务端分页且限制到新增五条", () => {
    const loadedThreads = aggregateThreads([backend], {
      mini: Array.from({ length: 13 }, (_, index) => ({
        id: `paged-${index}`, preview: `分页会话 ${index}`, cwd: "/tmp/project-a", updatedAt: 100 - index,
      })),
    });
    const onToggleProject = vi.fn();
    const { container, element, rerender } = renderList("mini", {
      visibleThreads: loadedThreads.slice(0, 8), projectDirectories: ["/tmp/project-a"],
      collapsedProjectKeys: new Set(["mini:/tmp/project-a"]),
      projectHasMore: { "/tmp/project-a": true }, onToggleProject,
    });
    rerender(cloneElement(element, { collapsedProjectKeys: new Set() }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(5);
    fireEvent.click(within(container).getByRole("button", { name: "更多" }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(8);
    expect(onToggleProject).toHaveBeenCalledExactlyOnceWith("mini", "/tmp/project-a");
    rerender(cloneElement(element, { visibleThreads: loadedThreads, collapsedProjectKeys: new Set(), projectHasMore: { "/tmp/project-a": false } }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(10);
    fireEvent.click(within(container).getByRole("button", { name: "更多" }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(13);
    expect(onToggleProject).toHaveBeenCalledOnce();
  });

  it("一整批缓存展示完后，再点更多才请求服务端下一页", () => {
    const loadedThreads = aggregateThreads([backend], {
      mini: Array.from({ length: 15 }, (_, index) => ({
        id: `exhausted-${index}`, preview: `缓存分页 ${index}`, cwd: "/tmp/project-a", updatedAt: 100 - index,
      })),
    });
    const onToggleProject = vi.fn();
    const { container, element, rerender } = renderList("mini", {
      visibleThreads: loadedThreads.slice(0, 10), projectDirectories: ["/tmp/project-a"],
      collapsedProjectKeys: new Set(["mini:/tmp/project-a"]),
      projectHasMore: { "/tmp/project-a": true }, onToggleProject,
    });
    rerender(cloneElement(element, { collapsedProjectKeys: new Set() }));
    fireEvent.click(within(container).getByRole("button", { name: "更多" }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(10);
    expect(onToggleProject).not.toHaveBeenCalled();
    fireEvent.click(within(container).getByRole("button", { name: "更多" }));
    expect(onToggleProject).toHaveBeenCalledExactlyOnceWith("mini", "/tmp/project-a");
    rerender(cloneElement(element, { visibleThreads: loadedThreads, collapsedProjectKeys: new Set(), projectHasMore: { "/tmp/project-a": false } }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(15);
    expect(within(container).queryByRole("button", { name: "更多" })).toBeNull();
  });

  it("搜索临时展示全部命中并在退出后保留正常展示上限与折叠状态", () => {
    const loadedThreads = aggregateThreads([backend], {
      mini: Array.from({ length: 12 }, (_, index) => ({
        id: `search-${index}`, preview: `搜索会话 ${index}`, cwd: "/tmp/project-a", updatedAt: 100 - index,
      })),
    });
    const collapsedProjectKeys = new Set(["mini:/tmp/project-a"]);
    const { container, element, rerender } = renderList("mini", {
      visibleThreads: loadedThreads, projectDirectories: ["/tmp/project-a"],
      collapsedProjectKeys, projectHasMore: { "/tmp/project-a": false },
    });
    rerender(cloneElement(element, { query: "搜索" }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(12);
    rerender(cloneElement(element, { query: "" }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(0);
    rerender(cloneElement(element, { collapsedProjectKeys: new Set() }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(5);
    fireEvent.click(within(container).getByRole("button", { name: "更多" }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(10);
    rerender(cloneElement(element, { collapsedProjectKeys: new Set(), query: "搜索" }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(12);
    rerender(cloneElement(element, { collapsedProjectKeys: new Set() }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(10);
    expect(collapsedProjectKeys).toEqual(new Set(["mini:/tmp/project-a"]));
  });

  it("项目展示上限按设备和目录隔离，关注区及全部视图保留全部会话", () => {
    const otherBackend = { ...backend, id: "other", name: "另一台设备" };
    const loadedThreads = aggregateThreads([backend, otherBackend], {
      mini: [
        ...Array.from({ length: 7 }, (_, index) => ({ id: `pinned-${index}`, preview: `关注 ${index}`, cwd: "/tmp/project-a", isPinned: true })),
        ...["a", "b"].flatMap(project => Array.from({ length: 8 }, (_, index) => ({ id: `${project}-${index}`, preview: `${project} 会话 ${index}`, cwd: `/tmp/project-${project}`, updatedAt: 100 - index }))),
      ],
      other: Array.from({ length: 8 }, (_, index) => ({ id: `other-${index}`, preview: `另一设备 ${index}`, cwd: "/tmp/project-a", updatedAt: 100 - index })),
    });
    const miniThreads = loadedThreads.filter(thread => thread.backendId === "mini");
    const { container, element, rerender } = renderList("mini", {
      visibleThreads: miniThreads, collapsedProjectKeys: new Set(["mini:/tmp/project-a"]),
      projectHasMore: { "/tmp/project-a": false, "/tmp/project-b": false },
    });
    rerender(cloneElement(element, { collapsedProjectKeys: new Set() }));
    const view = within(container);
    const projectA = view.getByRole("button", { name: "project-a" }).closest(".project-group") as HTMLElement;
    const projectB = view.getByRole("button", { name: "project-b" }).closest(".project-group") as HTMLElement;
    expect(projectA.querySelectorAll(".thread-row")).toHaveLength(5);
    expect(projectB.querySelectorAll(".thread-row")).toHaveLength(5);
    expect(view.getByRole("heading", { name: "关注" }).parentElement?.querySelectorAll(".thread-row")).toHaveLength(7);

    rerender(cloneElement(element, { selectedBackendId: "other", backends: [backend, otherBackend], visibleThreads: loadedThreads.filter(thread => thread.backendId === "other"), collapsedProjectKeys: new Set() }));
    expect(container.querySelectorAll(".project-group .thread-row")).toHaveLength(5);
    rerender(cloneElement(element, { selectedBackendId: "all", visibleThreads: loadedThreads, collapsedProjectKeys: new Set() }));
    expect(view.getByRole("heading", { name: "关注" }).parentElement?.querySelectorAll(".thread-row")).toHaveLength(7);
    expect(view.getByRole("heading", { name: "最近" }).parentElement?.querySelectorAll(".thread-row")).toHaveLength(24);
  });

  it("项目历史已经完整加载时不再显示更多", () => {
    const { container } = renderList("mini", {
      projectHasMore: {
        "/tmp/project-a": false,
        "/tmp/project-b": false,
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
    expect(view.getByText("关注会话")).not.toBeNull();
    expect(view.getAllByText("最近会话")).toHaveLength(1);

    fireEvent.click(projectButton);
    expect(onToggleProjectCollapsed).toHaveBeenCalledWith(
      "mini",
      "/tmp/project-a",
    );
  });

  it("搜索关注会话只显示关注区，不改变折叠缓存", () => {
    const collapsedProjectKeys = new Set(["mini:/tmp/project-a"]);
    const { container } = renderList("mini", {
      collapsedProjectKeys,
      query: "关注",
    });
    const view = within(container);

    expect(view.getByRole("heading", { name: "关注" })).not.toBeNull();
    expect(view.getAllByText("关注会话")).toHaveLength(1);
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

    const unreadMarkers = within(container).getAllByLabelText("未读");
    expect(unreadMarkers).toHaveLength(1);
    for (const unread of unreadMarkers) {
      const meta = unread.closest(".thread-row-meta");
      expect(meta).not.toBeNull();
      expect(within(meta as HTMLElement).getByText("1 分钟")).not.toBeNull();
      expect(meta?.firstElementChild).toBe(unread);
    }
    now.mockRestore();
  });
});


describe("项目排序回退", () => {
  it("项目标题保留折叠操作并移除排序手柄", () => {
    const onToggleProjectCollapsed = vi.fn();
    const { container } = renderList("mini", { onToggleProjectCollapsed });
    const view = within(container);
    expect(view.queryAllByRole("button", { name: "调整项目顺序" })).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "project-a" }));
    expect(onToggleProjectCollapsed).toHaveBeenCalledExactlyOnceWith("mini", "/tmp/project-a");
  });
});
