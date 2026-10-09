import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { ActionSheet } from "../../src/ui/ActionSheet";
import { useSidebarSwipe } from "../../src/features/threads/sidebar-swipe";

function touch(
  target: Element,
  type: string,
  points: Array<[number, number]>,
  timeStamp?: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: points.map(([clientX, clientY]) => ({ clientX, clientY })),
  });
  if (timeStamp !== undefined) {
    Object.defineProperty(event, "timeStamp", { value: timeStamp });
  }
  act(() => target.dispatchEvent(event));
  return event;
}

function workspace() {
  const surface = document.createElement("div");
  surface.className = "backend-workspace";
  document.body.append(surface);
  return surface;
}

function sidebarLayer(open = false) {
  const layer = document.createElement("div");
  layer.className = `conversation-sidebar-layer${open ? " open" : ""}`;
  const panel = layer.appendChild(document.createElement("aside"));
  panel.className = "conversation-sidebar";
  panel.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
  const scrim = layer.appendChild(document.createElement("button"));
  scrim.className = "conversation-sidebar-scrim";
  document.body.append(layer);
  return layer;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("会话侧栏右滑手势", () => {
  it("拖动中出现更高弹层时取消侧栏手势，弹层遮罩也不触发侧栏", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSidebarSwipe(true, vi.fn(), onClose));
    const layer = sidebarLayer(true);
    result.current.current = layer;
    const panel = layer.querySelector("aside")!;
    touch(panel, "touchstart", [[250, 300]]);
    touch(panel, "touchmove", [[210, 305]]);
    expect(layer.classList.contains("dragging")).toBe(true);
    const { container, unmount } = render(createElement(ActionSheet, {
      title: "管理设备", children: "设置",
    }));
    touch(panel, "touchmove", [[120, 309]]);
    touch(panel, "touchend", []);
    expect(onClose).not.toHaveBeenCalled();
    expect(layer.classList.contains("dragging")).toBe(false);
    const backdrop = container.querySelector(".action-sheet-backdrop")!;
    touch(backdrop, "touchstart", [[250, 300]]);
    touch(backdrop, "touchmove", [[120, 309]]);
    touch(backdrop, "touchend", []);
    expect(onClose).not.toHaveBeenCalled();
    unmount();
    touch(panel, "touchstart", [[250, 300]]);
    touch(panel, "touchmove", [[120, 309]]);
    touch(panel, "touchend", []);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("会话中部右滑时面板跟随位移，松手后展开", () => {
    const onOpen = vi.fn();
    const { result, rerender } = renderHook(
      ({ open }) => useSidebarSwipe(open, onOpen, vi.fn()),
      { initialProps: { open: false } },
    );
    const layer = sidebarLayer();
    result.current.current = layer;
    const surface = workspace();

    touch(surface, "touchstart", [[180, 300]]);
    const move = touch(surface, "touchmove", [[210, 305]]);
    expect(move.defaultPrevented).toBe(true);
    expect(layer.classList.contains("dragging")).toBe(true);
    expect(layer.style.getPropertyValue("--sidebar-drag-x")).toBe("30px");
    expect(Number(layer.style.getPropertyValue("--sidebar-drag-progress"))).toBeCloseTo(30 / 312);
    expect(onOpen).not.toHaveBeenCalled();
    touch(surface, "touchmove", [[300, 309]]);
    expect(layer.style.getPropertyValue("--sidebar-drag-x")).toBe("120px");
    expect(onOpen).not.toHaveBeenCalled();
    touch(surface, "touchend", []);
    expect(onOpen).toHaveBeenCalledTimes(1);
    rerender({ open: true });
    expect(layer.classList.contains("dragging")).toBe(false);
    expect(layer.style.getPropertyValue("--sidebar-drag-x")).toBe("");
  });

  it("拖动不足时收回，取消触摸时清理预览", () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useSidebarSwipe(false, onOpen, vi.fn()));
    const layer = sidebarLayer();
    result.current.current = layer;
    const surface = workspace();

    touch(surface, "touchstart", [[180, 200]]);
    touch(surface, "touchmove", [[210, 205]]);
    touch(surface, "touchend", []);
    expect(onOpen).not.toHaveBeenCalled();
    expect(layer.classList.contains("dragging")).toBe(false);

    touch(surface, "touchstart", [[180, 200]]);
    touch(surface, "touchmove", [[260, 205]]);
    touch(surface, "touchcancel", []);
    expect(layer.classList.contains("dragging")).toBe(false);
    expect(layer.style.getPropertyValue("--sidebar-drag-progress")).toBe("");
  });

  it("短距离快速右滑松手后仍可展开", () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useSidebarSwipe(false, onOpen, vi.fn()));
    result.current.current = sidebarLayer();
    const surface = workspace();

    touch(surface, "touchstart", [[180, 200]], 100);
    touch(surface, "touchmove", [[250, 203]], 200);
    touch(surface, "touchend", [], 220);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("保留左边缘右滑，并忽略纵向滚动和多指触控", () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useSidebarSwipe(false, onOpen, vi.fn()));
    const layer = sidebarLayer();
    result.current.current = layer;
    const surface = workspace();

    touch(surface, "touchstart", [[10, 200]]);
    touch(surface, "touchmove", [[120, 205]]);
    touch(surface, "touchend", []);
    expect(onOpen).toHaveBeenCalledTimes(1);

    touch(surface, "touchstart", [[180, 200]]);
    const vertical = touch(surface, "touchmove", [[200, 260]]);
    touch(surface, "touchmove", [[270, 262]]);
    touch(surface, "touchend", []);
    expect(vertical.defaultPrevented).toBe(false);
    expect(layer.classList.contains("dragging")).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(1);

    touch(surface, "touchstart", [[180, 200]]);
    touch(surface, "touchmove", [[220, 205]]);
    touch(surface, "touchstart", [[220, 205], [240, 205]]);
    touch(surface, "touchmove", [[270, 205]]);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(layer.classList.contains("dragging")).toBe(false);
  });

  it("不抢输入框、弹层和横向滚动内容的手势", () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useSidebarSwipe(false, onOpen, vi.fn()));
    const layer = sidebarLayer();
    result.current.current = layer;
    const surface = workspace();
    const input = surface.appendChild(document.createElement("textarea"));
    const dialog = surface.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "dialog");
    const scroll = surface.appendChild(document.createElement("div"));
    scroll.style.overflowX = "auto";
    Object.defineProperties(scroll, {
      scrollWidth: { value: 400 },
      clientWidth: { value: 200 },
    });

    for (const target of [input, dialog, scroll]) {
      touch(target, "touchstart", [[180, 200]]);
      touch(target, "touchmove", [[260, 205]]);
      touch(target, "touchend", []);
    }
    expect(onOpen).not.toHaveBeenCalled();
    expect(layer.classList.contains("dragging")).toBe(false);
  });

  it("侧栏已打开或从非会话区域起滑时不打开", () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useSidebarSwipe(true, onOpen, vi.fn()));
    result.current.current = sidebarLayer();
    const surface = workspace();
    touch(surface, "touchstart", [[180, 200]]);
    touch(surface, "touchmove", [[260, 205]]);
    touch(document.body, "touchstart", [[180, 200]]);
    touch(document.body, "touchmove", [[260, 205]]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("侧栏内左滑时跟手收回，松手后关闭", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ open }) => useSidebarSwipe(open, onOpen, onClose),
      { initialProps: { open: true } },
    );
    const layer = sidebarLayer(true);
    result.current.current = layer;
    const panel = layer.querySelector("aside")!;

    touch(panel, "touchstart", [[250, 300]]);
    const move = touch(panel, "touchmove", [[210, 305]]);
    expect(move.defaultPrevented).toBe(true);
    expect(layer.classList.contains("dragging")).toBe(true);
    expect(layer.style.getPropertyValue("--sidebar-drag-x")).toBe("-40px");
    expect(Number(layer.style.getPropertyValue("--sidebar-drag-progress"))).toBeCloseTo(1 - 40 / 312);
    expect(onClose).not.toHaveBeenCalled();

    touch(panel, "touchmove", [[120, 309]]);
    expect(layer.style.getPropertyValue("--sidebar-drag-x")).toBe("-130px");
    touch(panel, "touchend", []);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    rerender({ open: false });
    expect(layer.classList.contains("dragging")).toBe(false);
  });

  it("右侧未被面板覆盖的遮罩区域左滑也跟手收回", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSidebarSwipe(true, vi.fn(), onClose));
    const layer = sidebarLayer(true);
    result.current.current = layer;
    const scrim = layer.querySelector(".conversation-sidebar-scrim")!;

    touch(scrim, "touchstart", [[380, 300]]);
    const move = touch(scrim, "touchmove", [[340, 305]]);
    expect(move.defaultPrevented).toBe(true);
    expect(layer.classList.contains("dragging")).toBe(true);
    expect(layer.style.getPropertyValue("--sidebar-drag-x")).toBe("-40px");
    expect(onClose).not.toHaveBeenCalled();

    touch(scrim, "touchmove", [[250, 309]]);
    touch(scrim, "touchend", []);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("侧栏内短拖和取消触摸会恢复展开状态", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSidebarSwipe(true, vi.fn(), onClose));
    const layer = sidebarLayer(true);
    result.current.current = layer;
    const panel = layer.querySelector("aside")!;

    touch(panel, "touchstart", [[250, 300]]);
    touch(panel, "touchmove", [[220, 305]]);
    touch(panel, "touchend", []);
    expect(onClose).not.toHaveBeenCalled();
    expect(layer.classList.contains("dragging")).toBe(false);

    touch(panel, "touchstart", [[250, 300]]);
    touch(panel, "touchmove", [[170, 305]]);
    touch(panel, "touchcancel", []);
    expect(onClose).not.toHaveBeenCalled();
    expect(layer.style.getPropertyValue("--sidebar-drag-x")).toBe("");
  });

  it("侧栏的纵向列表、搜索框和横向滚动区域保持原有手势", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSidebarSwipe(true, vi.fn(), onClose));
    const layer = sidebarLayer(true);
    result.current.current = layer;
    const panel = layer.querySelector("aside")!;
    const list = panel.appendChild(document.createElement("div"));
    const input = panel.appendChild(document.createElement("input"));
    const horizontal = panel.appendChild(document.createElement("div"));
    horizontal.style.overflowX = "auto";
    Object.defineProperties(horizontal, {
      scrollWidth: { value: 400 },
      clientWidth: { value: 200 },
    });

    touch(list, "touchstart", [[250, 200]]);
    const vertical = touch(list, "touchmove", [[245, 270]]);
    touch(list, "touchmove", [[110, 275]]);
    touch(list, "touchend", []);
    expect(vertical.defaultPrevented).toBe(false);
    for (const target of [input, horizontal]) {
      touch(target, "touchstart", [[250, 200]]);
      touch(target, "touchmove", [[110, 205]]);
      touch(target, "touchend", []);
    }
    expect(onClose).not.toHaveBeenCalled();
    expect(layer.classList.contains("dragging")).toBe(false);
  });
});
