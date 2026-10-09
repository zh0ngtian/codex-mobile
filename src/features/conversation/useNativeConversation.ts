import { useCallback, useEffect, useRef, useState } from "react";
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
  const [available, setAvailable] = useState(() => Boolean(nativeConversationHandler()));
  const [fullContent, setFullContent] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [acknowledgedSequence, acknowledge] = useState(0);
  const [pendingSubmit, setPendingSubmit] = useState<NativeConversationAction | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const lastSequence = useRef(0);
  const serialized = useRef("");
  const contextId = options.snapshot.contextId;

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
    if (!available) return;
    const receive = (event: Event) => {
      const action = (event as CustomEvent<NativeConversationAction>).detail;
      const current = latest.current;
      if (!current.foreground || !action || action.contextId !== current.snapshot.contextId ||
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
  }, [available]);

  // React commit 后的回调已捕获最新草稿，不能在 native event 的同一调用栈发送旧文本。
  useEffect(() => {
    if (!pendingSubmit) return;
    if (!options.foreground || pendingSubmit.contextId !== contextId || !options.snapshot.enabled || options.submissionBlocked) {
      setPendingSubmit(null); return;
    }
    if (options.snapshot.draft !== pendingSubmit.text) return;
    setPendingSubmit(null);
    options.onAction(pendingSubmit);
  }, [pendingSubmit, contextId, options.foreground, options.snapshot.draft, options.snapshot.enabled, options.submissionBlocked]);

  useEffect(() => {
    const handler = nativeConversationHandler();
    if (!available || !handler) return;
    if (!options.foreground) {
      // 后台设备保留 JS 连接，但不能向共享原生界面发布快照。
      if (serialized.current) { handler.postMessage({ type: "hide", contextId }); serialized.current = ""; }
      return;
    }
    const snapshot = { ...options.snapshot, acknowledgedSequence,
      visible: !fullContent && !overlayOpen && !options.suspended };
    const next = JSON.stringify(snapshot);
    if (next === serialized.current) return;
    serialized.current = next;
    try { handler.postMessage({ type: "snapshot", snapshot }); }
    catch { setAvailable(false); }
  });

  useEffect(() => {
    if (!available) return;
    return () => { try { nativeConversationHandler()?.postMessage({ type: "hide", contextId }); } catch { /* 已销毁的容器 */ } };
  }, [available, contextId]);

  return { fullContent: available && fullContent, restoreNative: useCallback(() => setFullContent(false), []) };
}
