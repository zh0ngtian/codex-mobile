import { useRef, useState } from "react";
import { t } from "../../i18n";
import { AppIcon } from "../../ui/app-display";
import { useModernPopover } from "../web-ui/usePopoverFocus";
import { contextUsageMetrics } from "./usage-metrics";
import { ConversationUsagePopover } from "./ConversationUsagePopover";

type Snapshot = Record<string, any> | null;
export const modernContextUsage = contextUsageMetrics;

export function ModernContextUsage({ tokenUsage, rateLimits, open, onToggle, onClose }: {
  tokenUsage: Snapshot; rateLimits: Snapshot; open: boolean; onToggle: () => void; onClose: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const usage = modernContextUsage(tokenUsage);
  return <div className="modern-usage-control">
    <button ref={trigger} type="button" className="modern-context-button" aria-label={t("查看上下文占用情况")} aria-expanded={open} aria-haspopup="dialog"
      onClick={() => { trigger.current?.focus({ preventScroll: true }); onToggle(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="context-usage-ring">
        <circle className="context-ring-track" cx="12" cy="12" r="9.5" fill="none" strokeWidth="2.3" />
        {!!usage && usage.usedPercent > 0 && <circle className="context-ring-progress" cx="12" cy="12" r="9.5" fill="none" strokeWidth="2.3" strokeLinecap="round" pathLength="100" strokeDasharray={`${usage.usedPercent} 100`} transform="rotate(-90 12 12)" />}
      </svg>
    </button>
    <ConversationUsagePopover open={open} anchorRef={trigger} tokenUsage={tokenUsage} rateLimits={rateLimits} onClose={onClose} />
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
