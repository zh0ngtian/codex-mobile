import { decodeUserMessage, type MessageReference } from '../../server/user-message-format';
import { responseAnnotationDisplay } from '../features/conversation/response-annotations';
import { messageItemText as nativeItemText } from '../features/conversation/message-text';
export { messageItemText as nativeItemText } from '../features/conversation/message-text';
import { quoteSource } from '../features/conversation/message-quotes';
import { videoPathForItem } from '../features/conversation/sheets/RemoteFileSheets';
import { groupConversationTurns, groupTurnItems, imageSourcesForItem, isThreadRunning, turnDurationMs, toolActivityRowLabel } from '../ui/conversation';
import { turnResponsePresentation } from '../ui/turn-response-presentation';
import { groupThreadsByProject, splitAllThreads, type AggregatedThreadItem } from '../features/threads/thread-list-model';
import { isProjectCollapsed, projectCollapseKey } from '../features/threads/project-collapse';
import { PROJECTLESS_GROUP_ID, type ProjectThreadLoadState } from '../app-server/thread-list-loader';
import { titleOf } from '../ui/app-display';
import { insertSkillMention, skillMentionAt, type InstalledSkill } from '../app-server/skills';
import { insertPluginMention, type InstalledPlugin } from '../app-server/plugins';
import { t } from '../i18n';
import { formatMessageTimestamp } from '../ui/message-timestamp';
import { orderedTurnMedia, commentaryMediaEntries } from '../ui/timeline-media';
import type { NativeCommand, NativeCommentaryEntry, NativeGroup, NativeMessage, NativePanelItem } from './protocol';

