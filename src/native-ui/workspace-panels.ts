import { contextUsageView, sevenDayRateLimitView } from '../features/conversation/ConversationControls';
import { t } from '../i18n';
import { approvalDecisions, approvalKey, approvalResponse, questionResponse, type InputQuestion } from '../features/approvals/approval-model';
import { decisionLabel } from '../features/approvals/ApprovalSheet';
import { nativeAction, nativeCommand } from './projection';
import type { NativeMessage, NativePanelItem, NativeSnapshot, NativeHandlers } from './protocol';
import type { NativeWorkspaceController } from './workspace-adapter';

type State = { panelId: string | null; query: string; setPanel: (id: string | null) => void; customAnswers?: Set<string>; setCustomAnswer?: (key: string, custom: boolean) => void };
const text = (id: string, title: string, value: unknown): NativePanelItem => ({ id, kind: 'text', title, text: String(value ?? '') });
export function historyEditKey(edit: any) { return `${edit.threadId}:${edit.target.turnId}:${edit.target.messageId}`; }
export function workspaceBusinessPanels(c: NativeWorkspaceController, panel: State, messages: NativeMessage[]): { panel?: NativeSnapshot['panel']; historyEdit?: NativeSnapshot['panel']; historyMessage?: NativeMessage; actions: NativePanelItem[]; handlers: NativeHandlers; accepts: (id: string) => boolean } {
 const s = c.extended?.state ?? {}; const cb = c.extended?.callbacks ?? {};
 const actions = [nativeAction('workspace', t('会话设置'), 'panel.open', { id: 'workspace' })];
 if (c.approvalCount) actions.push(nativeAction('approval', t('{count} 个待审批', { count: c.approvalCount }), 'approval.reopen'));
 const choice = (id: string, title: string, value: unknown, options: any[], name: string, params = {}): NativePanelItem => ({ id, kind: 'singleChoice', title, value: String(value ?? ''), options: options.map(o => ({ id: String(o.id ?? ''), value: String(o.id ?? ''), title: String(o.label ?? o.name ?? o.id ?? ''), subtitle: o.description })), command: nativeCommand(name, params), disabled: c.pending });
 const edit = s.historyEdit;
 const key = edit ? historyEditKey(edit) : '';
 const historyMessage = edit?.threadId === c.active?.id ? messages.find(message => message.role === 'user' && message.actions?.some(item => item.command?.name === 'message.edit' && item.command.params.turnId === edit.target.turnId && item.command.params.messageId === edit.target.messageId)) : undefined;
 const historyParams = edit ? { editKey: key, turnId: edit.target.turnId, messageId: edit.target.messageId } : {};
 let historyEdit: NativeSnapshot['panel'];
 if (edit) {
  if (historyMessage) historyEdit = { id: `history-edit:${key}`, dismissible: !edit.submitting, title: t('编辑历史消息'), items: [
   { id: 'history-text', kind: 'multilineField', title: t('消息'), value: edit.text, command: nativeCommand('history.change', historyParams), disabled: edit.submitting },
   ...(edit.reverted ? [text('history-reverted', t('原对话已回退，待重新发送的编辑草稿'), '')] : []),
   text('history-attachments', t('原消息的 {count} 个附件会保留', { count: edit.target.attachmentCount ?? 0 }), edit.target.precedingMessageCount ? t('同轮此前的 {count} 条用户消息及附件会一起重发', { count: edit.target.precedingMessageCount }) : ''),
   ...(edit.target.input ?? []).filter((p: any) => p.type !== 'text').map((p: any, index: number) => text(`history-attachment:${index}`, t('保留附件'), p.name || p.path || p.url || p.type)),
   { ...nativeAction('history-submit', t('保存并重新发送'), 'history.submit', historyParams), disabled: edit.submitting || (!edit.text.trim() && !(edit.target.attachmentCount > 0 || (edit.target.input ?? []).some((p: any) => p.type !== 'text'))) },
   { ...nativeAction('history-cancel', t('取消'), 'history.cancel', historyParams), disabled: edit.submitting },
  ] };
  else actions.push(text('history-unavailable', t(edit.submitting ? '正在提交，请等待确认…' : '目标消息已变化，请取消编辑后重新选择'), ''), { ...nativeAction('history-cancel', t('取消'), 'history.cancel', historyParams), disabled: edit.submitting });
 }
 const request = s.approval;
 const requestKey = request ? approvalKey(request) : '';
 const questions: InputQuestion[] = request?.params?.questions ?? [];
 const answers = s.userAnswers ?? {};
 const disabled = !!s.approvalSubmitting;
 let result: NativeSnapshot['panel'];
 const id = ['permission', 'model', 'effort', 'speed'].includes(panel.panelId ?? '') ? 'workspace' : panel.panelId;
 if (id === 'workspace') {
  const items: NativePanelItem[] = [text('connection', t('设备连接'), `${c.backend.name} · ${t(c.connection === 'online' ? '已连接' : c.connection === 'connecting' ? '正在连接' : '未连接')}`), text('access', t('会话访问状态'), t(s.activeThreadAccessMode === 'readOnly' ? '只读' : '可交互')), text('sync', t('同步状态'), c.syncStale ? t('正在同步') : t('已同步')),
   choice('model', t('模型'), c.selectedModel, c.models.map(m => ({ id: m.model, label: m.displayName || m.model, description: m.description })), 'model.select'),
   choice('effort', t('推理强度'), c.selectedEffort, c.effortOptions, 'effort.select'),
   choice('speed', t('速度'), s.selectedServiceTier, s.speedOptions ?? [], 'speed.select'), choice('permission', t('权限模式'), s.selectedPermissionModeId, s.permissionModes ?? [], 'permission.select'),
  ];
  if (!c.active?.id) items.push(choice('new-backend', t('目标设备'), c.backend.id, (s.backends ?? []).filter((b: any) => b.enabled).map((b: any) => ({ id: b.id, label: b.name })), 'newchat.backend'),
   choice('new-project', t('项目'), c.active?.cwd, [{ id: '', label: t('无项目') }, ...(s.projectOptions ?? []).map((p: any) => ({ id: typeof p === 'string' ? p : p.cwd, label: typeof p === 'string' ? p : p.name || p.cwd }))], 'newchat.project'));
  else items.push(...[['pin', t(c.active?.isPinned ? '取消置顶' : '置顶')], ['duplicate', t('复制会话')], ['rename', t('重命名')], ['archive', t('归档')]].map(([action, label]) => nativeAction(`thread:${action}`, label, 'workspace.thread', { action })));
  if (c.active?.id) items.push(text('thread-id', t('对话线程：'), c.active.id), text('thread-cwd', t('目录：'), c.active.cwd || t('无项目')));
  const context = contextUsageView(s.tokenUsage); if (context) items.push(text('context-remaining', t('上下文：'), t('剩余 {remaining}%（已用 {used} / {total}）', { remaining: Math.round(context.remainingPercent), used: context.used, total: context.total })));
  const usage = s.tokenUsage; if (usage) {
   for (const [part, label] of [['total', t('累计用量')], ['last', t('本轮用量')]]) {
    const u = usage[part]; if (u) items.push(text(`usage:${part}`, label, `${u.totalTokens ?? 0} tokens · ${t('输入')} ${u.inputTokens ?? 0} · ${t('输出')} ${u.outputTokens ?? 0} · ${t('缓存')} ${u.cachedInputTokens ?? 0} · ${t('推理')} ${u.reasoningOutputTokens ?? 0}`));
   }
   if (usage.modelContextWindow) items.push(text('context-window', t('上下文窗口'), usage.modelContextWindow));
  }
  const sevenDay = sevenDayRateLimitView(s.rateLimits); if (sevenDay) items.push(text('seven-day-remaining', t('7 天额度'), `${Math.round(sevenDay.remainingPercent)}% ${t('剩余')}`));
  const limits = s.rateLimits?.rateLimits ?? s.rateLimits;
  for (const part of ['primary', 'secondary']) if (limits?.[part]) items.push(text(`limits:${part}`, part === 'primary' ? t('主要额度') : t('长期额度'), `${limits[part].usedPercent ?? 0}% · ${limits[part].windowDurationMins ?? ''} min · ${t('重置')} ${limits[part].resetsAt ? new Date(limits[part].resetsAt * 1000).toLocaleString() : ''}`));
  if (s.pendingAction || c.pending) items.push(text('pending', t('待处理操作'), s.pendingAction ? t(({ rename: '正在重命名', archive: '正在归档', duplicate: '正在复制会话', pin: '正在更新置顶状态', refresh: '正在刷新' } as Record<string, string>)[s.pendingAction] || '等待确认') : t('等待确认')));
  if (s.activeThreadResumeError) items.push(text('resume-error', t('恢复失败'), s.activeThreadResumeError));
  result = { id, title: t('会话设置'), items };
 } else if (id === 'thread-rename') result = { id, title: t('重命名'), items: [ { id: 'thread-name', kind: 'textField', title: t('名称'), value: panel.query, command: nativeCommand('workspace.rename.change') }, nativeAction('rename-submit', t('保存'), 'workspace.rename.submit') ] };
 else if (request && (id === 'approval' || (!id && request))) {
  const items: NativePanelItem[] = [];
  const threadId = String(request.params?.threadId ?? '');
  if (threadId) items.push(text('approval-thread-id', t('对话线程：'), threadId));
  if (s.approvalThreadTitle) items.push(text('approval-thread-title', t('会话'), s.approvalThreadTitle));
  if (s.approvalError) items.push(text('approval-error', t('提交失败'), s.approvalError));
  if (disabled) items.push(text('approval-pending', t('正在提交，请等待确认…'), ''));
  if (request.method === 'item/tool/requestUserInput') {
   for (const q of questions) {
    const children: NativePanelItem[] = [text(`${q.id}:prompt`, q.header, q.question)];
    if (q.options?.length) {
     const custom = panel.customAnswers?.has(`${requestKey}:${q.id}`) || (!!answers[q.id] && !q.options.some(o => o.label === answers[q.id]));
     children.push(choice(`${q.id}:options`, q.header, custom ? 'other' : answers[q.id] ? `option:${q.options.findIndex(o => o.label === answers[q.id])}` : '', [{ id: '', label: t('请选择') }, ...q.options.map((o, index) => ({ id: `option:${index}`, label: o.label, description: o.description })), ...(q.isOther ? [{ id: 'other', label: t('其他（自行填写）') }] : [])], 'approval.answer', { requestKey, questionId: q.id, choice: true }));
    }
    if (!q.options?.length || q.isOther) children.push({ id: `${q.id}:answer`, kind: q.isSecret ? 'secureField' : 'multilineField', title: t(q.options?.length ? '自定义回答' : '回答'), value: answers[q.id] ?? '', command: nativeCommand('approval.answer', { requestKey, questionId: q.id, custom: true }), disabled });
    items.push({ id: q.id, kind: 'section', title: q.header, children: children.map(child => ({ ...child, disabled })) });
   }
   items.push({ ...nativeAction('approval-submit', t('提交回答'), 'approval.submit', { requestKey }), disabled: disabled || !questionResponse(request, answers) }, { ...nativeAction('approval-dismiss', t('稍后回答'), 'approval.dismiss', { requestKey }), disabled });
  } else {
   const p = request.params ?? {};
   for (const [field, label] of [['reason', t('原因')], ['command', t('命令')], ['cwd', t('工作目录')], ['grantRoot', t('请求写入目录')]]) if (p[field]) items.push({ ...text(`approval:${field}`, label, p[field]), kind: field === 'command' ? 'code' : 'text' });
   if (p.networkApprovalContext) items.push(text('network', t('网络目标'), `${p.networkApprovalContext.protocol}://${p.networkApprovalContext.host}`));
   const perms = p.permissions ?? p.additionalPermissions;
   if (perms?.network?.enabled != null) items.push(text('permissions:network', t('网络访问'), t(perms.network.enabled ? '允许联网' : '禁用联网')));
   for (const access of ['read', 'write']) if (perms?.fileSystem?.[access]) items.push(text(`permissions:${access}`, t(access === 'read' ? '读取路径' : '写入路径'), perms.fileSystem[access].join('\n')));
   for (const [index, entry] of (perms?.fileSystem?.entries ?? []).entries()) items.push(text(`permissions:entry:${index}`, entry.access, entry.path.path ?? entry.path.pattern ?? JSON.stringify(entry.path.value)));
   items.push(...approvalDecisions(request).map((decision, index) => ({ ...nativeAction(`approval-decision:${index}`, decisionLabel(decision), 'approval.decide', { requestKey, index }), value: JSON.stringify(decision), disabled })));
  }
  result = { id: `approval:${requestKey}`, dismissible: request.method === 'item/tool/requestUserInput' && !disabled, title: t(request.method === 'item/tool/requestUserInput' ? 'Codex 需要你的回答' : '需要你的确认'), items };
 } else if (edit && historyMessage && id === 'confirm-history') {
  result = { id: `confirm-history:${key}`, dismissible: !edit.submitting, title: t('确认修改历史消息'), items: [
   text('history-warning', t('修改并重新发送将删除此消息之后的对话'), `${edit.target.rollbackTurnCount} ${t('轮对话')} · ${t('文件修改、已执行命令和远端操作不会撤销。')}`),
   { ...nativeAction('history-confirm', t('确认并发送'), 'history.submit', { ...historyParams, confirmed: true }), disabled: edit.submitting },
   { ...nativeAction('history-back', t('返回编辑'), 'panel.open', { id: 'history-edit' }), disabled: edit.submitting },
  ] };
 } else if (id?.startsWith('confirm-queue:')) {
  const queued = c.queued.find(q => `confirm-queue:${q.id}` === id);
  if (queued) result = { id, title: t('确认移除'), items: [text('queue-warning', t('这条消息可能已发送。移除待确认记录不会撤销已发送的任务，确定移除吗？'), queued.text), nativeAction('queue-confirm', t('确定移除'), 'queue.cancel', { id: queued.id, confirmed: true })] };
 } else if (id?.startsWith('queue-edit:')) {
  const queued = c.queued.find(q => `queue-edit:${q.id}` === id);
  if (queued) result = { id, title: t('编辑排队消息'), items: [...(queued.attachmentCount ? [text('queue-attachments', t('{count} 个附件会保留', { count: queued.attachmentCount }), '')] : []), { id: 'queue-text', kind: 'multilineField', title: t('消息'), value: panel.query, command: nativeCommand('queue.change', { id: queued.id }) }, nativeAction('queue-save', t('保存'), 'queue.edit', { id: queued.id })] };
 }
 const currentRequest = (p: any) => { const live = cb.currentApproval ? cb.currentApproval() : { request, submitting: disabled }; if (!live?.request || p.requestKey !== approvalKey(live.request) || live.submitting) throw new Error(t('审批请求已变化或正在提交')); return live.request; };
 const currentEdit = (p: any, requireTarget = true) => { const live = cb.currentHistoryEdit ? cb.currentHistoryEdit() : edit; if (!live || p.editKey !== historyEditKey(live) || (p.turnId != null && p.turnId !== live.target.turnId) || (p.messageId != null && p.messageId !== live.target.messageId) || live.submitting) throw new Error(t('编辑消息已变化或正在提交')); if (requireTarget && !historyMessage) throw new Error(t('目标消息已变化，请取消编辑后重新选择')); return live; };
 const select = (values: any[], value: unknown) => { const match = values.find(o => String(o.id ?? '') === value); if (!match) throw new Error(t('选项不可用')); return match; };
 const submitApproval = async (response: unknown) => {
  if (!cb.replyToRequest) throw new Error(t('尚未连接 app-server'));
  const result = await cb.replyToRequest(response);
  if (result === false || result?.ok === false) throw new Error(result?.error || t('提交结果尚未确认，请保留回答'));
 };
 const handlers: NativeHandlers = {
  'speed.select': p => cb.chooseSpeed?.(select(s.speedOptions ?? [], p.value).id),
  'permission.select': p => cb.choosePermissionMode?.(select(s.permissionModes ?? [], p.value).id),
  'newchat.backend': p => { if (c.active?.id || !(s.backends ?? []).some((b: any) => b.enabled && b.id === p.value)) throw new Error(t('设备不可用')); return cb.switchNewChatBackend?.(p.value); },
  'newchat.project': p => { if (c.active?.id || (p.value !== '' && !(s.projectOptions ?? []).some((v: any) => (typeof v === 'string' ? v : v.cwd) === p.value))) throw new Error(t('项目不可用')); return cb.chooseNewChatProject?.(String(p.value)); },
  'workspace.thread': p => { if (!c.active?.id) throw new Error(t('会话不可用')); const action = { pin: cb.togglePinned, duplicate: cb.duplicateActiveThread, archive: cb.archiveThread }[String(p.action)]; if (p.action === 'rename') return panel.setPanel('thread-rename'); if (!action) throw new Error(t('会话操作无效')); return action(); },
  'approval.answer': p => {
   const r = currentRequest(p); const q: InputQuestion | undefined = (r.params?.questions ?? []).find((v: InputQuestion) => v.id === p.questionId);
   if (!q) throw new Error(t('回答选项无效'));
   if (p.choice === true && p.value === 'other' && q.isOther) { panel.setCustomAnswer?.(`${p.requestKey}:${q.id}`, true); cb.answerApproval?.(q.id, ''); return; }
   const chosen = p.choice === true && p.value !== '' ? q.options?.[Number(String(p.value).replace(/^option:/, ''))]?.label : String(p.value);
   if (typeof chosen !== 'string' || (q.options?.length && !q.isOther && chosen !== '' && !q.options.some(o => o.label === chosen))) throw new Error(t('回答选项无效'));
   panel.setCustomAnswer?.(`${p.requestKey}:${q.id}`, p.custom === true && !!q.isOther); cb.answerApproval?.(q.id, chosen);
  },
  'approval.decide': p => { const r = currentRequest(p); if (!Number.isSafeInteger(p.index)) throw new Error(t('审批决定无效')); const decision = approvalDecisions(r)[Number(p.index)]; if (decision === undefined) throw new Error(t('审批决定无效')); const response = approvalResponse(r, decision); if (!response) throw new Error(t('审批决定无效')); return submitApproval(response); },
  'approval.submit': p => { const r = currentRequest(p); const response = questionResponse(r, cb.currentApproval?.()?.answers ?? answers); if (!response) throw new Error(t('请回答所有问题后提交。')); return submitApproval(response); },
  'approval.dismiss': p => { currentRequest(p); cb.dismissApproval?.(); panel.setPanel(null); },
  'approval.reopen': () => { cb.reopenApproval?.(); panel.setPanel('approval'); },
  'history.change': p => { currentEdit(p); cb.changeHistoricalMessageEditText?.(String(p.value)); },
  'history.cancel': p => { currentEdit(p, false); cb.cancelHistoricalMessageEdit?.(); panel.setPanel(null); },
  'history.submit': p => { const e = currentEdit(p); if (!p.confirmed && !e.reverted && e.target.hasLaterTurns) return panel.setPanel('confirm-history'); panel.setPanel(null); return cb.submitHistoricalMessageEdit?.(); },
 };
 return { panel: result, historyEdit, historyMessage, actions, handlers, accepts: value => ['workspace', 'permission', 'model', 'effort', 'speed', 'approval', 'history-edit', 'thread-rename'].includes(value) || value.startsWith('queue-edit:') };
}
