import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { elementMenuAnchor, type MenuAnchor } from "../../ui/native-action-menu";
import { copyText } from "../../ui/copy";
import {
  isThreadRunning,
  relativeTime,
} from "../../ui/conversation";
import {
  AppIcon,
  titleOf,
  type ThreadListState,
} from "../../ui/app-display";
import { ErrorBanner } from "../../ui/ErrorBanner";
import type {
  BackendConfig,
  BackendRuntimeSummary,
} from "../../backends/types";
import type { ProjectThreadLoadState } from "../../app-server/thread-list-loader";
import {
  PROJECTLESS_GROUP_ID,
  PROJECT_THREAD_BATCH_SIZE,
} from "../../app-server/thread-list-loader";
import { BackendSwitcher } from "../backends/BackendSwitcher";
import { ConversationActionMenu } from "../conversation/ConversationControls";
import {
  groupThreadsByProject,
  splitAllThreads,
  type AggregatedThreadItem,
} from "./thread-list-model";
import { isProjectCollapsed, projectCollapseKey } from "./project-collapse";
import { t } from "../../i18n";

export type ThreadManagementAction =
  | "pin"
  | "refresh"
  | "duplicate"
  | "rename"
  | "archive";

const LONG_PRESS_DELAY_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export function ThreadListPage({
  sidebarOpen = true,
  onCloseSidebar,
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
  onOpenDrafts,
  onRetryProject,
  onToggleProject,
  onToggleProjectCollapsed,
}: {
  sidebarOpen?: boolean;
  onCloseSidebar?: () => void;
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
  ) => Promise<boolean>;
  onNewChat: () => void;
  onSelectBackend: (backendId: string) => void;
  onManageBackends: () => void;
  onRefresh: () => void;
  onOpenDrafts?: () => void;
  onRetryProject: (backendId: string, cwd: string) => void;
  onToggleProject: (backendId: string, cwd: string) => void;
  onToggleProjectCollapsed: (backendId: string, cwd: string) => void;
}) {
  const [managedThread, setManagedThread] =
    useState<AggregatedThreadItem | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor>();
  const [pendingThreadAction, setPendingThreadAction] = useState("");
  const [projectVisibleLimits, setProjectVisibleLimits] = useState<Record<string, number>>({});
  const sidebarRef = useRef<HTMLElement | null>(null);
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
  const projectGroups = groupThreadsByProject(visibleThreads.filter((thread) => !thread.pinned), [
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
  useEffect(() => {
    if (!collapsedProjectKeys.size) return;
    setProjectVisibleLimits((previous) => {
      const resetKeys = [...collapsedProjectKeys].filter(
        (key) => previous[key] !== PROJECT_THREAD_BATCH_SIZE,
      );
      if (!resetKeys.length) return previous;
      const next = { ...previous };
      for (const key of resetKeys) next[key] = PROJECT_THREAD_BATCH_SIZE;
      return next;
    });
  }, [collapsedProjectKeys]);
  useEffect(() => clearLongPress, []);
  useEffect(() => {
    if (sidebarOpen) return;
    clearLongPress();
    suppressClickRef.current = null;
    setManagedThread(null);
  }, [sidebarOpen]);
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
    if (!sidebarOpen || event.button !== 0) return;
    clearLongPress();
    // 新触摸属于下一次点击，不能沿用上一次长按的尾随 click 抑制。
    suppressClickRef.current = null;
    const key = managementKey(thread);
    const anchor = elementMenuAnchor(event.currentTarget);
    const timer = window.setTimeout(() => {
      suppressClickRef.current = { key, until: Date.now() + 1_000 };
      setMenuAnchor(anchor);
      setManagedThread(thread);
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
    return (
      <button
        key={key}
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
          clearLongPress();
          if (!sidebarOpen) return;
          suppressClickRef.current = { key, until: Date.now() + 1_000 };
          setMenuAnchor(elementMenuAnchor(event.currentTarget));
          setManagedThread(thread);
        }}
        onPointerDown={(event) => startLongPress(event, thread)}
        onPointerMove={moveLongPress}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onPointerLeave={clearLongPress}
      >
      <span className="thread-row-title">
        <span>{titleOf(thread.thread)}</span>
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
    );
  };

  return (
    <section className="thread-list-page" ref={sidebarRef}>
      <div className="thread-list-sticky">
        <><header className="list-header">
          <div>
            <h1>Codex Mobile</h1>
            <p>
              <i
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
          <div className="list-header-actions">
            <button
              type="button"
              className="round-button"
              aria-label={t("草稿")}
              title={t("草稿")}
              onClick={onOpenDrafts}
            >
              <AppIcon name="draft" />
            </button>
            <button
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
              className="round-button"
              aria-label={t("管理设备")}
              onClick={onManageBackends}
            >
              <AppIcon name="more" />
            </button>
          </div>
        </header>
        <BackendSwitcher
          backends={backends}
          summaries={summaries}
          selectedBackendId={selectedBackendId}
          loadingBackendIds={loadingBackendIds}
          onSelect={onSelectBackend}
        /></>
      </div>
      <div className="thread-list">
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
                <h2>{t("关注")}</h2>
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
                <h2>{t("关注")}</h2>
                {allGroups.pinned.map((thread) => renderRow(thread, false))}
              </section>
            )}
            {projectGroups
              .filter(
                (group) =>
                  !query.trim() ||
                  group.threads.length > 0,
              )
              .map((group) => {
                const projectKey = projectCollapseKey(
                  selectedBackendId,
                  group.cwd,
                );
                const isExpanded =
                  Boolean(query.trim()) ||
                  !isProjectCollapsed(collapsedProjectKeys, selectedBackendId, group.cwd);
                const isLoadingMore = loadingProjectKeys.has(projectKey) || (!query.trim() && projectThreadStates[group.cwd] === "loading");
                const projectThreadState =
                  projectThreadStates[group.cwd] ??
                  (group.threads.length ? "ready" : "idle");
                const visibleLimit = projectVisibleLimits[projectKey] ?? PROJECT_THREAD_BATCH_SIZE;
                let countedThreads = 0;
                const displayedThreads = query.trim()
                  ? group.threads
                  : group.threads.filter(thread => thread.unread || ++countedThreads <= visibleLimit);
                const loadedCount = group.threads.filter(thread => !thread.unread).length;
                const hasServerMore =
                  projectHasMore[group.cwd] ??
                  group.threads.length >= PROJECT_THREAD_BATCH_SIZE;
                const hasMore = hasServerMore || displayedThreads.length < group.threads.length;
                const showInitialLoading =
                  projectThreadState === "loading" &&
                  group.threads.length === 0 &&
                  !visibleThreads.some((thread) => thread.pinned &&
                    (thread.isProjectless ? PROJECTLESS_GROUP_ID : String(thread.cwd ?? "")) === group.cwd);
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
                        onClick={() => {
                          if (!isProjectCollapsed(collapsedProjectKeys, selectedBackendId, group.cwd)) {
                            setProjectVisibleLimits((previous) => ({
                              ...previous,
                              [projectKey]: PROJECT_THREAD_BATCH_SIZE,
                            }));
                          }
                          onToggleProjectCollapsed(
                            selectedBackendId,
                            group.cwd,
                          );
                        }}
                      >
                        <AppIcon
                          name={isExpanded ? "folder-open" : "folder"}
                        />
                        <span className="project-heading-label">
                          <span className="project-heading-name">{group.projectName}</span>
                          {!isExpanded && (
                            <span className="project-attention">
                              {group.threads.some((thread) => isThreadRunning(thread.status)) && (
                                <i className="running-spinner" aria-label={t("进行中")} />
                              )}
                              {group.threads.some((thread) => thread.unread) && (
                                <i className="thread-unread-dot" aria-label={t("未读")} />
                              )}
                            </span>
                          )}
                        </span>
                      </button>
                    </h2>
                    {isExpanded && (
                      <>
                        {displayedThreads.map((thread) =>
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
                            onClick={() => {
                              if (query.trim()) {
                                onToggleProject(selectedBackendId, group.cwd);
                                return;
                              }
                              const nextLimit = visibleLimit + PROJECT_THREAD_BATCH_SIZE;
                              setProjectVisibleLimits((previous) => ({
                                ...previous,
                                [projectKey]: nextLimit,
                              }));
                              if (hasServerMore && nextLimit > loadedCount) {
                                onToggleProject(selectedBackendId, group.cwd);
                              }
                            }}
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
          !visibleThreads.length &&
          (selectedBackendId === "all" ||
            !projectDirectories.length ||
            Boolean(query.trim())) && (
          <div className="empty-state">
            {query.trim() ? t("没有匹配的对话") : t("暂无对话")}
          </div>
        )}
        {threadListState === "error" && !totalThreadCount && (
          <div className="empty-state">{t("无法加载会话")}</div>
        )}
      </div>
      <ErrorBanner message={error} />
      <ConversationActionMenu
        open={sidebarOpen && managedThread !== null}
        readOnly={
          managedThread
            ? summaries[managedThread.backendId]?.connection !== "online"
            : false
        }
        thread={managedThread?.thread ?? {}}
        pendingAction={pendingThreadAction}
        anchor={menuAnchor}
        onClose={() => {
          if (!pendingThreadAction) setManagedThread(null);
        }}
        onPin={() => void runThreadAction("pin")}
        onRefresh={() => void runThreadAction("refresh")}
        onDuplicate={() => void runThreadAction("duplicate")}
        onCopy={() => {
          if (!managedThread) return;
          void copyText(managedThread.threadId);
          setManagedThread(null);
        }}
        onRename={() => void runThreadAction("rename")}
        onArchive={() => void runThreadAction("archive")}
      />
      <footer className="list-actions">
        <label className="search-box" aria-busy={searching}><AppIcon name="search" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("搜索聊天")} /></label>
        <button
          className="new-chat"
          onClick={onNewChat}
        >
          <AppIcon name="compose" />{t("聊天")}
        </button>
      </footer>
    </section>
  );
}
