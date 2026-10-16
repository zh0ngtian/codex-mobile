import { createRef, useRef, useState, type ComponentProps, type FormEvent } from "react";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";
import { ComposerSettings, type ComposerPicker } from "../../src/features/settings/ComposerSettings";
import { ACTION_MENU_EVENT } from "../../src/ui/native-action-menu";

const preference = vi.hoisted(() => ({ modern: true }));
vi.mock("../../src/features/web-ui/preference", () => ({ useWebInterface: () => preference }));
type Props = ComponentProps<typeof ConversationPage>;
function props(overrides: Partial<Props> & Record<string, unknown> = {}): Props {
  return {
    active: { id: "thread-1", cwd: "/tmp/project", preview: "真实会话标题", turns: [] },
    backendId: "mini", backendName: "Mac mini", backends: [], projectOptions: [],
    loadState: "ready", loadError: "", olderTurnsState: "exhausted", connection: "online", client: null,
    error: "", draft: "保留草稿", draftImages: [], draftFiles: [], imageReading: false,
    busy: false, steering: false, steerable: true, pendingSteerText: "", queuedFollowUps: [],
    accessMode: "interactive", resumeError: "", tokenUsage: { last: { totalTokens: 25 }, modelContextWindow: 100 },
    rateLimits: null, pendingAction: "", selectedServiceTier: "priority", selectedModelLabel: "GPT-5 Mini",
    selectedEffort: "medium", selectedPermissionLabel: "工作区", imageInputRef: createRef(),
    onBack: vi.fn(), onNewChatBackendChange: vi.fn(), onNewChatProjectChange: vi.fn(), onPin: vi.fn(async () => true),
    onDuplicate: vi.fn(async () => true), onRename: vi.fn(async () => true), onArchive: vi.fn(async () => true),
    onRetry: vi.fn(), onLoadOlderTurns: vi.fn(async () => true), onSubmit: vi.fn((e: FormEvent) => e.preventDefault()),
    onRemoveImage: vi.fn(), onRemoveFile: vi.fn(), onSelectImages: vi.fn(async () => undefined), onSelectLocation: vi.fn(async () => true),
    onOpenAgentSettings: vi.fn(), onOpenPermissionSettings: vi.fn(), onDraftChange: vi.fn(), onInterrupt: vi.fn(),
    onQueuedFollowUpAction: vi.fn(), ...overrides,
  } as Props;
}
function setup(overrides: Partial<Props> & Record<string, unknown> = {}) {
  const current = props(overrides);
  const result = render(<ConversationPage {...current} />);
  return { ...result, view: within(result.container), current };
}
function settingsProps() {
  return {
    picker: "model" as const,
    effortOptions: [{ id: "medium", label: "中" }, { id: "high", label: "高" }], speedOptions: [{ id: null, label: "正常", description: "标准速度" }],
    permissionModes: [{ id: "workspace-write", label: "工作区", description: "工作区访问", permissions: "workspace-write", approvalPolicy: "on-request" }],
    models: [{ id: "mini", model: "mini", displayName: "GPT-5 Mini" }, { id: "full", model: "full", displayName: "GPT-5" }],
    selectedEffort: "medium", selectedModel: "mini", selectedModelLabel: "GPT-5 Mini", selectedServiceTier: null,
    selectedSpeedLabel: "正常", selectedPermissionModeId: "workspace-write", onPickerChange: vi.fn(),
    onChooseEffort: vi.fn(), onChooseModel: vi.fn(), onChooseSpeed: vi.fn(), onChoosePermissionMode: vi.fn(),
  } as unknown as ComponentProps<typeof ComposerSettings>;
}
function SettingsConversation({ overrides = {} }: { overrides?: Partial<Props> }) {
  const [initial] = useState(() => props({ draft: "", onOpenSpeedSettings: vi.fn() }));
  const [picker, setPicker] = useState<ComposerPicker>(null);
  const restore = useRef<(() => void) | undefined>(undefined);
  const open = (next: ComposerPicker) => (callback?: () => void) => { restore.current = callback; setPicker(next); };
  return <>
    <ConversationPage {...initial} {...overrides} onOpenAgentSettings={open("model")} onOpenPermissionSettings={open("permission")} onOpenSpeedSettings={open("speed")} />
    <ComposerSettings {...settingsProps()} picker={picker} onPickerChange={setPicker} onRestoreComposerFocus={() => {
      const callback = restore.current; restore.current = undefined; callback?.();
    }} />
  </>;
}
function emulateComposerLayout(fontScale = 1) {
  const sheet = document.createElement("style");
  sheet.dataset.composerMeasurementTest = "true";
  sheet.textContent = `.composer textarea { min-height:48px; line-height:${22 * fontScale}px; padding:14px 3px 12px; }
    .composer-wrap[data-expanded="true"] textarea { min-height:50px; padding:15px 11px 9px; }`;
  document.head.append(sheet);
  vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLTextAreaElement) {
    const style = getComputedStyle(this);
    const rows = this.value.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 14)), 0);
    const contentHeight = rows * parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    return Math.ceil(Math.max(parseFloat(style.minHeight) || 0, contentHeight));
  });
}
beforeEach(() => { preference.modern = true; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.querySelectorAll("[data-composer-measurement-test]").forEach(sheet => sheet.remove()); });

