import { isIOSNativeHost } from "../native-ui/preference";

export const FONT_SIZE_STORAGE_KEY = "codex-mobile:font-size";
export const FONT_SCALES = {
  small: 0.875,
  standard: 1,
  large: 1.125,
  "extra-large": 1.25,
} as const;
export type FontSize = keyof typeof FONT_SCALES;

export function readFontSize(): FontSize {
  try {
    const value = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (value && Object.hasOwn(FONT_SCALES, value)) return value as FontSize;
  } catch {
    // 存储不可读时仍使用当前客户端的默认字号进入应用。
  }
  return isIOSNativeHost() ? "small" : "standard";
}

export function applyFontSize(size: FontSize) {
  document.documentElement.style.setProperty("--app-font-scale", String(FONT_SCALES[size]));
}
