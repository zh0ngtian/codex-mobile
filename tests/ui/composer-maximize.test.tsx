import { createRef, type FormEvent } from "react";
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";

function renderComposer(
  onSubmit: (event: FormEvent) => void = () => undefined,
) {
  return render(
    <ConversationPage
      {...({
        active: {
          id: "thread-1",
          cwd: "/tmp/project",
          preview: "最大化输入框",
          turns: [{ id: "turn-1", items: [] }],
        },
        backendId: "mini",
        backendName: "Mac mini",
        backends: [],
        projectOptions: [],
        loadState: "ready",
        loadError: "",
        olderTurnsState: "exhausted",
        connection: "online",
        client: null,
        error: "",
        draft: "保留这段较长的草稿",
        draftImages: [],
        draftFiles: [],
        imageReading: false,
        busy: false,
        steering: false,
        steerable: true,
        pendingSteerText: "",
        queuedFollowUps: [],
        accessMode: "interactive",
        resumeError: "",
        tokenUsage: null,
        rateLimits: null,
        pendingAction: "",
        selectedServiceTier: null,
        selectedModelLabel: "Codex",
        selectedEffort: null,
        selectedPermissionLabel: "工作区",
        imageInputRef: createRef<HTMLInputElement>(),
        onBack: () => undefined,
        onNewChatBackendChange: () => undefined,
        onNewChatProjectChange: () => undefined,
        onPin: async () => true,
        onDuplicate: async () => true,
        onRename: async () => true,
        onArchive: async () => true,
        onRetry: () => undefined,
        onLoadOlderTurns: async () => true,
        onSubmit,
        onRemoveImage: () => undefined,
        onRemoveFile: () => undefined,
        onSelectImages: async () => undefined,
        onOpenAgentSettings: () => undefined,
        onOpenPermissionSettings: () => undefined,
        onDraftChange: () => undefined,
        onInterrupt: () => undefined,
        onQueuedFollowUpAction: () => undefined,
      } as Parameters<typeof ConversationPage>[0])}
    />,
  );
}

describe("会话输入框最大化", () => {
  it("在最大化与普通模式间切换时保留草稿", () => {
    const { container } = renderComposer();
    const view = within(container);
    const form = container.querySelector(".composer-wrap");

    fireEvent.click(view.getByRole("button", { name: "最大化输入框" }));

    expect(form?.classList.contains("composer-wrap-maximized")).toBe(true);
    expect(
      (view.getByRole("textbox", {
        name: "向 Codex 提问",
      }) as HTMLTextAreaElement).value,
    ).toBe("保留这段较长的草稿");

    fireEvent.click(view.getByRole("button", { name: "还原输入框" }));
    expect(form?.classList.contains("composer-wrap-maximized")).toBe(false);
  });

  it("最大化后支持按 Escape 还原", () => {
    const { container } = renderComposer();
    const view = within(container);
    const form = container.querySelector(".composer-wrap");

    fireEvent.click(view.getByRole("button", { name: "最大化输入框" }));
    fireEvent.keyDown(form as HTMLFormElement, { key: "Escape" });

    expect(form?.classList.contains("composer-wrap-maximized")).toBe(false);
  });

  it("最大化输入提交后立即还原", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const { container } = renderComposer(onSubmit);
    const view = within(container);
    const form = container.querySelector(".composer-wrap");

    fireEvent.click(view.getByRole("button", { name: "最大化输入框" }));
    fireEvent.click(view.getByRole("button", { name: "发送" }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(form?.classList.contains("composer-wrap-maximized")).toBe(false);
  });
});
