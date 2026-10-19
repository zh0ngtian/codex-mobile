import { beginLoadProfile, profileReadySnapshot } from '../diagnostics/conversation-load-profile';
import { flushSync } from 'react-dom';
import { getActiveLocale, t } from '../i18n';
import { FONT_SCALES, readFontSize } from '../ui/font-size';
import { validateNativeAttachmentImport } from './attachment-import';
import { emptyNativeSnapshot, type NativeHandlers, type NativeNavigation, type NativeSnapshot, type NativeResult, type NativeParams } from './protocol';

type NativeWindow = Window & { __CODEX_NATIVE_UI__?: boolean; __CODEX_NATIVE_UI_RECOVERED__?: boolean; webkit?: { messageHandlers?: { nativeUI?: { postMessage: (value: unknown) => void } } }; codexMobilePublishNativeSnapshot?: (snapshot: NativeSnapshot) => void };
export function isNativeUIEnabled() {
  if (typeof window === 'undefined') return false;
  const target = window as NativeWindow;
  return target.__CODEX_NATIVE_UI__ === true && target.__CODEX_NATIVE_UI_RECOVERED__ !== true && typeof target.webkit?.messageHandlers?.nativeUI?.postMessage === 'function';
}
export const isNativeBridgeEnabled = isNativeUIEnabled;
const globalNames = new Set(['settings.native-ui', 'backend.select', 'navigation.search', 'navigation.sidebar', 'navigation.refresh', 'thread.new', 'thread.open', 'thread.manage', 'project.toggle', 'project.more', 'project.retry', 'navigation.filter', 'confirmation.answer', 'settings.open', 'drafts.open', 'device.add', 'device.edit', 'device.change', 'device.save', 'device.cancel', 'device.scan', 'device.toggle', 'device.remove', 'device.move', 'settings.language', 'settings.font', 'settings.transport', 'settings.push.mode', 'settings.push.url', 'settings.push.save', 'settings.update.check', 'drafts.restore', 'drafts.remove', 'drafts.retry', 'update.install', 'update.retry', 'update.close']);
const workspaceNames = new Set(['draft.set', 'draft.save', 'message.send', 'turn.stop', 'model.select', 'effort.select', 'attachment.import', 'attachment.pick', 'attachment.preview', 'attachment.remove', 'location.insert', 'mention.search', 'mention.insert', 'thread.retry', 'thread.older', 'message.edit', 'message.copy', 'queue.cancel', 'queue.send', 'queue.edit', 'speed.select', 'permission.select', 'newchat.backend', 'newchat.project', 'workspace.thread', 'workspace.rename.change', 'workspace.rename.submit', 'approval.answer', 'approval.decide', 'approval.submit', 'approval.dismiss', 'approval.reopen', 'history.change', 'history.cancel', 'history.submit', 'queue.change', 'file.open', 'file.mode', 'diagram.render']);
// Task2b 只能经此处显式扩展可调用命令，不能把任意名字转发成 RPC。
const panelNames = new Set(['panel.open', 'panel.close']);
const stringKeys: Record<string, string[]> = {
  'confirmation.answer': ['key'],
  'draft.set': ['value', 'contextId'], 'model.select': ['value'], 'effort.select': ['value'], 'attachment.pick': ['kind'],
  'attachment.preview': ['id'], 'attachment.remove': ['id'], 'backend.select': ['id'], 'navigation.search': ['value'], 'thread.open': ['backendId', 'threadId'],
  'thread.manage': ['backendId', 'threadId', 'action'], 'project.toggle': ['backendId', 'cwd'], 'project.more': ['backendId', 'cwd'],
  'project.retry': ['backendId', 'cwd'], 'navigation.filter': ['value'], 'mention.search': ['value'], 'mention.insert': ['id'],
  'panel.open': ['id'], 'panel.close': ['id'], 'message.edit': ['turnId', 'messageId'], 'message.copy': ['id'],
  'queue.cancel': ['id'], 'queue.send': ['id'], 'queue.edit': ['id'], 'queue.change': ['id', 'value'],
  'speed.select': ['value'], 'permission.select': ['value'], 'newchat.backend': ['value'], 'newchat.project': ['value'],
  'workspace.thread': ['action'], 'workspace.rename.change': ['value'], 'approval.answer': ['requestKey', 'questionId', 'value'],
  'approval.decide': ['requestKey'], 'approval.submit': ['requestKey'], 'approval.dismiss': ['requestKey'],
  'history.change': ['editKey', 'value'], 'history.cancel': ['editKey'], 'history.submit': ['editKey'],
  'device.edit': ['id'], 'device.change': ['field', 'value'], 'device.toggle': ['id'], 'device.remove': ['id'], 'device.move': ['id'],
  'settings.language': ['value'], 'settings.font': ['value'], 'settings.transport': ['value'], 'settings.push.mode': ['value'], 'settings.push.url': ['value'],
  'drafts.restore': ['id'], 'drafts.remove': ['id'], 'file.open': ['href'], 'file.mode': ['value'], 'diagram.render': ['source'],
};
function validate(name: string, params: NativeParams) {
  if (name === 'attachment.import') validateNativeAttachmentImport(params.items);
  if (name === 'settings.native-ui' && typeof params.enabled !== 'boolean') throw new Error(t('原生界面设置无效'));
  if (name === 'thread.new' && (params.backendId !== undefined || params.cwd !== undefined) && (typeof params.backendId !== 'string' || typeof params.cwd !== 'string')) throw new Error(t('项目目标无效'));
  if (![globalNames, workspaceNames, panelNames].some(set => set.has(name))) throw new Error(t('不支持的原生命令'));
  for (const key of stringKeys[name] ?? []) if (typeof params[key] !== 'string') throw new Error(t("参数 {key} 必须是字符串", { key }));
  if (params.confirmed !== undefined && typeof params.confirmed !== 'boolean') throw new Error(t('确认参数无效'));
  if (name === 'approval.decide' && (!Number.isSafeInteger(params.index) || Number(params.index) < 0)) throw new Error(t('审批决定无效'));
  if (name === 'device.move' && ![-1, 1].includes(Number(params.direction))) throw new Error(t('排序方向无效'));
  if (name === 'device.cancel' && params.testOnly !== undefined && typeof params.testOnly !== 'boolean') throw new Error(t('取消测试参数无效'));
  if (name === 'draft.set' && (!Number.isSafeInteger(params.revision) || Number(params.revision) < 1)) throw new Error(t('草稿版本无效'));
  if (name === 'draft.set' && params.caretOffset !== undefined && (!Number.isSafeInteger(params.caretOffset) || Number(params.caretOffset) < 0 || Number(params.caretOffset) > String(params.value).length)) throw new Error(t('草稿版本无效'));
  if (name === 'navigation.sidebar' && typeof params.open !== 'boolean') throw new Error(t('侧栏状态无效'));
  if (name === 'attachment.pick' && !['photos', 'files'].includes(String(params.kind))) throw new Error(t('附件类型无效'));
  if (name === 'thread.manage' && !['pin', 'refresh', 'duplicate', 'rename', 'archive'].includes(String(params.action))) throw new Error(t('会话操作无效'));
  if (params.fieldRevision !== undefined && (!Number.isSafeInteger(params.fieldRevision) || Number(params.fieldRevision) < 1 || typeof params.fieldKey !== 'string')) throw new Error(t('字段版本无效'));
}
interface Workspace { value: NativeSnapshot; handlers: NativeHandlers; revision: number; echo?: string; echoCaret?: number }
/** 每个 JS runtime 对应唯一 WK scene，保留已有 React / transport 为唯一业务拥有者。 */
export class NativeRuntime {
  private navigation: NativeNavigation = { selectedBackendId: '', backends: [], groups: [] };
  private globalHandlers: NativeHandlers = {};
  private globalPanels = new Map<string, { panel: NativeSnapshot['panel']; handlers: NativeHandlers }>();
  private workspaces = new Map<string, Workspace>();
  private results: NativeResult[] = [];
  private requests = new Map<string, Promise<NativeResult>>();
  private inFlight = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private commandError?: string;
  private listening = false;
  constructor(private publish: (snapshot: NativeSnapshot) => void, private commandSucceeded?: (result: NativeResult) => void) {}
  get listenerCount() { return this.listening ? 1 : 0; }
  private listener = (event: Event) => { if (isNativeBridgeEnabled()) void this.dispatch((event as CustomEvent).detail); };
  listen() {
    if (this.listening) return;
    this.disposed = false;
    this.listening = true; window.addEventListener('codex-mobile-native-command', this.listener);
  }
  setNavigation(value: NativeNavigation, handlers: NativeHandlers = {}) {
    this.navigation = value; this.globalHandlers = handlers; this.schedule();
  }
  setGlobalPanel(id: string, panel: NativeSnapshot['panel'], handlers: NativeHandlers) { if (panel && this.globalPanels.get(id)?.panel?.id !== panel.id) this.globalPanels.delete(id); this.globalPanels.set(id, { panel, handlers: panel ? handlers : {} }); this.schedule(); }
  removeGlobalPanel(id: string) { this.globalPanels.delete(id); this.schedule(); }
  setWorkspace(id: string, value: NativeSnapshot, handlers: NativeHandlers) {
    const previous = this.workspaces.get(id);
    const same = previous !== undefined && previous.value.contextId === value.contextId;
    if (same) {
      // 保留执行中的命令所引用的对象；React每次render只更新其权威快照与最新callbacks。
      previous.value = value;
      previous.handlers = handlers;
      if (value.draftRevision === undefined ? previous.echo === value.draft : value.draftRevision >= previous.revision) previous.echo = undefined;
    } else this.workspaces.set(id, { value, handlers, revision: 0 });
    this.schedule();
  }
  removeWorkspace(id: string) { this.workspaces.delete(id); this.schedule(); }
  snapshot(): NativeSnapshot {
    const workspace = this.workspaces.get(this.navigation.selectedBackendId);
    const globalPanel = [...this.globalPanels.values()].filter(v => v.panel).at(-1)?.panel;
    return { ...(workspace?.value ?? emptyNativeSnapshot()), locale: getActiveLocale(), fontScale: FONT_SCALES[readFontSize()], ...(globalPanel ? { ready: true, panel: globalPanel } : {}), backends: this.navigation.backends,
      groups: this.navigation.groups.map(group => {
        const select = (item: typeof group.items[number]) => item.command?.name === 'thread.open' ? { ...item,
          selected: item.command.params.backendId === this.navigation.selectedBackendId && item.command.params.threadId === workspace?.value.threadId } : item;
        return { ...group, items: group.items.map(select), allItems: group.allItems?.map(select) };
      }),
      navigationLoading: this.navigation.navigationLoading, sidebarOpen: this.navigation.sidebarOpen, search: this.navigation.search, listBackendId: this.navigation.listBackendId,
      preferences: this.navigation.preferences ? { ...this.navigation.preferences, fontSize: readFontSize() } : undefined,
      draftRevision: workspace?.revision ?? 0, ...(workspace?.echo !== undefined ? { draft: workspace.echo, caretOffset: workspace.echoCaret ?? workspace.echo.length } : {}),
      commandResults: [...this.results], error: this.commandError || workspace?.value.error || this.navigation.error || undefined };
  }
  private schedule() {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => { this.timer = undefined; if (!this.disposed) this.publish(this.snapshot()); }, 32);
  }
  dispatch(raw: unknown): Promise<NativeResult> {
    const input = raw as { id?: unknown; name?: unknown; params?: unknown } | null;
    const id = typeof input?.id === 'string' ? input.id : '';
    if (id && this.requests.has(id)) return this.requests.get(id)!;
    // 永不逐个 await 网络，停止和继续输入与发送请求独立推进。
    let resolve!: (value: NativeResult) => void;
    const result = new Promise<NativeResult>(done => { resolve = done; });
    if (id) { this.requests.set(id, result); this.inFlight.add(id); }
    void this.execute(input).then(value => {
      // 原生设置可能只更新局部组件；命令成功后显式捕获检查点中的最新设置。
      if (value.ok) this.commandSucceeded?.(value);
      this.inFlight.delete(id); this.results = [...this.results, value].slice(-64);
      const currentContext = this.workspaces.get(this.navigation.selectedBackendId)?.value.contextId;
      if (!value.contextId || value.contextId === currentContext) this.commandError = value.ok ? undefined : value.error;
      for (const key of this.requests.keys()) {
        if (this.requests.size <= 256) break;
        if (!this.inFlight.has(key)) this.requests.delete(key);
      }
      this.schedule(); resolve(value);
    });
    return result;
  }
  private async execute(input: { id?: unknown; name?: unknown; params?: unknown } | null): Promise<NativeResult> {
    const id = typeof input?.id === 'string' ? input.id : '';
    const name = typeof input?.name === 'string' ? input.name : '';
    const params = input?.params as NativeParams;
    const base: NativeResult = { id, name, ok: false, ...(typeof params?.contextId === 'string' ? { contextId: params.contextId } : {}),
      ...(typeof params?.fieldKey === 'string' ? { fieldKey: params.fieldKey, fieldRevision: Number(params.fieldRevision) } : {}) };
    try {
      if (this.disposed) throw new Error(t('原生业务桥已关闭'));
      if (!id || id.length > 200 || !params || Array.isArray(params) || typeof params !== 'object') throw new Error(t('命令格式无效'));
      if (this.inFlight.size > 64) throw new Error(t('待处理命令过多，请稍后重试'));
      validate(name, params);
      if (name === 'thread.open') beginLoadProfile(id, String(params.threadId));
      const workspace = this.workspaces.get(this.navigation.selectedBackendId);
      const globalPanelAlias = name === 'panel.open' && ['devices', 'settings', 'language', 'font', 'transport', 'notifications', 'updates', 'drafts'].includes(String(params.id));
      const aliasHandler = globalPanelAlias ? this.globalHandlers[params.id === 'drafts' ? 'drafts.open' : 'settings.open'] : undefined;
      const registeredPanel = name === 'panel.close' ? [...this.globalPanels.values()].find(v => v.panel?.id === params.id) : [...this.globalPanels.values()].reverse().find(v => v.handlers[name]);
      const globalHandler = aliasHandler ?? registeredPanel?.handlers[name] ?? this.globalHandlers[name];
      const handler = globalNames.has(name) ? globalHandler : panelNames.has(name) ? (globalHandler ?? workspace?.handlers[name]) : workspace?.handlers[name];
      if (!globalNames.has(name) && !(panelNames.has(name) && globalHandler)) {
        if (!workspace?.value.ready) throw new Error(t('会话尚未就绪'));
        if (typeof params.contextId !== 'string' || params.contextId !== workspace.value.contextId) throw new Error(t('会话已切换，请重试'));
        if (workspace.value.readOnly && !['message.copy', 'attachment.preview', 'thread.retry', 'thread.older', 'panel.open', 'panel.close', 'history.change', 'history.cancel', 'history.submit', 'approval.answer', 'approval.decide', 'approval.submit', 'approval.dismiss', 'approval.reopen', 'file.open', 'file.mode', 'diagram.render'].includes(name)) throw new Error(t('当前会话只读'));
      }
      if (!handler) throw new Error(t("此操作尚未接入：{name}", { name }));
      if (name === 'draft.set' && workspace) {
        if (Number(params.revision) <= workspace.revision) throw new Error(t('草稿版本已过期'));
        // 在执行callback前占用版本；同一轮React flush或旧异步完成均不能倒退。
        workspace.revision = Number(params.revision); workspace.echo = String(params.value); workspace.echoCaret = typeof params.caretOffset === "number" ? params.caretOffset : String(params.value).length;
        try { await handler(params); }
        catch (error) {
          if (workspace.revision === Number(params.revision)) workspace.echo = undefined;
          throw error;
        }
      } else {
        if (workspace && ['message.send', 'mention.insert', 'location.insert'].includes(name)) workspace.echo = undefined;
        if (params.fieldRevision !== undefined) {
          // Swift在ACK后释放本地输入保护，必须先完成React提交和layout投影注册。
          // 仅同步调用handler；其返回的异步工作仍在flushSync之外等待。
          let pending: unknown;
          flushSync(() => { pending = handler(params); });
          await pending;
        } else await handler(params);
      }
      return { ...base, ok: true };
    } catch (error) { return { ...base, error: error instanceof Error ? error.message : String(error) }; }
  }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    window.removeEventListener('codex-mobile-native-command', this.listener); this.listening = false;
    this.workspaces.clear(); this.globalHandlers = {}; this.globalPanels.clear();
  }
}
export function publishNativeSnapshot(snapshot: NativeSnapshot) {
  if (!isNativeBridgeEnabled()) return;
  profileReadySnapshot(snapshot);
  const target = window as NativeWindow;
  if (target.codexMobilePublishNativeSnapshot) target.codexMobilePublishNativeSnapshot(snapshot);
  else target.webkit!.messageHandlers!.nativeUI!.postMessage({ type: 'snapshot', snapshot });
}
