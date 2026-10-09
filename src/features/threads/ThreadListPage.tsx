import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  isThreadRunning,
  relativeTime,
} from "../../ui/conversation";
import {
  AppIcon,
  titleOf,
  type ThreadListState,
} from "../../ui/app-display";
import type {
  BackendConfig,
  BackendRuntimeSummary,
} from "../../backends/types";
import type { ProjectThreadLoadState } from "../../app-server/thread-list-loader";
import { PROJECTLESS_GROUP_ID } from "../../app-server/thread-list-loader";
import { BackendSwitcher } from "../backends/BackendSwitcher";
import { ConversationActionMenu } from "../conversation/ConversationControls";
import {
  groupThreadsByProject,
  isThreadPrioritized,
  splitAllThreads,
  type AggregatedThreadItem,
} from "./thread-list-model";
import { projectCollapseKey } from "./project-collapse";
import { t } from "../../i18n";
import { useNativeSidebar } from "./useNativeSidebar";

export type ThreadManagementAction =
  | "pin"
  | "refresh"
  | "duplicate"
  | "rename"
  | "archive";

const LONG_PRESS_DELAY_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export interface ThreadListPageProps {
  backends: BackendConfig[];
  summaries: Record<string, BackendRuntimeSummary>;
  selectedBackendId: string;
  loadingBackendIds: Set<string>;
  refreshing: boolean;
  threadListState: ThreadListState;
  visibleThreads: AggregatedThreadItem[];
  totalThreadCount: number;
  projectDirectories: string[];
  hasProjectlessThreads: boolean;
  projectThreadStates: Record<string, ProjectThreadLoadState>;
  projectHasMore: Record<string, boolean>;
  collapsedProjectKeys: Set<string>;
  loadingProjectKeys: Set<string>;
  openingThreadId: string;
  query: string;
  searching: boolean;
  error: string;
  onQueryChange: (value: string) => void;
  onOpenThread: (thread: AggregatedThreadItem) => void | Promise<void>;
  onManageThread: (
    thread: AggregatedThreadItem,
    action: ThreadManagementAction,
    name?: string,
  ) => Promise<boolean>;
  onNewChat: () => void;
  onSelectBackend: (backendId: string) => void;
  onManageBackends: () => void;
  onRefresh: () => void;
  onRetryProject: (backendId: string, cwd: string) => void;
  onToggleProject: (backendId: string, cwd: string) => void;
  onToggleProjectCollapsed: (backendId: string, cwd: string) => void;
  nativeVisible?: boolean;
  onClose?: () => void;
}

