import { useSyncExternalStore } from "react";

export const INTERFACE_MODE_STORAGE_KEY = "codex-mobile:interface-mode";
export type InterfaceMode = "native" | "web";
const changedEvent = "codex-mobile-interface-mode-change";
let unsavedMode: InterfaceMode | null = null;

export function readInterfaceMode(): InterfaceMode {
  if (unsavedMode) return unsavedMode;
  try {
    return window.localStorage.getItem(INTERFACE_MODE_STORAGE_KEY) === "web" ? "web" : "native";
  } catch { return "native"; }
}

export function setInterfaceMode(mode: InterfaceMode): boolean {
  unsavedMode = mode;
  let saved = false;
  try {
    window.localStorage.setItem(INTERFACE_MODE_STORAGE_KEY, mode);
    unsavedMode = null;
    saved = true;
  } catch { /* 当前页面继续使用选择的界面。 */ }
  window.dispatchEvent(new Event(changedEvent));
  return saved;
}

function subscribe(listener: () => void) {
  const externalChange = (event: StorageEvent) => {
    if (event.key !== INTERFACE_MODE_STORAGE_KEY && event.key !== null) return;
    unsavedMode = null;
    listener();
  };
  window.addEventListener(changedEvent, listener);
  window.addEventListener("storage", externalChange);
  return () => {
    window.removeEventListener(changedEvent, listener);
    window.removeEventListener("storage", externalChange);
  };
}

export function useInterfaceMode() {
  return useSyncExternalStore(subscribe, readInterfaceMode, () => "native" as const);
}
