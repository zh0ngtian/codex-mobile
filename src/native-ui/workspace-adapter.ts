import { validateMessageQuote } from '../features/conversation/message-quotes';
import type { ImageGenerationError } from '../backends/image-generation-error';
import { projectToolPanel, projectFilePanel, projectAttachmentPreview, type NativeAttachmentPreview, useNativeRichContent, type NativeFileState } from './rich-content';
import { workspaceBusinessPanels } from './workspace-panels';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BackendConfig } from '../backends/types';
import type { DraftFile, DraftImage } from '../ui/attachments';
import { remoteImagePreviewUrl, remoteFilePreviewUrl, remoteFileDownloadUrl } from '../backends/file-upload';
import { filterInstalledSkills, skillMentionAt, skillDisplayName, skillDescription, type InstalledSkill } from '../app-server/skills';
import { filterInstalledPlugins, pluginDisplayName, pluginDescription, type InstalledPlugin } from '../app-server/plugins';
import { getActiveLocale, t } from '../i18n';
import { FONT_SCALES, readFontSize } from '../ui/font-size';
import { effortLabel, effortOptionsForModel } from '../ui/settings';
import { groupConversationTurns } from '../ui/conversation';
import { projectNameOf } from '../features/threads/thread-list-model';
import { contextUsageMetrics, formatTokenCount, inputCacheHitPercent, rateLimitMetrics } from '../features/conversation/usage-metrics';
import { copyText } from '../ui/copy';
import type { NativeRuntime } from './runtime';
import { useNativeWorkspace } from './adapters';
import { nativeAction, nativeCommand, projectConversation, insertNativeMentionAt } from './projection';
import { emptyNativeSnapshot, type NativeHandlers, type NativeSnapshot, type NativePanelItem, type NativeCommand } from './protocol';
import { assertNativeAttachmentSelection, nativeImportedFiles } from './attachment-import';

type RecordValue = Record<string, any>;
/** 现有 BackendWorkspace 的业务控制器。对象仅在 JS 内传递，绝不直接发布给 Swift。
 * Task2b 可在此接口扩展审批、设置与丰富预览；所有操作仍回到 App 原有回调。 */
