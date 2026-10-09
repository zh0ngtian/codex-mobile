import { createRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";
import { ThreadListPage } from "../../src/features/threads/ThreadListPage";

type Props = Parameters<typeof ConversationPage>[0];

function conversationProps(overrides: Partial<Props> = {}): Props {
  return {
    active: { id: "thread-1", name: "检查部署状态", cwd: "/tmp/project", turns: [] },
    backendId: "mini", backendName: "Mac mini",
    backends: [
      { id: "mini", name: "Mac mini", baseUrl: "", token: "", enabled: true, order: 0 },
      { id: "studio", name: "Mac Studio", baseUrl: "", token: "", enabled: true, order: 1 },
    ],
    projectOptions: [{ cwd: "/tmp/project", name: "codex-mobile" }],
    loadState: "ready", loadError: "", olderTurnsState: "exhausted",
    connection: "online", client: null, error: "", draft: "", draftImages: [], draftFiles: [],
    imageReading: false, busy: false, steering: false, steerable: true,
    pendingSteerText: "", queuedFollowUps: [], accessMode: "interactive", resumeError: "",
    tokenUsage: { last: { totalTokens: 100 }, modelContextWindow: 1000 }, rateLimits: null,
    pendingAction: "", selectedServiceTier: null, selectedModelLabel: "GPT-6 Codex",
    selectedEffort: "high", selectedPermissionLabel: "工作区",
    imageInputRef: createRef<HTMLInputElement>(),
    onBack: vi.fn(), onNewChatBackendChange: vi.fn(), onNewChatProjectChange: vi.fn(),
    onPin: vi.fn(async () => true), onDuplicate: vi.fn(async () => true),
    onRename: vi.fn(async () => true), onArchive: vi.fn(async () => true),
    onRetry: vi.fn(), onLoadOlderTurns: vi.fn(async () => true),
    onSubmit: vi.fn(event => event.preventDefault()), onRemoveImage: vi.fn(), onRemoveFile: vi.fn(),
    onSelectImages: vi.fn(async () => undefined), onSelectLocation: vi.fn(async () => false),
    onOpenAgentSettings: vi.fn(), onOpenPermissionSettings: vi.fn(), onDraftChange: vi.fn(),
    onInterrupt: vi.fn(), onQueuedFollowUpAction: vi.fn(),
    ...overrides,
  };
}

const posts: Array<{ type: string; snapshot?: { contextId: string } }> = [];
const newChat = vi.fn();
function DraftHarness() {
  const [draft, setDraft] = useState("保留的未发送草稿");
  return <ConversationPage {...conversationProps({ draft, onDraftChange: setDraft })} />;
}
function SidebarHarness() {
  const [query, setQuery] = useState("");
  return <ThreadListPage {...{ nativeVisible: true }} backends={[]} summaries={{}}
    selectedBackendId="all" loadingBackendIds={new Set()} refreshing={false} searching={false}
    threadListState="ready" visibleThreads={[]} totalThreadCount={0} projectDirectories={[]}
    hasProjectlessThreads={false} projectThreadStates={{}} projectHasMore={{}}
    collapsedProjectKeys={new Set()} loadingProjectKeys={new Set()} openingThreadId=""
    query={query} error="" onQueryChange={setQuery} onOpenThread={vi.fn()}
    onManageThread={vi.fn(async () => true)} onNewChat={newChat} onSelectBackend={vi.fn()}
    onManageBackends={vi.fn()} onRefresh={vi.fn()} onRetryProject={vi.fn()}
    onToggleProject={vi.fn()} onToggleProjectCollapsed={vi.fn()} />;
}
beforeEach(() => {
  posts.length = 0; newChat.mockClear();
  localStorage.setItem("codex-mobile:interface-mode", "native");
  Object.assign(window, { __codexNativeConversationReady: true, __codexNativeSidebarReady: true,
    webkit: { messageHandlers: {
      nativeConversation: { postMessage: (post: typeof posts[number]) => posts.push(post) },
      nativeSidebar: { postMessage: (post: typeof posts[number]) => posts.push(post) },
    } },
  });
});
afterEach(() => {
  cleanup(); localStorage.removeItem("codex-mobile:interface-mode");
  delete (window as any).webkit; delete (window as any).__codexNativeConversationReady;
  delete (window as any).__codexNativeSidebarReady;
});
describe("恢复网页界面后的旧安装状态兼容", () => {
  it("旧原生偏好及迟到事件不覆盖网页草稿，网页输入仍可编辑", () => {
    render(<DraftHarness />);
    const input = screen.getByRole("textbox", { name: "向 Codex 提问" });
    fireEvent.change(input, { target: { value: "网页继续编辑的草稿" } });
    const contextId = posts.find((post) => post.type === "snapshot")?.snapshot?.contextId ?? "mini:thread-1";
    act(() => window.dispatchEvent(new CustomEvent("codex-mobile-native-conversation-action", {
      detail: { contextId, sequence: 100, type: "draft", text: "旧原生草稿" },
    })));
    expect(input).toHaveValue("网页继续编辑的草稿");
  });
  it("旧原生搜索与新聊天事件不操作网页边栏，网页按钮仍可使用", () => {
    render(<SidebarHarness />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "网页搜索词" } });
    const contextId = posts.filter((post) => post.type === "snapshot").at(-1)?.snapshot?.contextId ?? "old-sidebar";
    act(() => {
      window.dispatchEvent(new CustomEvent("codex-mobile-native-sidebar-action", {
        detail: { contextId, sequence: 100, type: "query", text: "旧原生搜索词" },
      }));
      window.dispatchEvent(new CustomEvent("codex-mobile-native-sidebar-action", {
        detail: { contextId, sequence: 101, type: "new" },
      }));
    });
    expect(input).toHaveValue("网页搜索词");
    expect(newChat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /聊天$/ }));
    expect(newChat).toHaveBeenCalledOnce();
  });
});
