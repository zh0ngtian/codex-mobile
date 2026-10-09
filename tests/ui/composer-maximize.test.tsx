import { createRef, type FormEvent } from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";

function renderComposer(
  onSubmit: (event: FormEvent) => void = () => undefined,
  onSelectLocation: () => Promise<boolean> = async () => true,
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
        onSelectLocation,
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
  it.each([false, true])("提交前同步取消输入焦点（最大化：%s）", (maximized) => {
    let focusedAtSubmit = true;
    const onSubmit = vi.fn((event: FormEvent) => {
      event.preventDefault();
      focusedAtSubmit = document.activeElement instanceof HTMLTextAreaElement;
    });
    const { container } = renderComposer(onSubmit);
    const view = within(container);
    if (maximized) fireEvent.click(view.getByRole("button", { name: "最大化输入框" }));
    const input = view.getByRole("textbox", { name: "向 Codex 提问" });
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.click(view.getByRole("button", { name: "发送" }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(focusedAtSubmit).toBe(false);
  });

  it("加号菜单区分图片、文件和当前位置", async () => {
    const onSelectLocation = vi.fn(async () => true);
    const { container } = renderComposer(undefined, onSelectLocation);
    const view = within(container);
    const addButton = view.getByRole("button", { name: "添加附件" });

    fireEvent.click(addButton);

    expect(addButton.getAttribute("aria-expanded")).toBe("true");
    const menu = view.getByRole("menu", { name: "附件菜单" });
    expect(within(menu).getByRole("menuitem", { name: "图片" })).not.toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "文件" })).not.toBeNull();
    const location = within(menu).getByRole("menuitem", { name: "当前位置" });
    expect(view.getByLabelText("选择图片").getAttribute("accept")).toBe(
      "image/png,image/jpeg,image/webp,image/gif",
    );
    expect(view.getByLabelText("选择文件").getAttribute("accept")).toBe("*/*");

    fireEvent.click(location);

    await waitFor(() => expect(onSelectLocation).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(view.queryByRole("menu", { name: "附件菜单" })).toBeNull(),
    );
  });

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
