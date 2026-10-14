import { groupConversationTurns, splitTurnResponseSegments, imageSourcesForItem, isThreadRunning, turnDurationMs, stripGitDirectives, automationAgentMessageText, summarizeTurnChanges } from '../ui/conversation';
import { extractGeneratedTitle, stripConversationTitleRequest } from '../app-server/conversation-title';
import { groupThreadsByProject, splitAllThreads, type AggregatedThreadItem } from '../features/threads/thread-list-model';
import { projectCollapseKey } from '../features/threads/project-collapse';
import { PROJECTLESS_GROUP_ID, type ProjectThreadLoadState } from '../app-server/thread-list-loader';
import { titleOf } from '../ui/app-display';
import { insertSkillMention, skillMentionAt, type InstalledSkill } from '../app-server/skills';
import { insertPluginMention, type InstalledPlugin } from '../app-server/plugins';
import { t } from '../i18n';
import type { NativeCommand, NativeGroup, NativeMessage, NativePanelItem } from './protocol';

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
export function projectConversation(active: RecordValue | null, imageURL: (path: string) => string): NativeMessage[] {
  const messages: NativeMessage[] = [];
  const imageBlocks = (item: RecordValue, prefix: string): NativePanelItem[] => imageSourcesForItem(item).map((image, index) => ({
    id: `${prefix}:image:${index}`, kind: 'image', title: image.name, value: image.local ? imageURL(image.source) : image.source,
  }));
  for (const turn of groupConversationTurns(active?.turns ?? [])) {
    const turnId = String(turn.id);
    const duration = turnDurationMs(turn);
    const status = duration == null ? undefined : `${t('用时')} ${Math.floor(duration / 1000)} ${t('秒')}`;
    // 与Web Timeline相同，按用户插话拆段，不能把整轮用户消息提前集中展示。
    for (const segment of splitTurnResponseSegments(turn.items ?? [])) {
      const segmentID = `${turnId}:${segment[0]?.id ?? 'activity'}`;
      const hasFinal = segment.some(item => item.type === 'agentMessage' && item.phase !== 'commentary');
      const running = ['inProgress', 'in_progress', 'running'].includes(String(turn.status));
      const collapse = hasFinal || !running;
      const commentary = segment.filter(item => item.type === 'agentMessage' && item.phase === 'commentary');
      let historyInserted = false;
      const tools: NativePanelItem[] = [];
      for (const item of segment) {
        const id = `${turnId}:${item.id}`;
        if (item.type === 'userMessage') {
          messages.push({ id, role: 'user', text: nativeItemText(item), blocks: imageBlocks(item, id),
            actions: [nativeAction(`${id}:copy`, t('复制'), 'message.copy', { id }), nativeAction(`${id}:edit`, t('编辑'), 'message.edit', { turnId, messageId: String(item.id) })] });
        } else if (item.type === 'agentMessage') {
          if (item.phase === 'commentary' && collapse) {
            if (!historyInserted) messages.push({ id: `${segmentID}:history`, role: 'activity', text: '', blocks: [{ id: `${segmentID}:commentary`, kind: 'disclosure', title: `${t('历史过程')} (${commentary.length})`,
              children: commentary.map(entry => ({ id: `${turnId}:${entry.id}`, kind: 'markdown', text: nativeItemText(entry) })) }] });
            historyInserted = true;
          } else messages.push({ id, role: 'assistant', text: nativeItemText(item), status: item.phase === 'commentary' ? undefined : status,
            actions: [nativeAction(`${id}:copy`, t('复制'), 'message.copy', { id })] });
        } else if (!imageSourcesForItem(item).length && item.type !== 'reasoning') {
          tools.push(nativeAction(`${id}:tool`, item.type === 'commandExecution' ? t('执行命令') : String(item.type), 'panel.open', { id: `tool:${turnId}:${item.id}` }));
        }
      }
      if (tools.length) messages.push({ id: `${segmentID}:tools`, role: 'activity', text: '', blocks: [{ id: `${segmentID}:tools`, kind: 'disclosure', title: `${t('工具')} (${tools.length})`, children: tools }] });
    }
    // 媒体独立于commentary，跨整个逻辑turn去重，生成结果优先于同源过程截图。
    const generated = (turn.items ?? []).filter((item: RecordValue) => item.type === 'imageGeneration');
    const generatedSources = new Set(generated.flatMap((item: RecordValue) => imageSourcesForItem(item).map(image => image.source)));
    const seen = new Set<string>();
    const generatedImages: NativePanelItem[] = [];
    const screenshots: NativePanelItem[] = [];
    for (const item of [...generated, ...(turn.items ?? []).filter((entry: RecordValue) => entry.type === 'imageView')]) {
      for (const [index, image] of imageSourcesForItem(item).entries()) {
        if (seen.has(image.source) || (item.type === 'imageView' && generatedSources.has(image.source))) continue;
        seen.add(image.source);
        const block: NativePanelItem = { id: `${turnId}:${item.id}:image:${index}`, kind: 'image', title: image.name, value: image.local ? imageURL(image.source) : image.source };
        if (item.type === 'imageGeneration') generatedImages.push(block); else screenshots.push(block);
      }
    }
    const mediaBlocks: NativePanelItem[] = [...generatedImages, ...(screenshots.length > 1 ? [{ id: `${turnId}:screenshots`, kind: 'disclosure', title: `${t('过程截图')} (${screenshots.length})`, children: screenshots }] : screenshots)];
    const changes = summarizeTurnChanges(turn);
    if (turn.liveDiff || changes.additions || changes.deletions) mediaBlocks.push(nativeAction(`${turnId}:changes`, `${t('文件变更')} +${changes.additions} −${changes.deletions}`, 'panel.open', { id: `changes:${turnId}` }));
    if (mediaBlocks.length) messages.push({ id: `${turnId}:media`, role: 'activity', text: '', blocks: mediaBlocks });
  }
  return messages;
}

