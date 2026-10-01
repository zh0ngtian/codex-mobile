import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ConversationActionMenu,
  ConversationStatusSheet,
  contextUsageView,
  sevenDayRateLimitView,
} from "../../src/features/conversation/ConversationControls";

describe("对话详情控制", () => {
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

  it("优先使用 7 天窗口并显示剩余比例", () => {
    expect(
      sevenDayRateLimitView({
        rateLimits: {
          primary: { usedPercent: 20, windowDurationMins: 300 },
          secondary: {
            usedPercent: 29,
            windowDurationMins: 10_080,
            resetsAt: 1_800_000_000,
          },
        },
      }),
    ).toEqual({
      remainingPercent: 71,
      resetsAt: 1_800_000_000,
    });
  });

  it("状态面板在缺失用量时显示暂无数据", () => {
    const { container } = render(
      <ConversationStatusSheet
        open
        thread={{ id: "thread-1", cwd: "/tmp/project" }}
        tokenUsage={null}
        rateLimits={null}
        onClose={() => undefined}
      />,
    );
    const view = within(container);

    expect(view.getByRole("dialog", { name: "状态" })).not.toBeNull();
    expect(view.getAllByText("暂无数据")).toHaveLength(2);
    expect(view.getByText("thread-1")).not.toBeNull();
    expect(view.getByText("/tmp/project")).not.toBeNull();
  });

  it("操作面板根据持久化字段切换置顶文案", () => {
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

    fireEvent.click(view.getByRole("button", { name: "置顶" }));
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
    expect(view.getByRole("button", { name: "取消置顶" })).not.toBeNull();
  });

  it("只读会话保留查看操作并禁用会话写操作", () => {
    const { container } = render(
      <ConversationActionMenu
        open
        readOnly
        thread={{ id: "thread-1", preview: "会话", isPinned: false }}
        pendingAction=""
        onClose={() => undefined}
        onPin={() => undefined}
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
    expect(view.getByRole("button", { name: "置顶" }).hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "重命名" }).hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "归档" }).hasAttribute("disabled")).toBe(true);
  });
});
