import { useEffect, useRef, type PointerEvent, type MouseEvent } from "react";
import { elementMenuAnchor, type MenuAnchor } from "./native-action-menu";

export function useLongPress(onOpen: (anchor: MenuAnchor) => void, disabled = false, ignoreSelector?: string) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const suppress = useRef(0);
  const clear = () => { if (press.current) clearTimeout(press.current.timer); press.current = null; };
  useEffect(() => clear, [disabled, ignoreSelector]);
  const ignores = (target: EventTarget | null) => target instanceof Element && target.closest(ignoreSelector ? `button, a, input, textarea, ${ignoreSelector}` : 'button, a, input, textarea');
  const open = (element: Element) => {
    clear();
    if (disabled) return;
    suppress.current = Date.now() + 1000;
    window.getSelection()?.removeAllRanges();
    onOpen(elementMenuAnchor(element));
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      clear();
      if (disabled || event.button !== 0 || ignores(event.target)) return;
      const element = event.currentTarget;
      press.current = { x: event.clientX, y: event.clientY,
        timer: setTimeout(() => open(element), 500) };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) clear();
    },
    onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear,
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (disabled || ignores(event.target)) { clear(); return; }
      event.preventDefault();
      open(event.currentTarget);
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (Date.now() <= suppress.current) { event.preventDefault(); event.stopPropagation(); }
    },
  };
}
