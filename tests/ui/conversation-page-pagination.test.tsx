import { createRef, type FormEvent } from "react";
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";
import type { DraftFile, DraftImage } from "../../src/ui/attachments";

function renderConversation(
  olderTurnsState: "idle" | "loading" | "error" | "exhausted",
  onLoadOlderTurns = vi.fn().mockResolvedValue(true),
  composer: {
    draft?: string;
    busy?: boolean;
    steering?: boolean;
    steerable?: boolean;
    pendingSteerText?: string;
    queuedFollowUps?: Array<{
      id: string;
      text: string;
      failed?: boolean;
    }>;
    accessMode?: "interactive" | "readOnly";
    resumeError?: string;
    draftImages?: DraftImage[];
    draftFiles?: DraftFile[];
    onSubmit?: (event: FormEvent) => void;
    historyText?: string;
    onDraftChange?: (value: string) => void;
    onResendUserMessage?: (value: string) => void;
    newChat?: boolean;
  } = {},
  onRetry = vi.fn(),
) {
  const onSubmit = composer.onSubmit ?? vi.fn();
  const result = render(
    <ConversationPage
      active={{
        id: composer.newChat ? "" : "thread-1",
        cwd: composer.newChat ? null : "/tmp/project",
        preview: composer.newChat ? "新对话" : "分页会话",
        turns: composer.newChat
          ? []
          : [{
              id: "turn-10",
              status: "completed",
              items: composer.historyText
                ? [{
                    id: "user-history",
                    type: "userMessage",
                    text: composer.historyText,
                  }]
                : [],
            }],
      }}
      backendId="mini"
      backendName="Mac mini"
      backends={[]}
      projectOptions={[]}
      loadState="ready"
      loadError=""
      olderTurnsState={olderTurnsState}
      connection="online"
      client={null}
      error=""
      draft={composer.draft ?? ""}
      draftImages={composer.draftImages ?? []}
      draftFiles={composer.draftFiles ?? []}
      imageReading={false}
      busy={composer.busy ?? false}
      steering={composer.steering ?? false}
      steerable={composer.steerable ?? true}
      pendingSteerText={composer.pendingSteerText ?? ""}
      queuedFollowUps={composer.queuedFollowUps ?? []}
      accessMode={composer.accessMode ?? "interactive"}
      resumeError={composer.resumeError ?? ""}
      tokenUsage={null}
      rateLimits={null}
      pendingAction=""
      selectedServiceTier={null}
      selectedModelLabel="Codex"
      selectedEffort={null}
      selectedPermissionLabel="工作区"
      imageInputRef={createRef<HTMLInputElement>()}
      onBack={() => undefined}
      onNewChatBackendChange={() => undefined}
      onNewChatProjectChange={() => undefined}
      onPin={async () => true}
      onDuplicate={async () => true}
      onRename={async () => true}
      onArchive={async () => true}
      onRetry={onRetry}
      onLoadOlderTurns={onLoadOlderTurns}
      onSubmit={onSubmit}
      onRemoveImage={() => undefined}
      onRemoveFile={() => undefined}
      onSelectImages={async () => undefined}
      onOpenAgentSettings={() => undefined}
      onOpenPermissionSettings={() => undefined}
      onDraftChange={composer.onDraftChange ?? (() => undefined)}
      onResendUserMessage={composer.onResendUserMessage}
      onInterrupt={() => undefined}
      onQueuedFollowUpAction={() => undefined}
    />,
  );
  return { ...result, onLoadOlderTurns, onSubmit, onRetry };
}

