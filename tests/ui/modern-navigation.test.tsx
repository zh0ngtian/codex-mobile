import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendManagerSheet } from "../../src/features/backends/BackendManagerSheet";
import { ThreadListPage } from "../../src/features/threads/ThreadListPage";
import { aggregateThreads } from "../../src/features/threads/thread-list-model";
import { WebInterfaceProvider, WEB_INTERFACE_KEY, useWebInterface } from "../../src/features/web-ui/preference";
import { useSidebarSwipe } from "../../src/features/threads/sidebar-swipe";
import { I18nProvider } from "../../src/i18n";
import type { BackendConfig, BackendRuntimeSummary } from "../../src/backends/types";

const backends: BackendConfig[] = [
  { id: "mini", name: "Mac mini", baseUrl: "http://mini.local", token: "", enabled: true, order: 0 },
  { id: "book", name: "MacBook", baseUrl: "http://book.local", token: "", enabled: true, order: 1 },
  { id: "paused", name: "已暂停的设备", baseUrl: "http://paused.local", token: "", enabled: false, order: 2 },
];
const summaries: Record<string, BackendRuntimeSummary> = {
  mini: { backendId: "mini", connection: "online", busy: false, approvalCount: 0, error: "" },
  book: { backendId: "book", connection: "offline", busy: false, approvalCount: 2, error: "" },
};
const threads = aggregateThreads(backends, { mini: [
  { id: "pin", preview: "关注的对话", cwd: "/work/app", isPinned: true, updatedAt: 2 },
  { id: "recent", preview: "项目中的对话", cwd: "/work/app", updatedAt: 1 },
] });
const listProps = {
  sidebarOpen: true, backends, summaries, selectedBackendId: "mini", loadingBackendIds: new Set(["book"]), refreshing: false,
  threadListState: "ready" as const, visibleThreads: threads, totalThreadCount: threads.length,
  projectDirectories: ["/work/app"], hasProjectlessThreads: false, projectThreadStates: {}, projectHasMore: {},
  collapsedProjectKeys: new Set<string>(), loadingProjectKeys: new Set<string>(), openingThreadId: "", query: "", searching: false, error: "",
  onQueryChange: vi.fn(), onOpenThread: vi.fn(), onManageThread: vi.fn(async () => true), onNewChat: vi.fn(),
  onSelectBackend: vi.fn(), onManageBackends: vi.fn(), onRefresh: vi.fn(), onOpenDrafts: vi.fn(), onCloseSidebar: vi.fn(),
  onRetryProject: vi.fn(), onToggleProject: vi.fn(), onToggleProjectCollapsed: vi.fn(),
};
function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider navigatorLanguage="zh-CN"><WebInterfaceProvider>{children}</WebInterfaceProvider></I18nProvider>;
}
function renderSettings(extra: Partial<ComponentProps<typeof BackendManagerSheet>> = {}) {
  return render(<BackendManagerSheet open registry={{ version: 1, selectedBackendId: "mini", backends }} summaries={summaries}
    onChange={vi.fn()} onClose={vi.fn()} appUpdate={{ supported: true, manualCheckSupported: true, currentVersion: "0.2.234", checking: false, onCheck: vi.fn() }}
    notificationPreference={{ mode: "system", barkUrl: "" }} onNotificationPreferenceSave={vi.fn()} {...extra} />, { wrapper: Wrapper });
}
beforeEach(() => { localStorage.clear(); localStorage.setItem(WEB_INTERFACE_KEY, "modern"); vi.clearAllMocks(); });
afterEach(() => { cleanup(); localStorage.clear(); document.documentElement.style.removeProperty("--app-font-scale"); });