describe("新版会话真实数据与操作", () => {
  it.each([false, true])("原生重命名取消后下一次点击立即重新打开菜单（新版：%s）", async (modern) => {
    preference.modern = modern;
    const show = vi.fn();
    (window as any).CodexMobileActionMenu = { show, dismiss: vi.fn() };
    try {
      const onRename = vi.fn(async () => false);
      const { view, unmount } = setup({ onRename });
      const trigger = view.getByRole("button", { name: "会话操作" });
      fireEvent.click(trigger);
      const request = JSON.parse(show.mock.calls[0][0]);
      await act(async () => window.dispatchEvent(new CustomEvent(ACTION_MENU_EVENT, {
        detail: { requestId: request.requestId, actionId: "rename" },
      })));
      expect(onRename).toHaveBeenCalledOnce();
      expect(view.getByText("真实会话标题")).toBeTruthy();
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(trigger);
      expect(show).toHaveBeenCalledTimes(2);
      const reopened = JSON.parse(show.mock.calls[1][0]);
      expect(reopened.requestId).not.toBe(request.requestId);
      expect(reopened.actions.some((action: { id: string }) => action.id === "rename")).toBe(true);
      unmount();
    } finally {
      delete (window as any).CodexMobileActionMenu;
    }
  });

  it.each([false, true])("网页重命名取消后保留可见的原菜单（新版：%s）", async (modern) => {
    preference.modern = modern;
    const onRename = vi.fn(async () => false);
    const { view } = setup({ onRename });
    const trigger = view.getByRole("button", { name: "会话操作" });
    fireEvent.click(trigger);
    await act(async () => fireEvent.click(view.getByRole("button", { name: "重命名" })));
    expect(onRename).toHaveBeenCalledOnce();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByRole("button", { name: "重命名" })).toBeTruthy();
  });

  it("顶部按进度环、新聊天、更多排列，真实进度从十二点顺时针绘制", () => {
    const onNewChat = vi.fn();
    const { container, view } = setup({ onNewChat });
    const group = view.getByRole("group", { name: "会话详情操作" });
    expect(within(group).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["查看上下文占用情况", "新建对话", "会话操作"]);
    const progress = container.querySelector(".context-ring-progress")!;
    expect(progress.getAttribute("stroke-dasharray")).toBe("25 100");
    expect(progress.getAttribute("transform")).toBe("rotate(-90 12 12)");
    expect(group.textContent).toBe("");
    fireEvent.click(view.getByRole("button", { name: "新建对话" }));
    expect(onNewChat).toHaveBeenCalledOnce();
  });
  it.each([null, { last: { totalTokens: null }, modelContextWindow: 100 }, { last: { totalTokens: 0 }, modelContextWindow: 100 }])("零或未知用量不绘制黑色圆点 %j", tokenUsage => {
    const { container } = setup({ tokenUsage });
    expect(container.querySelector(".context-ring-track")).not.toBeNull();
    expect(container.querySelector(".context-ring-progress")).toBeNull();
  });
  it("用量卡片展示四行，分别使用七天和五小时额度并支持关闭", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const { view, container } = setup({ tokenUsage: { last: { totalTokens: 25 }, total: { totalTokens: 128450 }, modelContextWindow: 100 }, rateLimits: { rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300 }, secondary: { usedPercent: 28, windowDurationMins: 10080, resetsAt: 1_800_302_400 } } } });
    const trigger = view.getByRole("button", { name: "查看上下文占用情况" });
    fireEvent.click(trigger);
    const dialog = within(document.body).getByRole("dialog", { name: "用量与额度" });
    expect(Array.from(dialog.querySelectorAll("dt")).map(row => row.textContent)).toEqual(["上下文余量", "周期剩余", "时间剩余", "对话 Token"]);
    expect(Array.from(dialog.querySelectorAll("dd")).map(row => row.textContent)).toEqual(["75%", "72%", "1%", "128.5K"]);
    expect(dialog.textContent).not.toMatch(/已用|重置/);
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(within(document.body).queryByRole("dialog", { name: "用量与额度" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.pointerDown(container.querySelector(".conversation-scroll")!);
    expect(within(document.body).queryByRole("dialog", { name: "用量与额度" })).toBeNull();
    vi.restoreAllMocks();
  });
  it.each([
    [null, "暂无数据", "暂无数据"],
    [{ secondary: { usedPercent: null, windowDurationMins: 10080, resetsAt: null } }, "暂无数据", "暂无数据"],
    [{ primary: { usedPercent: 150, windowDurationMins: 10080, resetsAt: 1 } }, "0%", "暂无数据"],
    [{ primary: { usedPercent: -20, windowDurationMins: 10080, resetsAt: 9_000_000_000 } }, "暂无数据", "暂无数据"],
    [{ primary: { usedPercent: Infinity, windowDurationMins: Infinity, resetsAt: Infinity } }, "暂无数据", "暂无数据"],
  ])("周期和五小时额度处理未知值、边界 %j", (rateLimits, quota, time) => {
    const { view } = setup({ tokenUsage: { last: { totalTokens: null }, modelContextWindow: 100 }, rateLimits });
    fireEvent.click(view.getByRole("button", { name: "查看上下文占用情况" }));
    const dialog = within(document.body).getByRole("dialog", { name: "用量与额度" });
    expect(Array.from(dialog.querySelectorAll("dd")).map(row => row.textContent)).toEqual(["暂无数据", quota, time, "暂无数据"]);
  });
  it.each([false, true])("新聊天菜单只在保存成功后关闭：%s", async success => {
    const onSaveDraft = vi.fn(async () => success);
    const { view, container, current, rerender } = setup({ active: { id: "", turns: [] }, onSaveDraft });
    expect(container.querySelector(".new-chat-draft-actions button")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "会话操作" }));
    fireEvent.click(view.getByRole("menuitem", { name: "保存草稿" }));
    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledOnce());
    await waitFor(() => expect(Boolean(view.queryByRole("menu", { name: "会话操作" }))).toBe(!success));
    rerender(<ConversationPage {...current} draftSaveStatus="草稿已保存" />);
    expect(view.getByRole("status").textContent).toBe("草稿已保存");
  });
  it.each([{ draft: "" }, { imageReading: true }, { busy: true }, { operationPending: true }, { draftSaving: true }])("保存沿用实际禁用条件 %j", override => {
    const onSaveDraft = vi.fn(); const { view } = setup({ active: { id: "", turns: [] }, onSaveDraft, ...override });
    fireEvent.click(view.getByRole("button", { name: "会话操作" }));
    const save = view.getByRole("menuitem", { name: /保存/ });
    expect(save.hasAttribute("disabled")).toBe(true); fireEvent.click(save); expect(onSaveDraft).not.toHaveBeenCalled();
  });
  it("已有会话菜单获得焦点并支持 Escape 归还触发按钮", () => {
    const { view } = setup(); const trigger = view.getByRole("button", { name: "会话操作" });
    fireEvent.click(trigger);
    expect(document.activeElement?.closest(".conversation-action-menu")).not.toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(view.queryByRole("button", { name: "归档" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("最后请求明确缺失用量时不拿累计用量伪装当前上下文", () => {
    const { container, view } = setup({ tokenUsage: { last: { totalTokens: null }, total: { totalTokens: 80 }, modelContextWindow: 100 } });
    expect(container.querySelector(".context-ring-progress")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "查看上下文占用情况" }));
    expect(within(document.body).getByText("上下文余量").nextElementSibling?.textContent).toBe("暂无数据");
  });
  it("输入转到工具栏按钮焦点时保持展开，避免点击前按钮消失", () => {
    const { container, view } = setup(); const input = view.getByRole("textbox");
    act(() => input.focus()); const button = view.getByRole("button", { name: "选择模型与思考强度" });
    fireEvent.pointerDown(button); act(() => button.focus());
    expect(container.querySelector(".composer-wrap")?.getAttribute("data-expanded")).toBe("true");
  });
  it.each(["", "单行草稿"])("展开态最小高度不让空或单行输入失焦后锁定展开：%j", draft => {
    emulateComposerLayout(); const { container, view } = setup({ draft });
    const input = view.getByRole("textbox") as HTMLTextAreaElement;
    act(() => input.focus()); input.setSelectionRange(0, Math.min(2, draft.length));
    expect(container.querySelector(".composer-wrap")?.getAttribute("data-expanded")).toBe("true");
    act(() => input.blur());
    expect(container.querySelector(".composer-wrap")?.getAttribute("data-expanded")).toBe("false");
    expect(view.getByRole("textbox")).toBe(input); expect(input.value).toBe(draft);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, Math.min(2, draft.length)]);
  });
  it.each([1, 1.5])("真实换行、长文、附件失焦保持展开，字号倍率 %s", fontScale => {
    emulateComposerLayout(fontScale);
    const { container, view, current, rerender } = setup({ draft: "第一行\n第二行" });
    const input = view.getByRole("textbox") as HTMLTextAreaElement;
    act(() => input.focus()); act(() => input.blur());
    expect(container.querySelector(".composer-wrap")?.getAttribute("data-expanded")).toBe("true");
    rerender(<ConversationPage {...current} draft="这是一段足够长以便模拟输入框自然换行的连续草稿文字" />);
    act(() => input.focus()); act(() => input.blur());
    expect(container.querySelector(".composer-wrap")?.getAttribute("data-expanded")).toBe("true");
    rerender(<ConversationPage {...current} draft="" draftImages={[{ id: "image", name: "图片", url: "data:image/png;base64," } as any]} />);
    expect(container.querySelector(".composer-wrap")?.getAttribute("data-expanded")).toBe("true");
    rerender(<ConversationPage {...current} draft="单行" />); act(() => input.focus()); act(() => input.blur());
    expect(container.querySelector(".composer-wrap")?.getAttribute("data-expanded")).toBe("false");
    expect(view.getByRole("textbox")).toBe(input);
  });
  it("真实多行高度受上限约束，内容清空时同一输入框恢复", () => {
    let height = 110;
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(() => height);
    const { view, current, rerender } = setup({ draft: "第一行\n第二行\n第三行" }); const input = view.getByRole("textbox") as HTMLTextAreaElement;
    expect(input.style.height).toBe("110px"); height = 400; rerender(<ConversationPage {...current} draft="更多行内容" />);
    expect(input.style.height).toBe("154px"); height = 22; rerender(<ConversationPage {...current} draft="" />);
    expect(view.getByRole("textbox")).toBe(input); expect(input.style.height).toBe("22px");
  });
  it("已有会话保留六项真实操作，不展示保存草稿", () => {
    const { view } = setup({ onSaveDraft: vi.fn() }); fireEvent.click(view.getByRole("button", { name: "会话操作" }));
    for (const name of ["关注", "刷新会话", "复制会话", "复制会话 ID", "重命名", "归档"]) expect(view.getByRole("button", { name })).not.toBeNull();
    expect(view.queryByText("保存草稿")).toBeNull();
  });
  it("同一 textarea 在焦点展开、换行和切换版本时保留节点与草稿", () => {
    const { container, view, current, rerender } = setup(); const input = view.getByRole("textbox") as HTMLTextAreaElement;
    expect(container.querySelector(".composer-wrap")?.getAttribute("data-expanded")).toBe("false");
    act(() => input.focus()); expect(container.querySelector(".composer-wrap")?.getAttribute("data-expanded")).toBe("true");
    act(() => input.blur());
    rerender(<ConversationPage {...current} draft={"第一行\n第二行"} />);
    expect(container.querySelector(".composer-wrap")?.getAttribute("data-expanded")).toBe("true");
    preference.modern = false; rerender(<ConversationPage {...current} />);
    expect(view.getByRole("textbox")).toBe(input); expect(input.value).toBe("保留草稿");
  });
  it("旧版最大化切换新版时保留 textarea，采用新版自适应输入布局", () => {
    preference.modern = false; const { container, view, current, rerender } = setup(); const input = view.getByRole("textbox");
    fireEvent.click(view.getByRole("button", { name: "最大化输入框" }));
    preference.modern = true; rerender(<ConversationPage {...current} />);
    expect(view.getByRole("textbox")).toBe(input);
    expect(container.querySelector(".composer-wrap-maximized")).toBeNull();
    expect(container.querySelector(".composer-wrap")?.getAttribute("data-expanded")).toBe("true");
  });
  it("展开工具栏依次提供附件、权限、速度、真实模型和强度、发送", () => {
    const onOpenSpeedSettings = vi.fn(); const { container, view, current } = setup({ onOpenSpeedSettings });
    act(() => view.getByRole("textbox").focus());
    const composer = container.querySelector(".composer")!;
    expect(within(composer as HTMLElement).getAllByRole("button").filter(b => !b.classList.contains("composer-size-button")).map(b => b.getAttribute("aria-label"))).toEqual(["添加附件", "选择审批与权限模式", "选择速度", "选择模型与思考强度", "发送"]);
    const model = view.getByRole("button", { name: "选择模型与思考强度" });
    expect(model.textContent).toContain("GPT-5 Mini"); expect(model.textContent).toContain("中"); expect(model.querySelector("svg")).toBeNull();
    fireEvent.click(model); expect(current.onOpenAgentSettings).toHaveBeenCalledOnce();
    fireEvent.click(view.getByRole("button", { name: "选择速度" })); expect(onOpenSpeedSettings).toHaveBeenCalledOnce();
  });
  it("忙碌时有草稿排队、空草稿停止，历史分页和只读保持业务行为", () => {
    const { view, current, rerender } = setup({ busy: true, olderTurnsState: "idle" });
    fireEvent.click(view.getByRole("button", { name: "排队" })); expect(current.onSubmit).toHaveBeenCalledOnce();
    fireEvent.click(view.getByRole("button", { name: "加载更早消息" })); expect(current.onLoadOlderTurns).toHaveBeenCalledOnce();
    rerender(<ConversationPage {...current} draft="" />); fireEvent.click(view.getByRole("button", { name: "停止" })); expect(current.onInterrupt).toHaveBeenCalledOnce();
    rerender(<ConversationPage {...current} accessMode="readOnly" />); expect(view.getByRole("textbox").hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "选择模型与思考强度" }).hasAttribute("disabled")).toBe(true);
  });
  it.each([
    ["选择模型与思考强度", "GPT-5"], ["选择审批与权限模式", "工作区"], ["选择速度", "正常"],
  ])("键盘从 %s 打开设置后，关闭或选择回到原按钮且工具栏可见", (name, choice) => {
    const { container } = render(<SettingsConversation />); const view = within(container);
    const input = view.getByRole("textbox"); const trigger = view.getByRole("button", { name });
    for (const select of [false, true]) {
      act(() => input.focus()); fireEvent.keyDown(input, { key: "Tab", shiftKey: true }); act(() => trigger.focus());
      fireEvent.keyDown(trigger, { key: "Enter" }); fireEvent.click(trigger);
      const panel = view.getByRole("dialog"); expect(document.activeElement).toBe(panel);
      if (select) fireEvent.click(within(panel).getByRole("button", { name: choice === "GPT-5" ? choice : new RegExp(`^${choice}`) }));
      else fireEvent.keyDown(panel, { key: "Escape" });
      expect(view.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(container.querySelector(".composer-wrap")?.getAttribute("data-expanded")).toBe("true");
      expect(document.activeElement).not.toBe(input);
    }
  });
  it.each(["navigate", "history"])("键盘设置的触发按钮在 %s 后不恢复焦点", destination => {
    const { container, rerender } = render(<SettingsConversation />); const view = within(container);
    const input = view.getByRole("textbox"); const trigger = view.getByRole("button", { name: "选择模型与思考强度" });
    act(() => input.focus()); act(() => trigger.focus()); fireEvent.click(trigger);
    const overrides: Partial<Props> = destination === "navigate" ? { active: { id: "other", turns: [] } } :
      { historyEdit: { target: { messageId: "history", turnId: "turn" } as any, text: "历史消息", submitting: false } };
    rerender(<SettingsConversation overrides={overrides} />);
    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    expect(document.activeElement).not.toBe(trigger); expect(document.activeElement).not.toBe(input);
  });
  it("开始历史编辑或组件卸载后，旧设置回调不能抢回输入焦点", () => {
    const onOpenAgentSettings = vi.fn(); const { view, current, rerender, unmount } = setup({ onOpenAgentSettings });
    const input = view.getByRole("textbox") as HTMLTextAreaElement; act(() => input.focus());
    fireEvent.click(view.getByRole("button", { name: "选择模型与思考强度" }));
    const restore = onOpenAgentSettings.mock.calls[0][0] as () => void; act(() => input.blur());
    rerender(<ConversationPage {...current} historyEdit={{ target: { messageId: "history", turnId: "turn" } as any, text: "历史消息", submitting: false }} />);
    act(() => restore()); expect(document.activeElement).not.toBe(input);
    unmount(); act(() => restore()); expect(document.activeElement).not.toBe(input);
  });
  it("设置打开后离开再回到同名会话，原焦点恢复授权失效", () => {
    const onOpenAgentSettings = vi.fn(); const { view, current, rerender } = setup({ onOpenAgentSettings });
    const input = view.getByRole("textbox"); act(() => input.focus());
    fireEvent.click(view.getByRole("button", { name: "选择模型与思考强度" }));
    const restore = onOpenAgentSettings.mock.calls[0][0] as () => void; act(() => input.blur());
    rerender(<ConversationPage {...current} active={{ id: "other", turns: [] }} />);
    rerender(<ConversationPage {...current} />); act(() => restore());
    expect(document.activeElement).not.toBe(input);
  });
  it("同后端新聊天重新创建也使旧焦点恢复授权失效", () => {
    const onOpenAgentSettings = vi.fn(); const { view, current, rerender } = setup({ active: { id: "", turns: [] }, onOpenAgentSettings });
    const input = view.getByRole("textbox"); act(() => input.focus());
    fireEvent.click(view.getByRole("button", { name: "选择模型与思考强度" }));
    const restore = onOpenAgentSettings.mock.calls[0][0] as () => void; act(() => input.blur());
    rerender(<ConversationPage {...current} active={{ id: "", turns: [] }} />); act(() => restore());
    expect(document.activeElement).not.toBe(input);
  });
  it("设置只恢复发起操作时的当前输入框焦点及选区，导航后失效", () => {
    const onOpenAgentSettings = vi.fn(); const { view, current, rerender } = setup({ onOpenAgentSettings });
    const input = view.getByRole("textbox") as HTMLTextAreaElement; act(() => input.focus()); input.setSelectionRange(1, 3);
    const trigger = view.getByRole("button", { name: "选择模型与思考强度" });
    fireEvent.pointerDown(trigger); act(() => input.blur()); fireEvent.click(trigger);
    const restore = onOpenAgentSettings.mock.calls[0][0] as () => void; expect(restore).toBeTypeOf("function");
    act(() => restore()); expect(document.activeElement).toBe(input); expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
    act(() => input.blur()); rerender(<ConversationPage {...current} active={{ id: "other", turns: [] }} />);
    act(() => restore()); expect(document.activeElement).not.toBe(input);
    fireEvent.click(view.getByRole("button", { name: "选择模型与思考强度" }));
    expect(onOpenAgentSettings.mock.calls.at(-1)?.[0]).toBeUndefined();
  });
});

