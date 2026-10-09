import { useEffect, useState, type FormEvent } from "react";
import { parseBarkPushUrl } from "../../server/notification-settings";
import type { NotificationPreference } from "./preferences";
import { t } from "../i18n";

export function PushSettings({ preference, onSave, failedDevices = [] }: {
  preference: NotificationPreference;
  onSave: (preference: NotificationPreference) => void;
  failedDevices?: string[];
}) {
  const [mode, setMode] = useState(preference.mode);
  const [url, setUrl] = useState(preference.barkUrl);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setMode(preference.mode); setUrl(preference.barkUrl); }, [preference]);
  const save = (event: FormEvent) => {
    event.preventDefault(); setError(""); setSaved(false);
    try {
      const barkUrl = mode === "bark" ? parseBarkPushUrl(url) : preference.barkUrl;
      onSave({ mode, barkUrl }); setUrl(barkUrl); setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t("无法保存推送设置"));
    }
  };
  return (
    <section className="backend-language-settings push-settings" aria-label={t("推送方式")}>
      <strong>{t("推送方式")}</strong>
      <div role="radiogroup" aria-label={t("推送方式")}>
        {([["system", "系统推送"], ["bark", "Bark 推送"]] as const).map(([value, label]) => (
          <label key={value} className={mode === value ? "selected" : ""}>
            <input type="radio" name="notification-mode" value={value} checked={mode === value}
              onChange={() => { setMode(value); setError(""); setSaved(false); }} />
            {t(label)}
          </label>
        ))}
      </div>
      {mode === "system"
        ? <small>{t("系统推送会有延迟，并且可能会漏推送。")}</small>
        : <small>{t("任务完成后由设备网关发送 Bark 通知，App 退出后也可接收。")}</small>}
      <form className="backend-form push-settings-form" onSubmit={save} noValidate>
        {mode === "bark" && <label>
          {t("Bark 推送链接")}
          <input type="url" value={url} placeholder="https://api.day.app/DeviceKey"
            aria-label={t("Bark 推送链接")}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
            aria-invalid={Boolean(error)}
            onChange={(event) => { setUrl(event.target.value); setError(""); setSaved(false); }} />
          <small>{t("粘贴 Bark App 中的推送链接，包含服务器地址和设备 Key。")}</small>
        </label>}
        {error && <p role="alert" className="backend-form-error">{error}</p>}
        <button className="push-settings-save" type="submit">{t("保存推送设置")}</button>
        {saved && !failedDevices.length && <small role="status">{t("推送设置已保存")}</small>}
        {failedDevices.length > 0 && <p className="backend-form-error" role="status">
          {t("推送设置尚未同步到：{devices}。连接恢复后自动重试；旧网关需升级。", { devices: failedDevices.join("、") })}
        </p>}
      </form>
    </section>
  );
}
