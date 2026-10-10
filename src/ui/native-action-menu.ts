import { flushSync } from "react-dom";

export const ACTION_MENU_EVENT = "codex-mobile-action-menu";
export type MenuAnchor = { x: number; y: number; width: number; height: number };
export type MenuAction = {
  id: string;
  title: string;
  icon?: string;
  disabled?: boolean;
  destructive?: boolean;
  copyText?: string;
  onSelect: (native: boolean) => void;
};
type NativeMenuBridge = { show: (request: string) => void; dismiss: (requestId: string) => void };
export function readNativeActionMenuBridge(): NativeMenuBridge | null {
  const scope = window as typeof window & {
    CodexMobileActionMenu?: NativeMenuBridge;
    JsBridge?: { showActionMenu?: (request: string) => void; dismissActionMenu?: (id: string) => void };
  };
  if (typeof scope.CodexMobileActionMenu?.show === "function" &&
      typeof scope.CodexMobileActionMenu.dismiss === "function") return scope.CodexMobileActionMenu;
  const android = scope.JsBridge;
  return typeof android?.showActionMenu === "function" && typeof android.dismissActionMenu === "function"
    ? { show: (request) => android.showActionMenu!(request), dismiss: (id) => android.dismissActionMenu!(id) }
    : null;
}
let nextId = 0;
let cancelActive: (() => void) | null = null;
export function presentNativeActionMenu(
  actions: MenuAction[], anchor: MenuAnchor, onClose: (actionId?: string) => void,
): (() => void) | null {
  const bridge = readNativeActionMenuBridge();
  if (!bridge) return null;
  cancelActive?.();
  const requestId = `menu-${++nextId}`;
  let finished = false;
  const dispose = () => {
    if (finished) return;
    finished = true;
    if (cancelActive === cancel) cancelActive = null;
    window.removeEventListener(ACTION_MENU_EVENT, receive);
    bridge.dismiss(requestId);
  };
  const cancel = () => { dispose(); onClose(); };
  cancelActive = cancel;
  const receive = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.requestId !== requestId || finished) return;
    const action = actions.find((entry) => entry.id === detail.actionId && !entry.disabled);
    dispose();
    onClose(action?.id);
    // 原生动作通过 evaluateJavaScript 返回；同步提交编辑框，让 focus 仍处于
    // WebKit 的原生用户操作调用内，能够弹出系统键盘。
    if (action && !action.disabled) flushSync(() => action.onSelect(true));
  };
  window.addEventListener(ACTION_MENU_EVENT, receive);
  try {
    bridge.show(JSON.stringify({ requestId, anchor,
      actions: actions.map(({ onSelect: _, ...action }) => action) }));
    return dispose;
  } catch {
    dispose();
    return null;
  }
}
export function elementMenuAnchor(element: Element): MenuAnchor {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
