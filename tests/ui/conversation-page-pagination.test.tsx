import { createRef, type FormEvent } from "react";
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";
import {
  createHistoricalMessageEditTarget,
  type HistoricalMessageEditTarget,
} from "../../src/app-server/history-edit";
import type { DraftFile, DraftImage } from "../../src/ui/attachments";

function renderConversation(
  olderTurnsState: "idle" | "loading" | "error" | "exhausted",
  onLoadOlderTurns = vi.fn().mockResolvedValue(true),
  composer: {
    draft?: string;
    busy?: boolean;
    operationPending?: boolean;
    steering?: boolean;
    steerable?: boolean;
    pendingSteerText?: string;
    queuedFollowUps?: Array<{
      id: string;
      text: string;
      inputText?: string;
      attachmentCount?: number;
      failed?: boolean;
    }>;
    accessMode?: "interactive" | "readOnly";
    resumeError?: string;
    draftImages?: DraftImage[];
    draftFiles?: DraftFile[];
    onSubmit?: (event: FormEvent) => void;
    historyText?: string;
    turns?: Array<Record<string, any>>;
    onDraftChange?: (value: string) => void;
    onQueuedFollowUpEdit?: (id: string, text: string) => void;
    onQueuedFollowUpCancel?: (id: string) => void;
    onEditUserMessage?: (target: Record<string, any>) => void;
    historyEdit?: {
      target: HistoricalMessageEditTarget;
      text: string;
      submitting: boolean;
    } | null;
    onHistoryEditTextChange?: (value: string) => void;
    onCancelHistoryEdit?: () => void;
    onSubmitHistoryEdit?: () => void;
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
          : composer.turns ?? [{
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
      operationPending={composer.operationPending}
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
      onSelectLocation={async () => false}
      onOpenAgentSettings={() => undefined}
      onOpenPermissionSettings={() => undefined}
      onDraftChange={composer.onDraftChange ?? (() => undefined)}
      historyEdit={composer.historyEdit ?? null}
      onEditUserMessage={composer.onEditUserMessage}
      onHistoryEditTextChange={composer.onHistoryEditTextChange ?? (() => undefined)}
      onCancelHistoryEdit={composer.onCancelHistoryEdit ?? (() => undefined)}
      onSubmitHistoryEdit={composer.onSubmitHistoryEdit ?? (() => undefined)}
      onInterrupt={() => undefined}
      onQueuedFollowUpAction={() => undefined}
      onQueuedFollowUpEdit={composer.onQueuedFollowUpEdit ?? (() => undefined)}
      onQueuedFollowUpCancel={composer.onQueuedFollowUpCancel ?? (() => undefined)}
    />,
  );
  return { ...result, onLoadOlderTurns, onSubmit, onRetry };
}

describe("会话详情历史分页", () => {
  it("独立待确认提示位于会话滚动状态区域，不成为页面前置流式元素", () => {
    const { container } = renderConversation("exhausted", undefined, { operationPending: true, busy: false });
    const status = within(container).getByRole("status");
    expect(status.textContent).toBe("发送状态确认中");
    expect(status.classList.contains("operation-pending")).toBe(true);
    expect(status.closest(".run-progress")).not.toBeNull();
    expect(status.closest(".conversation-scroll-content")).not.toBeNull();
    expect(container.querySelector(".conversation")?.firstElementChild?.className).toBe("conversation-header");
  });
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
        onSelectLocation={async () => false}
        onOpenAgentSettings={() => undefined}
        onOpenPermissionSettings={() => undefined}
        onDraftChange={() => undefined}
        onInterrupt={() => undefined}
        onQueuedFollowUpAction={onQueuedFollowUpAction}
        onQueuedFollowUpEdit={() => undefined}
        onQueuedFollowUpCancel={() => undefined}
      />,
    );
    const view = within(container);

    expect(view.getByRole("status", { name: "排队消息" }).textContent).toContain(
      "先完成测试",
    );
    fireEvent.click(view.getByRole("button", { name: "改为引导" }));
    expect(onQueuedFollowUpAction).toHaveBeenCalledWith("queue-1");
  });

  it("排队消息可以就地编辑并取消发送", () => {
    const onQueuedFollowUpEdit = vi.fn();
    const onQueuedFollowUpCancel = vi.fn();
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {
        busy: true,
        queuedFollowUps: [{
          id: "queue-1",
          text: "原排队内容",
          inputText: "原排队内容",
          attachmentCount: 1,
        }],
        onQueuedFollowUpEdit,
        onQueuedFollowUpCancel,
      },
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "编辑排队消息" }));
    const editor = view.getByRole("textbox", { name: "编辑排队消息内容" });
    expect((editor as HTMLTextAreaElement).value).toBe("原排队内容");
    expect(view.getByText("1 个附件会保留")).not.toBeNull();
    fireEvent.change(editor, { target: { value: "调整后的内容" } });
    fireEvent.click(view.getByRole("button", { name: "保存排队消息" }));
    expect(onQueuedFollowUpEdit).toHaveBeenCalledWith(
      "queue-1",
      "调整后的内容",
    );

    fireEvent.click(view.getByRole("button", { name: "取消排队消息" }));
    expect(onQueuedFollowUpCancel).toHaveBeenCalledWith("queue-1");
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

  it("空闲且没有排队消息时可以进入历史编辑", () => {
    const onEditUserMessage = vi.fn();
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {
        historyText: "重新检查这段实现",
        onEditUserMessage,
      },
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "编辑历史消息" }));
    expect(onEditUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: "turn-10",
        messageId: "user-history",
        text: "重新检查这段实现",
      }),
    );
    expect(view.queryByRole("button", { name: "重发历史消息" })).toBeNull();
  });

  it("同轮主消息、引导消息与自动化消息各自支持编辑", () => {
    const turns = [{ id: "multi", status: "completed", items: [
      { id: "u1", type: "userMessage", text: "原始要求" },
      { id: "a1", type: "agentMessage", phase: "final_answer", text: "原回复" },
      { id: "u2", type: "userMessage", text: "引导要求" },
      { id: "a2", type: "agentMessage", phase: "final_answer", text: "调整回复" },
      { id: "u3", type: "userMessage", text: `<heartbeat>
<automation_id>auto-1</automation_id>
<instructions>自动检查</instructions>
</heartbeat>` },
    ] }];
    const onEditUserMessage = vi.fn();
    const { container } = renderConversation("exhausted", undefined, { turns, onEditUserMessage });
    const buttons = within(container).getAllByRole("button", { name: "编辑历史消息" });
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[1]);
    expect(onEditUserMessage).toHaveBeenCalledWith(expect.objectContaining({ turnId: "multi", messageId: "u2", text: "引导要求" }));
    fireEvent.click(buttons[2]);
    expect(onEditUserMessage).toHaveBeenLastCalledWith(expect.objectContaining({ messageId: "u3" }));
  });

  it("引导消息的编辑器只显示在选中的消息内", () => {
    const turns = [{ id: "multi", status: "completed", items: [
      { id: "u1", type: "userMessage", text: "原始要求" },
      { id: "a1", type: "agentMessage", phase: "final_answer", text: "原回复" },
      { id: "u2", type: "userMessage", text: "引导要求" },
      { id: "a2", type: "agentMessage", phase: "final_answer", text: "调整回复" },
    ] }];
    const target = createHistoricalMessageEditTarget(turns, "multi", "u2")!;
    const { container } = renderConversation("exhausted", undefined, {
      turns, historyEdit: { target, text: "编辑引导", submitting: false },
    });
    const view = within(container);
    expect(view.getByText("原始要求")).toBeTruthy();
    expect(view.queryByText("引导要求")).toBeNull();
    const editor = view.getByRole("textbox", { name: "编辑历史消息内容" });
    expect((editor as HTMLTextAreaElement).value).toBe("编辑引导");
    expect(editor.closest(".turn-responses")).toBeTruthy();
    expect(container.textContent).toContain("同轮此前的 1 条用户消息及附件会一起重发");
  });

  it("有排队消息时不提供历史编辑入口", () => {
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {
        historyText: "不能编辑",
        onEditUserMessage: vi.fn(),
        queuedFollowUps: [{ id: "queue-1", text: "等待发送" }],
      },
    );

    expect(
      within(container).queryByRole("button", { name: "编辑历史消息" }),
    ).toBeNull();
  });

  it("在原历史消息内编辑并保留底部草稿与附件提示", () => {
    const turns = [{
      id: "turn-edit",
      status: "completed",
      items: [{
        id: "user-edit",
        type: "userMessage",
        content: [
          { type: "text", text: "修改前" },
          { type: "image", url: "data:image/png;base64,AAAA" },
        ],
      }],
    }];
    const target = createHistoricalMessageEditTarget(turns, "turn-edit")!;
    const onCancelHistoryEdit = vi.fn();
    const onSubmitHistoryEdit = vi.fn();
    const onHistoryEditTextChange = vi.fn();
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {
        turns,
        draft: "未发送的底部草稿",
        historyEdit: { target, text: "修改前", submitting: false },
        onHistoryEditTextChange,
        onCancelHistoryEdit,
        onSubmitHistoryEdit,
      },
    );
    const view = within(container);

    const turn = container.querySelector(".turn-card") as HTMLElement;
    const inlineEditor = within(turn).getByRole("textbox", {
      name: "编辑历史消息内容",
    });
    expect((inlineEditor as HTMLTextAreaElement).value).toBe("修改前");
    expect(document.activeElement).toBe(inlineEditor);
    expect((inlineEditor as HTMLTextAreaElement).selectionStart).toBe(3);
    expect((inlineEditor as HTMLTextAreaElement).selectionEnd).toBe(3);
    expect(turn.textContent).toContain("原消息的 1 个附件会保留");
    expect(
      (view.getByRole("textbox", { name: "向 Codex 提问" }) as HTMLTextAreaElement)
        .value,
    ).toBe("未发送的底部草稿");
    expect(view.queryByRole("status", { name: "正在编辑历史消息" })).toBeNull();
    fireEvent.change(inlineEditor, { target: { value: "修改后" } });
    expect(onHistoryEditTextChange).toHaveBeenCalledWith("修改后");
    fireEvent.click(within(turn).getByRole("button", { name: "保存并重发" }));
    expect(onSubmitHistoryEdit).toHaveBeenCalledOnce();
    fireEvent.click(within(turn).getByRole("button", { name: "取消编辑历史消息" }));
    expect(onCancelHistoryEdit).toHaveBeenCalledOnce();
  });

  it("目标后还有对话时先确认删除后续并重发", () => {
    const turns = [
      {
        id: "turn-edit",
        status: "completed",
        items: [{ id: "user-edit", type: "userMessage", text: "修改前" }],
      },
      {
        id: "turn-later",
        status: "completed",
        items: [{ id: "user-later", type: "userMessage", text: "后续消息" }],
      },
    ];
    const target = createHistoricalMessageEditTarget(turns, "turn-edit")!;
    const onSubmitHistoryEdit = vi.fn();
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {
        turns,
        draft: "底部草稿",
        historyEdit: { target, text: "修改后", submitting: false },
        onSubmitHistoryEdit,
      },
    );
    const view = within(container);

    const turn = container.querySelector(".turn-card") as HTMLElement;
    fireEvent.click(within(turn).getByRole("button", { name: "保存并重发" }));
    expect(onSubmitHistoryEdit).not.toHaveBeenCalled();
    const confirmation = within(turn).getByRole("status", {
      name: "确认删除后续对话",
    });
    expect(confirmation.textContent).toContain("文件修改、已执行命令和远端操作不会撤销");
    expect(within(document.body).queryByRole("dialog")).toBeNull();
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "删除后续并重发" }),
    );
    expect(onSubmitHistoryEdit).toHaveBeenCalledOnce();
    expect(
      within(turn).queryByRole("status", {
        name: "确认删除后续对话",
      }),
    ).toBeNull();
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
