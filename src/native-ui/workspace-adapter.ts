import { workspaceBusinessPanels } from './workspace-panels';
import { useEffect, useRef, useState } from 'react';
import type { BackendConfig } from '../backends/types';
import type { DraftFile, DraftImage } from '../ui/attachments';
import { remoteImagePreviewUrl } from '../backends/file-upload';
import { filterInstalledSkills, skillMentionAt, skillDisplayName, skillDescription, type InstalledSkill } from '../app-server/skills';
import { filterInstalledPlugins, pluginDisplayName, pluginDescription, type InstalledPlugin } from '../app-server/plugins';
import { getActiveLocale, t } from '../i18n';
import { FONT_SCALES, readFontSize } from '../ui/font-size';
import { effortLabel } from '../ui/settings';
import { groupConversationTurns } from '../ui/conversation';
import { copyText } from '../ui/copy';
import type { NativeRuntime } from './runtime';
import { useNativeWorkspace } from './adapters';
import { nativeAction, nativeCommand, projectConversation, insertNativeMentionAt } from './projection';
import { emptyNativeSnapshot, type NativeHandlers, type NativeSnapshot, type NativePanelItem, type NativeCommand } from './protocol';

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
  selectFiles: (files: File[]) => Promise<void>; selectLocation: () => Promise<boolean>; saveDraft: () => Promise<boolean | void>;
  retry: () => void; loadOlder: () => Promise<boolean>; editMessage: (turnId: string, messageId: string) => void;
  cancelQueued: (id: string, confirmed?: boolean) => Promise<void>; sendQueued: (id: string) => Promise<void>; editQueued: (id: string, value: string) => Promise<boolean>;
  /** 后续完整panel仍通过显式命令白名单扩展，不创建另一业务层。 */
  extended?: { state: RecordValue; callbacks: Record<string, (...args: any[]) => any> };
}
interface PanelState { panelId: string | null; query: string; setPanel: (id: string | null) => void; setQuery: (query: string) => void }
function projectPanel(c: NativeWorkspaceController, panel: PanelState): NativeSnapshot['panel'] {
  const id = panel.panelId;
  if (!id) return undefined;
  if (id === 'mentions') {
    const items: NativePanelItem[] = [{ id: 'mention-search', kind: 'textField', title: t('搜索 Skill / Plugin'), value: panel.query, command: nativeCommand('mention.search') },
      ...filterInstalledSkills(c.skills, panel.query).map(skill => ({ ...nativeAction(`skill:${skill.path}`, skillDisplayName(skill), 'mention.insert', { id: `skill:${skill.path}` }), text: skillDescription(skill) })),
      ...filterInstalledPlugins(c.plugins, panel.query).map(plugin => ({ ...nativeAction(`plugin:${plugin.id}`, pluginDisplayName(plugin), 'mention.insert', { id: `plugin:${plugin.id}` }), text: pluginDescription(plugin) })),
    ];
    return { id, title: t('Skill / Plugin'), items };
  }
  for (const turn of groupConversationTurns(c.active?.turns ?? [])) {
    if (id === `changes:${turn.id}`) return { id, title: t('文件变更'), items: [{ id: `${id}:diff`, kind: 'diff', text: String(turn.liveDiff ?? (turn.items ?? []).filter((item: RecordValue) => item.type === 'fileChange').map((item: RecordValue) => JSON.stringify(item.changes, null, 2)).join('\n')) }] };
    for (const item of turn.items ?? []) if (id === `tool:${turn.id}:${item.id}`) return { id, title: String(item.type), items: [{ id: `${id}:detail`, kind: 'code', title: 'json', text: JSON.stringify(item, null, 2) }] };
  }
  return { id, title: t('内容已更新，请重新打开'), items: [] };
}
/** 命令绑定投影创建时的上下文，不能让旧sheet按钮使用点击时的新context。 */
export function bindWorkspaceCommands(snapshot: NativeSnapshot): NativeSnapshot {
  const contextual = (command?: NativeCommand): NativeCommand | undefined => command ? { ...command, params: { ...command.params, contextId: command.params.contextId ?? snapshot.contextId } } : undefined;
  const item = (value: NativePanelItem): NativePanelItem => ({ ...value, command: contextual(value.command), children: value.children?.map(item) });
  return { ...snapshot,
    messages: snapshot.messages.map(message => ({ ...message, blocks: message.blocks?.map(item), actions: message.actions?.map(item) })),
    queued: snapshot.queued.map(entry => ({ ...entry, command: contextual(entry.command), actions: entry.actions?.map(item) })),
    conversationActions: snapshot.conversationActions?.map(item),
    panel: snapshot.panel ? { ...snapshot.panel, items: snapshot.panel.items.map(item) } : undefined,
  };
}
export function createWorkspaceAdapter(c: NativeWorkspaceController, panel: PanelState): { snapshot: NativeSnapshot; handlers: NativeHandlers } {
  const messages = projectConversation(c.active, path => remoteImagePreviewUrl(c.backend, path), path => remoteImagePreviewUrl(c.backend, path, false));
  const caretOffset = Math.max(0, Math.min(c.draft.length, c.caretOffset ?? c.draft.length));
  const mention = skillMentionAt(c.draft, caretOffset);
  const mentions = mention ? [
    ...filterInstalledSkills(c.skills, mention.query).slice(0, 8).map(skill => ({ id: `skill:${skill.path}`, value: `skill:${skill.path}`, title: skillDisplayName(skill), subtitle: skillDescription(skill) })),
    ...filterInstalledPlugins(c.plugins, mention.query).slice(0, 8).map(plugin => ({ id: `plugin:${plugin.id}`, value: `plugin:${plugin.id}`, title: pluginDisplayName(plugin), subtitle: pluginDescription(plugin) })),
  ] : [];
  const hasInput = !!c.draft.trim() || !!c.draftImages.length || !!c.draftFiles.length;
  const business = workspaceBusinessPanels(c, panel);
  const conversationActions = [...business.actions, nativeAction('mentions', 'Skill / Plugin', 'panel.open', { id: 'mentions' })];
  if (!c.active?.id) conversationActions.push({ ...nativeAction('save-draft', c.draftSaveStatus || t('保存草稿'), 'draft.save'), disabled: !hasInput || c.draftSaving || c.imageReading || c.busy || c.pending });
  if (c.loadState === 'error') conversationActions.push(nativeAction('retry', t('重试'), 'thread.retry'));
  if (c.olderTurnsState !== 'exhausted') conversationActions.push({ ...nativeAction('older', c.olderTurnsState === 'loading' ? t('加载中…') : c.olderTurnsState === 'error' ? t('重试加载历史') : t('加载更早消息'), 'thread.older'), disabled: c.olderTurnsState === 'loading' });
  const snapshot: NativeSnapshot = { ...emptyNativeSnapshot(), ready: true, locale: getActiveLocale(), fontScale: FONT_SCALES[readFontSize()],
    title: String(c.active?.name || c.active?.preview || t('新对话')), backendId: c.backend.id, threadId: c.active?.id ? String(c.active.id) : undefined, contextId: c.contextId,
    draftRevision: c.draftRevision, caretOffset, mentions, connection: c.connection, busy: c.busy, draft: c.draft, canSend: hasInput && !c.readOnly && !c.imageReading && !c.draftSaving,
    canInterrupt: c.busy && !!c.active?.id && !c.readOnly, readOnly: c.readOnly, messages,
    attachments: [...c.draftImages.map(image => ({ id: image.id, name: image.name, imageURL: image.url, detail: `${image.size} B` })), ...c.draftFiles.map(file => ({ id: file.id, name: file.name, detail: `${file.size} B` }))],
    queued: c.queued.map(item => ({ id: String(item.id), title: String(item.text), subtitle: String(item.state ?? (item.failed ? t('发送失败') : t('排队中'))),
      command: ['uncertain', 'sending', 'steering'].includes(item.state) ? undefined : nativeCommand('queue.send', { id: item.id }), actions: [{ ...nativeAction(`${item.id}:edit`, t('编辑'), 'panel.open', { id: `queue-edit:${item.id}` }), disabled: ['uncertain', 'sending', 'steering'].includes(item.state) }, nativeAction(`${item.id}:cancel`, t('移除'), 'queue.cancel', { id: item.id })] })),
    approvalCount: c.approvalCount, model: c.selectedModelLabel, effort: effortLabel(c.selectedEffort), permission: c.permission,
    models: c.models.map(model => ({ id: String(model.model), title: String(model.displayName || model.model), value: String(model.model) })),
    efforts: c.effortOptions.map(option => ({ id: option.id, title: option.label, value: option.id })),
    pending: c.pending || c.imageReading || c.draftSaving, loading: c.loadState, conversationActions,
    badge: c.syncStale ? t('正在同步') : undefined, error: c.error || c.loadError || undefined,
    panel: business.panel ?? projectPanel(c, panel),
  };
  const handlers: NativeHandlers = {
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
      if (files.length && context === c.contextId) await c.selectFiles(files);
    },
    'location.insert': async () => { if (!await c.selectLocation()) throw new Error(t('无法获取当前位置')); },
    'draft.save': async () => { if (await c.saveDraft() === false) throw new Error(t('无法保存草稿')); }, 'thread.retry': () => c.retry(), 'thread.older': () => c.loadOlder(),
    'message.copy': async p => { const message = messages.find(item => item.id === p.id); if (!message) throw new Error(t('消息已更新')); if (!await copyText(message.text)) throw new Error(t('复制失败')); },
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
      panel.setPanel(id); panel.setQuery('');
    },
    'panel.close': () => { panel.setPanel(null); panel.setQuery(''); },
    ...business.handlers,
    'workspace.rename.change': p => panel.setQuery(String(p.value)),
    'workspace.rename.submit': () => { if (!panel.query.trim()) throw new Error(t('名称不能为空')); c.extended?.callbacks.renameThread?.(panel.query.trim()); panel.setPanel(null); },
    'queue.change': p => { if (!c.queued.some(q => q.id === p.id)) throw new Error(t('队列已更新')); panel.setQuery(String(p.value)); },
    'queue.cancel': p => { const q = c.queued.find(q => q.id === p.id); if (!q) throw new Error(t('队列已更新')); if (q.state === 'uncertain' && p.confirmed !== true) return panel.setPanel(`confirm-queue:${q.id}`); return c.cancelQueued(String(p.id), p.confirmed === true); },
    'queue.send': p => { const q = c.queued.find(q => q.id === p.id); if (!q || ['uncertain', 'sending', 'steering'].includes(q.state)) throw new Error(t('当前无法发送排队消息')); return c.sendQueued(String(p.id)); },
    'queue.edit': async p => { const q = c.queued.find(q => q.id === p.id); if (!q || ['uncertain', 'sending', 'steering'].includes(q.state)) throw new Error(t('当前无法编辑排队消息')); if (!await c.editQueued(String(p.id), typeof p.value === 'string' ? p.value : panel.query)) throw new Error(t('无法保存排队消息')); panel.setPanel(null); },
  };
  return { snapshot: bindWorkspaceCommands(snapshot), handlers };
}
export function useNativeConversationAdapter(runtime: NativeRuntime | null, c: NativeWorkspaceController) {
  const [panelId, setPanelID] = useState<string | null>(null);
  const [panelContext, setPanelContext] = useState(c.contextId);
  const setPanel = (id: string | null) => { setPanelContext(c.contextId); setPanelID(id); };
  const [query, setQuery] = useState('');
  const [draftAck, setDraftAck] = useState({ contextId: c.contextId, revision: 0, text: c.draft, caretOffset: c.draft.length });
  const draftAckRef = useRef(draftAck); draftAckRef.current = draftAck;
  useEffect(() => { setPanel(null); setQuery(''); }, [c.contextId]);
  const adapter = runtime ? createWorkspaceAdapter({ ...c, draftRevision: draftAck.contextId === c.contextId ? draftAck.revision : 0,
    caretOffset: draftAck.contextId === c.contextId && draftAck.text === c.draft ? draftAck.caretOffset : c.draft.length,
    getCaret: () => draftAckRef.current.contextId === c.contextId ? draftAckRef.current.caretOffset : c.draft.length,
    setDraft: (value, revision, caretOffset) => {
      c.setDraft(value);
      const next = { contextId: c.contextId, revision: revision ?? (draftAckRef.current.contextId === c.contextId ? draftAckRef.current.revision : 0), text: value, caretOffset: caretOffset ?? value.length };
      draftAckRef.current = next;
      setDraftAck(next);
  } }, { panelId: panelContext === c.contextId ? panelId : null, query, setPanel, setQuery }) : { snapshot: emptyNativeSnapshot(), handlers: {} };
  useNativeWorkspace(runtime, c.backend.id, adapter.snapshot, adapter.handlers);
}
