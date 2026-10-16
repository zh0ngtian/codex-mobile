import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { AppIcon } from "../../ui/app-display";
import { useModernPopover } from "../web-ui/usePopoverFocus";
import { contextUsageView } from "./ConversationControls";

type Snapshot = Record<string, any> | null;
const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** 新版展示不把缺失值转换为零；旧版和原生快照的推导保持不变。 */
export function modernContextUsage(tokenUsage: Snapshot) {
  const used = tokenUsage?.last ? tokenUsage.last.totalTokens : tokenUsage?.total?.totalTokens;
  return finiteNumber(used) && finiteNumber(tokenUsage?.modelContextWindow)
    ? contextUsageView(tokenUsage) : null;
}

export function modernQuotaView(rateLimits: Snapshot, nowSeconds: number) {
  const snapshot = rateLimits?.rateLimits ?? rateLimits;
  const window = [snapshot?.secondary, snapshot?.primary].find(entry =>
    finiteNumber(entry?.windowDurationMins) && entry.windowDurationMins >= 10080,
  );
  return {
    remainingPercent: finiteNumber(window?.usedPercent) ? clamp(100 - window.usedPercent) : null,
    timeRemainingPercent: finiteNumber(window?.resetsAt) && finiteNumber(nowSeconds)
      ? clamp((window.resetsAt - nowSeconds) / (window.windowDurationMins * 60) * 100) : null,
  };
}


export function ModernContextUsage({ tokenUsage, rateLimits, open, onToggle, onClose }: {
  tokenUsage: Snapshot; rateLimits: Snapshot; open: boolean; onToggle: () => void; onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now);
  useModernPopover(open, root, panel, onClose);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [open]);
  const usage = modernContextUsage(tokenUsage);
  const quota = modernQuotaView(rateLimits, now / 1000);
  const format = (value: number | null | undefined) => value == null ? t("暂无数据") : `${Math.round(value)}%`;
  return <div className="modern-usage-control" ref={root}>
    <button ref={trigger} type="button" className="modern-context-button" aria-label={t("查看上下文占用情况")} aria-expanded={open}
      onClick={() => { trigger.current?.focus({ preventScroll: true }); onToggle(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="context-usage-ring">
        <circle className="context-ring-track" cx="12" cy="12" r="9.5" fill="none" strokeWidth="2.3" />
        {!!usage && usage.usedPercent > 0 && <circle className="context-ring-progress" cx="12" cy="12" r="9.5" fill="none" strokeWidth="2.3" strokeLinecap="round" pathLength="100" strokeDasharray={`${usage.usedPercent} 100`} transform="rotate(-90 12 12)" />}
      </svg>
    </button>
    {open && <section ref={panel} tabIndex={-1} role="dialog" aria-label={t("用量与额度")} className="modern-usage-popover">
      <strong>{t("用量与额度")}</strong>
      <dl>
        <div><dt>{t("上下文余量")}</dt><dd>{format(usage?.remainingPercent)}</dd></div>
        <div><dt>{t("套餐剩余")}</dt><dd>{format(quota.remainingPercent)}</dd></div>
        <div><dt>{t("时间剩余")}</dt><dd>{format(quota.timeRemainingPercent)}</dd></div>
      </dl>
    </section>}
  </div>;
}

export function NewChatDraftMenu({ canSave, saving, onSave, onClose }: {
  canSave: boolean; saving: boolean; onSave?: () => void | boolean | Promise<boolean>; onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [pending, setPending] = useState(false);
  useModernPopover(true, root, panel, onClose);
  return <div ref={root} className="modern-draft-menu-root">
    <button type="button" className="conversation-action-dismiss" aria-label={t("关闭会话操作")} onClick={onClose} />
    <section ref={panel} className="conversation-action-menu modern-draft-menu" role="menu" tabIndex={-1} aria-label={t("会话操作")}>
      <button type="button" role="menuitem" disabled={!canSave || pending} onClick={() => {
        setPending(true);
        void Promise.resolve().then(() => onSave?.()).then(completed => { if (completed === true) onClose(); })
          .catch(() => undefined).finally(() => setPending(false));
      }}><AppIcon name="draft" /><span>{saving || pending ? t("正在保存…") : t("保存草稿")}</span></button>
    </section>
  </div>;
}
