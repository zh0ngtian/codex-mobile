import type { NativePanelItem } from '../../native-ui/protocol';
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { presentNativeActionMenu, type MenuAnchor } from "../../ui/native-action-menu";
import { AppIcon, titleOf, type DisplayRecord } from "../../ui/app-display";
import { t } from "../../i18n";

type AnyRecord = Record<string, any>;

export interface ContextUsageView {
  used: number;
  total: number;
  usedPercent: number;
  remainingPercent: number;
}

export interface RateLimitView {
  remainingPercent: number;
  resetsAt: number | null;
}

export function contextUsageView(
  tokenUsage: AnyRecord | null | undefined,
): ContextUsageView | null {
  // `total` is cumulative usage across the whole thread. The context meter
  // must use the latest request's context footprint (`last`), otherwise long
  // lived sessions immediately appear to be over 100%.
  const used = Number(
    tokenUsage?.last?.totalTokens ?? tokenUsage?.total?.totalTokens,
  );
  const total = Number(tokenUsage?.modelContextWindow);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  const usedPercent = Math.min(100, Math.max(0, (used / total) * 100));
  return {
    used,
    total,
    usedPercent,
    remainingPercent: 100 - usedPercent,
  };
}

export function sevenDayRateLimitView(
  rateLimits: AnyRecord | null | undefined,
): RateLimitView | null {
  const snapshot = rateLimits?.rateLimits ?? rateLimits;
  const candidates = [snapshot?.secondary, snapshot?.primary].filter(Boolean);
  const window = candidates.find(
    (entry) => Number(entry.windowDurationMins) >= 7 * 24 * 60,
  );
  const usedPercent = Number(window?.usedPercent);
  if (!Number.isFinite(usedPercent)) return null;
  return {
    remainingPercent: Math.min(100, Math.max(0, 100 - usedPercent)),
    resetsAt: Number.isFinite(Number(window?.resetsAt))
      ? Number(window.resetsAt)
      : null,
  };
}

export function ContextUsageButton({
  tokenUsage,
  open = false,
  buttonRef,
  onClick,
}: {
  tokenUsage: AnyRecord | null;
  open?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
}) {
  const usage = contextUsageView(tokenUsage);
  const degrees = Math.round((usage?.usedPercent ?? 0) * 3.6);
  return (
    <button
      ref={buttonRef}
      className="context-usage-button"
      type="button"
      aria-label={t("查看上下文占用情况")}
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onClick(); }}
      style={{ "--usage-degrees": `${degrees}deg` } as CSSProperties}
    >
      <i />
    </button>
  );
}

export function ConversationActionMenu(props: ConversationActionMenuProps) {
  return props.open ? <OpenConversationActionMenu {...props} /> : null;
}

type ConversationActionMenuProps = {
  sidechatOnly?: boolean; sidechatActions?: NativePanelItem[]; onSidechatAction?: (name: string, id?: string) => void;
  open: boolean; readOnly?: boolean; thread: DisplayRecord; pendingAction: string;
  anchor?: MenuAnchor;
  onClose: () => void; onPin: () => void; onRefresh: () => void;
  onDuplicate: () => void; onCopy: () => void; onRename: () => void; onArchive: () => void;
};

function OpenConversationActionMenu({
  sidechatOnly = false, sidechatActions = [], onSidechatAction,
  readOnly = false,
  thread,
  pendingAction,
  onClose,
  onPin,
  onRefresh,
  onDuplicate,
  onCopy,
  onRename,
  onArchive,
  anchor,
}: Omit<ConversationActionMenuProps, "open">) {
  const pinned = thread.isPinned === true;
  const ordinaryActions = [
    {
      id: "pin",
      label: pinned ? t("取消关注") : t("关注"),
      icon: "pin" as const,
      onClick: onPin,
      requiresWrite: false,
    },
    {
      id: "refresh",
      label: t("刷新会话"),
      icon: "refresh" as const,
      onClick: onRefresh,
      requiresWrite: false,
    },
    {
      id: "duplicate",
      label: t("复制会话"),
      icon: "copy" as const,
      onClick: onDuplicate,
      requiresWrite: true,
    },
    {
      id: "copy",
      label: t("复制会话 ID"),
      icon: "copy" as const,
      onClick: onCopy,
      requiresWrite: false,
    },
    {
      id: "rename",
      label: t("重命名"),
      icon: "rename" as const,
      onClick: onRename,
      requiresWrite: true,
    },
    {
      id: "archive",
      label: t("归档"),
      icon: "archive" as const,
      onClick: onArchive,
      danger: true,
      requiresWrite: true,
    },
  ];
  const actions = [
    ...(sidechatOnly ? [] : ordinaryActions),
    ...sidechatActions.map(item => ({ id: item.id, label: item.title ?? 'Sidechat', icon: 'copy' as const,
      onClick: () => onSidechatAction?.(item.command!.name, typeof item.command?.params.id === 'string' ? item.command.params.id : undefined), requiresWrite: false, danger: item.command?.name === 'sidechat.close' })),
  ];
  const [fallback, setFallback] = useState(false);
  const latest = useRef({ actions, onClose });
  latest.current = { actions, onClose };
  useEffect(() => {
    const dispose = presentNativeActionMenu(latest.current.actions.map((action) => ({
      id: action.id, title: action.label, icon: action.icon,
      destructive: action.danger,
      disabled: !!pendingAction || (readOnly && action.requiresWrite),
      copyText: action.id === "copy" ? String(thread.id ?? "") : undefined,
      onSelect: (native) => {
        if (native && action.id === "copy") latest.current.onClose();
        else {
          latest.current.actions.find((entry) => entry.id === action.id)?.onClick();
          // 原生菜单已消费；先让重命名捕获会话目标，再同步收起，取消也能立即重开。
          if (native && action.id === "rename") latest.current.onClose();
        }
      },
    })), anchor ?? { x: window.innerWidth / 2, y: 80, width: 1, height: 1 },
    // 原生直接取消时收起；动作选择由上方回调在捕获目标后处理。
    (actionId) => { if (!actionId) latest.current.onClose(); });
    setFallback(!dispose);
    return dispose ?? undefined;
  }, [anchor, readOnly]);
  if (!fallback) return null;
  return (
    <>
      <button
        className="conversation-action-dismiss"
        type="button"
        aria-label={t("关闭会话操作")}
        onClick={onClose}
      />
      <section className="conversation-action-menu" aria-label={t("会话操作")}>
        <p>{titleOf(thread)}</p>
        <div>
          {actions.map((action) => (
            <button
              type="button"
              className={action.danger ? "danger" : ""}
              disabled={!!pendingAction || (readOnly && action.requiresWrite)}
              aria-busy={pendingAction === action.id}
              key={action.id}
              onClick={action.onClick}
            >
              <AppIcon name={action.icon} />
              <span>{action.label}</span>
              {pendingAction === action.id && (
                <i className="action-spinner" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
