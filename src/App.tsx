import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppServerClient, type RpcMessage } from "./app-server/client";
import {
  buildEditedHistoryInput,
  createHistoricalMessageEditTarget,
  revertHistoricalMessage,
  type HistoricalMessageEditTarget,
} from "./app-server/history-edit";
import {
  listInstalledSkills,
  skillsReferencedInText,
  type InstalledSkill,
} from "./app-server/skills";
import {
  listInstalledPlugins,
  pluginMentionInput,
  pluginsReferencedInText,
  type InstalledPlugin,
} from "./app-server/plugins";
import {
  createLatestThreadListLoader,
  loadAllProjectlessThreadRecords,
  loadAllProjectThreadRecords,
  PROJECTLESS_GROUP_ID,
  type ProjectThreadLoadState,
} from "./app-server/thread-list-loader";
import {
  applyCompletedTurn,
  applyFileChangePatch,
  applyTurnDiff,
  applyTurnItem,
  applyTurnStarted,
  createPendingTurn,
  isThreadRunning,
  reconcileRecentTurns,
  removePendingTurn,
} from "./ui/conversation";
import {
  loadRecoverableRecentThreadTurns,
  loadOlderThreadTurns,
  prependUniqueTurns,
  resumeThreadSession,
  type OlderTurnsLoadState,
  type ThreadAccessMode,
} from "./app-server/thread-session";
import {
  activeTurnId,
  buildTurnSteerParams,
  clearPendingSteerForItem,
  clearPendingSteerForRequest,
  clearPendingSteerForThread,
  clearPendingSteerForTimeline,
  type PendingSteerMessage,
} from "./app-server/turn-steering";
import {
  activeThreadAfterArchive,
  duplicateThread,
  setThreadPinned,
} from "./app-server/thread-metadata";
import {
  ConversationPage,
  type ConversationLoadState,
  type QueuedFollowUpPreview,
} from "./features/conversation/ConversationPage";
import {
  ThreadListPage,
  type ThreadManagementAction,
} from "./features/threads/ThreadListPage";
import { ApprovalSheet } from "./features/approvals/ApprovalSheet";
import {
  ComposerSettings,
  type ComposerPicker,
} from "./features/settings/ComposerSettings";
import {
  AppIcon,
  titleOf,
  type ConnectionState,
  type ThreadListState,
} from "./ui/app-display";
import {
  ImageReadGeneration,
  buildOptimisticUserContent,
  buildTurnInput,
  mergeDraftImages,
  prepareImageFiles,
  prepareAttachmentFiles,
  isNativeImageFile,
  type DraftImage,
  type DraftFile,
} from "./ui/attachments";
import { uploadFile } from "./backends/file-upload";
import {
  effortOptionsForModel,
  defaultNewChatPermissionMode,
  normalizeModelSettings,
  permissionModeFromSettings,
  permissionModesFromProfiles,
  permissionProfileLabel,
  speedOptionsForModel,
  type ApprovalPolicy,
  type ApprovalsReviewer,
  type PermissionMode,
  type PermissionModeId,
} from "./ui/settings";
import {
  assignBackendHostId,
  loadBackendRegistry,
  saveBackendRegistry,
} from "./backends/registry";
import { BackendConnectionManager } from "./backends/connection-manager";
import {
  bindConnectionRecovery,
  bindReadOnlyThreadRefresh,
  reconnectAndWaitUntilReady,
  recoverBackendConnection,
} from "./backends/connection-recovery";
import {
  fetchBackendHostInfo,
  fetchBackendProjectState,
} from "./backends/probe";
import type {
  BackendConfig,
  BackendRegistry,
  BackendRuntimeSummary,
} from "./backends/types";
import { BackendManagerSheet } from "./features/backends/BackendManagerSheet";
import { BackendAttentionBanner } from "./features/backends/BackendAttentionBanner";
import { AppUpdateSheet } from "./features/update/AppUpdateSheet";
import {
  useAppUpdate,
  type AppUpdateController,
} from "./features/update/useAppUpdate";
import {
  aggregateThreads,
  filterAggregatedThreads,
  type AggregatedThreadItem,
} from "./features/threads/thread-list-model";
import {
  projectCollapseKey,
  readCollapsedProjectKeys,
  writeCollapsedProjectKeys,
} from "./features/threads/project-collapse";
import {
  mergeProjectlessThreadIds,
  readLocalProjectlessThreadIds,
  writeLocalProjectlessThreadIds,
} from "./features/threads/projectless-threads";
import { useSidebarRefresh } from "./features/threads/sidebar-refresh";
import {
  readUnreadThreadIds,
  shouldMarkThreadUnread,
  writeUnreadThreadIds,
} from "./features/threads/thread-unread";
import {
  applyPinnedThreadState,
  readPinnedThreadIds,
  writeThreadPinned,
} from "./features/threads/thread-pinning";
import {
  bindRunCompletionNavigation,
  completionThreadTitle,
  notifyRunCompleted,
  requestRunCompletionNotificationPermission,
  shouldNotifyRunCompleted,
  type RunCompletionNavigationTarget,
} from "./notifications/run-completion";
import { t, useI18n } from "./i18n";

type AnyRecord = Record<string, any>;

interface QueuedFollowUp extends QueuedFollowUpPreview {
  threadId: string;
  draftContext: number;
  inputText: string;
  images: DraftImage[];
  files: DraftFile[];
  skills: InstalledSkill[];
  plugins: InstalledPlugin[];
}

interface HistoricalMessageEditState {
  threadId: string;
  target: HistoricalMessageEditTarget;
  text: string;
  submitting: boolean;
  reverted: boolean;
}

interface BackendThreadSnapshot {
  backendId: string;
  threads: AnyRecord[];
  projects: string[];
  projectlessThreadIds: string[];
  projectThreadStates: Record<string, ProjectThreadLoadState>;
  projectHasMore: Record<string, boolean>;
  loadingProjectCwd: string;
  refreshing: boolean;
  threadListState: ThreadListState;
  openingThreadId: string;
  error: string;
}

interface WorkspaceCommand {
  id: number;
  backendId: string;
  type: "new" | "open" | "load-project" | "retry-project" | "manage";
  thread?: AnyRecord;
  cwd?: string | null;
  draft?: string;
  draftImages?: DraftImage[];
  draftFiles?: DraftFile[];
  managementAction?: ThreadManagementAction;
  name?: string;
  onComplete?: (completed: boolean) => void;
}

interface BackendWorkspaceProps {
  backend: BackendConfig;
  conversationVisible: boolean;
  backends: BackendConfig[];
  summaries: Record<string, BackendRuntimeSummary>;
  onSummaryChange: (summary: BackendRuntimeSummary) => void;
  onSnapshotChange: (snapshot: BackendThreadSnapshot) => void;
  onOpenSidebar: () => void;
  onSwitchNewChatBackend: (
    backendId: string,
    draft: string,
    draftImages: DraftImage[],
    draftFiles: DraftFile[],
  ) => void;
  command: WorkspaceCommand | null;
  refreshVersion: number;
}