type RecordValue = Record<string, any>;
export function nativeCommand(name: string, params: Record<string, unknown> = {}): NativeCommand {
  return { id: `${name}:${JSON.stringify(params)}`, name, params };
}
export function nativeAction(id: string, title: string, name: string, params: Record<string, unknown> = {}): NativePanelItem {
  return { id, kind: 'action', title, command: nativeCommand(name, params) };
}
/** final 与其他正文立即投影；commentary 折叠计数独立于工具和推理。 */
export function projectConversation(active: RecordValue | null, imageURL: (path: string) => string, originalImageURL?: (path: string) => string, mediaURL?: (path: string) => string, backendId?: string, fileURL?: (path: string) => string): NativeMessage[] {
  const messages: NativeMessage[] = [];
  const scrollAnchor = (item: RecordValue | undefined, role: string): string | undefined =>
    typeof item?.id === 'string' && item.id ? `${item.id}:${role}` : undefined;
  const imageBlocks = (item: RecordValue, prefix: string): NativePanelItem[] => imageSourcesForItem(item).map((image, index) => ({
    id: `${prefix}:image:${index}`, kind: 'image', title: image.name, value: image.local ? imageURL(image.source) : image.source,
    ...(image.local && originalImageURL ? { previewURL: originalImageURL(image.source) } : {}),
  }));
  const physicalSources = new Map<object, ReturnType<typeof quoteSource>>();
  for (const turn of active?.turns ?? []) for (const item of turn.items ?? []) {
    if (['userMessage', 'agentMessage'].includes(item.type) && backendId && active?.id && turn.id && item.id) physicalSources.set(item, quoteSource(backendId, String(active.id), String(turn.id), item));
  }
  const sourceFor = (item: RecordValue) => physicalSources.get(item);
  const turns = groupConversationTurns(active?.turns ?? []);
  for (const turn of turns) {
    const turnId = String(turn.id);
    const duration = turnDurationMs(turn);
    const hours = duration == null ? 0 : Math.floor(duration / 3_600_000);
    const minutes = duration == null ? 0 : Math.floor(duration / 60_000) % 60;
    const seconds = duration == null ? 0 : Math.floor(duration / 1000) % 60;
    const status = duration == null ? undefined : `${hours ? `${hours}${t('小时')}` : ''}${minutes ? `${minutes}${t('分钟')}` : ''}${seconds}${t('秒')}`;
    const running = ['inProgress', 'in_progress', 'running'].includes(String(turn.status));
    const orderedItems = orderedTurnMedia(turn.items ?? []);
    const liveCommentaryIDs = new Set<string>();
    if (running && turn === turns.at(-1)) {
      for (const { item } of commentaryMediaEntries(orderedItems).reverse()) {
        if (item.type !== 'agentMessage' || item.phase !== 'commentary') break;
        liveCommentaryIDs.add(String(item.id));
      }
    }
    const mediaBlocks = (item: RecordValue): NativePanelItem[] => {
      const video = videoPathForItem(item);
      return video ? [{ id: `${turnId}:${item.id}:video`, kind: 'video', title: video.split('/').at(-1), value: mediaURL ? mediaURL(video) : imageURL(video) }]
        : imageBlocks(item, `${turnId}:${item.id}`);
    };
    // 先按 wire 顺序绑定媒体，再使用两端共享的引导和旧回答呈现契约。
    const grouped = groupTurnItems(turn);
    let responseReferences: MessageReference[] = [];
    const presentation = turnResponsePresentation(grouped.responses, { running, collapseWithoutFinal: true });
    const entries = [...(grouped.user ? [{ item: grouped.user, media: [], history: false, supersededAnswer: false }] : []), ...presentation.entries];
    {
      const segment = orderedItems;
      const segmentID = `${turnId}:${segment[0]?.id ?? 'activity'}`;
      const tools: NativePanelItem[] = [];
      let history: NativePanelItem[] = [];
      let commentary: NativeCommentaryEntry[] = [];
      let historyCount = 0;
      let historyID = '';
      let historyAnchor: string | undefined;
      let historyAnchors: string[] = [];
      let historyInterrupted = false;
      const flushHistory = (nextIsFinal = false) => {
        if (!historyCount) return;
        const commentaryBlockId = `${historyID}:commentary`;
        messages.push({ id: `${historyID}:history`, role: 'activity', text: '', scrollAnchorId: historyAnchor, scrollAnchorIds: [...new Set(historyAnchors)], commentary, commentaryBlockId, commentaryCanAttachToReply: nextIsFinal && !historyInterrupted, commentaryIsRunning: running,
          blocks: [{ id: commentaryBlockId, kind: 'disclosure', title: `${t('历史过程')} (${historyCount})`, children: history }] });
        history = []; commentary = []; historyAnchors = []; historyCount = 0; historyInterrupted = false;
      };
      for (const entry of entries) {
        const item = entry.item;
        const id = `${turnId}:${item.id}`;
        if (item.type === 'agentMessage' && item.phase === 'commentary' && entry.history) {
          if (!historyCount) { historyID = id; historyAnchor = scrollAnchor(item, 'history'); }
          const anchor = scrollAnchor(item, 'history');
          if (anchor) historyAnchors.push(anchor);
          const timestamp = formatMessageTimestamp(item.timestamp);
          const text = nativeItemText(item);
          const blocks = entry.media.flatMap(mediaBlocks);
          commentary.push({ id, text, blocks, quoteSource: sourceFor(item),
            ...(typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) && item.timestamp > 0 ? { timestamp: item.timestamp } : {}) });
          history.push({ id, kind: 'markdown', text });
          history.push(...blocks);
          if (timestamp) history.push({ id: `${id}:timestamp`, kind: 'text', text: timestamp });
          historyCount += 1;
          continue;
        }
        const isFinal = item.type === 'agentMessage' && item.phase !== 'commentary';
        // 工具、推理与计划在原生消息区隐藏，不拆分过程和用时；可见内容仍保留原位置。
        const visibleSeparator = ['userMessage', 'imageView', 'imageGeneration', 'videoGeneration', 'contextCompaction'].includes(item.type);
        if (historyCount && visibleSeparator) historyInterrupted = true;
        // 独立媒体、final 和用户插话在原始位置结束当前历史区。
        if (item.type === 'userMessage' || item.type === 'agentMessage' || ['imageView', 'imageGeneration', 'videoGeneration'].includes(item.type)) flushHistory(isFinal);
        if (item.type === 'userMessage') {
          const sentAt = [item.timestamp, turn.startedAt].find(value => typeof value === 'number' && Number.isFinite(value) && value > 0);
          const rawText = nativeItemText(item);
          const parsed = decodeUserMessage(rawText);
          responseReferences = parsed.references;
          const images = imageSourcesForItem(item);
          const blocks = imageBlocks(item, id).map((block, index) => ({ ...block, title: parsed.attachments.find(file => file.path === images[index]?.source)?.name ?? block.title }));
          for (const [index, file] of parsed.attachments.entries()) {
            if (images.some(image => image.source === file.path)) continue;
            if (file.isImage) blocks.push({ id: `${id}:file:${index}`, kind: 'image', title: file.name, value: imageURL(file.path), ...(originalImageURL ? { previewURL: originalImageURL(file.path) } : {}) });
            else blocks.push({ id: `${id}:file:${index}`, kind: 'file', title: file.name, value: fileURL ? fileURL(file.path) : mediaURL ? mediaURL(file.path) : file.path });
          }
          messages.push({ id, quoteSource: sourceFor(item), role: 'user', text: parsed.body, rawText, references: parsed.references, scrollAnchorId: scrollAnchor(item, 'user'), blocks, turnId, itemId: String(item.id),
            ...(sentAt == null ? {} : { timestamp: sentAt }),
            actions: [nativeAction(`${id}:copy`, t('复制'), 'message.copy', { id }), nativeAction(`${id}:edit`, t('编辑'), 'message.edit', { turnId, messageId: String(item.id) })] });
        } else if (item.type === 'agentMessage') {
          const commentary = item.phase === 'commentary';
          const timestamp = commentary ? formatMessageTimestamp(item.timestamp) : '';
          const blocks = entry.media.flatMap(mediaBlocks);
          if (timestamp) blocks.push({ id: `${id}:timestamp`, kind: 'text', text: timestamp });
          const finalStatus = !commentary && !entry.supersededAnswer && (!running || item === presentation.final) ? status : undefined;
          messages.push({ id, quoteSource: sourceFor(item), role: 'assistant', rawText: nativeItemText(item), references: responseReferences, text: responseAnnotationDisplay(nativeItemText(item), responseReferences, t('引用')), scrollAnchorId: scrollAnchor(item, 'assistant'), status: finalStatus, turnId, itemId: String(item.id), phase: typeof item.phase === 'string' ? item.phase : undefined,
            ...(!commentary ? { commentaryIsRunning: running } : {}),
            ...(entry.supersededAnswer ? { commentaryCanAttachToReply: true, commentary: [{ id, quoteSource: sourceFor(item), text: nativeItemText(item), blocks: [...blocks], isPreviousReply: true,
              ...(typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) && item.timestamp > 0 ? { timestamp: item.timestamp } : {}) }] } : {}),
            ...(commentary ? { commentaryIsLiveTail: liveCommentaryIDs.has(String(item.id)) } : {}),
            ...(commentary && typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) && item.timestamp > 0 ? { timestamp: item.timestamp } : {}),
            ...(entry.supersededAnswer && typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) && item.timestamp > 0 ? { timestamp: item.timestamp } : {}),
            ...(!commentary && !entry.supersededAnswer && !running && typeof turn.completedAt === 'number' && Number.isFinite(turn.completedAt) && turn.completedAt > 0 ? { timestamp: turn.completedAt } : {}),
            ...(blocks.length ? { blocks } : {}),
            actions: [nativeAction(`${id}:copy`, t('复制'), 'message.copy', { id })] });
        } else if ((item.type === 'imageGeneration' || item.type === 'videoGeneration') && item.status === 'failed') {
          messages.push({ id, role: 'activity', text: '', scrollAnchorId: scrollAnchor(item, 'activity'), blocks: [nativeAction(`${id}:failure`, t(item.type === 'videoGeneration' ? '视频生成未完成' : '图像生成未完成'), 'panel.open', { id: `tool:${turnId}:${item.id}` })] });
        } else if (item.type === 'videoGeneration' && !videoPathForItem(item)) {
          messages.push({ id, role: 'activity', text: '', scrollAnchorId: scrollAnchor(item, 'activity'), blocks: [nativeAction(`${id}:video`, t(['inProgress', 'in_progress', 'running'].includes(String(item.status)) ? '正在生成视频' : '视频生成未提供可播放文件'), 'panel.open', { id: `tool:${turnId}:${item.id}` })] });
        } else if (mediaBlocks(item).length) {
          messages.push({ id, role: 'activity', text: '', scrollAnchorId: scrollAnchor(item, 'activity'), blocks: mediaBlocks(item) });
        } else if (item.type === 'contextCompaction') {
          messages.push({ id, role: 'activity', text: t('上下文已压缩'), scrollAnchorId: scrollAnchor(item, 'activity') });
        } else if (item.type === 'reasoning') {
          const reasoning = item.text ?? (Array.isArray(item.summary) ? item.summary.map((p: any) => typeof p === 'string' ? p : p.text ?? '').join('\n') : item.summary) ?? (Array.isArray(item.content) ? item.content.map((p: any) => p.text ?? '').join('\n') : item.content) ?? '';
          if (reasoning) messages.push({ id, role: 'activity', activityKind: 'reasoning', text: '', scrollAnchorId: scrollAnchor(item, 'activity'), blocks: [{ id: `${id}:reasoning`, kind: 'disclosure', title: t('思考过程'), children: [{ id: `${id}:text`, kind: 'markdown', text: String(reasoning) }] }] });
        } else {
          tools.push(nativeAction(`${id}:tool`, toolActivityRowLabel(item), 'panel.open', { id: `tool:${turnId}:${item.id}` }));
        }
      }
      flushHistory();
      if (tools.length) {
        const aliases = segment.flatMap(item => { const anchor = scrollAnchor(item, 'tools'); return anchor ? [anchor] : []; });
        messages.push({ id: `${segmentID}:tools`, role: 'activity', activityKind: 'tool', text: '', scrollAnchorId: scrollAnchor(segment[0], 'tools'), scrollAnchorIds: [...new Set(aliases)], blocks: [{ id: `${segmentID}:tools`, kind: 'disclosure', title: `${t('工具')} (${tools.length})`, children: tools }] });
      }
    }
  }
  return messages;
}

