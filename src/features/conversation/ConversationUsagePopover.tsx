import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { usePopoverFocus } from "../../ui/use-popover-focus";
import { contextRemainingPercent, formatTokenCount, inputCacheHitPercent, rateLimitRemainingPercent } from "./usage-metrics";

export { formatTokenCount } from "./usage-metrics";

export function ConversationUsagePopover({ open, anchorRef, tokenUsage, rateLimits, onClose }: {
  open: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  tokenUsage: Record<string, any> | null;
  rateLimits: Record<string, any> | null;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  usePopoverFocus(open, anchorRef, panel, onClose);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0;
      const y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const cardWidth = Math.min(300, Math.max(0, width - 24));
      const cardHeight = Math.min(panel.current?.getBoundingClientRect().height ?? 0, height - 24);
      setPosition({
        width: cardWidth,
        left: Math.max(x + 12, Math.min(anchor.right - cardWidth, x + width - 12 - cardWidth)),
        top: Math.max(y + 12, Math.min(anchor.bottom + 8, y + height - cardHeight - 12)),
        maxHeight: Math.max(0, height - 24),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (panel.current) observer?.observe(panel.current);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [open, anchorRef]);
  if (!open) return null;
  const percent = (value: number | null) => value == null ? t("暂无数据") : `${value}%`;
  const input = formatTokenCount(tokenUsage?.total?.inputTokens);
  const cacheHit = inputCacheHitPercent(tokenUsage);
  const inputValue = input == null ? t("暂无数据") : cacheHit == null
    ? t("{tokens} (缓存 暂无数据)", { tokens: input })
    : t("{tokens} (缓存 {percent}%)", { tokens: input, percent: cacheHit });
  return createPortal(<section ref={panel} tabIndex={-1} role="dialog" aria-label={t("用量与额度")}
    className="conversation-usage-popover" style={position}>
    <strong>{t("用量与额度")}</strong>
    <dl>
      <div><dt>{t("上下文余量")}</dt><dd>{percent(contextRemainingPercent(tokenUsage))}</dd></div>
      <div><dt>{t("周期剩余")}</dt><dd>{percent(rateLimitRemainingPercent(rateLimits, 10080))}</dd></div>
      <div><dt>{t("时间剩余")}</dt><dd>{percent(rateLimitRemainingPercent(rateLimits, 300))}</dd></div>
      <div><dt>{t("输入 Token")}</dt><dd>{inputValue}</dd></div>
      <div><dt>{t("输出 Token")}</dt><dd>{formatTokenCount(tokenUsage?.total?.outputTokens) ?? t("暂无数据")}</dd></div>
    </dl>
  </section>, document.body);
}