export interface NativeWorkspaceController {
  backend: BackendConfig; active: RecordValue | null; contextId: string; connection: string;
  draft: string; draftRevision?: number; caretOffset?: number; getDraft?: () => string; getCaret?: () => number; draftImages: DraftImage[]; draftFiles: DraftFile[]; busy: boolean; readOnly: boolean;
  imageReading: boolean; draftSaving: boolean; pending: boolean; models: RecordValue[]; selectedModel: string;
  selectedModelLabel: string; effortOptions: Array<{ id: string; label: string }>; selectedEffort: string | null; permission: string;
  skills: InstalledSkill[]; plugins: InstalledPlugin[]; queued: RecordValue[]; approvalCount: number;
  loadState: string; loadError?: string; olderTurnsState: string; error: string; syncStale?: boolean; draftSaveStatus?: string;
  setDraft: (value: string, revision?: number, caretOffset?: number) => void; send: () => Promise<boolean | void>; stop: () => Promise<void>;
  chooseModel: (value: string) => void; chooseEffort: (value: string) => void; removeAttachment: (id: string) => void;
  selectFiles: (files: File[]) => Promise<boolean | void>; selectLocation: () => Promise<boolean>; saveDraft: () => Promise<boolean | void>;
  retry: () => void; loadOlder: () => Promise<boolean>; editMessage: (turnId: string, messageId: string) => void;
  cancelQueued: (id: string, confirmed?: boolean) => Promise<void>; sendQueued: (id: string) => Promise<void>; editQueued: (id: string, value: string) => Promise<boolean>;
  /** 后续完整panel仍通过显式命令白名单扩展，不创建另一业务层。 */
  extended?: { state: RecordValue; callbacks: Record<string, (...args: any[]) => any> };
}
interface PanelState { panelId: string | null; query: string; setPanel: (id: string | null) => void; setQuery: (query: string) => void; getQuery?: () => string; file?: NativeFileState | null; attachmentPreview?: NativeAttachmentPreview | null; richContent?: NativePanelItem[]; customAnswers?: Set<string>; setCustomAnswer?: (key: string, custom: boolean) => void; richHandlers?: NativeHandlers; closeRich?: () => void; diagnostics?: Record<string, ImageGenerationError | null>; loadDiagnostic?: (id: string) => Promise<void> }
function projectPanel(c: NativeWorkspaceController, panel: PanelState): NativeSnapshot['panel'] {
  const id = panel.panelId;
  if (!id || ['approval', 'history-edit', 'confirm-history'].includes(id) || id.startsWith('confirm-queue:') || id.startsWith('queue-edit:')) return undefined;
  if (id === 'mentions') {
    const items: NativePanelItem[] = [{ id: 'mention-search', kind: 'textField', title: t('搜索 Skill / Plugin'), value: panel.query, command: nativeCommand('mention.search') },
      ...filterInstalledSkills(c.skills, panel.query).map(skill => ({ ...nativeAction(`skill:${skill.path}`, skillDisplayName(skill), 'mention.insert', { id: `skill:${skill.path}` }), text: skillDescription(skill) })),
      ...filterInstalledPlugins(c.plugins, panel.query).map(plugin => ({ ...nativeAction(`plugin:${plugin.id}`, pluginDisplayName(plugin), 'mention.insert', { id: `plugin:${plugin.id}` }), text: pluginDescription(plugin) })),
    ];
    return { id, title: t('Skill / Plugin'), items };
  }
  if (id === 'attachment') return projectAttachmentPreview(panel.attachmentPreview);
  if (id === 'file') return projectFilePanel(c, panel.file);
  const tool = projectToolPanel(c, id, panel.diagnostics); if (tool) return tool;
  return { id, title: t('内容已更新，请重新打开'), items: [] };
}
/** 命令绑定投影创建时的上下文，不能让旧sheet按钮使用点击时的新context。 */
export function bindWorkspaceCommands(snapshot: NativeSnapshot): NativeSnapshot {
  const contextual = (command?: NativeCommand): NativeCommand | undefined => command ? { ...command, params: { ...command.params, contextId: command.params.contextId ?? snapshot.contextId } } : undefined;
  const item = (value: NativePanelItem): NativePanelItem => ({ ...value, command: contextual(value.command), children: value.children?.map(item) });
  return { ...snapshot,
    attachments: snapshot.attachments.map(value => ({ ...value, command: contextual(value.command) })),
    messages: snapshot.messages.map(message => ({ ...message, blocks: message.blocks?.map(item), commentary: message.commentary?.map(entry => ({ ...entry, blocks: entry.blocks?.map(item) })), actions: message.actions?.map(item), historyEdit: message.historyEdit ? { ...message.historyEdit, items: message.historyEdit.items.map(item) } : undefined })),
    queued: snapshot.queued.map(entry => ({ ...entry, command: contextual(entry.command), actions: entry.actions?.map(item) })),
    conversationActions: snapshot.conversationActions?.map(item),
    sidechatActions: snapshot.sidechatActions?.map(item),
    panel: snapshot.panel ? { ...snapshot.panel, items: snapshot.panel.items.map(item) } : undefined,
    approvalPanel: snapshot.approvalPanel ? { ...snapshot.approvalPanel, items: snapshot.approvalPanel.items.map(item) } : undefined,
  };
}
function projectNativeTokenUsage(usage: RecordValue | undefined): NativeSnapshot['tokenUsage'] {
  if (!usage) return undefined;
  const values = { lastRequestTokens: usage.last?.totalTokens, modelContextWindow: usage.modelContextWindow,
    inputTokens: usage.total?.inputTokens, cachedInputTokens: usage.total?.cachedInputTokens, outputTokens: usage.total?.outputTokens,
    totalTokens: usage.total?.totalTokens, reasoningOutputTokens: usage.total?.reasoningOutputTokens };
  const entries = Object.entries(values).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return entries.length ? Object.fromEntries(entries) : undefined;
}
export function createWorkspaceAdapter(c: NativeWorkspaceController, panel: PanelState): { snapshot: NativeSnapshot; handlers: NativeHandlers } {
  const state = c.extended?.state ?? {};
  const options = (entries: RecordValue[]) => entries.map(option => ({ id: String(option.id ?? ''), value: String(option.id ?? ''), title: String(option.label ?? option.id ?? ''), ...(option.description ? { subtitle: String(option.description) } : {}) }));
  const messages = projectConversation(c.active, path => remoteImagePreviewUrl(c.backend, path), path => remoteImagePreviewUrl(c.backend, path, false), path => remoteFilePreviewUrl(c.backend, path), c.backend.id, path => remoteFileDownloadUrl(c.backend, path));
  if (state.sidechatActive) for (const message of messages) message.actions = message.actions?.filter(action => action.command?.name !== 'message.edit');
  if (c.busy && c.active?.mobilePlan?.length) messages.push({ id: 'running-plan', role: 'activity', activityKind: 'plan', text: '', blocks: [{ id: 'plan', kind: 'section', title: t('执行计划'), children: c.active.mobilePlan.map((step: any, index: number) => ({ id: `plan:${index}:${step.step}`, kind: 'text', title: `${step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '●' : '○'} ${step.step}`, text: step.status })) }] });
  if (c.extended?.state.pendingSteerText) messages.push({ id: 'pending-steer', role: 'activity', text: String(c.extended.state.pendingSteerText), status: t('正在引导') });
  const caretOffset = Math.max(0, Math.min(c.draft.length, c.caretOffset ?? c.draft.length));
  const mention = skillMentionAt(c.draft, caretOffset);
  const mentions = mention ? [
    ...filterInstalledSkills(c.skills, mention.query).slice(0, 8).map(skill => ({ id: `skill:${skill.path}`, value: `skill:${skill.path}`, title: skillDisplayName(skill), subtitle: skillDescription(skill) })),
    ...filterInstalledPlugins(c.plugins, mention.query).slice(0, 8).map(plugin => ({ id: `plugin:${plugin.id}`, value: `plugin:${plugin.id}`, title: pluginDisplayName(plugin), subtitle: pluginDescription(plugin) })),
  ] : [];
  const hasInput = !!c.draft.trim() || !!c.draftImages.length || !!c.draftFiles.length;
  const business = workspaceBusinessPanels(c, panel, messages);
  const approvalPanel = state.approval ? workspaceBusinessPanels(c, { ...panel, panelId: 'approval' }, messages).panel : undefined;
  if (business.historyMessage) business.historyMessage.historyEdit = business.historyEdit;
  const context = contextUsageMetrics(state.tokenUsage);
  const inputTokenUsage = formatTokenCount(state.tokenUsage?.total?.inputTokens);
  const outputTokenUsage = formatTokenCount(state.tokenUsage?.total?.outputTokens);
  const sevenDayRateLimit = rateLimitMetrics(state.rateLimits, 10080);
  const fiveHourRateLimit = rateLimitMetrics(state.rateLimits, 300);
  const conversationActions = [...business.actions, nativeAction('mentions', 'Skill / Plugin', 'panel.open', { id: 'mentions' })];
  if (!c.active?.id) conversationActions.push({ ...nativeAction('save-draft', c.draftSaveStatus || t('保存草稿'), 'draft.save'), disabled: !hasInput || c.draftSaving || c.imageReading || c.busy || c.pending });
  if (c.loadState === 'error') conversationActions.push(nativeAction('retry', t('重试'), 'thread.retry'));
  if (c.olderTurnsState !== 'exhausted') conversationActions.push({ ...nativeAction('older', c.olderTurnsState === 'loading' ? t('加载中…') : c.olderTurnsState === 'error' ? t('重试加载历史') : t('加载更早消息'), 'thread.older'), disabled: c.olderTurnsState === 'loading' });
  const snapshot: NativeSnapshot = { ...emptyNativeSnapshot(), ready: true, locale: getActiveLocale(), fontScale: FONT_SCALES[readFontSize()],
    quotes: state.quotes ?? [], quoteFocusToken: state.quoteFocusToken,
    sidechatActive: state.sidechatActive === true, sidechatParentId: state.sidechatParentId, sidechatActions: state.sidechatActions,
    title: String(c.active?.name || c.active?.preview || t('新对话')), backendId: c.backend.id, threadId: c.active?.id ? String(c.active.id) : undefined, cwd: typeof c.active?.cwd === 'string' ? c.active.cwd : undefined, contextId: c.contextId,
    backendName: c.backend.name, projectName: !c.active?.id && !c.active?.cwd ? t('无项目') : projectNameOf(c.active ?? {}),
    draftRevision: c.draftRevision, caretOffset, mentions, richContent: panel.richContent, connection: c.connection, busy: c.busy, draft: c.draft, canSend: hasInput && !c.readOnly && !c.imageReading && !c.draftSaving,
    canInterrupt: c.busy && !!c.active?.id && !c.readOnly, readOnly: c.readOnly, messages,
    attachments: [...c.draftImages.map(image => ({ id: image.id, name: image.name, type: image.type, imageURL: image.url, size: image.size, detail: `${image.size} B` })), ...c.draftFiles.map(file => ({ id: file.id, name: file.name, type: file.type, size: file.size, detail: `${file.size} B`, command: nativeCommand('attachment.preview', { id: file.id }) }))],
    queued: c.queued.map(item => {
      const s = c.extended?.state ?? {}; const locked = item.state === 'sending' || item.state === 'uncertain';
      const canAct = !s.steering && !s.queueSaving && !locked && (c.busy ? !!s.steerable : !!item.failed);
      const status = item.state === 'sending' ? t('发送中') : item.state === 'uncertain' ? t('待确认') : canAct ? t(c.busy ? '改为引导' : '重试') : t('排队中');
      return { id: String(item.id), title: String(item.text), subtitle: `${status}${item.error ? ` · ${item.error}` : ''}`,
        backendId: c.backend.id, threadId: typeof item.threadId === 'string' ? item.threadId : undefined,
        inputText: typeof item.inputText === 'string' ? item.inputText : undefined, queueState: item.state ?? (item.failed ? 'failed' : 'queued'),
        attachmentCount: Number.isSafeInteger(item.attachmentCount) ? item.attachmentCount : undefined,
        revision: Number.isSafeInteger(item.revision) ? item.revision : undefined, error: typeof item.error === 'string' ? item.error : undefined,
        command: canAct ? nativeCommand('queue.send', { id: item.id }) : undefined,
        actions: [{ ...nativeAction(`${item.id}:edit`, t('编辑'), 'panel.open', { id: `queue-edit:${item.id}` }), disabled: locked || !!s.steering || !!s.queueSaving }, { ...nativeAction(`${item.id}:cancel`, t('移除'), 'queue.cancel', { id: item.id }), disabled: item.state === 'sending' || !!s.steering || !!s.queueSaving }] };
    }),
    approvalCount: c.approvalCount, model: c.selectedModelLabel, effort: effortLabel(c.selectedEffort), permission: c.permission,
    models: c.models.map(model => ({ id: String(model.model), title: String(model.displayName || model.model), value: String(model.model),
      efforts: effortOptionsForModel(model).map(option => ({ id: option.id, value: option.id, title: option.label })),
      ...(typeof model.defaultReasoningEffort === 'string' ? { defaultEffort: model.defaultReasoningEffort } : {}) })),
    efforts: c.effortOptions.map(option => ({ id: option.id, title: option.label, value: option.id })),
    modelValue: c.selectedModel, effortValue: c.selectedEffort ?? '',
    speeds: Array.isArray(state.speedOptions) ? options(state.speedOptions) : undefined,
    speedValue: Array.isArray(state.speedOptions) ? String(state.selectedServiceTier ?? '') : undefined,
    speed: state.speedOptions?.find((option: RecordValue) => option.id === state.selectedServiceTier)?.label,
    permissions: Array.isArray(state.permissionModes) ? options(state.permissionModes) : undefined,
    permissionValue: typeof state.selectedPermissionModeId === 'string' ? state.selectedPermissionModeId : undefined,
    contextUsage: context ? { ...context, used: Math.min(context.total, Math.max(0, context.used)) } : undefined,
    inputTokenUsage: inputTokenUsage ?? undefined,
    outputTokenUsage: outputTokenUsage ?? undefined,
    inputCacheHitPercent: inputCacheHitPercent(state.tokenUsage) ?? undefined,
    sevenDayRateLimit: sevenDayRateLimit ?? undefined,
    fiveHourRateLimit: fiveHourRateLimit ?? undefined,
    tokenUsage: projectNativeTokenUsage(state.tokenUsage), approvalPanel,
    pending: c.pending || c.imageReading || c.draftSaving, loading: c.loadState, olderTurnsState: c.olderTurnsState, conversationActions,
    badge: c.syncStale ? t('正在同步') : undefined, error: c.error || c.loadError || undefined,
    panel: business.panel ?? projectPanel(c, panel),
  };
  const handlers: NativeHandlers = {
    'message.quote': p => c.extended?.callbacks.addQuote(validateMessageQuote(p, c.backend.id, c.active)),
    'sidechat.quote': p => { if (state.sidechatActive) throw new Error(t('请从主聊天创建 Sidechat')); return c.extended?.callbacks.createSidechat(validateMessageQuote(p, c.backend.id, c.active)); },
    'quote.remove': p => { if (!state.quotes?.some((quote: any) => quote.id === p.id)) throw new Error(t('引用已移除')); c.extended?.callbacks.removeQuote(String(p.id)); },
    'sidechat.create': () => c.extended?.callbacks.createSidechat(),
    'sidechat.open': p => c.extended?.callbacks.openSidechat(String(p.id)),
    'sidechat.return': () => c.extended?.callbacks.returnFromSidechat(),
    'sidechat.close': p => c.extended?.callbacks.closeSidechat(String(p.id)),
    'draft.set': p => c.setDraft(String(p.value), Number(p.revision), typeof p.caretOffset === 'number' ? p.caretOffset : String(p.value).length),
    'message.send': async () => {
      if (c.imageReading || c.draftSaving) throw new Error(t('当前无法发送消息'));
      if (await c.send() === false) throw new Error(t('消息未发送，请查看会话错误'));
    },
    'turn.stop': () => c.stop(),
    'model.select': p => { if (!c.models.some(model => model.model === p.value)) throw new Error(t('模型不可用')); c.chooseModel(String(p.value)); },
    'effort.select': p => { if (!c.effortOptions.some(option => option.id === p.value)) throw new Error(t('推理强度不可用')); c.chooseEffort(String(p.value)); },
    'attachment.remove': p => { if (!snapshot.attachments.some(item => item.id === p.id)) throw new Error(t('附件已移除')); c.removeAttachment(String(p.id)); },
    'attachment.pick': async p => {
      const pick = (window as Window & { codexMobilePickAttachments?: (kind: string) => Promise<File[]> }).codexMobilePickAttachments;
      if (!pick) throw new Error(t('附件选择器不可用'));
      const context = c.contextId;
      const files = await pick(String(p.kind));
      // Controller selectFiles 再核对 context；取消无修改。
      if (files.length && context === c.contextId && await c.selectFiles(files) === false) throw new Error(t('附件未导入，请保留选择后重试'));
    },
    'attachment.import': async p => {
      if (c.imageReading || c.draftSaving) throw new Error(t('当前无法导入附件'));
      const files = nativeImportedFiles(p.items);
      assertNativeAttachmentSelection(files, c.draftImages, c.draftFiles);
      if (await c.selectFiles(files) === false) throw new Error(t('附件未导入，请保留选择后重试'));
    },
    'location.insert': async () => { if (!await c.selectLocation()) throw new Error(t('无法获取当前位置')); },
    'draft.save': async () => { if (await c.saveDraft() === false) throw new Error(t('无法保存草稿')); }, 'thread.retry': () => c.retry(),
    'thread.older': async () => { if (await c.loadOlder() === false) throw new Error(t('加载失败')); },
    'message.copy': async p => { const message = messages.find(item => item.id === p.id); if (!message) throw new Error(t('消息已更新')); if (!await copyText(message.rawText ?? message.text)) throw new Error(t('复制失败')); },
    'message.edit': p => c.editMessage(String(p.turnId), String(p.messageId)),
    'mention.search': p => panel.setQuery(String(p.value)),
    'mention.insert': p => {
      const skill = c.skills.find(entry => `skill:${entry.path}` === p.id);
      const plugin = c.plugins.find(entry => `plugin:${entry.id}` === p.id);
      if (!skill && !plugin) throw new Error(t('目录已更新，请重新选择'));
      const text = c.getDraft?.() ?? c.draft;
      const insertion = insertNativeMentionAt(text, skill ? { kind: 'skill', skill } : { kind: 'plugin', plugin: plugin! }, c.getCaret?.() ?? c.caretOffset ?? text.length);
      c.setDraft(insertion.text, undefined, insertion.cursor); panel.setPanel(null);
    },
    'panel.open': p => {
      const id = String(p.id);
      if (!business.accepts(id) && id !== 'mentions' && !groupConversationTurns(c.active?.turns ?? []).some((turn: RecordValue) => id === `changes:${turn.id}` || turn.items?.some((item: RecordValue) => id === `tool:${turn.id}:${item.id}`))) throw new Error(t('此面板尚未接入'));
      panel.closeRich?.(); panel.setPanel(id);
      const tool = groupConversationTurns(c.active?.turns ?? []).flatMap((turn: RecordValue) => (turn.items ?? []).map((item: RecordValue) => ({ turn, item }))).find(({ turn, item }: { turn: RecordValue; item: RecordValue }) => id === `tool:${turn.id}:${item.id}`);
      if (tool?.item.type === 'imageGeneration' && tool.item.status === 'failed') void panel.loadDiagnostic?.(String(tool.item.id));
      panel.setQuery(id.startsWith('queue-edit:') ? String(c.queued.find(q => `queue-edit:${q.id}` === id)?.inputText ?? c.queued.find(q => `queue-edit:${q.id}` === id)?.text ?? '') : id === 'thread-rename' ? String(c.active?.name ?? '') : '');
    },
    'panel.close': p => { if (p.id !== snapshot.panel?.id || snapshot.panel?.dismissible === false) throw new Error(t('面板已变化或当前不能关闭'));  if (snapshot.panel?.id.startsWith('approval:')) c.extended?.callbacks.dismissApproval?.(); if (snapshot.panel?.id.startsWith('history-edit:')) c.extended?.callbacks.cancelHistoricalMessageEdit?.(); panel.closeRich?.(); panel.setPanel(null); panel.setQuery(''); },
    ...business.handlers, ...panel.richHandlers,
    'workspace.thread': p => { if (p.action === 'rename') panel.setQuery(String(c.active?.name ?? '')); return business.handlers['workspace.thread']!(p); },
    'workspace.rename.change': p => { if (panel.panelId !== 'thread-rename') throw new Error(t('面板已关闭')); panel.setQuery(String(p.value)); },
    'workspace.rename.submit': async () => { if (panel.panelId !== 'thread-rename') throw new Error(t('面板已关闭')); const value = (panel.getQuery?.() ?? panel.query).trim(); if (!value) throw new Error(t('名称不能为空')); if (await c.extended?.callbacks.renameThread?.(value) === false) throw new Error(t('重命名未完成')); panel.setPanel(null); },
    'queue.change': p => { if (panel.panelId !== `queue-edit:${p.id}` || !c.queued.some(q => q.id === p.id)) throw new Error(t('队列已更新')); panel.setQuery(String(p.value)); },
    'queue.cancel': p => { const q = c.queued.find(q => q.id === p.id); if (!q || q.state === 'sending' || c.extended?.state.steering || c.extended?.state.queueSaving) throw new Error(t('队列已更新')); if (q.state === 'uncertain' && p.confirmed !== true) return panel.setPanel(`confirm-queue:${q.id}`); return c.cancelQueued(String(p.id), p.confirmed === true); },
    'queue.send': p => { const q = c.queued.find(q => q.id === p.id); if (!q || !snapshot.queued.find(entry => entry.id === q.id)?.command) throw new Error(t('当前无法发送排队消息')); return c.sendQueued(String(p.id)); },
    'queue.edit': async p => { const q = c.queued.find(q => q.id === p.id); if (!q || ['uncertain', 'sending', 'steering'].includes(q.state)) throw new Error(t('当前无法编辑排队消息')); if (!await c.editQueued(String(p.id), typeof p.value === 'string' ? p.value : panel.getQuery?.() ?? panel.query)) throw new Error(t('无法保存排队消息')); panel.setPanel(null); },
  };
  return { snapshot: bindWorkspaceCommands(snapshot), handlers };
}
export function useNativeConversationAdapter(runtime: NativeRuntime | null, c: NativeWorkspaceController) {
  const [panelId, setPanelID] = useState<string | null>(null);
  const [panelContext, setPanelContext] = useState(c.contextId);
  const committedContext = useRef(c.contextId);
  useLayoutEffect(() => { committedContext.current = c.contextId; }, [c.contextId]);
  const setPanel = (id: string | null) => { if (committedContext.current !== c.contextId) return; setPanelContext(c.contextId); setPanelID(id); };
  const [query, setQueryState] = useState('');
  const queryRef = useRef(query);
  const setQuery = (value: string) => { queryRef.current = value; setQueryState(value); };
  const [customAnswers, setCustomAnswers] = useState<Set<string>>(new Set());
  const setCustomAnswer = (key: string, custom: boolean) => setCustomAnswers(values => { const next = new Set(values); if (custom) next.add(key); else next.delete(key); return next; });
  const rich = useNativeRichContent(c, !!runtime, setPanel);
  const [draftAck, setDraftAck] = useState({ contextId: c.contextId, revision: 0, text: c.draft, caretOffset: c.draft.length });
  const draftAckRef = useRef(draftAck); draftAckRef.current = draftAck;
  useEffect(() => { setPanel(null); setQuery(''); setCustomAnswers(new Set()); }, [c.contextId]);
  const adapter = runtime ? createWorkspaceAdapter({ ...c, draftRevision: draftAck.contextId === c.contextId ? draftAck.revision : 0,
    caretOffset: draftAck.contextId === c.contextId && draftAck.text === c.draft ? draftAck.caretOffset : c.draft.length,
    getCaret: () => draftAckRef.current.contextId === c.contextId ? draftAckRef.current.caretOffset : c.draft.length,
    setDraft: (value, revision, caretOffset) => {
      c.setDraft(value);
      const next = { contextId: c.contextId, revision: revision ?? (draftAckRef.current.contextId === c.contextId ? draftAckRef.current.revision : 0), text: value, caretOffset: caretOffset ?? value.length };
      draftAckRef.current = next;
      setDraftAck(next);
  } }, { panelId: panelContext === c.contextId ? panelId : null, query, setPanel, setQuery, getQuery: () => queryRef.current, customAnswers, setCustomAnswer, file: rich.file, attachmentPreview: rich.attachmentPreview, richContent: rich.resources, richHandlers: rich.handlers, closeRich: rich.close, diagnostics: rich.diagnostics, loadDiagnostic: rich.loadDiagnostic }) : { snapshot: emptyNativeSnapshot(), handlers: {} };
  useNativeWorkspace(runtime, c.backend.id, adapter.snapshot, adapter.handlers);
}
