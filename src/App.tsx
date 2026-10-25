import { useThreadRename } from "./ui/thread-rename";
import { summarizeThreadTitle } from "./backends/title-summary";
import { validUploadUsage, mergeUploadUsage } from './app-server/upload-usage';
import { normalizeHEICFiles } from './ui/heic';
import { replaceUserMessageBody } from '../server/user-message-format';
import { quoteInput, splitQuoteInput, validateMessageQuote, type MessageQuote, type SelectionQuote } from './features/conversation/message-quotes';
import { useSidechatExpiry } from './sidechat/use-expiry';
import { SidechatSessions, gatewaySidechatClient } from './sidechat/sessions';
import { markLoadProfile } from './diagnostics/conversation-load-profile';
import { NativeSwitchBoundary, useNativeSwitch, useSwitchRegistry, useSwitchWorkspace } from './native-ui/switch-context';
import { emptyNativeSnapshot } from './native-ui/protocol';
import { useNativeConfirmation } from './native-ui/confirmation';
import { useNativeRuntime, useNativeWorkspace } from "./native-ui/adapters";
import { useNativeConversationAdapter } from "./native-ui/workspace-adapter";
import { isNativeUIEnabled, type NativeRuntime } from "./native-ui/runtime";
import { projectNavigation, projectNavigationLoading } from "./native-ui/projection";
import { projectNativeBackends, projectNativePreferences } from "./native-ui/device-panel";
import { readFontSize } from "./ui/font-size";
import { createLatestClientRefresh } from "./app-server/latest-client-refresh";
import { assertNativeAttachmentSelection } from "./native-ui/attachment-import";
import { resolveNativeNewChatTarget, type NativeNewChatTarget } from "./native-ui/new-chat-target";
import { readDesktopPinnedThreads, setDesktopThreadPinned } from "../server/desktop-thread-pins";
import { isClientForeground } from "./native-ui/foreground";
import { DraftsSheet } from "./features/drafts/DraftsSheet";
import {
  newChatDraftStore,
  restoreNewChatDraft,
  type SavedNewChatDraft,
  type SavedDraftReference,
} from "./features/drafts/new-chat-drafts";
import { flushSync } from "react-dom";
import {
  FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppServerClient, type RpcMessage } from "./app-server/client";
import { HttpOperationPendingError, transportUuid } from "./backends/http-transport";
import {
  buildEditedHistoryInput,
  createHistoricalMessageEditTarget,
  revertHistoricalMessage,
  type HistoricalMessageEditTarget,
} from "./app-server/history-edit";
import {
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
  loadRunningTurnCommentary,
  applyTurnCommentary,
  runningTurnNeedingCommentary,
  prependUniqueTurns,
  resumeThreadSession,
  type OlderTurnsLoadState,
  type ThreadAccessMode,
} from "./app-server/thread-session";
import {
  activeTurnId,
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
} from "./features/conversation/ConversationPage";
import {
  ThreadListPage,
  type ThreadManagementAction,
} from "./features/threads/ThreadListPage";
import { ApprovalSheet } from "./features/approvals/ApprovalSheet";
import { useApprovalRequests } from "./features/approvals/useApprovalRequests";
import { isAsyncQuestion, sendAsyncQuestionAnswer } from "./features/approvals/async-questions";
import { approvalKey, approvalResponse, questionResponse, type ApprovalDecision } from "./features/approvals/approval-model";
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
import { uploadDraftImages, uploadFile } from "./backends/file-upload";
import { followUpRequest, HostedQueueSubmission, HostedQueueError, type HostedFollowUp, type FollowUpAction } from "./backends/follow-ups";
import type { QueuedFollowUpPreview } from "./features/conversation/ConversationPage";
import {
  runWorkspaceBootstrap,
  shouldResumeWorkspaceThread,
} from "./backends/workspace-bootstrap";
import { AsyncValueCache } from "./lib/async-value-cache";
import { pathBasename } from "./lib/path-basename";
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
  isProjectCollapsed,
  toggleProjectCollapsedKeys,
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
  replacePinnedThreadIds,
  writeThreadPinned,
} from "./features/threads/thread-pinning";
import {
  bindRunCompletionNavigation,
  completionThreadTitle,
  notifyRunCompleted,
  requestRunCompletionNotificationPermission,
  type RunCompletionNavigationTarget,
} from "./notifications/run-completion";
import { QuestionNotificationTracker } from "../server/question-notifications";
import { FinalAnswerCompletionTracker } from "../server/final-answer-completion";
import { t, useI18n } from "./i18n";
import { readNotificationPreference, writeNotificationPreference, useNotificationSync, type NotificationPreference } from "./notifications/preferences";

type AnyRecord = Record<string, any>;

interface AutomaticTitleState {
  status: "pending" | "saving" | "complete" | "closed";
  savePromise?: Promise<void>;
}

interface QueuedFollowUp extends QueuedFollowUpPreview {
  quotes?: MessageQuote[];
  referencePrefix?: string;
  hosted?: boolean;
  revision?: number;
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
  conversationProject?: string;
  threads: AnyRecord[];
  projects: string[];
  projectlessThreadIds: string[];
  projectThreadStates: Record<string, ProjectThreadLoadState>;
  projectHasMore: Record<string, boolean>;
  projectLoadedCounts: Record<string, number>;
  loadingProjectCwd: string;
  refreshing: boolean;
  threadListRefreshing: boolean;
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
  savedDraft?: SavedNewChatDraft;
  savedDraftReference?: SavedDraftReference;
  managementAction?: ThreadManagementAction;
  name?: string;
  onComplete?: (completed: boolean) => void;
}

interface BackendWorkspaceProps {
  nativeRuntime: NativeRuntime | null;
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
    savedDraftReference?: SavedDraftReference,
  ) => void;
  command: WorkspaceCommand | null;
  refreshVersion: number;
  silentRefreshVersion: number;
  searchQuery: string;
}

