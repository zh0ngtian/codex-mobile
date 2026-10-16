import type { ReactNode } from "react";
import { t } from "../../i18n";

export type SettingsPage = "root" | "devices" | "language" | "font" | "transport" | "notifications";

function SettingsIcon({ kind }: { kind: Exclude<SettingsPage, "root"> }) {
  const paths = {
    devices: <><rect x="4" y="4" width="16" height="12" rx="2" /><path d="M2 20h20M9 16v4m6-4v4" /></>,
    language: <><path d="M3 5h12M9 2v3m4 0c-1 7-4 10-10 12m2-9c2 4 5 7 9 9M14 21l4-11 4 11m-6-4h4" /></>,
    font: <><path d="M3 19 9 4l6 15M5 14h8m3-3h6m-3 0v8" /></>,
    transport: <><circle cx="12" cy="5" r="3" /><circle cx="5" cy="19" r="3" /><circle cx="19" cy="19" r="3" /><path d="M12 8v4M5 16v-4h14v4" /></>,
    notifications: <><path d="M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3zM10 21h4" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>;
}

export function ModernSettingsRoot({ language, fontSize, deviceCount, transport, notification, webToggle, nativeToggle, currentVersion, onNavigate }: {
  language: string;
  fontSize: string;
  deviceCount: number;
  transport: string;
  notification?: string;
  webToggle: ReactNode;
  nativeToggle: ReactNode;
  currentVersion?: string;
  onNavigate: (page: SettingsPage) => void;
}) {
  const row = (page: Exclude<SettingsPage, "root">, label: string, detail: string) => (
    <button type="button" className="modern-settings-row" data-settings-page={page} aria-label={label} onClick={() => onNavigate(page)}>
      <SettingsIcon kind={page} /><span>{label}</span><small>{detail}</small><i className="modern-settings-chevron" aria-hidden="true" />
    </button>
  );
  return <div className="modern-settings-root">
    <section className="modern-settings-section">
      <h3>{t("应用")}</h3>
      <div className="modern-settings-card">
        {row("language", t("语言"), language)}
        {row("font", t("字体大小"), fontSize)}
        {webToggle}
        {nativeToggle}
      </div>
    </section>
    <section className="modern-settings-section">
      <h3>{t("连接")}</h3>
      <div className="modern-settings-card">
        {row("devices", t("设备"), t("{count} 台设备", { count: deviceCount }))}
        {row("transport", t("传输方式"), transport)}
      </div>
    </section>
    {notification !== undefined && <section className="modern-settings-section">
      <h3>{t("通知")}</h3>
      <div className="modern-settings-card">{row("notifications", t("通知"), notification)}</div>
    </section>}
    {currentVersion && <div className="modern-settings-version"><span>Codex Mobile</span><span>{t("当前版本 v{version}", { version: currentVersion })}</span></div>}
  </div>;
}
