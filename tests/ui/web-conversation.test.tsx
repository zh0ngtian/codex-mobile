import { createRef } from "react";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";
import { TurnCard } from "../../src/features/conversation/Timeline";

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

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("网页对话操作", () => {
  it("顶栏只保留三个入口，菜单仍能访问权限与完整会话状态", () => {
    const props = conversationProps();
    const { container } = render(<ConversationPage {...props} />);
    const view = within(container);
    const header = container.querySelector(".conversation-header")!;
    expect(within(header as HTMLElement).getAllByRole("button")).toHaveLength(3);
    expect(view.getByRole("heading", { name: "检查部署状态" })).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "选择模型、智能与速度" }));
    expect(props.onOpenAgentSettings).toHaveBeenCalledOnce();

    fireEvent.click(view.getByRole("button", { name: "会话操作" }));
    const menu = view.getByRole("dialog", { name: "会话操作" });
    expect(within(menu).getByText("检查部署状态")).toBeInTheDocument();
    expect(within(menu).getByText(/Mac mini/)).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("button", { name: "选择审批与权限模式" }));
    expect(props.onOpenPermissionSettings).toHaveBeenCalledOnce();
    expect(view.queryByRole("dialog", { name: "会话操作" })).not.toBeInTheDocument();

    fireEvent.click(view.getByRole("button", { name: "会话操作" }));
    fireEvent.click(view.getByRole("button", { name: "查看上下文占用情况" }));
    const status = view.getByRole("dialog", { name: "状态" });
    expect(within(status).getByText("Mac mini")).toBeInTheDocument();
    expect(within(status).getByText("已连接")).toBeInTheDocument();
    expect(within(status).getByText("/tmp/project")).toBeInTheDocument();
    expect(within(status).getByText(/剩余 90%/)).toBeInTheDocument();
  });

  it("状态入口明确区分断开与连接中", () => {
    const { container } = render(<ConversationPage {...conversationProps({ connection: "offline" })} />);
    const view = within(container);
    fireEvent.click(view.getByRole("button", { name: "会话操作" }));
    fireEvent.click(view.getByRole("button", { name: "查看上下文占用情况" }));
    expect(within(view.getByRole("dialog", { name: "状态" })).getByText("未连接")).toBeInTheDocument();
  });

  it("会话菜单支持 Escape 并把键盘焦点还给菜单入口", () => {
    const { container } = render(<ConversationPage {...conversationProps()} />);
    const view = within(container);
    const trigger = view.getByRole("button", { name: "会话操作" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = view.getByRole("dialog", { name: "会话操作" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(view.queryByRole("dialog", { name: "会话操作" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("空草稿与单行输入不显示展开，多行可展开且保留草稿", () => {
    const props = conversationProps();
    const { container, rerender } = render(<ConversationPage {...props} />);
    const view = within(container);
    expect(view.queryByRole("button", { name: "最大化输入框" })).not.toBeInTheDocument();
    rerender(<ConversationPage {...props} draft="一句话" />);
    expect(view.queryByRole("button", { name: "最大化输入框" })).not.toBeInTheDocument();
    rerender(<ConversationPage {...props} draft={"第一行\n第二行"} />);
    fireEvent.click(view.getByRole("button", { name: "最大化输入框" }));
    const input = view.getByRole("textbox", { name: "向 Codex 提问" });
    expect(input).toHaveValue("第一行\n第二行");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(view.queryByRole("button", { name: "还原输入框" })).not.toBeInTheDocument();
    expect(input).toHaveValue("第一行\n第二行");
  });

  it("新聊天能从空态选择机器与项目并打开权限设置", () => {
    const props = conversationProps({ active: { id: "", cwd: "", turns: [] } });
    const { container } = render(<ConversationPage {...props} />);
    const view = within(container);
    expect(view.getByText("开始一次新的 Codex 对话")).toBeInTheDocument();
    fireEvent.change(view.getByRole("combobox", { name: "选择项目" }), { target: { value: "/tmp/project" } });
    fireEvent.change(view.getByRole("combobox", { name: "选择机器" }), { target: { value: "studio" } });
    expect(props.onNewChatProjectChange).toHaveBeenCalledWith("/tmp/project");
    expect(props.onNewChatBackendChange).toHaveBeenCalledWith("studio");
    fireEvent.click(view.getByRole("button", { name: "会话操作" }));
    fireEvent.click(view.getByRole("button", { name: "选择审批与权限模式" }));
    expect(props.onOpenPermissionSettings).toHaveBeenCalledOnce();
    expect(view.queryByRole("button", { name: "归档" })).not.toBeInTheDocument();
  });

  it("运行中的工具活动默认折叠，仍可主动展开详情", async () => {
    const { container } = render(<TurnCard client={null} turn={{
      id: "turn-running", status: "inProgress", items: [
        { id: "command-1", type: "commandExecution", status: "inProgress", command: "npm test" },
        { id: "agent-1", type: "agentMessage", text: "正在核对结果" },
      ],
    }} />);
    const activity = container.querySelector("details.tool-activity")!;
    expect(activity).not.toHaveAttribute("open");
    fireEvent.click(activity.querySelector("summary")!);
    await waitFor(() => expect(activity).toHaveAttribute("open"));
    expect(within(container).getByRole("button", { name: "正在运行 npm test" })).toBeInTheDocument();
  });

  it("用户消息提供可聚焦的复制入口，复制完整文本", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { container } = render(<TurnCard client={null} turn={{
      id: "turn-1", status: "completed", items: [
        { id: "user-1", type: "userMessage", text: "保留这条用户消息" },
        { id: "agent-1", type: "agentMessage", text: "已收到" },
      ],
    }} />);
    const copy = within(container).getByRole("button", { name: "复制用户消息" });
    copy.focus();
    expect(document.activeElement).toBe(copy);
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("保留这条用户消息"));
  });
});
