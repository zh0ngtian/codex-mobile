import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function sidebarLayer() {
  const layer = document.createElement("div");
  layer.className = "conversation-sidebar-layer";
  const panel = layer.appendChild(document.createElement("aside"));
  panel.className = "conversation-sidebar";
  panel.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
  document.body.append(layer);
  return layer;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("会话侧栏右滑手势", () => {
  it("会话中部右滑时面板跟随位移，松手后展开", () => {
    const onOpen = vi.fn();
    const { result, rerender } = renderHook(
      ({ open }) => useSidebarSwipe(open, onOpen),
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
    const { result } = renderHook(() => useSidebarSwipe(false, onOpen));
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
    const { result } = renderHook(() => useSidebarSwipe(false, onOpen));
    result.current.current = sidebarLayer();
    const surface = workspace();

    touch(surface, "touchstart", [[180, 200]], 100);
    touch(surface, "touchmove", [[250, 203]], 200);
    touch(surface, "touchend", [], 220);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("保留左边缘右滑，并忽略纵向滚动和多指触控", () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useSidebarSwipe(false, onOpen));
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
    const { result } = renderHook(() => useSidebarSwipe(false, onOpen));
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
    const { result } = renderHook(() => useSidebarSwipe(true, onOpen));
    result.current.current = sidebarLayer();
    const surface = workspace();
    touch(surface, "touchstart", [[180, 200]]);
    touch(surface, "touchmove", [[260, 205]]);
    touch(document.body, "touchstart", [[180, 200]]);
    touch(document.body, "touchmove", [[260, 205]]);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