describe("新版模型与权限设置", () => {
  it("同一面板包含两组单选列表，选中检查标记与真实回调一致", () => {
    const current = settingsProps(); const { container } = render(<ComposerSettings {...current} />); const view = within(container);
    const models = view.getByRole("group", { name: "模型" }); const efforts = view.getByRole("group", { name: "思考强度" });
    expect(within(models).getByRole("button", { name: /GPT-5 Mini/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(models).getByRole("button", { name: "GPT-5" })); expect(current.onChooseModel).toHaveBeenCalledWith("full");
    fireEvent.click(within(efforts).getByRole("button", { name: "高" })); expect(current.onChooseEffort).toHaveBeenCalledWith("high");
    expect(view.queryByRole("slider")).toBeNull();
  });
  it("touchend 同步恢复键盘且尾随 click 不重复选择，滚动不会误选", () => {
    const current = settingsProps(); const restore = vi.fn();
    const { container } = render(<ComposerSettings {...current} {...{ onRestoreComposerFocus: restore }} />); const view = within(container);
    const model = view.getByRole("button", { name: "GPT-5" });
    fireEvent.touchStart(model, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchEnd(model, { changedTouches: [{ clientX: 10, clientY: 10 }] }); fireEvent.click(model);
    expect(current.onChooseModel).toHaveBeenCalledTimes(1); expect(restore).toHaveBeenCalledOnce();
    fireEvent.touchStart(model, { touches: [{ clientX: 10, clientY: 10 }] }); fireEvent.touchMove(model, { touches: [{ clientX: 10, clientY: 50 }] });
    fireEvent.touchEnd(model, { changedTouches: [{ clientX: 10, clientY: 50 }] }); fireEvent.click(model);
    expect(current.onChooseModel).toHaveBeenCalledTimes(1);
  });
  it.each(["permission", "speed"] as const)("%s 选择执行原回调并同步恢复焦点", picker => {
    const current = settingsProps(); const restore = vi.fn();
    const { container } = render(<ComposerSettings {...current} picker={picker} onRestoreComposerFocus={restore} />);
    const choice = within(container).getByRole("button", { name: picker === "permission" ? /工作区/ : /正常/ });
    fireEvent.touchStart(choice, { touches: [{ clientX: 8, clientY: 8 }] });
    fireEvent.touchEnd(choice, { changedTouches: [{ clientX: 8, clientY: 8 }] });
    expect(restore).toHaveBeenCalledOnce(); expect(picker === "permission" ? current.onChoosePermissionMode : current.onChooseSpeed).toHaveBeenCalledWith(picker === "permission" ? "workspace-write" : null);
  });
  it.each(["model", "permission", "speed"] as const)("关闭 %s 恢复输入焦点", picker => {
    const restore = vi.fn(); const current = settingsProps(); const { container } = render(<ComposerSettings {...current} picker={picker} {...{ onRestoreComposerFocus: restore }} />);
    fireEvent.keyDown(within(container).getByRole("dialog"), { key: "Escape" }); expect(restore).toHaveBeenCalledOnce(); expect(current.onPickerChange).toHaveBeenCalledWith(null);
  });
});
