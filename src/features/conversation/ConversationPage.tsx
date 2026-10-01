import {
  type FormEvent,
  type RefObject,
  type UIEventHandler,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppServerClient } from "../../app-server/client";
import {
  filterInstalledSkills,
  insertSkillMention,
  skillDescription,
  skillDisplayName,
  skillMentionAt,
  type InstalledSkill,
  type SkillMentionQuery,
} from "../../app-server/skills";
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

export type ConversationLoadState = "idle" | "loading" | "ready" | "error";

export type QueuedFollowUpPreview = {
  id: string;
  text: string;
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
  draft,
  draftImages,
  draftFiles,
  imageReading,
  busy,
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
  skillsLoading = false,
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
  onOpenAgentSettings,
  onOpenPermissionSettings,
  onDraftChange,
  onResendUserMessage,
  onInterrupt,
  onQueuedFollowUpAction,
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
  draft: string;
  draftImages: DraftImage[];
  draftFiles: DraftFile[];
  imageReading: boolean;
  busy: boolean;
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
  skillsLoading?: boolean;
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
  onOpenAgentSettings: () => void;
  onOpenPermissionSettings: () => void;
  onDraftChange: (value: string) => void;
  onResendUserMessage?: (text: string) => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
  onQueuedFollowUpAction: (id: string) => void | Promise<void>;
}) {
  const selectedBackend =
    backends.find((backend) => backend.id === backendId) ?? null;
  const [previewImage, setPreviewImage] = useState<DraftImage | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [composerMaximized, setComposerMaximized] = useState(false);
  const [skillMention, setSkillMention] = useState<SkillMentionQuery | null>(
    null,
  );
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const turns = groupConversationTurns(active.turns ?? []);
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
    setSkillMention(null);
  }, [active.id, backendId]);
  useEffect(() => {
    if (!composerMaximized) return;
    composerInputRef.current?.focus({ preventScroll: true });
  }, [composerMaximized]);
  useEffect(() => {
    setActiveSkillIndex(0);
  }, [skillMention?.query, skills]);
  useEffect(() => {
    if (!draft) setSkillMention(null);
  }, [draft]);
  const matchingSkills = skillMention
    ? filterInstalledSkills(skills, skillMention.query).slice(0, 8)
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
            ) : turns.length ? turns.map((turn: DisplayRecord, index: number) => (
              <TurnCard
                key={turn.id ?? index}
                turn={turn}
                liveDiff={turn.liveDiff}
                client={client}
                backend={selectedBackend}
                onEditUserMessage={(text) => {
                  onDraftChange(text);
                  composerInputRef.current?.focus({ preventScroll: true });
                }}
                onResendUserMessage={onResendUserMessage}
                userMessageActionsDisabled={
                  !interactive || steering || realtimeActive || imageReading
                }
              />
            )) : !isNewChat && (
              <div className="empty-state">{t("开始一次新的 Codex 对话")}</div>
            )}
          </div>
        </div>
      </div>
      <ErrorBanner message={error} />
      <form
        className={`composer-wrap${
          composerMaximized ? " composer-wrap-maximized" : ""
        }`}
        aria-busy={imageReading}
        onSubmit={onSubmit}
        onKeyDown={(event) => {
          if (event.key === "Escape" && composerMaximized) {
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
                  return (
                    <div className="queued-follow-up" key={followUp.id}>
                      <span title={followUp.text}>{followUp.text}</span>
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
            id="installed-skill-options"
            className="skill-mention-menu"
            role="listbox"
            aria-label={t("已安装 Skill")}
          >
            <p>{t("选择 Skill")}</p>
            {skillsLoading ? (
              <div className="skill-mention-status" role="status">
                <i className="action-spinner" aria-hidden="true" />
                {t("正在加载 Skill…")}
              </div>
            ) : matchingSkills.length ? (
              matchingSkills.map((skill, index) => (
                <button
                  id={`installed-skill-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeSkillIndex}
                  className={index === activeSkillIndex ? "selected" : ""}
                  key={skill.path}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => chooseSkill(skill)}
                >
                  <span>
                    <strong>{skillDisplayName(skill)}</strong>
                    <small>{skillDescription(skill)}</small>
                  </span>
                  <code>${skill.name}</code>
                </button>
              ))
            ) : (
              <div className="skill-mention-status">
                {t("没有匹配的 Skill")}
              </div>
            )}
          </section>
        )}
        <div className="composer">
          <input
            ref={imageInputRef}
            className="visually-hidden"
            type="file"
            accept="*/*"
            multiple
            aria-label={t("选择图片或视频")}
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
            disabled={
              !interactive ||
              realtimeActive ||
              imageReading
            }
            onClick={() => imageInputRef.current?.click()}
          >
            ＋
          </button>
          <textarea
            ref={composerInputRef}
            aria-label={t("向 Codex 提问")}
            value={draft}
            disabled={!interactive || steering || realtimeActive}
            aria-controls={skillMention ? "installed-skill-options" : undefined}
            aria-expanded={Boolean(skillMention)}
            aria-activedescendant={
              skillMention && matchingSkills.length
                ? `installed-skill-option-${activeSkillIndex}`
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
              if (event.key === "ArrowDown" && matchingSkills.length) {
                event.preventDefault();
                setActiveSkillIndex(
                  (current) => (current + 1) % matchingSkills.length,
                );
              } else if (event.key === "ArrowUp" && matchingSkills.length) {
                event.preventDefault();
                setActiveSkillIndex(
                  (current) =>
                    (current - 1 + matchingSkills.length) %
                    matchingSkills.length,
                );
              } else if (
                (event.key === "Enter" || event.key === "Tab") &&
                matchingSkills[activeSkillIndex]
              ) {
                event.preventDefault();
                chooseSkill(matchingSkills[activeSkillIndex]);
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
