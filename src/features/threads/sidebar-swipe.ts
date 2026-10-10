import { useEffect, useLayoutEffect, useRef } from "react";
import { canUseOverlayGesture, useOverlayScrollIsolation } from "../../ui/overlay-scroll";

type SwipeStart = {
  x: number;
  y: number;
  direction: 1 | -1;
  distance: number;
  travel: number;
  active: boolean;
  lastMoveAt: number;
  velocity: number;
};

function resetSidebarDrag(layer: HTMLDivElement | null) {
  if (!layer) return;
  layer.classList.remove("dragging");
  layer.style.removeProperty("--sidebar-drag-x");
  layer.style.removeProperty("--sidebar-drag-progress");
}

function isHistoryEditing(): boolean {
  return Boolean(document.querySelector(
    ".backend-workspace:not([hidden]) .history-message-editor",
  ));
}

function canStartSidebarSwipe(
  target: EventTarget | null,
  layer: HTMLDivElement | null,
  sidebarOpen: boolean,
): boolean {
  if (!(target instanceof Element)) return false;
  const surface = sidebarOpen
    ? layer
    : target.closest(".backend-workspace:not([hidden])");
  if (!surface || !surface.contains(target)) return false;
  if (
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], .action-sheet-backdrop',
    )
  ) {
    return false;
  }

  for (
    let element: Element | null = target;
    element && element !== surface;
    element = element.parentElement
  ) {
    const overflowX = window.getComputedStyle(element).overflowX;
    if (
      (overflowX === "auto" || overflowX === "scroll") &&
      element.scrollWidth > element.clientWidth
    ) {
      return false;
    }
  }
  return true;
}

export function useSidebarSwipe(
  sidebarOpen: boolean,
  openSidebar: () => void,
  closeSidebar: () => void,
) {
  const startRef = useRef<SwipeStart | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  useOverlayScrollIsolation(sidebarOpen, layerRef);

  useLayoutEffect(() => {
    if (sidebarOpen) resetSidebarDrag(layerRef.current);
  }, [sidebarOpen]);

  useEffect(() => {
    const cancelDrag = () => {
      startRef.current = null;
      resetSidebarDrag(layerRef.current);
    };
    const handleTouchStart = (event: TouchEvent) => {
      cancelDrag();
      const touch = event.touches[0];
      if (
        event.touches.length !== 1 ||
        !touch ||
        isHistoryEditing() ||
        !canUseOverlayGesture(layerRef.current) ||
        !canStartSidebarSwipe(event.target, layerRef.current, sidebarOpen)
      ) {
        return;
      }
      const panel = layerRef.current?.querySelector(".conversation-sidebar");
      const width = panel?.getBoundingClientRect().width ?? 0;
      if (width <= 0) return;
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        direction: sidebarOpen ? -1 : 1,
        distance: 0,
        travel: width * 1.04,
        active: false,
        lastMoveAt: event.timeStamp,
        velocity: 0,
      };
    };
    const handleTouchMove = (event: TouchEvent) => {
      const start = startRef.current;
      if (!start) return;
      if (
        event.touches.length !== 1 ||
        isHistoryEditing() ||
        !canUseOverlayGesture(layerRef.current)
      ) {
        cancelDrag();
        return;
      }
      const touch = event.touches[0];
      const movement = (touch.clientX - start.x) * start.direction;
      const dy = touch.clientY - start.y;
      if (
        movement < -16 ||
        (Math.abs(dy) > 44 && Math.abs(dy) > movement)
      ) {
        cancelDrag();
        return;
      }
      if (!start.active) {
        if (Math.abs(dy) > 12 && Math.abs(dy) >= movement) {
          cancelDrag();
          return;
        }
        if (movement < 8 || movement <= Math.abs(dy) * 1.2) return;
        start.active = true;
        layerRef.current?.classList.add("dragging");
      }
      if (event.cancelable) event.preventDefault();
      const distance = Math.min(Math.max(movement, 0), start.travel);
      const elapsed = event.timeStamp - start.lastMoveAt;
      if (elapsed > 0) {
        start.velocity = (distance - start.distance) / elapsed;
      }
      start.distance = distance;
      start.lastMoveAt = event.timeStamp;
      layerRef.current?.style.setProperty(
        "--sidebar-drag-x",
        `${distance * start.direction}px`,
      );
      layerRef.current?.style.setProperty(
        "--sidebar-drag-progress",
        String(start.direction === 1 ? distance / start.travel : 1 - distance / start.travel),
      );
    };
    const handleTouchEnd = (event: TouchEvent) => {
      const start = startRef.current;
      if (
        !start?.active ||
        isHistoryEditing() ||
        !canUseOverlayGesture(layerRef.current)
      ) {
        cancelDrag();
        return;
      }
      const shouldFinish =
        start.distance >= Math.min(start.travel * 0.3, 120) ||
        (start.distance >= 56 &&
          start.velocity >= 0.45 &&
          event.timeStamp - start.lastMoveAt < 150);
      startRef.current = null;
      if (shouldFinish) {
        if (start.direction === 1) openSidebar();
        else closeSidebar();
      } else {
        resetSidebarDrag(layerRef.current);
      }
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", cancelDrag, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", cancelDrag);
      cancelDrag();
    };
  }, [closeSidebar, openSidebar, sidebarOpen]);

  return layerRef;
}