describe("会话详情历史分页", () => {
  it("无项目时仍可创建并发送新聊天", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const { container } = renderConversation(
      "exhausted",
      undefined,
      { newChat: true, draft: "处理这个任务", onSubmit },
    );
    const view = within(container);

    expect(
      (view.getByRole("combobox", { name: "选择项目" }) as HTMLSelectElement)
        .value,
    ).toBe("");
    expect(view.getByRole("option", { name: "无项目" })).not.toBeNull();
    expect(
      view
        .getByRole("textbox", { name: "向 Codex 提问" })
        .hasAttribute("disabled"),
    ).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "发送" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("右上角两个操作入口位于同一个按钮组", () => {
    const { container } = renderConversation("exhausted");
    const view = within(container);
    const group = view.getByRole("group", { name: "会话详情操作" });

    expect(
      within(group).getByRole("button", { name: "查看上下文占用情况" }),
    ).not.toBeNull();
    expect(
      within(group).getByRole("button", { name: "会话操作" }),
    ).not.toBeNull();
  });

  it("会话操作菜单可以刷新当前会话并自动关闭", () => {
    const onRetry = vi.fn();
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {},
      onRetry,
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "会话操作" }));
    fireEvent.click(view.getByRole("button", { name: "刷新会话" }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(view.queryByRole("region", { name: "会话操作" })).toBeNull();
  });

  it("用户上滑后不显示悬浮回到底部按钮", () => {
    const { container } = renderConversation("exhausted");
    const scroller = container.querySelector(".conversation-scroll");
    expect(scroller).not.toBeNull();
    Object.defineProperties(scroller!, {
      scrollHeight: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });

    fireEvent.scroll(scroller!);

    expect(
      within(container).queryByRole("button", { name: "回到最新消息" }),
    ).toBeNull();
  });

  it("有更早历史时显示入口并只请求一次分页", () => {
    const { container, onLoadOlderTurns } = renderConversation("idle");
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "加载更早消息" }));

    expect(onLoadOlderTurns).toHaveBeenCalledOnce();
  });

  it("分页失败时保留详情并显示局部重试", () => {
    const { container } = renderConversation("error");
    const view = within(container);

    expect(view.getByText("加载失败，点击重试")).not.toBeNull();
    expect(view.getByText("分页会话")).not.toBeNull();
  });

  it("其他客户端占用会话时展示只读状态并禁止写入", () => {
    const onRetry = vi.fn();
    const { container } = renderConversation(
      "idle",
      undefined,
      {
        draft: "不能发送",
        accessMode: "readOnly",
        resumeError: "thread already has an active writer",
      },
      onRetry,
    );
    const view = within(container);

    expect(
      view.getByText("该会话正在其他 Codex 客户端运行，当前为只读模式"),
    ).not.toBeNull();
    expect(view.getByLabelText("向 Codex 提问").hasAttribute("disabled")).toBe(
      true,
    );
    expect(view.getByRole("button", { name: "添加附件" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(view.getByRole("button", { name: "发送" }).hasAttribute("disabled")).toBe(
      true,
    );

    fireEvent.click(view.getByRole("button", { name: "重新连接" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("任务执行中输入内容后，停止按钮变成排队发送按钮", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const { container } = renderConversation(
      "exhausted",
      undefined,
      { draft: "先处理测试", busy: true, onSubmit },
    );
    const view = within(container);
    const queue = view.getByRole("button", { name: "排队" });

    expect(queue.getAttribute("type")).toBe("submit");
    expect(view.queryByRole("button", { name: "停止" })).toBeNull();
    fireEvent.click(queue);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("任务执行中没有输入时保留停止按钮", () => {
    const idle = renderConversation(
      "exhausted",
      undefined,
      { busy: true },
    );
    const stop = within(idle.container).getByRole("button", { name: "停止" });
    expect(stop.classList.contains("send-button-running")).toBe(true);
    expect(stop.getAttribute("aria-busy")).toBe("true");
  });

  it("排队消息提供改为引导按钮", () => {
    const onQueuedFollowUpAction = vi.fn();
    const { container } = render(
      <ConversationPage
        active={{
          id: "thread-1",
          cwd: "/tmp/project",
          preview: "排队会话",
          turns: [{ id: "turn-10", status: "inProgress", items: [] }],
        }}
        backendId="mini"
        backendName="Mac mini"
        backends={[]}
        projectOptions={[]}
        loadState="ready"
        loadError=""
        olderTurnsState="exhausted"
        connection="online"
        client={null}
        error=""
        draft=""
        draftImages={[]}
        draftFiles={[]}
        imageReading={false}
        busy
        steering={false}
        steerable
        pendingSteerText=""
        queuedFollowUps={[{ id: "queue-1", text: "先完成测试" }]}
        accessMode="interactive"
        resumeError=""
        tokenUsage={null}
        rateLimits={null}
        pendingAction=""
        selectedServiceTier={null}
        selectedModelLabel="Codex"
        selectedEffort={null}
        selectedPermissionLabel="工作区"
        imageInputRef={createRef<HTMLInputElement>()}
        onBack={() => undefined}
        onNewChatBackendChange={() => undefined}
        onNewChatProjectChange={() => undefined}
        onPin={async () => true}
        onDuplicate={async () => true}
        onRename={async () => true}
        onArchive={async () => true}
        onRetry={() => undefined}
        onLoadOlderTurns={async () => true}
        onSubmit={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveFile={() => undefined}
        onSelectImages={async () => undefined}
        onOpenAgentSettings={() => undefined}
        onOpenPermissionSettings={() => undefined}
        onDraftChange={() => undefined}
        onInterrupt={() => undefined}
        onQueuedFollowUpAction={onQueuedFollowUpAction}
      />,
    );
    const view = within(container);

    expect(view.getByRole("status", { name: "排队消息" }).textContent).toContain(
      "先完成测试",
    );
    fireEvent.click(view.getByRole("button", { name: "改为引导" }));
    expect(onQueuedFollowUpAction).toHaveBeenCalledWith("queue-1");
  });

  it("空闲已有会话且输入为空时隐藏实时语音入口", () => {
    const { container } = renderConversation("exhausted");
    const view = within(container);

    expect(view.queryByRole("button", { name: "开始实时语音" })).toBeNull();
    expect(view.getByRole("button", { name: "发送" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("输入文字后仍显示原发送按钮，不改变文字提交", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const { container } = renderConversation(
      "exhausted",
      undefined,
      { draft: "继续完成测试", onSubmit },
    );
    const view = within(container);

    expect(view.queryByRole("button", { name: "开始实时语音" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "发送" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("历史消息可以回填编辑或直接重发", () => {
    const onDraftChange = vi.fn();
    const onResendUserMessage = vi.fn();
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {
        historyText: "重新检查这段实现",
        onDraftChange,
        onResendUserMessage,
      },
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "编辑历史消息" }));
    expect(onDraftChange).toHaveBeenCalledWith("重新检查这段实现");
    expect(document.activeElement).toBe(
      view.getByRole("textbox", { name: "向 Codex 提问" }),
    );

    fireEvent.click(view.getByRole("button", { name: "重发历史消息" }));
    expect(onResendUserMessage).toHaveBeenCalledWith("重新检查这段实现");
  });

  it("引导发送后在输入框上方临时展示单行消息", () => {
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {
        busy: true,
        pendingSteerText:
          "先完成当前检查，再根据测试结果调整实现并重新运行完整测试",
      },
    );
    const view = within(container);
    const preview = view.getByRole("status", { name: "已发送引导" });

    expect(preview.textContent).toBe(
      "先完成当前检查，再根据测试结果调整实现并重新运行完整测试",
    );
    expect(preview.getAttribute("title")).toBe(preview.textContent);
  });

  it("真实 Turn ID 尚未返回时仍允许把追加消息加入队列", () => {
    const { container } = renderConversation(
      "exhausted",
      undefined,
      { draft: "继续", busy: true, steerable: false },
    );
    const view = within(container);

    expect(view.getByRole("button", { name: "排队" })).not.toBeNull();
    expect(view.queryByRole("button", { name: "停止" })).toBeNull();
  });

  it("待发送图片可以打开统一大图预览", () => {
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {
        draftImages: [
          {
            id: "draft-image",
            name: "draft.png",
            type: "image/png",
            size: 68,
            url: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
      },
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "预览 draft.png" }));

    const preview = within(document.body).getByRole("dialog", {
      name: "图片预览",
    });
    expect(
      within(preview).getByRole("img", { name: "待发送 draft.png" }),
    ).not.toBeNull();
  });

  it("待发送视频可播放，其他文件显示紧凑文件卡片", () => {
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {
        draftFiles: [
          {
            id: "video",
            name: "演示.mp4",
            type: "video/mp4",
            size: 5,
            file: new File(["video"], "演示.mp4", { type: "video/mp4" }),
            previewUrl: "blob:video",
          },
          {
            id: "pdf",
            name: "需求.pdf",
            type: "application/pdf",
            size: 3,
            file: new File(["pdf"], "需求.pdf", { type: "application/pdf" }),
            previewUrl: "blob:pdf",
          },
        ],
      },
    );
    const view = within(container);

    const video = view.getByLabelText("待发送 演示.mp4");
    expect(video.tagName).toBe("VIDEO");
    expect(video.getAttribute("poster")).toMatch(/^data:image\/svg\+xml/);
    expect(view.getByText("PDF")).not.toBeNull();
    expect(view.getByRole("button", { name: "移除 需求.pdf" })).not.toBeNull();
  });
});
