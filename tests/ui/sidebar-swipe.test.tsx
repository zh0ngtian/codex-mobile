import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSidebarSwipe } from "../../src/features/threads/sidebar-swipe";

function touch(target: Element, type: string, points: Array<[number, number]>) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "touches", {
    value: points.map(([clientX, clientY]) => ({ clientX, clientY })),
  });
  act(() => target.dispatchEvent(event));
}

function workspace() {
  const surface = document.createElement("div");
  surface.className = "backend-workspace";
  document.body.append(surface);
  return surface;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("会话侧栏右滑手势", () => {
  it("从会话中部右滑打开侧栏，且一次手势只打开一次", () => {
    const onOpen = vi.fn();
    renderHook(() => useSidebarSwipe(false, onOpen));
    const surface = workspace();

    touch(surface, "touchstart", [[180, 300]]);
    touch(surface, "touchmove", [[210, 305]]);
    expect(onOpen).not.toHaveBeenCalled();
    touch(surface, "touchmove", [[245, 307]]);
    touch(surface, "touchmove", [[300, 309]]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("保留左边缘右滑，并忽略纵向滚动和多指触控", () => {
    const onOpen = vi.fn();
    renderHook(() => useSidebarSwipe(false, onOpen));
    const surface = workspace();

    touch(surface, "touchstart", [[10, 200]]);
    touch(surface, "touchmove", [[70, 205]]);
    expect(onOpen).toHaveBeenCalledTimes(1);

    touch(surface, "touchstart", [[180, 200]]);
    touch(surface, "touchmove", [[200, 260]]);
    touch(surface, "touchmove", [[270, 262]]);
    expect(onOpen).toHaveBeenCalledTimes(1);

    touch(surface, "touchstart", [[180, 200]]);
    touch(surface, "touchmove", [[180, 200], [220, 200]]);
    touch(surface, "touchmove", [[270, 205]]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("不抢输入框、弹层和横向滚动内容的手势", () => {
    const onOpen = vi.fn();
    renderHook(() => useSidebarSwipe(false, onOpen));
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
  });

  it("侧栏已打开或从非会话区域起滑时不打开", () => {
    const onOpen = vi.fn();
    renderHook(() => useSidebarSwipe(true, onOpen));
    const surface = workspace();
    touch(surface, "touchstart", [[180, 200]]);
    touch(surface, "touchmove", [[260, 205]]);
    touch(document.body, "touchstart", [[180, 200]]);
    touch(document.body, "touchmove", [[260, 205]]);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