interface NavigationInput {
  threads: AggregatedThreadItem[]; listBackendId: string; selectedBackendId: string; activeThreadId?: string;
  projectDirectories: string[]; hasProjectlessThreads: boolean; collapsedProjectKeys: Set<string>;
  projectThreadStates: Record<string, ProjectThreadLoadState>; projectHasMore: Record<string, boolean>; loadingProjectKeys: Set<string>;
  filter?: string; query?: string; searching?: boolean; error?: string;
  backends?: Array<{ id: string; name: string }>;
  backendSnapshots?: Record<string, { projects: string[]; projectlessThreadIds: string[]; projectThreadStates: Record<string, ProjectThreadLoadState>; projectHasMore: Record<string, boolean> }>;
}
export function projectNavigationLoading(input: {
  loading: boolean; hasContent: boolean; backendIds: readonly string[];
  backendSnapshots: Record<string, { threadListState: 'loading' | 'ready' | 'error' } | undefined>;
}): boolean {
  if (input.loading) return true;
  if (input.hasContent) return false;
  // 任一设备成功空不能确认整个范围为空；未提供首查快照的设备也仍在等待。
  return input.backendIds.some(id => {
    const state = input.backendSnapshots[id]?.threadListState;
    return state === undefined || state === 'loading';
  });
}
export function projectNavigation(input: NavigationInput): NativeGroup[] {
  const row = (item: AggregatedThreadItem) => {
    const params = { backendId: item.backendId, threadId: item.threadId };
    return { id: `${item.backendId}:${item.threadId}`, title: titleOf(item.thread), subtitle: input.listBackendId === 'all' ? `${item.backendName} · ${item.projectName}` : item.projectName,
      backendId: item.backendId, threadId: item.threadId, cwd: item.thread.isProjectless === true || item.thread.cwd === PROJECTLESS_GROUP_ID ? '' : String(item.thread.cwd ?? ''),
      isPinned: item.pinned, isUnread: item.unread, running: isThreadRunning(item.thread.status), timestamp: item.timestamp,
      badge: isThreadRunning(item.thread.status) ? t('运行中') : item.unread ? t('未读') : undefined,
      selected: input.selectedBackendId === item.backendId && input.activeThreadId === item.threadId,
      command: nativeCommand('thread.open', params),
      actions: [
        ['pin', item.pinned ? t('取消置顶') : t('置顶')], ['refresh', t('刷新')], ['duplicate', t('复制会话')], ['rename', t('重命名')], ['archive', t('归档')],
      ].map(([action, title]) => nativeAction(`${item.backendId}:${item.threadId}:${action}`, title, 'thread.manage', { ...params, action })),
    };
  };
  if (input.query?.trim()) return [{ id: 'search', category: 'search', title: input.searching ? t('搜索中…') : t('搜索结果'), loading: input.searching ? 'loading' : undefined, items: input.threads.map(row),
    ...(input.error ? { subtitle: input.error, actions: [nativeAction('search-retry', t('重试'), 'navigation.refresh')] } : {}) }];
  const split = splitAllThreads(input.threads);
  const groups: NativeGroup[] = [{ id: 'favorites', category: 'pinned', title: t('置顶'), items: split.pinned.map(row) }];
  const failure: NativeGroup | undefined = input.error ? { id: 'list-error', title: input.error, items: [{ id: 'retry', title: t('重试'), command: nativeCommand('navigation.refresh') }] } : undefined;
  if (input.filter === 'favorites') return failure ? [...groups, failure] : groups;
  const appendProjects = (backendId: string, threads: AggregatedThreadItem[], directories: string[], hasProjectless: boolean,
    states: Record<string, ProjectThreadLoadState>, hasMore: Record<string, boolean>, backendName?: string) => {
    for (const group of groupThreadsByProject(threads, [...(hasProjectless ? [PROJECTLESS_GROUP_ID] : []), ...directories])) {
      const key = projectCollapseKey(backendId, group.cwd);
      const collapsed = isProjectCollapsed(input.collapsedProjectKeys, backendId, group.cwd);
      const params = { backendId, cwd: group.cwd };
      // 项目目录先于首批会话返回；未知/idle空组尚未获得成功空结果。
      const state = states[group.cwd];
      const knownProject = directories.includes(group.cwd) || (hasProjectless && group.cwd === PROJECTLESS_GROUP_ID);
      const loading = !state || state === 'idle' ? (knownProject || !group.threads.length ? 'loading' : 'ready') : state;
      const actions: NativePanelItem[] = [];
      if (!collapsed && states[group.cwd] === 'error') actions.push(nativeAction(`${key}:retry`, t('重试'), 'project.retry', params));
      if (!collapsed && hasMore[group.cwd]) actions.push({ ...nativeAction(`${key}:more`, input.loadingProjectKeys.has(key) ? t('加载中…') : t('加载更多'), 'project.more', params), disabled: input.loadingProjectKeys.has(key) });
      const allItems = group.threads.map(row);
      groups.push({ id: key, category: 'project', title: group.projectName, subtitle: backendName, backendId, cwd: group.cwd === PROJECTLESS_GROUP_ID ? '' : group.cwd,
        hasMore: !!hasMore[group.cwd], allItems, collapsed, loading: collapsed ? undefined : loading,
        command: nativeCommand('project.toggle', params), newCommand: nativeCommand('thread.new', { backendId, cwd: group.cwd === PROJECTLESS_GROUP_ID ? '' : group.cwd }),
        actions, items: collapsed ? [] : allItems });
    }
  };
  if (input.listBackendId === 'all') {
    for (const backend of input.backends ?? []) {
      const state = input.backendSnapshots?.[backend.id];
      appendProjects(backend.id, input.threads.filter(item => item.backendId === backend.id), state?.projects ?? [], !!state?.projectlessThreadIds.length, state?.projectThreadStates ?? {}, state?.projectHasMore ?? {}, backend.name);
    }
  } else appendProjects(input.listBackendId, input.threads, input.projectDirectories, input.hasProjectlessThreads, input.projectThreadStates, input.projectHasMore);
  if (input.filter !== 'projects') groups.push({ id: 'recent', category: 'recent', title: t('最近会话'), items: split.recent.map(row) });
  if (failure) groups.push(failure);
  return groups;
}
export type NativeMention = { kind: 'skill'; skill: InstalledSkill } | { kind: 'plugin'; plugin: InstalledPlugin };
export function insertNativeMentionAt(text: string, entry: NativeMention, caretOffset = text.length): { text: string; cursor: number } {
  const caret = Math.max(0, Math.min(text.length, caretOffset));
  let source = text;
  let mention = skillMentionAt(source, caret);
  if (!mention) {
    const prefix = source.slice(0, caret);
    const marker = (prefix && !/\s$/.test(prefix) ? ' ' : '') + '@';
    source = prefix + marker + source.slice(caret);
    mention = skillMentionAt(source, caret + marker.length)!;
  }
  return entry.kind === 'skill' ? insertSkillMention(source, mention, entry.skill) : insertPluginMention(source, mention, entry.plugin);
}
export function insertNativeMention(text: string, entry: NativeMention): string { return insertNativeMentionAt(text, entry).text; }