export function ThreadListPage({
  backends,
  summaries,
  selectedBackendId,
  loadingBackendIds,
  refreshing,
  threadListState,
  visibleThreads,
  totalThreadCount,
  projectDirectories,
  hasProjectlessThreads,
  projectThreadStates,
  projectHasMore,
  collapsedProjectKeys,
  loadingProjectKeys,
  openingThreadId,
  query,
  searching,
  error,
  onQueryChange,
  onOpenThread,
  onManageThread,
  onNewChat,
  onSelectBackend,
  onManageBackends,
  onRefresh,
  onRetryProject,
  onToggleProject,
  onToggleProjectCollapsed,
  nativeVisible = false,
  onClose,
}: ThreadListPageProps) {
  const nativeSidebarVisible = useNativeSidebar({
    backends, summaries, selectedBackendId, loadingBackendIds, refreshing,
    threadListState, visibleThreads, totalThreadCount, projectDirectories,
    hasProjectlessThreads, projectThreadStates, projectHasMore,
    collapsedProjectKeys, loadingProjectKeys, openingThreadId, query, searching,
    error, onQueryChange, onOpenThread, onManageThread, onNewChat,
    onSelectBackend, onManageBackends, onRefresh, onRetryProject,
    onToggleProject, onToggleProjectCollapsed, nativeVisible, onClose,
  });
  const [managedThread, setManagedThread] =
    useState<AggregatedThreadItem | null>(null);
  const [pendingThreadAction, setPendingThreadAction] = useState("");
  const sidebarRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const wasVisibleRef = useRef(nativeVisible);
  const rowIdPrefix = useId();
  const longPressRef = useRef<{
    timer: number;
    key: string;
    x: number;
    y: number;
  } | null>(null);
  const suppressClickRef = useRef<{ key: string; until: number } | null>(null);
  const enabledBackends = backends.filter((backend) => backend.enabled);
  const onlineCount = enabledBackends.filter(
    (backend) => summaries[backend.id]?.connection === "online",
  ).length;
  const selectedBackend = enabledBackends.find(
    (backend) => backend.id === selectedBackendId,
  );
  const selectedSummary = selectedBackend
    ? summaries[selectedBackend.id]
    : undefined;
  const allGroups = splitAllThreads(visibleThreads);
  const projectGroups = groupThreadsByProject(visibleThreads, [
    ...(hasProjectlessThreads ? [PROJECTLESS_GROUP_ID] : []),
    ...projectDirectories,
  ]);
  const renderNow = Math.floor(Date.now() / 1000);
  const clearLongPress = () => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  };
  useEffect(() => clearLongPress, []);
  const blurSidebar = () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && sidebarRef.current?.contains(focused)) {
      focused.blur();
    }
  };
  const closeSidebar = () => {
    clearLongPress();
    menuTriggerRef.current = null;
    setManagedThread(null);
    blurSidebar();
    onClose?.();
  };
  const clearSearch = () => {
    onQueryChange("");
    searchRef.current?.focus();
  };
  const openManagement = (thread: AggregatedThreadItem, trigger: HTMLElement) => {
    clearLongPress();
    blurSidebar();
    menuTriggerRef.current = trigger;
    setManagedThread(thread);
  };
  useEffect(() => {
    if (wasVisibleRef.current && !nativeVisible) {
      clearLongPress();
      menuTriggerRef.current = null;
      setManagedThread(null);
      blurSidebar();
    }
    wasVisibleRef.current = nativeVisible;
  }, [nativeVisible]);
  useEffect(() => {
    if (managedThread) {
      menuRef.current
        ?.querySelector<HTMLElement>(".conversation-action-menu button:not(:disabled)")
        ?.focus();
    } else {
      const trigger = menuTriggerRef.current;
      menuTriggerRef.current = null;
      if (trigger?.isConnected) {
        trigger.focus();
      } else if (trigger) {
        const fallback = sidebarRef.current?.querySelector<HTMLElement>(".sidebar-close")
          ?? sidebarRef.current?.querySelector<HTMLElement>(".thread-manage, .round-button");
        fallback?.focus();
      }
    }
  }, [managedThread]);
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!pendingThreadAction) setManagedThread(null);
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(
      ".conversation-action-menu button:not(:disabled)",
    ) ?? []);
    if (!controls.length) {
      event.preventDefault();
      menuRef.current?.focus();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = document.activeElement as HTMLElement;
    const focusOutsideActions = !controls.includes(active);
    if (event.shiftKey && (active === first || focusOutsideActions)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || focusOutsideActions)) {
      event.preventDefault();
      first.focus();
    }
  };
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const preventNativeTextSelection = (event: Event) => {
      const target =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
      if (
        target?.closest(
          "input, textarea, [contenteditable]:not([contenteditable='false'])",
        )
      ) {
        return;
      }
      event.preventDefault();
    };
    sidebar.addEventListener("selectstart", preventNativeTextSelection, true);
    return () => {
      sidebar.removeEventListener(
        "selectstart",
        preventNativeTextSelection,
        true,
      );
    };
  }, []);

  const managementKey = (thread: AggregatedThreadItem) =>
    `${thread.backendId}:${thread.threadId}`;
  const startLongPress = (
    event: ReactPointerEvent<HTMLButtonElement>,
    thread: AggregatedThreadItem,
  ) => {
    if (event.button !== 0) return;
    clearLongPress();
    const key = managementKey(thread);
    const trigger = event.currentTarget;
    const timer = window.setTimeout(() => {
      suppressClickRef.current = { key, until: Date.now() + 1_000 };
      openManagement(thread, trigger);
      longPressRef.current = null;
    }, LONG_PRESS_DELAY_MS);
    longPressRef.current = {
      timer,
      key,
      x: event.clientX,
      y: event.clientY,
    };
  };
  const moveLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const press = longPressRef.current;
    if (
      press &&
      (Math.abs(event.clientX - press.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
        Math.abs(event.clientY - press.y) > LONG_PRESS_MOVE_TOLERANCE_PX)
    ) {
      clearLongPress();
    }
  };
  const runThreadAction = async (action: ThreadManagementAction) => {
    const thread = managedThread;
    if (!thread || pendingThreadAction) return;
    setPendingThreadAction(action);
    try {
      if (await onManageThread(thread, action)) setManagedThread(null);
    } finally {
      setPendingThreadAction("");
    }
  };
  const renderRow = (
    thread: AggregatedThreadItem,
    showSource: boolean,
  ) => {
    const key = managementKey(thread);
    const searchSnippet = query.trim() && typeof thread.searchSnippet === "string"
      ? thread.searchSnippet.trim().replace(/\s+/g, " ")
      : "";
    const titleId = `${rowIdPrefix}-${encodeURIComponent(key)}`;
    return (
      <div className="thread-row-container" key={key}>
        <button
          type="button"
          className={`thread-row${showSource ? " with-source" : ""}${searchSnippet ? " with-search-snippet" : ""}`}
          disabled={openingThreadId === `${thread.backendId}:${thread.threadId}`}
          aria-busy={openingThreadId === `${thread.backendId}:${thread.threadId}`}
          onClick={(event) => {
            const suppressed = suppressClickRef.current;
            suppressClickRef.current = null;
            if (suppressed?.key === key && Date.now() <= suppressed.until) {
              event.preventDefault();
              return;
            }
            void onOpenThread(thread);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            openManagement(thread, event.currentTarget);
          }}
          onPointerDown={(event) => startLongPress(event, thread)}
          onPointerMove={moveLongPress}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onPointerLeave={clearLongPress}
        >
          <span className="thread-row-title">
            <span id={titleId}>{titleOf(thread.thread)}</span>
          </span>
          {isThreadRunning(thread.status) ? (
            <span className="thread-running" aria-label={t("进行中")}>
              <i className="running-spinner" />
            </span>
          ) : (
            <span className="thread-row-meta">
              {thread.unread && (
                <i className="thread-unread-dot" aria-label={t("未读")} />
              )}
              <time>{relativeTime(thread.timestamp, renderNow)}</time>
            </span>
          )}
          {showSource && (
            <small className="thread-source">
              {thread.backendName} · {thread.projectName}
            </small>
          )}
          {searchSnippet && (
            <small className="thread-search-snippet">{searchSnippet}</small>
          )}
        </button>
        <button
          type="button"
          className="thread-manage"
          aria-label={t("会话详情操作")}
          aria-describedby={titleId}
          aria-haspopup="dialog"
          disabled={openingThreadId === key}
          onClick={(event) => openManagement(thread, event.currentTarget)}
        >
          <AppIcon name="more" />
        </button>
      </div>
    );
  };

  return (
    <section
      className="thread-list-page web-sidebar"
      ref={sidebarRef}
      data-native-sidebar={nativeSidebarVisible}
    >
      <div className="thread-list-sticky" aria-hidden={managedThread !== null}>
        <header className="list-header">
          <div className="sidebar-heading">
            <h1>Codex Mobile</h1>
            <div className="list-header-actions">
              <button
                type="button"
                className={`round-button${refreshing ? " refreshing" : ""}`}
                aria-label={t("刷新会话列表")}
                aria-busy={refreshing}
                onClick={onRefresh}
              >
                {refreshing ? (
                  <i className="sidebar-refresh-spinner" aria-hidden="true" />
                ) : (
                  <AppIcon name="refresh" />
                )}
              </button>
              <button
                type="button"
                className="round-button"
                aria-label={t("管理设备")}
                onClick={onManageBackends}
              >
                <AppIcon name="more" />
              </button>
              {onClose && (
                <button
                  type="button"
                  className="round-button sidebar-close"
                  aria-label={t("关闭会话列表")}
                  onClick={closeSidebar}
                >
                  <AppIcon name="close" />
                </button>
              )}
            </div>
          </div>
          <div className="sidebar-connection">
            <p>
              <i
                aria-hidden="true"
                className={`status-dot ${
                  onlineCount ? "online" : "connecting"
                }`}
              />
              {selectedBackend
                ? `${selectedBackend.name} · ${
                    selectedSummary?.connection === "online"
                      ? t("已连接")
                      : selectedSummary?.connection === "offline"
                        ? t("已断开")
                        : t("连接中")
                  }`
                : t("{count} 台机器 · {online} 台已连接", {
                    count: enabledBackends.length,
                    online: onlineCount,
                  })}
            </p>
          </div>
        </header>
        <BackendSwitcher
          backends={backends}
          summaries={summaries}
          selectedBackendId={selectedBackendId}
          loadingBackendIds={loadingBackendIds}
          onSelect={onSelectBackend}
        />
        <div className="sidebar-search">
          <label className="search-box" aria-busy={searching}>
            <AppIcon name="search" />
            <input
              ref={searchRef}
              aria-label={t("搜索聊天")}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={t("搜索聊天")}
              autoComplete="off"
              enterKeyHint="search"
            />
          </label>
          {query.length > 0 && (
            <button
              type="button"
              className="sidebar-search-clear"
              aria-label={t("清除搜索")}
              onClick={clearSearch}
            >
              <AppIcon name="close" />
            </button>
          )}
        </div>
      </div>
      <div className="thread-list" onScroll={clearLongPress} aria-hidden={managedThread !== null}>
        {(error || threadListState === "error") && (
          <div className="sidebar-error" role="alert">
            <p>{error || t("无法加载会话")}</p>
            <button
              type="button"
              className="sidebar-retry"
              disabled={refreshing || searching}
              aria-busy={refreshing || searching}
              onClick={onRefresh}
            >
              <AppIcon name="refresh" />{t("重试")}
            </button>
          </div>
        )}
        {query.trim() && searching && (
          <div
            className="thread-searching"
            role="status"
            aria-label={t("正在搜索会话")}
          >
            <i className="sidebar-refresh-spinner" aria-hidden="true" />
            {t("正在搜索会话")}
          </div>
        )}
        {threadListState === "loading" && (
          <div
            className="thread-list-skeleton"
            aria-label={t("正在加载会话")}
            role="status"
          >
            {Array.from({ length: 5 }, (_, index) => (
              <div className="thread-row-skeleton" key={index}>
                <i />
                <i />
              </div>
            ))}
          </div>
        )}
        {threadListState !== "loading" && selectedBackendId === "all" && (
          <>
            {!!allGroups.pinned.length && (
              <section className="thread-section">
                <h2>{t("置顶")}</h2>
                {allGroups.pinned.map((thread) => renderRow(thread, true))}
              </section>
            )}
            {!!allGroups.recent.length && (
              <section className="thread-section">
                <h2>{t("最近")}</h2>
                {allGroups.recent.map((thread) => renderRow(thread, true))}
              </section>
            )}
          </>
        )}
        {threadListState !== "loading" && selectedBackendId !== "all" && (
          <>
            {!!allGroups.pinned.length && (
              <section className="thread-section">
                <h2>{t("置顶")}</h2>
                {allGroups.pinned.map((thread) => renderRow(thread, false))}
              </section>
            )}
            {projectGroups
              .filter(
                (group) =>
                  !query.trim() ||
                  group.threads.some((thread) => !isThreadPrioritized(thread)),
              )
              .map((group) => {
                const recentThreads = group.threads.filter(
                  (thread) => !isThreadPrioritized(thread),
                );
                const projectKey = projectCollapseKey(
                  selectedBackendId,
                  group.cwd,
                );
                const isExpanded =
                  Boolean(query.trim()) ||
                  !collapsedProjectKeys.has(projectKey);
                const isLoadingMore = loadingProjectKeys.has(projectKey);
                const projectThreadState =
                  projectThreadStates[group.cwd] ??
                  (group.threads.length ? "ready" : "idle");
                const hasMore =
                  projectHasMore[group.cwd] ??
                  group.threads.length >= 5;
                const showInitialLoading =
                  projectThreadState === "loading" &&
                  group.threads.length === 0;
                const showInitialError =
                  projectThreadState === "error" &&
                  group.threads.length === 0;
                return (
                  <section className="project-group" key={group.cwd}>
                    <h2>
                      <button
                        type="button"
                        className="project-heading"
                        aria-expanded={isExpanded}
                        onClick={() =>
                          onToggleProjectCollapsed(
                            selectedBackendId,
                            group.cwd,
                          )
                        }
                      >
                        <AppIcon
                          name={isExpanded ? "folder-open" : "folder"}
                        />
                        <span>{group.projectName}</span>
                      </button>
                    </h2>
                    {isExpanded && (
                      <>
                        {recentThreads.map((thread) =>
                          renderRow(thread, false),
                        )}
                        {showInitialLoading && (
                          <div
                            className="project-thread-skeleton"
                            aria-label={t("正在加载项目会话")}
                            role="status"
                          >
                            {Array.from({ length: 3 }, (_, index) => (
                              <div className="thread-row-skeleton" key={index}>
                                <i />
                                <i />
                              </div>
                            ))}
                          </div>
                        )}
                        {showInitialError && (
                          <button
                            type="button"
                            className="project-retry"
                            aria-label={t("重试加载 {name} 会话", {
                              name: group.projectName,
                            })}
                            onClick={() =>
                              onRetryProject(selectedBackendId, group.cwd)
                            }
                          >
                            {t("加载失败，点击重试")}
                          </button>
                        )}
                        {!showInitialLoading &&
                          !showInitialError &&
                          (isLoadingMore || hasMore) && (
                          <button
                            type="button"
                            className="project-more"
                            disabled={isLoadingMore}
                            aria-busy={isLoadingMore}
                            onClick={() =>
                              onToggleProject(
                                selectedBackendId,
                                group.cwd,
                              )
                            }
                          >
                            {isLoadingMore ? (
                              <>
                                <i
                                  className="action-spinner"
                                  aria-hidden="true"
                                />
                                {t("加载中")}
                              </>
                            ) : (
                              t("更多")
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </section>
                );
              })}
          </>
        )}
        {threadListState === "ready" &&
          !searching &&
          !error &&
          !visibleThreads.length &&
          (selectedBackendId === "all" ||
            !projectDirectories.length ||
            Boolean(query.trim())) && (
          <div className="empty-state" role="status">
            <p>{query.trim() ? t("没有匹配的对话") : t("暂无对话")}</p>
            {query.trim() && (
              <>
                <p>{t("试试其他关键词，或清除搜索查看全部聊天。")}</p>
                <button type="button" className="sidebar-retry" onClick={clearSearch}>{t("清除搜索")}</button>
              </>
            )}
          </div>
        )}
      </div>
      {managedThread && (
        <div
          className="web-thread-menu"
          role="dialog"
          aria-modal="true"
          aria-label={t("会话详情操作")}
          tabIndex={-1}
          ref={menuRef}
          onKeyDown={handleMenuKeyDown}
        >
          <ConversationActionMenu
            open={managedThread !== null}
            readOnly={
              managedThread
                ? summaries[managedThread.backendId]?.connection !== "online"
                : false
            }
            thread={managedThread?.thread ?? {}}
            pendingAction={pendingThreadAction}
            onClose={() => {
              if (!pendingThreadAction) setManagedThread(null);
            }}
            onPin={() => void runThreadAction("pin")}
            onRefresh={() => void runThreadAction("refresh")}
            onDuplicate={() => void runThreadAction("duplicate")}
            onCopy={() => {
              if (!managedThread) return;
              void navigator.clipboard?.writeText(managedThread.threadId);
              setManagedThread(null);
            }}
            onRename={() => void runThreadAction("rename")}
            onArchive={() => void runThreadAction("archive")}
          />
        </div>
      )}
      <footer className="list-actions" aria-hidden={managedThread !== null}>
        <button
          type="button"
          className="new-chat"
          onClick={onNewChat}
        >
          <AppIcon name="compose" />{t("聊天")}
        </button>
      </footer>
    </section>
  );
}
