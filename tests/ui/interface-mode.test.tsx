import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InterfaceModeSettings } from "../../src/features/settings/InterfaceModeSettings";
import { useNativeConversation } from "../../src/features/conversation/useNativeConversation";
import { useNativeSidebar } from "../../src/features/threads/useNativeSidebar";
import { BackendManagerSheet } from "../../src/features/backends/BackendManagerSheet";
const key = "codex-mobile:interface-mode";
const props = { open: true, registry: { version: 1 as const, backends: [], selectedBackendId: "all" }, summaries: {}, onChange: () => {}, onClose: () => {} };
beforeEach(() => {
  window.localStorage.clear();
  Object.assign(window, { __codexNativeConversationReady: true, __codexNativeSidebarReady: true, webkit: { messageHandlers: {
    nativeConversation: { postMessage: () => {} }, nativeSidebar: { postMessage: () => {} },
  } } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); window.localStorage.clear();
  act(() => window.dispatchEvent(new StorageEvent("storage", { key, newValue: null })));
  delete (window as any).webkit; delete (window as any).__codexNativeConversationReady; delete (window as any).__codexNativeSidebarReady;
});
function BothBridges() {
  useNativeConversation({ foreground: true,
    snapshot: { contextId: "shared:conversation", draft: "同一草稿", enabled: true } as any,
    hasAttachments: false, submissionBlocked: false, suspended: false,
    onDraftChange: () => {}, onAction: () => {},
  });
  useNativeSidebar({ nativeVisible: true, backends: [], summaries: {}, selectedBackendId: "all",
    visibleThreads: [], query: "", error: "", projectDirectories: [], hasProjectlessThreads: false,
    threadListState: "ready", totalThreadCount: 0, refreshing: false, searching: false,
    loadingBackendIds: new Set(), collapsedProjectKeys: new Set(), loadingProjectKeys: new Set(),
    projectThreadStates: {}, projectHasMore: {}, openingThreadId: "",
  } as any);
  return <InterfaceModeSettings />;
}
describe("界面体验对比", () => {
  it("通过同一个设置入口同步隐藏两个原生桥，并恢复同一数据", async () => {
    const conversation: any[] = [], sidebar: any[] = [];
    (window as any).webkit.messageHandlers.nativeConversation.postMessage = (post: any) => conversation.push(post);
    (window as any).webkit.messageHandlers.nativeSidebar.postMessage = (post: any) => sidebar.push(post);
    render(<BothBridges />);
    await waitFor(() => expect(conversation.at(-1)?.snapshot.visible).toBe(true));
    await waitFor(() => expect(sidebar.at(-1)?.snapshot.visible).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "网页界面" }));
    await waitFor(() => expect(conversation.at(-1)?.type).toBe("hide"));
    await waitFor(() => expect(sidebar.at(-1)?.type).toBe("hide"));
    fireEvent.click(screen.getByRole("button", { name: "原生界面" }));
    await waitFor(() => expect(conversation.at(-1)?.snapshot).toMatchObject({ visible: true, contextId: "shared:conversation", draft: "同一草稿" }));
    await waitFor(() => expect(sidebar.at(-1)?.snapshot.visible).toBe(true));
  });
  it("iOS 默认原生，选择网页并在关闭重开后记住偏好", () => {
    const result = render(<BackendManagerSheet {...props} />);
    expect(screen.getByRole("button", { name: "原生界面" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "网页界面" }));
    expect(screen.getByRole("button", { name: "网页界面" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(key)).toBe("web");
    result.rerender(<BackendManagerSheet {...props} open={false} />);
    result.rerender(<BackendManagerSheet {...props} />);
    expect(screen.getByRole("button", { name: "网页界面" })).toHaveAttribute("aria-pressed", "true");
  });
  it("偏好损坏回退原生，没有原生能力时不显示无效对比入口", () => {
    window.localStorage.setItem(key, "broken");
    const result = render(<BackendManagerSheet {...props} />);
    expect(screen.getByRole("button", { name: "原生界面" })).toHaveAttribute("aria-pressed", "true");
    result.unmount(); delete (window as any).webkit;
    render(<BackendManagerSheet {...props} />);
    expect(screen.queryByRole("group", { name: "界面体验" })).not.toBeInTheDocument();
  });
  it("存储不可写仍立即切换当前界面并给出保存反馈", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<BackendManagerSheet {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "网页界面" }));
    expect(screen.getByRole("button", { name: "网页界面" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("界面已切换，但无法保存；重启后可能恢复原界面")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "原生界面" }));
    expect(screen.getByRole("button", { name: "原生界面" })).toHaveAttribute("aria-pressed", "true");
  });
});
