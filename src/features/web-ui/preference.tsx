import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { t } from "../../i18n";
import { isNativeUIEnabled } from "../../native-ui/runtime";
import { useNativeSwitch } from "../../native-ui/switch-context";

export const WEB_INTERFACE_KEY = "codex-mobile:web-interface";

export function readWebInterfacePreference(storage?: Pick<Storage, "getItem">): boolean {
  try {
    return (storage ?? window.localStorage).getItem(WEB_INTERFACE_KEY) === "modern";
  } catch {
    return false;
  }
}

interface WebInterfaceState {
  /** 实际应用的 Web 界面；完整原生模式下保持旧版样式。 */
  modern: boolean;
  /** 用户保存的 Web 偏好，不随原生模式改变。 */
  enabled: boolean;
  change(enabled: boolean): void;
  error: string;
}

const WebInterfaceContext = createContext<WebInterfaceState>({
  modern: false,
  enabled: false,
  change() {},
  error: "",
});

function subscribeNativeRecovery(callback: () => void) {
  window.addEventListener("codex-mobile-native-recovery", callback);
  return () => window.removeEventListener("codex-mobile-native-recovery", callback);
}

export function WebInterfaceProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(readWebInterfacePreference);
  const [error, setError] = useState("");
  const nativeSwitch = useNativeSwitch();
  const nativeActive = useSyncExternalStore(subscribeNativeRecovery, isNativeUIEnabled, () => false);
  const modern = enabled && !nativeActive;

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.webInterface;
    root.dataset.webInterface = modern ? "modern" : "legacy";
    return () => {
      if (previous === undefined) delete root.dataset.webInterface;
      else root.dataset.webInterface = previous;
    };
  }, [modern]);

  const change = (next: boolean) => {
    try {
      window.localStorage.setItem(WEB_INTERFACE_KEY, next ? "modern" : "legacy");
    } catch (reason) {
      setError(t("无法保存界面偏好：{message}。请重试。", { message: reason instanceof Error ? reason.message : String(reason) }));
      return;
    }
    setEnabled(next);
    setError("");
    nativeSwitch?.changed();
  };

  return <WebInterfaceContext.Provider value={{ modern, enabled, change, error }}>{children}</WebInterfaceContext.Provider>;
}

export const useWebInterface = () => useContext(WebInterfaceContext);
