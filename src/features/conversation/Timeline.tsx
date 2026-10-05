import { useEffect, useRef, useState, type RefObject } from "react";
import { AppServerClient } from "../../app-server/client";
import type { BackendConfig } from "../../backends/types";
import {
  automationAgentMessageText,
  groupTimelineEntries,
  groupTurnItems,
  imageSourcesForItem,
  MarkdownMessage,
  parseAutomationHeartbeat,
  shouldCollapseUserMessage,
  splitCompletedTurnResponses,
  splitTurnResponseSegments,
  stripGitDirectives,
  summarizeToolActivity,
  summarizeTurnChanges,
  hasTurnChangeStats,
  toolActivityRowLabel,
  turnDurationMs,
  type ImageSource,
} from "../../ui/conversation";
import {
  CopyButton,
  selectElementText,
  visibleAssistantText,
} from "../../ui/copy";
import { Chevron } from "../../ui/icons";
import {
  RemoteFileLink,
  RemoteImage,
  RemoteVideo,
  isPreviewableVideoPath,
} from "./sheets/RemoteFileSheets";
import { t, getActiveLocale } from "../../i18n";
import {
  extractGeneratedTitle,
  stripConversationTitleRequest,
} from "../../app-server/conversation-title";
import {
  FileDiffSheet,
  ImageGenerationFailure,
  ToolDetailSheet,
} from "./sheets/ToolSheets";
import "./timeline-timestamps.css";

type AnyRecord = Record<string, any>;

type InlineUserMessageEdit = {
  value: string;
  submitting: boolean;
  hasLaterTurns: boolean;
  attachmentCount: number;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
};

type UserMessageActionProps = {
  onEditUserMessage?: () => void;
  inlineEdit?: InlineUserMessageEdit;
  userMessageActionsDisabled?: boolean;
};

export function formatMessageTimestamp(timestamp: number | null | undefined) {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp * 1000);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(" ");
}

function MessageTimestamp({
  timestamp,
  className,
}: {
  timestamp?: number | null;
  className: string;
}) {
  const label = formatMessageTimestamp(timestamp);
  if (!label || timestamp == null) return null;
  return (
    <time
      className={`message-timestamp ${className}`}
      dateTime={new Date(timestamp * 1000).toISOString()}
    >
      {label}
    </time>
  );
}

function itemText(item: AnyRecord) {
  let text = "";
  if (typeof item.aggregatedOutput === "string") text = item.aggregatedOutput;
  else if (typeof item.text === "string") text = item.text;
  else if (typeof item.content === "string") text = item.content;
  if (Array.isArray(item.content)) {
    text = item.content
      .map((part: AnyRecord) => {
        const partText = String(part.text ?? "");
        return item.type === "userMessage"
          ? stripConversationTitleRequest(partText)
          : partText;
      })
      .join("");
  } else if (typeof item.command === "string") text = item.command;
  else if (Array.isArray(item.command)) text = item.command.join(" ");
  else if (typeof item.output === "string") text = item.output;
  if (item.type === "userMessage") {
    return stripConversationTitleRequest(text);
  }
  if (item.type === "agentMessage") {
    return extractGeneratedTitle(text).text;
  }
  return text;
}

function videoPathForItem(item: AnyRecord) {
  const candidate = item.savedPath ?? item.path ?? item.result;
  return typeof candidate === "string" &&
    candidate.startsWith("/") &&
    isPreviewableVideoPath(candidate)
    ? candidate
    : "";
}

function ImageGallery({
  images,
  client,
  backend,
}: {
  images: ImageSource[];
  client: AppServerClient | null;
  backend?: BackendConfig | null;
}) {
  if (!images.length) return null;
  return (
    <div className={`message-images ${images.length === 1 ? "single" : ""}`}>
      {images.map((image, index) => (
        <RemoteImage
          key={`${image.source}-${index}`}
          image={image}
          client={client}
          backend={backend}
        />
      ))}
    </div>
  );
}

