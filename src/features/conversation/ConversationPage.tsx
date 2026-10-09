import {
  type FormEvent,
  type RefObject,
  type UIEventHandler,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppServerClient } from "../../app-server/client";
import {
  createHistoricalMessageEditTarget,
  type HistoricalMessageEditTarget,
} from "../../app-server/history-edit";
import {
  filterInstalledSkills,
  insertSkillMention,
  skillDescription,
  skillDisplayName,
  skillMentionAt,
  type InstalledSkill,
  type SkillMentionQuery,
} from "../../app-server/skills";
import {
  filterInstalledPlugins,
  insertPluginMention,
  pluginDescription,
  pluginDisplayName,
  type InstalledPlugin,
} from "../../app-server/plugins";
import type { OlderTurnsLoadState } from "../../app-server/thread-session";
import type { BackendConfig } from "../../backends/types";
import { type DraftFile, type DraftImage } from "../../ui/attachments";
import {
  AppIcon,
  titleOf,
  type ConnectionState,
  type DisplayRecord,
} from "../../ui/app-display";
import { effortLabel } from "../../ui/settings";
import { groupConversationTurns } from "../../ui/conversation";
import { ErrorBanner } from "../../ui/ErrorBanner";
import { TurnCard } from "./Timeline";
import {
  ContextUsageButton,
  ConversationActionMenu,
  ConversationStatusSheet,
} from "./ConversationControls";
import { ImagePreviewSheet } from "./sheets/ImagePreviewSheet";
import { useConversationAutoScroll } from "./conversation-scroll";
import { useRealtimeConversation } from "./useRealtimeConversation";
import { t } from "../../i18n";
import videoPoster from "../../assets/video-poster.svg";
import { RunProgress } from "./RunProgress";
import type { HttpSyncState } from "../../backends/http-transport";

export type ConversationLoadState = "idle" | "loading" | "ready" | "error";

export type QueuedFollowUpPreview = {
  id: string;
  text: string;
  inputText?: string;
  attachmentCount?: number;
  failed?: boolean;
};

