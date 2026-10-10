import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { moveProject, type ProjectPlacement } from "./project-order";

type DropTarget = { cwd: string; placement: ProjectPlacement };
type Drag = {
  cwd: string; pointerId: number; startX: number; startY: number;
  y: number; moved: boolean; target: DropTarget | null;
};

export function useProjectReorder({ enabled, backendId, directories, sidebarRef, onReorder }: {
  enabled: boolean;
  backendId: string;
  directories: string[];
  sidebarRef: RefObject<HTMLElement | null>;
  onReorder?: (backendId: string, directories: string[]) => void;
}) {
  const dragRef = useRef<Drag | null>(null);
  const frameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(0);
  const [draggingCwd, setDraggingCwd] = useState("");
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [menuCwd, setMenuCwd] = useState("");

  const stop = () => {
    dragRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    setDraggingCwd("");
    setDropTarget(null);
  };
  useEffect(() => {
    stop();
    setMenuCwd("");
  }, [enabled, backendId]);
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const findTarget = (drag: Drag) => {
    const groups = sidebarRef.current?.querySelectorAll<HTMLElement>("[data-project-cwd]");
    let nearest: DropTarget | null = null;
    let distance = Infinity;
    groups?.forEach((group) => {
      const cwd = group.dataset.projectCwd!;
      if (cwd === drag.cwd || !directories.includes(cwd)) return;
      const rect = group.querySelector("h2")?.getBoundingClientRect();
      if (!rect || rect.height === 0) return;
      const middle = rect.top + rect.height / 2;
      const gap = Math.abs(drag.y - middle);
      if (gap < distance) {
        distance = gap;
        nearest = { cwd, placement: drag.y < middle ? "before" : "after" };
      }
    });
    drag.target = nearest;
    setDropTarget((current) => current?.cwd === nearest?.cwd && current?.placement === nearest?.placement ? current : nearest);
  };
  const scrollAtEdge = () => {
    const drag = dragRef.current;
    const sidebar = sidebarRef.current;
    if (!drag?.moved || !sidebar) return;
    const rect = sidebar.getBoundingClientRect();
    const stickyBottom = sidebar.querySelector(".thread-list-sticky")?.getBoundingClientRect().bottom ?? rect.top;
    const footerTop = sidebar.querySelector(".list-actions")?.getBoundingClientRect().top ?? rect.bottom;
    const speed = drag.y < stickyBottom + 48 ? -10 : drag.y > footerTop - 48 ? 10 : 0;
    if (speed) {
      sidebar.scrollTop += speed;
      findTarget(drag);
    }
    frameRef.current = requestAnimationFrame(scrollAtEdge);
  };
  const commit = (cwd: string, target: DropTarget | null) => {
    if (!target || !enabled) return;
    const next = moveProject(directories, cwd, target.cwd, target.placement);
    if (next.some((directory, index) => directory !== directories[index])) onReorder?.(backendId, next);
  };
  const moveBy = (cwd: string, direction: -1 | 1) => {
    const target = directories[directories.indexOf(cwd) + direction];
    if (target) commit(cwd, { cwd: target, placement: direction < 0 ? "before" : "after" });
    setMenuCwd("");
  };
  const handleProps = (cwd: string) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (!enabled || event.button !== 0 || dragRef.current) return;
      event.stopPropagation();
      dragRef.current = { cwd, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, y: event.clientY, moved: false, target: null };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      event.preventDefault();
      event.stopPropagation();
      drag.y = event.clientY;
      if (!drag.moved) {
        setMenuCwd("");
        drag.moved = true;
        setDraggingCwd(cwd);
        frameRef.current = requestAnimationFrame(scrollAtEdge);
      }
      findTarget(drag);
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.moved) {
        suppressClickRef.current = Date.now() + 500;
        commit(drag.cwd, drag.target);
      }
      stop();
    },
    onPointerCancel: () => { suppressClickRef.current = Date.now() + 500; stop(); },
    onLostPointerCapture: () => { if (dragRef.current) stop(); },
    onClick: () => {
      if (!enabled || Date.now() < suppressClickRef.current) return;
      setMenuCwd((current) => current === cwd ? "" : cwd);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        moveBy(cwd, event.key === "ArrowUp" ? -1 : 1);
      } else if (event.key === "Escape") {
        suppressClickRef.current = Date.now() + 500;
        stop();
        setMenuCwd("");
      }
    },
  });
  return { draggingCwd, dropTarget, menuCwd, handleProps, moveBy };
}
