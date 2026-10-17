import { videoPathForItem } from '../features/conversation/sheets/RemoteFileSheets';
import { groupConversationTurns, splitTurnResponseSegments, imageSourcesForItem, isThreadRunning, turnDurationMs, stripGitDirectives, automationAgentMessageText, summarizeTurnChanges, toolActivityRowLabel } from '../ui/conversation';
import { extractGeneratedTitle, stripConversationTitleRequest } from '../app-server/conversation-title';
import { groupThreadsByProject, splitAllThreads, type AggregatedThreadItem } from '../features/threads/thread-list-model';
import { projectCollapseKey } from '../features/threads/project-collapse';
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
export function nativeItemText(item: RecordValue): string {
  let text = Array.isArray(item.content) ? item.content.map((part: RecordValue) => String(part.text ?? '')).join('')
    : String(item.aggregatedOutput ?? item.text ?? (typeof item.content === 'string' ? item.content : '') ?? '');
  if (item.type === 'userMessage') text = stripConversationTitleRequest(text);
  if (item.type === 'agentMessage') text = stripGitDirectives(automationAgentMessageText(extractGeneratedTitle(text).text));
  return text;
}
/** final 与其他正文立即投影；commentary 折叠计数独立于工具和推理。 */
export function projectConversation(active: RecordValue | null, imageURL: (path: string) => string, originalImageURL?: (path: string) => string, mediaURL?: (path: string) => string): NativeMessage[] {
  const messages: NativeMessage[] = [];
  const scrollAnchor = (item: RecordValue | undefined, role: string): string | undefined =>
    typeof item?.id === 'string' && item.id ? `${item.id}:${role}` : undefined;
  const imageBlocks = (item: RecordValue, prefix: string): NativePanelItem[] => imageSourcesForItem(item).map((image, index) => ({
    id: `${prefix}:image:${index}`, kind: 'image', title: image.name, value: image.local ? imageURL(image.source) : image.source,
    ...(image.local && originalImageURL ? { previewURL: originalImageURL(image.source) } : {}),
  }));
  const turns = groupConversationTurns(active?.turns ?? []);
  for (const turn of turns) {
    const turnId = String(turn.id);
    const duration = turnDurationMs(turn);
    const status = duration == null ? undefined : `${t('用时')} ${Math.floor(duration / 1000)} ${t('秒')}`;
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
    // Web 与原生共用顺序和去重规则，截图跟随所属 commentary。
    for (const segment of splitTurnResponseSegments(orderedItems)) {
      const segmentID = `${turnId}:${segment[0]?.id ?? 'activity'}`;
      const hasFinal = segment.some(item => item.type === 'agentMessage' && item.phase !== 'commentary');
      const collapse = hasFinal || !running;
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
        messages.push({ id: `${historyID}:history`, role: 'activity', text: '', scrollAnchorId: historyAnchor, scrollAnchorIds: [...new Set(historyAnchors)], commentary, commentaryBlockId, commentaryCanAttachToReply: nextIsFinal && !historyInterrupted,
          blocks: [{ id: commentaryBlockId, kind: 'disclosure', title: `${t('历史过程')} (${historyCount})`, children: history }] });
        history = []; commentary = []; historyAnchors = []; historyCount = 0; historyInterrupted = false;
      };
      for (const entry of commentaryMediaEntries(segment)) {
        const item = entry.item;
        const id = `${turnId}:${item.id}`;
        if (item.type === 'agentMessage' && item.phase === 'commentary' && collapse) {
          if (!historyCount) { historyID = id; historyAnchor = scrollAnchor(item, 'history'); }
          const anchor = scrollAnchor(item, 'history');
          if (anchor) historyAnchors.push(anchor);
          const timestamp = formatMessageTimestamp(item.timestamp);
          const text = nativeItemText(item);
          const blocks = entry.media.flatMap(mediaBlocks);
          commentary.push({ id, text, blocks,
            ...(typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) && item.timestamp > 0 ? { timestamp: item.timestamp } : {}) });
          history.push({ id, kind: 'markdown', text });
          history.push(...blocks);
          if (timestamp) history.push({ id: `${id}:timestamp`, kind: 'text', text: timestamp });
          historyCount += 1;
          continue;
        }
        const isFinal = item.type === 'agentMessage' && item.phase !== 'commentary';
        // 工具与推理沿用既有投影顺序，但不能让缓冲后的历史被误判为紧邻final。
        if (historyCount && !isFinal) historyInterrupted = true;
        // 独立媒体、final 和用户插话在原始位置结束当前历史区。
        if (item.type === 'userMessage' || item.type === 'agentMessage' || ['imageView', 'imageGeneration', 'videoGeneration'].includes(item.type)) flushHistory(isFinal);
        if (item.type === 'userMessage') {
          messages.push({ id, role: 'user', text: nativeItemText(item), scrollAnchorId: scrollAnchor(item, 'user'), blocks: imageBlocks(item, id), turnId, itemId: String(item.id),
            ...(typeof turn.startedAt === 'number' && Number.isFinite(turn.startedAt) && turn.startedAt > 0 ? { timestamp: turn.startedAt } : {}),
            actions: [nativeAction(`${id}:copy`, t('复制'), 'message.copy', { id }), nativeAction(`${id}:edit`, t('编辑'), 'message.edit', { turnId, messageId: String(item.id) })] });
        } else if (item.type === 'agentMessage') {
          const commentary = item.phase === 'commentary';
          const timestamp = commentary ? formatMessageTimestamp(item.timestamp) : '';
          const blocks = entry.media.flatMap(mediaBlocks);
          if (timestamp) blocks.push({ id: `${id}:timestamp`, kind: 'text', text: timestamp });
          messages.push({ id, role: 'assistant', text: nativeItemText(item), scrollAnchorId: scrollAnchor(item, 'assistant'), status: commentary ? undefined : status, turnId, itemId: String(item.id), phase: typeof item.phase === 'string' ? item.phase : undefined,
            ...(commentary ? { commentaryIsLiveTail: liveCommentaryIDs.has(String(item.id)) } : {}),
            ...(commentary && typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) && item.timestamp > 0 ? { timestamp: item.timestamp } : {}),
            ...(!commentary && !running && typeof turn.completedAt === 'number' && Number.isFinite(turn.completedAt) && turn.completedAt > 0 ? { timestamp: turn.completedAt } : {}),
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
          if (reasoning) messages.push({ id, role: 'activity', text: '', scrollAnchorId: scrollAnchor(item, 'activity'), blocks: [{ id: `${id}:reasoning`, kind: 'disclosure', title: t('思考过程'), children: [{ id: `${id}:text`, kind: 'markdown', text: String(reasoning) }] }] });
        } else {
          tools.push(nativeAction(`${id}:tool`, toolActivityRowLabel(item), 'panel.open', { id: `tool:${turnId}:${item.id}` }));
        }
      }
      flushHistory();
      if (tools.length) {
        const aliases = segment.flatMap(item => { const anchor = scrollAnchor(item, 'tools'); return anchor ? [anchor] : []; });
        messages.push({ id: `${segmentID}:tools`, role: 'activity', text: '', scrollAnchorId: scrollAnchor(segment[0], 'tools'), scrollAnchorIds: [...new Set(aliases)], blocks: [{ id: `${segmentID}:tools`, kind: 'disclosure', title: `${t('工具')} (${tools.length})`, children: tools }] });
      }
    }
    const changeBlocks: NativePanelItem[] = [];
    const changes = summarizeTurnChanges(turn);
    if (turn.liveDiff || changes.additions || changes.deletions) changeBlocks.push(nativeAction(`${turnId}:changes`, t('文件变更'), 'panel.open', { id: `changes:${turnId}` }));
    if (changeBlocks.length) messages.push({ id: `${turnId}:changes`, role: 'activity', text: '', blocks: changeBlocks });
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
        ['pin', item.pinned ? t('取消关注') : t('关注')], ['refresh', t('刷新')], ['duplicate', t('复制会话')], ['rename', t('重命名')], ['archive', t('归档')],
      ].map(([action, title]) => nativeAction(`${item.backendId}:${item.threadId}:${action}`, title, 'thread.manage', { ...params, action })),
    };
  };
  if (input.query?.trim()) return [{ id: 'search', category: 'search', title: input.searching ? t('搜索中…') : t('搜索结果'), loading: input.searching ? 'loading' : undefined, items: input.threads.map(row),
    ...(input.error ? { subtitle: input.error, actions: [nativeAction('search-retry', t('重试'), 'navigation.refresh')] } : {}) }];
  const split = splitAllThreads(input.threads);
  const groups: NativeGroup[] = [{ id: 'favorites', category: 'pinned', title: t('关注'), items: split.pinned.map(row) }];
  if (input.filter === 'favorites') return groups;
  const appendProjects = (backendId: string, threads: AggregatedThreadItem[], directories: string[], hasProjectless: boolean,
    states: Record<string, ProjectThreadLoadState>, hasMore: Record<string, boolean>, backendName?: string) => {
    for (const group of groupThreadsByProject(threads, [...(hasProjectless ? [PROJECTLESS_GROUP_ID] : []), ...directories])) {
      const key = projectCollapseKey(backendId, group.cwd);
      const collapsed = input.collapsedProjectKeys.has(key);
      const params = { backendId, cwd: group.cwd };
      const actions: NativePanelItem[] = [];
      if (!collapsed && states[group.cwd] === 'error') actions.push(nativeAction(`${key}:retry`, t('重试'), 'project.retry', params));
      if (!collapsed && hasMore[group.cwd]) actions.push({ ...nativeAction(`${key}:more`, input.loadingProjectKeys.has(key) ? t('加载中…') : t('加载更多'), 'project.more', params), disabled: input.loadingProjectKeys.has(key) });
      const allItems = group.threads.map(row);
      groups.push({ id: key, category: 'project', title: group.projectName, subtitle: backendName, backendId, cwd: group.cwd === PROJECTLESS_GROUP_ID ? '' : group.cwd,
        hasMore: !!hasMore[group.cwd], allItems, collapsed, loading: collapsed ? undefined : states[group.cwd],
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
  if (input.error) groups.push({ id: 'list-error', title: input.error, items: [{ id: 'retry', title: t('重试'), command: nativeCommand('navigation.refresh') }] });
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
