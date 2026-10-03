import { useEffect, useRef } from "react";

type SwipeStart = { x: number; y: number };

function canStartSidebarSwipe(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const workspace = target.closest(".backend-workspace:not([hidden])");
  if (!workspace) return false;
  if (
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], .action-sheet-backdrop',
    )
  ) {
    return false;
  }

  for (
    let element: Element | null = target;
    element && element !== workspace;
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

export function useSidebarSwipe(sidebarOpen: boolean, openSidebar: () => void) {
  const startRef = useRef<SwipeStart | null>(null);

  useEffect(() => {
    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      startRef.current =
        !sidebarOpen &&
        event.touches.length === 1 &&
        touch &&
        canStartSidebarSwipe(event.target)
          ? { x: touch.clientX, y: touch.clientY }
          : null;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const start = startRef.current;
      if (!start) return;
      if (event.touches.length !== 1) {
        startRef.current = null;
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dy) > 44 || dx < -16) {
        startRef.current = null;
        return;
      }
      if (dx < 56 || dx <= Math.abs(dy) * 1.3) return;
      startRef.current = null;
      openSidebar();
    };
    const handleTouchEnd = () => {
      startRef.current = null;
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [openSidebar, sidebarOpen]);
}
