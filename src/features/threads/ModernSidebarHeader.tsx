import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { t } from "../../i18n";
import { AppIcon } from "../../ui/app-display";
import { BackendSwitcher } from "../backends/BackendSwitcher";

export function ModernSidebarHeader({
  sidebarOpen, status, subtitle, connection, searchOpen, refreshing, onCloseSidebar,
  onToggleSearch, onOpenDrafts, onManageBackends, onRefresh, ...switcher
}: ComponentProps<typeof BackendSwitcher> & {
  sidebarOpen: boolean;
  status: string;
  subtitle: string;
  connection: string;
  searchOpen: boolean;
  refreshing: boolean;
  onCloseSidebar?: () => void;
  onToggleSearch: () => void;
  onOpenDrafts?: () => void;
  onManageBackends: () => void;
  onRefresh: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const closeMenu = () => {
    setMenuOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  useEffect(() => { if (!sidebarOpen) setMenuOpen(false); }, [sidebarOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  const runAction = (action?: () => void) => { closeMenu(); action?.(); };

  return <header ref={headerRef} className="modern-sidebar-header"
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
    }}
    onTouchStart={event => event.stopPropagation()} onTouchMove={event => event.stopPropagation()}
    onTouchEnd={event => event.stopPropagation()} onTouchCancel={event => event.stopPropagation()}>
    <button type="button" className="modern-circle-button" aria-label={t("关闭侧栏")} onClick={onCloseSidebar}>
      <AppIcon name="menu" />
    </button>
    <button type="button" className="modern-device-title" ref={triggerRef} aria-label={`Codex · ${status}`} aria-haspopup="menu"
      aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}
      onClick={() => setMenuOpen(value => !value)}>
      <strong>Codex <span className="modern-caret" aria-hidden="true" /></strong>
      <span className="modern-device-subtitle"><i className={`status-dot ${connection}`} />
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="12" rx="2" /><path d="M2 20h20M9 16v4m6-4v4" /></svg>
        <span>{subtitle}</span>
      </span>
    </button>
    <button type="button" className="modern-circle-button" ref={searchRef} aria-label={t("搜索会话")} aria-expanded={searchOpen}
      onClick={() => { setMenuOpen(false); onToggleSearch(); }}>
      <AppIcon name="search" />
    </button>
    {menuOpen && <div id={menuId} ref={menuRef} className="modern-device-menu" role="menu" aria-label={t("设备菜单")}
      onKeyDown={event => {
        if (event.key === "Tab") {
          event.preventDefault();
          setMenuOpen(false);
          (event.shiftKey ? triggerRef : searchRef).current?.focus({ preventScroll: true });
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      <BackendSwitcher {...switcher} presentation="menu" onSelect={id => { closeMenu(); switcher.onSelect(id); }} />
      <div className="modern-menu-divider" />
      <button type="button" role="menuitem" onClick={() => runAction(onOpenDrafts)}><AppIcon name="draft" />{t("草稿")}</button>
      <button type="button" role="menuitem" onClick={() => runAction(onManageBackends)}><AppIcon name="more" />{t("设置")}</button>
      <button type="button" role="menuitem" aria-label={t("刷新会话列表")} aria-busy={refreshing} onClick={() => runAction(onRefresh)}>
        {refreshing ? <i className="sidebar-refresh-spinner" aria-hidden="true" /> : <AppIcon name="refresh" />}{t("刷新")}
      </button>
    </div>}
  </header>;
}
