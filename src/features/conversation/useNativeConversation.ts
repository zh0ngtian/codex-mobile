import { useCallback, useEffect, useRef, useState } from "react";
import { readInterfaceMode, useInterfaceMode } from "../../ui/interface-mode";
import { nativeConversationHandler, type NativeConversationAction, type NativeConversationSnapshot } from "./native-conversation";

export function useNativeConversation(options: {
  foreground: boolean;
  snapshot: NativeConversationSnapshot;
  hasAttachments: boolean;
  submissionBlocked: boolean;
  suspended: boolean;
  onDraftChange: (text: string, cursor?: number) => void;
  onAction: (action: NativeConversationAction) => void;
}) {
  const mode = useInterfaceMode();
  const [available, setAvailable] = useState(() => Boolean(nativeConversationHandler()));
  const [fullContent, setFullContent] = useState(false);
  useEffect(() => { setFullContent(false); }, [mode]);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [acknowledgedSequence, acknowledge] = useState(0);
  const [pendingSubmit, setPendingSubmit] = useState<NativeConversationAction | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const lastSequence = useRef(0);
  const serialized = useRef("");
  const contextId = options.snapshot.contextId;
  const visibility = useRef(false);
  visibility.current = available && mode === "native" && options.foreground && !fullContent && !overlayOpen && !options.suspended;

  useEffect(() => {
    const ready = () => setAvailable(Boolean(nativeConversationHandler()));
    window.addEventListener("codex-mobile-native-conversation-ready", ready);
    return () => window.removeEventListener("codex-mobile-native-conversation-ready", ready);
  }, []);
  useEffect(() => {
    setFullContent(false);
    setPendingSubmit(null);
    serialized.current = "";
  }, [contextId]);

  useEffect(() => {
    if (!available) return;
    const update = () => setOverlayOpen(Array.from(document.querySelectorAll(
      '.conversation-sidebar-layer.open, .action-sheet-backdrop, [role="dialog"]',
    )).some((element) => !element.closest('[hidden], [aria-hidden="true"]')));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "role", "hidden", "aria-hidden"] });
    return () => observer.disconnect();
  }, [available]);

  useEffect(() => {
    if (!available || mode !== "native") return;
    const receive = (event: Event) => {
      const action = (event as CustomEvent<NativeConversationAction>).detail;
      const current = latest.current;
      if (readInterfaceMode() !== "native" || !visibility.current || !action || action.contextId !== current.snapshot.contextId ||
        !Number.isSafeInteger(action.sequence) || action.sequence <= lastSequence.current) return;
      lastSequence.current = action.sequence;
      acknowledge(action.sequence);
      if (action.type === "web") { setFullContent(true); return; }
      if (action.type === "draft" || action.type === "submit") {
        if (!current.snapshot.enabled || typeof action.text !== "string") return;
        if (action.type === "submit" && (current.submissionBlocked ||
          (!action.text.trim() && !current.hasAttachments))) return;
        current.onDraftChange(action.text, action.cursor);
        if (action.type === "submit") setPendingSubmit(action);
        return;
      }
      current.onAction(action);
    };
    window.addEventListener("codex-mobile-native-conversation-action", receive);
    return () => window.removeEventListener("codex-mobile-native-conversation-action", receive);
  }, [available, mode]);

  // React commit 后的回调已捕获最新草稿，不能在 native event 的同一调用栈发送旧文本。
  useEffect(() => {
    if (!pendingSubmit) return;
    if (!visibility.current || pendingSubmit.contextId !== contextId || !options.snapshot.enabled || options.submissionBlocked) {
      setPendingSubmit(null); return;
    }
    if (options.snapshot.draft !== pendingSubmit.text) return;
    setPendingSubmit(null);
    options.onAction(pendingSubmit);
  }, [pendingSubmit, contextId, mode, options.foreground, options.snapshot.draft, options.snapshot.enabled, options.submissionBlocked, fullContent, overlayOpen, options.suspended]);

  useEffect(() => {
    const handler = nativeConversationHandler();
    if (!available || !handler) return;
    if (mode !== "native" || !options.foreground) {
      // 后台设备保留 JS 连接，但不能向共享原生界面发布快照。
      if (serialized.current) {
        try { handler.postMessage({ type: "hide", contextId }); } catch { setAvailable(false); }
        serialized.current = "";
      }
      return;
    }
    const snapshot = { ...options.snapshot, acknowledgedSequence,
      visible: visibility.current };
    const next = JSON.stringify(snapshot);
    if (next === serialized.current) return;
    try { handler.postMessage({ type: "snapshot", snapshot }); serialized.current = next; }
    catch { setAvailable(false); }
  });

  useEffect(() => {
    if (!available) return;
    return () => {
      serialized.current = "";
      try { nativeConversationHandler()?.postMessage({ type: "hide", contextId }); } catch { /* 已销毁的容器 */ }
    };
  }, [available, contextId]);

  return { fullContent: available && mode === "native" && fullContent, restoreNative: useCallback(() => setFullContent(false), []) };
}
