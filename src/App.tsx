import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppServerClient, type RpcMessage } from "./app-server/client";
import { HttpOperationPendingError } from "./backends/http-transport";
import {
  buildEditedHistoryInput,
  createHistoricalMessageEditTarget,
  revertHistoricalMessage,
  type HistoricalMessageEditTarget,
} from "./app-server/history-edit";
import {
  appendConversationTitleRequest,
  extractGeneratedTitle,
} from "./app-server/conversation-title";
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
  dedupeThreadsById,
  loadProjectlessThreadRecords,
  loadProjectThreadRecords,
  mergeThreadListPage,
  nextProjectThreadLimit,
  PROJECTLESS_GROUP_ID,
  type ProjectThreadLoadState,
} from "./app-server/thread-list-loader";
import { searchThreadRecords } from "./app-server/thread-search";
import {
  applyCompletedTurn,
  applyFileChangePatch,
  applyTurnDiff,
  applyTurnItem,
  applyTurnStarted,
  createPendingTurn,
  isThreadRunning,
  reconcileRecentTurns,
  reconcileThreadSnapshot,
  removePendingTurn,
} from "./ui/conversation";
import {
  applyTurnChangeStats,
  loadRecoverableRecentThreadTurns,
  loadOlderThreadTurns,
  loadTurnChangeStatsPage,
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
  applyThreadNameUpdate,
  applyThreadNameUpdateToList,
  duplicateThread,
} from "./app-server/thread-metadata";
import {
  hasQueuedFollowUpsForThread,
  queuedFollowUpsForThread,
  rebindQueuedFollowUpsToContext,
  removeQueuedFollowUp,
  updateQueuedFollowUpText,
} from "./app-server/queued-follow-ups";
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
import {
  appendCurrentLocation,
  currentLocationErrorMessage,
  formatCurrentLocation,
  requestCurrentPosition,
} from "./ui/current-location";
import { uploadFile } from "./backends/file-upload";
import {
  runWorkspaceBootstrap,
  shouldResumeWorkspaceThread,
} from "./backends/workspace-bootstrap";
import { AsyncValueCache } from "./lib/async-value-cache";
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
  readNewChatModelSettings,
  resolveNewChatModelSettings,
  writeNewChatModelSettings,
  type ModelSettingsSelection,
} from "./ui/model-settings-preference";
import {
  assignBackendHostId,
  loadBackendRegistry,
  saveBackendRegistry,
} from "./backends/registry";
import { BackendConnectionManager } from "./backends/connection-manager";
import { readTransportMode, writeTransportMode, type TransportMode } from "./backends/transport-preference";
import {
  bindConnectionRecovery,
  bindReadOnlyThreadRefresh,
  reconcileBackendWorkspace,
  reconnectAndWaitUntilReady,
  requestWithUnsentReconnect,
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
  mergeAggregatedThreadSearchResults,
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
import { useSidebarSwipe } from "./features/threads/sidebar-swipe";
import {
  finalAnswerAttentionAction,
  readUnreadThreadIds,
  writeUnreadThreadIds,
} from "./features/threads/thread-unread";
import {
  applyPinnedThreadState,
  readPinnedThreadIds,
  toggleThreadPinned,
  writeThreadPinned,
} from "./features/threads/thread-pinning";
import {
  bindRunCompletionNavigation,
  completionThreadTitle,
  notifyRunCompleted,
  requestRunCompletionNotificationPermission,
  type RunCompletionNavigationTarget,
} from "./notifications/run-completion";
import { FinalAnswerCompletionTracker } from "../server/final-answer-completion";
import { t, useI18n } from "./i18n";
import { readNotificationPreference, writeNotificationPreference, useNotificationSync, type NotificationPreference } from "./notifications/preferences";

type AnyRecord = Record<string, any>;

interface AutomaticTitleState {
  turnId: string | null;
  status: "pending" | "saving" | "complete" | "closed";
  savePromise?: Promise<void>;
}

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
  searchQuery: string;
  searchResults: AnyRecord[];
  searchState: "idle" | "loading" | "ready" | "error";
  searchError: string;
  error: string;
}

interface WorkspaceCommand {
  id: number;
  backendId: string;
  type: "new" | "open" | "load-project" | "retry-project" | "manage";
  thread?: AnyRecord;
  cwd?: string | null;
  targetCount?: number;
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
  foregroundRecoveryActive: boolean;
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
  silentRefreshVersion: number;
  searchQuery: string;
}

