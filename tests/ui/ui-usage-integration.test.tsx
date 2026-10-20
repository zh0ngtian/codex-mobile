import { createRef, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";
afterEach(() => { cleanup(); localStorage.clear(); delete (window as any).__CODEX_NATIVE_COMPOSER__; });
const tokenUsage = {
  last: { totalTokens: 100_000, inputTokens: 1, cachedInputTokens: 1, outputTokens: 1 },
  total: { totalTokens: 3_084_000, inputTokens: 3_000_000, cachedInputTokens: 2_400_000, outputTokens: 84_000 },
  modelContextWindow: 250_000,
};
const rateLimits = {
  rateLimits: {
    primary: { usedPercent: 29, windowDurationMins: 10_080 },
    secondary: { usedPercent: 15, windowDurationMins: 300 },
  },
};

function pageProps(overrides: Partial<ComponentProps<typeof ConversationPage>> = {}): ComponentProps<typeof ConversationPage> {
  return {
    active: { id: "thread-1", cwd: "/tmp/project", preview: "测试对话", turns: [] },
    conversationVisible: true,
    backendId: "mini", backendName: "Mac mini", backends: [], projectOptions: [],
    loadState: "ready", loadError: "", olderTurnsState: "exhausted", connection: "online",
    client: null, error: "", draft: "", draftImages: [], draftFiles: [], imageReading: false,
    busy: false, steering: false, steerable: true, pendingSteerText: "", queuedFollowUps: [],
    accessMode: "interactive", resumeError: "", tokenUsage, rateLimits, pendingAction: "",
    selectedServiceTier: null, selectedModelLabel: "Codex", selectedEffort: null, selectedPermissionLabel: "工作区",
    imageInputRef: createRef<HTMLInputElement>(), onBack: () => undefined,
    onNewChatBackendChange: () => undefined, onNewChatProjectChange: () => undefined,
    onPin: async () => true, onDuplicate: async () => true, onRename: async () => true,
    onArchive: async () => true, onRetry: () => undefined, onLoadOlderTurns: async () => true,
    onSubmit: () => undefined, onRemoveImage: () => undefined, onRemoveFile: () => undefined,
    onSelectImages: async () => undefined, onSelectLocation: async () => false,
    onOpenAgentSettings: () => undefined, onOpenPermissionSettings: () => undefined,
    onDraftChange: () => undefined, onInterrupt: () => undefined, onQueuedFollowUpAction: () => undefined,
    ...overrides,
  };
}

it("移除两种界面后旧偏好仍使用网页输入并显示五行真实用量", () => {
  localStorage.setItem("codex-mobile:web-interface", "modern");
  (window as any).__CODEX_NATIVE_COMPOSER__ = true;
  render(<ConversationPage {...pageProps({ draft: "保留网页草稿" })} />);
  expect(screen.getByRole("textbox", { name: "向 Codex 提问" })).toHaveValue("保留网页草稿");
  fireEvent.click(screen.getByRole("button", { name: "查看上下文占用情况" }));
  const card = within(screen.getByRole("dialog", { name: "用量与额度" }));
  for (const [label, value] of [["上下文余量", "60%"], ["周期剩余", "71%"], ["时间剩余", "85%"], ["输入 Token", "3M (缓存 80%)"], ["输出 Token", "84K"]]) {
    expect(card.getByText(label).nextElementSibling).toHaveTextContent(value);
  }
});
it("隐藏当前工作区会关闭用量卡片，恢复后保持网页草稿且不自动重开", () => {
  const props = pageProps({ draft: "切换保留草稿" });
  const view = render(<ConversationPage {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "查看上下文占用情况" }));
  expect(screen.getByRole("dialog", { name: "用量与额度" })).toBeInTheDocument();
  view.rerender(<ConversationPage {...props} conversationVisible={false} />);
  expect(screen.queryByRole("dialog", { name: "用量与额度" })).toBeNull();
  view.rerender(<ConversationPage {...props} conversationVisible />);
  expect(screen.queryByRole("dialog", { name: "用量与额度" })).toBeNull();
  expect(screen.getByRole("textbox", { name: "向 Codex 提问" })).toHaveValue("切换保留草稿");
});