interface NavigationInput {
  threads: AggregatedThreadItem[]; listBackendId: string; selectedBackendId: string; activeThreadId?: string;
  projectDirectories: string[]; hasProjectlessThreads: boolean; collapsedProjectKeys: Set<string>;
  projectThreadStates: Record<string, ProjectThreadLoadState>; projectHasMore: Record<string, boolean>; loadingProjectKeys: Set<string>;
  filter?: string; searching?: boolean; error?: string;
  backends?: Array<{ id: string; name: string }>;
  backendSnapshots?: Record<string, { projects: string[]; projectlessThreadIds: string[]; projectThreadStates: Record<string, ProjectThreadLoadState>; projectHasMore: Record<string, boolean> }>;
}
export function projectNavigation(input: NavigationInput): NativeGroup[] {
  const row = (item: AggregatedThreadItem) => {
    const params = { backendId: item.backendId, threadId: item.threadId };
    return { id: `${item.backendId}:${item.threadId}`, title: titleOf(item.thread), subtitle: input.listBackendId === 'all' ? `${item.backendName} · ${item.projectName}` : item.projectName,
      badge: isThreadRunning(item.thread.status) ? t('运行中') : item.unread ? t('未读') : undefined,
      selected: input.selectedBackendId === item.backendId && input.activeThreadId === item.threadId,
      command: nativeCommand('thread.open', params),
      actions: [
        ['pin', item.pinned ? t('取消关注') : t('关注')], ['refresh', t('刷新')], ['duplicate', t('复制会话')], ['rename', t('重命名')], ['archive', t('归档')],
      ].map(([action, title]) => nativeAction(`${item.backendId}:${item.threadId}:${action}`, title, 'thread.manage', { ...params, action })),
    };
  };
  const split = splitAllThreads(input.threads);
  const groups: NativeGroup[] = [{ id: 'favorites', title: t('关注'), items: split.pinned.map(row) }];
  if (input.filter === 'favorites') return groups;
  const appendProjects = (backendId: string, threads: AggregatedThreadItem[], directories: string[], hasProjectless: boolean,
    states: Record<string, ProjectThreadLoadState>, hasMore: Record<string, boolean>, backendName?: string) => {
    for (const group of groupThreadsByProject(threads, [...(hasProjectless ? [PROJECTLESS_GROUP_ID] : []), ...directories])) {
      const key = projectCollapseKey(backendId, group.cwd);
      const collapsed = input.collapsedProjectKeys.has(key);
      const params = { backendId, cwd: group.cwd };
      const actions: NativePanelItem[] = [];
      if (states[group.cwd] === 'error') actions.push(nativeAction(`${key}:retry`, t('重试'), 'project.retry', params));
      if (hasMore[group.cwd]) actions.push(nativeAction(`${key}:more`, input.loadingProjectKeys.has(key) ? t('加载中…') : t('加载更多'), 'project.more', params));
      groups.push({ id: key, title: backendName ? `${backendName} · ${group.projectName}` : group.projectName, collapsed, command: nativeCommand('project.toggle', params), actions, items: collapsed ? [] : group.threads.map(row) });
    }
  };
  if (input.listBackendId === 'all' && input.filter === 'projects') {
    for (const backend of input.backends ?? []) {
      const state = input.backendSnapshots?.[backend.id];
      appendProjects(backend.id, split.recent.filter(item => item.backendId === backend.id), state?.projects ?? [], !!state?.projectlessThreadIds.length, state?.projectThreadStates ?? {}, state?.projectHasMore ?? {}, backend.name);
    }
  } else if (input.listBackendId === 'all') groups.push({ id: 'recent', title: input.searching ? t('搜索中…') : t('最近会话'), items: split.recent.map(row) });
  else appendProjects(input.listBackendId, split.recent, input.projectDirectories, input.hasProjectlessThreads, input.projectThreadStates, input.projectHasMore);
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
