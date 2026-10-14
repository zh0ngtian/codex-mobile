import { t } from '../i18n';
import { emptyNativeSnapshot, type NativeHandlers, type NativeNavigation, type NativeSnapshot, type NativeResult, type NativeParams } from './protocol';

type NativeWindow = Window & { __CODEX_NATIVE_UI__?: boolean; webkit?: { messageHandlers?: { nativeUI?: { postMessage: (value: unknown) => void } } }; codexMobilePublishNativeSnapshot?: (snapshot: NativeSnapshot) => void };
export function isNativeUIEnabled() {
  if (typeof window === 'undefined') return false;
  const target = window as NativeWindow;
  return target.__CODEX_NATIVE_UI__ === true && typeof target.webkit?.messageHandlers?.nativeUI?.postMessage === 'function';
}
const globalNames = new Set(['backend.select', 'navigation.search', 'navigation.sidebar', 'navigation.refresh', 'thread.new', 'thread.open', 'thread.manage', 'project.toggle', 'project.more', 'project.retry', 'navigation.filter']);
const workspaceNames = new Set(['draft.set', 'draft.save', 'message.send', 'turn.stop', 'model.select', 'effort.select', 'attachment.pick', 'attachment.remove', 'location.insert', 'mention.search', 'mention.insert', 'thread.retry', 'thread.older', 'message.edit', 'message.copy', 'queue.cancel', 'queue.send', 'queue.edit']);
// Task2b 只能经此处显式扩展可调用命令，不能把任意名字转发成 RPC。
const panelNames = new Set(['panel.open', 'panel.close']);
const stringKeys: Record<string, string[]> = {
  'draft.set': ['value', 'contextId'], 'model.select': ['value'], 'effort.select': ['value'], 'attachment.pick': ['kind'],
  'attachment.remove': ['id'], 'backend.select': ['id'], 'navigation.search': ['value'], 'thread.open': ['backendId', 'threadId'],
  'thread.manage': ['backendId', 'threadId', 'action'], 'project.toggle': ['backendId', 'cwd'], 'project.more': ['backendId', 'cwd'],
  'project.retry': ['backendId', 'cwd'], 'navigation.filter': ['value'], 'mention.search': ['value'], 'mention.insert': ['id'],
  'panel.open': ['id'], 'panel.close': ['id'], 'message.edit': ['turnId', 'messageId'], 'message.copy': ['id'],
  'queue.cancel': ['id'], 'queue.send': ['id'], 'queue.edit': ['id', 'value'],
};
function validate(name: string, params: NativeParams) {
  if (![globalNames, workspaceNames, panelNames].some(set => set.has(name))) throw new Error(t('不支持的原生命令'));
  for (const key of stringKeys[name] ?? []) if (typeof params[key] !== 'string') throw new Error(t("参数 {key} 必须是字符串", { key }));
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
  private workspaces = new Map<string, Workspace>();
  private results: NativeResult[] = [];
  private requests = new Map<string, Promise<NativeResult>>();
  private inFlight = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private commandError?: string;
  private listening = false;
  constructor(private publish: (snapshot: NativeSnapshot) => void) {}
  get listenerCount() { return this.listening ? 1 : 0; }
  private listener = (event: Event) => { if (isNativeUIEnabled()) void this.dispatch((event as CustomEvent).detail); };
  listen() {
    if (this.listening) return;
    this.disposed = false;
    this.listening = true; window.addEventListener('codex-mobile-native-command', this.listener);
  }
  setNavigation(value: NativeNavigation, handlers: NativeHandlers = {}) {
    this.navigation = value; this.globalHandlers = handlers; this.schedule();
  }
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
    return { ...(workspace?.value ?? emptyNativeSnapshot()), backends: this.navigation.backends,
      groups: this.navigation.groups.map(group => ({ ...group, items: group.items.map(item => item.command?.name === 'thread.open' ? { ...item,
        selected: item.command.params.backendId === this.navigation.selectedBackendId && item.command.params.threadId === workspace?.value.threadId } : item) })),
      sidebarOpen: this.navigation.sidebarOpen, search: this.navigation.search,
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
      const workspace = this.workspaces.get(this.navigation.selectedBackendId);
      const globalHandler = this.globalHandlers[name];
      const handler = globalNames.has(name) ? globalHandler : panelNames.has(name) ? (globalHandler ?? workspace?.handlers[name]) : workspace?.handlers[name];
      if (!globalNames.has(name) && !(panelNames.has(name) && globalHandler)) {
        if (!workspace?.value.ready) throw new Error(t('会话尚未就绪'));
        if (typeof params.contextId !== 'string' || params.contextId !== workspace.value.contextId) throw new Error(t('会话已切换，请重试'));
        if (workspace.value.readOnly && !['message.copy', 'thread.retry', 'thread.older', 'panel.open', 'panel.close'].includes(name)) throw new Error(t('当前会话只读'));
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
        await handler(params);
      }
      return { ...base, ok: true };
    } catch (error) { return { ...base, error: error instanceof Error ? error.message : String(error) }; }
  }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    window.removeEventListener('codex-mobile-native-command', this.listener); this.listening = false;
    this.workspaces.clear(); this.globalHandlers = {};
  }
}
export function publishNativeSnapshot(snapshot: NativeSnapshot) {
  if (!isNativeUIEnabled()) return;
  const target = window as NativeWindow;
  if (target.codexMobilePublishNativeSnapshot) target.codexMobilePublishNativeSnapshot(snapshot);
  else target.webkit!.messageHandlers!.nativeUI!.postMessage({ type: 'snapshot', snapshot });
}