describe("新版侧栏", () => {
  it("顶部关闭与底部新对话连接真实回调，设备标题打开筛选菜单", () => {
    render(<ThreadListPage {...listProps} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole("button", { name: "关闭侧栏" }));
    expect(listProps.onCloseSidebar).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    expect(listProps.onNewChat).toHaveBeenCalledOnce();
    const title = screen.getByRole("button", { name: /Codex.*Mac mini.*已连接/ });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(title);
    const menu = within(screen.getByRole("menu", { name: "设备菜单" }));
    expect(menu.getByRole("menuitemradio", { name: /Mac mini/ })).toHaveAttribute("aria-checked", "true");
    expect(menu.queryByText("已暂停的设备")).not.toBeInTheDocument();
    expect(menu.queryByText("管理设备")).not.toBeInTheDocument();
    fireEvent.click(menu.getByRole("menuitemradio", { name: /MacBook.*已断开.*正在加载会话.*2 个待审批/ }));
    expect(listProps.onSelectBackend).toHaveBeenCalledWith("book");
    expect(listProps.onOpenThread).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(title);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "全部设备" }));
    expect(listProps.onSelectBackend).toHaveBeenLastCalledWith("all");
  });

  it("在线设备副标题只展示名称，连接状态仍可由辅助技术读取", () => {
    const view = render(<ThreadListPage {...listProps} />, { wrapper: Wrapper });
    const title = screen.getByRole("button", { name: /Codex.*Mac mini.*已连接/ });
    expect(title).not.toHaveTextContent("已连接");
    expect(title).toHaveTextContent("Mac mini");
    view.rerender(<ThreadListPage {...listProps} selectedBackendId="book" />);
    expect(screen.getByRole("button", { name: /Codex.*MacBook.*已断开/ })).toHaveTextContent("已断开");
  });

  it("标题、菜单和新建按钮的触摸不会触发侧栏左滑，列表仍可左滑关闭", () => {
    const onClose = vi.fn();
    function Sidebar() {
      const ref = useSidebarSwipe(true, vi.fn(), onClose);
      return <div ref={ref} className="conversation-sidebar-layer open"><aside className="conversation-sidebar"><ThreadListPage {...listProps} /></aside></div>;
    }
    const { container } = render(<Sidebar />, { wrapper: Wrapper });
    const panel = container.querySelector("aside")!;
    panel.getBoundingClientRect = () => ({ width: 393 }) as DOMRect;
    const swipe = (target: Element) => {
      for (const [type, touches] of [["touchstart", [{ clientX: 300, clientY: 100 }]], ["touchmove", [{ clientX: 100, clientY: 102 }]], ["touchend", []]] as const) {
        fireEvent(target, Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches }));
      }
    };
    const title = screen.getByRole("button", { name: /Codex.*Mac mini/ });
    swipe(title);
    fireEvent.click(title);
    swipe(screen.getByRole("menuitemradio", { name: /MacBook/ }));
    swipe(screen.getByRole("button", { name: "新建对话" }));
    expect(onClose).not.toHaveBeenCalled();
    swipe(panel);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("长按 500ms 才打开真实会话操作，取消指针不会误触且点击仍能打开会话", async () => {
    vi.useFakeTimers();
    try {
      render(<ThreadListPage {...listProps} />, { wrapper: Wrapper });
      const row = screen.getByRole("button", { name: /关注的对话/ });
      fireEvent.pointerDown(row, { button: 0, clientX: 20, clientY: 20 });
      act(() => vi.advanceTimersByTime(499));
      expect(screen.queryByLabelText("会话操作")).not.toBeInTheDocument();
      fireEvent.pointerCancel(row);
      act(() => vi.advanceTimersByTime(100));
      expect(screen.queryByLabelText("会话操作")).not.toBeInTheDocument();
      fireEvent.click(row);
      expect(listProps.onOpenThread).toHaveBeenCalledOnce();
      fireEvent.pointerDown(row, { button: 0, clientX: 20, clientY: 20 });
      act(() => vi.advanceTimersByTime(500));
      fireEvent.pointerUp(row);
      fireEvent.click(row);
      expect(listProps.onOpenThread).toHaveBeenCalledOnce();
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "取消关注" })); });
      expect(listProps.onManageThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: "pin" }), "pin");
    } finally { vi.useRealTimers(); }
  });

  it("菜单草稿、设置、刷新复用回调，Escape 与外部点击关闭菜单", () => {
    render(<ThreadListPage {...listProps} />, { wrapper: Wrapper });
    const title = screen.getByRole("button", { name: /Codex.*Mac mini/ });
    for (const [label, callback] of [["草稿", listProps.onOpenDrafts], ["设置", listProps.onManageBackends], ["刷新会话列表", listProps.onRefresh]] as const) {
      fireEvent.click(title);
      fireEvent.click(screen.getByRole("menuitem", { name: label }));
      expect(callback).toHaveBeenCalledOnce();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    }
    fireEvent.click(title);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(title);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("搜索使用真实受控输入，关闭侧栏收起搜索与设备菜单", () => {
    function SearchList({ open }: { open: boolean }) {
      const [query, setQuery] = useState("");
      return <ThreadListPage {...listProps} sidebarOpen={open} query={query} searching={Boolean(query)}
        visibleThreads={threads.map(thread => ({ ...thread, searchSnippet: "找到的真实消息" }))}
        onQueryChange={value => { listProps.onQueryChange(value); setQuery(value); }} />;
    }
    const view = render(<SearchList open />, { wrapper: Wrapper });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "搜索会话" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索聊天" }), { target: { value: "真实" } });
    expect(listProps.onQueryChange).toHaveBeenCalledWith("真实");
    expect(screen.getByRole("searchbox")).toHaveValue("真实");
    expect(screen.getByRole("status", { name: "正在搜索会话" })).toBeInTheDocument();
    expect(screen.getAllByText("找到的真实消息")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Codex.*Mac mini/ }));
    view.rerender(<SearchList open={false} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    view.rerender(<SearchList open />);
    expect(screen.getByRole("searchbox")).toHaveValue("真实");
    fireEvent.click(screen.getByRole("button", { name: "搜索会话" }));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(listProps.onQueryChange).toHaveBeenLastCalledWith("");
    expect(screen.queryByRole("status", { name: "正在搜索会话" })).not.toBeInTheDocument();
  });

  it("切换新版时显示已有查询，避免隐藏的过滤条件", () => {
    localStorage.setItem(WEB_INTERFACE_KEY, "legacy");
    function SwitchingList() {
      const { change } = useWebInterface();
      return <><button onClick={() => change(true)}>切换新版</button><ThreadListPage {...listProps} query="已有关键词" /></>;
    }
    render(<SwitchingList />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole("button", { name: "切换新版" }));
    expect(screen.getByRole("searchbox")).toHaveValue("已有关键词");
  });

  it("单设备保留项目折叠，全设备只显示关注与最近且每行只出现一次", () => {
    const view = render(<ThreadListPage {...listProps} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole("button", { name: "app" }));
    expect(listProps.onToggleProjectCollapsed).toHaveBeenCalledWith("mini", "/work/app");
    expect(screen.queryByRole("button", { name: /编辑.*app/ })).not.toBeInTheDocument();
    view.rerender(<ThreadListPage {...listProps} selectedBackendId="all" />);
    expect(screen.getByRole("heading", { name: "最近" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "app" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /项目中的对话/ })).toHaveLength(1);
  });
});