function BackendWorkspace({
  backend,
  conversationVisible,
  backends,
  summaries,
  onSummaryChange,
  onSnapshotChange,
  onOpenSidebar,
  onSwitchNewChatBackend,
  command,
  refreshVersion,
}: BackendWorkspaceProps) {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [threads, setThreads] = useState<AnyRecord[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectlessThreadIds, setProjectlessThreadIds] = useState<string[]>(
    () => readLocalProjectlessThreadIds(window.localStorage, backend.id),
  );
  const [projectThreadStates, setProjectThreadStates] = useState<
    Record<string, ProjectThreadLoadState>
  >({});
  const [projectHasMore, setProjectHasMore] = useState<
    Record<string, boolean>
  >({});
  const [loadingProjectCwd, setLoadingProjectCwd] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [threadListState, setThreadListState] =
    useState<ThreadListState>("loading");
  const [active, setActive] = useState<AnyRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [draftFiles, setDraftFiles] = useState<DraftFile[]>([]);
  const [historyEdit, setHistoryEdit] =
    useState<HistoricalMessageEditState | null>(null);
  const [imageReading, setImageReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startingThreadContext, setStartingThreadContext] = useState<
    number | null
  >(null);
  const [steering, setSteering] = useState(false);
  const [pendingSteerMessage, setPendingSteerMessage] =
    useState<PendingSteerMessage | null>(null);
  const [queuedFollowUps, setQueuedFollowUps] = useState<QueuedFollowUp[]>([]);
  const [error, setError] = useState("");
  const [requests, setRequests] = useState<RpcMessage[]>([]);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [models, setModels] = useState<AnyRecord[]>([]);
  const [permissionProfiles, setPermissionProfiles] = useState<AnyRecord[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedEffort, setSelectedEffort] = useState<string | null>(null);
  const [selectedServiceTier, setSelectedServiceTier] = useState<string | null>(null);
  const [selectedPermission, setSelectedPermission] = useState("");
  const [selectedApprovalPolicy, setSelectedApprovalPolicy] =
    useState<ApprovalPolicy>("on-request");
  const [selectedApprovalsReviewer, setSelectedApprovalsReviewer] =
    useState<ApprovalsReviewer>("user");
  const [newChatPermissionMode, setNewChatPermissionMode] =
    useState<PermissionMode | null>(null);
  const [activeSettingsSynchronized, setActiveSettingsSynchronized] =
    useState(true);
  const [activeThreadAccessMode, setActiveThreadAccessMode] =
    useState<ThreadAccessMode>("interactive");
  const [activeThreadResumeError, setActiveThreadResumeError] = useState("");
  const [openingThreadId, setOpeningThreadId] = useState("");
  const [conversationLoadState, setConversationLoadState] =
    useState<ConversationLoadState>("idle");
  const [conversationLoadError, setConversationLoadError] = useState("");
  const [olderTurnsState, setOlderTurnsState] =
    useState<OlderTurnsLoadState>("exhausted");
  const [tokenUsageByThread, setTokenUsageByThread] = useState<
    Record<string, AnyRecord>
  >({});
  const [rateLimits, setRateLimits] = useState<AnyRecord | null>(null);
  const [pendingAction, setPendingAction] = useState("");
  const [notice, setNotice] = useState("");
  const [picker, setPicker] = useState<ComposerPicker>(null);
  const [skillCatalog, setSkillCatalog] = useState<{
    cwd: string | null;
    skills: InstalledSkill[];
    loading: boolean;
  }>({ cwd: null, skills: [], loading: false });
  const [pluginCatalog, setPluginCatalog] = useState<{
    cwd: string | null;
    plugins: InstalledPlugin[];
    loading: boolean;
  }>({ cwd: null, plugins: [], loading: false });
  const clientRef = useRef<AppServerClient | null>(null);
  const connectionManagerRef = useRef<BackendConnectionManager | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageReadGenerationRef = useRef(new ImageReadGeneration());
  const draftContextGenerationRef = useRef(0);
  const activeRef = useRef<AnyRecord | null>(null);
  const threadsRef = useRef<AnyRecord[]>([]);
  const conversationVisibleRef = useRef(conversationVisible);
  const activeThreadTargetRef = useRef<string | null>(null);
  const openSequenceRef = useRef(0);
  const olderTurnsCursorRef = useRef<string | null>(null);
  const olderTurnsGenerationRef = useRef(0);
  const olderTurnsLoadingRef = useRef(false);
  const fullyLoadedProjectCwdsRef = useRef(new Set<string>());
  const refreshSequenceRef = useRef(0);
  const threadNotificationSequenceRef = useRef(0);
  const pendingSequenceRef = useRef(0);
  const queuedFollowUpsRef = useRef<QueuedFollowUp[]>([]);
  const queuedFollowUpDispatchingRef = useRef(false);
  const skillLoadSequenceRef = useRef(0);
  const pluginLoadSequenceRef = useRef(0);
  const readLocalUnread = () =>
    readUnreadThreadIds(localStorage, backend.id);
  const readLocalPinned = () =>
    readPinnedThreadIds(localStorage, backend.id);
  const writeLocalUnread = (ids: Set<string>) => {
    writeUnreadThreadIds(localStorage, backend.id, ids);
  };
  const markThreadRead = (threadId: string) => {
    const unread = readLocalUnread();
    if (!unread.delete(threadId)) return;
    writeLocalUnread(unread);
    setThreads((current) =>
      current.map((thread) =>
        String(thread.id) === threadId
          ? { ...thread, isUnread: false }
          : thread,
      ),
    );
  };
  const markThreadUnread = (threadId: string) => {
    const unread = readLocalUnread();
    unread.add(threadId);
    writeLocalUnread(unread);
    setThreads((current) =>
      current.map((thread) =>
        String(thread.id) === threadId
          ? { ...thread, isUnread: true }
          : thread,
      ),
    );
  };
  const threadListLoaderRef = useRef<ReturnType<
    typeof createLatestThreadListLoader
  > | null>(null);
  const decorateThreads = (data: AnyRecord[]): AnyRecord[] => {
    const localUnread = readLocalUnread();
    return applyPinnedThreadState(data, readLocalPinned()).map((thread) => ({
      ...thread,
      isUnread: localUnread.has(String(thread.id)),
    }));
  };
  const decorateThread = (thread: AnyRecord): AnyRecord =>
    applyPinnedThreadState([thread], readLocalPinned())[0];
  const projectGroupIdOf = (thread: AnyRecord) =>
    thread.isProjectless === true
      ? PROJECTLESS_GROUP_ID
      : String(thread.cwd ?? "");
  if (!threadListLoaderRef.current) {
    threadListLoaderRef.current = createLatestThreadListLoader({
      onData(data) {
        setThreads(decorateThreads(data));
        setThreadListState("ready");
      },
      onProjectStart(cwd) {
        setProjectThreadStates((current) => ({
          ...current,
          [cwd]: "loading",
        }));
      },
      onProjectData(cwd, data, hasMore) {
        const nextProjectThreads = decorateThreads(data);
        setProjectHasMore((current) => ({
          ...current,
          [cwd]: fullyLoadedProjectCwdsRef.current.has(cwd) ? false : hasMore,
        }));
        setThreads((current) => {
          const currentProjectThreads = current.filter(
            (thread) => projectGroupIdOf(thread) === cwd,
          );
          const retainedExpandedThreads =
            fullyLoadedProjectCwdsRef.current.has(cwd)
              ? currentProjectThreads.filter(
                  (thread) =>
                    !nextProjectThreads.some(
                      (next) => String(next.id) === String(thread.id),
                    ),
                )
              : [];
          return [
            ...current.filter((thread) => projectGroupIdOf(thread) !== cwd),
            ...nextProjectThreads,
            ...retainedExpandedThreads,
          ];
        });
        setProjectThreadStates((current) => ({
          ...current,
          [cwd]: "ready",
        }));
        setThreadListState("ready");
      },
      onProjectError(cwd) {
        setProjectThreadStates((current) => ({
          ...current,
          [cwd]: "error",
        }));
      },
      onSettled() {
        setThreadListState("ready");
      },
    });
  }

  useEffect(() => {
    activeRef.current = active;
    setPendingSteerMessage((current) =>
      clearPendingSteerForTimeline(current, active),
    );
  }, [active]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    conversationVisibleRef.current = conversationVisible;
  }, [conversationVisible]);

  useEffect(() => {
    const client = clientRef.current;
    if (connection !== "online" || !client || !active) return;
    void loadSkillsForCwd(client, active.cwd ?? null);
    void loadPluginsForCwd(client, active.cwd ?? null);
  }, [active?.cwd, connection]);

  useEffect(
    () => () => {
      queuedFollowUpsRef.current.forEach((followUp) => {
        followUp.files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
      });
    },
    [],
  );

  async function loadThreads(client = clientRef.current) {
    if (!client || client !== clientRef.current) return;
    try {
      let directories = projects;
      let nextProjectlessThreadIds = mergeProjectlessThreadIds(
        projectlessThreadIds,
        readLocalProjectlessThreadIds(window.localStorage, backend.id),
      );
      try {
        const projectState = await fetchBackendProjectState(backend);
        directories = projectState.projects;
        nextProjectlessThreadIds = mergeProjectlessThreadIds(
          projectState.projectlessThreadIds,
          readLocalProjectlessThreadIds(window.localStorage, backend.id),
        );
        setProjects(directories);
        setProjectlessThreadIds(nextProjectlessThreadIds);
        if (directories.length || nextProjectlessThreadIds.length) {
          setThreadListState("ready");
        }
      } catch {
        if (directories.length || nextProjectlessThreadIds.length) {
          setThreadListState("ready");
        }
      }
      await threadListLoaderRef.current!.load(
        client,
        directories,
        nextProjectlessThreadIds,
      );
    } catch (reason) {
      setThreadListState((current) =>
        current === "loading" ? "error" : current,
      );
      throw reason;
    }
  }

  async function reconcileActiveThread(
    client: AppServerClient,
    isCurrent: () => boolean = () => true,
  ) {
    const threadId = String(
      activeThreadTargetRef.current ?? activeRef.current?.id ?? "",
    );
    if (!threadId || client !== clientRef.current) return;
    const discardPendingThrough = pendingSequenceRef.current;

    const latestTurns = await loadRecoverableRecentThreadTurns(
      client,
      threadId,
      () => threadNotificationSequenceRef.current,
    );
    if (
      client !== clientRef.current ||
      String(
        activeThreadTargetRef.current ?? activeRef.current?.id ?? "",
      ) !== threadId ||
      activeRef.current?.id !== threadId ||
      latestTurns == null ||
      !isCurrent()
    ) {
      return;
    }

    const lastTurn = latestTurns.at(-1);
    const running =
      ["inProgress", "in_progress", "running"].includes(
        String(lastTurn?.status ?? ""),
      ) || pendingSequenceRef.current > discardPendingThrough;
    setActive((current) =>
      current?.id === threadId
        ? {
            ...current,
            turns: reconcileRecentTurns(current.turns ?? [], latestTurns, {
              discardPendingThrough,
            }),
          }
        : current,
    );
    setBusy(running);
    setThreads((entries) =>
      entries.map((entry) =>
        entry.id === threadId
          ? {
              ...entry,
              status: { type: running ? "active" : "idle" },
            }
          : entry,
      ),
    );
  }

  useEffect(() => {
    if (
      activeThreadAccessMode !== "readOnly" ||
      !active?.id ||
      !conversationVisible ||
      conversationLoadState !== "ready"
    ) return;
    return bindReadOnlyThreadRefresh({
      refresh: async (isCurrent) => {
        const client = clientRef.current;
        if (client) await reconcileActiveThread(client, isCurrent);
      },
    });
  }, [
    active?.id,
    activeThreadAccessMode,
    conversationLoadState,
    conversationVisible,
  ]);

  useEffect(() => {
    const hasRunningThread = threads.some((thread) =>
      isThreadRunning(thread.status),
    );
    onSummaryChange({
      backendId: backend.id,
      connection,
      busy: busy || hasRunningThread,
      approvalCount: requests.length,
      error,
    });
  }, [
    backend.id,
    busy,
    connection,
    error,
    onSummaryChange,
    requests.length,
    threads,
  ]);

  useEffect(() => {
    onSnapshotChange({
      backendId: backend.id,
      threads,
      projects,
      projectlessThreadIds,
      projectThreadStates,
      projectHasMore,
      loadingProjectCwd,
      refreshing,
      threadListState,
      openingThreadId,
      error,
    });
  }, [
    backend.id,
    error,
    onSnapshotChange,
    openingThreadId,
    threadListState,
    threads,
    projects,
    projectlessThreadIds,
    projectThreadStates,
    projectHasMore,
    loadingProjectCwd,
    refreshing,
  ]);

  useEffect(() => {
    if (!refreshVersion) return;
    const sequence = ++refreshSequenceRef.current;
    fullyLoadedProjectCwdsRef.current.clear();
    setThreadListState((current) =>
      projects.length || projectlessThreadIds.length ? current : "loading",
    );
    setRefreshing(true);
    if (!clientRef.current) {
      connectionManagerRef.current?.reconnect(backend.id);
      return;
    }
    void loadThreads()
      .catch(() => undefined)
      .finally(() => {
        if (sequence === refreshSequenceRef.current) setRefreshing(false);
      });
  }, [refreshVersion]);

  useEffect(() => {
    let disposed = false;
    let manager: BackendConnectionManager;
    manager = new BackendConnectionManager({
      onConnection: (_backendId, status, connectionError) => {
        if (disposed) return;
        setConnection(status);
        if (status === "online") setError("");
        if (connectionError) setError(connectionError);
        if (status === "connecting") {
          clientRef.current = null;
        }
        if (status === "offline") {
          clientRef.current = null;
          skillLoadSequenceRef.current += 1;
          pluginLoadSequenceRef.current += 1;
          setSkillCatalog({ cwd: null, skills: [], loading: false });
          setPluginCatalog({ cwd: null, plugins: [], loading: false });
          setRefreshing(false);
          setBusy(false);
          setSteering(false);
          setPendingSteerMessage(null);
          setRequests([]);
          void fetchBackendHostInfo(backend).catch((reason) => {
            const message =
              reason instanceof Error ? reason.message : String(reason);
            if (
              message.includes(t("访问口令不正确")) ||
              message.includes(t("当前前端地址未被设备允许"))
            ) {
              manager.sync([]);
              setError(message);
            }
          });
        }
      },
      onNotification: (_backendId, message, source) => {
          const client = source as AppServerClient;
          const params = (message.params ?? {}) as AnyRecord;
          if (message.method === "skills/changed") {
            void loadSkillsForCwd(
              client,
              activeRef.current?.cwd ?? null,
              true,
            );
            void loadPluginsForCwd(client, activeRef.current?.cwd ?? null);
          }
          if (
            params.threadId &&
            params.threadId ===
              (activeThreadTargetRef.current ?? activeRef.current?.id)
          ) {
            threadNotificationSequenceRef.current += 1;
          }
          if (message.method === "turn/started" && params.turn) {
            if (params.threadId) {
              setThreads((current) => {
                const index = current.findIndex(
                  (thread) => thread.id === params.threadId,
                );
                if (index >= 0) {
                  return current.map((thread, threadIndex) =>
                    threadIndex === index
                      ? { ...thread, status: { type: "active" } }
                      : thread,
                  );
                }
                const opened = activeRef.current;
                return opened?.id === params.threadId
                  ? [{ ...opened, status: { type: "active" } }, ...current]
                  : current;
              });
            }
            setActive((current) => {
              if (!current) return current;
              const started = applyTurnStarted(current, params);
              if (started !== current) setBusy(true);
              return started;
            });
          }
          if (
            message.method === "thread/tokenUsage/updated" &&
            params.threadId &&
            params.tokenUsage
          ) {
            setTokenUsageByThread((current) => ({
              ...current,
              [params.threadId]: params.tokenUsage,
            }));
          }
          if (
            message.method === "account/rateLimits/updated" &&
            params.rateLimits
          ) {
            setRateLimits((current) => ({
              ...(current ?? {}),
              rateLimits: {
                ...(current?.rateLimits ?? {}),
                ...params.rateLimits,
              },
            }));
          }
          if (message.method === "item/agentMessage/delta" && params.delta) {
            setActive((current) => {
              if (!current || current.id !== params.threadId) return current;
              const copy = structuredClone(current);
              const turn = copy.turns?.find(
                (entry: AnyRecord) => entry.id === params.turnId,
              );
              const item = turn?.items?.find((entry: AnyRecord) => entry.id === params.itemId);
              if (!item) return current;
              if (item) item.text = `${item.text ?? ""}${params.delta}`;
              return copy;
            });
          }
          if (message.method === "item/started" && params.item) {
            setPendingSteerMessage((current) =>
              clearPendingSteerForItem(current, params),
            );
            setActive((current) =>
              current ? applyTurnItem(current, params) : current,
            );
          }
          if (message.method === "item/completed" && params.item) {
            setPendingSteerMessage((current) =>
              clearPendingSteerForItem(current, params),
            );
            setActive((current) =>
              current ? applyTurnItem(current, params) : current,
            );
          }
          if (
            message.method === "item/commandExecution/outputDelta" ||
            message.method === "item/fileChange/outputDelta" ||
            message.method === "item/reasoning/summaryTextDelta" ||
            message.method === "item/reasoning/textDelta"
          ) {
            const streamMethod = message.method ?? "";
            setActive((current) => {
              if (!current || current.id !== params.threadId) return current;
              const copy = structuredClone(current);
              const turn = copy.turns?.find(
                (entry: AnyRecord) => entry.id === params.turnId,
              );
              const item = turn?.items?.find((entry: AnyRecord) => entry.id === params.itemId);
              if (!item) return current;
              if (item) {
                const key = streamMethod.includes("commandExecution") || streamMethod.includes("fileChange")
                  ? "aggregatedOutput"
                  : "text";
                item[key] = `${item[key] ?? ""}${params.delta ?? ""}`;
              }
              return copy;
            });
          }
          if (message.method === "item/fileChange/patchUpdated") {
            setActive((current) =>
              current ? applyFileChangePatch(current, params) : current,
            );
          }
          if (message.method === "turn/diff/updated") {
            setActive((current) =>
              current ? applyTurnDiff(current, params) : current,
            );
          }
          if (message.method === "turn/completed") {
            if (params.threadId) {
              const threadId = String(params.threadId);
              const hasQueuedFollowUp = queuedFollowUpsRef.current.some(
                (followUp) => followUp.threadId === threadId,
              );
              const documentVisible =
                document.visibilityState === "visible";
              const needsAttention = shouldMarkThreadUnread({
                threadId,
                activeThreadId: String(activeRef.current?.id ?? ""),
                conversationVisible: conversationVisibleRef.current,
                documentVisible,
              });
              setPendingSteerMessage((current) =>
                clearPendingSteerForThread(current, threadId),
              );
              if (needsAttention && !hasQueuedFollowUp) {
                markThreadUnread(threadId);
              } else if (!hasQueuedFollowUp) {
                markThreadRead(threadId);
              }
              if (
                !hasQueuedFollowUp &&
                shouldNotifyRunCompleted({
                  threadId,
                  activeThreadId: String(activeRef.current?.id ?? ""),
                  conversationVisible: conversationVisibleRef.current,
                  documentVisible,
                })
              ) {
                notifyRunCompleted({
                  title: t("Codex 运行结束"),
                  body: completionThreadTitle({
                    threadId,
                    threads: threadsRef.current,
                    activeThread: activeRef.current,
                    fallback: t("新对话"),
                  }),
                  backendId: backend.id,
                  threadId,
                });
              }
              setThreads((current) =>
                current.map((thread) =>
                  String(thread.id) === threadId
                    ? { ...thread, status: { type: "idle" } }
                    : thread,
                ),
              );
            }
            setActive((current) => {
              if (!current) return current;
              const completed = applyCompletedTurn(current, params);
              if (completed === current) return current;
              setBusy(false);
              setSteering(false);
              return completed;
            });
            void loadThreads(client);
          }
          if (
            message.method === "thread/status/changed" &&
            params.threadId &&
            params.status
          ) {
            setThreads((current) =>
              current.map((thread) =>
                thread.id === params.threadId
                  ? { ...thread, status: params.status }
                  : thread,
              ),
            );
          }
          if (
            message.method === "thread/settings/updated" &&
            activeRef.current?.id === params.threadId
          ) {
            const settings = (params.threadSettings ?? {}) as AnyRecord;
            if (typeof settings.model === "string") setSelectedModel(settings.model);
            if ("effort" in settings) {
              setSelectedEffort(settings.effort ?? null);
            }
            if ("serviceTier" in settings) {
              setSelectedServiceTier(settings.serviceTier ?? null);
            }
            if (settings.approvalPolicy) {
              setSelectedApprovalPolicy(settings.approvalPolicy as ApprovalPolicy);
            }
            if (settings.approvalsReviewer) {
              setSelectedApprovalsReviewer(
                settings.approvalsReviewer as ApprovalsReviewer,
              );
            }
            if ("activePermissionProfile" in settings) {
              setSelectedPermission(settings.activePermissionProfile?.id ?? "");
            }
            setActiveSettingsSynchronized(true);
          }
      },
      onRequest: (_backendId, request, source) => {
          const client = source as AppServerClient;
          if (
            request.method === "item/commandExecution/requestApproval" ||
            request.method === "item/fileChange/requestApproval" ||
            request.method === "item/permissions/requestApproval" ||
            request.method === "item/tool/requestUserInput"
          ) {
            setRequests((current) => [...current, request]);
          } else {
            client.respondError(
              request.id!,
              -32601,
              t("Codex Mobile Web 暂不支持服务器请求：{method}", {
                method: request.method ?? "unknown",
              }),
            );
          }
      },
      onReady: (_backendId, source) => {
        const client = source as AppServerClient;
        clientRef.current = client;
        void loadSkillsForCwd(client, activeRef.current?.cwd ?? null);
        void loadPluginsForCwd(client, activeRef.current?.cwd ?? null);
        void (async () => {
          try {
            if (!disposed && manager.client(backend.id) === source) {
            const [
              modelResult,
              permissionResult,
              configResult,
              rateLimitResult,
            ] = await Promise.all([
              client.request<{ data: AnyRecord[] }>("model/list", {
                limit: 100,
                includeHidden: false,
              }),
              client.request<{ data: AnyRecord[] }>("permissionProfile/list", {
                limit: 100,
                cwd: null,
              }),
              client
                .request<{ config: AnyRecord }>("config/read", {
                  cwd: null,
                  includeLayers: false,
                })
                .catch(() => ({ config: {} })),
              client
                .request<AnyRecord>("account/rateLimits/read", undefined)
                .catch(() => null),
            ]);
            if (disposed || manager.client(backend.id) !== source) return;
            const availableProfiles = permissionResult.data.filter(
              (profile) => profile.allowed,
            );
            const config = (configResult.config ?? {}) as AnyRecord;
            const configuredModel =
              config.model ||
              modelResult.data.find((model) => model.isDefault)?.model ||
              modelResult.data[0]?.model ||
              "";
            const configuredCatalog = modelResult.data.find(
              (model) => model.model === configuredModel,
            );
            const normalized = normalizeModelSettings(
              configuredCatalog,
              config.model_reasoning_effort,
              config.service_tier,
            );
            const sandboxProfileId =
              config.sandbox_mode === "workspace-write"
                ? ":workspace"
                : typeof config.sandbox_mode === "string"
                  ? `:${config.sandbox_mode}`
                  : "";
            const configuredPermission =
              availableProfiles.find((profile) => profile.id === sandboxProfileId)
                ?.id ||
              availableProfiles.find((profile) => profile.id === ":workspace")?.id ||
              availableProfiles.find((profile) => profile.id === ":read-only")?.id ||
              availableProfiles[0]?.id ||
              "";
            setModels(modelResult.data);
            setRateLimits(rateLimitResult);
            setPermissionProfiles(availableProfiles);
            setSelectedModel((current) => current || configuredModel);
            setSelectedEffort((current) => current ?? normalized.effort);
            setSelectedServiceTier(
              (current) => current ?? normalized.serviceTier,
            );
            setSelectedPermission((current) => current || configuredPermission);
            setSelectedApprovalPolicy(
              (current) =>
                config.approval_policy ||
                (configuredPermission === ":danger-full-access"
                  ? "never"
                  : current),
            );
            setSelectedApprovalsReviewer(
              (current) => config.approvals_reviewer || current,
            );
            await loadThreads(client);
            if (disposed || manager.client(backend.id) !== source) return;
            setRefreshing(false);
            const currentThread = activeRef.current;
            if (currentThread?.id) {
              activeThreadTargetRef.current = currentThread.id;
              const resumed = await resumeThreadSession(client, currentThread.id);
              if (
                !disposed &&
                manager.client(backend.id) === source &&
                activeRef.current?.id === currentThread.id
              ) {
                const resumedSettings = normalizeModelSettings(
                  modelResult.data.find(
                    (model) => model.model === resumed.model,
                  ),
                  resumed.reasoningEffort,
                  resumed.serviceTier,
                );
                setActive({
                  ...decorateThread(resumed.thread),
                  ...(currentThread.isProjectless === true
                    ? { isProjectless: true }
                    : {}),
                });
                resetOlderTurns(resumed.nextTurnsCursor);
                setConversationLoadState("ready");
                setConversationLoadError("");
                setActiveSettingsSynchronized(resumed.settingsSynchronized);
                setActiveThreadAccessMode(resumed.accessMode);
                setActiveThreadResumeError(resumed.resumeError ?? "");
                setSelectedModel(resumed.model ?? "");
                setSelectedEffort(resumedSettings.effort);
                setSelectedServiceTier(resumedSettings.serviceTier);
                if (resumed.approvalPolicy) {
                  setSelectedApprovalPolicy(resumed.approvalPolicy);
                }
                if (resumed.approvalsReviewer) {
                  setSelectedApprovalsReviewer(resumed.approvalsReviewer);
                }
                setSelectedPermission(resumed.activePermissionProfile?.id ?? "");
                const lastTurn = resumed.thread.turns?.at(-1);
                setBusy(
                  ["inProgress", "in_progress", "running"].includes(lastTurn?.status),
                );
              }
            }
          }
          } catch (reason) {
            if (
              !disposed &&
              manager.client(backend.id) === source
            ) {
              setRefreshing(false);
              setError(
                reason instanceof Error ? reason.message : String(reason),
              );
              if (manager.client(backend.id) === source) {
                manager.socket(backend.id)?.close(
                  1011,
                  "workspace initialization failed",
                );
              }
            }
          }
        })();
      },
    });
    connectionManagerRef.current = manager;
    manager.sync([backend]);
    const unbindConnectionRecovery = bindConnectionRecovery({
      reconnect: () =>
        recoverBackendConnection(
          clientRef.current,
          () =>
            reconnectAndWaitUntilReady(
              () => manager.reconnect(backend.id),
              () => disposed || clientRef.current != null,
            ),
          reconcileActiveThread,
        ),
    });
    return () => {
      disposed = true;
      unbindConnectionRecovery();
      manager.close();
      if (connectionManagerRef.current === manager) {
        connectionManagerRef.current = null;
      }
      clientRef.current = null;
    };
  }, [backend.baseUrl, backend.id, backend.token]);

  function invalidateImageReads() {
    imageReadGenerationRef.current.invalidate();
    setImageReading(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  async function loadSkillsForCwd(
    client: AppServerClient,
    cwd: string | null,
    forceReload = false,
  ) {
    const sequence = ++skillLoadSequenceRef.current;
    setSkillCatalog((current) => ({
      cwd,
      skills: current.cwd === cwd ? current.skills : [],
      loading: true,
    }));
    try {
      const skills = await listInstalledSkills(client, cwd, forceReload);
      if (
        sequence === skillLoadSequenceRef.current &&
        client === clientRef.current &&
        (activeRef.current?.cwd ?? null) === cwd
      ) {
        setSkillCatalog({ cwd, skills, loading: false });
      }
    } catch {
      if (
        sequence === skillLoadSequenceRef.current &&
        client === clientRef.current &&
        (activeRef.current?.cwd ?? null) === cwd
      ) {
        setSkillCatalog({ cwd, skills: [], loading: false });
      }
    }
  }

  async function loadPluginsForCwd(
    client: AppServerClient,
    cwd: string | null,
  ) {
    const sequence = ++pluginLoadSequenceRef.current;
    setPluginCatalog((current) => ({
      cwd,
      plugins: current.cwd === cwd ? current.plugins : [],
      loading: true,
    }));
    try {
      const plugins = await listInstalledPlugins(client, cwd);
      if (
        sequence === pluginLoadSequenceRef.current &&
        client === clientRef.current &&
        (activeRef.current?.cwd ?? null) === cwd
      ) {
        setPluginCatalog({ cwd, plugins, loading: false });
      }
    } catch {
      if (
        sequence === pluginLoadSequenceRef.current &&
        client === clientRef.current &&
        (activeRef.current?.cwd ?? null) === cwd
      ) {
        setPluginCatalog({ cwd, plugins: [], loading: false });
      }
    }
  }

  function replaceQueuedFollowUps(next: QueuedFollowUp[]) {
    queuedFollowUpsRef.current = next;
    setQueuedFollowUps(next);
  }

  function clearQueuedFollowUps() {
    queuedFollowUpsRef.current.forEach((followUp) => {
      followUp.files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    });
    replaceQueuedFollowUps([]);
    queuedFollowUpDispatchingRef.current = false;
  }

  function discardHistoricalMessageEdit() {
    setHistoryEdit(null);
  }

  function resetDraftContext() {
    draftContextGenerationRef.current += 1;
    invalidateImageReads();
    setPendingSteerMessage(null);
    clearQueuedFollowUps();
    discardHistoricalMessageEdit();
  }

  function resetOlderTurns(cursor: string | null = null) {
    olderTurnsGenerationRef.current += 1;
    olderTurnsLoadingRef.current = false;
    olderTurnsCursorRef.current = cursor;
    setOlderTurnsState(cursor ? "idle" : "exhausted");
  }

  async function loadOlderTurns() {
    const client = clientRef.current;
    const threadId = String(activeRef.current?.id ?? "");
    const cursor = olderTurnsCursorRef.current;
    if (olderTurnsLoadingRef.current) return true;
    if (!client || !threadId || !cursor) {
      return false;
    }

    const generation = olderTurnsGenerationRef.current;
    olderTurnsLoadingRef.current = true;
    setOlderTurnsState("loading");
    try {
      const page = await loadOlderThreadTurns(client, threadId, cursor);
      if (
        generation !== olderTurnsGenerationRef.current ||
        String(activeRef.current?.id ?? "") !== threadId
      ) {
        return false;
      }
      setActive((current) =>
        current && String(current.id) === threadId
          ? {
              ...current,
              turns: prependUniqueTurns(
                current.turns ?? [],
                page.turns,
              ),
            }
          : current,
      );
      olderTurnsCursorRef.current = page.nextCursor;
      setOlderTurnsState(page.nextCursor ? "idle" : "exhausted");
      return true;
    } catch {
      if (
        generation === olderTurnsGenerationRef.current &&
        String(activeRef.current?.id ?? "") === threadId
      ) {
        setOlderTurnsState("error");
      }
      return false;
    } finally {
      if (generation === olderTurnsGenerationRef.current) {
        olderTurnsLoadingRef.current = false;
      }
    }
  }

  async function loadThreadDetail(threadId: string, sequence: number) {
    const client = clientRef.current;
    try {
      if (!client) throw new Error(t("设备尚未连接，请稍后重试"));
      const session = await resumeThreadSession(client, threadId);
      if (sequence !== openSequenceRef.current) {
        if (activeThreadTargetRef.current !== threadId) {
          void client
            .request("thread/unsubscribe", { threadId })
            .catch(() => undefined);
        }
        return;
      }
      if (!session.thread?.id) {
        throw new Error(t("会话详情返回无效，请重试"));
      }
      const resumedSettings = normalizeModelSettings(
        models.find((model) => model.model === session.model),
        session.reasoningEffort,
        session.serviceTier,
      );
      setActive({
        ...decorateThread(session.thread),
        ...(activeRef.current?.isProjectless === true
          ? { isProjectless: true }
          : {}),
      });
      resetOlderTurns(session.nextTurnsCursor);
      setActiveSettingsSynchronized(session.settingsSynchronized);
      setActiveThreadAccessMode(session.accessMode);
      setActiveThreadResumeError(session.resumeError ?? "");
      setSelectedModel(session.model ?? "");
      setSelectedEffort(resumedSettings.effort);
      setSelectedServiceTier(resumedSettings.serviceTier);
      if (session.approvalPolicy) {
        setSelectedApprovalPolicy(session.approvalPolicy);
      }
      if (session.approvalsReviewer) {
        setSelectedApprovalsReviewer(session.approvalsReviewer);
      }
      setSelectedPermission(session.activePermissionProfile?.id ?? "");
      setConversationLoadState("ready");
      setConversationLoadError("");
      const lastTurn = session.thread.turns?.at(-1);
      setBusy(
        ["inProgress", "in_progress", "running"].includes(lastTurn?.status),
      );

      if (session.thread.cwd) {
        void client
          .request<{ data: AnyRecord[] }>("permissionProfile/list", {
            limit: 100,
            cwd: session.thread.cwd,
          })
          .then((result) => {
            if (sequence === openSequenceRef.current) {
              setPermissionProfiles(result.data.filter((profile) => profile.allowed));
            }
          })
          .catch(() => undefined);
      }
    } catch (reason) {
      if (sequence === openSequenceRef.current) {
        setBusy(false);
        setSteering(false);
        setConversationLoadState("error");
        setConversationLoadError(
          reason instanceof Error ? reason.message : String(reason),
        );
      }
    } finally {
      if (sequence === openSequenceRef.current) setOpeningThreadId("");
    }
  }

  const projectOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ cwd: string; name: string }> = [];
    for (const cwd of projects) {
      const normalized = cwd.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      options.push({
        cwd: normalized,
        name:
          normalized.replace(/\/+$/, "").split("/").filter(Boolean).at(-1) ||
          normalized,
      });
    }
    for (const thread of threads) {
      if (thread.isProjectless === true) continue;
      const cwd =
        typeof thread.cwd === "string" ? thread.cwd.trim() : "";
      if (!cwd || seen.has(cwd)) continue;
      seen.add(cwd);
      options.push({
        cwd,
        name: cwd.replace(/\/+$/, "").split("/").filter(Boolean).at(-1) || cwd,
      });
    }
    return options;
  }, [projects, threads]);

  function openThread(thread: AnyRecord) {
    const sequence = ++openSequenceRef.current;
    markThreadRead(String(thread.id));
    resetDraftContext();
    setDraft("");
    setDraftImages([]);
    setDraftFiles((current) => {
      current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
      return [];
    });
    setOpeningThreadId(thread.id);
    setError("");
    setBusy(false);
    setStartingThreadContext(null);
    setNewChatPermissionMode(null);
    setSteering(false);
    setConversationLoadError("");
    setConversationLoadState("loading");
    setActiveThreadAccessMode("interactive");
    setActiveThreadResumeError("");
    resetOlderTurns();
    activeThreadTargetRef.current = thread.id;
    setActive({
      ...thread,
      turns: thread.turns ?? [],
    });
    void loadThreadDetail(thread.id, sequence);
  }

  function retryThreadDetail() {
    const threadId = activeRef.current?.id;
    if (!threadId) return;
    const sequence = ++openSequenceRef.current;
    activeThreadTargetRef.current = threadId;
    setOpeningThreadId(threadId);
    setConversationLoadError("");
    setConversationLoadState("loading");
    resetOlderTurns();
    void loadThreadDetail(threadId, sequence);
  }

  function followUpPreviewText(
    text: string,
    images: DraftImage[],
    files: DraftFile[],
  ) {
    return (
      text ||
      (files.length
        ? t("{count} 个文件", { count: files.length })
        : t("{count} 张图片", { count: images.length }))
    );
  }

  async function startTurnMessage({
    text,
    pendingImages,
    pendingFiles,
    pendingSkills,
    pendingPlugins,
    draftContext,
    onFailure,
  }: {
    text: string;
    pendingImages: DraftImage[];
    pendingFiles: DraftFile[];
    pendingSkills: InstalledSkill[];
    pendingPlugins: InstalledPlugin[];
    draftContext: number;
    onFailure: () => void;
  }) {
    const client = clientRef.current;
    if (!client) {
      if (draftContext === draftContextGenerationRef.current) {
        onFailure();
        setError(t("设备尚未连接，请稍后重试"));
      }
      return false;
    }
    setBusy(true);
    const initialThread = activeRef.current;
    if (!initialThread?.id) setStartingThreadContext(draftContext);
    const pendingTurnId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let thread = initialThread;
    const startingProjectless = !thread?.id && !thread?.cwd;
    let sent = false;
    try {
      setImageReading(Boolean(pendingFiles.length));
      const uploadedFiles = await Promise.all(
        pendingFiles.map((file) => uploadFile(backend, file.file)),
      );
      const shouldSendSettings = !thread?.id || activeSettingsSynchronized;
      const effectivePermission =
        !thread?.id && newChatPermissionMode
          ? newChatPermissionMode.permissions
          : selectedPermission;
      const effectiveApprovalPolicy =
        !thread?.id && newChatPermissionMode
          ? newChatPermissionMode.approvalPolicy
          : selectedApprovalPolicy;
      const effectiveApprovalsReviewer =
        !thread?.id && newChatPermissionMode
          ? newChatPermissionMode.approvalsReviewer
          : selectedApprovalsReviewer;
      if (!thread?.id) {
        const started = await client.request<{
          thread: AnyRecord;
          model?: string;
          reasoningEffort?: string | null;
          serviceTier?: string | null;
          approvalPolicy?: ApprovalPolicy;
          approvalsReviewer?: ApprovalsReviewer;
          activePermissionProfile?: { id: string } | null;
        }>("thread/start", {
          cwd: thread?.cwd ?? null,
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(selectedServiceTier ? { serviceTier: selectedServiceTier } : {}),
          ...(effectivePermission ? { permissions: effectivePermission } : {}),
          approvalPolicy: effectiveApprovalPolicy,
          approvalsReviewer: effectiveApprovalsReviewer,
        });
        thread = startingProjectless
          ? { ...started.thread, isProjectless: true }
          : started.thread;
        if (startingProjectless) {
          setProjectlessThreadIds((current) => {
            const next = mergeProjectlessThreadIds(current, [String(thread!.id)]);
            writeLocalProjectlessThreadIds(
              window.localStorage,
              backend.id,
              next,
            );
            return next;
          });
          setProjectThreadStates((current) => ({
            ...current,
            [PROJECTLESS_GROUP_ID]: "ready",
          }));
          setProjectHasMore((current) => ({
            ...current,
            [PROJECTLESS_GROUP_ID]: false,
          }));
        }
        activeThreadTargetRef.current = thread.id;
        setThreads((current) => [
          { ...thread!, status: { type: "active" } },
          ...current.filter((entry) => entry.id !== thread!.id),
        ]);
        const startedModel = started.model || selectedModel;
        const startedSettings = normalizeModelSettings(
          models.find((model) => model.model === startedModel),
          started.reasoningEffort ?? selectedEffort,
          started.serviceTier ?? selectedServiceTier,
        );
        if (draftContext === draftContextGenerationRef.current) {
          setStartingThreadContext(null);
          if (started.model) setSelectedModel(started.model);
          setSelectedEffort(startedSettings.effort);
          setSelectedServiceTier(startedSettings.serviceTier);
          if (started.approvalPolicy) {
            setSelectedApprovalPolicy(started.approvalPolicy);
          }
          if (started.approvalsReviewer) {
            setSelectedApprovalsReviewer(started.approvalsReviewer);
          }
          if (started.activePermissionProfile?.id) {
            setSelectedPermission(started.activePermissionProfile.id);
          }
          setActiveSettingsSynchronized(true);
          setActive(thread);
        }
      }
      const localItem = {
        id: `local-${pendingTurnId}`,
        type: "userMessage",
        content: buildOptimisticUserContent(text, pendingImages, uploadedFiles),
      };
      const pendingSequence = ++pendingSequenceRef.current;
      if (draftContext === draftContextGenerationRef.current) {
        setActive((current) => {
          if (!current || current.id !== thread!.id) return current;
          return {
            ...current,
            turns: [
              ...(current.turns ?? thread!.turns ?? []),
              {
                ...createPendingTurn(
                  pendingTurnId,
                  localItem,
                  pendingSequence,
                ),
              },
            ],
          };
        });
      }
      const startedTurn = await client.request<{ turn: AnyRecord }>("turn/start", {
        threadId: thread.id,
        input: buildTurnInput(
          text,
          pendingImages,
          uploadedFiles,
          pendingSkills,
          pendingPlugins,
        ),
        ...(shouldSendSettings && selectedModel ? { model: selectedModel } : {}),
        ...(shouldSendSettings && selectedEffort
          ? { effort: selectedEffort }
          : {}),
        ...(shouldSendSettings && selectedServiceTier
          ? { serviceTier: selectedServiceTier }
          : {}),
        ...(shouldSendSettings && effectivePermission
          ? { permissions: effectivePermission }
          : {}),
        ...(shouldSendSettings
          ? {
              approvalPolicy: effectiveApprovalPolicy,
              approvalsReviewer: effectiveApprovalsReviewer,
            }
          : {}),
      });
      sent = true;
      if (draftContext === draftContextGenerationRef.current) {
        setActive((current) => {
          if (!current) return current;
          return applyTurnStarted(current, {
            threadId: thread!.id,
            turn: startedTurn.turn,
          });
        });
      }
    } catch (reason) {
      if (thread?.id) {
        setThreads((current) =>
          current.map((entry) =>
            entry.id === thread!.id
              ? { ...entry, status: { type: "idle" } }
              : entry,
          ),
        );
        void loadThreads().catch(() => undefined);
      }
      if (draftContext === draftContextGenerationRef.current) {
        setBusy(false);
        setStartingThreadContext(null);
        setActive((current) =>
          current && current.id === thread?.id
            ? removePendingTurn(current, pendingTurnId)
            : current,
        );
        onFailure();
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (draftContext === draftContextGenerationRef.current) {
        setImageReading(false);
      }
    }
    if (sent && draftContext === draftContextGenerationRef.current) {
      pendingFiles.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    }
    return sent;
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (active?.id && activeThreadAccessMode !== "interactive") return;
    const text = draft.trim();
    const pendingImages = draftImages;
    const pendingFiles = draftFiles;
    const pendingSkills = skillsReferencedInText(
      text,
      skillCatalog.cwd === (active?.cwd ?? null) ? skillCatalog.skills : [],
    );
    const pendingPlugins = pluginsReferencedInText(
      text,
      pluginCatalog.cwd === (active?.cwd ?? null) ? pluginCatalog.plugins : [],
    );
    if (
      imageReading ||
      (!text && !pendingImages.length && !pendingFiles.length) ||
      !clientRef.current
    ) {
      return;
    }
    const draftContext = draftContextGenerationRef.current;
    const conversationBusy = active?.id
      ? busy
      : startingThreadContext === draftContextGenerationRef.current;
    if (conversationBusy) {
      const threadId = String(active?.id ?? "");
      if (!threadId) {
        setError(t("当前任务正在启动，请稍后再排队"));
        return;
      }
      const queuedFollowUp: QueuedFollowUp = {
        id: `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        threadId,
        draftContext,
        inputText: text,
        text: followUpPreviewText(text, pendingImages, pendingFiles),
        images: pendingImages,
        files: pendingFiles,
        skills: pendingSkills,
        plugins: pendingPlugins,
      };
      requestRunCompletionNotificationPermission();
      invalidateImageReads();
      setDraft("");
      setDraftImages([]);
      setDraftFiles([]);
      replaceQueuedFollowUps([
        ...queuedFollowUpsRef.current,
        queuedFollowUp,
      ]);
      setError("");
      return;
    }
    requestRunCompletionNotificationPermission();
    invalidateImageReads();
    setDraft("");
    setDraftImages([]);
    setDraftFiles([]);
    setError("");
    await startTurnMessage({
      text,
      pendingImages,
      pendingFiles,
      pendingSkills,
      pendingPlugins,
      draftContext,
      onFailure: () => {
        setDraft((current) => current || text);
        setDraftImages((current) => mergeDraftImages(current, pendingImages));
        setDraftFiles((current) =>
          current.length ? current : pendingFiles,
        );
      },
    });
  }

  function beginHistoricalMessageEdit(target: HistoricalMessageEditTarget) {
    const thread = activeRef.current;
    const threadId = String(thread?.id ?? "");
    const currentTarget = createHistoricalMessageEditTarget(
      thread?.turns ?? [],
      target.turnId,
    );
    const hasQueuedMessage = queuedFollowUpsRef.current.some(
      (followUp) => followUp.threadId === threadId,
    );
    if (
      !threadId ||
      !currentTarget ||
      currentTarget.messageId !== target.messageId ||
      activeThreadAccessMode !== "interactive" ||
      busy ||
      steering ||
      imageReading ||
      hasQueuedMessage ||
      !clientRef.current
    ) {
      setError(t("当前会话正忙或有排队消息，暂时不能编辑历史消息"));
      return;
    }
    invalidateImageReads();
    setHistoryEdit({
      threadId,
      target: currentTarget,
      text: currentTarget.text,
      submitting: false,
      reverted: false,
    });
    setError("");
  }

  function changeHistoricalMessageEditText(text: string) {
    setHistoryEdit((current) =>
      current && !current.submitting ? { ...current, text } : current,
    );
  }

  function cancelHistoricalMessageEdit() {
    const session = historyEdit;
    if (!session || session.submitting) return;
    setHistoryEdit(null);
    setError("");
  }

  async function submitHistoricalMessageEdit() {
    const session = historyEdit;
    const client = clientRef.current;
    const thread = activeRef.current;
    const threadId = String(thread?.id ?? "");
    const hasQueuedMessage = queuedFollowUpsRef.current.some(
      (followUp) => followUp.threadId === threadId,
    );
    if (!session || session.submitting) return;
    if (
      !client ||
      !thread ||
      !threadId ||
      threadId !== session.threadId ||
      activeThreadAccessMode !== "interactive" ||
      busy ||
      steering ||
      imageReading ||
      hasQueuedMessage
    ) {
      setError(t("当前会话正忙或有排队消息，暂时不能编辑历史消息"));
      return;
    }

    const text = session.text.trim();
    let target = session.target;
    let retainedTurns = [...(thread.turns ?? [])];
    if (!session.reverted) {
      const currentTarget = createHistoricalMessageEditTarget(
        thread.turns ?? [],
        session.target.turnId,
      );
      if (!currentTarget || currentTarget.messageId !== session.target.messageId) {
        setError(t("目标消息已变化，请刷新后重试"));
        return;
      }
      target = currentTarget;
      retainedTurns = retainedTurns.slice(
        0,
        retainedTurns.length - currentTarget.rollbackTurnCount,
      );
    }

    const input = buildEditedHistoryInput(target, text);
    const referencedSkills = skillsReferencedInText(
      text,
      skillCatalog.cwd === (thread.cwd ?? null) ? skillCatalog.skills : [],
    );
    for (const skill of referencedSkills) {
      if (
        !input.some(
          (part) => part.type === "skill" && String(part.path ?? "") === skill.path,
        )
      ) {
        input.push({ type: "skill", name: skill.name, path: skill.path });
      }
    }
    const referencedPlugins = pluginsReferencedInText(
      text,
      pluginCatalog.cwd === (thread.cwd ?? null) ? pluginCatalog.plugins : [],
    );
    for (const plugin of referencedPlugins) {
      const mention = pluginMentionInput(plugin);
      if (
        !input.some(
          (part) =>
            part.type === "mention" && String(part.path ?? "") === mention.path,
        )
      ) {
        input.push(mention);
      }
    }
    if (!input.length) {
      setError(t("历史消息不能为空"));
      return;
    }

    setHistoryEdit((current) =>
      current ? { ...current, submitting: true } : current,
    );
    setBusy(true);
    setError("");
    requestRunCompletionNotificationPermission();
    const pendingTurnId =
      `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let reverted = session.reverted;
    let pendingAdded = false;
    try {
      let workingThread = thread;
      if (!reverted) {
        const revertedResult = await revertHistoricalMessage(
          client,
          threadId,
          target,
        );
        const revertedThread =
          (revertedResult.response as { thread?: AnyRecord } | null)?.thread;
        const revertedTurnsCursor =
          (revertedResult.response as { turnsBackwardsCursor?: string | null } | null)
            ?.turnsBackwardsCursor ?? null;
        workingThread = {
          ...thread,
          ...(revertedThread ?? {}),
          id: threadId,
          turns: retainedTurns,
          ...(thread.isProjectless === true ? { isProjectless: true } : {}),
        };
        reverted = true;
        activeRef.current = workingThread;
        setActive(workingThread);
        resetOlderTurns(
          revertedResult.method === "thread/revert"
            ? revertedTurnsCursor
            : null,
        );
        setHistoryEdit((current) =>
          current && current.threadId === threadId
            ? {
                ...current,
                target: { ...target, hasLaterTurns: false },
                reverted: true,
                submitting: true,
              }
            : current,
        );
      }

      const localItem = {
        id: `local-${pendingTurnId}`,
        type: "userMessage",
        content: input,
      };
      const pendingTurn = createPendingTurn(
        pendingTurnId,
        localItem,
        ++pendingSequenceRef.current,
      );
      const pendingThread = {
        ...workingThread,
        turns: [...(workingThread.turns ?? retainedTurns), pendingTurn],
      };
      pendingAdded = true;
      activeRef.current = pendingThread;
      setActive(pendingThread);

      const shouldSendSettings = activeSettingsSynchronized;
      const startedTurn = await client.request<{ turn: AnyRecord }>(
        "turn/start",
        {
          threadId,
          input,
          ...(shouldSendSettings && selectedModel
            ? { model: selectedModel }
            : {}),
          ...(shouldSendSettings && selectedEffort
            ? { effort: selectedEffort }
            : {}),
          ...(shouldSendSettings && selectedServiceTier
            ? { serviceTier: selectedServiceTier }
            : {}),
          ...(shouldSendSettings && selectedPermission
            ? { permissions: selectedPermission }
            : {}),
          ...(shouldSendSettings
            ? {
                approvalPolicy: selectedApprovalPolicy,
                approvalsReviewer: selectedApprovalsReviewer,
              }
            : {}),
        },
      );
      setActive((current) => {
        if (!current || String(current.id) !== threadId) return current;
        const next = applyTurnStarted(current, {
          threadId,
          turn: startedTurn.turn,
        });
        activeRef.current = next;
        return next;
      });
      setHistoryEdit(null);
    } catch (reason) {
      setBusy(false);
      if (pendingAdded) {
        setActive((current) => {
          if (!current || String(current.id) !== threadId) return current;
          const next = removePendingTurn(current, pendingTurnId);
          activeRef.current = next;
          return next;
        });
      }
      setHistoryEdit((current) =>
        current && current.threadId === threadId
          ? {
              ...current,
              target: reverted
                ? { ...target, hasLaterTurns: false }
                : current.target,
              reverted,
              submitting: false,
            }
          : current,
      );
      setError(reason instanceof Error ? reason.message : String(reason));
      if (reverted) retryThreadDetail();
    }
  }

  async function actOnQueuedFollowUp(id: string) {
    const followUp = queuedFollowUpsRef.current.find(
      (entry) => entry.id === id,
    );
    if (!followUp) return;
    if (!busy) {
      replaceQueuedFollowUps(
        queuedFollowUpsRef.current.map((entry) =>
          entry.id === id ? { ...entry, failed: false } : entry,
        ),
      );
      return;
    }
    const thread = activeRef.current;
    const threadId = String(thread?.id ?? "");
    const turnId = activeTurnId(thread);
    const client = clientRef.current;
    if (
      !threadId ||
      threadId !== followUp.threadId ||
      !turnId ||
      !client ||
      steering
    ) {
      return;
    }
    const originalIndex = queuedFollowUpsRef.current.findIndex(
      (entry) => entry.id === id,
    );
    replaceQueuedFollowUps(
      queuedFollowUpsRef.current.filter((entry) => entry.id !== id),
    );
    const clientUserMessageId =
      `steer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setSteering(true);
    setPendingSteerMessage({
      id: clientUserMessageId,
      threadId,
      text: followUp.text,
    });
    setError("");
    let sent = false;
    try {
      const uploadedFiles = await Promise.all(
        followUp.files.map((file) => uploadFile(backend, file.file)),
      );
      await client.request(
        "turn/steer",
        buildTurnSteerParams({
          threadId,
          turnId,
          input: buildTurnInput(
            followUp.inputText,
            followUp.images,
            uploadedFiles,
            followUp.skills,
            followUp.plugins,
          ),
          clientUserMessageId,
        }),
      );
      sent = true;
    } catch (reason) {
      setPendingSteerMessage((current) =>
        clearPendingSteerForRequest(current, clientUserMessageId),
      );
      if (followUp.draftContext === draftContextGenerationRef.current) {
        const next = queuedFollowUpsRef.current.filter(
          (entry) => entry.id !== followUp.id,
        );
        next.splice(Math.min(originalIndex, next.length), 0, followUp);
        replaceQueuedFollowUps(next);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (followUp.draftContext === draftContextGenerationRef.current) {
        setSteering(false);
      }
    }
    if (sent && followUp.draftContext === draftContextGenerationRef.current) {
      followUp.files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    }
  }

  useEffect(() => {
    const followUp = queuedFollowUps[0];
    if (
      busy ||
      steering ||
      queuedFollowUpDispatchingRef.current ||
      !followUp ||
      followUp.failed ||
      connection !== "online" ||
      conversationLoadState !== "ready" ||
      activeThreadAccessMode !== "interactive" ||
      String(active?.id ?? "") !== followUp.threadId ||
      !clientRef.current
    ) {
      return;
    }
    queuedFollowUpDispatchingRef.current = true;
    replaceQueuedFollowUps(
      queuedFollowUpsRef.current.filter((entry) => entry.id !== followUp.id),
    );
    void startTurnMessage({
      text: followUp.inputText,
      pendingImages: followUp.images,
      pendingFiles: followUp.files,
      pendingSkills: followUp.skills,
      pendingPlugins: followUp.plugins,
      draftContext: followUp.draftContext,
      onFailure: () => {
        replaceQueuedFollowUps([
          { ...followUp, failed: true },
          ...queuedFollowUpsRef.current.filter(
            (entry) => entry.id !== followUp.id,
          ),
        ]);
      },
    }).finally(() => {
      queuedFollowUpDispatchingRef.current = false;
    });
  }, [
    active?.id,
    activeThreadAccessMode,
    busy,
    connection,
    conversationLoadState,
    queuedFollowUps,
    steering,
  ]);

  async function selectImages(files: FileList | null) {
    if (
      !files?.length ||
      historyEdit ||
      (active?.id && activeThreadAccessMode !== "interactive")
    ) return;
    const generation = imageReadGenerationRef.current.begin();
    const existingBytes = draftImages.reduce(
      (total, image) => total + image.size,
      0,
    );
    setImageReading(true);
    try {
      const selected = Array.from(files);
      const imageFiles = selected.filter(isNativeImageFile);
      const attachmentFiles = selected.filter((file) => !isNativeImageFile(file));
      const result = await prepareImageFiles(
        imageFiles,
        draftImages.length,
        undefined,
        existingBytes,
      );
      if (!imageReadGenerationRef.current.isCurrent(generation)) return;
      const attachmentResult = prepareAttachmentFiles(
        attachmentFiles,
        draftFiles.length,
      );
      setDraftImages((current) => mergeDraftImages(current, result.images));
      setDraftFiles((current) => [...current, ...attachmentResult.files].slice(0, 4));
      const errors = [...result.errors, ...attachmentResult.errors];
      if (errors.length) setError(errors.join("；"));
      else setError("");
    } finally {
      if (imageReadGenerationRef.current.isCurrent(generation)) {
        setImageReading(false);
      }
    }
  }

  async function interrupt() {
    if (activeThreadAccessMode !== "interactive") return;
    const turn = active?.turns?.at(-1);
    if (!turn) return;
    await clientRef.current?.request("turn/interrupt", { threadId: active!.id, turnId: turn.id });
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(
      () => setNotice((current) => (current === message ? "" : current)),
      1800,
    );
  }

  async function duplicateManagedThread(
    client: AppServerClient,
    sourceThread: AnyRecord,
  ) {
    const sourceThreadId = String(sourceThread.id ?? "");
    const forkedThread = await duplicateThread(client, sourceThreadId);
    const { turns: _turns, ...rawMetadata } = forkedThread;
    const isProjectless =
      sourceThread.isProjectless === true ||
      projectlessThreadIds.includes(sourceThreadId);
    const duplicated = decorateThread({
      ...rawMetadata,
      name: rawMetadata.name ?? sourceThread.name,
      preview: rawMetadata.preview ?? sourceThread.preview,
      cwd: rawMetadata.cwd ?? sourceThread.cwd,
      ...(isProjectless ? { isProjectless: true } : {}),
    });
    const duplicatedId = String(duplicated.id);

    if (isProjectless) {
      setProjectlessThreadIds((current) => {
        const next = mergeProjectlessThreadIds(current, [duplicatedId]);
        writeLocalProjectlessThreadIds(localStorage, backend.id, next);
        return next;
      });
      setProjectThreadStates((current) => ({
        ...current,
        [PROJECTLESS_GROUP_ID]: "ready",
      }));
    }
    setThreads((current) => [
      duplicated,
      ...current.filter((entry) => String(entry.id) !== duplicatedId),
    ]);
    showNotice(t("已复制会话"));
  }

  async function manageListedThread(
    thread: AnyRecord,
    action: ThreadManagementAction,
    name?: string,
  ) {
    const client = clientRef.current;
    const threadId = String(thread.id ?? "");
    if (!threadId || pendingAction) return false;
    if (!client) {
      setError(t("设备尚未连接，请稍后重试"));
      return false;
    }
    setPendingAction(action);
    setError("");
    try {
      if (action === "pin") {
        const nextPinned = thread.isPinned !== true;
        const result = await setThreadPinned(client, threadId, nextPinned);
        const refreshed = result.thread;
        writeThreadPinned(
          localStorage,
          backend.id,
          threadId,
          result.persistence === "local" ? nextPinned : false,
        );
        setThreads((current) =>
          current.map((entry) =>
            String(entry.id) === threadId
              ? { ...entry, isPinned: refreshed.isPinned }
              : entry,
          ),
        );
        setActive((current) =>
          String(current?.id ?? "") === threadId
            ? { ...current, isPinned: refreshed.isPinned }
            : current,
        );
        showNotice(refreshed.isPinned ? t("已置顶") : t("已取消置顶"));
        return true;
      }
      if (action === "refresh") {
        const result = await client.request<{ thread: AnyRecord }>(
          "thread/read",
          { threadId, includeTurns: false },
        );
        if (!result.thread?.id) {
          throw new Error(t("会话详情返回无效，请重试"));
        }
        const { turns: _turns, ...rawMetadata } = result.thread;
        const metadata = decorateThread(rawMetadata);
        setThreads((current) =>
          current.map((entry) =>
            String(entry.id) === threadId
              ? {
                  ...entry,
                  ...metadata,
                  isPinned: metadata.isPinned === true,
                }
              : entry,
          ),
        );
        setActive((current) =>
          String(current?.id ?? "") === threadId
            ? {
                ...current,
                ...metadata,
                isPinned: metadata.isPinned === true,
              }
            : current,
        );
        showNotice(t("已刷新"));
        return true;
      }
      if (action === "duplicate") {
        await duplicateManagedThread(client, thread);
        return true;
      }
      if (action === "rename") {
        if (!name) return false;
        await client.request("thread/name/set", { threadId, name });
        setThreads((current) =>
          current.map((entry) =>
            String(entry.id) === threadId ? { ...entry, name } : entry,
          ),
        );
        setActive((current) =>
          String(current?.id ?? "") === threadId
            ? { ...current, name }
            : current,
        );
        showNotice(t("已重命名"));
        return true;
      }
      await client.request("thread/archive", { threadId });
      markThreadRead(threadId);
      writeThreadPinned(localStorage, backend.id, threadId, false);
      setThreads((current) =>
        current.filter((entry) => String(entry.id) !== threadId),
      );
      const archivedThreadStillOpen =
        String(activeThreadTargetRef.current ?? activeRef.current?.id ?? "") ===
        threadId;
      setActive((current) => activeThreadAfterArchive(current, threadId));
      if (archivedThreadStillOpen) {
        activeThreadTargetRef.current = null;
        setConversationLoadState("idle");
        onOpenSidebar();
      }
      showNotice(t("已归档"));
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : action === "archive"
            ? t("归档失败，请重试")
            : action === "duplicate"
              ? t("复制会话失败，请重试")
              : action === "rename"
                ? t("重命名失败，请重试")
                : action === "refresh"
                  ? t("刷新失败，请重试")
                  : thread.isPinned === true
                    ? t("取消置顶失败，请重试")
                    : t("置顶失败，请重试"),
      );
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function duplicateActiveThread() {
    const thread = activeRef.current;
    if (!thread || activeThreadAccessMode !== "interactive") return false;
    return manageListedThread(thread, "duplicate");
  }

  async function togglePinned() {
    const client = clientRef.current;
    const thread = activeRef.current;
    if (
      !client ||
      !thread?.id ||
      pendingAction ||
      activeThreadAccessMode !== "interactive"
    ) return false;
    const nextPinned = thread.isPinned !== true;
    setPendingAction("pin");
    setError("");
    try {
      const result = await setThreadPinned(
        client,
        thread.id,
        nextPinned,
      );
      const refreshed = result.thread;
      writeThreadPinned(
        localStorage,
        backend.id,
        String(thread.id),
        result.persistence === "local" ? nextPinned : false,
      );
      const persistedPinned = refreshed.isPinned;
      setThreads((current) =>
        current.map((entry) =>
          entry.id === thread.id
            ? { ...entry, isPinned: persistedPinned }
            : entry,
        ),
      );
      setActive((current) =>
        current?.id === thread.id
          ? { ...current, isPinned: persistedPinned }
          : current,
      );
      showNotice(persistedPinned ? t("已置顶") : t("已取消置顶"));
      return true;
    } catch {
      setError(nextPinned ? t("置顶失败，请重试") : t("取消置顶失败，请重试"));
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function renameThread() {
    const client = clientRef.current;
    const thread = activeRef.current;
    if (
      !client ||
      !thread?.id ||
      pendingAction ||
      activeThreadAccessMode !== "interactive"
    ) return false;
    const name = window.prompt(t("输入新的会话名称"), titleOf(thread))?.trim();
    if (!name || name === titleOf(thread)) return false;
    setPendingAction("rename");
    setError("");
    try {
      await client.request("thread/name/set", {
        threadId: thread.id,
        name,
      });
      setThreads((current) =>
        current.map((entry) =>
          entry.id === thread.id ? { ...entry, name } : entry,
        ),
      );
      setActive((current) =>
        current?.id === thread.id ? { ...current, name } : current,
      );
      showNotice(t("已重命名"));
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("重命名失败，请重试"),
      );
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function archiveThread() {
    const client = clientRef.current;
    const thread = activeRef.current;
    if (
      !client ||
      !thread?.id ||
      pendingAction ||
      activeThreadAccessMode !== "interactive"
    ) return false;
    setPendingAction("archive");
    setError("");
    try {
      await client.request("thread/archive", { threadId: thread.id });
      markThreadRead(String(thread.id));
      writeThreadPinned(localStorage, backend.id, String(thread.id), false);
      setThreads((current) =>
        current.filter((entry) => entry.id !== thread.id),
      );
      const archivedThreadStillOpen =
        activeThreadTargetRef.current === thread.id;
      setActive((current) =>
        activeThreadAfterArchive(current, thread.id),
      );
      if (archivedThreadStillOpen) {
        activeThreadTargetRef.current = null;
        setConversationLoadState("idle");
        onOpenSidebar();
      }
      showNotice(t("已归档"));
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("归档失败，请重试"),
      );
      return false;
    } finally {
      setPendingAction("");
    }
  }

  const selectedModelEntry =
    models.find((model) => model.model === selectedModel) ?? null;
  const selectedModelLabel =
    !activeSettingsSynchronized && active?.id
      ? t("沿用线程模型")
      : selectedModelEntry?.displayName ||
        selectedModel ||
        t("默认模型");
  const effortOptions = effortOptionsForModel(selectedModelEntry);
  const speedOptions = speedOptionsForModel(selectedModelEntry);
  const selectedSpeedLabel =
    speedOptions.find((option) => option.id === selectedServiceTier)?.label ??
    t("正常");
  const permissionModes = permissionModesFromProfiles(
    permissionProfiles as Array<{ id: string; allowed?: boolean }>,
  );
  const effectivePermissionMode =
    !active?.id && newChatPermissionMode
      ? newChatPermissionMode
      : null;
  const selectedPermissionModeId = permissionModeFromSettings(
    effectivePermissionMode?.permissions ?? selectedPermission,
    effectivePermissionMode?.approvalPolicy ?? selectedApprovalPolicy,
    effectivePermissionMode?.approvalsReviewer ?? selectedApprovalsReviewer,
  );
  const selectedPermissionMode = permissionModes.find(
    (mode) => mode.id === selectedPermissionModeId,
  );
  const selectedPermissionLabel =
    !activeSettingsSynchronized && active?.id
      ? t("沿用线程权限")
      : selectedPermissionMode?.label ??
        permissionProfileLabel(
          selectedPermission,
          permissionProfiles.find(
            (profile) => profile.id === selectedPermission,
          )?.description,
        );
  const chooseModel = (modelId: string) => {
    const model = models.find((option) => option.model === modelId);
    const normalized = normalizeModelSettings(
      model,
      selectedEffort,
      selectedServiceTier,
    );
    setSelectedModel(modelId);
    setSelectedEffort(normalized.effort);
    setSelectedServiceTier(normalized.serviceTier);
  };
  const choosePermissionMode = (modeId: PermissionModeId) => {
    const mode = permissionModes.find((option) => option.id === modeId);
    if (!mode) return;
    setSelectedPermission(mode.permissions);
    setSelectedApprovalPolicy(mode.approvalPolicy);
    setSelectedApprovalsReviewer(mode.approvalsReviewer);
    if (!active?.id) setNewChatPermissionMode(mode);
    setPicker(null);
  };
  const approval = requests[0] ?? null;
  const finishRequest = (decision: "accept" | "decline") => {
    if (!approval) return;
    const params = (approval.params ?? {}) as AnyRecord;
    if (approval.method === "item/permissions/requestApproval") {
      const requested = (params.permissions ?? {}) as AnyRecord;
      const granted = {
        ...(requested.fileSystem != null ? { fileSystem: requested.fileSystem } : {}),
        ...(requested.network != null ? { network: requested.network } : {}),
      };
      clientRef.current?.respond(approval.id!, {
        permissions: decision === "accept" ? granted : {},
        scope: "turn",
      });
    } else {
      clientRef.current?.respond(approval.id!, { decision });
    }
    setRequests((current) => current.slice(1));
  };
  const answerQuestions = () => {
    if (!approval) return;
    const questions = ((approval.params as AnyRecord)?.questions ?? []) as AnyRecord[];
    clientRef.current?.respond(approval.id!, {
      answers: Object.fromEntries(
        questions.map((question) => [question.id, { answers: [userAnswers[question.id] ?? ""] }]),
      ),
    });
    setUserAnswers({});
    setRequests((current) => current.slice(1));
  };

  const startNewChat = (
    cwd: string | null = null,
    nextDraft = "",
    nextDraftImages: DraftImage[] = [],
    nextDraftFiles: DraftFile[] = [],
  ) => {
    const savedCwd = window.localStorage.getItem(
      `codex-mobile:new-chat-project:${backend.id}`,
    );
    const selectedCwd =
      (typeof cwd === "string"
        ? cwd || null
        : savedCwd === ""
          ? null
          : projectOptions.find((project) => project.cwd === savedCwd)?.cwd ||
            projectOptions[0]?.cwd ||
            null);
    openSequenceRef.current += 1;
    activeThreadTargetRef.current = null;
    resetDraftContext();
    const defaultPermissionMode =
      defaultNewChatPermissionMode(
        permissionProfiles as Array<{ id: string; allowed?: boolean }>,
      );
    setOpeningThreadId("");
    setBusy(false);
    setStartingThreadContext(null);
    setSteering(false);
    setImageReading(false);
    setError("");
    setDraft(nextDraft);
    setDraftImages(nextDraftImages);
    setDraftFiles(nextDraftFiles);
    setConversationLoadState("ready");
    setConversationLoadError("");
    resetOlderTurns();
    setActiveSettingsSynchronized(true);
    setActiveThreadAccessMode("interactive");
    setActiveThreadResumeError("");
    if (defaultPermissionMode) {
      setNewChatPermissionMode(defaultPermissionMode);
      setSelectedPermission(defaultPermissionMode.permissions);
      setSelectedApprovalPolicy(defaultPermissionMode.approvalPolicy);
      setSelectedApprovalsReviewer(defaultPermissionMode.approvalsReviewer);
    }
    setActive({
      id: "",
      turns: [],
      preview: t("新对话"),
      cwd: selectedCwd,
    });
  };

  const chooseNewChatProject = (cwd: string) => {
    window.localStorage.setItem(
      `codex-mobile:new-chat-project:${backend.id}`,
      cwd,
    );
    setActive((current) =>
      current && !current.id ? { ...current, cwd: cwd || null } : current,
    );
  };

  async function loadAllProjectThreads(cwd: string) {
    const client = clientRef.current;
    if (!client) return;
    setLoadingProjectCwd(cwd);
    try {
      const all = await loadAllProjectThreadRecords(client, cwd);
      fullyLoadedProjectCwdsRef.current.add(cwd);
      setProjectHasMore((current) => ({ ...current, [cwd]: false }));
      setThreads((current) => [
        ...current.filter((thread) => thread.cwd !== cwd),
        ...decorateThreads(
          all.filter(
            (thread) => !projectlessThreadIds.includes(String(thread.id)),
          ),
        ),
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingProjectCwd((current) => (current === cwd ? "" : current));
    }
  }

  async function loadAllProjectlessThreads() {
    const client = clientRef.current;
    if (!client) return;
    setLoadingProjectCwd(PROJECTLESS_GROUP_ID);
    try {
      const all = await loadAllProjectlessThreadRecords(
        client,
        projectlessThreadIds,
      );
      setProjectHasMore((current) => ({
        ...current,
        [PROJECTLESS_GROUP_ID]: false,
      }));
      setThreads((current) => [
        ...current.filter(
          (thread) => projectGroupIdOf(thread) !== PROJECTLESS_GROUP_ID,
        ),
        ...decorateThreads(all),
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingProjectCwd((current) =>
        current === PROJECTLESS_GROUP_ID ? "" : current,
      );
    }
  }

  const handledCommandRef = useRef(0);
  useEffect(() => {
    if (
      !command ||
      command.backendId !== backend.id ||
      command.id === handledCommandRef.current
    ) {
      return;
    }
    handledCommandRef.current = command.id;
    if (command.type === "open" && command.thread) {
      openThread(command.thread);
    } else if (command.type === "new") {
      startNewChat(
        command.cwd ?? null,
        command.draft ?? "",
        command.draftImages ?? [],
        command.draftFiles ?? [],
      );
    } else if (command.type === "load-project" && command.cwd) {
      if (command.cwd === PROJECTLESS_GROUP_ID) {
        void loadAllProjectlessThreads();
      } else {
        void loadAllProjectThreads(command.cwd);
      }
    } else if (command.type === "retry-project" && command.cwd) {
      const client = clientRef.current;
      if (client) {
        if (command.cwd === PROJECTLESS_GROUP_ID) {
          void threadListLoaderRef.current!.loadProjectless(
            client,
            projectlessThreadIds,
          );
        } else {
          void threadListLoaderRef.current!.loadProject(client, command.cwd);
        }
      }
    } else if (
      command.type === "manage" &&
      command.thread &&
      command.managementAction
    ) {
      void manageListedThread(
        command.thread,
        command.managementAction,
        command.name,
      ).then((completed) => command.onComplete?.(completed));
    }
  }, [backend.id, command, projectOptions, projectlessThreadIds]);

  const conversationBusy = active?.id
    ? busy
    : startingThreadContext === draftContextGenerationRef.current;

  return (
    <main className="app-shell">
      {active ? (
        <ConversationPage
          active={active}
          backendId={backend.id}
          backendName={backend.name}
          backends={backends.filter((entry) => entry.enabled)}
          projectOptions={projectOptions}
          loadState={conversationLoadState}
          loadError={conversationLoadError}
          olderTurnsState={olderTurnsState}
          connection={connection}
          client={clientRef.current}
          error={error}
          draft={draft}
          draftImages={draftImages}
          draftFiles={draftFiles}
          imageReading={imageReading}
          busy={conversationBusy}
          steering={steering}
          steerable={Boolean(activeTurnId(active))}
          pendingSteerText={
            pendingSteerMessage?.threadId === String(active.id)
              ? pendingSteerMessage.text
              : ""
          }
          queuedFollowUps={queuedFollowUps.filter(
            (followUp) => followUp.threadId === String(active.id),
          )}
          accessMode={activeThreadAccessMode}
          resumeError={activeThreadResumeError}
          tokenUsage={tokenUsageByThread[active.id] ?? null}
          rateLimits={rateLimits}
          pendingAction={pendingAction}
          selectedServiceTier={selectedServiceTier}
          selectedModelLabel={selectedModelLabel}
          selectedEffort={selectedEffort}
          selectedPermissionLabel={selectedPermissionLabel}
          skills={
            skillCatalog.cwd === (active.cwd ?? null)
              ? skillCatalog.skills
              : []
          }
          skillsLoading={
            skillCatalog.cwd === (active.cwd ?? null) && skillCatalog.loading
          }
          plugins={
            pluginCatalog.cwd === (active.cwd ?? null)
              ? pluginCatalog.plugins
              : []
          }
          pluginsLoading={
            pluginCatalog.cwd === (active.cwd ?? null) && pluginCatalog.loading
          }
          imageInputRef={imageInputRef}
          onBack={onOpenSidebar}
          onNewChatBackendChange={(backendId) =>
            onSwitchNewChatBackend(backendId, draft, draftImages, draftFiles)
          }
          onNewChatProjectChange={chooseNewChatProject}
          onPin={togglePinned}
          onDuplicate={duplicateActiveThread}
          onRename={renameThread}
          onArchive={archiveThread}
          onRetry={retryThreadDetail}
          onLoadOlderTurns={loadOlderTurns}
          onSubmit={send}
          onRemoveImage={(imageId) =>
            setDraftImages((current) =>
              current.filter((entry) => entry.id !== imageId),
            )
          }
          onRemoveFile={(fileId) =>
            setDraftFiles((current) => {
              const removed = current.find((entry) => entry.id === fileId);
              if (removed) URL.revokeObjectURL(removed.previewUrl);
              return current.filter((entry) => entry.id !== fileId);
            })
          }
          onSelectImages={selectImages}
          onOpenAgentSettings={() => setPicker("agent")}
          onOpenPermissionSettings={() => setPicker("permission")}
          onDraftChange={setDraft}
          historyEdit={historyEdit}
          onEditUserMessage={beginHistoricalMessageEdit}
          onHistoryEditTextChange={changeHistoricalMessageEditText}
          onCancelHistoryEdit={cancelHistoricalMessageEdit}
          onSubmitHistoryEdit={submitHistoricalMessageEdit}
          onInterrupt={interrupt}
          onQueuedFollowUpAction={actOnQueuedFollowUp}
        />
      ) : (
        <section className="conversation conversation-empty">
          <header className="conversation-header">
            <button
              className="round-button"
              aria-label={t("打开会话列表")}
              onClick={onOpenSidebar}
            >
              <AppIcon name="menu" />
            </button>
            <div className="thread-heading">
              <strong>Codex Mobile</strong>
              <span>
                <i className={`status-dot ${connection}`} />
                {backend.name}
              </span>
            </div>
          </header>
          <div className="empty-state">{t("从会话列表选择对话")}</div>
        </section>
      )}
      {notice && (
        <div className="notice-banner" role="status">
          {notice}
        </div>
      )}
      <ApprovalSheet
        approval={approval}
        userAnswers={userAnswers}
        onAnswerChange={(questionId, value) =>
          setUserAnswers((current) => ({
            ...current,
            [questionId]: value,
          }))
        }
        onSubmitAnswers={answerQuestions}
        onDecision={finishRequest}
      />
      <ComposerSettings
        picker={picker}
        effortOptions={effortOptions}
        speedOptions={speedOptions}
        permissionModes={permissionModes}
        models={models}
        selectedEffort={selectedEffort}
        selectedModel={selectedModel}
        selectedModelLabel={selectedModelLabel}
        selectedServiceTier={selectedServiceTier}
        selectedSpeedLabel={selectedSpeedLabel}
        selectedPermissionModeId={selectedPermissionModeId}
        onPickerChange={setPicker}
        onChooseEffort={setSelectedEffort}
        onChooseModel={chooseModel}
        onChooseSpeed={setSelectedServiceTier}
        onChoosePermissionMode={choosePermissionMode}
      />
    </main>
  );
}

export function App() {
  useI18n();
  const [initialRegistry] = useState<BackendRegistry>(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    const initial = loadBackendRegistry(
      window.localStorage,
      window.location.origin,
      token,
    );
    if (initial.backends.length) {
      saveBackendRegistry(window.localStorage, initial);
    }
    return initial;
  });
  return <AppBootstrap initialRegistry={initialRegistry} />;
}

export function AppBootstrap({
  initialRegistry,
}: {
  initialRegistry: BackendRegistry;
}) {
  const [registry, setRegistry] = useState(initialRegistry);
  const [managerOpen, setManagerOpen] = useState(
    !initialRegistry.backends.length,
  );
  const appUpdate = useAppUpdate();

  if (registry.backends.length) {
    return (
      <ConfiguredApp
        initialRegistry={registry}
        appUpdate={appUpdate}
      />
    );
  }

  return (
    <main className="app-shell">
      <section className="empty-state">
        <h1>Codex Mobile</h1>
        <p>{t("添加设备后即可连接 Codex。")}</p>
        <button
          className="backend-add-device"
          type="button"
          onClick={() => setManagerOpen(true)}
        >
          {t("添加设备")}
        </button>
      </section>
      <BackendManagerSheet
        open={managerOpen}
        registry={registry}
        summaries={{}}
        onChange={(next) => {
          saveBackendRegistry(window.localStorage, next);
          setRegistry(next);
        }}
        onClose={() => setManagerOpen(false)}
        appUpdate={{
          supported: appUpdate.supported,
          currentVersion: appUpdate.state.currentVersion,
          checking: appUpdate.state.phase === "checking",
          status:
            appUpdate.state.phase === "current"
              ? t("已是最新版本")
              : appUpdate.state.phase === "error"
                ? appUpdate.state.error
                : undefined,
          onCheck: () => void appUpdate.check(true),
        }}
      />
      <AppUpdateSheet
        open={appUpdate.sheetOpen}
        state={appUpdate.state}
        onClose={() => appUpdate.setSheetOpen(false)}
        onInstall={appUpdate.install}
        onRetry={appUpdate.install}
      />
    </main>
  );
}

function ConfiguredApp({
  initialRegistry,
  appUpdate,
}: {
  initialRegistry: BackendRegistry;
  appUpdate: AppUpdateController;
}) {
  const [registry, setRegistry] = useState(initialRegistry);
  const [summaries, setSummaries] = useState<
    Record<string, BackendRuntimeSummary>
  >({});
  const [managerOpen, setManagerOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<
    Record<string, BackendThreadSnapshot>
  >({});
  const [listBackendId, setListBackendId] = useState(
    () =>
      window.localStorage.getItem("codex-mobile:list-backend") || "all",
  );
  const [query, setQuery] = useState("");
  const [projectVisibleCounts, setProjectVisibleCounts] = useState<
    Record<string, number>
  >({});
  const [collapsedProjectKeys, setCollapsedProjectKeys] = useState(() =>
    readCollapsedProjectKeys(window.localStorage),
  );
  const [command, setCommand] = useState<WorkspaceCommand | null>(null);
  const [pendingCompletionTarget, setPendingCompletionTarget] =
    useState<RunCompletionNavigationTarget | null>(null);
  const commandIdRef = useRef(0);
  const edgeTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const resetListExpansion = useCallback(() => {
    setProjectVisibleCounts({});
  }, []);
  const {
    sidebarOpen,
    refreshVersion,
    openSidebar,
    closeSidebar,
    refresh: refreshAllBackends,
  } = useSidebarRefresh(resetListExpansion);
  const selectListBackend = useCallback((backendId: string) => {
    window.localStorage.setItem("codex-mobile:list-backend", backendId);
    setListBackendId(backendId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    for (const backend of registry.backends) {
      if (!backend.enabled || backend.hostId) continue;
      void fetchBackendHostInfo(backend)
        .then((host) => {
          if (cancelled || !host.hostId.trim()) return;
          setRegistry((current) => {
            const target = current.backends.find(
              (entry) => entry.id === backend.id,
            );
            if (
              !target ||
              target.hostId ||
              target.baseUrl !== backend.baseUrl
            ) {
              return current;
            }
            const next = assignBackendHostId(
              current,
              backend.id,
              host.hostId,
            );
            if (next === current) return current;
            saveBackendRegistry(window.localStorage, next);
            return next;
          });
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [registry.backends]);

  useEffect(() => {
    if (
      sidebarOpen &&
      !(window.history.state as AnyRecord | null)?.codexMobileSidebar
    ) {
      window.history.pushState(
        {
          ...(window.history.state ?? {}),
          codexMobileSidebar: true,
        },
        "",
      );
    }
  }, [sidebarOpen]);

  useEffect(() => {
    const handlePopState = () => {
      if (sidebarOpen) closeSidebar();
    };
    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      edgeTouchStartRef.current =
        !sidebarOpen && touch && touch.clientX <= 24
          ? { x: touch.clientX, y: touch.clientY }
          : null;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const start = edgeTouchStartRef.current;
      const touch = event.touches[0];
      if (!start || !touch) return;
      if (Math.abs(touch.clientY - start.y) > 44) {
        edgeTouchStartRef.current = null;
        return;
      }
      if (touch.clientX - start.x < 56) return;
      edgeTouchStartRef.current = null;
      openSidebar();
    };
    const handleTouchEnd = () => {
      edgeTouchStartRef.current = null;
    };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [closeSidebar, openSidebar, sidebarOpen]);

  const enabledBackends = useMemo(
    () => registry.backends.filter((backend) => backend.enabled),
    [registry.backends],
  );
  const mountedBackends = useMemo(
    () =>
      enabledBackends.length
        ? enabledBackends
        : registry.backends.slice(0, 1),
    [enabledBackends, registry.backends],
  );
  const selectedBackend =
    mountedBackends.find(
      (backend) => backend.id === registry.selectedBackendId,
    ) ?? mountedBackends[0];

  useEffect(() => {
    if (
      listBackendId !== "all" &&
      !mountedBackends.some((backend) => backend.id === listBackendId)
    ) {
      selectListBackend("all");
    }
  }, [listBackendId, mountedBackends, selectListBackend]);

  const persistRegistry = useCallback((next: BackendRegistry) => {
    saveBackendRegistry(window.localStorage, next);
    setRegistry(
      loadBackendRegistry(window.localStorage, window.location.origin),
    );
  }, []);

  const selectBackend = useCallback((backendId: string) => {
    setRegistry((current) => {
      const target = current.backends.find(
        (backend) => backend.id === backendId && backend.enabled,
      );
      if (!target || current.selectedBackendId === backendId) return current;
      const next = { ...current, selectedBackendId: backendId };
      saveBackendRegistry(window.localStorage, next);
      return next;
    });
  }, []);

  const updateSummary = useCallback((summary: BackendRuntimeSummary) => {
    setSummaries((current) => {
      const previous = current[summary.backendId];
      if (
        previous &&
        previous.connection === summary.connection &&
        previous.busy === summary.busy &&
        previous.approvalCount === summary.approvalCount &&
        previous.error === summary.error
      ) {
        return current;
      }
      return { ...current, [summary.backendId]: summary };
    });
  }, []);

  const updateSnapshot = useCallback((snapshot: BackendThreadSnapshot) => {
    setSnapshots((current) => {
      const previous = current[snapshot.backendId];
      if (
        previous &&
        previous.threads === snapshot.threads &&
        previous.projects === snapshot.projects &&
        previous.projectlessThreadIds === snapshot.projectlessThreadIds &&
        previous.projectThreadStates === snapshot.projectThreadStates &&
        previous.projectHasMore === snapshot.projectHasMore &&
        previous.loadingProjectCwd === snapshot.loadingProjectCwd &&
        previous.refreshing === snapshot.refreshing &&
        previous.threadListState === snapshot.threadListState &&
        previous.openingThreadId === snapshot.openingThreadId &&
        previous.error === snapshot.error
      ) {
        return current;
      }
      return { ...current, [snapshot.backendId]: snapshot };
    });
  }, []);

  const aggregatedThreads = useMemo(
    () =>
      aggregateThreads(
        mountedBackends,
        Object.fromEntries(
          mountedBackends.map((backend) => [
            backend.id,
            snapshots[backend.id]?.threads ?? [],
          ]),
        ),
      ),
    [mountedBackends, snapshots],
  );
  const scopedThreads = useMemo(
    () =>
      filterAggregatedThreads(
        listBackendId === "all"
          ? aggregatedThreads
          : aggregatedThreads.filter(
              (thread) => thread.backendId === listBackendId,
            ),
        query,
        listBackendId === "all",
      ),
    [aggregatedThreads, listBackendId, query],
  );
  const scopedSnapshots =
    listBackendId === "all"
      ? mountedBackends.map((backend) => snapshots[backend.id]).filter(Boolean)
      : [snapshots[listBackendId]].filter(Boolean);
  const scopedThreadCount =
    listBackendId === "all"
      ? aggregatedThreads.length
      : aggregatedThreads.filter(
          (thread) => thread.backendId === listBackendId,
        ).length;
  const threadListState: ThreadListState = scopedSnapshots.some(
    (snapshot) => snapshot.threadListState === "ready",
  )
    ? "ready"
    : scopedSnapshots.length &&
        scopedSnapshots.every(
          (snapshot) => snapshot.threadListState === "error",
        )
      ? "error"
      : "loading";
  const listError = scopedSnapshots
    .map((snapshot) => snapshot.error)
    .filter(Boolean)
    .join("；");
  const openingThreadId =
    scopedSnapshots
      .filter((snapshot) => snapshot.openingThreadId)
      .map(
        (snapshot) =>
          `${snapshot.backendId}:${snapshot.openingThreadId}`,
      )[0] ?? "";
  const projectDirectories =
    listBackendId === "all" ? [] : snapshots[listBackendId]?.projects ?? [];
  const hasProjectlessThreads =
    listBackendId !== "all" &&
    Boolean(snapshots[listBackendId]?.projectlessThreadIds.length);
  const projectThreadStates =
    listBackendId === "all"
      ? {}
      : snapshots[listBackendId]?.projectThreadStates ?? {};
  const projectHasMore =
    listBackendId === "all"
      ? {}
      : snapshots[listBackendId]?.projectHasMore ?? {};
  const loadingBackendIds = new Set(
    Object.values(snapshots)
      .filter((snapshot) =>
        Object.values(snapshot.projectThreadStates ?? {}).some(
          (state) => state === "loading",
        ),
      )
      .map((snapshot) => snapshot.backendId),
  );
  const refreshing = enabledBackends.some(
    (backend) => snapshots[backend.id]?.refreshing,
  );
  const loadingProjectKeys = new Set(
    Object.values(snapshots)
      .filter((snapshot) => snapshot.loadingProjectCwd)
      .map(
        (snapshot) =>
          `${snapshot.backendId}:${snapshot.loadingProjectCwd}`,
      ),
  );

  const toggleProject = useCallback(
    (backendId: string, cwd: string) => {
      const key = `${backendId}:${cwd}`;
      setProjectVisibleCounts((current) => ({
        ...current,
        [key]: Number.MAX_SAFE_INTEGER,
      }));
      setCommand({
        id: ++commandIdRef.current,
        backendId,
        type: "load-project",
        cwd,
      });
    },
    [],
  );

  const toggleProjectCollapsed = useCallback(
    (backendId: string, cwd: string) => {
      const key = projectCollapseKey(backendId, cwd);
      setCollapsedProjectKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        writeCollapsedProjectKeys(window.localStorage, next);
        return next;
      });
    },
    [],
  );

  const retryProject = useCallback((backendId: string, cwd: string) => {
    setCommand({
      id: ++commandIdRef.current,
      backendId,
      type: "retry-project",
      cwd,
    });
  }, []);

  const openThread = useCallback(
    (item: AggregatedThreadItem) => {
      selectBackend(item.backendId);
      setCommand({
        id: ++commandIdRef.current,
        backendId: item.backendId,
        type: "open",
        thread: item.thread,
      });
      closeSidebar();
    },
    [closeSidebar, selectBackend],
  );

  useEffect(
    () => bindRunCompletionNavigation(setPendingCompletionTarget),
    [],
  );

  useEffect(() => {
    if (!pendingCompletionTarget) return;
    const backend = mountedBackends.find(
      (entry) => entry.id === pendingCompletionTarget.backendId,
    );
    if (!backend) {
      setPendingCompletionTarget(null);
      return;
    }
    if (summaries[backend.id]?.connection !== "online") return;
    const thread = snapshots[backend.id]?.threads.find(
      (entry) => String(entry.id) === pendingCompletionTarget.threadId,
    ) ?? { id: pendingCompletionTarget.threadId };
    selectBackend(backend.id);
    setCommand({
      id: ++commandIdRef.current,
      backendId: backend.id,
      type: "open",
      thread,
    });
    closeSidebar();
    setPendingCompletionTarget(null);
  }, [
    closeSidebar,
    mountedBackends,
    pendingCompletionTarget,
    selectBackend,
    snapshots,
    summaries,
  ]);

  const manageThread = useCallback(
    (item: AggregatedThreadItem, action: ThreadManagementAction) => {
      let name: string | undefined;
      if (action === "rename") {
        name = window.prompt(
          t("输入新的会话名称"),
          titleOf(item.thread),
        )?.trim();
        if (!name || name === titleOf(item.thread)) {
          return Promise.resolve(false);
        }
      }
      return new Promise<boolean>((resolve) => {
        setCommand({
          id: ++commandIdRef.current,
          backendId: item.backendId,
          type: "manage",
          thread: item.thread,
          managementAction: action,
          name,
          onComplete: resolve,
        });
      });
    },
    [],
  );

  const startNewChat = useCallback(() => {
    const savedBackendId = window.localStorage.getItem(
      "codex-mobile:new-chat-backend",
    );
    const backendId =
      listBackendId === "all"
        ? mountedBackends.find(
            (backend) => backend.id === savedBackendId,
          )?.id ??
          selectedBackend?.id ??
          mountedBackends[0]?.id
        : listBackendId;
    if (!backendId) return;
    window.localStorage.setItem("codex-mobile:new-chat-backend", backendId);
    selectBackend(backendId);
    setCommand({
      id: ++commandIdRef.current,
      backendId,
      type: "new",
      cwd: null,
    });
    closeSidebar();
  }, [
    closeSidebar,
    listBackendId,
    mountedBackends,
    selectBackend,
    selectedBackend?.id,
  ]);

  const switchNewChatBackend = useCallback(
    (
      backendId: string,
      currentDraft: string,
      currentDraftImages: DraftImage[],
      currentDraftFiles: DraftFile[],
    ) => {
      const target = mountedBackends.find(
        (backend) => backend.id === backendId,
      );
      if (!target) return;
      window.localStorage.setItem("codex-mobile:new-chat-backend", backendId);
      selectBackend(backendId);
      setCommand({
        id: ++commandIdRef.current,
        backendId,
        type: "new",
        cwd: null,
        draft: currentDraft,
        draftImages: currentDraftImages,
        draftFiles: currentDraftFiles,
      });
    },
    [mountedBackends, selectBackend],
  );

  if (!selectedBackend) {
    return <main className="app-shell"><div className="empty-state">{t("没有可用设备")}</div></main>;
  }

  return (
    <>
      {mountedBackends.map((backend) => (
        <div
          className="backend-workspace"
          hidden={backend.id !== selectedBackend.id}
          key={`${backend.id}:${backend.baseUrl}:${backend.token}`}
        >
          <BackendWorkspace
            backend={backend}
            conversationVisible={
              backend.id === selectedBackend.id && !sidebarOpen
            }
            backends={registry.backends}
            summaries={summaries}
            onSummaryChange={updateSummary}
            onSnapshotChange={updateSnapshot}
            onOpenSidebar={openSidebar}
            onSwitchNewChatBackend={switchNewChatBackend}
            command={command}
            refreshVersion={refreshVersion}
          />
        </div>
      ))}
      <div
        className={`conversation-sidebar-layer${
          sidebarOpen ? " open" : ""
        }`}
        aria-hidden={!sidebarOpen}
      >
        <aside className="conversation-sidebar" aria-label={t("会话列表")}>
          <ThreadListPage
            backends={registry.backends}
            summaries={summaries}
            selectedBackendId={listBackendId}
            loadingBackendIds={loadingBackendIds}
            refreshing={refreshing}
            threadListState={threadListState}
            visibleThreads={scopedThreads}
            totalThreadCount={scopedThreadCount}
            projectDirectories={projectDirectories}
            hasProjectlessThreads={hasProjectlessThreads}
            projectThreadStates={projectThreadStates}
            projectHasMore={projectHasMore}
            projectVisibleCounts={projectVisibleCounts}
            collapsedProjectKeys={collapsedProjectKeys}
            loadingProjectKeys={loadingProjectKeys}
            openingThreadId={openingThreadId}
            query={query}
            error={listError}
            onQueryChange={setQuery}
            onOpenThread={openThread}
            onManageThread={manageThread}
            onNewChat={startNewChat}
            onSelectBackend={selectListBackend}
            onManageBackends={() => setManagerOpen(true)}
            onRefresh={refreshAllBackends}
            onToggleProject={toggleProject}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            onRetryProject={retryProject}
          />
        </aside>
        <button
          className="conversation-sidebar-scrim"
          type="button"
          aria-label={t("关闭会话列表")}
          onClick={closeSidebar}
        />
      </div>
      <BackendAttentionBanner
        backends={registry.backends}
        summaries={summaries}
        selectedBackendId={selectedBackend.id}
        onSelect={(backendId) => {
          selectBackend(backendId);
          selectListBackend(backendId);
          openSidebar();
        }}
      />
      <BackendManagerSheet
        open={managerOpen}
        registry={registry}
        summaries={summaries}
        onChange={persistRegistry}
        onClose={() => setManagerOpen(false)}
        appUpdate={{
          supported: appUpdate.supported,
          currentVersion: appUpdate.state.currentVersion,
          checking: appUpdate.state.phase === "checking",
          status:
            appUpdate.state.phase === "current"
              ? t("已是最新版本")
              : appUpdate.state.phase === "error"
                ? appUpdate.state.error
                : undefined,
          onCheck: () => void appUpdate.check(true),
        }}
      />
      <AppUpdateSheet
        open={appUpdate.sheetOpen}
        state={appUpdate.state}
        onClose={() => appUpdate.setSheetOpen(false)}
        onInstall={appUpdate.install}
        onRetry={appUpdate.install}
      />
    </>
  );
}
