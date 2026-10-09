import { useState } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadListPage } from "../../src/features/threads/ThreadListPage";
import { aggregateThreads } from "../../src/features/threads/thread-list-model";

const posts: any[] = [];
const opened = vi.fn(); const managed = vi.fn(async () => true);
const select = vi.fn(); const closed = vi.fn(); const newChat = vi.fn();
const backends = [{ id: "mac", name: "Mac", enabled: true, baseUrl: "http://localhost", token: "", order: 0 }];
const rows = aggregateThreads(backends, { mac: [
  { id: "pin", name: "置顶任务", cwd: "/workspace/项目", isPinned: true, updatedAt: 3 },
  { id: "read", name: "中文会话", cwd: "/workspace/项目", updatedAt: 2, searchSnippet: "这是 全文 搜索摘要" },
  { id: "unread", name: "未读回复", cwd: "/workspace/项目", updatedAt: 1, isUnread: true },
] });
function Harness({ visible = true, backend = "all", offline = false }: { visible?: boolean; backend?: string; offline?: boolean }) {
  const [query, setQuery] = useState("");
  return <ThreadListPage {...{ nativeVisible: visible, onClose: closed }} backends={backends}
    summaries={{ mac: { backendId: "mac", connection: offline ? "offline" : "online", approvalCount: 2 } } as any}
    selectedBackendId={backend} loadingBackendIds={new Set()} refreshing={false} searching={false}
    threadListState="ready" visibleThreads={rows} totalThreadCount={3}
    projectDirectories={["/workspace/项目"]} hasProjectlessThreads={false}
    projectThreadStates={{ "/workspace/项目": "ready" }} projectHasMore={{ "/workspace/项目": true }}
    collapsedProjectKeys={new Set(["mac:/workspace/项目"])} loadingProjectKeys={new Set()}
    openingThreadId="" query={query} error="" onQueryChange={setQuery} onOpenThread={opened}
    onManageThread={managed} onNewChat={newChat} onSelectBackend={select} onManageBackends={() => {}}
    onRefresh={() => {}} onRetryProject={() => {}} onToggleProject={() => {}} onToggleProjectCollapsed={() => {}} />;
}
function latest() { return posts.filter((post) => post.type === "snapshot").at(-1)?.snapshot; }
function action(type: string, sequence: number, extra: Record<string, unknown> = {}) {
  act(() => window.dispatchEvent(new CustomEvent("codex-mobile-native-sidebar-action", {
    detail: { contextId: latest()?.contextId, type, sequence, ...extra },
  })));
}
beforeEach(() => {
  posts.length = 0; vi.clearAllMocks();
  Object.assign(window, { __codexNativeSidebarReady: true, webkit: { messageHandlers: {
    nativeSidebar: { postMessage: (value: unknown) => posts.push(value) },
  } } });
});
afterEach(() => { cleanup(); delete (window as any).webkit; delete (window as any).__codexNativeSidebarReady; });
describe("iOS 原生边栏", () => {
  it("桥发送失败回退网页，ready 恢复后重新发送未变化的快照", async () => {
    const handler = (window as any).webkit.messageHandlers.nativeSidebar;
    const working = handler.postMessage;
    handler.postMessage = () => { throw new Error("temporary bridge failure"); };
    render(<Harness />);
    await waitFor(() => expect(document.querySelector(".thread-list-page")).toHaveAttribute("data-native-sidebar", "false"));
    handler.postMessage = working;
    act(() => window.dispatchEvent(new Event("codex-mobile-native-sidebar-ready")));
    await waitFor(() => expect(latest()?.visible).toBe(true));
    expect(document.querySelector(".thread-list-page")).toHaveAttribute("data-native-sidebar", "true");
  });

  it("投影置顶与未读优先、稳定身份、来源和设备审批状态", async () => {
    render(<Harness />);
    await waitFor(() => expect(latest()).toBeDefined());
    expect(latest().sections[0].rows.map((row: any) => row.id)).toEqual(["mac:pin", "mac:unread"]);
    expect(latest().sections[1].rows[0]).toMatchObject({ id: "mac:read", title: "中文会话", source: "Mac · 项目" });
    expect(latest().backends[1]).toMatchObject({ id: "mac", approvalCount: 2, online: true });
    expect(latest().version).toBe(1);
    expect(document.querySelector(".thread-list-page")).toHaveAttribute("data-native-sidebar", "true");
  });
  it("保留项目折叠与分页，搜索展开项目并显示全文摘要", async () => {
    render(<Harness backend="mac" />);
    await waitFor(() => expect(latest()).toBeDefined());
    const project = latest().sections.find((section: any) => section.collapsible);
    expect(project).toMatchObject({ expanded: false, more: true, backendId: "mac", cwd: "/workspace/项目" });
    action("query", 1, { text: "全文" });
    await waitFor(() => expect(latest().query).toBe("全文"));
    expect(latest().acknowledgedSequence).toBe(1);
    expect(latest().sections.find((section: any) => section.collapsible).expanded).toBe(true);
    expect(latest().sections.flatMap((section: any) => section.rows).find((row: any) => row.id === "mac:read").snippet).toBe("这是 全文 搜索摘要");
  });
  it("只分派有效当前事件，拒绝重复、旧上下文和不存在的会话与设备", async () => {
    render(<Harness />); await waitFor(() => expect(latest()).toBeDefined());
    action("open", 1, { id: "mac:read" }); action("open", 1, { id: "mac:read" });
    action("open", 2, { contextId: "old", id: "mac:read" });
    action("open", 3, { id: "other:read" }); action("backend", 4, { id: "missing" });
    expect(opened).toHaveBeenCalledExactlyOnceWith(rows.find((row) => row.threadId === "read"));
    expect(select).not.toHaveBeenCalled();
  });
  it("原生重命名直接复用业务回调与名称，离线拒绝写入", async () => {
    const result = render(<Harness />); await waitFor(() => expect(latest()).toBeDefined());
    action("rename", 1, { id: "mac:read", text: "  新名称  " });
    await waitFor(() => expect(managed).toHaveBeenCalledWith(rows.find((row) => row.threadId === "read"), "rename", "新名称"));
    await waitFor(() => expect(latest().pendingAction).toBe(""));
    result.rerender(<Harness offline />);
    action("archive", 2, { id: "mac:read" });
    expect(managed).toHaveBeenCalledTimes(1);
    expect(latest().sections[1].rows[0].readOnly).toBe(true);
  });
  it("管理请求异常显示错误并解除处理中状态，允许重试", async () => {
    render(<Harness />); await waitFor(() => expect(latest()).toBeDefined());
    managed.mockRejectedValueOnce(new Error("网络中断"));
    action("rename", 1, { id: "mac:read", text: "新名称" });
    await waitFor(() => expect(latest().error).toBe("网络中断"));
    expect(latest().pendingAction).toBe("");
    action("pin", 2, { id: "mac:read" });
    await waitFor(() => expect(managed).toHaveBeenCalledTimes(2));
  });
  it("隐藏或网页弹层时暂停原生，恢复后继续使用同一业务状态", async () => {
    const result = render(<Harness />); await waitFor(() => expect(latest()?.visible).toBe(true));
    const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog");
    act(() => document.body.append(dialog));
    await waitFor(() => expect(latest().visible).toBe(false));
    expect(document.querySelector(".thread-list-page")).toHaveAttribute("data-native-sidebar", "false");
    action("new", 1); expect(newChat).not.toHaveBeenCalled();
    act(() => dialog.remove()); await waitFor(() => expect(latest().visible).toBe(true));
    action("close", 2); expect(closed).toHaveBeenCalledOnce();
    result.rerender(<Harness visible={false} />);
    await waitFor(() => expect(latest().visible).toBe(false));
    action("open", 3, { id: "mac:read" }); expect(opened).not.toHaveBeenCalled();
    result.unmount(); expect(posts.at(-1).type).toBe("hide");
  });
});