function BackendWorkspace({
  backend,
  conversationVisible,
  foregroundRecoveryActive,
  backends,
  summaries,
  onSummaryChange,
  onSnapshotChange,
  onOpenSidebar,
  onSwitchNewChatBackend,
  command,
  refreshVersion,
  silentRefreshVersion,
  searchQuery,
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
  const [projectNextCursors, setProjectNextCursors] = useState<
    Record<string, string | null>
  >({});
  const [loadingProjectCwd, setLoadingProjectCwd] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [threadListState, setThreadListState] =
    useState<ThreadListState>("loading");
  const [resolvedSearchQuery, setResolvedSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AnyRecord[]>([]);
  const [searchState, setSearchState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [searchError, setSearchError] = useState("");
  const [searchRefreshVersion, setSearchRefreshVersion] = useState(0);
  const [active, setActive] = useState<AnyRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [draftFiles, setDraftFiles] = useState<DraftFile[]>([]);
  const currentDraftRef = useRef({ text: draft, images: draftImages, files: draftFiles });
  currentDraftRef.current = { text: draft, images: draftImages, files: draftFiles };
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
  const [syncState, setSyncState] = useState<{ updatedAt: number | null; stale: boolean } | null>(null);
  const [respondingRequest, setRespondingRequest] = useState(false);
  const respondingRequestRef = useRef(false);
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
  const [initialNewChatModelSettings] = useState(() =>
    readNewChatModelSettings(window.localStorage, backend.id),
  );
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
  const readyClientRef = useRef<AppServerClient | null>(null);
  const connectionManagerRef = useRef<BackendConnectionManager | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageReadGenerationRef = useRef(new ImageReadGeneration());
  const draftContextGenerationRef = useRef(0);
  const activeRef = useRef<AnyRecord | null>(null);
  const threadsRef = useRef<AnyRecord[]>([]);
  const modelsRef = useRef<AnyRecord[]>([]);
  const selectedModelRef = useRef("");
  const selectedEffortRef = useRef<string | null>(null);
  const selectedServiceTierRef = useRef<string | null>(null);
  const conversationVisibleRef = useRef(conversationVisible);
  const foregroundRecoveryActiveRef = useRef(foregroundRecoveryActive);
  const activeThreadTargetRef = useRef<string | null>(null);
  const openSequenceRef = useRef(0);
  const olderTurnsCursorRef = useRef<string | null>(null);
  const olderTurnsGenerationRef = useRef(0);
  const olderTurnsLoadingRef = useRef(false);
  const fullyLoadedProjectCwdsRef = useRef(new Set<string>());
  const refreshSequenceRef = useRef(0);
  const threadNotificationSequenceRef = useRef(0);
  const threadReconcileSequenceRef = useRef(0);
  const pendingSequenceRef = useRef(0);
  const pendingOperationsRef = useRef(new Map<string, {
    threadId: string; draftContext: number; pendingTurnId?: string;
    confirmed: (response: RpcMessage, client: AppServerClient) => void;
  }>());
  const earlyOperationConfirmationsRef = useRef(new Map<string, RpcMessage>());
  const [pendingOperationIds, setPendingOperationIds] = useState<string[]>([]);
  const newChatModelSettingsRef = useRef<ModelSettingsSelection | null>(
    initialNewChatModelSettings,
  );
  const hasStoredNewChatModelSettingsRef = useRef(
    initialNewChatModelSettings !== null,
  );
  const threadSettingsUpdateSequenceRef = useRef<
    Record<keyof ModelSettingsSelection, number>
  >({ model: 0, effort: 0, serviceTier: 0 });
  const queuedFollowUpsRef = useRef<QueuedFollowUp[]>([]);
  const queuedFollowUpDispatchingRef = useRef(false);
  const completionEventCatchUpRef = useRef(false);
  const finalAnswerCompletionRef = useRef(new FinalAnswerCompletionTracker());
  const automaticTitleStatesRef = useRef(
    new Map<string, AutomaticTitleState>(),
  );
  const automaticTitleStreamsRef = useRef(new Map<string, string>());
  const searchSequenceRef = useRef(0);
  const searchQueryRef = useRef(searchQuery);
  const skillLoadSequenceRef = useRef(0);
  const pluginLoadSequenceRef = useRef(0);
  const skillCatalogCacheRef = useRef(
    new AsyncValueCache<InstalledSkill[]>(),
  );
  const pluginCatalogCacheRef = useRef(
    new AsyncValueCache<InstalledPlugin[]>(),
  );

  const automaticTitleStreamKey = (
    threadId: string,
    turnId: string,
    itemId: string,
  ) => `${threadId}\u0000${turnId}\u0000${itemId}`;

  function updateThreadNameLocally(threadId: string, name: string) {
    setThreads((current) => {
      const next = current.map((thread) =>
        String(thread.id) === threadId ? { ...thread, name } : thread,
      );
      threadsRef.current = next;
      return next;
    });
    setSearchResults((current) =>
      current.map((thread) =>
        String(thread.id) === threadId ? { ...thread, name } : thread,
      ),
    );
    setActive((current) => {
      const next = String(current?.id ?? "") === threadId
        ? { ...current, name }
        : current;
      activeRef.current = next;
      return next;
    });
  }

  function persistAutomaticTitle(
    client: AppServerClient,
    threadId: string,
    turnId: string,
    title: string,
  ) {
    const state = automaticTitleStatesRef.current.get(threadId);
    if (
      !state ||
      state.status !== "pending" ||
      state.turnId !== turnId
    ) return;
    state.status = "saving";
    const savePromise = client
      .request("thread/name/set", { threadId, name: title })
      .then(() => {
        if (state.status !== "saving") return;
        state.status = "complete";
        updateThreadNameLocally(threadId, title);
      })
      .catch(() => {
        if (state.status === "saving") state.status = "closed";
      });
    state.savePromise = savePromise;
  }

  function processAutomaticTitleText(
    client: AppServerClient,
    threadId: string,
    turnId: string,
    text: string,
  ) {
    const result = extractGeneratedTitle(text);
    if (result.title) {
      persistAutomaticTitle(client, threadId, turnId, result.title);
    }
    return result.text;
  }

  function sanitizeAgentItem(
    client: AppServerClient,
    threadId: string,
    turnId: string,
    item: AnyRecord,
    complete = false,
  ) {
    if (item.type !== "agentMessage" || typeof item.text !== "string") {
      return item;
    }
    const key = automaticTitleStreamKey(
      threadId,
      turnId,
      String(item.id ?? ""),
    );
    automaticTitleStreamsRef.current.set(key, item.text);
    const sanitized = {
      ...item,
      text: processAutomaticTitleText(client, threadId, turnId, item.text),
    };
    if (complete) automaticTitleStreamsRef.current.delete(key);
    return sanitized;
  }

  async function cancelAutomaticTitle(threadId: string) {
    const state = automaticTitleStatesRef.current.get(threadId);
    if (!state) return;
    state.status = "closed";
    await state.savePromise?.catch(() => undefined);
  }
  const readLocalUnread = () =>
    readUnreadThreadIds(localStorage, backend.id);
  const readLocalPinned = () =>
    readPinnedThreadIds(localStorage, backend.id);
  const readPrioritizedThreadIds = () => new Set([
    ...readLocalPinned(),
    ...readLocalUnread(),
    ...threadsRef.current.filter((thread) => isThreadRunning(thread.status))
      .map((thread) => String(thread.id)),
  ]);
  const setLocalPinned = (threadId: string) => {
    const isPinned = toggleThreadPinned(localStorage, backend.id, threadId);
    const update = (current: AnyRecord[]) =>
      current.map((entry) =>
        String(entry.id) === threadId ? { ...entry, isPinned } : entry,
      );
    setThreads(update);
    setSearchResults(update);
    setActive((current) =>
      String(current?.id ?? "") === threadId
        ? { ...current, isPinned }
        : current,
    );
    showNotice(isPinned ? t("已置顶") : t("已取消置顶"));
  };
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
    setSearchResults((current) =>
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
    setSearchResults((current) =>
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
        setThreads((current) =>
          mergeThreadListPage(current, decorateThreads(data), readPrioritizedThreadIds()),
        );
        setThreadListState("ready");
      },
      onPinnedData(data) {
        // 同步已结束运行的摘要，使其按最新状态回到普通列表。
        const pinnedThreads = decorateThreads(data);
        setThreads((current) =>
          mergeThreadListPage(
            current,
            pinnedThreads,
            new Set(current.map((thread) => String(thread.id))),
          ),
        );
        setThreadListState("ready");
      },
      onProjectStart(cwd) {
        setProjectThreadStates((current) => ({
          ...current,
          [cwd]: "loading",
        }));
      },
      onProjectData(cwd, data, hasMore, nextCursor) {
        const nextProjectThreads = decorateThreads(data);
        setProjectNextCursors((current) => ({
          ...current,
          [cwd]: nextCursor,
        }));
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
          const projectThreads = mergeThreadListPage(
            currentProjectThreads,
            [...nextProjectThreads, ...retainedExpandedThreads],
            readPrioritizedThreadIds(),
          );
          return [
            ...current.filter((thread) => projectGroupIdOf(thread) !== cwd),
            ...projectThreads,
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
    modelsRef.current = models;
  }, [models]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
    selectedEffortRef.current = selectedEffort;
    selectedServiceTierRef.current = selectedServiceTier;
  }, [selectedEffort, selectedModel, selectedServiceTier]);

  useEffect(() => {
    conversationVisibleRef.current = conversationVisible;
  }, [conversationVisible]);

  useEffect(() => {
    foregroundRecoveryActiveRef.current = foregroundRecoveryActive;
  }, [foregroundRecoveryActive]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  useEffect(() => {
    const normalizedQuery = searchQuery.trim();
    const sequence = ++searchSequenceRef.current;
    if (!normalizedQuery) {
      setResolvedSearchQuery("");
      setSearchResults([]);
      setSearchState("idle");
      setSearchError("");
      return;
    }
    setResolvedSearchQuery(normalizedQuery);
    setSearchResults([]);
    setSearchError("");
    const client = clientRef.current;
    if (connection !== "online" || !client) {
      setSearchState(connection === "offline" ? "error" : "loading");
      if (connection === "offline") {
        setSearchError(t("设备尚未连接，请稍后重试"));
      }
      return;
    }
    setSearchState("loading");
    const timer = window.setTimeout(() => {
      void searchThreadRecords(client, normalizedQuery)
        .then((records) => {
          if (
            sequence !== searchSequenceRef.current ||
            client !== clientRef.current
          ) return;
          const projectlessIds = new Set(projectlessThreadIds);
          setSearchResults(
            decorateThreads(
              records.map((thread) =>
                projectlessIds.has(String(thread.id)) || thread.cwd == null
                  ? { ...thread, isProjectless: true }
                  : thread,
              ),
            ),
          );
          setSearchState("ready");
          setSearchError("");
        })
        .catch((reason) => {
          if (
            sequence !== searchSequenceRef.current ||
            client !== clientRef.current
          ) return;
          setSearchResults([]);
          setSearchState("error");
          setSearchError(
            reason instanceof Error ? reason.message : String(reason),
          );
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    connection,
    projectlessThreadIds,
    searchQuery,
    searchRefreshVersion,
  ]);

  useEffect(() => {
    const client = clientRef.current;
    if (
      connection !== "online" ||
      conversationLoadState !== "ready" ||
      !client ||
      !active
    ) return;
    let cancelled = false;
    const loadCatalogs = () => {
      if (cancelled || client !== clientRef.current) return;
      void loadSkillsForCwd(client, active.cwd ?? null);
      void loadPluginsForCwd(client, active.cwd ?? null);
    };
    if (window.requestIdleCallback) {
      const handle = window.requestIdleCallback(loadCatalogs, {
        timeout: 1_500,
      });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(handle);
      };
    }
    const handle = window.setTimeout(loadCatalogs, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [active?.cwd, active?.id, connection, conversationLoadState]);

  useEffect(
    () => () => {
      queuedFollowUpsRef.current.forEach((followUp) => {
        followUp.files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
      });
    },
    [],
  );

  useEffect(() => {
    if (!queuedFollowUps.length) return;
    const protectQueuedMessages = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectQueuedMessages);
    return () => window.removeEventListener("beforeunload", protectQueuedMessages);
  }, [queuedFollowUps.length]);

  async function loadThreads(
    client = clientRef.current,
    options: { silent?: boolean } = {},
  ) {
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
        {
          ...options,
          pinnedThreadIds: [...readLocalPinned()],
          prioritizedThreadIds: [...readPrioritizedThreadIds()],
          includeRunningThreads: true,
        },
      );
    } catch (reason) {
      setThreadListState((current) =>
        current === "loading" ? "error" : current,
      );
      throw reason;
    }
  }

  function applyActiveThreadSnapshot(incoming: AnyRecord) {
    setActive((current) => {
      const next = reconcileThreadSnapshot(current, incoming);
      activeRef.current = next;
      setBusy(["inProgress", "in_progress", "running"].includes(String(next.turns?.at(-1)?.status ?? "")));
      return next;
    });
  }

  async function reconcileActiveThread(
    client: AppServerClient,
    isCurrent: () => boolean = () => true,
    completedTurnId?: string,
  ) {
    const threadId = String(
      activeThreadTargetRef.current ?? activeRef.current?.id ?? "",
    );
    if (!threadId || client !== clientRef.current) return;
    const pendingThrough = pendingSequenceRef.current;
    const sequence = ++threadReconcileSequenceRef.current;
    const openSequence = openSequenceRef.current;
    const isLatest = () => sequence === threadReconcileSequenceRef.current &&
      openSequence === openSequenceRef.current && isCurrent();

    let latestTurns = await loadRecoverableRecentThreadTurns(
      client,
      threadId,
      () => threadNotificationSequenceRef.current,
      undefined,
      3,
      completedTurnId ? 1 : 5,
    );
    let detailLimit = completedTurnId ? 1 : 5;
    // 较早回合的完成通知可能晚于后继回合；此时读取五回合保留后继。
    if (completedTurnId && latestTurns?.at(-1)?.id !== completedTurnId) {
      latestTurns = await loadRecoverableRecentThreadTurns(client, threadId, () => threadNotificationSequenceRef.current);
      detailLimit = 5;
    }
    if (
      client !== clientRef.current ||
      String(
        activeThreadTargetRef.current ?? activeRef.current?.id ?? "",
      ) !== threadId ||
      activeRef.current?.id !== threadId ||
      latestTurns == null ||
      !isLatest()
    ) {
      return;
    }

    const hasPendingOperation = [...pendingOperationsRef.current.values()].some((operation) => operation.threadId === threadId);
    const discardPendingThrough = hasPendingOperation ? -1 : pendingThrough;
    setActive((current) => {
      if (current?.id !== threadId || !isLatest()) return current;
      const turns = reconcileRecentTurns(current.turns ?? [], latestTurns, { discardPendingThrough });
      const running = ["inProgress", "in_progress", "running"].includes(String(turns.at(-1)?.status ?? "")) ||
        hasPendingOperation || pendingSequenceRef.current > discardPendingThrough;
      const next = { ...current, turns };
      activeRef.current = next;
      setBusy(running);
      setThreads((entries) => entries.map((entry) => entry.id === threadId
        ? { ...entry, status: { type: running ? "active" : "idle" } } : entry));
      return next;
    });
    const turnsNeedingBackfill = latestTurns.filter((turn: AnyRecord) =>
      turn.itemsView === "summary" &&
      !activeRef.current?.turns?.some((currentTurn: AnyRecord) =>
        currentTurn.id === turn.id && currentTurn.loadedChangeStats &&
        currentTurn.loadedMediaStatus === turn.status &&
        !["inProgress", "in_progress", "running"].includes(String(turn.status ?? "")),
      ),
    );
    if (turnsNeedingBackfill.length) {
      void backfillTurnChangeStats(
        client,
        threadId,
        turnsNeedingBackfill.map((turn: AnyRecord) => String(turn.id)),
        () => isLatest() && client === clientRef.current &&
          String(activeRef.current?.id ?? "") === threadId,
        undefined,
        detailLimit,
      );
    }
  }

  function rememberPendingOperation(
    requestId: string,
    operation: NonNullable<ReturnType<typeof pendingOperationsRef.current.get>>,
    client: AppServerClient,
  ) {
    pendingOperationsRef.current.set(requestId, operation);
    const early = earlyOperationConfirmationsRef.current.get(requestId);
    if (early) {
      earlyOperationConfirmationsRef.current.delete(requestId);
      pendingOperationsRef.current.delete(requestId);
      operation.confirmed(early, client);
    }
    setPendingOperationIds([...pendingOperationsRef.current.keys()]);
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
      queuedCount: queuedFollowUps.length,
      error,
    });
  }, [
    backend.id,
    busy,
    connection,
    error,
    onSummaryChange,
    queuedFollowUps.length,
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
      searchQuery: resolvedSearchQuery,
      searchResults,
      searchState,
      searchError,
      error,
    });
  }, [
    backend.id,
    error,
    onSnapshotChange,
    openingThreadId,
    resolvedSearchQuery,
    searchError,
    searchResults,
    searchState,
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
    if (!silentRefreshVersion) return;
    fullyLoadedProjectCwdsRef.current.clear();
    if (!clientRef.current) {
      connectionManagerRef.current?.reconnect(backend.id);
      return;
    }
    void loadThreads(clientRef.current, { silent: true }).catch(
      () => undefined,
    );
  }, [silentRefreshVersion]);

  useEffect(() => {
    let disposed = false;
    setSyncState(null);
    let manager: BackendConnectionManager;
    manager = new BackendConnectionManager({
      onConnection: (_backendId, status, connectionError) => {
        if (disposed) return;
        setConnection(status);
        if (status === "online") setError("");
        if (
          connectionError &&
          connectionError !== t("无法连接设备网关")
        ) {
          setError(connectionError);
        }
        if (status === "connecting") {
          completionEventCatchUpRef.current = false;
          clientRef.current = null;
          readyClientRef.current = null;
        }
        if (status === "offline") {
          clientRef.current = null;
          readyClientRef.current = null;
          skillLoadSequenceRef.current += 1;
          pluginLoadSequenceRef.current += 1;
          setSkillCatalog({ cwd: null, skills: [], loading: false });
          setPluginCatalog({ cwd: null, plugins: [], loading: false });
          setRefreshing(false);
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
          if (message.method === "mobile/events/catchup") {
            completionEventCatchUpRef.current = params.active === true;
            return;
          }
          if (message.method === "mobile/sync") {
            setSyncState({ updatedAt: params.updatedAt ?? null, stale: params.stale === true });
            return;
          }
          if (message.method === "mobile/requests") {
            setRequests(params.requests ?? []);
            return;
          }
          for (const thread of threadsRef.current) finalAnswerCompletionRef.current.rememberThread(thread);
          finalAnswerCompletionRef.current.rememberThread(activeRef.current);
          const completedFinalAnswer = completionEventCatchUpRef.current
            ? null : finalAnswerCompletionRef.current.observe(message);
          if (completedFinalAnswer) {
            const { threadId } = completedFinalAnswer;
            const attentionAction = finalAnswerAttentionAction({
              item: { type: "agentMessage", phase: "final_answer" },
              catchingUp: false,
              hasQueuedFollowUp: queuedFollowUpsRef.current.some(
                (followUp) => followUp.threadId === threadId,
              ),
              threadId,
              activeThreadId: String(activeRef.current?.id ?? ""),
              conversationVisible: conversationVisibleRef.current,
              documentVisible: document.visibilityState === "visible",
            });
            if (attentionAction === "mark-unread") {
              markThreadUnread(threadId);
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
            } else if (attentionAction === "mark-read") {
              markThreadRead(threadId);
            }
          }
          if (message.method === "mobile/operation/confirmed") {
            threadNotificationSequenceRef.current += 1;
            const requestId = String(params.requestId);
            const operation = pendingOperationsRef.current.get(requestId);
            if (operation) {
              pendingOperationsRef.current.delete(requestId);
              setPendingOperationIds([...pendingOperationsRef.current.keys()]);
              if (!params.staleApproval) operation.confirmed(params.response, client);
            } else {
              // 通知可能先于 send 的 rejection 回调；跨 reload 则仍恢复当前会话事实。
              earlyOperationConfirmationsRef.current.set(requestId, params.response);
              if (earlyOperationConfirmationsRef.current.size > 32) earlyOperationConfirmationsRef.current.delete(earlyOperationConfirmationsRef.current.keys().next().value!);
              if (["turn/start", "turn/steer"].includes(params.request?.method)) void reconcileActiveThread(client).catch(() => undefined);
            }
            return;
          }
          if (message.method === "mobile/reset") {
            void reconcileActiveThread(client).catch(() => undefined);
            return;
          }
          if (message.method === "turn/plan/updated") {
            setActive((current) => current?.id === params.threadId
              ? { ...current, mobilePlan: params.plan ?? [] } : current);
          }
          if (message.method === "skills/changed") {
            void loadSkillsForCwd(
              client,
              activeRef.current?.cwd ?? null,
              true,
            );
            void loadPluginsForCwd(
              client,
              activeRef.current?.cwd ?? null,
              true,
            );
          }
          if (message.method === "thread/name/updated" && params.threadId) {
            const threadId = String(params.threadId);
            const threadName =
              typeof params.threadName === "string" ? params.threadName : null;
            const automaticTitle =
              automaticTitleStatesRef.current.get(threadId);
            if (
              threadName &&
              automaticTitle?.status === "pending"
            ) {
              automaticTitle.status = "closed";
            }
            setThreads((current) => {
              const next = applyThreadNameUpdateToList(
                current,
                threadId,
                threadName,
              );
              threadsRef.current = next;
              return next;
            });
            setActive((current) => {
              const next = applyThreadNameUpdate(
                current,
                threadId,
                threadName,
              );
              activeRef.current = next;
              return next;
            });
            setSearchResults((current) =>
              applyThreadNameUpdateToList(current, threadId, threadName),
            );
            if (searchQueryRef.current.trim()) {
              setSearchRefreshVersion((current) => current + 1);
            }
          }
          if (
            params.threadId &&
            params.threadId ===
              (activeThreadTargetRef.current ?? activeRef.current?.id)
          ) {
            threadNotificationSequenceRef.current += 1;
          }
          if (message.method === "turn/started" && params.turn) {
            setActive((current) => current && current.id === params.threadId &&
              current.turns?.at(-1)?.id !== params.turn.id ? { ...current, mobilePlan: [] } : current);
            if (params.threadId) {
              const automaticTitle = automaticTitleStatesRef.current.get(
                String(params.threadId),
              );
              if (
                automaticTitle?.status === "pending" &&
                !automaticTitle.turnId
              ) {
                automaticTitle.turnId = String(params.turn.id ?? "") || null;
              }
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
              setSearchResults((current) =>
                current.map((thread) =>
                  String(thread.id) === String(params.threadId)
                    ? { ...thread, status: { type: "active" } }
                    : thread,
                ),
              );
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
            const threadId = String(params.threadId ?? "");
            const turnId = String(params.turnId ?? "");
            const itemId = String(params.itemId ?? "");
            const streamKey = automaticTitleStreamKey(
              threadId,
              turnId,
              itemId,
            );
            const existingText = activeRef.current?.id === threadId
              ? activeRef.current.turns?.find((turn: AnyRecord) => turn.id === turnId)
                ?.items?.find((item: AnyRecord) => item.id === itemId)?.text
              : "";
            const rawText =
              `${automaticTitleStreamsRef.current.get(streamKey) ?? existingText ?? ""}${params.delta}`;
            automaticTitleStreamsRef.current.set(streamKey, rawText);
            const visibleText = processAutomaticTitleText(
              client,
              threadId,
              turnId,
              rawText,
            );
            setActive((current) => {
              if (!current || current.id !== params.threadId) return current;
              const copy = structuredClone(current);
              const turn = copy.turns?.find(
                (entry: AnyRecord) => entry.id === params.turnId,
              );
              const item = turn?.items?.find((entry: AnyRecord) => entry.id === params.itemId);
              if (!item) return current;
              if (item) item.text = visibleText;
              return copy;
            });
          }
          if (message.method === "item/started" && params.item) {
            const nextParams = {
              ...params,
              item: sanitizeAgentItem(
                client,
                String(params.threadId ?? ""),
                String(params.turnId ?? ""),
                params.item,
              ),
            };
            setPendingSteerMessage((current) =>
              clearPendingSteerForItem(current, nextParams),
            );
            setActive((current) =>
              current ? applyTurnItem(current, nextParams) : current,
            );
          }
          if (message.method === "item/completed" && params.item) {
            const nextParams = {
              ...params,
              item: sanitizeAgentItem(
                client,
                String(params.threadId ?? ""),
                String(params.turnId ?? ""),
                params.item,
                true,
              ),
            };
            setPendingSteerMessage((current) =>
              clearPendingSteerForItem(current, nextParams),
            );
            setActive((current) =>
              current ? applyTurnItem(current, nextParams) : current,
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
            const threadId = String(params.threadId ?? "");
            const turnId = String(params.turn?.id ?? params.turnId ?? "");
            const completedParams = params.turn
              ? {
                  ...params,
                  turn: {
                    ...params.turn,
                    items: Array.isArray(params.turn.items)
                      ? params.turn.items.map((item: AnyRecord) =>
                          sanitizeAgentItem(
                            client,
                            threadId,
                            turnId,
                            item,
                            true,
                          ),
                        )
                      : params.turn.items,
                  },
                }
              : params;
            if (params.threadId) {
              setPendingSteerMessage((current) =>
                clearPendingSteerForThread(current, threadId),
              );
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
              const completed = applyCompletedTurn(current, completedParams);
              if (completed === current) return current;
              setBusy(false);
              setSteering(false);
              return completed;
            });
            if (String(activeRef.current?.id ?? "") === threadId) {
              void reconcileActiveThread(client, () => true, turnId).catch(() => undefined);
            }
            const automaticTitle =
              automaticTitleStatesRef.current.get(threadId);
            if (
              automaticTitle?.status === "pending" &&
              automaticTitle.turnId === turnId
            ) {
              automaticTitle.status = "closed";
            }
            for (const key of automaticTitleStreamsRef.current.keys()) {
              if (key.startsWith(`${threadId}\u0000${turnId}\u0000`)) {
                automaticTitleStreamsRef.current.delete(key);
              }
            }
            void loadThreads(client);
            if (searchQueryRef.current.trim()) {
              setSearchRefreshVersion((current) => current + 1);
            }
          }
          if (
            message.method === "thread/status/changed" &&
            params.threadId &&
            params.status
          ) {
            setActive((current) => current?.id === params.threadId
              ? { ...current, status: params.status } : current);
            setThreads((current) =>
              current.map((thread) =>
                thread.id === params.threadId
                  ? { ...thread, status: params.status }
                  : thread,
              ),
            );
            setSearchResults((current) =>
              current.map((thread) =>
                String(thread.id) === String(params.threadId)
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
            const modelChanged = typeof settings.model === "string";
            const nextModel = modelChanged
              ? settings.model
              : selectedModelRef.current;
            const normalizedSettings = normalizeModelSettings(
              modelsRef.current.find((model) => model.model === nextModel),
              "effort" in settings
                ? settings.effort
                : selectedEffortRef.current,
              "serviceTier" in settings
                ? settings.serviceTier
                : selectedServiceTierRef.current,
            );
            if (modelChanged) {
              threadSettingsUpdateSequenceRef.current.model += 1;
              selectedModelRef.current = nextModel;
              setSelectedModel(nextModel);
            }
            if (modelChanged || "effort" in settings) {
              threadSettingsUpdateSequenceRef.current.effort += 1;
              selectedEffortRef.current = normalizedSettings.effort;
              setSelectedEffort(normalizedSettings.effort);
            }
            if (modelChanged || "serviceTier" in settings) {
              threadSettingsUpdateSequenceRef.current.serviceTier += 1;
              selectedServiceTierRef.current = normalizedSettings.serviceTier;
              setSelectedServiceTier(normalizedSettings.serviceTier);
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
            setRequests((current) => current.some((entry) => entry.id === request.id) ? current : [...current, request]);
          } else {
            void Promise.resolve(client.respondError(
              request.id!,
              -32601,
              t("Codex Mobile Web 暂不支持服务器请求：{method}", {
                method: request.method ?? "unknown",
              }),
            )).catch((reason) => setError(String(reason)));
          }
      },
      onReady: (_backendId, source) => {
        const client = source as AppServerClient;
        client.onThreadMetadata((thread) => {
          if (!disposed && manager.client(backend.id) === source) {
            finalAnswerCompletionRef.current.rememberThread(thread);
          }
        });
        clientRef.current = client;
        readyClientRef.current = null;
        const workspaceResumeSnapshot = {
          threadId: activeRef.current?.id
            ? String(activeRef.current.id)
            : null,
          openSequence: openSequenceRef.current,
        };
        void (async () => {
          try {
            if (!disposed && manager.client(backend.id) === source) {
            const [modelResult, permissionResult, configResult] =
              await runWorkspaceBootstrap({
                loadThreads: () => loadThreads(client),
                loadSettings: () => Promise.all([
                  client.request<{ data: AnyRecord[] }>("model/list", {
                    limit: 100,
                    includeHidden: false,
                  }),
                  client.request<{ data: AnyRecord[] }>(
                    "permissionProfile/list",
                    {
                      limit: 100,
                      cwd: null,
                    },
                  ),
                  client
                    .request<{ config: AnyRecord }>("config/read", {
                      cwd: null,
                      includeLayers: false,
                    })
                    .catch(() => ({ config: {} })),
                ]),
                loadRateLimits: async () => {
                  const result = await client.request<AnyRecord>(
                    "account/rateLimits/read",
                    undefined,
                  );
                  if (
                    !disposed &&
                    manager.client(backend.id) === source
                  ) {
                    setRateLimits(result);
                  }
                },
              });
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
            const configuredModelSettings = {
              model: configuredModel,
              effort: normalized.effort,
              serviceTier: normalized.serviceTier,
            };
            const newChatModelSettings = resolveNewChatModelSettings(
              modelResult.data,
              hasStoredNewChatModelSettingsRef.current
                ? newChatModelSettingsRef.current
                : null,
              configuredModelSettings,
            );
            newChatModelSettingsRef.current = newChatModelSettings;
            if (hasStoredNewChatModelSettingsRef.current) {
              writeNewChatModelSettings(
                window.localStorage,
                backend.id,
                newChatModelSettings,
              );
            }
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
            modelsRef.current = modelResult.data;
            setPermissionProfiles(availableProfiles);
            if (!activeRef.current?.id) {
              selectedModelRef.current = newChatModelSettings.model;
              selectedEffortRef.current = newChatModelSettings.effort;
              selectedServiceTierRef.current = newChatModelSettings.serviceTier;
              setSelectedModel(newChatModelSettings.model);
              setSelectedEffort(newChatModelSettings.effort);
              setSelectedServiceTier(newChatModelSettings.serviceTier);
            } else {
              const activeModel = modelResult.data.find(
                (model) => model.model === selectedModelRef.current,
              );
              if (activeModel) {
                const normalizedActiveSettings = normalizeModelSettings(
                  activeModel,
                  selectedEffortRef.current,
                  selectedServiceTierRef.current,
                );
                selectedEffortRef.current = normalizedActiveSettings.effort;
                selectedServiceTierRef.current =
                  normalizedActiveSettings.serviceTier;
                setSelectedEffort(normalizedActiveSettings.effort);
                setSelectedServiceTier(normalizedActiveSettings.serviceTier);
              }
            }
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
            setRefreshing(false);
            const currentThread = activeRef.current;
            if (
              currentThread?.id &&
              shouldResumeWorkspaceThread(workspaceResumeSnapshot, {
                threadId: String(currentThread.id),
                openSequence: openSequenceRef.current,
              })
            ) {
              activeThreadTargetRef.current = currentThread.id;
              const resumed = await resumeThreadSession(client, currentThread.id);
              if (
                !disposed &&
                manager.client(backend.id) === source &&
                activeRef.current?.id === currentThread.id &&
                shouldResumeWorkspaceThread(workspaceResumeSnapshot, {
                  threadId: String(currentThread.id),
                  openSequence: openSequenceRef.current,
                })
              ) {
                const resumedSettings = normalizeModelSettings(
                  modelResult.data.find(
                    (model) => model.model === resumed.model,
                  ),
                  resumed.reasoningEffort,
                  resumed.serviceTier,
                );
                for (const turn of resumed.thread.turns ?? []) {
                  for (const item of turn.items ?? []) {
                    sanitizeAgentItem(client, currentThread.id, turn.id, item);
                  }
                }
                applyActiveThreadSnapshot({
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
                selectedModelRef.current = resumed.model ?? "";
                selectedEffortRef.current = resumedSettings.effort;
                selectedServiceTierRef.current = resumedSettings.serviceTier;
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
              }
            }
            if (!disposed && manager.client(backend.id) === source) {
              readyClientRef.current = client;
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
      shouldRecover: () => foregroundRecoveryActiveRef.current,
      reconnect: () =>
        recoverBackendConnection(
          clientRef.current,
          () =>
            reconnectAndWaitUntilReady(
              () => manager.reconnect(backend.id),
              () => disposed || clientRef.current != null,
            ),
          (client) =>
            reconcileBackendWorkspace(
              client,
              reconcileActiveThread,
            ),
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
      readyClientRef.current = null;
    };
  }, [backend.baseUrl, backend.id, backend.token, backend.transportMode]);

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
    const cacheKey = `${backend.id}\u0000${cwd ?? ""}`;
    const cached = forceReload
      ? undefined
      : skillCatalogCacheRef.current.get(cacheKey);
    if (cached) {
      if (
        client === clientRef.current &&
        (activeRef.current?.cwd ?? null) === cwd
      ) {
        setSkillCatalog({ cwd, skills: cached, loading: false });
      }
      return;
    }
    setSkillCatalog((current) => ({
      cwd,
      skills: current.cwd === cwd ? current.skills : [],
      loading: true,
    }));
    try {
      const skills = await skillCatalogCacheRef.current.load(
        cacheKey,
        () => listInstalledSkills(client, cwd, forceReload),
        forceReload,
      );
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
    forceReload = false,
  ) {
    const sequence = ++pluginLoadSequenceRef.current;
    const cacheKey = `${backend.id}\u0000${cwd ?? ""}`;
    const cached = forceReload
      ? undefined
      : pluginCatalogCacheRef.current.get(cacheKey);
    if (cached) {
      if (
        client === clientRef.current &&
        (activeRef.current?.cwd ?? null) === cwd
      ) {
        setPluginCatalog({ cwd, plugins: cached, loading: false });
      }
      return;
    }
    setPluginCatalog((current) => ({
      cwd,
      plugins: current.cwd === cwd ? current.plugins : [],
      loading: true,
    }));
    try {
      const plugins = await pluginCatalogCacheRef.current.load(
        cacheKey,
        () => listInstalledPlugins(client, cwd),
        forceReload,
      );
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

  function discardQueuedFollowUpsForThread(threadId: string) {
    queuedFollowUpsForThread(queuedFollowUpsRef.current, threadId).forEach(
      (followUp) => {
        followUp.files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
      },
    );
    replaceQueuedFollowUps(
      queuedFollowUpsRef.current.filter(
        (followUp) => followUp.threadId !== threadId,
      ),
    );
    queuedFollowUpDispatchingRef.current = false;
  }

  function rebindQueuedThread(threadId: string) {
    replaceQueuedFollowUps(
      rebindQueuedFollowUpsToContext(
        queuedFollowUpsRef.current,
        threadId,
        draftContextGenerationRef.current,
      ),
    );
  }

  function discardHistoricalMessageEdit() {
    setHistoryEdit(null);
  }

  function resetDraftContext() {
    draftContextGenerationRef.current += 1;
    invalidateImageReads();
    setPendingSteerMessage(null);
    discardHistoricalMessageEdit();
  }

  function resetOlderTurns(cursor: string | null = null) {
    olderTurnsGenerationRef.current += 1;
    olderTurnsLoadingRef.current = false;
    olderTurnsCursorRef.current = cursor;
    setOlderTurnsState(cursor ? "idle" : "exhausted");
  }

  async function backfillTurnChangeStats(
    client: AppServerClient,
    threadId: string,
    turnIds: string[],
    isCurrent: () => boolean,
    cursor?: string,
    limit = 5,
  ) {
    const targetIds = new Set(turnIds);
    try {
      const stats = await loadTurnChangeStatsPage(client, threadId, cursor, limit);
      if (!isCurrent()) return;
      setActive((current) =>
        current?.id === threadId
          ? {
              ...current,
              turns: applyTurnChangeStats(current.turns ?? [], stats, turnIds),
            }
          : current,
      );
    } catch {
      if (!isCurrent()) return;
      setActive((current) =>
        current?.id === threadId
          ? {
              ...current,
              turns: (current.turns ?? []).map((turn: AnyRecord) =>
                targetIds.has(String(turn.id)) && !turn.loadedChangeStats
                  ? { ...turn, changeStatsUnavailable: true }
                  : turn,
              ),
            }
          : current,
      );
    }
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
      void backfillTurnChangeStats(
        client,
        threadId,
        page.turns.map((turn: AnyRecord) => String(turn.id)),
        () => generation === olderTurnsGenerationRef.current &&
          String(activeRef.current?.id ?? "") === threadId,
        cursor,
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
      if (sequence !== openSequenceRef.current || client !== clientRef.current) {
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
        modelsRef.current.find((model) => model.model === session.model),
        session.reasoningEffort,
        session.serviceTier,
      );
      applyActiveThreadSnapshot({
        ...decorateThread(session.thread),
        ...(activeRef.current?.isProjectless === true
          ? { isProjectless: true }
          : {}),
      });
      void backfillTurnChangeStats(
        client,
        threadId,
        (session.thread.turns ?? []).map((turn: AnyRecord) => String(turn.id)),
        () => sequence === openSequenceRef.current,
      );
      resetOlderTurns(session.nextTurnsCursor);
      setActiveSettingsSynchronized(session.settingsSynchronized);
      setActiveThreadAccessMode(session.accessMode);
      setActiveThreadResumeError(session.resumeError ?? "");
      selectedModelRef.current = session.model ?? "";
      selectedEffortRef.current = resumedSettings.effort;
      selectedServiceTierRef.current = resumedSettings.serviceTier;
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
    rebindQueuedThread(String(thread.id));
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

  async function requestAfterUnsentReconnect<T>(
    client: AppServerClient,
    method: string,
    params: unknown,
  ) {
    return requestWithUnsentReconnect({
      client,
      request: (candidate) => candidate.request<T>(method, params),
      reconnect: () => {
        const manager = connectionManagerRef.current;
        if (!manager) {
          throw new Error(t("设备尚未连接，请稍后重试"));
        }
        readyClientRef.current = null;
        manager.reconnect(backend.id);
      },
      readyClient: () => readyClientRef.current,
    });
  }

  function syncStartedThreadSettings(started: AnyRecord) {
    const startedModel = started.model || selectedModel;
    const startedSettings = normalizeModelSettings(
      models.find((model) => model.model === startedModel),
      started.reasoningEffort ?? selectedEffort,
      "serviceTier" in started ? started.serviceTier ?? null : effectiveSelectedServiceTier,
    );
    if (started.model) setSelectedModel(started.model);
    setSelectedEffort(startedSettings.effort);
    setSelectedServiceTier(startedSettings.serviceTier);
    if (started.approvalPolicy) setSelectedApprovalPolicy(started.approvalPolicy);
    if (started.approvalsReviewer) setSelectedApprovalsReviewer(started.approvalsReviewer);
    if (started.activePermissionProfile?.id) setSelectedPermission(started.activePermissionProfile.id);
    setActiveSettingsSynchronized(true);
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
    let client = clientRef.current;
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
        const startedRequest = await requestAfterUnsentReconnect<{
          thread: AnyRecord;
          model?: string;
          reasoningEffort?: string | null;
          serviceTier?: string | null;
          approvalPolicy?: ApprovalPolicy;
          approvalsReviewer?: ApprovalsReviewer;
          activePermissionProfile?: { id: string } | null;
        }>(client, "thread/start", {
          cwd: thread?.cwd ?? null,
          ...(selectedModel ? { model: selectedModel } : {}),
          serviceTier: effectiveSelectedServiceTier,
          ...(effectivePermission ? { permissions: effectivePermission } : {}),
          approvalPolicy: effectiveApprovalPolicy,
          approvalsReviewer: effectiveApprovalsReviewer,
        });
        client = startedRequest.client;
        const started = startedRequest.result;
        thread = startingProjectless
          ? { ...started.thread, isProjectless: true }
          : started.thread;
        automaticTitleStatesRef.current.set(String(thread.id), {
          turnId: null,
          status: "pending",
        });
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
        if (draftContext === draftContextGenerationRef.current) {
          setStartingThreadContext(null);
          syncStartedThreadSettings(started);
          activeRef.current = thread;
          setActive(thread);
        }
      }
      const automaticTitle = automaticTitleStatesRef.current.get(
        String(thread.id),
      );
      const modelText =
        automaticTitle?.status === "pending" && !automaticTitle.turnId
          ? appendConversationTitleRequest(text)
          : text;
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
      const startedTurnRequest = await requestAfterUnsentReconnect<{
        turn: AnyRecord;
      }>(client, "turn/start", {
        threadId: thread.id,
        input: buildTurnInput(
          modelText,
          pendingImages,
          uploadedFiles,
          pendingSkills,
          pendingPlugins,
        ),
        ...(shouldSendSettings && selectedModel ? { model: selectedModel } : {}),
        ...(shouldSendSettings && selectedEffort
          ? { effort: selectedEffort }
          : {}),
        ...(shouldSendSettings
          ? { serviceTier: effectiveSelectedServiceTier }
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
      const startedTurn = startedTurnRequest.result;
      if (
        automaticTitle?.status === "pending" &&
        !automaticTitle.turnId
      ) {
        automaticTitle.turnId = String(startedTurn.turn.id ?? "") || null;
      }
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
      if (reason instanceof HttpOperationPendingError) {
        const threadId = String(thread?.id ?? "");
        const confirmed = (response: RpcMessage, confirmationClient: AppServerClient) => {
          const currentContext = draftContext === draftContextGenerationRef.current;
          const currentThread = !threadId || String(activeRef.current?.id ?? "") === threadId;
          if (response.error) {
            if (threadId) setThreads((current) => current.map((entry) => entry.id === threadId ? { ...entry, status: { type: "idle" } } : entry));
            if (currentContext && currentThread) {
              setBusy(false);
              setStartingThreadContext(null);
              setActive((current) => current?.id === threadId ? removePendingTurn(current, pendingTurnId) : current);
              onFailure();
              setError(response.error.message);
            }
            return;
          }
          if (reason.request.method === "thread/start") {
            const created = (response.result as AnyRecord)?.thread;
            if (created?.id) {
              const restored = startingProjectless ? { ...created, isProjectless: true } : created;
              automaticTitleStatesRef.current.set(String(created.id), { turnId: null, status: "pending" });
              setThreads((current) => [restored, ...current.filter((entry) => entry.id !== created.id)]);
              if (startingProjectless) setProjectlessThreadIds((current) => {
                const next = mergeProjectlessThreadIds(current, [String(created.id)]);
                writeLocalProjectlessThreadIds(window.localStorage, backend.id, next);
                return next;
              });
              if (startingProjectless) {
                setProjectThreadStates((current) => ({ ...current, [PROJECTLESS_GROUP_ID]: "ready" }));
                setProjectHasMore((current) => ({ ...current, [PROJECTLESS_GROUP_ID]: false }));
              }
              if (currentContext && currentThread) {
                syncStartedThreadSettings(response.result as AnyRecord);
                activeThreadTargetRef.current = String(created.id);
                activeRef.current = restored;
                setActive(restored);
                setBusy(false);
                setStartingThreadContext(null);
                // thread/start 已完成，但正文未提交；保留供用户发送。
                onFailure();
              }
            }
          } else {
            pendingFiles.forEach((file) => URL.revokeObjectURL(file.previewUrl));
            if (currentContext && currentThread) void reconcileActiveThread(confirmationClient).catch(() => undefined);
          }
        };
        rememberPendingOperation(reason.requestId, { threadId, draftContext, pendingTurnId, confirmed }, client);
        return false;
      }
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
      ? busy || [...pendingOperationsRef.current.values()].some((operation) => operation.threadId === String(active.id))
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
        attachmentCount: pendingImages.length + pendingFiles.length,
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
        const currentDraft = currentDraftRef.current;
        const threadId = String(activeRef.current?.id ?? "");
        if (currentDraft.text.trim() || currentDraft.images.length || currentDraft.files.length) {
          // 后续新草稿保持可编辑；失败的原输入和附件留在现有手动重试队列。
          replaceQueuedFollowUps([{
            id: `failed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            threadId, draftContext, inputText: text,
            text: followUpPreviewText(text, pendingImages, pendingFiles),
            attachmentCount: pendingImages.length + pendingFiles.length,
            images: pendingImages, files: pendingFiles,
            skills: pendingSkills, plugins: pendingPlugins, failed: true,
          }, ...queuedFollowUpsRef.current]);
          return;
        }
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
      target.messageId,
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
      pendingOperationIds.some((id) => pendingOperationsRef.current.get(id)?.threadId === threadId) ||
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
    setActive((current) => {
      if (String(current?.id ?? "") !== session.threadId) return current;
      const next = { ...current, turns: (current?.turns ?? []).filter((turn: AnyRecord) => !(turn.historyEditDraft && turn.id === session.target.turnId)) };
      activeRef.current = next;
      return next;
    });
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
    if (session.reverted) retainedTurns = retainedTurns.filter((turn) => !turn.historyEditDraft);
    if (!session.reverted) {
      const currentTarget = createHistoricalMessageEditTarget(
        thread.turns ?? [],
        session.target.turnId,
        session.target.messageId,
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
    const draftContext = draftContextGenerationRef.current;
    const restoreEditing = (nextReverted: boolean, failure?: string) => {
      if (draftContext !== draftContextGenerationRef.current || String(activeRef.current?.id ?? "") !== threadId) return;
      if (nextReverted) {
        // revert 已删除原目标；仅保留用于手动编辑的本地草稿，不代表已执行回合。
        const editDraft = { id: target.turnId, status: "failed", itemsView: "summary", historyEditDraft: true, items: [{ id: target.messageId, type: "userMessage", content: buildEditedHistoryInput(target, text) }] };
        setActive((current) => {
          if (!current || String(current.id) !== threadId) return current;
          const next = { ...current, turns: [...(current.turns ?? []).filter((turn: AnyRecord) => turn.id !== pendingTurnId && turn.id !== target.turnId), editDraft] };
          activeRef.current = next;
          return next;
        });
      }
      setHistoryEdit((current) => current?.threadId === threadId ? { ...current, target: nextReverted ? { ...target, hasLaterTurns: false } : target, reverted: nextReverted, submitting: false } : current);
      setBusy(false);
      if (failure) setError(failure);
    };
    try {
      let workingThread = session.reverted ? { ...thread, turns: retainedTurns } : thread;
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
          ...(shouldSendSettings
            ? { serviceTier: effectiveSelectedServiceTier }
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
      if (reason instanceof HttpOperationPendingError) {
        rememberPendingOperation(reason.requestId, {
          threadId, draftContext, pendingTurnId,
          confirmed: (response, confirmationClient) => {
            if (draftContext !== draftContextGenerationRef.current || String(activeRef.current?.id ?? "") !== threadId) return;
            if (response.error) {
              restoreEditing(reverted, response.error.message);
              return;
            }
            if (["thread/revert", "thread/rollback"].includes(reason.request.method ?? "")) {
              // RPC 已明确完成回退；先恢复已知保留前缀，解锁原编辑，网络读取只校正事实。
              const knownThread = { ...activeRef.current, turns: retainedTurns };
              activeRef.current = knownThread;
              setActive(knownThread);
              resetOlderTurns((response.result as AnyRecord)?.turnsBackwardsCursor ?? null);
              restoreEditing(true);
              const correctionSequence = pendingSequenceRef.current;
              void loadRecoverableRecentThreadTurns(confirmationClient, threadId, () => threadNotificationSequenceRef.current).then((recent) => {
                if (recent == null || draftContext !== draftContextGenerationRef.current || String(activeRef.current?.id ?? "") !== threadId || confirmationClient !== clientRef.current || pendingSequenceRef.current !== correctionSequence) return;
                setActive((current) => {
                  if (!current || String(current.id) !== threadId) return current;
                  const editDrafts = (current.turns ?? []).filter((turn: AnyRecord) => turn.historyEditDraft);
                  const next = { ...current, turns: [...reconcileRecentTurns(retainedTurns, recent, { discardPendingThrough: correctionSequence }), ...editDrafts] };
                  activeRef.current = next;
                  return next;
                });
              }).catch(() => undefined);
            } else {
              setHistoryEdit(null);
              void reconcileActiveThread(confirmationClient).catch(() => undefined);
            }
          },
        }, client);
        return;
      }
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
      if (reason instanceof HttpOperationPendingError) {
        rememberPendingOperation(reason.requestId, {
          threadId, draftContext: followUp.draftContext,
          confirmed: (response, confirmationClient) => {
            setPendingSteerMessage((current) => clearPendingSteerForRequest(current, clientUserMessageId));
            if (response.error) {
              replaceQueuedFollowUps([{ ...followUp, failed: true }, ...queuedFollowUpsRef.current.filter((entry) => entry.id !== followUp.id)]);
              if (followUp.draftContext === draftContextGenerationRef.current) setError(response.error.message);
            } else {
              followUp.files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
              if (String(activeRef.current?.id ?? "") === threadId) void reconcileActiveThread(confirmationClient).catch(() => undefined);
            }
          },
        }, client);
        return;
      }
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

  function editQueuedFollowUp(id: string, inputText: string) {
    const followUp = queuedFollowUpsRef.current.find((entry) => entry.id === id);
    if (!followUp) return;
    const text = inputText.trim();
    if (!text && !followUp.images.length && !followUp.files.length) return;
    const referencedSkills = skillsReferencedInText(
      text,
      skillCatalog.cwd === (activeRef.current?.cwd ?? null)
        ? skillCatalog.skills
        : [],
    );
    const referencedPlugins = pluginsReferencedInText(
      text,
      pluginCatalog.cwd === (activeRef.current?.cwd ?? null)
        ? pluginCatalog.plugins
        : [],
    );
    const updated = updateQueuedFollowUpText(
      queuedFollowUpsRef.current,
      id,
      text,
      followUpPreviewText(text, followUp.images, followUp.files),
    ).map((entry) =>
      entry.id === id
        ? {
            ...entry,
            skills: referencedSkills,
            plugins: referencedPlugins,
          }
        : entry,
    );
    replaceQueuedFollowUps(updated);
  }

  function cancelQueuedFollowUp(id: string) {
    const followUp = queuedFollowUpsRef.current.find((entry) => entry.id === id);
    if (!followUp) return;
    followUp.files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    replaceQueuedFollowUps(removeQueuedFollowUp(queuedFollowUpsRef.current, id));
  }

  useEffect(() => {
    const activeThreadId = String(active?.id ?? "");
    const followUp = queuedFollowUps.find(
      (entry) => entry.threadId === activeThreadId && (entry.threadId || entry.draftContext === draftContextGenerationRef.current),
    );
    if (
      busy ||
      steering ||
      queuedFollowUpDispatchingRef.current ||
      pendingOperationIds.some((id) => pendingOperationsRef.current.get(id)?.threadId === activeThreadId) ||
      !followUp ||
      followUp.failed ||
      connection !== "online" ||
      conversationLoadState !== "ready" ||
      activeThreadAccessMode !== "interactive" ||
      activeThreadId !== followUp.threadId ||
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
    pendingOperationIds,
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

  async function selectCurrentLocation() {
    if (
      historyEdit ||
      (active?.id && activeThreadAccessMode !== "interactive")
    ) return false;
    const draftContext = draftContextGenerationRef.current;
    try {
      const position = await requestCurrentPosition();
      if (draftContext !== draftContextGenerationRef.current) return false;
      setDraft((current) =>
        appendCurrentLocation(current, formatCurrentLocation(position)),
      );
      setError("");
      return true;
    } catch (reason) {
      if (draftContext !== draftContextGenerationRef.current) return false;
      setError(currentLocationErrorMessage(reason));
      return false;
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
    if (searchQueryRef.current.trim()) {
      setSearchRefreshVersion((current) => current + 1);
    }
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
    if (
      action === "archive" &&
      hasQueuedFollowUpsForThread(queuedFollowUpsRef.current, threadId)
    ) {
      const count = queuedFollowUpsForThread(
        queuedFollowUpsRef.current,
        threadId,
      ).length;
      if (
        !window.confirm(
          t("此会话仍有 {count} 条排队消息，归档会丢弃这些消息。确定归档吗？", {
            count,
          }),
        )
      ) return false;
    }
    setPendingAction(action);
    setError("");
    try {
      if (action === "pin") {
        setLocalPinned(threadId);
        return true;
      }
      if (!client) {
        setError(t("设备尚未连接，请稍后重试"));
        return false;
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
        setSearchResults((current) =>
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
        await cancelAutomaticTitle(threadId);
        await client.request("thread/name/set", { threadId, name });
        setThreads((current) =>
          current.map((entry) =>
            String(entry.id) === threadId ? { ...entry, name } : entry,
          ),
        );
        setSearchResults((current) =>
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
      discardQueuedFollowUpsForThread(threadId);
      markThreadRead(threadId);
      writeThreadPinned(localStorage, backend.id, threadId, false);
      setThreads((current) =>
        current.filter((entry) => String(entry.id) !== threadId),
      );
      setSearchResults((current) =>
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
    const thread = activeRef.current;
    if (
      !thread?.id ||
      pendingAction
    ) return false;
    const nextPinned = thread.isPinned !== true;
    setPendingAction("pin");
    setError("");
    try {
      setLocalPinned(String(thread.id));
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
      await cancelAutomaticTitle(String(thread.id));
      await client.request("thread/name/set", {
        threadId: thread.id,
        name,
      });
      setThreads((current) =>
        current.map((entry) =>
          entry.id === thread.id ? { ...entry, name } : entry,
        ),
      );
      setSearchResults((current) =>
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
    const threadId = String(thread.id);
    if (hasQueuedFollowUpsForThread(queuedFollowUpsRef.current, threadId)) {
      const count = queuedFollowUpsForThread(
        queuedFollowUpsRef.current,
        threadId,
      ).length;
      if (
        !window.confirm(
          t("此会话仍有 {count} 条排队消息，归档会丢弃这些消息。确定归档吗？", {
            count,
          }),
        )
      ) return false;
    }
    setPendingAction("archive");
    setError("");
    try {
      await client.request("thread/archive", { threadId: thread.id });
      discardQueuedFollowUpsForThread(threadId);
      markThreadRead(String(thread.id));
      writeThreadPinned(localStorage, backend.id, String(thread.id), false);
      setThreads((current) =>
        current.filter((entry) => entry.id !== thread.id),
      );
      setSearchResults((current) =>
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
  const effectiveSelectedServiceTier = normalizeModelSettings(
    selectedModelEntry,
    selectedEffort,
    selectedServiceTier,
  ).serviceTier;
  const displayedServiceTier = selectedModelEntry
    ? effectiveSelectedServiceTier
    : null;
  const selectedSpeedLabel =
    speedOptions.find((option) => option.id === displayedServiceTier)
      ?.label ??
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

  const rememberNewChatModelSettings = (
    settings: ModelSettingsSelection,
  ) => {
    newChatModelSettingsRef.current = settings;
    hasStoredNewChatModelSettingsRef.current = true;
    writeNewChatModelSettings(window.localStorage, backend.id, settings);
  };

  const updateActiveThreadModelSettings = (
    patch: Partial<ModelSettingsSelection>,
    previous: ModelSettingsSelection,
  ) => {
    const client = clientRef.current;
    const threadId = String(active?.id ?? "");
    if (!client || !threadId) return;
    const fields = Object.keys(patch) as Array<keyof ModelSettingsSelection>;
    const sequences = Object.fromEntries(
      fields.map((field) => [
        field,
        ++threadSettingsUpdateSequenceRef.current[field],
      ]),
    ) as Partial<Record<keyof ModelSettingsSelection, number>>;
    void client
      .request("thread/settings/update", { threadId, ...patch })
      .catch((reason) => {
        if (String(activeRef.current?.id ?? "") !== threadId) return;
        if (
          sequences.model === threadSettingsUpdateSequenceRef.current.model
        ) {
          setSelectedModel(previous.model);
        }
        if (
          sequences.effort === threadSettingsUpdateSequenceRef.current.effort
        ) {
          setSelectedEffort(previous.effort);
        }
        if (
          sequences.serviceTier ===
          threadSettingsUpdateSequenceRef.current.serviceTier
        ) {
          setSelectedServiceTier(previous.serviceTier);
        }
        setError(
          t("更新线程模型设置失败：{message}", {
            message: reason instanceof Error ? reason.message : String(reason),
          }),
        );
      });
  };

  const chooseModel = (modelId: string) => {
    const model = models.find((option) => option.model === modelId);
    const normalized = normalizeModelSettings(
      model,
      selectedEffort,
      selectedServiceTier,
    );
    const previous = {
      model: selectedModel,
      effort: selectedEffort,
      serviceTier: selectedServiceTier,
    };
    const next = {
      model: modelId,
      effort: normalized.effort,
      serviceTier: normalized.serviceTier,
    };
    setSelectedModel(modelId);
    setSelectedEffort(normalized.effort);
    setSelectedServiceTier(normalized.serviceTier);
    if (active?.id) {
      updateActiveThreadModelSettings(next, previous);
    } else {
      rememberNewChatModelSettings(next);
    }
  };
  const chooseEffort = (effort: string) => {
    const previous = {
      model: selectedModel,
      effort: selectedEffort,
      serviceTier: selectedServiceTier,
    };
    setSelectedEffort(effort);
    if (active?.id) {
      updateActiveThreadModelSettings({ effort }, previous);
    } else {
      rememberNewChatModelSettings({ ...previous, effort });
    }
  };
  const chooseSpeed = (serviceTier: string | null) => {
    const previous = {
      model: selectedModel,
      effort: selectedEffort,
      serviceTier: selectedServiceTier,
    };
    setSelectedServiceTier(serviceTier);
    if (active?.id) {
      updateActiveThreadModelSettings({ serviceTier }, previous);
    } else {
      rememberNewChatModelSettings({ ...previous, serviceTier });
    }
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
  const replyToRequest = async (result: unknown) => {
    const client = clientRef.current;
    if (!approval || !client || respondingRequestRef.current) return;
    respondingRequestRef.current = true;
    setRespondingRequest(true);
    try {
      await client.respond(approval.id!, result);
      setRequests((current) => current.filter((entry) => entry.id !== approval.id));
      setUserAnswers({});
    } catch (reason) {
      if (reason instanceof HttpOperationPendingError) {
        const context = draftContextGenerationRef.current;
        rememberPendingOperation(reason.requestId, {
          threadId: String((approval.params as AnyRecord)?.threadId ?? ""),
          draftContext: context,
          confirmed: (response) => {
            if (context !== draftContextGenerationRef.current) return;
            if (response.error) setError(response.error.message);
            else setUserAnswers({});
          },
        }, client);
        return;
      }
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      respondingRequestRef.current = false;
      setRespondingRequest(false);
    }
  };
  const finishRequest = (decision: "accept" | "decline") => {
    if (!approval) return;
    const params = (approval.params ?? {}) as AnyRecord;
    if (approval.method === "item/permissions/requestApproval") {
      const requested = (params.permissions ?? {}) as AnyRecord;
      const granted = {
        ...(requested.fileSystem != null ? { fileSystem: requested.fileSystem } : {}),
        ...(requested.network != null ? { network: requested.network } : {}),
      };
      void replyToRequest({
        permissions: decision === "accept" ? granted : {},
        scope: "turn",
      });
    } else {
      void replyToRequest({ decision });
    }
  };
  const answerQuestions = () => {
    if (!approval) return;
    const questions = ((approval.params as AnyRecord)?.questions ?? []) as AnyRecord[];
    void replyToRequest({
      answers: Object.fromEntries(
        questions.map((question) => [question.id, { answers: [userAnswers[question.id] ?? ""] }]),
      ),
    });
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
    const newChatModelSettings = newChatModelSettingsRef.current;
    if (newChatModelSettings) {
      setSelectedModel(newChatModelSettings.model);
      setSelectedEffort(newChatModelSettings.effort);
      setSelectedServiceTier(newChatModelSettings.serviceTier);
    }
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

  async function loadProjectThreads(cwd: string) {
    const client = clientRef.current;
    if (!client) return;
    const cursor = projectNextCursors[cwd];
    if (!cursor) {
      setProjectHasMore((current) => ({ ...current, [cwd]: false }));
      return;
    }
    setLoadingProjectCwd(cwd);
    try {
      const result = await loadProjectThreadRecords(
        client,
        cwd,
        cursor,
        new Set([...readPrioritizedThreadIds(), ...projectlessThreadIds]),
      );
      if (result.hasMore) {
        fullyLoadedProjectCwdsRef.current.delete(cwd);
      } else {
        fullyLoadedProjectCwdsRef.current.add(cwd);
      }
      setProjectHasMore((current) => ({
        ...current,
        [cwd]: result.hasMore,
      }));
      setProjectNextCursors((current) => ({
        ...current,
        [cwd]: result.nextCursor,
      }));
      setThreads((current) => {
        const currentProjectThreads = current.filter(
          (thread) => projectGroupIdOf(thread) === cwd,
        );
        const nextProjectThreads = decorateThreads(
          result.threads.filter(
            (thread) => !projectlessThreadIds.includes(String(thread.id)),
          ),
        );
        return [
          ...current.filter((thread) => projectGroupIdOf(thread) !== cwd),
          ...dedupeThreadsById([
            ...currentProjectThreads,
            ...nextProjectThreads,
          ]),
        ];
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingProjectCwd((current) => (current === cwd ? "" : current));
    }
  }

  async function loadProjectlessThreads(targetCount: number) {
    const client = clientRef.current;
    if (!client) return;
    setLoadingProjectCwd(PROJECTLESS_GROUP_ID);
    try {
      const result = await loadProjectlessThreadRecords(
        client,
        projectlessThreadIds,
        targetCount,
        readPrioritizedThreadIds(),
      );
      if (result.hasMore) {
        fullyLoadedProjectCwdsRef.current.delete(PROJECTLESS_GROUP_ID);
      } else {
        fullyLoadedProjectCwdsRef.current.add(PROJECTLESS_GROUP_ID);
      }
      setProjectHasMore((current) => ({
        ...current,
        [PROJECTLESS_GROUP_ID]: result.hasMore,
      }));
      setThreads((current) => [
        ...current.filter(
          (thread) => projectGroupIdOf(thread) !== PROJECTLESS_GROUP_ID,
        ),
        ...mergeThreadListPage(
          current.filter(
            (thread) => projectGroupIdOf(thread) === PROJECTLESS_GROUP_ID,
          ),
          decorateThreads(result.threads),
          readPrioritizedThreadIds(),
        ),
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
    } else if (
      command.type === "load-project" &&
      command.cwd &&
      command.targetCount
    ) {
      if (command.cwd === PROJECTLESS_GROUP_ID) {
        void loadProjectlessThreads(command.targetCount);
      } else {
        void loadProjectThreads(command.cwd);
      }
    } else if (command.type === "retry-project" && command.cwd) {
      const client = clientRef.current;
      if (client) {
        if (command.cwd === PROJECTLESS_GROUP_ID) {
          void threadListLoaderRef.current!.loadProjectless(
            client,
            projectlessThreadIds,
            { prioritizedThreadIds: [...readPrioritizedThreadIds()] },
          );
        } else {
          void threadListLoaderRef.current!.loadProject(client, command.cwd, {
            prioritizedThreadIds: [...readPrioritizedThreadIds()],
          });
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
  }, [
    backend.id,
    command,
    projectNextCursors,
    projectOptions,
    projectlessThreadIds,
  ]);

  const conversationBusy = active?.id
    ? busy || pendingOperationIds.some((id) => pendingOperationsRef.current.get(id)?.threadId === String(active.id))
    : startingThreadContext === draftContextGenerationRef.current;
  const conversationOperationPending = pendingOperationIds.some((id) => {
    const operation = pendingOperationsRef.current.get(id);
    return operation?.draftContext === draftContextGenerationRef.current && (!operation.threadId || operation.threadId === String(active?.id ?? ""));
  });

  return (
    <main className="app-shell">
      {active ? (
        <ConversationPage
          active={active}
          backendId={backend.id}
          backendName={backend.name}
          nativeForeground={conversationVisible}
          backends={backends.filter((entry) => entry.enabled)}
          projectOptions={projectOptions}
          loadState={conversationLoadState}
          loadError={conversationLoadError}
          olderTurnsState={olderTurnsState}
          connection={connection}
          client={clientRef.current}
          error={error}
          syncState={syncState}
          draft={draft}
          draftImages={draftImages}
          draftFiles={draftFiles}
          imageReading={imageReading}
          busy={conversationBusy}
          operationPending={conversationOperationPending}
          steering={steering}
          steerable={Boolean(activeTurnId(active))}
          pendingSteerText={
            pendingSteerMessage?.threadId === String(active.id)
              ? pendingSteerMessage.text
              : ""
          }
          queuedFollowUps={queuedFollowUps.filter(
            (followUp) => followUp.threadId === String(active.id ?? "") && (followUp.threadId || followUp.draftContext === draftContextGenerationRef.current),
          )}
          accessMode={activeThreadAccessMode}
          resumeError={activeThreadResumeError}
          tokenUsage={tokenUsageByThread[active.id] ?? null}
          rateLimits={rateLimits}
          pendingAction={pendingAction}
          selectedServiceTier={displayedServiceTier}
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
          onSelectLocation={selectCurrentLocation}
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
          onQueuedFollowUpEdit={editQueuedFollowUp}
          onQueuedFollowUpCancel={cancelQueuedFollowUp}
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
        submitting={respondingRequest}
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
        selectedServiceTier={displayedServiceTier}
        selectedSpeedLabel={selectedSpeedLabel}
        selectedPermissionModeId={selectedPermissionModeId}
        onPickerChange={setPicker}
        onChooseEffort={chooseEffort}
        onChooseModel={chooseModel}
        onChooseSpeed={chooseSpeed}
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
  const [notificationPreference, setNotificationPreference] = useState(() => readNotificationPreference(window.localStorage));
  const saveNotificationPreference = (next: NotificationPreference) => {
    const saved = writeNotificationPreference(window.localStorage, next);
    setNotificationPreference(saved);
  };
  const failedNotificationDevices = useNotificationSync(registry.backends, notificationPreference);
  const [transportMode, setTransportMode] = useState(() => readTransportMode(window.localStorage));
  const changeTransportMode = (mode: TransportMode) => {
    writeTransportMode(window.localStorage, mode);
    setTransportMode(mode);
  };
  const [managerOpen, setManagerOpen] = useState(
    !initialRegistry.backends.length,
  );
  const appUpdate = useAppUpdate();

  if (registry.backends.length) {
    return (
      <ConfiguredApp
        initialRegistry={registry}
        appUpdate={appUpdate}
        transportMode={transportMode}
        onTransportModeChange={changeTransportMode}
        notificationPreference={notificationPreference}
        onNotificationPreferenceSave={saveNotificationPreference}
        failedNotificationDevices={failedNotificationDevices}
        onRegistryChange={setRegistry}
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
        transportMode={transportMode}
        onTransportModeChange={changeTransportMode}
        notificationPreference={notificationPreference}
        onNotificationPreferenceSave={saveNotificationPreference}
        failedNotificationDevices={failedNotificationDevices}
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
  transportMode,
  onTransportModeChange,
  notificationPreference,
  onNotificationPreferenceSave,
  failedNotificationDevices,
  onRegistryChange,
}: {
  initialRegistry: BackendRegistry;
  appUpdate: AppUpdateController;
  transportMode: TransportMode;
  onTransportModeChange: (mode: TransportMode) => void;
  notificationPreference: NotificationPreference;
  onNotificationPreferenceSave: (preference: NotificationPreference) => void;
  failedNotificationDevices: string[];
  onRegistryChange: (registry: BackendRegistry) => void;
}) {
  const [registry, setRegistry] = useState(initialRegistry);
  useEffect(() => { onRegistryChange(registry); }, [registry, onRegistryChange]);
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
  const [collapsedProjectKeys, setCollapsedProjectKeys] = useState(() =>
    readCollapsedProjectKeys(window.localStorage),
  );
  const [command, setCommand] = useState<WorkspaceCommand | null>(null);
  const [pendingCompletionTarget, setPendingCompletionTarget] =
    useState<RunCompletionNavigationTarget | null>(null);
  const commandIdRef = useRef(0);
  const {
    sidebarOpen,
    refreshVersion,
    silentRefreshVersion,
    openSidebar,
    closeSidebar,
    refresh: refreshAllBackends,
    refreshSilently: refreshAllBackendsSilently,
  } = useSidebarRefresh();
  useEffect(() => {
    if (!sidebarOpen) setQuery("");
  }, [sidebarOpen]);
  const sidebarLayerRef = useSidebarSwipe(
    sidebarOpen,
    openSidebar,
    closeSidebar,
  );
  const selectListBackend = useCallback((backendId: string) => {
    window.localStorage.setItem("codex-mobile:list-backend", backendId);
    setListBackendId(backendId);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    return bindConnectionRecovery({
      reconnect: refreshAllBackendsSilently,
    });
  }, [refreshAllBackendsSilently, sidebarOpen]);

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
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [closeSidebar, sidebarOpen]);

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
        previous.queuedCount === summary.queuedCount &&
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
        previous.searchQuery === snapshot.searchQuery &&
        previous.searchResults === snapshot.searchResults &&
        previous.searchState === snapshot.searchState &&
        previous.searchError === snapshot.searchError &&
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
  const normalizedQuery = query.trim();
  const scopedLoadedThreads = useMemo(
    () =>
      listBackendId === "all"
        ? aggregatedThreads
        : aggregatedThreads.filter(
            (thread) => thread.backendId === listBackendId,
          ),
    [aggregatedThreads, listBackendId],
  );
  const aggregatedSearchThreads = useMemo(
    () =>
      normalizedQuery
        ? aggregateThreads(
            mountedBackends,
            Object.fromEntries(
              mountedBackends.map((backend) => {
                const snapshot = snapshots[backend.id];
                return [
                  backend.id,
                  snapshot?.searchQuery === normalizedQuery
                    ? snapshot.searchResults
                    : [],
                ];
              }),
            ),
          )
        : [],
    [mountedBackends, normalizedQuery, snapshots],
  );
  const scopedThreads = useMemo(() => {
    if (!normalizedQuery) return scopedLoadedThreads;
    const serverMatches =
      listBackendId === "all"
        ? aggregatedSearchThreads
        : aggregatedSearchThreads.filter(
            (thread) => thread.backendId === listBackendId,
          );
    const metadataMatches = filterAggregatedThreads(
      scopedLoadedThreads,
      normalizedQuery,
      listBackendId === "all",
    );
    return mergeAggregatedThreadSearchResults(
      serverMatches,
      metadataMatches,
    );
  }, [
    aggregatedSearchThreads,
    listBackendId,
    normalizedQuery,
    scopedLoadedThreads,
  ]);
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
  const searching =
    Boolean(normalizedQuery) &&
    scopedSnapshots.some(
      (snapshot) =>
        snapshot.searchQuery !== normalizedQuery ||
        snapshot.searchState === "loading",
    );
  const listError = scopedSnapshots
    .flatMap((snapshot) => [
      snapshot.error,
      ...(normalizedQuery &&
      snapshot.searchQuery === normalizedQuery &&
      snapshot.searchState === "error"
        ? [snapshot.searchError]
        : []),
    ])
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
      const loadedCount = (snapshots[backendId]?.threads ?? []).filter(
        (thread) =>
          thread.isPinned !== true &&
          (cwd === PROJECTLESS_GROUP_ID
            ? thread.isProjectless === true
            : thread.isProjectless !== true &&
              String(thread.cwd ?? "") === cwd),
      ).length;
      setCommand({
        id: ++commandIdRef.current,
        backendId,
        type: "load-project",
        cwd,
        targetCount: nextProjectThreadLimit(loadedCount),
      });
    },
    [snapshots],
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
            backend={{ ...backend, transportMode }}
            foregroundRecoveryActive={backend.id === selectedBackend.id}
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
            silentRefreshVersion={silentRefreshVersion}
            searchQuery={query}
          />
        </div>
      ))}
      <div
        ref={sidebarLayerRef}
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
            searching={searching}
            visibleThreads={scopedThreads}
            totalThreadCount={
              normalizedQuery ? scopedThreads.length : scopedThreadCount
            }
            projectDirectories={projectDirectories}
            hasProjectlessThreads={hasProjectlessThreads}
            projectThreadStates={projectThreadStates}
            projectHasMore={projectHasMore}
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
        transportMode={transportMode}
        onTransportModeChange={onTransportModeChange}
        notificationPreference={notificationPreference}
        onNotificationPreferenceSave={onNotificationPreferenceSave}
        failedNotificationDevices={failedNotificationDevices}
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
