import { useLayoutEffect, type RefObject } from "react";

// 侧栏和弹层共享一个滚动边界；DOM 嵌套关系不等于视觉层级。
const layers: HTMLElement[] = [];
let restoreDocumentScroll: (() => void) | undefined;
let touchPoint: { x: number; y: number; layer: HTMLElement | null } | null = null;

function topLayer(): HTMLElement | null {
  let top: HTMLElement | null = null;
  let highest = -Infinity;
  for (const layer of layers) {
    if (!layer.isConnected) continue;
    const zIndex = Number.parseInt(getComputedStyle(layer).zIndex, 10) || 0;
    const paintedAfter = !top || Boolean(
      top.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    if (zIndex > highest || (zIndex === highest && paintedAfter)) {
      highest = zIndex;
      top = layer;
    }
  }
  return top;
}

export function canUseOverlayGesture(layer: HTMLElement | null): boolean {
  const top = topLayer();
  return !top || top === layer;
}

function canScrollWithin(
  target: EventTarget | null,
  layer: HTMLElement,
  dx: number,
  dy: number,
): boolean {
  let element = target instanceof Element ? target : null;
  if (!element || !layer.contains(element)) return false;
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const delta = horizontal ? dx : dy;
  if (delta === 0) return true;
  while (element && element !== layer) {
    const style = getComputedStyle(element);
    const overflow = (horizontal ? style.overflowX : style.overflowY) || style.overflow;
    if (element instanceof HTMLElement && /^(auto|scroll)$/.test(overflow)) {
      const position = horizontal ? element.scrollLeft : element.scrollTop;
      const extent = horizontal
        ? element.scrollWidth - element.clientWidth
        : element.scrollHeight - element.clientHeight;
      if (extent > 0 && (delta < 0 ? position > 0 : position < extent - 1)) {
        return true;
      }
    }
    element = element.parentElement;
  }
  return false;
}

function handleTouchStart(event: TouchEvent) {
  const touch = event.touches[0];
  touchPoint = event.touches.length === 1 && touch
    ? { x: touch.clientX, y: touch.clientY, layer: topLayer() }
    : null;
}

function handleTouchMove(event: TouchEvent) {
  const layer = topLayer();
  if (!layer) return;
  if (event.touches.length !== 1) {
    // 图片预览等顶层内容仍可使用多指手势。
    if (!(event.target instanceof Node) || !layer.contains(event.target)) {
      if (event.cancelable) event.preventDefault();
    }
    touchPoint = null;
    return;
  }
  const touch = event.touches[0];
  const previous = touchPoint;
  touchPoint = { x: touch.clientX, y: touch.clientY, layer };
  if (
    !previous || previous.layer !== layer ||
    !canScrollWithin(event.target, layer, previous.x - touch.clientX, previous.y - touch.clientY)
  ) {
    if (event.cancelable) event.preventDefault();
  }
}

function handleTouchEnd() {
  touchPoint = null;
}

function handleWheel(event: WheelEvent) {
  const layer = topLayer();
  if (layer && !canScrollWithin(event.target, layer, event.deltaX, event.deltaY)) {
    if (event.cancelable) event.preventDefault();
  }
}

function lockDocumentScroll() {
  const originals = [document.documentElement, document.body].map((element) => {
    const declarations = Array.from(element.style)
      .filter((name) => ["overflow", "overflow-x", "overflow-y"].includes(name))
      .map((name) => ({
        name,
        value: element.style.getPropertyValue(name),
        priority: element.style.getPropertyPriority(name),
      }));
    element.style.setProperty("overflow", "hidden", "important");
    return () => {
      element.style.removeProperty("overflow");
      element.style.removeProperty("overflow-x");
      element.style.removeProperty("overflow-y");
      declarations.forEach(({ name, value, priority }) => {
        element.style.setProperty(name, value, priority);
      });
    };
  });
  document.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
  document.addEventListener("touchmove", handleTouchMove, { capture: true, passive: false });
  document.addEventListener("touchend", handleTouchEnd, true);
  document.addEventListener("touchcancel", handleTouchEnd, true);
  document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
  return () => {
    originals.forEach((restore) => restore());
    document.removeEventListener("touchstart", handleTouchStart, true);
    document.removeEventListener("touchmove", handleTouchMove, true);
    document.removeEventListener("touchend", handleTouchEnd, true);
    document.removeEventListener("touchcancel", handleTouchEnd, true);
    document.removeEventListener("wheel", handleWheel, true);
    touchPoint = null;
  };
}

export function useOverlayScrollIsolation(
  open: boolean,
  layerRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!open || !layer) return;
    if (!layers.length) restoreDocumentScroll = lockDocumentScroll();
    layers.push(layer);
    return () => {
      const index = layers.indexOf(layer);
      if (index !== -1) layers.splice(index, 1);
      if (!layers.length) {
        restoreDocumentScroll?.();
        restoreDocumentScroll = undefined;
      }
    };
  }, [open, layerRef]);
}