function formatRealtimeDuration(startedAt: number | null, now: number) {
  if (!startedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}

function RealtimeControls({
  status,
  startedAt,
  muted,
  userTranscript,
  assistantTranscript,
  onToggleMute,
  onStop,
}: {
  status: "connecting" | "listening" | "stopping";
  startedAt: number | null;
  muted: boolean;
  userTranscript: string;
  assistantTranscript: string;
  onToggleMute: () => void;
  onStop: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const statusLabel =
    status === "connecting"
      ? t("正在连接")
      : status === "stopping"
        ? t("正在结束")
        : muted
          ? t("已静音")
          : assistantTranscript
            ? t("Codex 正在回复")
            : t("正在聆听");
  return (
    <section className="realtime-panel" aria-label={t("实时语音控制")}>
      {(userTranscript || assistantTranscript) && (
        <div className="realtime-transcript" aria-live="polite">
          {userTranscript && <p className="user">{userTranscript}</p>}
          {assistantTranscript && <p>{assistantTranscript}</p>}
        </div>
      )}
      <div className="realtime-controls">
        <span>
          <i className="realtime-pulse" aria-hidden="true" />
          <strong>{statusLabel}</strong>
          <time>{formatRealtimeDuration(startedAt, now)}</time>
        </span>
        <button
          type="button"
          disabled={status !== "listening"}
          onClick={onToggleMute}
        >
          {muted ? t("恢复") : t("静音")}
        </button>
        <button
          type="button"
          className="realtime-stop"
          disabled={status === "stopping"}
          onClick={onStop}
        >
          {t("结束")}
        </button>
      </div>
    </section>
  );
}

export function ConversationPage({
  active,
  backendId,
  backendName,
  backends,
  projectOptions,
  loadState,
  loadError,
  olderTurnsState,
  connection,
  client,
  error,
  syncState = null,
  draft,
  draftImages,
  draftFiles,
  imageReading,
  busy,
  operationPending = false,
  steering,
  steerable,
  pendingSteerText,
  queuedFollowUps,
  accessMode,
  resumeError,
  tokenUsage,
  rateLimits,
  pendingAction,
  selectedServiceTier,
  selectedModelLabel,
  selectedEffort,
  selectedPermissionLabel,
  skills = [],
  plugins = [],
  skillsLoading = false,
  pluginsLoading = false,
  imageInputRef,
  onBack,
  onNewChatBackendChange,
  onNewChatProjectChange,
  onPin,
  onDuplicate,
  onRename,
  onArchive,
  onRetry,
  onLoadOlderTurns,
  onSubmit,
  onRemoveImage,
  onRemoveFile,
  onSelectImages,
  onSelectLocation,
  onOpenAgentSettings,
  onOpenPermissionSettings,
  onDraftChange,
  historyEdit = null,
  onEditUserMessage,
  onHistoryEditTextChange = () => undefined,
  onCancelHistoryEdit = () => undefined,
  onSubmitHistoryEdit = () => undefined,
  onInterrupt,
  onQueuedFollowUpAction,
  onQueuedFollowUpEdit = () => undefined,
  onQueuedFollowUpCancel = () => undefined,
}: {
  active: DisplayRecord;
  backendId: string;
  backendName: string;
  backends: BackendConfig[];
  projectOptions: Array<{ cwd: string; name: string }>;
  loadState: ConversationLoadState;
  loadError: string;
  olderTurnsState: OlderTurnsLoadState;
  connection: ConnectionState;
  client: AppServerClient | null;
  error: string;
  syncState?: HttpSyncState | null;
  draft: string;
  draftImages: DraftImage[];
  draftFiles: DraftFile[];
  imageReading: boolean;
  busy: boolean;
  operationPending?: boolean;
  steering: boolean;
  steerable: boolean;
  pendingSteerText: string;
  queuedFollowUps: QueuedFollowUpPreview[];
  accessMode: "interactive" | "readOnly";
  resumeError: string;
  tokenUsage: Record<string, any> | null;
  rateLimits: Record<string, any> | null;
  pendingAction: string;
  selectedServiceTier: string | null;
  selectedModelLabel: string;
  selectedEffort: string | null;
  selectedPermissionLabel: string;
  skills?: InstalledSkill[];
  plugins?: InstalledPlugin[];
  skillsLoading?: boolean;
  pluginsLoading?: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  onBack: () => void;
  onNewChatBackendChange: (backendId: string) => void;
  onNewChatProjectChange: (cwd: string) => void;
  onPin: () => Promise<boolean>;
  onDuplicate: () => Promise<boolean>;
  onRename: () => Promise<boolean>;
  onArchive: () => Promise<boolean>;
  onRetry: () => void;
  onLoadOlderTurns: () => Promise<boolean>;
  onSubmit: (event: FormEvent) => void;
  onRemoveImage: (imageId: string) => void;
  onRemoveFile: (fileId: string) => void;
  onSelectImages: (files: FileList | null) => Promise<void>;
  onSelectLocation: () => Promise<boolean>;
  onOpenAgentSettings: () => void;
  onOpenPermissionSettings: () => void;
  onDraftChange: (value: string) => void;
  historyEdit?: {
    target: HistoricalMessageEditTarget;
    text: string;
    submitting: boolean;
  } | null;
  onEditUserMessage?: (target: HistoricalMessageEditTarget) => void;
  onHistoryEditTextChange?: (value: string) => void;
  onCancelHistoryEdit?: () => void;
  onSubmitHistoryEdit?: () => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
  onQueuedFollowUpAction: (id: string) => void | Promise<void>;
  onQueuedFollowUpEdit?: (id: string, text: string) => void;
  onQueuedFollowUpCancel?: (id: string) => void;
}) {
  const selectedBackend =
    backends.find((backend) => backend.id === backendId) ?? null;
  const [previewImage, setPreviewImage] = useState<DraftImage | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [composerMaximized, setComposerMaximized] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [locationPending, setLocationPending] = useState(false);
  const [queuedFollowUpEdit, setQueuedFollowUpEdit] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const [skillMention, setSkillMention] = useState<SkillMentionQuery | null>(
    null,
  );
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const attachmentPickerRef = useRef<HTMLDivElement>(null);
  const turns = useMemo(
    () => groupConversationTurns(active.turns ?? []),
    [active.turns],
  );
  const isNewChat = !active.id;
  const hasDraft = Boolean(draft.trim() || draftImages.length || draftFiles.length);
  const canQueue = busy && !isNewChat && hasDraft;
  const realtime = useRealtimeConversation({
    client,
    threadId: String(active.id ?? ""),
    connectionOnline: connection === "online",
  });
  const realtimeActive = ["connecting", "listening", "stopping"].includes(
    realtime.state.status,
  );
  useEffect(() => {
    setComposerMaximized(false);
    setAttachmentMenuOpen(false);
    setSkillMention(null);
    setQueuedFollowUpEdit(null);
  }, [active.id, backendId]);
  useEffect(() => {
    if (
      queuedFollowUpEdit &&
      !queuedFollowUps.some((item) => item.id === queuedFollowUpEdit.id)
    ) {
      setQueuedFollowUpEdit(null);
    }
  }, [queuedFollowUpEdit, queuedFollowUps]);
  useEffect(() => {
    if (!composerMaximized) return;
    composerInputRef.current?.focus({ preventScroll: true });
  }, [composerMaximized]);

  useEffect(() => {
    if (!attachmentMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !attachmentPickerRef.current?.contains(event.target)
      ) {
        setAttachmentMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [attachmentMenuOpen]);
  useEffect(() => {
    setActiveSkillIndex(0);
  }, [skillMention?.query, skills, plugins]);
  useEffect(() => {
    if (!draft) setSkillMention(null);
  }, [draft]);
  const matchingMentions = skillMention
    ? [
        ...filterInstalledSkills(skills, skillMention.query)
          .slice(0, 8)
          .map((skill) => ({ kind: "skill" as const, skill })),
        ...filterInstalledPlugins(plugins, skillMention.query)
          .slice(0, 8)
          .map((plugin) => ({ kind: "plugin" as const, plugin })),
      ]
    : [];
  const syncSkillMention = (value: string, cursor: number | null) => {
    setSkillMention(skillMentionAt(value, cursor ?? value.length));
  };
  const chooseSkill = (skill: InstalledSkill) => {
    const input = composerInputRef.current;
    const mention = skillMentionAt(
      draft,
      input?.selectionStart ?? skillMention?.end ?? draft.length,
    );
    if (!mention) return;
    const next = insertSkillMention(draft, mention, skill);
    onDraftChange(next.text);
    setSkillMention(null);
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus({ preventScroll: true });
      composerInputRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };
  const choosePlugin = (plugin: InstalledPlugin) => {
    const input = composerInputRef.current;
    const mention = skillMentionAt(
      draft,
      input?.selectionStart ?? skillMention?.end ?? draft.length,
    );
    if (!mention) return;
    const next = insertPluginMention(draft, mention, plugin);
    onDraftChange(next.text);
    setSkillMention(null);
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus({ preventScroll: true });
      composerInputRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };
  const {
    scrollRef,
    contentRef,
    onScroll,
    beginPrependPreservation,
    cancelPrependPreservation,
  } = useConversationAutoScroll({
    threadId: String(active.id ?? `new:${backendId}`),
    contentRevision: active.turns,
    ready: loadState === "ready",
  });
  const interactive =
    loadState === "ready" &&
    accessMode === "interactive";
  const requestOlderTurns = () => {
    if (!["idle", "error"].includes(olderTurnsState)) return;
    beginPrependPreservation();
    void onLoadOlderTurns().then((loaded) => {
      if (!loaded) cancelPrependPreservation();
    });
  };
  const handleScroll: UIEventHandler<HTMLDivElement> = (event) => {
    onScroll(event);
    if (
      event.currentTarget.scrollTop <= 48 &&
      olderTurnsState === "idle"
    ) {
      requestOlderTurns();
    }
  };
  return (
    <section className="conversation">
      <header className="conversation-header">
        <button
          className="round-button"
          aria-label={t("打开会话列表")}
          onClick={onBack}
        >
          <AppIcon name="menu" />
        </button>
        <div className="thread-heading">
          <strong>{titleOf(active)}</strong>
          <span>
            <i className={`status-dot ${connection}`} />
            {backendName} · {active.isProjectless
              ? t("无项目")
              : active.cwd?.split("/").pop() || t("无项目")} ·{" "}
            {connection === "online" ? t("已连接") : t("连接中")}
          </span>
        </div>
        {!!active.id && (
          <div
            className="conversation-header-actions"
            role="group"
            aria-label={t("会话详情操作")}
          >
            <ContextUsageButton
              tokenUsage={tokenUsage}
              onClick={() => {
                setActionsOpen(false);
                setStatusOpen(true);
              }}
            />
            <button
              className="round-button"
              type="button"
              aria-label={t("会话操作")}
              aria-expanded={actionsOpen}
              onClick={() => {
                setStatusOpen(false);
                setActionsOpen((current) => !current);
              }}
            >
              <AppIcon name="more" />
            </button>
          </div>
        )}
      </header>
      <ConversationActionMenu
        open={actionsOpen}
        readOnly={accessMode === "readOnly"}
        thread={active}
        pendingAction={pendingAction}
        onClose={() => setActionsOpen(false)}
        onPin={() => {
          void onPin().then((completed) => {
            if (completed) setActionsOpen(false);
          });
        }}
        onRefresh={() => {
          setActionsOpen(false);
          onRetry();
        }}
        onDuplicate={() => {
          void onDuplicate().then((completed) => {
            if (completed) setActionsOpen(false);
          });
        }}
        onCopy={() => {
          void navigator.clipboard?.writeText(String(active.id));
          setActionsOpen(false);
        }}
        onRename={() => {
          void onRename().then((completed) => {
            if (completed) setActionsOpen(false);
          });
        }}
        onArchive={() => {
          void onArchive().then((completed) => {
            if (completed) setActionsOpen(false);
          });
        }}
      />
      <div
        className="conversation-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        <div className="conversation-scroll-content" ref={contentRef}>
          {isNewChat && (
            <section className="new-chat-targets" aria-label={t("新聊天目标")}>
              <h2>{t("开始处理")}</h2>
              <label>
                <AppIcon name="folder" />
                <span>
                  <small>{t("项目")}</small>
                  <strong>
                    {projectOptions.find(
                      (project) => project.cwd === active.cwd,
                    )?.name ?? t("无项目")}
                  </strong>
                </span>
                <select
                  aria-label={t("选择项目")}
                  value={active.cwd ?? ""}
                  onChange={(event) =>
                    onNewChatProjectChange(event.currentTarget.value)
                  }
                >
                  <option value="">{t("无项目")}</option>
                  {projectOptions.map((project) => (
                    <option value={project.cwd} key={project.cwd}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="device-glyph" aria-hidden="true">▰</span>
                <span>
                  <small>{t("机器")}</small>
                  <strong>{backendName}</strong>
                </span>
                <select
                  aria-label={t("选择机器")}
                  value={backendId}
                  onChange={(event) =>
                    onNewChatBackendChange(event.currentTarget.value)
                  }
                >
                  {backends.map((backend) => (
                    <option value={backend.id} key={backend.id}>
                      {backend.name}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          )}
          <div className="timeline" aria-busy={loadState === "loading"}>
            {loadState === "ready" && olderTurnsState === "idle" && (
              <button
                type="button"
                className="older-turns-control"
                onClick={requestOlderTurns}
              >
                {t("加载更早消息")}
              </button>
            )}
            {loadState === "ready" && olderTurnsState === "loading" && (
              <div className="older-turns-status" role="status">
                <i className="action-spinner" aria-hidden="true" />
                {t("正在加载更早消息")}
              </div>
            )}
            {loadState === "ready" && olderTurnsState === "error" && (
              <button
                type="button"
                className="older-turns-control error"
                onClick={requestOlderTurns}
              >
                {t("加载失败，点击重试")}
              </button>
            )}
            {loadState === "loading" ? (
              <div
                className="conversation-skeleton"
                role="status"
                aria-label={t("正在加载会话详情")}
              >
                {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
              </div>
            ) : loadState === "error" ? (
              <div className="conversation-load-error" role="alert">
                <strong>{t("无法加载会话")}</strong>
                <p>{loadError || t("请检查连接后重试。")}</p>
                <button type="button" onClick={onRetry}>{t("重试")}</button>
              </div>
            ) : turns.length ? turns.map((turn: DisplayRecord, index: number) => {
              const target = createHistoricalMessageEditTarget(
                active.turns ?? [],
                String(turn.id ?? ""),
                historyEdit?.target.turnId === String(turn.id ?? "")
                  ? historyEdit.target.messageId
                  : undefined,
              );
              const canEditHistory = Boolean(
                target &&
                onEditUserMessage &&
                !historyEdit &&
                interactive &&
                !busy &&
                !steering &&
                !realtimeActive &&
                !imageReading &&
                queuedFollowUps.length === 0,
              );
              return (
                <TurnCard
                  key={turn.id ?? index}
                  turn={turn}
                  threadId={String(active.id)}
                  liveDiff={turn.liveDiff}
                  client={client}
                  backend={selectedBackend}
                  onEditUserMessage={
                    canEditHistory
                      ? (messageId) => {
                          const messageTarget = createHistoricalMessageEditTarget(
                            active.turns ?? [], String(turn.id ?? ""), messageId,
                          );
                          if (messageTarget) onEditUserMessage!(messageTarget);
                        }
                      : undefined
                  }
                  inlineEdit={
                    historyEdit && target?.turnId === historyEdit.target.turnId
                      ? {
                          messageId: historyEdit.target.messageId,
                          precedingMessageCount: historyEdit.target.precedingMessageCount,
                          value: historyEdit.text,
                          submitting: historyEdit.submitting,
                          hasLaterTurns: historyEdit.target.hasLaterTurns,
                          attachmentCount: historyEdit.target.attachmentCount,
                          onChange: onHistoryEditTextChange,
                          onCancel: onCancelHistoryEdit,
                          onSubmit: onSubmitHistoryEdit,
                        }
                      : undefined
                  }
                />
              );
            }) : !isNewChat && (
              <div className="empty-state">{t("开始一次新的 Codex 对话")}</div>
            )}
            <RunProgress thread={active} busy={busy} sync={syncState} operationPending={operationPending} />
          </div>
        </div>
      </div>
      <ErrorBanner message={error} />
      <form
        className={`composer-wrap${
          composerMaximized ? " composer-wrap-maximized" : ""
        }`}
        aria-busy={imageReading}
        onSubmit={(event) => {
          if (historyEdit) event.preventDefault();
          else onSubmit(event);
          setAttachmentMenuOpen(false);
          setComposerMaximized(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && attachmentMenuOpen) {
            event.preventDefault();
            setAttachmentMenuOpen(false);
          } else if (event.key === "Escape" && composerMaximized) {
            event.preventDefault();
            setComposerMaximized(false);
          }
        }}
      >
        {accessMode === "readOnly" && (
          <div
            className="readonly-thread-banner"
            role="status"
            title={resumeError}
          >
            <span>{t("该会话正在其他 Codex 客户端运行，当前为只读模式")}</span>
            <button type="button" onClick={onRetry}>
              {t("重新连接")}
            </button>
          </div>
        )}
        {realtimeActive && (
          <RealtimeControls
            status={
              realtime.state.status as "connecting" | "listening" | "stopping"
            }
            startedAt={realtime.state.startedAt}
            muted={realtime.state.muted}
            userTranscript={realtime.state.userTranscript}
            assistantTranscript={realtime.state.assistantTranscript}
            onToggleMute={realtime.toggleMute}
            onStop={() => void realtime.stop()}
          />
        )}
        {(pendingSteerText || queuedFollowUps.length > 0) && (
          <div className="composer-follow-up-stack">
            {pendingSteerText && (
              <div
                className="pending-steer-message"
                role="status"
                aria-label={t("已发送引导")}
                title={pendingSteerText}
              >
                {pendingSteerText}
              </div>
            )}
            {queuedFollowUps.length > 0 && (
              <div
                className="queued-follow-ups"
                role="status"
                aria-label={t("排队消息")}
              >
                {queuedFollowUps.map((followUp) => {
                  const canSteerFollowUp = busy && steerable;
                  const canRetryFollowUp = !busy && followUp.failed;
                  const editing = queuedFollowUpEdit?.id === followUp.id;
                  const editedText = editing ? queuedFollowUpEdit.text.trim() : "";
                  const canSaveEdit = Boolean(
                    editedText || (followUp.attachmentCount ?? 0) > 0,
                  );
                  return (
                    <div
                      className={`queued-follow-up${editing ? " editing" : ""}`}
                      key={followUp.id}
                    >
                      {editing ? (
                        <>
                          <textarea
                            aria-label={t("编辑排队消息内容")}
                            value={queuedFollowUpEdit.text}
                            disabled={steering}
                            rows={2}
                            onChange={(event) =>
                              setQueuedFollowUpEdit({
                                id: followUp.id,
                                text: event.currentTarget.value,
                              })
                            }
                          />
                          {(followUp.attachmentCount ?? 0) > 0 && (
                            <small>
                              {t("{count} 个附件会保留", {
                                count: followUp.attachmentCount ?? 0,
                              })}
                            </small>
                          )}
                          <div className="queued-follow-up-actions">
                            <button
                              type="button"
                              aria-label={t("取消编辑排队消息")}
                              disabled={steering}
                              onClick={() => setQueuedFollowUpEdit(null)}
                            >
                              {t("取消")}
                            </button>
                            <button
                              type="button"
                              aria-label={t("保存排队消息")}
                              disabled={steering || !canSaveEdit}
                              onClick={() => {
                                onQueuedFollowUpEdit(followUp.id, editedText);
                                setQueuedFollowUpEdit(null);
                              }}
                            >
                              {t("保存")}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span title={followUp.text}>{followUp.text}</span>
                          <div className="queued-follow-up-actions">
                            <button
                              type="button"
                              aria-label={t("编辑排队消息")}
                              disabled={steering}
                              onClick={() =>
                                setQueuedFollowUpEdit({
                                  id: followUp.id,
                                  text: followUp.inputText ?? followUp.text,
                                })
                              }
                            >
                              {t("编辑")}
                            </button>
                            <button
                              type="button"
                              aria-label={t("取消排队消息")}
                              disabled={steering}
                              onClick={() => onQueuedFollowUpCancel(followUp.id)}
                            >
                              {t("取消")}
                            </button>
                            <button
                              type="button"
                              disabled={
                                steering || (!canSteerFollowUp && !canRetryFollowUp)
                              }
                              onClick={() => onQueuedFollowUpAction(followUp.id)}
                            >
                              {canSteerFollowUp
                                ? t("改为引导")
                                : canRetryFollowUp
                                  ? t("重试")
                                  : t("排队中")}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {draftImages.length > 0 && (
          <div className="draft-images" aria-label={t("待发送图片")}>
            {draftImages.map((image) => (
              <figure key={image.id}>
                <button
                  type="button"
                  className="draft-image-preview"
                  aria-label={t("预览 {name}", { name: image.name })}
                  onClick={() => setPreviewImage(image)}
                >
                  <img src={image.url} alt={t("待发送 {name}", { name: image.name })} />
                </button>
                <button
                  type="button"
                  className="draft-image-remove"
                  aria-label={t("移除 {name}", { name: image.name })}
                  onClick={() => onRemoveImage(image.id)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </figure>
            ))}
          </div>
        )}
        {draftFiles.length > 0 && (
          <div className="draft-files" aria-label={t("待发送文件")}>
            {draftFiles.map((file) => (
              <figure key={file.id}>
                {file.type.startsWith("video/") ? (
                  <video
                    src={file.previewUrl}
                    aria-label={t("待发送 {name}", { name: file.name })}
                    controls
                    preload="metadata"
                    poster={videoPoster}
                  />
                ) : file.type.startsWith("audio/") ? (
                  <div className="draft-file-audio">
                    <span aria-hidden="true">♪</span>
                    <audio src={file.previewUrl} controls preload="metadata" />
                  </div>
                ) : (
                  <div className="draft-file-glyph" aria-hidden="true">
                    <span>
                      {file.name.split(".").at(-1)?.slice(0, 5).toUpperCase() || "FILE"}
                    </span>
                  </div>
                )}
                <figcaption title={file.name}>{file.name}</figcaption>
                <button
                  type="button"
                  className="draft-image-remove"
                  aria-label={t("移除 {name}", { name: file.name })}
                  onClick={() => onRemoveFile(file.id)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </figure>
            ))}
          </div>
        )}
        {previewImage && (
          <ImagePreviewSheet
            src={previewImage.url}
            name={previewImage.name}
            alt={t("待发送 {name}", { name: previewImage.name })}
            onClose={() => setPreviewImage(null)}
          />
        )}
        {imageReading && (
          <div className="draft-image-reading" role="status" aria-live="polite">
            {t("正在处理附件…")}
          </div>
        )}
        <div className="chips">
          <button
            type="button"
            aria-label={t("选择模型、智能与速度")}
            disabled={!interactive}
            onClick={onOpenAgentSettings}
          >
            {selectedServiceTier ? "⚡ " : ""}
            {selectedModelLabel} {effortLabel(selectedEffort)}
          </button>
          <button
            type="button"
            aria-label={t("选择审批与权限模式")}
            disabled={!interactive}
            onClick={onOpenPermissionSettings}
          >
            {selectedPermissionLabel}
          </button>
        </div>
        {skillMention && (
          <section
            id="installed-mention-options"
            className="skill-mention-menu"
            role="listbox"
            aria-label={t("已安装 Skill 和插件")}
          >
            <p>{t("选择 Skill 或插件")}</p>
            {skillsLoading || pluginsLoading ? (
              <div className="skill-mention-status" role="status">
                <i className="action-spinner" aria-hidden="true" />
                {t("正在加载 Skill 和插件…")}
              </div>
            ) : matchingMentions.length ? (
              matchingMentions.map((option, index) => (
                <button
                  id={`installed-mention-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeSkillIndex}
                  className={index === activeSkillIndex ? "selected" : ""}
                  key={
                    option.kind === "skill"
                      ? `skill:${option.skill.path}`
                      : `plugin:${option.plugin.id}`
                  }
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() =>
                    option.kind === "skill"
                      ? chooseSkill(option.skill)
                      : choosePlugin(option.plugin)
                  }
                >
                  {option.kind === "skill" ? (
                    <span>
                      <code title={`$${option.skill.name}`}>
                        ${option.skill.name}
                      </code>
                      {skillDisplayName(option.skill) !== option.skill.name && (
                        <strong>{skillDisplayName(option.skill)}</strong>
                      )}
                      <small>{skillDescription(option.skill)}</small>
                      <i className="skill-mention-kind">Skill</i>
                    </span>
                  ) : (
                    <span>
                      <code title={`@${option.plugin.name}`}>
                        @{option.plugin.name}
                      </code>
                      {pluginDisplayName(option.plugin) !== option.plugin.name && (
                        <strong>{pluginDisplayName(option.plugin)}</strong>
                      )}
                      <small>{pluginDescription(option.plugin)}</small>
                      <i className="skill-mention-kind">{t("插件")}</i>
                    </span>
                  )}
                </button>
              ))
            ) : (
              <div className="skill-mention-status">
                {t("没有匹配的 Skill 或插件")}
              </div>
            )}
          </section>
        )}
        <div className="composer">
          <div className="attachment-picker" ref={attachmentPickerRef}>
            <input
              ref={photoInputRef}
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              aria-label={t("选择图片")}
              onChange={(event) => {
                const input = event.currentTarget;
                void onSelectImages(input.files).finally(() => {
                  input.value = "";
                });
              }}
            />
            <input
              ref={imageInputRef}
              className="visually-hidden"
              type="file"
              accept="*/*"
              multiple
              aria-label={t("选择文件")}
              onChange={(event) => {
                const input = event.currentTarget;
                void onSelectImages(input.files).finally(() => {
                  input.value = "";
                });
              }}
            />
            <button
              type="button"
              className="add-button"
              aria-label={t("添加附件")}
              aria-controls="attachment-menu"
              aria-expanded={attachmentMenuOpen}
              disabled={
                !interactive ||
                realtimeActive ||
                imageReading ||
                locationPending ||
                Boolean(historyEdit)
              }
              onClick={() => setAttachmentMenuOpen((current) => !current)}
            >
              ＋
            </button>
            {attachmentMenuOpen && (
              <div
                id="attachment-menu"
                className="attachment-menu"
                role="menu"
                aria-label={t("附件菜单")}
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={locationPending}
                  onClick={() => {
                    setAttachmentMenuOpen(false);
                    photoInputRef.current?.click();
                  }}
                >
                  <AppIcon name="image" />
                  <span>{t("图片")}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={locationPending}
                  onClick={() => {
                    setAttachmentMenuOpen(false);
                    imageInputRef.current?.click();
                  }}
                >
                  <AppIcon name="file" />
                  <span>{t("文件")}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={locationPending}
                  onClick={() => {
                    setLocationPending(true);
                    void onSelectLocation()
                      .then((selected) => {
                        if (selected) {
                          setAttachmentMenuOpen(false);
                          composerInputRef.current?.focus({ preventScroll: true });
                        }
                      })
                      .finally(() => setLocationPending(false));
                  }}
                >
                  {locationPending ? (
                    <i className="action-spinner" aria-hidden="true" />
                  ) : (
                    <AppIcon name="location" />
                  )}
                  <span>{locationPending ? t("正在定位…") : t("当前位置")}</span>
                </button>
              </div>
            )}
          </div>
          <textarea
            ref={composerInputRef}
            aria-label={t("向 Codex 提问")}
            value={draft}
            disabled={
              !interactive || steering || realtimeActive || Boolean(historyEdit)
            }
            aria-controls={skillMention ? "installed-mention-options" : undefined}
            aria-expanded={Boolean(skillMention)}
            aria-activedescendant={
              skillMention && matchingMentions.length
                ? `installed-mention-option-${activeSkillIndex}`
                : undefined
            }
            onChange={(event) => {
              onDraftChange(event.target.value);
              syncSkillMention(
                event.target.value,
                event.target.selectionStart,
              );
            }}
            onSelect={(event) =>
              syncSkillMention(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
              )
            }
            onBlur={() => setSkillMention(null)}
            onKeyDown={(event) => {
              if (!skillMention || event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" && matchingMentions.length) {
                event.preventDefault();
                setActiveSkillIndex(
                  (current) => (current + 1) % matchingMentions.length,
                );
              } else if (event.key === "ArrowUp" && matchingMentions.length) {
                event.preventDefault();
                setActiveSkillIndex(
                  (current) =>
                    (current - 1 + matchingMentions.length) %
                    matchingMentions.length,
                );
              } else if (
                (event.key === "Enter" || event.key === "Tab") &&
                matchingMentions[activeSkillIndex]
              ) {
                event.preventDefault();
                const option = matchingMentions[activeSkillIndex];
                option.kind === "skill"
                  ? chooseSkill(option.skill)
                  : choosePlugin(option.plugin);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setSkillMention(null);
              }
            }}
            placeholder={t("向 Codex 提问")}
            rows={1}
          />
          <button
            type="button"
            className="composer-size-button"
            disabled={Boolean(historyEdit)}
            aria-label={
              composerMaximized ? t("还原输入框") : t("最大化输入框")
            }
            aria-pressed={composerMaximized}
            onClick={() => setComposerMaximized((current) => !current)}
          >
            <AppIcon name={composerMaximized ? "minimize" : "maximize"} />
          </button>
          <button
            type={busy && !canQueue ? "button" : "submit"}
            onClick={
              busy && !canQueue ? onInterrupt : undefined
            }
            className={`send-button${
              busy && !canQueue ? " send-button-running" : ""
            }`}
            aria-busy={busy && !canQueue}
            aria-label={
              steering
                ? t("正在引导")
                : canQueue
                  ? t("排队")
                  : busy
                    ? t("停止")
                    : t("发送")
            }
            disabled={
              !interactive ||
              Boolean(historyEdit) ||
              steering ||
              (canQueue && imageReading) ||
              (!busy && (imageReading || !hasDraft))
            }
          >
            {steering ? (
              <i className="action-spinner composer-steer-spinner" />
            ) : (
              <AppIcon name={busy && !canQueue ? "stop" : "send"} />
            )}
          </button>
        </div>
      </form>
      <ConversationStatusSheet
        open={statusOpen}
        thread={active}
        tokenUsage={tokenUsage}
        rateLimits={rateLimits}
        onClose={() => setStatusOpen(false)}
      />
    </section>
  );
}
