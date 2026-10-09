import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadListPage, type ThreadListPageProps } from "../../src/features/threads/ThreadListPage";
import { aggregateThreads } from "../../src/features/threads/thread-list-model";
import type { BackendConfig } from "../../src/backends/types";

const backend: BackendConfig = {
  id: "mini", name: "Mac mini", baseUrl: "http://mini.local:4173",
  token: "", enabled: true, order: 0,
};
const threads = aggregateThreads([backend], {
  mini: [{ id: "recent", preview: "修复网页搜索", cwd: "/tmp/project-a", updatedAt: 20 }],
});
function props(overrides: Partial<ThreadListPageProps> = {}): ThreadListPageProps {
  return {
    backends: [backend], summaries: {
      mini: { backendId: "mini", connection: "online", busy: false, approvalCount: 2, error: "" },
    },
    selectedBackendId: "all", loadingBackendIds: new Set(), refreshing: false,
    threadListState: "ready", visibleThreads: threads, totalThreadCount: 1,
    projectDirectories: [], hasProjectlessThreads: false, projectThreadStates: {},
    projectHasMore: {}, collapsedProjectKeys: new Set(), loadingProjectKeys: new Set(),
    openingThreadId: "", query: "", searching: false, error: "",
    onQueryChange: vi.fn(), onOpenThread: vi.fn(), onManageThread: vi.fn(async () => true),
    onNewChat: vi.fn(), onSelectBackend: vi.fn(), onManageBackends: vi.fn(),
    onRefresh: vi.fn(), onRetryProject: vi.fn(), onToggleProject: vi.fn(),
    onToggleProjectCollapsed: vi.fn(), onClose: vi.fn(), nativeVisible: true,
    ...overrides,
  };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Web 边栏可操作性", () => {
  it("搜索有明确名称，清除后继续保持输入焦点", () => {
    const p = props({ query: "搜索" });
    const { container } = render(<ThreadListPage {...p} />);
    const view = within(container);
    const search = view.getByRole("textbox", { name: "搜索聊天" });
    search.focus();
    fireEvent.click(view.getByRole("button", { name: "清除搜索" }));
    expect(p.onQueryChange).toHaveBeenCalledWith("");
    expect(document.activeElement).toBe(search);
  });

  it("关闭边栏先释放搜索焦点，再通知父级", () => {
    const p = props();
    p.onClose = vi.fn(() => expect(document.activeElement?.tagName).not.toBe("INPUT"));
    const { container } = render(<ThreadListPage {...p} />);
    const view = within(container);
    view.getByRole("textbox").focus();
    fireEvent.click(view.getByRole("button", { name: "关闭会话列表" }));
    expect(p.onClose).toHaveBeenCalledOnce();
  });

  it("通过遮罩关闭时也释放隐藏输入焦点", () => {
    const p = props();
    const { container, rerender } = render(<ThreadListPage {...p} />);
    const search = within(container).getByRole("textbox");
    search.focus();
    rerender(<ThreadListPage {...p} nativeVisible={false} />);
    expect(document.activeElement).not.toBe(search);
  });

  it("搜索失败优先显示错误与重试，不宣称没有结果", () => {
    const p = props({ query: "搜索", visibleThreads: [], error: "搜索请求超时" });
    const { container } = render(<ThreadListPage {...p} />);
    const view = within(container);
    expect(view.getByRole("alert")).toHaveTextContent("搜索请求超时");
    expect(view.queryByText("没有匹配的对话")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "重试" }));
    expect(p.onRefresh).toHaveBeenCalledOnce();
    expect(within(container).getByRole("textbox")).toHaveValue("搜索");
  });

  it("搜索没有结果时提供可操作的清除建议", () => {
    const p = props({ query: "搜索", visibleThreads: [] });
    const { container } = render(<ThreadListPage {...p} />);
    const view = within(container);
    expect(view.getByText("没有匹配的对话")).not.toBeNull();
    expect(view.getByText("试试其他关键词，或清除搜索查看全部聊天。")).not.toBeNull();
    const state = view.getByText("没有匹配的对话").closest(".empty-state") as HTMLElement;
    fireEvent.click(within(state).getByRole("button", { name: "清除搜索" }));
    expect(p.onQueryChange).toHaveBeenCalledWith("");
  });

  it("接入公共 ActionSheet 后只展示一个语义对话框", () => {
    const { container } = render(<ThreadListPage {...props()} />);
    const view = within(container);
    fireEvent.click(view.getByRole("button", { name: "会话详情操作" }));
    const dialogs = view.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveAccessibleName("会话操作");
  });

  it("公共菜单支持鼠标遮罩关闭并保持会话未被误开", () => {
    const p = props();
    const { container } = render(<ThreadListPage {...p} />);
    const view = within(container);
    const manage = view.getByRole("button", { name: "会话详情操作" });
    fireEvent.click(manage);
    const backdrop = view.getByRole("dialog", { name: "会话操作" }).parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(view.queryByRole("dialog")).toBeNull();
    expect(p.onOpenThread).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(manage);
  });

  it("可见管理按钮支持键盘焦点、Escape 关闭与焦点恢复", () => {
    const { container } = render(<ThreadListPage {...props()} />);
    const view = within(container);
    const manage = view.getByRole("button", { name: "会话详情操作" });
    manage.focus();
    fireEvent.click(manage);
    const dialog = view.getByRole("dialog", { name: "会话操作" });
    const menuActions = within(dialog).getAllByRole("button");
    expect(document.activeElement).toBe(menuActions[0]);
    menuActions.at(-1)?.focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
    expect(document.activeElement).toBe(menuActions[0]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(menuActions.at(-1));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(manage);
  });

  it("归档移除当前会话后将焦点留在可用的边栏操作上", async () => {
    const p = props();
    const result = render(<ThreadListPage {...p} />);
    p.onManageThread = async () => {
      result.rerender(<ThreadListPage {...p} visibleThreads={[]} />);
      return true;
    };
    result.rerender(<ThreadListPage {...p} />);
    const view = within(result.container);
    fireEvent.click(view.getByRole("button", { name: "会话详情操作" }));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "归档" }));
      await Promise.resolve();
    });
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(view.getByRole("button", { name: "关闭会话列表" }));
  });

  it("列表滚动会取消尚未触发的长按", () => {
    vi.useFakeTimers();
    const { container } = render(<ThreadListPage {...props()} />);
    const view = within(container);
    const row = view.getByRole("button", { name: /修复网页搜索/ });
    fireEvent.pointerDown(row, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.scroll(container.querySelector(".thread-list") as HTMLElement);
    act(() => vi.advanceTimersByTime(550));
    expect(view.queryByLabelText("会话操作")).toBeNull();
  });

  it("全部设备的审批汇总可被读屏辨认", () => {
    const { container } = render(<ThreadListPage {...props()} />);
    expect(within(container).getByRole("button", { name: "全部设备，2 个待审批" })).not.toBeNull();
  });

  it("设备连接与审批以文字可见，加载时仍保留连接状态", () => {
    const { container } = render(<ThreadListPage {...props({ loadingBackendIds: new Set(["mini"]) })} />);
    const device = within(container).getByRole("button", { name: /Mac mini.*2 个待审批/ });
    expect(within(device).getByText("已连接")).not.toBeNull();
    expect(within(device).getByText("2 个待审批")).not.toBeNull();
    expect(within(device).getByLabelText("正在加载机器会话")).not.toBeNull();
  });
});