function BackendWorkspace({
  nativeRuntime,
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
  const [sidechats] = useState(() => new SidechatSessions(backend.id, window.localStorage));
  const [, setSidechatRevision] = useState(0);
  const sidechatRestoredRef = useRef(false);
  const sidechatParentsRef = useRef(new Map<string, AnyRecord>());
  const restoredWorkspace = useNativeSwitch()?.restored.get(backend.id);
  const threadRename = useThreadRename();
  const confirmWorkspaceAction = useNativeConfirmation(isNativeUIEnabled() ? nativeRuntime : null, `workspace:${backend.id}`);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [threads, setThreads] = useState<AnyRecord[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [newChatProjectCatalogReady, setNewChatProjectCatalogReady] = useState(false);
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
  const [active, setActive] = useState<AnyRecord | null>(() => restoredWorkspace?.thread ? { ...restoredWorkspace.thread, turns: [] } : isNativeUIEnabled() ? { id: "", turns: [], preview: t("新会话"), cwd: null } : null);
  const [quotes, setQuotesState] = useState<MessageQuote[]>([]);
  const quotesRef = useRef<MessageQuote[]>([]);
  const [quoteFocusToken, setQuoteFocusToken] = useState('');
  const setQuotes = (value: SetStateAction<MessageQuote[]>) => { quotesRef.current = typeof value === 'function' ? value(quotesRef.current) : value; setQuotesState(quotesRef.current); };
  const familyDraftsRef = useRef(new Map<string, { text: string; images: DraftImage[]; files: DraftFile[]; quotes: MessageQuote[]; inputRevision: number }>());
  const sidechatDraftIdsRef = useRef(new Set<string>());
  const [draft, setDraft] = useState(restoredWorkspace?.text ?? "");
  const savedDraftRef = useRef<SavedDraftReference | undefined>(restoredWorkspace?.savedDraftReference);
  const restoredDraftSettingsRef = useRef<SavedNewChatDraft["settings"] | null>(restoredWorkspace?.settings ?? null);
  // 仅首轮同线程恢复保留检查点中的本地待发送设置；普通重连仍同步服务器设置。
  const checkpointThreadSettingsRef = useRef(restoredWorkspace?.thread?.id ?? null);
  const draftSavingRef = useRef(false);
  const draftContentVersionRef = useRef(0);
  const draftInputRevisionRef = useRef(0);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState("");
  const [draftImages, setDraftImages] = useState<DraftImage[]>(restoredWorkspace?.images ?? []);
  const [draftFiles, setDraftFiles] = useState<DraftFile[]>(restoredWorkspace?.files ?? []);
  const currentDraftRef = useRef({ text: draft, images: draftImages, files: draftFiles });
  const sendingDraftContextsRef = useRef(new Set<number>());
  currentDraftRef.current = { text: draft, images: draftImages, files: draftFiles };
  const [historyEdit, setHistoryEditState] = useState<HistoricalMessageEditState | null>(null);
  const historyEditRef = useRef<HistoricalMessageEditState | null>(null);
  const setHistoryEdit = (next: SetStateAction<HistoricalMessageEditState | null>) => {
    historyEditRef.current = typeof next === 'function' ? next(historyEditRef.current) : next;
    setHistoryEditState(historyEditRef.current);
  };
  const [imageReading, setImageReading] = useState(false);
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const setBusy = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusyState(value);
  }, []);
  const [startingThreadContext, setStartingThreadContext] = useState<
    number | null
  >(null);
  const [steering, setSteering] = useState(false);
  const [queueSaving, setQueueSaving] = useState(false);
  const [pendingSteerMessage, setPendingSteerMessage] =
    useState<PendingSteerMessage | null>(null);
  const [queuedFollowUps, setQueuedFollowUps] = useState<QueuedFollowUp[]>([]);
  const [error, setError] = useState("");
  const approvalRequests = useApprovalRequests();
  const { requests, approval, userAnswers } = approvalRequests;
  useEffect(() => { approvalRequests.syncAsyncQuestions(active); }, [active, approvalRequests.syncAsyncQuestions]);
  const [syncState, setSyncState] = useState<{ updatedAt: number | null; stale: boolean } | null>(null);
  const [models, setModels] = useState<AnyRecord[]>([]);
  const [permissionProfiles, setPermissionProfiles] = useState<AnyRecord[]>([]);
  const [selectedModel, setSelectedModel] = useState(restoredWorkspace?.settings.model ?? "");
  const [selectedEffort, setSelectedEffort] = useState<string | null>(restoredWorkspace?.settings.effort ?? null);
  const [selectedServiceTier, setSelectedServiceTier] = useState<string | null>(restoredWorkspace?.settings.serviceTier ?? null);
  const [selectedPermission, setSelectedPermission] = useState(restoredWorkspace?.settings.permissions ?? "");
  const [selectedApprovalPolicy, setSelectedApprovalPolicy] =
    useState<ApprovalPolicy>(restoredWorkspace?.settings.approvalPolicy ?? "on-request");
  const [selectedApprovalsReviewer, setSelectedApprovalsReviewer] =
    useState<ApprovalsReviewer>(restoredWorkspace?.settings.approvalsReviewer ?? "user");
  useEffect(() => {
    draftContentVersionRef.current += 1;
    setDraftSaveStatus("");
  }, [draft, draftImages, draftFiles, active?.cwd, selectedModel, selectedEffort,
    selectedServiceTier, selectedPermission, selectedApprovalPolicy, selectedApprovalsReviewer]);
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
    useState<ConversationLoadState>(() => restoredWorkspace || isNativeUIEnabled() ? "ready" : "idle");
  const [conversationLoadError, setConversationLoadError] = useState("");
  const [olderTurnsState, setOlderTurnsState] =
    useState<OlderTurnsLoadState>("exhausted");
  const [tokenUsageByThread, setTokenUsageByThread] = useState<
    Record<string, AnyRecord>
  >({});
  const uploadUsageEventRef = useRef<Record<string, number>>({});
  const [uploadUsageByThread, setUploadUsageByThread] = useState<Record<string, AnyRecord | null>>({});
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
  const projectlessLoadRef = useRef<{ client: AppServerClient; pending: boolean } | null>(null);
  const readyClientRef = useRef<AppServerClient | null>(null);
  const pinnedClientRef = useRef<AppServerClient | null>(null);
  const pinnedRevisionRef = useRef(0);
  const pinMutationRef = useRef(false);
  const pinRefreshRef = useRef<{ client: AppServerClient; promise: Promise<void> } | null>(null);
  const connectionManagerRef = useRef<BackendConnectionManager | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageReadGenerationRef = useRef(new ImageReadGeneration());
  const draftContextGenerationRef = useRef(0);
  const pendingNewChatProjectRef = useRef<number | null>(null);
  const activeRef = useRef<AnyRecord | null>(active);
  const threadsRef = useRef<AnyRecord[]>([]);
  const modelsRef = useRef<AnyRecord[]>([]);
  const selectedModelRef = useRef("");
  const selectedEffortRef = useRef<string | null>(null);
  const selectedServiceTierRef = useRef<string | null>(null);
  const conversationVisibleRef = useRef(conversationVisible);
  const foregroundRecoveryActiveRef = useRef(foregroundRecoveryActive);
  const activeThreadTargetRef = useRef<string | null>(null);
  const openSequenceRef = useRef(0);
  const commentaryRecoveryRef = useRef<{ client: AppServerClient; key: string; promise: Promise<void> } | null>(null);
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
  const queueRequestSequenceRef = useRef(0);
  const queueMutatingRef = useRef(false);
  const queueSubmissionsRef = useRef(new Map<string, HostedQueueSubmission>());
  const queueSubmittingThreadIdsRef = useRef(new Set<string>());
  const unconfirmedQueueDraftsRef = useRef(new Map<string, { text: string; images: DraftImage[]; files: DraftFile[]; quotes: MessageQuote[]; inputRevision: number }>());
  const completionEventCatchUpRef = useRef(false);
  const questionNotificationRef = useRef(new QuestionNotificationTracker());
  const finalAnswerCompletionRef = useRef(new FinalAnswerCompletionTracker());
  const mobileCompletionRef = useRef(new FinalAnswerCompletionTracker({
    requireMobileOrigin: true,
    isThreadFollowed: (threadId) => pinnedClientRef.current !== null && pinnedClientRef.current === clientRef.current && readPinnedThreadIds(localStorage, backend.id).has(threadId),
  }));
  const automaticTitleStatesRef = useRef(
    new Map<string, AutomaticTitleState>(),
  );
  const automaticTitleStreamsRef = useRef(new Map<string, string>());
  // 显式名称事件（含清空）优先于可能迟到的列表摘要。
  const confirmedThreadNamesRef = useRef(new Set<string>());
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

  function updateThreadNameLocally(threadId: string, name: string | null) {
    confirmedThreadNamesRef.current.add(threadId);
    setThreads((current) => {
      const next = applyThreadNameUpdateToList(current, threadId, name);
      threadsRef.current = next;
      return next;
    });
    setSearchResults((current) => applyThreadNameUpdateToList(current, threadId, name));
    setActive((current) => {
      const next = applyThreadNameUpdate(current, threadId, name);
      activeRef.current = next;
      return next;
    });
  }

  function recoverActiveThreadName(thread: AnyRecord) {
    const threadId = String(thread.id ?? "");
    if (confirmedThreadNamesRef.current.has(threadId) ||
      activeRef.current?.id !== threadId || activeRef.current?.name?.trim() ||
      typeof thread.name !== "string" || !thread.name.trim()) return;
    // 名称已保存但通知漏收时，利用已有元数据回填当前页，不重复总结或写入。
    const automaticTitle = automaticTitleStatesRef.current.get(threadId);
    if (automaticTitle?.status === "pending" ||
      (automaticTitle?.status === "saving" && !automaticTitle.savePromise)) automaticTitle.status = "closed";
    updateThreadNameLocally(threadId, thread.name);
  }

  function requestAutomaticTitle(client: AppServerClient, threadId: string, confirmedItems: AnyRecord[]) {
    const state = automaticTitleStatesRef.current.get(threadId);
    if (!state || state.status !== "pending") return;
    // turn/start 的受理回执可能先于用户消息落盘；只用服务端确认的消息触发总结。
    if (!confirmedItems.some(item => item.type === "userMessage")) return;
    state.status = "saving";
    void summarizeThreadTitle(backend, threadId, { automatic: true }).then(async title => {
      if (state.status !== "saving") return;
      state.savePromise = client.request("thread/name/set", { threadId, name: title }).then(() => {
        if (state.status !== "saving") return;
        state.status = "complete";
        updateThreadNameLocally(threadId, title);
      });
      await state.savePromise;
    }).catch(() => { if (state.status === "saving") state.status = "closed"; });
  }

  function stripLegacyTitleText(text: string) {
    return extractGeneratedTitle(text).text;
  }

  function sanitizeAgentItem(
    _client: AppServerClient,
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
      text: stripLegacyTitleText(item.text),
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
  ]);
  const setRemotePinned = async (client: AppServerClient, threadId: string, isPinned: boolean, sourceThread?: AnyRecord) => {
    if (pinMutationRef.current) throw new Error(t("正在更新置顶状态"));
    pinMutationRef.current = true;
    pinnedRevisionRef.current++;
    try {
      await setDesktopThreadPinned((method, params) => client.request(method, params), threadId, isPinned);
      if (client !== clientRef.current || client.signal?.aborted) return false;
      writeThreadPinned(localStorage, backend.id, threadId, isPinned);
      const update = (current: AnyRecord[]) =>
        current.map((entry) =>
          String(entry.id) === threadId ? { ...entry, isPinned } : entry,
        );
      setThreads((current) => {
        const next = update(current);
        if (isPinned && sourceThread && !next.some((thread) => String(thread.id) === threadId)) {
          next.push({ ...sourceThread, isPinned });
        }
        return next;
      });
      setSearchResults(update);
      setActive((current) =>
        String(current?.id ?? "") === threadId
          ? { ...current, isPinned }
          : current,
      );
      showNotice(isPinned ? t("已置顶") : t("已取消置顶"));
      return true;
    } finally {
      pinnedRevisionRef.current++;
      pinMutationRef.current = false;
    }
  };
  async function syncDesktopPinned(client: AppServerClient): Promise<void> {
    if (client !== clientRef.current || client.signal?.aborted || pinMutationRef.current) return;
    if (pinRefreshRef.current?.client === client) return pinRefreshRef.current.promise;
    const revision = pinnedRevisionRef.current;
    const promise = (async () => {
      let data: AnyRecord[];
      try {
        data = await readDesktopPinnedThreads((method, params) => client.request(method, params, { priority: "background" }));
      } catch (reason) {
        if (client !== clientRef.current || client.signal?.aborted || revision !== pinnedRevisionRef.current) return;
        throw reason;
      }
      if (client !== clientRef.current || client.signal?.aborted || revision !== pinnedRevisionRef.current) return;
      const ids = new Set(data.map(thread => String(thread.id)));
      replacePinnedThreadIds(localStorage, backend.id, ids);
      pinnedClientRef.current = client;
      setThreads(current => applyPinnedThreadState(mergeThreadListPage(current, decorateThreads(data), new Set(current.map(thread => String(thread.id)))), ids));
      setSearchResults(current => applyPinnedThreadState(current, ids));
      setActive(current => current && current.isPinned !== ids.has(String(current.id)) ? { ...current, isPinned: ids.has(String(current.id)) } : current);
    })().finally(() => { if (pinRefreshRef.current?.promise === promise) pinRefreshRef.current = null; });
    pinRefreshRef.current = { client, promise };
    return promise;
  }
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
  const threadRefreshRef = useRef<ReturnType<typeof createLatestClientRefresh<AppServerClient>> | null>(null);
  if (!threadRefreshRef.current) threadRefreshRef.current = createLatestClientRefresh<AppServerClient>();
  const [threadListRefreshing, setThreadListRefreshing] = useState(false);
  const [projectLoadedCounts, setProjectLoadedCounts] = useState<Record<string, number>>({});
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
        if (data.length) setThreadListState("ready");
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
      },
      onProjectStart(cwd) {
        setProjectThreadStates((current) => ({
          ...current,
          [cwd]: "loading",
        }));
      },
      onProjectData(cwd, data, hasMore, nextCursor) {
        setProjectLoadedCounts(current => ({ ...current, [cwd]: data.length }));
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
        if (data.length) setThreadListState("ready");
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
    const id = String(active?.id ?? '');
    if (!id || connection !== 'online' || !client) return;
    let cancelled = false;
    const eventRevision = uploadUsageEventRef.current[id] ?? 0;
    void client.request<{ usage: AnyRecord | null }>('mobile/uploadUsage/read', { threadId: id }).then(result => {
      if (cancelled || client !== clientRef.current || eventRevision !== (uploadUsageEventRef.current[id] ?? 0)) return;
      setUploadUsageByThread(current => ({ ...current, [id]: validUploadUsage(result.usage) ? mergeUploadUsage(current[id], result.usage) : null }));
    }).catch(() => {
      if (!cancelled && client === clientRef.current && eventRevision === (uploadUsageEventRef.current[id] ?? 0)) setUploadUsageByThread(current => ({ ...current, [id]: null }));
    });
    return () => { cancelled = true; };
  }, [active?.id, connection]);

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
      familyDraftsRef.current.forEach(draft => draft.files.forEach(file => URL.revokeObjectURL(file.previewUrl)));
      unconfirmedQueueDraftsRef.current.forEach((draft) => draft.files.forEach((file) => URL.revokeObjectURL(file.previewUrl)));
    },
    [],
  );

  useEffect(() => {
    if (!queuedFollowUps.some((item) => !item.hosted)) return;
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
    return threadRefreshRef.current!.run(client, async () => {
      if (client !== clientRef.current || client.signal?.aborted) return;
      setThreadListRefreshing(true);
      try {
        await syncDesktopPinned(client);
        if (client !== clientRef.current || client.signal?.aborted) return;
        let projectCatalogReadSucceeded = false;
        let directories = projects;
        let nextProjectlessThreadIds = mergeProjectlessThreadIds(
          projectlessThreadIds,
          readLocalProjectlessThreadIds(window.localStorage, backend.id),
        );
        try {
          const projectState = await fetchBackendProjectState(backend, "background", client.signal);
          if (client !== clientRef.current || client.signal?.aborted) return;
          projectCatalogReadSucceeded = true;
          directories = projectState.projects;
          nextProjectlessThreadIds = mergeProjectlessThreadIds(
            projectState.projectlessThreadIds,
            readLocalProjectlessThreadIds(window.localStorage, backend.id),
          );
          setProjects(directories);
          setProjectlessThreadIds(nextProjectlessThreadIds);
        } catch {
          if (client !== clientRef.current || client.signal?.aborted) return;
        }
        const collapsed = readCollapsedProjectKeys(window.localStorage);
        await threadListLoaderRef.current!.load(
          client,
          directories,
          nextProjectlessThreadIds,
          {
            ...options,
            pinnedThreadIds: [...readLocalPinned()],
            prioritizedThreadIds: [...readPrioritizedThreadIds()],
            includeRunningThreads: true,
            rememberedRunningThreadIds: threadsRef.current.filter(thread => isThreadRunning(thread.status)).map(thread => String(thread.id)),
            preferredProjectCwds: [...directories, PROJECTLESS_GROUP_ID].filter(cwd =>
              !isProjectCollapsed(collapsed, backend.id, cwd)),
            expandedProjectCwds: [...directories, PROJECTLESS_GROUP_ID].filter(cwd =>
              !isProjectCollapsed(collapsed, backend.id, cwd)),
          },
        );
        // 目录失败或线程总加载失败都不能证明保存项目已失效，保留待恢复上下文供重试。
        if (projectCatalogReadSucceeded && client === clientRef.current && !client.signal?.aborted) {
          setNewChatProjectCatalogReady(true);
        }
      } catch (reason) {
        if (client !== clientRef.current || client.signal?.aborted) return;
        setThreadListState((current) =>
          current === "loading" ? "error" : current,
        );
        throw reason;
      } finally {
        if (client === clientRef.current && !client.signal?.aborted) setThreadListRefreshing(false);
      }
    });
  }

  function applyActiveThreadSnapshot(incoming: AnyRecord) {
    setActive((current) => {
      const next = reconcileThreadSnapshot(current, incoming);
      activeRef.current = next;
      setBusy(["inProgress", "in_progress", "running"].includes(String(next.turns?.at(-1)?.status ?? "")));
      return next;
    });
  }

  function backfillRunningCommentary(client: AppServerClient, threadId: string, turns: AnyRecord[]) {
    const turn = runningTurnNeedingCommentary(turns);
    if (!turn) return Promise.resolve();
    const generation = openSequenceRef.current;
    const key = `${generation}:${threadId}:${turn.id}`;
    const pending = commentaryRecoveryRef.current;
    if (pending?.client === client && pending.key === key) return pending.promise;
    const recovery = { client, key, promise: Promise.resolve() };
    recovery.promise = loadRunningTurnCommentary(client, threadId, turns).then((detail) => {
      if (!detail || generation !== openSequenceRef.current || client !== clientRef.current ||
        activeThreadTargetRef.current !== threadId) return;
      setActive((current) => {
        if (current?.id !== threadId || generation !== openSequenceRef.current || client !== clientRef.current) return current;
        const next = { ...current, turns: applyTurnCommentary(current.turns ?? [], detail) };
        activeRef.current = next;
        return next;
      });
    }).catch(() => {
      // 历史恢复失败不阻断首屏与实时回复；不向旧网关回退全量拉取。
    }).finally(() => {
      if (commentaryRecoveryRef.current === recovery) commentaryRecoveryRef.current = null;
    });
    commentaryRecoveryRef.current = recovery;
    return recovery.promise;
  }

  async function reconcileActiveThread(
    client: AppServerClient,
    isCurrent: () => boolean = () => true,
    completedTurnId?: string,
    recoverCommentary = false,
  ) {
    const threadId = String(
      activeThreadTargetRef.current ?? activeRef.current?.id ?? "",
    );
    if (!threadId || client !== clientRef.current || sidechats.get(threadId)) return;
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

    // 回合对账同时补齐遗漏的名称事件；正文仍使用分页回合接口。
    if (!activeRef.current?.name?.trim() && !confirmedThreadNamesRef.current.has(threadId)) {
      void client.request<{ thread: AnyRecord }>("thread/read", { threadId, includeTurns: false })
        .then(result => {
          if (client === clientRef.current && isLatest() && result.thread?.id === threadId) recoverActiveThreadName(result.thread);
        }).catch(() => undefined);
    }
    const hasPendingOperation = [...pendingOperationsRef.current.values()].some((operation) => operation.threadId === threadId);
    requestAutomaticTitle(client, threadId, latestTurns.flatMap((turn: AnyRecord) => turn.items ?? []));
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
    if (recoverCommentary) void backfillRunningCommentary(client, threadId, latestTurns);
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
      conversationProject: active?.id ? (active.isProjectless === true ? '' : active.cwd ?? '') : undefined,
      threads,
      projects,
      projectlessThreadIds,
      projectThreadStates,
      projectHasMore,
      projectLoadedCounts,
      loadingProjectCwd,
      refreshing,
      threadListRefreshing,
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
    active?.id,
    active?.cwd,
    active?.isProjectless,
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
    projectLoadedCounts,
    loadingProjectCwd,
    refreshing,
    threadListRefreshing,
  ]);

  useEffect(() => {
    const refreshPins = () => {
      const client = clientRef.current;
      if (!client || !isClientForeground()) return;
      void syncDesktopPinned(client).catch(reason => {
        if (client === clientRef.current && !client.signal?.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      });
    };
    const timer = window.setInterval(refreshPins, 3000);
    window.addEventListener("online", refreshPins);
    document.addEventListener("visibilitychange", refreshPins);
    return () => { window.clearInterval(timer); window.removeEventListener("online", refreshPins); document.removeEventListener("visibilitychange", refreshPins); };
  }, [backend.id]);

  useEffect(() => {
    if (!refreshVersion) return;
    setError("");
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
        if (status === "connecting" || status === "offline") {
          projectlessLoadRef.current = null;
          setLoadingProjectCwd((current) => current === PROJECTLESS_GROUP_ID ? "" : current);
        }
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
          approvalRequests.reset();
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
          const closedSide = message.method === 'thread/closed' ? sidechats.get(String(params.threadId ?? '')) : undefined;
          if (message.method === 'mobile/uploadUsage/updated' && params.threadId && validUploadUsage(params.usage)) {
            uploadUsageEventRef.current[params.threadId] = (uploadUsageEventRef.current[params.threadId] ?? 0) + 1;
            setUploadUsageByThread(current => ({ ...current, [params.threadId]: mergeUploadUsage(current[params.threadId], params.usage) }));
            return;
          }
          if (sidechats.observe(message)) {
            if (closedSide && !closedSide.closing && !sidechats.get(closedSide.id)) {
              if (String(activeRef.current?.id ?? '') === closedSide.id) {
                openThread(sidechatParentsRef.current.get(closedSide.parentId) ?? { id: closedSide.parentId });
                setError(t('Sidechat 已失效，daemon 可能已重启，请返回主聊天重新创建'));
              }
              clearFamilyDraft(closedSide.id);
            }
            return;
          }
          questionNotificationRef.current.observe(message, completionEventCatchUpRef.current);
          if (approvalRequests.onNotification(message)) return;
          for (const tracker of [finalAnswerCompletionRef.current, mobileCompletionRef.current]) {
            for (const thread of threadsRef.current) tracker.rememberThread(thread);
            tracker.rememberThread(activeRef.current);
          }
          // 来源确认可迟于实时完成；历史追赶期间只登记来源，不收集完成证据。
          const acceptedMobileTurn = message.method === "mobile/turn/accepted"
            ? mobileCompletionRef.current.observeRpc(params.request, params.response) : null;
          const completedMobileTurn = completionEventCatchUpRef.current ? null
            : acceptedMobileTurn ?? mobileCompletionRef.current.observe(message);
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
              documentVisible: isClientForeground(),
            });
            if (attentionAction === "mark-unread") {
              markThreadUnread(threadId);
            } else if (attentionAction === "mark-read") {
              markThreadRead(threadId);
            }
          }
          if (completedMobileTurn) {
            const { threadId } = completedMobileTurn;
            if (finalAnswerAttentionAction({
              item: { type: "agentMessage", phase: "final_answer" },
              catchingUp: false,
              hasQueuedFollowUp: queuedFollowUpsRef.current.some((followUp) => followUp.threadId === threadId),
              threadId,
              activeThreadId: String(activeRef.current?.id ?? ""),
              conversationVisible: conversationVisibleRef.current,
              documentVisible: isClientForeground(),
            }) === "mark-unread") {
              notifyRunCompleted({
                title: t("Codex 运行结束"),
                body: completionThreadTitle({
                  threadId,
                  threads: threadsRef.current,
                  activeThread: activeRef.current,
                  fallback: t("新会话"),
                }),
                backendId: backend.id,
                threadId,
              });
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
            void reconcileActiveThread(client, () => true, undefined, true).catch(() => undefined);
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
              (automaticTitle?.status === "pending" || (automaticTitle?.status === "saving" && !automaticTitle.savePromise))
            ) {
              automaticTitle.status = "closed";
            }
            updateThreadNameLocally(threadId, threadName);
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
            const visibleText = stripLegacyTitleText(rawText);
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
            requestAutomaticTitle(client, String(params.threadId ?? ""), [params.item]);
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
            requestAutomaticTitle(client, threadId, params.turn?.items ?? []);
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
            // idle 是另一条结束证据：最终 item 或 turn/completed 漏收、完成时摘要尚未落盘，
            // 都应在当前会话重新核对正文，不能只改侧栏状态而等待用户重进。
            if ((params.status.type ?? params.status) === "idle" &&
              String(activeRef.current?.id ?? "") === String(params.threadId)) {
              void reconcileActiveThread(client).catch(() => undefined);
            }
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
          for (const thread of threadsRef.current) questionNotificationRef.current.rememberThread(thread);
          questionNotificationRef.current.rememberThread(activeRef.current);
          const question = questionNotificationRef.current.observe(request, completionEventCatchUpRef.current);
          if (question) {
            markThreadUnread(question.threadId);
            notifyRunCompleted({
              title: t("Codex 需要你回答"),
              body: completionThreadTitle({ threadId: question.threadId, threads: threadsRef.current,
                activeThread: activeRef.current, fallback: t("新会话") }),
              backendId: backend.id, threadId: question.threadId,
            });
          }
          if (!approvalRequests.receive(request)) {
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
        if (clientRef.current !== client) threadListLoaderRef.current!.invalidate();
        if (projectlessLoadRef.current?.client !== client) {
          projectlessLoadRef.current = null;
          setLoadingProjectCwd((current) => current === PROJECTLESS_GROUP_ID ? "" : current);
        }
        client.onThreadMetadata((thread) => {
          if (!disposed && manager.client(backend.id) === source) {
            recoverActiveThreadName(thread);
            finalAnswerCompletionRef.current.rememberThread(thread);
            mobileCompletionRef.current.rememberThread(thread);
            questionNotificationRef.current.rememberThread(thread);
          }
        });
        clientRef.current = client;
        if (!sidechatRestoredRef.current) {
          sidechatRestoredRef.current = true;
          restoreSidechats(client);
        } else {
          for (const side of sidechats.all()) side.client = gatewaySidechatClient(client);
          restoreSidechats(client);
        }
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
                loadRateLimits: async (options) => {
                  const result = await client.request<AnyRecord>(
                    "account/rateLimits/read",
                    undefined,
                    options,
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
            if (!activeRef.current?.id && !restoredDraftSettingsRef.current) {
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
            // 状态updater可能延后执行，保留本轮恢复语义，不读取随后消费的ref。
            const restoringDraftSettings = restoredDraftSettingsRef.current !== null;
            setSelectedPermission((current) => current || configuredPermission);
            setSelectedApprovalPolicy(
              (current) =>
                restoringDraftSettings ? current : config.approval_policy ||
                (configuredPermission === ":danger-full-access"
                  ? "never"
                  : current),
            );
            setSelectedApprovalsReviewer(
              (current) => restoringDraftSettings ? current : config.approvals_reviewer || current,
            );
            setRefreshing(false);
            const currentThread = activeRef.current;
            if (
              currentThread?.id && !sidechats.get(String(currentThread.id)) &&
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
                void backfillRunningCommentary(client, currentThread.id, resumed.thread.turns ?? []);
                resetOlderTurns(resumed.nextTurnsCursor);
                setConversationLoadState("ready");
                setConversationLoadError("");
                setActiveSettingsSynchronized(resumed.settingsSynchronized);
                setActiveThreadAccessMode(resumed.accessMode);
                setActiveThreadResumeError(resumed.resumeError ?? "");
                if (checkpointThreadSettingsRef.current === String(currentThread.id)) {
                  // 输入设置是本地下一次发送的选择；恢复只接收线程内容与访问状态，不写回服务器。
                  checkpointThreadSettingsRef.current = null;
                  restoredDraftSettingsRef.current = null;
                } else {
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
              (currentClient) => reconcileActiveThread(currentClient, () => true, undefined, true),
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
      projectlessLoadRef.current = null;
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

  function applyHostedQueue(items: HostedFollowUp[]) {
    replaceQueuedFollowUps([
      ...queuedFollowUpsRef.current.filter((item) => !item.hosted),
      ...items.map((item) => ({ ...item, hosted: true,
        inputText: splitQuoteInput(item.inputText).question, referencePrefix: splitQuoteInput(item.inputText).referencePrefix,
        draftContext: draftContextGenerationRef.current,
        images: [], files: [], skills: [], plugins: [], failed: item.state === "failed",
      })),
    ]);
  }

  async function refreshHostedQueue() {
    if (queueMutatingRef.current) return;
    const sequence = ++queueRequestSequenceRef.current;
    const result = await followUpRequest(backend);
    if (sequence === queueRequestSequenceRef.current) applyHostedQueue(result.items);
  }

  async function mutateHostedQueue(action: FollowUpAction) {
    if (queueMutatingRef.current) throw new Error(t("排队消息正在同步，请稍后重试"));
    queueMutatingRef.current = true;
    setQueueSaving(true);
    ++queueRequestSequenceRef.current;
    try {
      const result = await followUpRequest(backend, action);
      applyHostedQueue(result.items);
      return result;
    } finally {
      queueMutatingRef.current = false;
      setQueueSaving(false);
      void refreshHostedQueue().catch(() => undefined);
    }
  }

  useEffect(() => {
    if (connection !== "online") return;
    let stopped = false;
    let inFlight = false;
    const refresh = async () => {
      if (stopped || inFlight || !isClientForeground()) return;
      inFlight = true;
      try { await refreshHostedQueue(); } catch { /* 入队和管理操作会显式报告连接/升级错误。 */ }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      stopped = true;
      ++queueRequestSequenceRef.current;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [connection, active?.id, backend.baseUrl, backend.token]);

  function releaseQueueSubmission(threadId: string, id: string) {
    if (queueSubmissionsRef.current.get(threadId)?.confirmed(id)) unconfirmedQueueDraftsRef.current.delete(threadId);
  }

  async function discardQueuedFollowUpsForThread(threadId: string) {
    if (queueSubmittingThreadIdsRef.current.has(threadId)) throw new Error(t("排队消息正在同步，请稍后重试"));
    if (queueMutatingRef.current) throw new Error(t("排队消息正在同步，请稍后重试"));
    try { await refreshHostedQueue(); } catch (reason) {
      // 旧网关没有托管队列；其普通会话仍可归档。
      if (!(reason instanceof HostedQueueError && reason.status === 404 &&
        !queuedFollowUpsRef.current.some((item) => item.hosted && item.threadId === threadId))) throw reason;
    }
    if (queueSubmittingThreadIdsRef.current.has(threadId)) throw new Error(t("排队消息正在同步，请稍后重试"));
    for (const followUp of queuedFollowUpsForThread(queuedFollowUpsRef.current, threadId)) {
      if (followUp.hosted) {
        await mutateHostedQueue({ action: "cancel", id: followUp.id, revision: followUp.revision! });
        releaseQueueSubmission(threadId, followUp.id);
      } else {
        followUp.files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
        replaceQueuedFollowUps(removeQueuedFollowUp(queuedFollowUpsRef.current, followUp.id));
      }
    }
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
    checkpointThreadSettingsRef.current = null;
    draftContextGenerationRef.current += 1;
    savedDraftRef.current = undefined;
    restoredDraftSettingsRef.current = null;
    draftSavingRef.current = false;
    setDraftSaving(false);
    setDraftSaveStatus("");
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

  useEffect(() => sidechats.subscribe(() => {
    setSidechatRevision(value => value + 1);
    const selectedId = String(activeRef.current?.id ?? '');
    for (const id of sidechatDraftIdsRef.current) if (id !== selectedId && !sidechats.get(id)) clearFamilyDraft(id);
    const side = sidechats.get(selectedId);
    if (side) {
      activeRef.current = side.thread;
      setActive(side.thread); setBusy(side.busy || side.sending); setError(side.error);
    }
  }), [sidechats]);
  useSidechatExpiry(sidechats, () => clientRef.current, () => String(activeRef.current?.id ?? ''),
    side => { openThread(sidechatParentsRef.current.get(side.parentId) ?? { id: side.parentId }); clearFamilyDraft(side.id); },
    reason => setError(String((reason as Error).message ?? reason)));


  function restoreSidechats(client: AppServerClient) {
    const selected = sidechats.get(String(activeRef.current?.id ?? ''));
    void sidechats.restore(gatewaySidechatClient(client)).catch(reason => {
      if (clientRef.current !== client) return;
      if (selected && !sidechats.get(selected.id) && String(activeRef.current?.id ?? '') === selected.id) {
        openThread(sidechatParentsRef.current.get(selected.parentId) ?? { id: selected.parentId });
      }
      for (const id of sidechatDraftIdsRef.current) if (!sidechats.get(id)) clearFamilyDraft(id);
      setError(String(reason.message ?? reason));
    });
  }

  function addQuote(quote: MessageQuote) {
    if (activeThreadAccessMode !== 'interactive' || historyEditRef.current) throw new Error(t('当前会话只读'));
    setQuotes(current => [...current, quote]); setQuoteFocusToken(transportUuid());
  }
  function cacheFamilyDraft() {
    const id = String(activeRef.current?.id ?? '');
    if (id && (sidechats.get(id) || sidechats.forParent(id).length)) {
      familyDraftsRef.current.set(id, { ...currentDraftRef.current, quotes: [...quotesRef.current], inputRevision: draftInputRevisionRef.current });
    }
  }
  function clearFamilyDraft(id: string) {
    const saved = familyDraftsRef.current.get(id);
    saved?.files.forEach(file => URL.revokeObjectURL(file.previewUrl));
    familyDraftsRef.current.delete(id); sidechatDraftIdsRef.current.delete(id);
    for (const [parentId, draft] of familyDraftsRef.current) {
      if (!sidechats.get(parentId) && !sidechats.forParent(parentId).length) {
        const activeURLs = new Set([...currentDraftRef.current.files, ...[...unconfirmedQueueDraftsRef.current.values()].flatMap(draft => draft.files)].map(file => file.previewUrl));
        draft.files.forEach(file => { if (!activeURLs.has(file.previewUrl)) URL.revokeObjectURL(file.previewUrl); });
        familyDraftsRef.current.delete(parentId);
      }
    }
  }
  async function createSidechat(quote?: MessageQuote) {
    const client = clientRef.current; const current = activeRef.current;
    if (!client || !current?.id) throw new Error(t('设备尚未连接，请稍后重试'));
    if (quote && sidechats.get(String(current.id))) throw new Error(t('请从主聊天创建 Sidechat'));
    const parentId = sidechats.get(String(current.id))?.parentId ?? String(current.id);
    const parent = sidechatParentsRef.current.get(parentId) ?? (current.id === parentId ? current : { id: parentId, cwd: current.cwd });
    sidechatParentsRef.current.set(parentId, parent);
    const sequence = openSequenceRef.current;
    const side = await sidechats.create(gatewaySidechatClient(client), parent);
    sidechatDraftIdsRef.current.add(side.id);
    if (quote) familyDraftsRef.current.set(side.id, { text: '', images: [], files: [], quotes: [quote], inputRevision: 0 });
    if (sequence === openSequenceRef.current) { openThread(side.thread); if (quote) setQuoteFocusToken(transportUuid()); }
    return true;
  }
  function returnFromSidechat() {
    const side = sidechats.get(String(activeRef.current?.id ?? ''));
    if (side) openThread(sidechatParentsRef.current.get(side.parentId) ?? { id: side.parentId });
  }
  function openSidechat(id: string) {
    const side = sidechats.get(id);
    const current = String(activeRef.current?.id ?? '');
    const parent = sidechats.get(current)?.parentId ?? current;
    if (!side || side.parentId !== parent) throw new Error(t('Sidechat 已失效或不属于当前主聊天'));
    if (side.restoring) throw new Error(t('Sidechat 正在恢复，请稍候'));
    openThread(side.thread);
  }
  async function closeSidechat(id: string) {
    const client = clientRef.current; const side = sidechats.get(id);
    const current = String(activeRef.current?.id ?? '');
    if (!client || !side || side.parentId !== (sidechats.get(current)?.parentId ?? current)) throw new Error(t('Sidechat 不可用'));
    const context = draftContextGenerationRef.current;
    if (!await confirmWorkspaceAction(t('确定关闭 Sidechat 吗？正在执行的任务将停止，临时聊天和待发消息会被清理，已发生的文件修改不会撤销。'))) return;
    if (context !== draftContextGenerationRef.current || clientRef.current !== client || sidechats.get(id) !== side) throw new Error(t('会话已切换，请重试'));
    await sidechats.close(gatewaySidechatClient(client), id);
    if (String(activeRef.current?.id ?? '') === id) openThread(sidechatParentsRef.current.get(side.parentId) ?? { id: side.parentId });
    clearFamilyDraft(id);
  }

  async function loadThreadDetail(threadId: string, sequence: number) {
    const client = clientRef.current;
    try {
      if (!client) throw new Error(t("设备尚未连接，请稍后重试"));
      const session = await resumeThreadSession(client, threadId);
      markLoadProfile(threadId, 'details-ready', { turns: session.thread?.turns?.length ?? 0 });
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
      void backfillRunningCommentary(client, threadId, session.thread.turns ?? []);
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
      markLoadProfile(threadId, 'state-updated');

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
        name: pathBasename(normalized) || normalized,
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
        name: pathBasename(cwd) || cwd,
      });
    }
    return options;
  }, [projects, threads]);

  function rememberedNewChatProject() {
    const savedCwd = window.localStorage.getItem(`codex-mobile:new-chat-project:${backend.id}`);
    return savedCwd === "" ? null :
      projectOptions.find((project) => project.cwd === savedCwd)?.cwd || projectOptions[0]?.cwd || null;
  }

  useEffect(() => {
    const context = pendingNewChatProjectRef.current;
    if (!newChatProjectCatalogReady || context === null) return;
    pendingNewChatProjectRef.current = null;
    if (context !== draftContextGenerationRef.current) return;
    const cwd = rememberedNewChatProject();
    setActive((current) => {
      if (!current || current.id || context !== draftContextGenerationRef.current) return current;
      const next = { ...current, cwd };
      activeRef.current = next;
      return next;
    });
  }, [newChatProjectCatalogReady, projectOptions]);

  function openThread(thread: AnyRecord) {
    markLoadProfile(String(thread.id), 'workspace-open');
    const nextId = String(thread.id);
    cacheFamilyDraft();
    const sequence = ++openSequenceRef.current;
    markThreadRead(nextId);
    resetDraftContext();
    setQuotes([]);
    rebindQueuedThread(nextId);
    setImageReading(queueSubmittingThreadIdsRef.current.has(nextId));
    const unconfirmedDraft = unconfirmedQueueDraftsRef.current.get(nextId);
    const saved = familyDraftsRef.current.get(nextId);
    const restored = saved ?? unconfirmedDraft;
    draftInputRevisionRef.current = restored?.inputRevision ?? 0;
    const next = { text: restored?.text ?? '', images: restored?.images ?? [], files: restored?.files ?? [] };
    for (const file of currentDraftRef.current.files) {
      const retained = [...familyDraftsRef.current.values(), ...unconfirmedQueueDraftsRef.current.values()].some(draft => draft.files.some(item => item.id === file.id));
      if (!retained) URL.revokeObjectURL(file.previewUrl);
    }
    currentDraftRef.current = next;
    setDraft(next.text); setDraftImages(next.images); setDraftFiles(next.files); setQuotes(saved?.quotes ?? unconfirmedDraft?.quotes ?? []);
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
    const side = sidechats.get(String(thread.id));
    if (side) {
      sidechatDraftIdsRef.current.add(side.id);
      activeRef.current = side.thread; setActive(side.thread);
      setBusy(side.busy || side.sending); setError(side.error);
      syncStartedThreadSettings(side.settings);
      setActiveSettingsSynchronized(true); setConversationLoadState('ready'); setOpeningThreadId('');
      sidechats.touch(side.id);
    } else void loadThreadDetail(thread.id, sequence);
  }

  function retryThreadDetail() {
    if (sidechats.get(String(activeRef.current?.id ?? ''))) { setError('Sidechat 为临时聊天；失效后请返回主聊天重新创建'); return; }
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
    onSent,
  }: {
    text: string;
    pendingImages: DraftImage[];
    pendingFiles: DraftFile[];
    pendingSkills: InstalledSkill[];
    pendingPlugins: InstalledPlugin[];
    draftContext: number;
    onFailure: (sourceThreadId?: string) => void;
    onSent?: () => void;
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
    const clientUserMessageId = transportUuid();
    let thread = initialThread;
    const startingProjectless = !thread?.id && !thread?.cwd;
    let sent = false;
    try {
      setImageReading(Boolean(pendingFiles.length || pendingImages.length));
      const uploadedImages = await uploadDraftImages(backend, pendingImages);
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
      const localItem = {
        id: `local-${pendingTurnId}`,
        clientId: clientUserMessageId,
        type: "userMessage",
        content: buildOptimisticUserContent(text, uploadedImages, uploadedFiles),
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
        clientUserMessageId,
        input: buildTurnInput(
          text,
          uploadedImages,
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
      requestAutomaticTitle(startedTurnRequest.client, String(thread.id), startedTurn.turn?.items ?? []);
      sent = true;
      onSent?.();
      if (draftContext === draftContextGenerationRef.current) {
        setActive((current) => {
          if (!current) return current;
          return applyTurnStarted(current, {
            threadId: thread!.id,
            turn: startedTurn.turn,
          }, { pendingTurnId });
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
              setError(response.error.message);
            }
            onFailure(threadId);
            return;
          }
          if (reason.request.method === "thread/start") {
            const created = (response.result as AnyRecord)?.thread;
            if (created?.id) {
              const restored = startingProjectless ? { ...created, isProjectless: true } : created;
              automaticTitleStatesRef.current.set(String(created.id), { status: "pending" });
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
            requestAutomaticTitle(confirmationClient, threadId, (response.result as AnyRecord)?.turn?.items ?? []);
            onSent?.();
            pendingFiles.forEach((file) => URL.revokeObjectURL(file.previewUrl));
            const turn = (response.result as AnyRecord)?.turn;
            if (turn && currentContext && currentThread) setActive(current => current?.id === threadId
              ? applyTurnStarted(current, { threadId, turn }, { pendingTurnId }) : current);
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
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      onFailure(String(thread?.id ?? ''));
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
    await sendMessage();
  }

  async function sendMessage() {
    if (draftSavingRef.current || (active?.id && activeThreadAccessMode !== "interactive")) return false;
    const text = currentDraftRef.current.text.trim();
    const pendingQuotes = [...quotesRef.current];
    const inputRevision = draftInputRevisionRef.current;
    const inputText = quoteInput(text, pendingQuotes);
    const pendingImages = currentDraftRef.current.images;
    const pendingFiles = currentDraftRef.current.files;
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
      return false;
    }
    const draftContext = draftContextGenerationRef.current;
    const threadId = String(activeRef.current?.id ?? "");
    if (sidechats.get(threadId)) {
      if (sendingDraftContextsRef.current.has(draftContext)) return false;
      sendingDraftContextsRef.current.add(draftContext);
      const originalDraft = currentDraftRef.current;
      const client = clientRef.current;
      try {
        const uploadedImages = await uploadDraftImages(backend, pendingImages);
        const uploaded = await Promise.all(pendingFiles.map(file => uploadFile(backend, file.file)));
        if (draftContext !== draftContextGenerationRef.current || clientRef.current !== client) throw new Error(t('会话已切换，请重试'));
        await sidechats.submit(gatewaySidechatClient(client), threadId, buildTurnInput(inputText, uploadedImages, uploaded, pendingSkills, pendingPlugins), {
          ...(selectedModel ? { model: selectedModel } : {}), ...(selectedEffort ? { effort: selectedEffort } : {}),
          serviceTier: effectiveSelectedServiceTier, ...(selectedPermission ? { permissions: selectedPermission } : {}),
          approvalPolicy: selectedApprovalPolicy, approvalsReviewer: selectedApprovalsReviewer,
        }, () => {
          // 上传/校验失败前保留输入；仅在原输入已进入分支内存队列后清理。
          const current = currentDraftRef.current;
          const next = { text: draftInputRevisionRef.current === inputRevision && current.text === originalDraft.text ? '' : current.text,
            images: current.images.filter(item => !pendingImages.some(original => original.id === item.id)),
            files: current.files.filter(item => !pendingFiles.some(original => original.id === item.id)) };
          currentDraftRef.current = next;
          setQuotes(current => current.filter(quote => !pendingQuotes.some(sent => sent.id === quote.id)));
          setDraft(next.text); setDraftImages(next.images); setDraftFiles(next.files);
          pendingFiles.forEach(file => URL.revokeObjectURL(file.previewUrl));
        }, { question: text, quotes: pendingQuotes });
        return true;
      } catch (reason) {
        if (draftContext === draftContextGenerationRef.current) setError(String((reason as Error).message ?? reason));
        return false;
      } finally { sendingDraftContextsRef.current.delete(draftContext); }
    }
    const conversationBusy = sendingDraftContextsRef.current.has(draftContext) || busyRef.current || (threadId
      ? [...pendingOperationsRef.current.values()].some((operation) => operation.threadId === threadId)
      : startingThreadContext === draftContext);
    const hasHostedQueue = queuedFollowUpsRef.current.some((item) => item.hosted && item.threadId === threadId);
    if (conversationBusy || hasHostedQueue || queueSubmissionsRef.current.get(threadId)?.hasPending) {
      if (!threadId) {
        setError(t("当前任务正在启动，请稍后再排队"));
        return false;
      }
      if (queueMutatingRef.current || queueSubmittingThreadIdsRef.current.has(threadId)) return false;
      queueSubmittingThreadIdsRef.current.add(threadId);
      requestRunCompletionNotificationPermission();
      setImageReading(true);
      unconfirmedQueueDraftsRef.current.set(threadId, { text, images: pendingImages, files: pendingFiles, quotes: pendingQuotes, inputRevision });
      let submission = queueSubmissionsRef.current.get(threadId);
      if (!submission) { submission = new HostedQueueSubmission(); queueSubmissionsRef.current.set(threadId, submission); }
      try {
        const settings = activeSettingsSynchronized ? {
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(selectedEffort ? { effort: selectedEffort } : {}),
          serviceTier: effectiveSelectedServiceTier,
          ...(selectedPermission ? { permissions: selectedPermission } : {}),
          approvalPolicy: selectedApprovalPolicy,
          approvalsReviewer: selectedApprovalsReviewer,
        } : {};
        const signature = JSON.stringify({ threadId, text: inputText, quotes: pendingQuotes, images: pendingImages,
          files: pendingFiles.map((file) => ({ id: file.id, name: file.name, size: file.size, type: file.type })),
        });
        const action = await submission.prepare(signature, async () => {
          const uploadedImages = await uploadDraftImages(backend, pendingImages);
          const uploadedFiles = await Promise.all(pendingFiles.map((file) => uploadFile(backend, file.file)));
          const input = buildTurnInput(inputText, uploadedImages, uploadedFiles, pendingSkills, pendingPlugins);
          const fullText = input.filter(part => part.type === 'text').map(part => part.text).join('\n');
          return { threadId, inputText: fullText,
            text: followUpPreviewText(text, pendingImages, pendingFiles),
            attachmentCount: pendingImages.length + pendingFiles.length,
            extraInput: input.filter(part => part.type !== 'text'), settings,
          };
        });
        await mutateHostedQueue(action);
        submission.confirmed(action.id);
        unconfirmedQueueDraftsRef.current.delete(threadId);
        const cached = familyDraftsRef.current.get(threadId);
        if (cached) familyDraftsRef.current.set(threadId, {
          ...cached, text: cached.inputRevision === inputRevision && cached.text.trim() === text ? '' : cached.text,
          quotes: cached.quotes.filter(quote => !pendingQuotes.some(sent => sent.id === quote.id)),
          images: cached.images.filter(image => !pendingImages.some(sent => sent.id === image.id)),
          files: cached.files.filter(file => !pendingFiles.some(sent => sent.id === file.id)),
        });
        pendingFiles.forEach((file) => URL.revokeObjectURL(file.previewUrl));
        if (String(activeRef.current?.id ?? "") === threadId) {
          // 上传期间仍可能输入新内容，只清理本次成功托管的草稿与附件；同步更新业务ref，避免紧随ACK的导航缓存旧输入。
          const current = currentDraftRef.current;
          currentDraftRef.current = {
            text: draftInputRevisionRef.current === inputRevision && current.text.trim() === text ? '' : current.text,
            images: current.images.filter(image => !pendingImages.some(sent => sent.id === image.id)),
            files: current.files.filter(file => !pendingFiles.some(sent => sent.id === file.id)),
          };
          setQuotes(current => current.filter(quote => !pendingQuotes.some(sent => sent.id === quote.id)));
          setDraft((current) => draftInputRevisionRef.current === inputRevision && current.trim() === text ? "" : current);
          setDraftImages((current) => current.filter((image) => !pendingImages.some((original) => original.id === image.id)));
          setDraftFiles((current) => current.filter((file) => !pendingFiles.some((original) => original.id === file.id)));
          setError("");
        }
      } catch (reason) {
        if (draftContext === draftContextGenerationRef.current) setError(reason instanceof Error ? reason.message : String(reason));
        return false;
      } finally {
        queueSubmittingThreadIdsRef.current.delete(threadId);
        if (String(activeRef.current?.id ?? "") === threadId) setImageReading(false);
      }
      return true;
    }
    // 在首个await和React提交前占用当前草稿与发送上下文；不同请求UUID也不能重复消费。
    sendingDraftContextsRef.current.add(draftContext);
    currentDraftRef.current = { text: "", images: [], files: [] };
    setQuotes([]);
    const savedDraft = savedDraftRef.current;
    requestRunCompletionNotificationPermission();
    invalidateImageReads();
    setDraft("");
    setDraftImages([]);
    setDraftFiles([]);
    setError("");
    return startTurnMessage({
      text: inputText,
      pendingImages,
      pendingFiles,
      pendingSkills,
      pendingPlugins,
      draftContext,
      onSent: savedDraft ? () => {
        void newChatDraftStore.remove(savedDraft.id, savedDraft.revision).then(() => {
          if (savedDraftRef.current?.revision === savedDraft.revision) savedDraftRef.current = undefined;
        }).catch(() => {
          if (draftContext === draftContextGenerationRef.current) setError(t("消息已发送，但无法移除本地草稿"));
        });
      } : undefined,
      onFailure: (sourceThreadId) => {
        const currentDraft = currentDraftRef.current;
        const failedThreadId = sourceThreadId || threadId;
        if (draftContext !== draftContextGenerationRef.current || String(activeRef.current?.id ?? "") !== failedThreadId || currentDraft.text.trim() || currentDraft.images.length || currentDraft.files.length || quotesRef.current.length) {
          // 后续新草稿保持可编辑；失败的原输入和附件留在现有手动重试队列。
          replaceQueuedFollowUps([{
            id: `failed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            threadId: failedThreadId, draftContext, inputText: text, quotes: pendingQuotes,
            text: followUpPreviewText(text, pendingImages, pendingFiles),
            attachmentCount: pendingImages.length + pendingFiles.length,
            images: pendingImages, files: pendingFiles,
            skills: pendingSkills, plugins: pendingPlugins, failed: true,
          }, ...queuedFollowUpsRef.current]);
          return false;
        }
        setQuotes(pendingQuotes);
        currentDraftRef.current = { text, images: pendingImages, files: pendingFiles };
        setDraft((current) => current || text);
        setDraftImages((current) => mergeDraftImages(current, pendingImages));
        setDraftFiles((current) =>
          current.length ? current : pendingFiles,
        );
      },
    }).finally(() => {
      sendingDraftContextsRef.current.delete(draftContext);
    });
  }

  function beginHistoricalMessageEdit(target: HistoricalMessageEditTarget) {
    const thread = activeRef.current;
    const threadId = String(thread?.id ?? "");
    const side = sidechats.get(threadId);
    const currentTarget = createHistoricalMessageEditTarget(
      thread?.turns ?? [],
      target.turnId,
      target.messageId,
    );
    const hasQueuedMessage = Boolean(side?.queue.length || side?.editing || side?.sending || side?.steering) || queuedFollowUpsRef.current.some(
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
    // 在编辑操作的回调内同步挂载输入框，让移动端立即接收输入焦点。
    flushSync(() => setHistoryEdit({
      threadId,
      target: currentTarget,
      text: currentTarget.text,
      submitting: false,
      reverted: false,
    }));
    setError("");
  }

  function changeHistoricalMessageEditText(text: string) {
    setHistoryEdit((current) =>
      current && !current.submitting ? { ...current, text } : current,
    );
  }

  function cancelHistoricalMessageEdit() {
    const session = historyEditRef.current;
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
    const session = historyEditRef.current;
    const client = clientRef.current;
    const thread = activeRef.current;
    const threadId = String(thread?.id ?? "");
    const side = sidechats.get(threadId);
    const hasQueuedMessage = Boolean(side?.queue.length || side?.editing || side?.sending || side?.steering) || queuedFollowUpsRef.current.some(
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

    const text = splitQuoteInput(session.text.trim()).question;
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
    const questionText = splitQuoteInput(text).question;
    const referencedSkills = skillsReferencedInText(
      questionText,
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
      questionText,
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

    if (side) {
      const context = draftContextGenerationRef.current;
      const owned = { ...session, submitting: true };
      setHistoryEdit(owned); setError('');
      try {
        await sidechats.edit(gatewaySidechatClient(client), threadId, target, input, {
          ...(selectedModel ? { model: selectedModel } : {}), ...(selectedEffort ? { effort: selectedEffort } : {}),
          serviceTier: effectiveSelectedServiceTier, ...(selectedPermission ? { permissions: selectedPermission } : {}),
          approvalPolicy: selectedApprovalPolicy, approvalsReviewer: selectedApprovalsReviewer,
        }, next => {
          const current = context === draftContextGenerationRef.current && String(activeRef.current?.id ?? '') === threadId;
          if (current) cacheFamilyDraft();
          const saved = familyDraftsRef.current.get(threadId);
          if (saved) { familyDraftsRef.current.set(next.id, saved); familyDraftsRef.current.delete(threadId); }
          sidechatDraftIdsRef.current.delete(threadId); sidechatDraftIdsRef.current.add(next.id);
          if (current) { setHistoryEdit(null); openThread(next.thread); }
        });
      } catch (reason) {
        if (context === draftContextGenerationRef.current && historyEditRef.current === owned) {
          setHistoryEdit({ ...owned, submitting: false }); setError(String((reason as Error).message ?? reason));
        }
      }
      return;
    }

    const draftContext = draftContextGenerationRef.current;
    let ownedEdit: HistoricalMessageEditState = { ...session, submitting: true };
    let editingClient = client;
    const ownsCurrentEdit = () => draftContext === draftContextGenerationRef.current &&
      String(activeRef.current?.id ?? "") === threadId && historyEditRef.current === ownedEdit;
    const isCurrentEdit = () => ownsCurrentEdit() && editingClient === clientRef.current;
    const updateSourceStatus = (running: boolean) => {
      setThreads((entries) => entries.map((entry) => String(entry.id) === threadId
        ? { ...entry, status: { type: running ? "active" : "idle" } }
        : entry));
    };
    const setOwnedEdit = (next: HistoricalMessageEditState) => {
      ownedEdit = next;
      setHistoryEdit(next);
    };
    setHistoryEdit(ownedEdit);
    setBusy(true);
    setError("");
    updateSourceStatus(true);
    requestRunCompletionNotificationPermission();
    const pendingTurnId =
      `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const clientUserMessageId = transportUuid();
    const pendingSequence = ++pendingSequenceRef.current;
    let reverted = session.reverted;
    // 请求参数在原会话授权时冻结；导航后仍完成原线程的重发，不读取新会话的设置。
    const shouldSendSettings = activeSettingsSynchronized;
    const resendParams = {
      threadId,
      clientUserMessageId,
      input,
      ...(shouldSendSettings && selectedModel ? { model: selectedModel } : {}),
      ...(shouldSendSettings && selectedEffort ? { effort: selectedEffort } : {}),
      ...(shouldSendSettings ? { serviceTier: effectiveSelectedServiceTier } : {}),
      ...(shouldSendSettings && selectedPermission ? { permissions: selectedPermission } : {}),
      ...(shouldSendSettings ? {
        approvalPolicy: selectedApprovalPolicy,
        approvalsReviewer: selectedApprovalsReviewer,
      } : {}),
    };
    const restoreEditing = (nextReverted: boolean, failure?: string) => {
      updateSourceStatus(false);
      // 解除同一个编辑的提交锁不依赖旧连接；换会话或新编辑仍由所有权隔离。
      if (!ownsCurrentEdit()) return;
      if (nextReverted) {
        // revert 已删除原目标；仅保留用于手动编辑的本地草稿，不代表已执行回合。
        const editDraft = { id: target.turnId, status: "failed", itemsView: "summary", historyEditDraft: true, items: [{ id: target.messageId, type: "userMessage", content: buildEditedHistoryInput(target, text) }] };
        const next = { ...activeRef.current, turns: [...(activeRef.current?.turns ?? []).filter((turn: AnyRecord) => turn.id !== pendingTurnId && turn.id !== target.turnId), editDraft] };
        activeRef.current = next;
        setActive(next);
      }
      setOwnedEdit({ ...ownedEdit, target: nextReverted ? { ...target, hasLaterTurns: false } : target, reverted: nextReverted, submitting: false });
      setBusy(false);
      if (failure) setError(failure);
    };
    const applyRevertedResult = (response: AnyRecord | null | undefined, method: string) => {
      const workingThread = {
        ...thread,
        ...(response?.thread ?? {}),
        id: threadId,
        turns: retainedTurns,
        ...(thread.isProjectless === true ? { isProjectless: true } : {}),
      };
      reverted = true;
      if (isCurrentEdit()) {
        activeRef.current = workingThread;
        setActive(workingThread);
        resetOlderTurns(method === "thread/revert" ? response?.turnsBackwardsCursor ?? null : null);
        setOwnedEdit({ ...ownedEdit, target: { ...target, hasLaterTurns: false }, reverted: true, submitting: true });
      }
      return workingThread;
    };
    const finishStartedTurn = (turn: AnyRecord, responseClient: AppServerClient) => {
      const sourceThread = String(activeRef.current?.id ?? "") === threadId ? activeRef.current : null;
      const knownTurn = sourceThread?.turns?.find((entry: AnyRecord) => entry.id === turn.id);
      const terminal = ["completed", "failed", "interrupted", "cancelled"].includes(String(knownTurn?.status));
      // turn/start 回执是较早事实，不能覆盖已经收到的完成通知或恢复快照。
      const acceptedTurn = terminal ? { ...turn, ...knownTurn } : turn;
      const next = sourceThread ? applyTurnStarted(sourceThread, { threadId, turn: acceptedTurn }, { pendingTurnId }) : null;
      const running = ["inProgress", "in_progress", "running"].includes(String(next?.turns?.at(-1)?.status ?? acceptedTurn.status));
      // 后台源线程已由完成通知变为 idle 时，较早的 start 回执不能重新标为 active。
      const backgroundCompleted = !sourceThread && threadsRef.current.some((entry) =>
        String(entry.id) === threadId && entry.status?.type === "idle");
      if (!backgroundCompleted || !running) updateSourceStatus(running);
      if (!ownsCurrentEdit()) return;
      if (responseClient === clientRef.current && next) {
        activeRef.current = next;
        setActive(next);
      }
      setBusy(running);
      setHistoryEdit(null);
      const currentClient = clientRef.current;
      if (currentClient) {
        // 完成编辑后只在同一上下文且尚未开始另一编辑时核对服务器事实。
        void reconcileActiveThread(currentClient, () =>
          draftContext === draftContextGenerationRef.current &&
          String(activeRef.current?.id ?? "") === threadId && historyEditRef.current === null,
        ).catch(() => undefined);
      }
    };
    const handleFailure = (reason: unknown, requestClient: AppServerClient) => {
      if (reason instanceof HttpOperationPendingError) {
        rememberPendingOperation(reason.requestId, {
          threadId, draftContext, pendingTurnId,
          confirmed: (response, confirmationClient) => {
            // pending registry 已匹配原请求；仅当前连接的确认可接管原编辑的界面写入。
            if (confirmationClient === clientRef.current) editingClient = confirmationClient;
            if (response.error) {
              restoreEditing(reverted, response.error.message);
              return;
            }
            if (["thread/revert", "thread/rollback"].includes(reason.request.method ?? "")) {
              // 已确认原授权回退成功后继续原线程重发；是否仍显示该编辑只决定界面写入。
              const workingThread = applyRevertedResult(response.result as AnyRecord, reason.request.method!);
              void sendEditedTurn(workingThread, confirmationClient);
            } else {
              const turn = (response.result as AnyRecord)?.turn;
              if (turn) finishStartedTurn(turn, confirmationClient);
              else {
                updateSourceStatus(true);
                if (isCurrentEdit()) {
                  setHistoryEdit(null);
                  void reconcileActiveThread(confirmationClient).catch(() => undefined);
                }
              }
            }
          },
        }, requestClient);
        return;
      }
      // 回退已经成功时，服务端原目标已删除；复用现有本地编辑草稿锚点。
      restoreEditing(reverted, reason instanceof Error ? reason.message : String(reason));
      if (reverted && ownsCurrentEdit() && clientRef.current) retryThreadDetail();
    };
    async function sendEditedTurn(workingThread: AnyRecord, requestClient: AppServerClient) {
      const localItem = { id: `local-${pendingTurnId}`, clientId: clientUserMessageId, type: "userMessage", content: input };
      if (isCurrentEdit()) {
        const pendingThread = {
          ...workingThread,
          turns: [...(workingThread.turns ?? retainedTurns), createPendingTurn(pendingTurnId, localItem, pendingSequence)],
        };
        activeRef.current = pendingThread;
        setActive(pendingThread);
      }
      try {
        const startedTurn = await requestClient.request<{ turn: AnyRecord }>("turn/start", resendParams);
        finishStartedTurn(startedTurn.turn, requestClient);
      } catch (reason) {
        handleFailure(reason, requestClient);
      }
    }
    try {
      let workingThread = session.reverted ? { ...thread, turns: retainedTurns } : thread;
      if (!reverted) {
        const result = await revertHistoricalMessage(client, threadId, target);
        workingThread = applyRevertedResult(result.response as AnyRecord, result.method);
      }
      await sendEditedTurn(workingThread, client);
    } catch (reason) {
      handleFailure(reason, client);
    }
  }

  async function actOnQueuedFollowUp(id: string) {
    const side = sidechats.get(String(activeRef.current?.id ?? ''));
    if (side) {
      if (!side.busy) { await sidechats.retry(side.id); return; }
      const client = clientRef.current; const entry = side.queue.find(q => q.id === id); const turnId = activeTurnId(side.thread);
      if (!client || !entry || !turnId) return;
      setPendingSteerMessage({ id, threadId: side.id, turnId, text: entry.input.filter(i => i.type === 'text').map(i => i.text).join('\n') });
      try { await sidechats.steer(gatewaySidechatClient(client), side.id, id); }
      catch (reason) { setPendingSteerMessage(current => clearPendingSteerForRequest(current, id)); throw reason; }
      return;
    }
    const followUp = queuedFollowUpsRef.current.find((entry) => entry.id === id);
    if (!followUp || steering) return;
    if (!followUp.hosted) {
      // 明确失败的普通发送保留手动恢复入口；它从未进入自动排队调度。
      if (busy || !followUp.failed) return;
      replaceQueuedFollowUps(removeQueuedFollowUp(queuedFollowUpsRef.current, id));
      await startTurnMessage({ text: quoteInput(followUp.inputText, followUp.quotes ?? []), pendingImages: followUp.images,
        pendingFiles: followUp.files, pendingSkills: followUp.skills, pendingPlugins: followUp.plugins,
        draftContext: followUp.draftContext,
        onFailure: () => replaceQueuedFollowUps([{ ...followUp, failed: true }, ...queuedFollowUpsRef.current.filter((entry) => entry.id !== id)]),
      });
      return;
    }
    if (followUp.state === "sending" || followUp.state === "uncertain") return;
    setSteering(true);
    setError("");
    const turnId = activeTurnId(activeRef.current);
    const steer = busy && Boolean(turnId);
    if (steer && turnId) setPendingSteerMessage({ id: followUp.id, threadId: followUp.threadId, turnId, text: followUp.text });
    try {
      await mutateHostedQueue({ action: steer ? "steer" : "retry", id, revision: followUp.revision! });
      if (steer) releaseQueueSubmission(followUp.threadId, id);
      if (steer && clientRef.current) void reconcileActiveThread(clientRef.current).catch(() => undefined);
    } catch (reason) {
      setPendingSteerMessage((current) => clearPendingSteerForRequest(current, followUp.id));
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setSteering(false); }
  }

  async function editQueuedFollowUp(id: string, inputText: string) {
    const side = sidechats.get(String(activeRef.current?.id ?? ''));
    if (side) return sidechats.editQueued(side.id, id, inputText);
    const followUp = queuedFollowUpsRef.current.find((entry) => entry.id === id);
    if (!followUp) return false;
    const text = inputText.trim();
    if (!text && !followUp.attachmentCount) return false;
    const referencedSkills = skillsReferencedInText(text, skillCatalog.cwd === (activeRef.current?.cwd ?? null) ? skillCatalog.skills : []);
    const referencedPlugins = pluginsReferencedInText(text, pluginCatalog.cwd === (activeRef.current?.cwd ?? null) ? pluginCatalog.plugins : []);
    if (!followUp.hosted) {
      replaceQueuedFollowUps(updateQueuedFollowUpText(queuedFollowUpsRef.current, id, text, followUpPreviewText(text, followUp.images, followUp.files)).map((entry) => entry.id === id ? { ...entry, skills: referencedSkills, plugins: referencedPlugins } : entry));
      return true;
    }
    try {
      await mutateHostedQueue({ action: "edit", id, revision: followUp.revision!, inputText: followUp.referencePrefix ? replaceUserMessageBody(followUp.referencePrefix + followUp.inputText + "\n", text) : quoteInput(text, followUp.quotes ?? []),
        text: text || t("{count} 个附件", { count: followUp.attachmentCount ?? 0 }),
        mentions: buildTurnInput("", [], [], referencedSkills, referencedPlugins),
      });
      setError("");
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
  }

  async function cancelQueuedFollowUp(id: string, confirmed = false) {
    const side = sidechats.get(String(activeRef.current?.id ?? ''));
    if (side) { sidechats.removeQueued(side.id, id); return; }
    const followUp = queuedFollowUpsRef.current.find((entry) => entry.id === id);
    if (!followUp) return;
    if (!followUp.hosted) {
      followUp.files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
      replaceQueuedFollowUps(removeQueuedFollowUp(queuedFollowUpsRef.current, id));
      return;
    }
    if (followUp.state === "uncertain" && !confirmed && !await confirmWorkspaceAction(t("这条消息可能已发送。移除待确认记录不会撤销已发送的任务，确定移除吗？"))) return;
    try {
      await mutateHostedQueue({ action: "cancel", id, revision: followUp.revision! });
      releaseQueueSubmission(followUp.threadId, id);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function selectImages(files: FileList | File[] | null, atomic = false) {
    if (
      !files?.length ||
      historyEdit ||
      (active?.id && activeThreadAccessMode !== "interactive")
    ) { if (atomic) throw new Error(t("当前无法导入附件")); return; }
    const originals = Array.from(files);
    const generation = imageReadGenerationRef.current.begin();
    const existingBytes = draftImages.reduce(
      (total, image) => total + image.size,
      0,
    );
    setImageReading(true);
    let preparedFiles: DraftFile[] = [];
    let committed = false;
    try {
      const selected = await normalizeHEICFiles(originals);
      if (!imageReadGenerationRef.current.isCurrent(generation)) throw new Error(t("附件读取已取消或会话已切换"));
      if (atomic) assertNativeAttachmentSelection(selected, currentDraftRef.current.images, currentDraftRef.current.files);
      const imageFiles = selected.filter(isNativeImageFile);
      const attachmentFiles = selected.filter((file) => !isNativeImageFile(file));
      const result = await prepareImageFiles(
        imageFiles,
        draftImages.length,
        undefined,
        existingBytes,
      );
      if (!imageReadGenerationRef.current.isCurrent(generation)) { if (atomic) throw new Error(t("附件读取已取消或会话已切换")); return; }
      const attachmentResult = prepareAttachmentFiles(
        attachmentFiles,
        draftFiles.length,
      );
      preparedFiles = attachmentResult.files;
      const errors = [...result.errors, ...attachmentResult.errors];
      if (atomic && errors.length) throw new Error(errors.join("；"));
      if (atomic) {
        assertNativeAttachmentSelection(selected, currentDraftRef.current.images, currentDraftRef.current.files);
        const nextImages = mergeDraftImages(currentDraftRef.current.images, result.images);
        const nextFiles = [...currentDraftRef.current.files, ...attachmentResult.files];
        currentDraftRef.current = { ...currentDraftRef.current, images: nextImages, files: nextFiles };
        setDraftImages(nextImages); setDraftFiles(nextFiles);
      } else {
        setDraftImages((current) => mergeDraftImages(current, result.images));
        setDraftFiles((current) => [...current, ...attachmentResult.files].slice(0, 4));
      }
      committed = true;
      if (errors.length) setError(errors.join("；"));
      else setError("");
    } catch (reason) {
      if (imageReadGenerationRef.current.isCurrent(generation)) setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      if (atomic && !committed) preparedFiles.forEach(file => URL.revokeObjectURL(file.previewUrl));
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
    const sideId = String(activeRef.current?.id ?? '');
    if (sidechats.get(sideId) && clientRef.current) { await sidechats.stop(gatewaySidechatClient(clientRef.current), sideId); return; }
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
    if (action === "archive") {
      const count = queuedFollowUpsForThread(queuedFollowUpsRef.current, threadId).length;
      const message = count > 0
        ? t("此会话仍有 {count} 条排队消息，归档会丢弃这些消息。确定归档吗？", { count })
        : t("归档后，此会话将从列表中移除。确定归档吗？");
      if (!await confirmWorkspaceAction(message)) return false;
    }
    setPendingAction(action);
    setError("");
    try {
      if (!client) {
        setError(t("设备尚未连接，请稍后重试"));
        return false;
      }
      if (action === "pin") return await setRemotePinned(client, threadId, thread.isPinned !== true, thread);
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
        updateThreadNameLocally(threadId, name);
        showNotice(t("已重命名"));
        return true;
      }
      await discardQueuedFollowUpsForThread(threadId);
      await client.request("thread/archive", { threadId });
      if (thread.isPinned === true) await client.request("thread/section/move", { threadId, sectionId: null, beforeThreadId: null });
      pinnedRevisionRef.current++;
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
      if (action === "pin" && client !== clientRef.current) return false;
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
    if (sidechats.get(String(activeRef.current?.id ?? ''))) return false;
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
    return manageListedThread(thread, "pin");
  }

  async function renameThread(explicitName?: string) {
    if (sidechats.get(String(activeRef.current?.id ?? ''))) return false;
    const client = clientRef.current;
    const thread = activeRef.current;
    if (
      !client ||
      !thread?.id ||
      pendingAction ||
      activeThreadAccessMode !== "interactive"
    ) return false;
    const name = (explicitName ?? await threadRename.request(backend, String(thread.id), titleOf(thread)))?.trim();
    if (!name || name === titleOf(thread)) return false;
    setPendingAction("rename");
    setError("");
    try {
      await cancelAutomaticTitle(String(thread.id));
      await client.request("thread/name/set", {
        threadId: thread.id,
        name,
      });
      updateThreadNameLocally(String(thread.id), name);
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
    if (sidechats.get(String(activeRef.current?.id ?? ''))) return false;
    const client = clientRef.current;
    const thread = activeRef.current;
    if (
      !client ||
      !thread?.id ||
      pendingAction ||
      activeThreadAccessMode !== "interactive"
    ) return false;
    const threadId = String(thread.id);
    const count = queuedFollowUpsForThread(queuedFollowUpsRef.current, threadId).length;
    const message = count > 0
      ? t("此会话仍有 {count} 条排队消息，归档会丢弃这些消息。确定归档吗？", { count })
      : t("归档后，此会话将从列表中移除。确定归档吗？");
    if (!await confirmWorkspaceAction(message)) return false;
    setPendingAction("archive");
    setError("");
    try {
      await discardQueuedFollowUpsForThread(threadId);
      await client.request("thread/archive", { threadId: thread.id });
      if (thread.isPinned === true) await client.request("thread/section/move", { threadId: thread.id, sectionId: null, beforeThreadId: null });
      pinnedRevisionRef.current++;
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
  const replyToRequest = async (result: unknown) => {
    const client = clientRef.current;
    if (!approval || !client) return { ok: false, error: t("尚未连接 app-server") };
    const responder = isAsyncQuestion(approval) ? { respond: async (_id: number | string, answer: unknown) => {
      const threadId = String((approval.params as AnyRecord).threadId);
      const side = sidechats.get(threadId);
      if (activeRef.current?.id !== threadId || activeThreadAccessMode !== 'interactive') throw new Error(t('请先打开问题所属会话后回答'));
      const target = side?.thread ?? activeRef.current;
      const reply = await sendAsyncQuestionAnswer(approval, answer, target, side ? gatewaySidechatClient(client) : client, transportUuid());
      if (reply?.turn) {
        if (side) sidechats.observe({ method: 'turn/started', params: { threadId, turn: reply.turn } });
        else if (clientRef.current === client && activeRef.current?.id === threadId) {
          setActive(current => {
            if (current?.id !== threadId) return current;
            const next = applyTurnStarted(current, { threadId, turn: reply.turn });
            setBusy(Boolean(activeTurnId(next)));
            return next;
          });
        }
      }
      if (!side && clientRef.current === client && activeRef.current?.id === threadId) void reconcileActiveThread(client).catch(() => undefined);
    } } : client;
    return approvalRequests.submit(result, responder, (requestId, confirmed) => {
      rememberPendingOperation(requestId, {
        threadId: String((approval.params as AnyRecord)?.threadId ?? ""),
        draftContext: draftContextGenerationRef.current,
        confirmed,
      }, client);
      // 审批解决本身已经足以解除其 busy 状态；不要等待可能永久 uncertain 的 HTTP 查询。
      return () => {
        pendingOperationsRef.current.delete(requestId);
        earlyOperationConfirmationsRef.current.delete(requestId);
        setPendingOperationIds([...pendingOperationsRef.current.keys()]);
      };
    }, approval);
  };
  const finishRequest = (decision: ApprovalDecision) => {
    if (!approval) return;
    const response = approvalResponse(approval, decision);
    if (response) replyToRequest(response);
  };
  const answerQuestions = () => {
    if (!approval) return;
    const response = questionResponse(approval, userAnswers);
    if (response) replyToRequest(response);
  };

  const startNewChat = (
    cwd: string | null = null,
    nextDraft = "",
    nextDraftImages: DraftImage[] = [],
    nextDraftFiles: DraftFile[] = [],
    savedDraft?: SavedNewChatDraft,
    savedDraftReference?: SavedDraftReference,
  ) => {
    const selectedCwd = savedDraft ? savedDraft.cwd :
      (typeof cwd === "string"
        ? cwd || null
        : newChatProjectCatalogReady ? rememberedNewChatProject() : null);
    cacheFamilyDraft();
    openSequenceRef.current += 1;
    activeThreadTargetRef.current = null;
    resetDraftContext();
    setQuotes([]);
    // 项目目录仍在加载时，等首次目录/会话读取完成再确认保存项目是否存在。
    pendingNewChatProjectRef.current = !savedDraft && typeof cwd !== "string" && !newChatProjectCatalogReady
      ? draftContextGenerationRef.current : null;
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
    setDraftFiles(current => {
      current.forEach(file => {
        const pending = [...unconfirmedQueueDraftsRef.current.values(), ...familyDraftsRef.current.values()].some(draft => draft.files.some(original => original.previewUrl === file.previewUrl));
        if (!pending && !nextDraftFiles.some(next => next.previewUrl === file.previewUrl)) URL.revokeObjectURL(file.previewUrl);
      });
      return nextDraftFiles;
    });
    savedDraftRef.current = savedDraft ?? savedDraftReference;
    restoredDraftSettingsRef.current = savedDraft?.settings ?? null;
    draftInputRevisionRef.current = 0;
    currentDraftRef.current = { text: nextDraft, images: nextDraftImages, files: nextDraftFiles };
    setDraft(nextDraft);
    setDraftImages(nextDraftImages);
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
    if (savedDraft) {
      const settings = savedDraft.settings;
      setNewChatPermissionMode(null);
      selectedModelRef.current = settings.model;
      selectedEffortRef.current = settings.effort;
      selectedServiceTierRef.current = settings.serviceTier;
      setSelectedModel(settings.model);
      setSelectedEffort(settings.effort);
      setSelectedServiceTier(settings.serviceTier);
      setSelectedPermission(settings.permissions);
      setSelectedApprovalPolicy(settings.approvalPolicy);
      setSelectedApprovalsReviewer(settings.approvalsReviewer);
    }
    const nextActive = {
      id: "",
      turns: [],
      preview: t("新会话"),
      cwd: selectedCwd,
    };
    activeRef.current = nextActive;
    setActive(nextActive);
  };

  const chooseNewChatProject = (cwd: string) => {
    pendingNewChatProjectRef.current = null;
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
        new Set([...readLocalPinned(), ...projectlessThreadIds]),
      );
      setProjectLoadedCounts(current => ({ ...current, [cwd]: (current[cwd] ?? 0) + result.threads.length }));
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
    const currentRequest = projectlessLoadRef.current;
    if (!client || (currentRequest?.client === client && currentRequest.pending)) return;
    const request = { client, pending: true };
    projectlessLoadRef.current = request;
    const isCurrent = () => projectlessLoadRef.current === request && clientRef.current === client;
    setLoadingProjectCwd(PROJECTLESS_GROUP_ID);
    try {
      const result = await loadProjectlessThreadRecords(
        client,
        projectlessThreadIds,
        targetCount,
        readPrioritizedThreadIds(),
        readLocalPinned(),
        projectNextCursors[PROJECTLESS_GROUP_ID],
      );
      if (!isCurrent()) return;
      const append = client.sidebarIndex && !!projectNextCursors[PROJECTLESS_GROUP_ID];
      setProjectNextCursors(current => isCurrent() ? ({ ...current, [PROJECTLESS_GROUP_ID]: "nextCursor" in result ? result.nextCursor as string | null : null }) : current);
      setProjectLoadedCounts(current => isCurrent() ? ({ ...current, [PROJECTLESS_GROUP_ID]: (append ? current[PROJECTLESS_GROUP_ID] ?? 0 : 0) + result.threads.length }) : current);
      if (result.hasMore) {
        fullyLoadedProjectCwdsRef.current.delete(PROJECTLESS_GROUP_ID);
      } else {
        fullyLoadedProjectCwdsRef.current.add(PROJECTLESS_GROUP_ID);
      }
      setProjectHasMore((current) => {
        if (!isCurrent()) return current;
        return { ...current, [PROJECTLESS_GROUP_ID]: result.hasMore };
      });
      setThreads((current) => {
        if (!isCurrent()) return current;
        return [
          ...current.filter(
            (thread) => projectGroupIdOf(thread) !== PROJECTLESS_GROUP_ID,
          ),
          ...mergeThreadListPage(
            current.filter(
              (thread) => projectGroupIdOf(thread) === PROJECTLESS_GROUP_ID,
            ),
            decorateThreads(append
              ? dedupeThreadsById([
                  ...current.filter(thread => projectGroupIdOf(thread) === PROJECTLESS_GROUP_ID),
                  ...result.threads,
                ])
              : result.threads),
            readPrioritizedThreadIds(),
          ),
        ];
      });
    } catch (reason) {
      if (isCurrent()) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError((current) => isCurrent() ? message : current);
      }
    } finally {
      if (isCurrent()) {
        // 保留身份供已排队的状态更新复核；下一轮请求会替换它。
        request.pending = false;
        setLoadingProjectCwd((current) =>
          isCurrent() && current === PROJECTLESS_GROUP_ID ? "" : current,
        );
      }
    }
  }

  async function saveNewChatDraft() {
    const content = currentDraftRef.current;
    if (active?.id || draftSavingRef.current || imageReading || startingThreadContext !== null || (!content.text.trim() && !content.images.length && !content.files.length)) return false;
    const context = draftContextGenerationRef.current;
    const contentVersion = draftContentVersionRef.current;
    draftSavingRef.current = true;
    setDraftSaving(true);
    setDraftSaveStatus("");
    try {
      const mode = newChatPermissionMode;
      const saved = await newChatDraftStore.save({
        backendId: backend.id, backendName: backend.name, cwd: active?.cwd ?? null,
        text: content.text, images: content.images, files: content.files,
        settings: { model: selectedModel, effort: selectedEffort, serviceTier: effectiveSelectedServiceTier,
          permissions: mode?.permissions ?? selectedPermission,
          approvalPolicy: mode?.approvalPolicy ?? selectedApprovalPolicy,
          approvalsReviewer: mode?.approvalsReviewer ?? selectedApprovalsReviewer },
      }, savedDraftRef.current?.id);
      if (context === draftContextGenerationRef.current) {
        savedDraftRef.current = { id: saved.id, revision: saved.revision };
        if (contentVersion === draftContentVersionRef.current || (currentDraftRef.current.text === content.text && currentDraftRef.current.images === content.images && currentDraftRef.current.files === content.files)) setDraftSaveStatus(t("草稿已保存到本地"));
        setError("");
      }
      return true;
    } catch (reason) {
      if (context === draftContextGenerationRef.current) setError(`${t("无法保存草稿")}：${reason instanceof Error ? reason.message : String(reason)}`);
      return false;
    } finally {
      if (context === draftContextGenerationRef.current) {
        draftSavingRef.current = false;
        setDraftSaving(false);
      }
    }
  }

  useSwitchWorkspace(backend.id, {
    backendId: backend.id, backendName: backend.name, cwd: active?.cwd ?? null,
    text: sidechats.get(String(active?.id ?? '')) ? '' : draft,
    images: sidechats.get(String(active?.id ?? '')) ? [] : draftImages,
    files: sidechats.get(String(active?.id ?? '')) ? [] : draftFiles,
    thread: sidechats.get(String(active?.id ?? '')) ? { id: sidechats.get(String(active!.id))!.parentId, cwd: active?.cwd ?? null } : active ? { id: String(active.id ?? ''), cwd: active.cwd ?? null, preview: active.preview, isProjectless: active.isProjectless } : null,
    savedDraftReference: savedDraftRef.current,
    settings: { model: selectedModel, effort: selectedEffort, serviceTier: effectiveSelectedServiceTier,
      permissions: newChatPermissionMode?.permissions ?? selectedPermission,
      approvalPolicy: newChatPermissionMode?.approvalPolicy ?? selectedApprovalPolicy,
      approvalsReviewer: newChatPermissionMode?.approvalsReviewer ?? selectedApprovalsReviewer },
  });
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
        command.savedDraft,
        command.savedDraftReference,
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
            { pinnedThreadIds: [...readLocalPinned()], prioritizedThreadIds: [...readPrioritizedThreadIds()] },
          );
        } else {
          void threadListLoaderRef.current!.loadProject(client, command.cwd, {
            pinnedThreadIds: [...readLocalPinned()],
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

  const activeSidechat = sidechats.get(String(active?.id ?? ''));
  const sidechatParentId = activeSidechat?.parentId ?? String(active?.id ?? '');
  const sidechatActions = active?.id ? [
    ...(activeSidechat ? [{ id: 'sidechat-return', kind: 'action', title: t('返回主聊天'), command: { name: 'sidechat.return', params: {} } }] : []),
    { id: 'sidechat-create', kind: 'action', title: t('新建 Sidechat'), command: { name: 'sidechat.create', params: {} } },
    ...sidechats.forParent(sidechatParentId).filter(side => side.id !== activeSidechat?.id).map(side => ({ id: `sidechat:${side.id}`, kind: 'action', title: side.thread.name + (side.busy ? ' · 执行中' : ''), command: { name: 'sidechat.open', params: { id: side.id } } })),
    ...(activeSidechat ? [{ id: 'sidechat-close', kind: 'action', title: t('关闭 Sidechat'), command: { name: 'sidechat.close', params: { id: activeSidechat.id } } }] : []),
  ] : [];
  useEffect(() => {
    if (!activeSidechat) return;
    Object.assign(activeSidechat.settings, { model: selectedModel, reasoningEffort: selectedEffort, serviceTier: effectiveSelectedServiceTier,
      approvalPolicy: selectedApprovalPolicy, approvalsReviewer: selectedApprovalsReviewer,
      activePermissionProfile: selectedPermission ? { id: selectedPermission } : null });
  }, [activeSidechat, selectedModel, selectedEffort, effectiveSelectedServiceTier, selectedPermission, selectedApprovalPolicy, selectedApprovalsReviewer]);
  const measuredUpload = uploadUsageByThread[String(active?.id ?? '')];
  const latestUploadTurn = active?.turns?.at(-1)?.id;
  const uploadUsage = measuredUpload && (!latestUploadTurn || measuredUpload.turnId === latestUploadTurn) ? measuredUpload : null;
  const nativeContextId = `${backend.id}:context:${draftContextGenerationRef.current}`;
  useNativeConversationAdapter(nativeRuntime, {
    backend, active, contextId: nativeContextId, connection, draft, draftImages, draftFiles,
    busy: conversationBusy, readOnly: Boolean(historyEdit || (active?.id && activeThreadAccessMode !== "interactive")),
    imageReading, draftSaving, pending: conversationOperationPending, models, selectedModel,
    selectedModelLabel, effortOptions, selectedEffort, permission: selectedPermissionLabel,
    skills: skillCatalog.cwd === (active?.cwd ?? null) ? skillCatalog.skills : [],
    plugins: pluginCatalog.cwd === (active?.cwd ?? null) ? pluginCatalog.plugins : [],
    queued: activeSidechat ? activeSidechat.queue.filter((_, index) => !activeSidechat.sending || index > 0).map(item => ({ id: item.id, text: item.text, inputText: item.question ?? item.text, threadId: activeSidechat.id, failed: !!activeSidechat.error, state: activeSidechat.unconfirmed ? 'uncertain' : activeSidechat.error ? 'failed' : 'queued' })) : queuedFollowUps.filter(item => item.threadId === String(active?.id ?? "") && (item.threadId || item.draftContext === draftContextGenerationRef.current)),
    approvalCount: requests.length, loadState: conversationLoadState, loadError: conversationLoadError || activeThreadResumeError,
    olderTurnsState, error, syncStale: syncState?.stale, draftSaveStatus,
    getDraft: () => currentDraftRef.current.text,
    setDraft: value => { draftInputRevisionRef.current += 1; currentDraftRef.current = { ...currentDraftRef.current, text: value }; setDraft(value); },
    send: sendMessage, stop: interrupt, chooseModel, chooseEffort,
    removeAttachment: id => {
      setDraftImages(current => current.filter(item => item.id !== id));
      setDraftFiles(current => { const removed = current.find(item => item.id === id); if (removed) URL.revokeObjectURL(removed.previewUrl); return current.filter(item => item.id !== id); });
    },
    selectFiles: async files => {
      if (`${backend.id}:context:${draftContextGenerationRef.current}` !== nativeContextId) throw new Error(t("会话已切换，请重试"));
      return await selectImages(files, true);
    },
    selectLocation: selectCurrentLocation, saveDraft: saveNewChatDraft, retry: retryThreadDetail, loadOlder: loadOlderTurns,
    editMessage: (turnId, messageId) => {
      const target = createHistoricalMessageEditTarget(activeRef.current?.turns ?? [], turnId, messageId);
      if (!target) throw new Error(t("消息已更新"));
      beginHistoricalMessageEdit(target);
    },
    cancelQueued: cancelQueuedFollowUp, sendQueued: actOnQueuedFollowUp, editQueued: editQueuedFollowUp,
    extended: {
      state: { quotes, quoteFocusToken, sidechatActive: !!activeSidechat, sidechatParentId, sidechatActions, approvalThreadTitle: approval ? completionThreadTitle({ threadId: String((approval.params as AnyRecord)?.threadId ?? ""), threads, activeThread: active, fallback: t("新会话") }) : undefined, historyEdit, pendingSteerMessage: pendingSteerMessage?.threadId === String(active?.id) ? pendingSteerMessage : null, steering: steering || !!activeSidechat?.steering || !!activeSidechat?.editing, queueSaving, steerable: Boolean(activeTurnId(active)), requests, approval, userAnswers, approvalSubmitting: approvalRequests.submitting, approvalError: approvalRequests.error, permissionModes, selectedPermissionModeId,
        selectedServiceTier: displayedServiceTier, speedOptions, pendingAction, tokenUsage: tokenUsageByThread[active?.id] ?? null, uploadUsage, rateLimits,
        projectOptions, backends, draftSaveStatus, activeThreadAccessMode, activeThreadResumeError },
      callbacks: { currentHistoryEdit: () => historyEditRef.current, currentApproval: approvalRequests.current, readRemoteFile: (path: string) => { const client = clientRef.current; if (!client) throw new Error(t('尚未连接 app-server')); return client.request<{ dataBase64: string }>('fs/readFile', { path }); }, chooseSpeed, choosePermissionMode, replyToRequest, changeHistoricalMessageEditText, cancelHistoricalMessageEdit,
        addQuote, removeQuote: (id: string) => setQuotes(current => current.filter(quote => quote.id !== id)), createSidechat, openSidechat, returnFromSidechat, closeSidechat, submitHistoricalMessageEdit, chooseNewChatProject, togglePinned, duplicateActiveThread, renameThread, archiveThread,
        reopenApproval: approvalRequests.reopen, answerApproval: approvalRequests.answer,
        dismissApproval: approvalRequests.dismiss,
        switchNewChatBackend: (id: string) => { const content = currentDraftRef.current; return onSwitchNewChatBackend(id, content.text, content.images, content.files, savedDraftRef.current); } },
    },
  });

  return (
    <main className="app-shell">
      {threadRename.dialog}
      {active ? (
        <ConversationPage
          quotes={quotes}
          quoteFocusToken={quoteFocusToken}
          onRemoveQuote={id => setQuotes(current => current.filter(quote => quote.id !== id))}
          onSelectionQuote={async (selection: SelectionQuote, side: boolean) => { try {
            const quote = validateMessageQuote(selection, backend.id, activeRef.current);
            if (side) await createSidechat(quote); else addQuote(quote);
          } catch (reason) { setError(String((reason as Error).message ?? reason)); } }}
          sidechatActive={!!activeSidechat}
          sidechatActions={sidechatActions}
          onSidechatAction={async (name, id) => { try {
            if (name === 'sidechat.create') await createSidechat();
            if (name === 'sidechat.open') openSidechat(id!);
            if (name === 'sidechat.return') returnFromSidechat();
            if (name === 'sidechat.close') await closeSidechat(id!);
          } catch (reason) { setError(String((reason as Error).message ?? reason)); } }}
          conversationVisible={conversationVisible}
          nativeContextId={nativeContextId}
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
          syncState={syncState}
          draft={draft}
          draftImages={draftImages}
          draftFiles={draftFiles}
          imageReading={imageReading}
          draftSaving={draftSaving}
          draftSaveStatus={draftSaveStatus}
          onSaveDraft={saveNewChatDraft}
          busy={conversationBusy}
          operationPending={conversationOperationPending}
          steering={steering || !!activeSidechat?.steering || !!activeSidechat?.editing}
          queueSaving={queueSaving}
          steerable={Boolean(activeTurnId(active))}
          pendingSteerText={
            pendingSteerMessage?.threadId === String(active.id)
              ? pendingSteerMessage.text
              : ""
          }
          queuedFollowUps={activeSidechat ? activeSidechat.queue.filter((_, index) => !activeSidechat.sending || index > 0).map(item => ({ id: item.id, text: item.text, failed: !!activeSidechat.error, error: activeSidechat.error, state: activeSidechat.unconfirmed ? 'uncertain' as const : 'queued' as const })) : queuedFollowUps.filter(
            (followUp) => followUp.threadId === String(active.id ?? "") && (followUp.threadId || followUp.draftContext === draftContextGenerationRef.current),
          )}
          accessMode={activeThreadAccessMode}
          resumeError={activeThreadResumeError}
          tokenUsage={tokenUsageByThread[active.id] ?? null}
          uploadUsage={uploadUsage}
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
            onSwitchNewChatBackend(backendId, draft, draftImages, draftFiles, savedDraftRef.current)
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
          onDraftChange={value => { draftInputRevisionRef.current += 1; currentDraftRef.current = { ...currentDraftRef.current, text: value }; setDraft(value); }}
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
      {!approval && requests[0]?.method === "item/tool/requestUserInput" && (
        <button className="pending-question-banner" onClick={approvalRequests.reopen}>
          <strong>{t("Codex 需要你的回答")}</strong>
          <span>{completionThreadTitle({ threadId: String((requests[0].params as AnyRecord)?.threadId ?? ""),
            threads, activeThread: active, fallback: t("新会话") })}</span>
          <span>{t("继续回答")}</span>
        </button>
      )}
      <ApprovalSheet
        key={approval ? approvalKey(approval) : "none"}
        approval={approval}
        onDismiss={approvalRequests.dismiss}
        threadTitle={approval ? completionThreadTitle({ threadId: String((approval.params as AnyRecord)?.threadId ?? ""),
          threads, activeThread: active, fallback: t("新会话") }) : undefined}
        submitting={approvalRequests.submitting}
        error={approvalRequests.error}
        userAnswers={userAnswers}
        onAnswerChange={approvalRequests.answer}
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

export function AppBootstrap({ initialRegistry }: { initialRegistry: BackendRegistry }) {
  return <NativeSwitchBoundary initialRegistry={initialRegistry}>{registry => <RestoredAppBootstrap initialRegistry={registry} />}</NativeSwitchBoundary>;
}

function RestoredAppBootstrap({
  initialRegistry,
}: {
  initialRegistry: BackendRegistry;
}) {
  const [registry, setRegistry] = useState(initialRegistry);
  useSwitchRegistry(registry, !registry.backends.length);
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
  const [nativeSettingsPage, setNativeSettingsPage] = useState('devices');
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

  return <UnconfiguredApp registry={registry} setRegistry={setRegistry} managerOpen={managerOpen} setManagerOpen={setManagerOpen} appUpdate={appUpdate} transportMode={transportMode} changeTransportMode={changeTransportMode} notificationPreference={notificationPreference} saveNotificationPreference={saveNotificationPreference} failedNotificationDevices={failedNotificationDevices} nativeSettingsPage={nativeSettingsPage} setNativeSettingsPage={setNativeSettingsPage} />;
}
/** 与ConfiguredApp互斥挂载，空registry也只有一个业务runtime。 */
function UnconfiguredApp({ registry, setRegistry, managerOpen, setManagerOpen, appUpdate, transportMode, changeTransportMode, notificationPreference, saveNotificationPreference, failedNotificationDevices, nativeSettingsPage, setNativeSettingsPage }: {
 registry: BackendRegistry; setRegistry: (value: BackendRegistry) => void; managerOpen: boolean; setManagerOpen: (value: boolean) => void;
 appUpdate: ReturnType<typeof useAppUpdate>; transportMode: TransportMode; changeTransportMode: (value: TransportMode) => void;
 notificationPreference: NotificationPreference; saveNotificationPreference: (value: NotificationPreference) => void; failedNotificationDevices: string[];
 nativeSettingsPage: string; setNativeSettingsPage: (value: string) => void;
}) {
  const { preference: languagePreference } = useI18n();
  const nativeRuntime = useNativeRuntime({ selectedBackendId: 'bootstrap', backends: [], groups: [],
    preferences: projectNativePreferences({ language: languagePreference, transportMode, fontSize: readFontSize(), notification: notificationPreference }),
  }, { 'settings.open': p => { setNativeSettingsPage(String(p.id || 'devices')); setManagerOpen(true); } });
  useNativeWorkspace(nativeRuntime, 'bootstrap', { ...emptyNativeSnapshot(), ready: true, title: t('添加设备'), conversationActions: [{ id: 'add-device', kind: 'action', title: t('添加设备'), command: { name: 'settings.open', params: {} } }] }, {});
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
        nativeRuntime={isNativeUIEnabled() ? nativeRuntime : null}
        nativePage={nativeSettingsPage}
        open={managerOpen}
        registry={registry}
        summaries={{}}
        transportMode={transportMode}
        onTransportModeChange={changeTransportMode}
        notificationPreference={notificationPreference}
        onNotificationPreferenceSave={saveNotificationPreference}
        failedNotificationDevices={failedNotificationDevices}
        onChange={(next: BackendRegistry) => {
          saveBackendRegistry(window.localStorage, next);
          setRegistry(next);
        }}
        onClose={() => setManagerOpen(false)}
        appUpdate={{
          supported: appUpdate.supported,
          manualCheckSupported: appUpdate.manualCheckSupported,
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
        nativeRuntime={isNativeUIEnabled() ? nativeRuntime : null}
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
  const { preference: languagePreference } = useI18n();
  const [registry, setRegistry] = useState(initialRegistry);
  useSwitchRegistry(registry);
  useEffect(() => { onRegistryChange(registry); }, [registry, onRegistryChange]);
  const [summaries, setSummaries] = useState<
    Record<string, BackendRuntimeSummary>
  >({});
  const [nativeSettingsPage, setNativeSettingsPage] = useState('devices');
  const [managerOpen, setManagerOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<
    Record<string, BackendThreadSnapshot>
  >({});
  const [listBackendId, setListBackendId] = useState(
    () =>
      window.localStorage.getItem("codex-mobile:list-backend") || "all",
  );
  const [query, setQuery] = useState("");
  const [nativeNavigationFilter, setNativeNavigationFilter] = useState("sessions");
  const [collapsedProjectKeys, setCollapsedProjectKeys] = useState(() =>
    readCollapsedProjectKeys(window.localStorage),
  );
  const [command, setCommand] = useState<WorkspaceCommand | null>(null);
  const [pendingCompletionTarget, setPendingCompletionTarget] =
    useState<RunCompletionNavigationTarget | null>(null);
  const commandIdRef = useRef(0);
  const nativeManagementPending = useRef(false);
  const {
    sidebarOpen,
    refreshVersion,
    silentRefreshVersion,
    openSidebar,
    closeSidebar,
    refresh: refreshAllBackends,
    refreshSilently: refreshAllBackendsSilently,
  } = useSidebarRefresh(undefined, !isNativeUIEnabled());
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
    setCollapsedProjectKeys(readCollapsedProjectKeys(window.localStorage));
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
        previous.conversationProject === snapshot.conversationProject &&
        previous.threads === snapshot.threads &&
        previous.projects === snapshot.projects &&
        previous.projectlessThreadIds === snapshot.projectlessThreadIds &&
        previous.projectThreadStates === snapshot.projectThreadStates &&
        previous.projectHasMore === snapshot.projectHasMore &&
        previous.projectLoadedCounts === snapshot.projectLoadedCounts &&
        previous.loadingProjectCwd === snapshot.loadingProjectCwd &&
        previous.refreshing === snapshot.refreshing &&
        previous.threadListRefreshing === snapshot.threadListRefreshing &&
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
        snapshot.threadListRefreshing || Object.values(snapshot.projectThreadStates ?? {}).some(
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
      const loadedCount = snapshots[backendId]?.projectLoadedCounts[cwd] ?? (snapshots[backendId]?.threads ?? []).filter(
        (thread) =>
          thread.isPinned !== true &&
          (thread.isUnread !== true || isThreadRunning(thread.status)) &&
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
      const current = readCollapsedProjectKeys(window.localStorage);
      const opening = isProjectCollapsed(current, backendId, cwd);
      const next = toggleProjectCollapsedKeys(current, backendId, cwd);
      writeCollapsedProjectKeys(window.localStorage, next);
      setCollapsedProjectKeys(next);
      if (opening) setCommand({ id: ++commandIdRef.current, backendId, type: "retry-project", cwd });
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

  const listedThreadRename = useThreadRename();

  const manageThread = useCallback(
    async (item: AggregatedThreadItem, action: ThreadManagementAction, nativeName?: string) => {
      let name: string | undefined;
      if (action === "rename") {
        const targetBackend = mountedBackends.find(entry => entry.id === item.backendId);
        if (!targetBackend) return false;
        name = nativeName ?? (await listedThreadRename.request(targetBackend, item.threadId, titleOf(item.thread)))?.trim();
        if (!name || name === titleOf(item.thread)) {
          return Promise.resolve(false);
        }
      }
      return new Promise<boolean>((resolve) => {
        // 先将携带完成回调的命令交给 workspace，避免同批导航覆盖后永久等待 ACK。
        flushSync(() => {
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
      });
    },
    [mountedBackends, listedThreadRename.request],
  );

  const startNewChat = useCallback((target?: NativeNewChatTarget) => {
    const savedBackendId = window.localStorage.getItem(
      "codex-mobile:new-chat-backend",
    );
    const currentProject = selectedBackend ? snapshots[selectedBackend.id]?.conversationProject : undefined;
    const backendId = target?.backendId ?? (currentProject !== undefined ? selectedBackend?.id : undefined) ?? mountedBackends.find(
      (backend) => backend.id === savedBackendId,
    )?.id ?? (
      listBackendId === "all"
        ? selectedBackend?.id ??
          mountedBackends[0]?.id
        : listBackendId);
    if (!backendId) return;
    window.localStorage.setItem("codex-mobile:new-chat-backend", backendId);
    selectBackend(backendId);
    setCommand({
      id: ++commandIdRef.current,
      backendId,
      type: "new",
      cwd: target ? target.cwd ?? null : currentProject ?? null,
    });
    closeSidebar();
  }, [
    closeSidebar,
    listBackendId,
    mountedBackends,
    selectBackend,
    selectedBackend?.id,
    snapshots,
  ]);

  const switchNewChatBackend = useCallback(
    (
      backendId: string,
      currentDraft: string,
      currentDraftImages: DraftImage[],
      currentDraftFiles: DraftFile[],
      savedDraftReference?: SavedDraftReference,
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
        savedDraftReference,
      });
    },
    [mountedBackends, selectBackend],
  );

  const nativeGroups = isNativeUIEnabled() ? projectNavigation({
    threads: scopedThreads, listBackendId, selectedBackendId: selectedBackend?.id ?? "",
    projectDirectories, hasProjectlessThreads, collapsedProjectKeys, projectThreadStates,
    projectHasMore, loadingProjectKeys, filter: nativeNavigationFilter, query, searching,
    backends: mountedBackends, backendSnapshots: snapshots,
    error: listError || (threadListState === "error" ? t("会话列表加载失败") : ""),
  }) : [];
  const performNativeProject = (name: string, params: Record<string, unknown>) => {
    const group = nativeGroups.find(group => group.command?.params.backendId === params.backendId && group.command?.params.cwd === params.cwd);
    const allowed = group?.command?.name === name || group?.actions?.some(action => action.command?.name === name && !action.disabled);
    if (!allowed) throw new Error(t("会话列表已更新，请刷新"));
    if (name === "project.toggle") toggleProjectCollapsed(String(params.backendId), String(params.cwd));
    else if (name === "project.more") toggleProject(String(params.backendId), String(params.cwd));
    else retryProject(String(params.backendId), String(params.cwd));
  };
  const nativeRuntime = useNativeRuntime({
    selectedBackendId: selectedBackend?.id ?? "", listBackendId, sidebarOpen, search: query, groups: nativeGroups,
    navigationLoading: projectNavigationLoading({
      loading: threadListState === "loading",
      hasContent: nativeGroups.some(group => group.category === "project" || group.items.some(item => item.command?.name === "thread.open")),
      backendIds: listBackendId === "all" ? mountedBackends.map(backend => backend.id) : [listBackendId],
      backendSnapshots: snapshots,
    }),
    backends: [{ id: "all", title: t("全部设备"), connected: true }, ...projectNativeBackends(registry.backends, summaries, snapshots)],
    preferences: projectNativePreferences({ language: languagePreference, transportMode, fontSize: readFontSize(), notification: notificationPreference }),
  }, {
    "settings.open": p => { setNativeSettingsPage(String(p.id || "devices")); setManagerOpen(true); },
    "drafts.open": () => setDraftsOpen(true),
    "navigation.sidebar": p => { if (p.open) openSidebar(); else closeSidebar(); },
    "navigation.search": p => setQuery(String(p.value)),
    "navigation.refresh": refreshAllBackends,
    "backend.select": p => {
      const id = String(p.id);
      if (id !== "all" && !mountedBackends.some(backend => backend.id === id)) throw new Error(t("设备已移除"));
      // 设备列表筛选不切换当前对话所属workspace。
      selectListBackend(id);
    },
    "navigation.filter": p => {
      const value = String(p.value);
      if (!["favorites", "projects", "sessions"].includes(value)) throw new Error(t("导航分类无效"));
      setNativeNavigationFilter(value);
    },
    "thread.new": p => startNewChat(resolveNativeNewChatTarget(p, mountedBackends, nativeGroups)),
    "thread.open": p => {
      const item = scopedThreads.find(item => item.backendId === p.backendId && item.threadId === p.threadId);
      if (!item) throw new Error(t("会话列表已更新，请刷新"));
      openThread(item);
    },
    "thread.summarize": async p => {
      const target = mountedBackends.find(entry => entry.id === p.backendId);
      if (!target) throw new Error(t("设备已移除"));
      return summarizeThreadTitle(target, String(p.threadId));
    },
    "thread.manage": async p => {
      const item = scopedThreads.find(item => item.backendId === p.backendId && item.threadId === p.threadId);
      if (!item) throw new Error(t("会话列表已更新，请刷新"));
      if (p.action === "rename" && typeof p.value !== "string") throw new Error(t("请输入新的会话名称"));
      if (nativeManagementPending.current) throw new Error(t("会话操作未完成"));
      nativeManagementPending.current = true;
      try {
        if (!await manageThread(item, p.action as ThreadManagementAction, typeof p.value === "string" ? p.value : undefined)) throw new Error(t("会话操作未完成"));
      } finally { nativeManagementPending.current = false; }
    },
    "project.toggle": p => performNativeProject("project.toggle", p),
    "project.more": p => performNativeProject("project.more", p),
    "project.retry": p => performNativeProject("project.retry", p),
  });
  if (!selectedBackend) {
    return <main className="app-shell"><div className="empty-state">{t("没有可用设备")}</div></main>;
  }

  return (
    <>
      {listedThreadRename.dialog}
      {mountedBackends.map((backend) => (
        <div
          className="backend-workspace"
          hidden={backend.id !== selectedBackend.id}
          key={`${backend.id}:${backend.baseUrl}:${backend.token}`}
        >
          <BackendWorkspace
            nativeRuntime={nativeRuntime}
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
            sidebarOpen={sidebarOpen}
            onCloseSidebar={closeSidebar}
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
            onNewChat={() => startNewChat()}
            onSelectBackend={selectListBackend}
            onManageBackends={() => setManagerOpen(true)}
            onRefresh={refreshAllBackends}
            onOpenDrafts={() => setDraftsOpen(true)}
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
      {draftsOpen && <DraftsSheet nativeRuntime={isNativeUIEnabled() ? nativeRuntime : null} onClose={() => setDraftsOpen(false)} onOpenDraft={saved => {
        const target = registry.backends.find(backend => backend.id === saved.backendId);
        if (!target) throw new Error(t("草稿的设备已移除，无法恢复"));
        const restored = restoreNewChatDraft(saved);
        const nextRegistry = { ...registry, selectedBackendId: target.id,
          backends: registry.backends.map(backend => backend.id === target.id ? { ...backend, enabled: true } : backend) };
        persistRegistry(nextRegistry);
        window.localStorage.setItem("codex-mobile:new-chat-backend", target.id);
        setCommand({ id: ++commandIdRef.current, backendId: target.id, type: "new", cwd: saved.cwd,
          draft: saved.text, draftImages: restored.images, draftFiles: restored.files, savedDraft: saved });
        setDraftsOpen(false);
        closeSidebar();
      }} />}
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
        nativeRuntime={isNativeUIEnabled() ? nativeRuntime : null}
        nativePage={nativeSettingsPage}
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
          manualCheckSupported: appUpdate.manualCheckSupported,
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
        nativeRuntime={isNativeUIEnabled() ? nativeRuntime : null}
        open={appUpdate.sheetOpen}
        state={appUpdate.state}
        onClose={() => appUpdate.setSheetOpen(false)}
        onInstall={appUpdate.install}
        onRetry={appUpdate.install}
      />
    </>
  );
}