describe("新版全局设置", () => {
  it("根页按应用、连接、通知分组并显示真实版本，不提供更新入口", () => {
    renderSettings();
    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument();
    for (const label of ["应用", "连接", "通知"]) expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    for (const label of ["语言", "字体大小", "设备", "传输方式", "通知"]) expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    expect(screen.getByText("当前版本 v0.2.234")).toBeInTheDocument();
    expect(screen.queryByText("应用更新")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "检查更新" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "使用原生界面" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "使用新版界面" }));
    expect(screen.getByRole("dialog", { name: "管理设备" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument();
    expect(localStorage.getItem(WEB_INTERFACE_KEY)).toBe("legacy");
  });

  it("语言与字号子页沿用保存状态，返回根页后可继续设置", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "语言" }));
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(localStorage.getItem("codex-mobile:language")).toBe("zh-CN");
    fireEvent.click(screen.getByRole("button", { name: "返回设置" }));
    fireEvent.click(screen.getByRole("button", { name: "字体大小" }));
    fireEvent.click(screen.getByRole("button", { name: "特大" }));
    expect(localStorage.getItem("codex-mobile:font-size")).toBe("extra-large");
    fireEvent.click(screen.getByRole("button", { name: "返回设置" }));
    expect(screen.getByRole("button", { name: "字体大小" })).toHaveTextContent("特大");
  });

  it("传输与通知子页调用原有回调并保留未保存的 Bark 输入", () => {
    const onTransportModeChange = vi.fn();
    const onNotificationPreferenceSave = vi.fn();
    renderSettings({ onTransportModeChange, onNotificationPreferenceSave });
    fireEvent.click(screen.getByRole("button", { name: "传输方式" }));
    fireEvent.click(screen.getByRole("button", { name: "流式" }));
    expect(onTransportModeChange).toHaveBeenCalledWith("stream");
    fireEvent.click(screen.getByRole("button", { name: "返回设置" }));
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    fireEvent.click(screen.getByRole("radio", { name: "Bark 推送" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Bark 推送链接" }), { target: { value: "https://api.day.app/test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "返回设置" }));
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    expect(screen.getByRole("textbox", { name: "Bark 推送链接" })).toHaveValue("https://api.day.app/test-key");
    fireEvent.click(screen.getByRole("button", { name: "保存推送设置" }));
    expect(onNotificationPreferenceSave).toHaveBeenCalledWith({ mode: "bark", barkUrl: "https://api.day.app/test-key" });
  });

  it("设备子页保留管理操作，编辑草稿切换界面时不丢失", () => {
    const onChange = vi.fn();
    renderSettings({ onChange });
    fireEvent.click(screen.getByRole("button", { name: "设备" }));
    fireEvent.click(screen.getByRole("button", { name: "暂停 Mac mini" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ backends: expect.arrayContaining([expect.objectContaining({ id: "mini", enabled: false })]) }));
    fireEvent.click(screen.getByRole("button", { name: "编辑 Mac mini" }));
    fireEvent.change(screen.getByRole("textbox", { name: "设备名称" }), { target: { value: "未保存名称" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "使用新版界面" }));
    expect(screen.getByRole("textbox", { name: "设备名称" })).toHaveValue("未保存名称");
    fireEvent.click(screen.getByRole("checkbox", { name: "使用新版界面" }));
    expect(screen.getByRole("textbox", { name: "设备名称" })).toHaveValue("未保存名称");
    fireEvent.click(screen.getByRole("button", { name: "返回设备" }));
    expect(screen.getByRole("button", { name: "添加设备" })).toBeInTheDocument();
  });
});
