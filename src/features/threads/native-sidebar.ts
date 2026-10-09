import { PROJECTLESS_GROUP_ID } from "../../app-server/thread-list-loader";
import { getActiveLocale, t } from "../../i18n";
import { titleOf } from "../../ui/app-display";
import { isThreadRunning, relativeTime } from "../../ui/conversation";
import { FONT_SCALES, readFontSize } from "../../ui/font-size";
import { groupThreadsByProject, isThreadPrioritized, splitAllThreads, type AggregatedThreadItem } from "./thread-list-model";
import { projectCollapseKey } from "./project-collapse";
import type { ThreadListPageProps } from "./ThreadListPage";

export interface NativeSidebarAction {
  contextId: string; sequence: number; type: string; id?: string; text?: string;
}
export interface NativeSidebarRow {
  id: string; threadId: string; title: string; source: string; time: string; snippet: string;
  pinned: boolean; unread: boolean; running: boolean; opening: boolean; readOnly: boolean;
}
export interface NativeSidebarSection {
  id: string; title: string; backendId: string; cwd: string; collapsible: boolean;
  expanded: boolean; loading: boolean; error: boolean; more: boolean; rows: NativeSidebarRow[];
}
export interface NativeSidebarSnapshot {
  version: 1; contextId: string; visible: boolean; acknowledgedSequence: number; locale: string;
  query: string; title: string; subtitle: string; selectedBackendId: string; fontSize: number;
  backends: Array<{ id: string; label: string; detail: string; online: boolean; loading: boolean; approvalCount: number }>;
  sections: NativeSidebarSection[]; loadState: string; searching: boolean; refreshing: boolean;
  error: string; pendingKey: string; pendingAction: string; strings: Record<string, string>;
}
export function nativeSidebarHandler() {
  const runtime = window as Window & {
    __codexNativeSidebarReady?: boolean;
    webkit?: { messageHandlers?: { nativeSidebar?: { postMessage: (message: unknown) => void } } };
  };
  return runtime.__codexNativeSidebarReady ? runtime.webkit?.messageHandlers?.nativeSidebar : undefined;
}
export function nativeSidebarSnapshot(props: ThreadListPageProps, contextId: string): NativeSidebarSnapshot {
  const enabled = props.backends.filter((backend) => backend.enabled);
  const selected = enabled.find((backend) => backend.id === props.selectedBackendId);
  const online = enabled.filter((backend) => props.summaries[backend.id]?.connection === "online").length;
  const connection = (id: string) => props.summaries[id]?.connection === "online" ? t("已连接")
    : props.summaries[id]?.connection === "offline" ? t("已断开") : t("连接中");
  const now = Math.floor(Date.now() / 1000);
  const row = (item: AggregatedThreadItem): NativeSidebarRow => ({
    id: `${item.backendId}:${item.threadId}`, threadId: item.threadId, title: titleOf(item.thread),
    source: props.selectedBackendId === "all" ? `${item.backendName} · ${item.projectName}` : "",
    time: relativeTime(item.timestamp, now),
    snippet: props.query.trim() && typeof item.searchSnippet === "string" ? item.searchSnippet.trim().replace(/\s+/g, " ") : "",
    pinned: item.pinned, unread: item.unread, running: isThreadRunning(item.status),
    opening: props.openingThreadId === `${item.backendId}:${item.threadId}`,
    readOnly: props.summaries[item.backendId]?.connection !== "online",
  });
  const groups = splitAllThreads(props.visibleThreads);
  const section = (id: string, title: string, rows: AggregatedThreadItem[]): NativeSidebarSection => ({
    id, title, backendId: "", cwd: "", collapsible: false, expanded: true,
    loading: false, error: false, more: false, rows: rows.map(row),
  });
  const sections: NativeSidebarSection[] = [];
  if (props.threadListState !== "loading") {
    if (groups.pinned.length) sections.push(section("pinned", t("置顶"), groups.pinned));
    if (props.selectedBackendId === "all") {
      if (groups.recent.length) sections.push(section("recent", t("最近"), groups.recent));
    } else {
      for (const group of groupThreadsByProject(props.visibleThreads, [
        ...(props.hasProjectlessThreads ? [PROJECTLESS_GROUP_ID] : []), ...props.projectDirectories,
      ])) {
        const recent = group.threads.filter((thread) => !isThreadPrioritized(thread));
        if (props.query.trim() && !recent.length) continue;
        const key = projectCollapseKey(props.selectedBackendId, group.cwd);
        const state = props.projectThreadStates[group.cwd] ?? (group.threads.length ? "ready" : "idle");
        sections.push({ ...section(`project:${key}`, group.projectName, recent),
          backendId: props.selectedBackendId, cwd: group.cwd, collapsible: true,
          expanded: Boolean(props.query.trim()) || !props.collapsedProjectKeys.has(key),
          loading: props.loadingProjectKeys.has(key) || state === "loading",
          error: state === "error" && !group.threads.length,
          more: props.projectHasMore[group.cwd] ?? group.threads.length >= 5,
        });
      }
    }
  }
  return {
    version: 1, contextId, visible: Boolean(props.nativeVisible), acknowledgedSequence: 0,
    locale: getActiveLocale(), fontSize: 16 * FONT_SCALES[readFontSize()], query: props.query,
    title: "Codex Mobile", subtitle: selected ? `${selected.name} · ${connection(selected.id)}`
      : t("{count} 台机器 · {online} 台已连接", { count: enabled.length, online }),
    selectedBackendId: props.selectedBackendId,
    backends: [{ id: "all", label: t("全部设备"),
      detail: enabled.some((backend) => props.summaries[backend.id]?.approvalCount)
        ? t("{count} 个待审批", { count: enabled.reduce((sum, backend) => sum + (props.summaries[backend.id]?.approvalCount ?? 0), 0) }) : "",
      online: online > 0, loading: false,
      approvalCount: enabled.reduce((sum, backend) => sum + (props.summaries[backend.id]?.approvalCount ?? 0), 0) },
      ...enabled.map((backend) => ({ id: backend.id, label: backend.name, detail: [connection(backend.id), props.loadingBackendIds.has(backend.id) ? t("正在加载会话") : "",
        props.summaries[backend.id]?.approvalCount ? t("{count} 个待审批", { count: props.summaries[backend.id].approvalCount }) : ""].filter(Boolean).join("，"),
        online: props.summaries[backend.id]?.connection === "online", loading: props.loadingBackendIds.has(backend.id),
        approvalCount: props.summaries[backend.id]?.approvalCount ?? 0 }))],
    sections, loadState: props.threadListState, searching: props.searching,
    refreshing: props.refreshing, error: props.error, pendingKey: "", pendingAction: "",
    strings: {
      close: t("关闭会话列表"), newChat: t("聊天"), search: t("搜索聊天"), refresh: t("刷新会话列表"),
      devices: t("管理设备"), selectBackend: t("设备"), allBackends: t("全部设备"), loading: t("正在加载会话"),
      searching: t("正在搜索会话"), noResults: t("没有匹配的对话"), noResultsHint: t("试试会话名称或内容"),
      empty: t("暂无对话"), loadError: t("无法加载会话"), retry: t("加载失败，点击重试"), more: t("更多"),
      pin: t("置顶"), unpin: t("取消置顶"), refreshThread: t("刷新会话"), duplicate: t("复制会话"),
      copy: t("复制会话 ID"), rename: t("重命名"), archive: t("归档"), renamePrompt: t("输入新的会话名称"),
      cancel: t("取消"), save: t("保存"), expanded: t("已展开"), collapsed: t("已折叠"), approvals: t("个待审批"), running: t("进行中"), unread: t("未读"),
    },
  };
}
