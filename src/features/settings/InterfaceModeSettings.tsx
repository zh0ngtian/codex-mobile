import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { nativeConversationHandler } from "../conversation/native-conversation";
import { nativeSidebarHandler } from "../threads/native-sidebar";
import { setInterfaceMode, useInterfaceMode } from "../../ui/interface-mode";

const supportsComparison = () => Boolean(nativeConversationHandler() && nativeSidebarHandler());
export function InterfaceModeSettings() {
  const mode = useInterfaceMode();
  const [supported, setSupported] = useState(supportsComparison);
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    const ready = () => setSupported(supportsComparison());
    window.addEventListener("codex-mobile-native-conversation-ready", ready);
    window.addEventListener("codex-mobile-native-sidebar-ready", ready);
    return () => {
      window.removeEventListener("codex-mobile-native-conversation-ready", ready);
      window.removeEventListener("codex-mobile-native-sidebar-ready", ready);
    };
  }, []);
  if (!supported) return null;
  return (
    <section className="backend-language-settings interface-mode-settings" aria-label={t("界面体验")}>
      <strong>{t("界面体验")}</strong>
      <div role="group" aria-label={t("界面体验")}>
        {([["native", "原生界面"], ["web", "网页界面"]] as const).map(([value, label]) => (
          <button type="button" key={value} className={mode === value ? "selected" : ""}
            aria-pressed={mode === value} onClick={() => setSaveError(!setInterfaceMode(value))}>{t(label)}</button>
        ))}
      </div>
      <small>{t("切换后关闭此面板，比较同一会话的两种体验")}</small>
      {saveError && <small role="alert">{t("界面已切换，但无法保存；重启后可能恢复原界面")}</small>}
    </section>
  );
}
