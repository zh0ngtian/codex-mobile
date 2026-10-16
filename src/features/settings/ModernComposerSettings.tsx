import { useEffect, useRef, type ComponentProps } from "react";
import { t } from "../../i18n";
import { AppIcon } from "../../ui/app-display";
import type { ComposerSettingsProps } from "./ComposerSettings";

/** 不取消 pointerdown 的兼容 click；触摸在 touchend 内完成以保留 Safari 键盘授权。 */
function ChoiceButton({ onActivate, ...props }: Omit<ComponentProps<"button">, "onClick"> & { onActivate: () => void }) {
  const touch = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClickUntil = useRef(0);
  return <button type="button" {...props}
    onPointerDown={() => { suppressClickUntil.current = 0; }}
    onTouchStart={event => { const point = event.touches[0]; touch.current = point ? { x: point.clientX, y: point.clientY, moved: false } : null; }}
    onTouchMove={event => { const point = event.touches[0]; if (point && touch.current && Math.hypot(point.clientX - touch.current.x, point.clientY - touch.current.y) > 10) touch.current.moved = true; }}
    onTouchCancel={() => { touch.current = null; suppressClickUntil.current = Date.now() + 800; }}
    onTouchEnd={event => {
      event.preventDefault();
      const start = touch.current; const point = event.changedTouches[0]; touch.current = null;
      suppressClickUntil.current = Date.now() + 800;
      if (!start || start.moved || (point && Math.hypot(point.clientX - start.x, point.clientY - start.y) > 10) || props.disabled) return;
      onActivate();
    }}
    onClick={event => { if (Date.now() < suppressClickUntil.current) { event.preventDefault(); return; } onActivate(); }} />;
}

export function ModernComposerSettings(props: ComposerSettingsProps) {
  const { picker, onPickerChange, onRestoreComposerFocus } = props;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, [picker]);
  if (!picker) return null;
  const title = picker === "permission" ? t("权限模式") : picker === "speed" ? t("速度") : t("模型与思考强度");
  const close = () => { onRestoreComposerFocus?.(); onPickerChange(null); };
  const choose = (callback: () => void) => { onRestoreComposerFocus?.(); callback(); onPickerChange(null); };
  return <div className="composer-popover-backdrop modern-composer-backdrop" onClick={close}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} data-text-editor-only={props.textEditorOnly ? "true" : undefined} className={`composer-popover modern-composer-settings ${picker === "permission" ? "permission-popover" : ""}`}
      onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (event.key === "Tab") {
          const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
          const first = buttons[0]; const last = buttons.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header><h2>{title}</h2><ChoiceButton aria-label={t("关闭")} onActivate={close}><AppIcon name="close" /></ChoiceButton></header>
      <div className="modern-composer-settings-scroll">
        {(picker === "model" || picker === "agent") && <>
          <section role="group" aria-label={t("模型")}><h3>{t("模型")}</h3><div className="modern-choice-list">
            {props.models.map(option => <ChoiceButton key={option.id || option.model} aria-pressed={option.model === props.selectedModel} disabled={!option.model} onActivate={() => { if (option.model) choose(() => props.onChooseModel(option.model!)); }}>
              <span>{option.displayName}</span><i aria-hidden="true">{option.model === props.selectedModel && !props.textEditorOnly ? "✓" : ""}</i>
            </ChoiceButton>)}
          </div></section>
          <section role="group" aria-label={t("思考强度")}><h3>{t("思考强度")}</h3><div className="modern-choice-list">
            {props.effortOptions.map(option => <ChoiceButton key={option.id} aria-pressed={option.id === props.selectedEffort} onActivate={() => choose(() => props.onChooseEffort(option.id))}>
              <span>{option.label}</span><i aria-hidden="true">{option.id === props.selectedEffort && !props.textEditorOnly ? "✓" : ""}</i>
            </ChoiceButton>)}
          </div></section>
        </>}
        {picker === "speed" && <section role="group" aria-label={t("速度列表")}><div className="modern-choice-list">
          {props.speedOptions.map(option => <ChoiceButton key={option.id ?? "normal"} aria-pressed={option.id === props.selectedServiceTier} onActivate={() => choose(() => props.onChooseSpeed(option.id))}>
            {props.textEditorOnly && <AppIcon name={option.id ? "speed" : "speed-off"} />}<span><strong>{option.label}</strong><small>{option.description}</small></span><i aria-hidden="true">{option.id === props.selectedServiceTier && !props.textEditorOnly ? "✓" : ""}</i>
          </ChoiceButton>)}
        </div></section>}
        {picker === "permission" && <section role="group" aria-label={t("权限模式")}><div className="modern-choice-list">
          {props.permissionModes.map(mode => <ChoiceButton key={mode.id} aria-pressed={mode.id === props.selectedPermissionModeId} onActivate={() => choose(() => props.onChoosePermissionMode(mode.id))}>
            {props.textEditorOnly && <AppIcon name={mode.id === "read-only" ? "lock" : mode.id === "full-access" ? "shield-off" : mode.id === "auto-review" ? "shield-check" : "shield"} />}<span><strong>{mode.label}</strong><small>{mode.description}</small></span><i aria-hidden="true">{mode.id === props.selectedPermissionModeId ? "✓" : ""}</i>
          </ChoiceButton>)}
        </div></section>}
      </div>
      <footer><ChoiceButton onActivate={close}>{t("完成")}</ChoiceButton></footer>
    </section>
  </div>;
}
