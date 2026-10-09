import type { CSSProperties } from "react";
import { AppIcon, titleOf, type DisplayRecord } from "../../ui/app-display";
import { ActionSheet } from "../../ui/ActionSheet";
import { getActiveLocale, t } from "../../i18n";

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

function formatCount(value: number) {
  return new Intl.NumberFormat(getActiveLocale(), {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatResetTime(timestamp: number | null) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(getActiveLocale(), {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

export function ContextUsageButton({
  tokenUsage,
  onClick,
}: {
  tokenUsage: AnyRecord | null;
  onClick: () => void;
}) {
  const usage = contextUsageView(tokenUsage);
  const degrees = Math.round((usage?.usedPercent ?? 0) * 3.6);
  return (
    <button
      className="context-usage-button"
      type="button"
      aria-label={t("查看上下文占用情况")}
      onClick={onClick}
      style={{ "--usage-degrees": `${degrees}deg` } as CSSProperties}
    >
      <i aria-hidden="true" />
    </button>
  );
}

export function ConversationStatusSheet({
  open,
  thread,
  tokenUsage,
  rateLimits,
  backendName,
  connectionLabel,
  onClose,
}: {
  open: boolean;
  thread: DisplayRecord;
  tokenUsage: AnyRecord | null;
  rateLimits: AnyRecord | null;
  backendName?: string;
  connectionLabel?: string;
  onClose: () => void;
}) {
  if (!open) return null;
  const usage = contextUsageView(tokenUsage);
  const sevenDay = sevenDayRateLimitView(rateLimits);
  const copyThreadId = () => {
    void navigator.clipboard?.writeText(String(thread.id ?? ""));
  };
  return (
    <ActionSheet
      open={open}
      title={t("状态")}
      ariaLabel={t("状态")}
      onClose={onClose}
      closeLabel={t("关闭状态")}
      closeIcon={<AppIcon name="close" />}
      showHandle
      titleAlign="center"
      className="conversation-status-sheet"
      backdropClassName="conversation-sheet-backdrop"
    >
        <h3 className="conversation-status-title">{titleOf(thread)}</h3>
        <dl>
          {backendName && <div><dt>{t("机器")}</dt><dd>{backendName}</dd></div>}
          {connectionLabel && <div><dt>{t("状态")}</dt><dd>{connectionLabel}</dd></div>}
          <div>
            <dt>{t("对话线程：")}</dt>
            <dd>
              <code>{thread.id || t("暂无数据")}</code>
              {!!thread.id && (
                <button
                  type="button"
                  aria-label={t("复制会话 ID")}
                  onClick={copyThreadId}
                >
                  <AppIcon name="copy" />
                </button>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("目录：")}</dt>
            <dd><code>{thread.cwd || t("暂无数据")}</code></dd>
          </div>
          <div>
            <dt>{t("上下文：")}</dt>
            <dd>
              {usage
                ? t("剩余 {remaining}%（已用 {used} / {total}）", {
                    remaining: Math.round(usage.remainingPercent),
                    used: formatCount(usage.used),
                    total: formatCount(usage.total),
                  })
                : t("暂无数据")}
            </dd>
          </div>
          <div>
            <dt>{t("7 天限制：")}</dt>
            <dd>
              {sevenDay
                ? `${t("剩余 {remaining}%", {
                    remaining: Math.round(sevenDay.remainingPercent),
                  })}${
                    sevenDay.resetsAt
                      ? t("（将于 {time} 重置）", {
                          time: formatResetTime(sevenDay.resetsAt),
                        })
                      : ""
                  }`
                : t("暂无数据")}
            </dd>
          </div>
        </dl>
    </ActionSheet>
  );
}

export function ConversationActionMenu({
  open,
  readOnly = false,
  thread,
  pendingAction,
  backendName,
  projectName,
  connectionLabel,
  modelLabel,
  permissionLabel,
  settingsEnabled = true,
  onAgentSettings,
  onPermissionSettings,
  onStatus,
  onClose,
  onPin,
  onRefresh,
  onDuplicate,
  onCopy,
  onRename,
  onArchive,
}: {
  open: boolean;
  readOnly?: boolean;
  thread: DisplayRecord;
  pendingAction: string;
  backendName?: string;
  projectName?: string;
  connectionLabel?: string;
  modelLabel?: string;
  permissionLabel?: string;
  settingsEnabled?: boolean;
  onAgentSettings?: () => void;
  onPermissionSettings?: () => void;
  onStatus?: () => void;
  onClose: () => void;
  onPin: () => void;
  onRefresh: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  if (!open) return null;
  const pinned = thread.isPinned === true;
  const actions = [
    {
      id: "pin",
      label: pinned ? t("取消置顶") : t("置顶"),
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
  return (
    <ActionSheet
      open={open}
      title={t("会话操作")}
      ariaLabel={t("会话操作")}
      onClose={onClose}
      closeLabel={t("关闭会话操作")}
      closeIcon={<AppIcon name="close" />}
      showHandle
      className="conversation-options-sheet"
      backdropClassName="conversation-sheet-backdrop"
    >
      <div className="conversation-options-context">
        <h3>{titleOf(thread)}</h3>
        <p>{[backendName, projectName, connectionLabel].filter(Boolean).join(" · ")}</p>
      </div>
      <div className="conversation-options-settings">
        {onAgentSettings && <button type="button" aria-label={t("选择模型、智能与速度")}
          disabled={!settingsEnabled} onClick={onAgentSettings}>
          <span>{t("选择模型、智能与速度")}</span><small>{modelLabel}</small>
        </button>}
        {onPermissionSettings && <button type="button" aria-label={t("选择审批与权限模式")}
          disabled={!settingsEnabled} onClick={onPermissionSettings}>
          <span>{t("选择审批与权限模式")}</span><small>{permissionLabel}</small>
        </button>}
        {onStatus && <button type="button" aria-label={t("查看上下文占用情况")}
          onClick={onStatus}><span>{t("状态")}</span></button>}
      </div>
      {!!thread.id && <div className="conversation-options-actions">
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
            {pendingAction === action.id && <i className="action-spinner" aria-hidden="true" />}
          </button>
        ))}
      </div>}
    </ActionSheet>
  );
}
