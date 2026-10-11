import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContextActionMenu } from "../../src/ui/ContextActionMenu";
import { TurnCard } from "../../src/features/conversation/Timeline";
import { ACTION_MENU_EVENT } from "../../src/ui/native-action-menu";

const anchor = { x: 10, y: 20, width: 200, height: 40 };
afterEach(() => { cleanup(); delete (window as any).CodexMobileActionMenu; vi.useRealTimers(); });

it("同时打开另一条菜单时取消旧菜单，旧事件不能触发操作", () => {
  const show = vi.fn(); const dismiss = vi.fn();
  (window as any).CodexMobileActionMenu = { show, dismiss };
  const select = vi.fn(); const close = vi.fn();
  render(<ContextActionMenu actions={[{ id: "copy", title: "复制", onSelect: select }]} anchor={anchor} label="第一条" onClose={close} />);
  const first = JSON.parse(show.mock.calls[0][0]);
  const secondView = render(<ContextActionMenu actions={[{ id: "edit", title: "编辑", onSelect: select }]} anchor={anchor} label="第二条" onClose={() => {}} />);
  expect(close).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(new CustomEvent(ACTION_MENU_EVENT, { detail: { requestId: first.requestId, actionId: "copy" } })));
  expect(select).not.toHaveBeenCalled();
  secondView.unmount();
  expect(dismiss).toHaveBeenCalledTimes(2);
});

it("原生取消只关闭当前菜单，禁用动作和重复事件不执行", () => {
  const show = vi.fn(); const dismiss = vi.fn();
  (window as any).CodexMobileActionMenu = { show, dismiss };
  const select = vi.fn(); const close = vi.fn();
  render(<ContextActionMenu actions={[{ id: "edit", title: "编辑", disabled: true, onSelect: select }]} anchor={anchor} label="消息操作" onClose={close} />);
  const request = JSON.parse(show.mock.calls[0][0]);
  for (const id of ["unknown-request", request.requestId, request.requestId]) {
    act(() => window.dispatchEvent(new CustomEvent(ACTION_MENU_EVENT, { detail: { requestId: id, actionId: "edit" } })));
  }
  expect(close).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).toBeNull();
});

it("滚动取消消息长按，静止长按可打开且不自动选中文字", () => {
  vi.useFakeTimers();
  const { container } = render(<TurnCard client={null} turn={{ id: "gesture", status: "completed", items: [
    { id: "user", type: "userMessage", text: "可以长按" },
  ] }} />);
  const bubble = container.querySelector(".user-bubble")!;
  fireEvent.pointerDown(bubble, { button: 0, clientX: 10, clientY: 20 });
  fireEvent.pointerMove(bubble, { clientX: 10, clientY: 45 });
  act(() => vi.advanceTimersByTime(550));
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.pointerDown(bubble, { button: 0, clientX: 10, clientY: 20 });
  act(() => vi.advanceTimersByTime(550));
  expect(screen.getByRole("menuitem", { name: "复制" })).toBeTruthy();
  expect(window.getSelection()?.toString()).toBe("");
});
