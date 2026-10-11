import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { presentNativeActionMenu, type MenuAction, type MenuAnchor } from "./native-action-menu";
import { t } from "../i18n";

export function ContextActionMenu({ actions, anchor, label, onClose }: {
  actions: MenuAction[]; anchor: MenuAnchor; label: string; onClose: () => void;
}) {
  const [fallback, setFallback] = useState(false);
  const latest = useRef({ actions, onClose });
  latest.current = { actions, onClose };
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dispose = presentNativeActionMenu(
      latest.current.actions.map((action) => ({ ...action,
        onSelect: (native) => {
          const current = latest.current.actions.find((a) => a.id === action.id);
          if (current && !current.disabled) current.onSelect(native);
        },
      })), anchor, () => latest.current.onClose(),
    );
    setFallback(!dispose);
    return dispose ?? undefined;
  }, [anchor]);
  useEffect(() => {
    if (!fallback) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") latest.current.onClose();
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = [...menuRef.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [fallback]);
  if (!fallback) return null;
  return createPortal(<>
    <button className="context-menu-dismiss" aria-label={t("关闭")} onClick={onClose} />
    <div ref={menuRef} className="context-action-menu" role="menu" aria-label={label}
      style={{ left: Math.max(8, Math.min(anchor.x, window.innerWidth - 224)),
        top: Math.max(8, Math.min(anchor.y + anchor.height, window.innerHeight - actions.length * 48 - 24)) }}>
      {actions.map((action) => <button key={action.id} role="menuitem" disabled={action.disabled}
        className={action.destructive ? "danger" : ""}
        onClick={() => { onClose(); action.onSelect(false); }}>{action.title}</button>)}
    </div>
  </>, document.body);
}
