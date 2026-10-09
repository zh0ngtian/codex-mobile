import { useEffect, useRef, useState } from "react";
import { nativeSidebarHandler, nativeSidebarSnapshot, type NativeSidebarAction } from "./native-sidebar";
import type { ThreadListPageProps, ThreadManagementAction } from "./ThreadListPage";

/** React 为业务唯一来源；原生只发送有序意图，并接收当前可见列表。 */
export function useNativeSidebar(props: ThreadListPageProps) {
  const [available, setAvailable] = useState(() => Boolean(nativeSidebarHandler()));
  const [contextId] = useState(() => `sidebar:${crypto.randomUUID()}`);
  const [acknowledgedSequence, acknowledge] = useState(0);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState({ key: "", action: "" });
  const lastSequence = useRef(0); const serialized = useRef("");
  const pendingRef = useRef(false); const latest = useRef(props); latest.current = props;
  const visibility = useRef(false); visibility.current = Boolean(props.nativeVisible) && !overlayOpen;
  useEffect(() => {
    const ready = () => setAvailable(Boolean(nativeSidebarHandler()));
    window.addEventListener("codex-mobile-native-sidebar-ready", ready);
    return () => window.removeEventListener("codex-mobile-native-sidebar-ready", ready);
  }, []);
  useEffect(() => {
    if (!available) return;
    const update = () => setOverlayOpen(Array.from(document.querySelectorAll('.action-sheet-backdrop, [role="dialog"]'))
      .some((element) => !element.closest('[hidden], [aria-hidden="true"]')));
    update(); const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "role", "hidden", "aria-hidden"] });
    return () => observer.disconnect();
  }, [available]);
  useEffect(() => {
    if (!available) return;
    const receive = (event: Event) => {
      const action = (event as CustomEvent<NativeSidebarAction>).detail; const current = latest.current;
      if (!visibility.current || !action || action.contextId !== contextId ||
        !Number.isSafeInteger(action.sequence) || action.sequence <= lastSequence.current) return;
      lastSequence.current = action.sequence; acknowledge(action.sequence);
      switch (action.type) {
        case "query": if (typeof action.text === "string") current.onQueryChange(action.text); return;
        case "close": current.onClose?.(); return;
        case "new": current.onNewChat(); return;
        case "refresh": current.onRefresh(); return;
        case "devices": current.onManageBackends(); return;
        case "backend":
          if (action.id === "all" || current.backends.some((backend) => backend.enabled && backend.id === action.id)) current.onSelectBackend(action.id!);
          return;
      }
      if (action.type.startsWith("project-")) {
        const section = nativeSidebarSnapshot(current, contextId).sections.find((entry) => entry.id === action.id && entry.collapsible);
        if (!section) return;
        if (action.type === "project-collapse" && !section.loading && !current.query.trim()) current.onToggleProjectCollapsed(section.backendId, section.cwd);
        else if (action.type === "project-more" && section.more && !section.loading) current.onToggleProject(section.backendId, section.cwd);
        else if (action.type === "project-retry" && section.error) current.onRetryProject(section.backendId, section.cwd);
        return;
      }
      const item = current.visibleThreads.find((thread) => `${thread.backendId}:${thread.threadId}` === action.id);
      if (!item || pendingRef.current) return;
      if (action.type === "open") { if (current.openingThreadId !== action.id) void current.onOpenThread(item); return; }
      if (action.type === "copy") { void navigator.clipboard?.writeText(item.threadId); return; }
      const management = action.type === "refresh-thread" ? "refresh" : action.type;
      if (!["pin", "refresh", "duplicate", "rename", "archive"].includes(management)) return;
      if (["duplicate", "rename", "archive"].includes(management) && current.summaries[item.backendId]?.connection !== "online") return;
      const name = action.text?.trim();
      if (management === "rename" && !name) return;
      setActionError("");
      pendingRef.current = true; setPending({ key: action.id!, action: action.type });
      void Promise.resolve().then(() => current.onManageThread(item, management as ThreadManagementAction, name)).catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : String(error));
      }).finally(() => {
        pendingRef.current = false; setPending({ key: "", action: "" });
      });
    };
    window.addEventListener("codex-mobile-native-sidebar-action", receive);
    return () => window.removeEventListener("codex-mobile-native-sidebar-action", receive);
  }, [available, contextId]);
  useEffect(() => {
    const handler = nativeSidebarHandler(); if (!available || !handler) return;
    const snapshot = { ...nativeSidebarSnapshot(props, contextId), visible: visibility.current,
      error: props.error || actionError, acknowledgedSequence, pendingKey: pending.key, pendingAction: pending.action };
    const value = JSON.stringify(snapshot); if (value === serialized.current) return;
    try { handler.postMessage({ type: "snapshot", snapshot }); serialized.current = value; } catch { setAvailable(false); }
  });
  useEffect(() => {
    if (!available) return;
    return () => {
      serialized.current = "";
      try { nativeSidebarHandler()?.postMessage({ type: "hide", contextId }); } catch { /* 容器销毁 */ }
    };
  }, [available, contextId]);

  return available && Boolean(props.nativeVisible) && !overlayOpen;
}