function UserBubble({
  item,
  client,
  backend,
  timestamp,
  onEditUserMessage,
  inlineEdit,
  userMessageActionsDisabled = false,
}: {
  item: AnyRecord;
  client: AppServerClient | null;
  backend?: BackendConfig | null;
  timestamp?: number | null;
} & UserMessageActionProps) {
  const rawText = itemText(item);
  const heartbeat = parseAutomationHeartbeat(rawText);
  const text = heartbeat?.instructions ?? rawText;
  const images = imageSourcesForItem(item);
  const collapsible = shouldCollapseUserMessage(text);
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [inlineEdit?.hasLaterTurns]);
  const bubble = (
    <div className={`user-bubble${inlineEdit ? " user-bubble-editing" : ""}`}>
      {inlineEdit ? (
        <div className="history-message-editor">
          <textarea
            autoFocus
            aria-label={t("编辑历史消息内容")}
            value={inlineEdit.value}
            disabled={inlineEdit.submitting}
            rows={Math.max(3, Math.min(10, inlineEdit.value.split("\n").length + 1))}
            onChange={(event) => inlineEdit.onChange(event.target.value)}
          />
          <small>
            {inlineEdit.attachmentCount > 0
              ? t("原消息的 {count} 个附件会保留", {
                  count: inlineEdit.attachmentCount,
                })
              : t("保存后将从这条消息重新执行")}
          </small>
          {confirming ? (
            <div
              className="history-edit-inline-confirmation"
              role="status"
              aria-label={t("确认删除后续对话")}
            >
              <strong>{t("删除后续对话并重发？")}</strong>
              <p>{t("目标消息及之后的对话将被移除，更早的历史会保留。")}</p>
              <p>{t("文件修改、已执行命令和远端操作不会撤销。")}</p>
              <div>
                <button
                  type="button"
                  disabled={inlineEdit.submitting}
                  onClick={() => setConfirming(false)}
                >
                  {t("取消")}
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={inlineEdit.submitting}
                  onClick={() => {
                    setConfirming(false);
                    void inlineEdit.onSubmit();
                  }}
                >
                  {t("删除后续并重发")}
                </button>
              </div>
            </div>
          ) : (
            <div className="history-message-editor-actions">
              <button
                type="button"
                disabled={inlineEdit.submitting}
                aria-label={t("取消编辑历史消息")}
                onClick={inlineEdit.onCancel}
              >
                {t("取消")}
              </button>
              <button
                type="button"
                className="primary"
                disabled={
                  inlineEdit.submitting ||
                  (!inlineEdit.value.trim() && inlineEdit.attachmentCount === 0)
                }
                aria-label={
                  inlineEdit.submitting
                    ? t("正在保存并重发")
                    : t("保存并重发")
                }
                onClick={() => {
                  if (inlineEdit.hasLaterTurns) {
                    setConfirming(true);
                  } else {
                    void inlineEdit.onSubmit();
                  }
                }}
              >
                {inlineEdit.submitting ? t("正在保存并重发") : t("保存并重发")}
              </button>
            </div>
          )}
        </div>
      ) : text ? (
        <div
          className={`user-message-text ${collapsible && !expanded ? "collapsed" : ""}`}
          onContextMenu={(event) => selectElementText(event.currentTarget)}
        >
          <MarkdownMessage
            text={text}
            className="user-markdown"
            renderImage={(source, alt) => (
              <RemoteImage
                image={{
                  source,
                  name: source.split("/").at(-1) || alt,
                  local: !/^(data:|https?:)/i.test(source),
                }}
                client={client}
                backend={backend}
                alt={alt}
              />
            )}
            renderLink={(href, children) => (
              <RemoteFileLink href={href} client={client} backend={backend}>
                {children}
              </RemoteFileLink>
            )}
          />
        </div>
      ) : null}
      <ImageGallery images={images} client={client} backend={backend} />
      {!inlineEdit && collapsible && (
        <button
          type="button"
          className="user-message-toggle"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
        >
          {expanded ? t("收起") : t("展开更多")}
          <Chevron direction={expanded ? "up" : "down"} />
        </button>
      )}
      {!inlineEdit && (
        <MessageTimestamp
          timestamp={timestamp}
          className="user-message-timestamp"
        />
      )}
    </div>
  );
  if (!heartbeat) {
    if (inlineEdit) return <div className="user-message">{bubble}</div>;
    const showActions = Boolean(onEditUserMessage);
    if (!showActions) return bubble;
    return (
      <div className="user-message">
        {bubble}
        <div
          className="user-message-actions"
          role="group"
          aria-label={t("历史消息操作")}
        >
          {onEditUserMessage && (
            <button
              type="button"
              aria-label={t("编辑历史消息")}
              disabled={userMessageActionsDisabled}
              onClick={onEditUserMessage}
            >
              {t("编辑")}
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="automation-user-message">
      <small className="automation-message-label">
        {t("通过自动化功能发送")}
      </small>
      {bubble}
    </div>
  );
}

function ToolActivity({ items }: { items: AnyRecord[] }) {
  const summary = summarizeToolActivity(items);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex == null ? null : items[selectedIndex] ?? null;
  const [expanded, setExpanded] = useState(summary.running);
  const parts = [
    summary.fileCount ? t("已更改 {count} 个文件", { count: summary.fileCount }) : "",
    summary.commandCount
      ? t(summary.running ? "正在运行 {count} 个命令" : "已运行 {count} 个命令", {
          count: summary.commandCount,
        })
      : "",
    summary.toolCount ? t("已调用 {count} 个工具", { count: summary.toolCount }) : "",
  ].filter(Boolean);
  return (
    <>
      <details
        className="tool-activity"
        open={summary.running || expanded}
        onToggle={(event) => {
          if (!summary.running) setExpanded(event.currentTarget.open);
        }}
      >
        <summary>
          <span className="activity-icon">‹/›</span>
          <span className="activity-summary-text">
            {parts.join(getActiveLocale() === "zh-CN" ? "，" : ", ") || t("工具活动")}
            {summary.additions > 0 && <em className="diff-add">+{summary.additions}</em>}
            {summary.deletions > 0 && <em className="diff-delete">-{summary.deletions}</em>}
          </span>
          <Chevron direction={summary.running || expanded ? "down" : "right"} />
        </summary>
        <div className="tool-activity-rows">
          {items.map((item, index) => (
            <button
              type="button"
              key={item.id ?? index}
              aria-label={toolActivityRowLabel(item)}
              onClick={() => setSelectedIndex(index)}
            >
              <span className={item.status === "inProgress" ? "row-running" : ""}>‹/›</span>
              <strong>{toolActivityRowLabel(item)}</strong>
              <Chevron />
            </button>
          ))}
        </div>
      </details>
      {selected?.type === "fileChange" && (
        <FileDiffSheet item={selected} onClose={() => setSelectedIndex(null)} />
      )}
      {selected && selected.type !== "fileChange" && (
        <ToolDetailSheet item={selected} onClose={() => setSelectedIndex(null)} />
      )}
    </>
  );
}

function TimelineItem({
  item,
  client,
  backend,
  threadId,
  timestamp,
  onEditUserMessage,
  userMessageActionsDisabled,
}: {
  item: AnyRecord;
  client: AppServerClient | null;
  backend?: BackendConfig | null;
  threadId?: string;
  timestamp?: number | null;
} & UserMessageActionProps) {
  const type = String(item.type ?? "");
  if (type === "imageGeneration" && item.status === "failed") {
    return <ImageGenerationFailure backend={backend} threadId={threadId} itemId={String(item.id ?? "")} />;
  }
  if (type === "contextCompaction") {
    return (
      <div
        className="context-compaction"
        role="separator"
        aria-label={t("上下文已压缩")}
      >
        <span aria-hidden="true">⟳</span>
        <strong>{t("上下文已压缩")}</strong>
      </div>
    );
  }
  const rawText = itemText(item);
  const text = type === "agentMessage"
    ? automationAgentMessageText(rawText)
    : rawText;
  if (!text && !type) return null;
  if (type === "userMessage") {
    return (
      <UserBubble
        item={item}
        client={client}
        backend={backend}
        timestamp={timestamp}
        onEditUserMessage={onEditUserMessage}
        userMessageActionsDisabled={userMessageActionsDisabled}
      />
    );
  }
  const displayText = type === "agentMessage"
    ? visibleAgentMessageText(item)
    : text;
  const generatedVideoPath = videoPathForItem(item);
  if (backend && generatedVideoPath) {
    return <RemoteVideo path={generatedVideoPath} backend={backend} />;
  }
  const images = imageSourcesForItem(item);
  if (images.length) return <ImageGallery images={images} client={client} backend={backend} />;
  if (/reasoning/i.test(type)) {
    return displayText ? <div className="reasoning">{displayText}</div> : null;
  }
  return displayText ? (
    <div className="assistant-message">
      <MarkdownMessage
        text={displayText}
        renderImage={(source, alt) => (
          <RemoteImage
            image={{
              source,
              name: source.split("/").at(-1) || alt,
              local: !/^(data:|https?:)/i.test(source),
            }}
            client={client}
            backend={backend}
            alt={alt}
          />
        )}
        renderLink={(href, children) => (
          <RemoteFileLink href={href} client={client} backend={backend}>
            {children}
          </RemoteFileLink>
        )}
      />
      <MessageTimestamp
        timestamp={timestamp}
        className="final-answer-timestamp"
      />
    </div>
  ) : null;
}

function StreamCharacterCount({
  count,
  startedAt,
}: {
  count: number;
  startedAt?: number | null;
}) {
  const [now, setNow] = useState(Date.now);
  const hasStartedAt =
    typeof startedAt === "number" && Number.isFinite(startedAt);

  useEffect(() => {
    if (!hasStartedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasStartedAt, startedAt]);

  const elapsedLabel = hasStartedAt
    ? formatTurnDuration(Math.max(0, now - startedAt * 1000))
    : null;
  return (
    <div
      className="stream-character-count"
      aria-label={`${t("已接收 {count} 字符", { count })}${
        elapsedLabel ? t("，已运行 {elapsed}", { elapsed: elapsedLabel }) : ""
      }`}
    >
      <i className="stream-character-spinner" aria-hidden="true" />
      <span>{t("{count} 字符", { count })}</span>
      {elapsedLabel && (
        <span className="stream-elapsed">· {elapsedLabel}</span>
      )}
    </div>
  );
}

function visibleAgentMessageText(item: AnyRecord) {
  return stripGitDirectives(
    automationAgentMessageText(itemText(item)),
  );
}

function formatTurnDuration(durationMs: number) {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return t("{hours}小时{minutes}", {
      hours,
      minutes: minutes > 0 ? t("{count}分", { count: minutes }) : "",
    }).trim();
  }
  if (minutes > 0) {
    return t("{minutes}分{seconds}", {
      minutes,
      seconds: seconds > 0 ? t("{count}秒", { count: seconds }) : "",
    }).trim();
  }
  return t("{seconds}秒", { seconds });
}

function valueCharacterCount(value: unknown) {
  if (value == null) return 0;
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(value);
  return Array.from(text ?? "").length;
}

export function receivedItemCharacterCount(item: AnyRecord) {
  if (
    item.type === "userMessage" ||
    item.type === "contextCompaction" ||
    item.type === "imageView" ||
    item.type === "imageGeneration"
  ) {
    return 0;
  }
  if (item.type === "agentMessage") {
    return Array.from(visibleAgentMessageText(item)).length;
  }
  if (/reasoning/i.test(String(item.type ?? ""))) {
    return valueCharacterCount(
      item.text ?? item.summary ?? item.content,
    );
  }
  if (item.type === "commandExecution") {
    return (
      valueCharacterCount(item.command) +
      valueCharacterCount(item.aggregatedOutput ?? item.output)
    );
  }
  if (item.type === "fileChange") {
    return valueCharacterCount(
      item.changes ?? item.result ?? item.error ?? item.contentItems,
    );
  }
  if (
    /tool/i.test(String(item.type ?? "")) ||
    item.tool != null
  ) {
    return (
      valueCharacterCount(item.tool) +
      valueCharacterCount(item.arguments) +
      valueCharacterCount(
        item.result ??
        item.error ??
        item.contentItems ??
        item.output,
      )
    );
  }
  return valueCharacterCount(itemText(item));
}

export function TurnCard({
  turn,
  threadId,
  client,
  backend,
  onEditUserMessage,
  inlineEdit,
  userMessageActionsDisabled,
}: {
  turn: AnyRecord;
  threadId?: string;
  liveDiff?: string;
  client: AppServerClient | null;
  backend?: BackendConfig | null;
} & UserMessageActionProps) {
  const grouped = groupTurnItems(turn);
  const responsesRef = useRef<HTMLDivElement>(null);
  let lastHumanIndex = -1;
  for (let index = grouped.responses.length - 1; index >= 0; index -= 1) {
    if (grouped.responses[index]?.type === "userMessage") {
      lastHumanIndex = index;
      break;
    }
  }
  const activeResponseItems = grouped.responses.slice(lastHumanIndex + 1);
  const streamingCharacterCount = activeResponseItems.reduce(
    (total: number, item: AnyRecord) =>
      total + receivedItemCharacterCount(item),
    0,
  );
  const renderEntries = (items: AnyRecord[]) =>
    groupTimelineEntries(items).map((entry, index) =>
      entry.kind === "activity" ? (
        <ToolActivity
          key={`activity-${entry.items[0]?.id ?? index}`}
          items={entry.items}
        />
      ) : (
        <TimelineItem
          key={entry.item.id ?? index}
          item={entry.item}
          client={client}
          backend={backend}
          threadId={threadId}
        />
      ),
    );
  const completedSegments = splitTurnResponseSegments(grouped.responses);
  const changeStats = turn.groupChangeStats ?? summarizeTurnChanges(turn);
  const changeStatsReady = hasTurnChangeStats(turn);
  const changedLines = changeStats.additions + changeStats.deletions;
  const durationMs = turnDurationMs(turn);
  const durationLabel =
    durationMs != null && durationMs > 60_000
      ? formatTurnDuration(durationMs)
      : null;
  let durationSegmentIndex = -1;
  if (durationLabel) {
    for (let index = completedSegments.length - 1; index >= 0; index -= 1) {
      if (
        splitCompletedTurnResponses(completedSegments[index]).previousCount > 0
      ) {
        durationSegmentIndex = index;
        break;
      }
    }
  }
  let copySegmentIndex = -1;
  let finalSegmentIndex = -1;
  for (let index = completedSegments.length - 1; index >= 0; index -= 1) {
    const segment = completedSegments[index];
    if (
      copySegmentIndex < 0 &&
      segment?.some((item) => item.type === "agentMessage")
    ) copySegmentIndex = index;
    if (finalSegmentIndex < 0 && splitCompletedTurnResponses(segment).final) {
      finalSegmentIndex = index;
    }
    if (copySegmentIndex >= 0 && finalSegmentIndex >= 0) break;
  }
  return (
    <section className="turn-card">
      {grouped.user && (
        <div className="turn-user">
          <UserBubble
            item={grouped.user}
            client={client}
            backend={backend}
            timestamp={turn.startedAt}
            onEditUserMessage={
              grouped.running ? undefined : onEditUserMessage
            }
            inlineEdit={grouped.running ? undefined : inlineEdit}
            userMessageActionsDisabled={userMessageActionsDisabled}
          />
        </div>
      )}
      <div className="turn-responses" ref={responsesRef}>
        {grouped.running ? (
          <>
            {renderEntries(grouped.responses)}
            <StreamCharacterCount
              count={streamingCharacterCount}
              startedAt={turn.startedAt}
            />
          </>
        ) : (
          completedSegments.map((items, index) => (
            <CompletedResponseSegment
              key={items[0]?.id ?? index}
              items={items}
              client={client}
              backend={backend}
              threadId={threadId}
              copyTarget={responsesRef}
              showCopy={index === copySegmentIndex}
              completedAt={
                index === finalSegmentIndex ? turn.completedAt : null
              }
              durationLabel={
                index === durationSegmentIndex ? durationLabel : null
              }
            />
          ))
        )}
      </div>
      {!grouped.running && (changeStatsReady || turn.changeStatsUnavailable) && (
        <div className="turn-change-summary">
          <span className="activity-icon" aria-hidden="true">‹/›</span>
          <span className="activity-summary-text">
            {changeStatsReady
              ? t("本次代码改动 {count} 行", { count: changedLines })
              : t("代码改动统计不可用")}
            {changeStatsReady && changedLines > 0 && (
              <>
                <em className="diff-add">+{changeStats.additions}</em>
                <em className="diff-delete">-{changeStats.deletions}</em>
              </>
            )}
          </span>
        </div>
      )}
    </section>
  );
}

function CompletedResponseSegment({
  items,
  client,
  backend,
  threadId,
  copyTarget,
  showCopy,
  completedAt,
  durationLabel,
}: {
  items: AnyRecord[];
  client: AppServerClient | null;
  backend?: BackendConfig | null;
  threadId?: string;
  copyTarget: RefObject<HTMLDivElement | null>;
  showCopy: boolean;
  completedAt?: number | null;
  durationLabel: string | null;
}) {
  const completed = splitCompletedTurnResponses(items);
  const processImages = completed.previous.filter(item => item.type === "imageView");
  const foldImages = processImages.length > 1;
  const [showProcessImages, setShowProcessImages] = useState(false);
  const [showPrevious, setShowPrevious] = useState(() =>
    completed.previous.some((item) => item.type === "imageGeneration" && item.status === "failed"),
  );
  const guidingMessages = completed.beforeFinal.filter(
    (item) => item.type === "userMessage",
  );
  const processBeforeFinal = completed.beforeFinal.filter(
    (item) => item.type !== "userMessage" && !(foldImages && item.type === "imageView"),
  );
  const renderEntries = (entries: AnyRecord[]) =>
    groupTimelineEntries(entries).map((entry, index) =>
      entry.kind === "activity" ? (
        <ToolActivity
          key={`activity-${entry.items[0]?.id ?? index}`}
          items={entry.items}
        />
      ) : (
        <TimelineItem
          key={entry.item.id ?? index}
          item={entry.item}
          client={client}
          backend={backend}
          threadId={threadId}
        />
      ),
    );
  const renderUnfoldedEntries = (entries: AnyRecord[]) =>
    renderEntries(
      entries.filter(
        (item) =>
          item.type === "userMessage" ||
          item.type === "imageView" ||
          (item.type === "imageGeneration" && item.status !== "failed") ||
          Boolean(videoPathForItem(item)) ||
          (
            completed.previousCount === 0 &&
            item.type === "contextCompaction"
          ),
      ),
    );
  return (
    <>
      {renderEntries(guidingMessages)}
      {completed.previousCount > 0 && (
        <>
          <button
            type="button"
            className="previous-messages-toggle"
            aria-expanded={showPrevious}
            aria-label={`${t("之前的 {count} 条消息", { count: completed.previousCount })}${
              durationLabel ? ` · ${durationLabel}` : ""
            }`}
            onClick={() => setShowPrevious((current) => !current)}
          >
            {t("之前的 {count} 条消息", { count: completed.previousCount })}
            {durationLabel && (
              <span className="turn-duration">· {durationLabel}</span>
            )}
            <Chevron direction={showPrevious ? "down" : "right"} />
          </button>
          {showPrevious && (
            <div className="previous-messages">
              {renderEntries(processBeforeFinal)}
            </div>
          )}
        </>
      )}
      {!showPrevious && renderUnfoldedEntries(processBeforeFinal)}
      {foldImages && <>
        <button type="button" className="previous-messages-toggle process-images-toggle"
          aria-expanded={showProcessImages}
          onClick={() => setShowProcessImages(current => !current)}>
          {t("过程截图（{count}）", { count: processImages.length })}
          <Chevron direction={showProcessImages ? "down" : "right"} />
        </button>
        {showProcessImages && <div className="process-images">{renderEntries(processImages)}</div>}
      </>}
      {completed.final && (
        <>
          <TimelineItem
            item={completed.final}
            client={client}
            backend={backend}
            timestamp={completedAt}
          />
          {showCopy && (
            <CopyButton
              text={() => visibleAssistantText(copyTarget.current)}
              label={t("复制本回合 AI 消息")}
              className="turn-message-copy"
            />
          )}
        </>
      )}
      {showPrevious ? (
        completed.afterFinal.length > 0 && (
          <div className="previous-messages after-final">
            {renderEntries(completed.afterFinal.filter(item => !(foldImages && item.type === "imageView")))}
          </div>
        )
      ) : (
        renderUnfoldedEntries(completed.afterFinal.filter(item => !(foldImages && item.type === "imageView")))
      )}
    </>
  );
}
