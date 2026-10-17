import { createRef, type ComponentProps, type FormEvent } from "react";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";
import { ACTION_MENU_EVENT } from "../../src/ui/native-action-menu";

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
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("网页会话真实操作", () => {
  it("原生重命名取消后下一次点击立即重新打开菜单", async () => {
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

  it("网页重命名取消后保留可见的原菜单", async () => {
    const onRename = vi.fn(async () => false);
    const { view } = setup({ onRename });
    const trigger = view.getByRole("button", { name: "会话操作" });
    fireEvent.click(trigger);
    await act(async () => fireEvent.click(view.getByRole("button", { name: "重命名" })));
    expect(onRename).toHaveBeenCalledOnce();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByRole("button", { name: "重命名" })).toBeTruthy();
  });

  it('业务错误关闭后保持隐藏，新错误仍能恢复提示', () => {
    const { view, current, rerender } = setup({ error: '首次业务失败' });
    expect(view.getByRole('alert')).toHaveTextContent('首次业务失败');
    fireEvent.click(view.getByRole('button', { name: '关闭错误提示' }));
    expect(view.queryByRole('alert')).toBeNull();
    rerender(<ConversationPage {...current} />); expect(view.queryByRole('alert')).toBeNull();
    rerender(<ConversationPage {...current} error="后续业务失败" />);
    expect(view.getByRole('alert')).toHaveTextContent('后续业务失败');
  });
  it('旧会话的位置选择晚完成不能聚焦当前会话输入框', async () => {
    let finish!: (value: boolean) => void;
    const onSelectLocation = () => new Promise<boolean>(resolve => { finish = resolve; });
    const { view, current, rerender } = setup({ onSelectLocation });
    fireEvent.click(view.getByRole('button', { name: '添加附件' }));
    fireEvent.click(view.getByRole('menuitem', { name: '当前位置' }));
    rerender(<ConversationPage {...current} active={{ id: 'new-thread', turns: [] }} />);
    await act(async () => { finish(true); });
    expect(document.activeElement).not.toBe(view.getByRole('textbox', { name: '向 Codex 提问' }));
  });
  it.each(['skill', 'plugin'] as const)('旧会话的 %s 插入回调不能聚焦新会话', kind => {
    const { view, current, rerender } = setup({ draft: '@p',
      skills: [{ name: 'pdf', path: '/pdf/SKILL.md', description: 'PDF', scope: 'user', enabled: true }],
      plugins: [{ id: 'pdf-plugin', name: 'pdf-plugin', installed: true, enabled: true, availability: 'AVAILABLE' }],
    });
    const input = view.getByRole('textbox', { name: '向 Codex 提问' }) as HTMLTextAreaElement;
    input.setSelectionRange(2, 2); fireEvent.select(input);
    const focusInput = vi.spyOn(input, "focus");
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callbacks.push(callback); return callbacks.length; });
    fireEvent.click(view.getByRole('option', { name: kind === 'skill' ? /\$pdf/ : /@pdf-plugin/ }));
    rerender(<ConversationPage {...current} active={{ id: 'new-thread', turns: [] }} />);
    // 正常网页 select 会主动聚焦 textarea；切换后把焦点放到当前会话入口，验证旧回调不会夺回它。
    const currentTrigger = view.getByRole('button', { name: '打开会话列表' });
    act(() => currentTrigger.focus());
    act(() => callbacks.forEach(callback => callback(0)));
    expect(focusInput).not.toHaveBeenCalled();
    expect(currentTrigger).toHaveFocus();
  });
});

it('普通网页会话为输入区和附件的实际高度预留滚动空间', () => {
  let height = 220;
  const observed = new Map<Element, Set<() => void>>();
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe(element: Element) {
      const callbacks = observed.get(element) ?? new Set();
      callbacks.add(this.callback); observed.set(element, callbacks);
    }
    unobserve(element: Element) { observed.get(element)?.delete(this.callback); }
    disconnect() { for (const callbacks of observed.values()) callbacks.delete(this.callback); }
  });
  vi.spyOn(HTMLFormElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 390, height));
  const { container, unmount } = setup();
  const scroll = container.querySelector<HTMLElement>('.conversation-scroll')!;
  const composer = container.querySelector<HTMLFormElement>('.composer-wrap')!;
  expect(scroll.style.getPropertyValue('--composer-height')).toBe('220px');
  height = 310; act(() => observed.get(composer)!.forEach(callback => callback()));
  expect(scroll.style.getPropertyValue('--composer-height')).toBe('310px');
  unmount(); expect(scroll.style.getPropertyValue('--composer-height')).toBe('');
});
