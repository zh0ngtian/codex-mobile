import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { applyFontSize, FONT_SIZE_STORAGE_KEY, readFontSize, type FontSize } from "../../ui/font-size";

export function FontSizeSettings() {
  const [size, setSize] = useState(readFontSize);
  const [saveError, setSaveError] = useState(false);
  useEffect(() => applyFontSize(size), [size]);

  const selectSize = (value: FontSize) => {
    setSize(value);
    applyFontSize(value);
    try {
      window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, value);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  };

  return (
    <section className="backend-language-settings font-size-settings" aria-label={t("字体大小")}>
      <strong>{t("字体大小")}</strong>
      <div role="group" aria-label={t("字体大小")}>
        {([["small", "小"], ["standard", "标准"], ["large", "大"], ["extra-large", "特大"]] as const).map(([value, label]) => (
          <button type="button" key={value} className={size === value ? "selected" : ""}
            aria-pressed={size === value} onClick={() => selectSize(value)}>{t(label)}</button>
        ))}
      </div>
      <small>{t("立即生效，仅保存在当前客户端")}</small>
      {saveError && <small role="alert">{t("字号已应用，但无法保存；重启后可能恢复原字号")}</small>}
    </section>
  );
}
