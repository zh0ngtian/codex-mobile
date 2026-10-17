import { act, fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ContextUsageButton,
  ConversationActionMenu,
  contextUsageView,
} from "../../src/features/conversation/ConversationControls";
import { ACTION_MENU_EVENT } from "../../src/ui/native-action-menu";

describe("对话详情控制", () => {
  it("原生重命名先分发动作，再关闭已消费的菜单，不等待重命名完成", () => {
    const show = vi.fn();
    (window as any).CodexMobileActionMenu = { show, dismiss: vi.fn() };
    try {
      const calls: string[] = [];
      const { unmount } = render(
        <ConversationActionMenu
          open
          thread={{ id: "thread-1", preview: "当前会话" }}
          pendingAction=""
          onClose={() => calls.push("close")}
          onPin={() => undefined}
          onRefresh={() => undefined}
          onDuplicate={() => undefined}
          onCopy={() => undefined}
          onRename={() => {
            calls.push("rename");
            return new Promise<boolean>(() => {});
          }}
          onArchive={() => undefined}
        />,
      );
      const request = JSON.parse(show.mock.calls[0][0]);
      act(() => window.dispatchEvent(new CustomEvent(ACTION_MENU_EVENT, {
        detail: { requestId: request.requestId, actionId: "rename" },
      })));
      expect(calls).toEqual(["rename", "close"]);
      unmount();
    } finally {
      delete (window as any).CodexMobileActionMenu;
    }
  });

  it("上下文环和面板文字由同一份 token usage 推导", () => {
    expect(
      contextUsageView({
        total: { totalTokens: 3_084_000 },
        last: { totalTokens: 100_000 },
        modelContextWindow: 250_000,
      }),
    ).toEqual({
      used: 100_000,
      total: 250_000,
      usedPercent: 40,
      remainingPercent: 60,
    });
  });

  it("上下文按钮保留无障碍名称并声明卡片开关状态", () => {
    const { container } = render(
      <ContextUsageButton
        open
        tokenUsage={null}
        onClick={() => undefined}
      />,
    );
    const button = within(container).getByRole("button", { name: "查看上下文占用情况" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("操作面板根据持久化字段切换关注文案", () => {
    const onPin = vi.fn();
    const onRefresh = vi.fn();
    const onDuplicate = vi.fn();
    const { container, rerender } = render(
      <ConversationActionMenu
        open
        thread={{ id: "thread-1", preview: "会话", isPinned: false }}
        pendingAction=""
        onClose={() => undefined}
        onPin={onPin}
        onRefresh={onRefresh}
        onDuplicate={onDuplicate}
        onCopy={() => undefined}
        onRename={() => undefined}
        onArchive={() => undefined}
      />,
    );
    let view = within(container);

    fireEvent.click(view.getByRole("button", { name: "关注" }));
    expect(onPin).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole("button", { name: "刷新会话" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole("button", { name: "复制会话" }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);

    rerender(
      <ConversationActionMenu
        open
        thread={{ id: "thread-1", preview: "会话", isPinned: true }}
        pendingAction=""
        onClose={() => undefined}
        onPin={onPin}
        onRefresh={onRefresh}
        onDuplicate={onDuplicate}
        onCopy={() => undefined}
        onRename={() => undefined}
        onArchive={() => undefined}
      />,
    );
    view = within(container);
    expect(view.getByRole("button", { name: "取消关注" })).not.toBeNull();
  });

  it("只读会话仍可本地关注，但禁用服务端写操作", () => {
    const onPin = vi.fn();
    const { container } = render(
      <ConversationActionMenu
        open
        readOnly
        thread={{ id: "thread-1", preview: "会话", isPinned: false }}
        pendingAction=""
        onClose={() => undefined}
        onPin={onPin}
        onRefresh={() => undefined}
        onDuplicate={() => undefined}
        onCopy={() => undefined}
        onRename={() => undefined}
        onArchive={() => undefined}
      />,
    );
    const view = within(container);

    expect(view.getByRole("button", { name: "刷新会话" }).hasAttribute("disabled")).toBe(false);
    expect(view.getByRole("button", { name: "复制会话" }).hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "复制会话 ID" }).hasAttribute("disabled")).toBe(false);
    expect(view.getByRole("button", { name: "关注" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "关注" }));
    expect(onPin).toHaveBeenCalledOnce();
    expect(view.getByRole("button", { name: "重命名" }).hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "归档" }).hasAttribute("disabled")).toBe(true);
  });
});
