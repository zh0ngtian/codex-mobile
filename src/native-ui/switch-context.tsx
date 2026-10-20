import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { saveBackendRegistry } from '../backends/registry';
import type { BackendRegistry } from '../backends/types';
import { nativeSwitchStore, restoreSwitchWorkspace, type SavedSwitchCheckpoint, type SwitchWorkspace } from './switch-store';
import { emptyNativeSnapshot } from './protocol';
import { publishNativeSnapshot } from './runtime';
import { isIOSNativeHost, requestNativePreference } from './preference';
interface SwitchState {
 enabled: boolean; loading: boolean; pending: boolean; error: string; notice: string;
 change(enabled: boolean): Promise<void>;
 workspaces: Map<string, SwitchWorkspace>; restored: Map<string, SwitchWorkspace>;
 registry: { current: BackendRegistry };
 changed(): void;
}
const SwitchContext = createContext<SwitchState | null>(null);
export const useNativeSwitch = () => useContext(SwitchContext);
export function NativeSwitchBoundary({ initialRegistry, children }: { initialRegistry: BackendRegistry; children: (registry: BackendRegistry) => ReactNode }) {
 const supported = isIOSNativeHost();
 const [loaded, setLoaded] = useState(!supported);
 const [failure, setFailure] = useState(''); const [attempt, retry] = useState(0);
 const [checkpoint, setCheckpoint] = useState<SavedSwitchCheckpoint | null>(null);
 const [restored, setRestored] = useState(new Map<string, SwitchWorkspace>());
 useEffect(() => {
  if (!supported) return;
  let cancelled = false; setFailure('');
  void nativeSwitchStore.load().then(async saved => {
   if (cancelled) return;
   if (saved) {
    for (const [key, value] of Object.entries(saved.storage)) window.localStorage.setItem(key, value);
    saveBackendRegistry(window.localStorage, saved.registry);
   }
   const workspaces = new Map<string, SwitchWorkspace>();
   try { for (const workspace of saved?.workspaces ?? []) workspaces.set(workspace.backendId, restoreSwitchWorkspace(workspace)); }
   catch (reason) { for (const workspace of workspaces.values()) workspace.files.forEach(file => URL.revokeObjectURL(file.previewUrl)); throw reason; }
   // 消费成功后才挂载业务，避免与新一轮保存交错删除。
   try { if (saved) await nativeSwitchStore.remove(); }
   catch (reason) { for (const workspace of workspaces.values()) workspace.files.forEach(file => URL.revokeObjectURL(file.previewUrl)); throw reason; }
   if (!cancelled) { setRestored(workspaces); setCheckpoint(saved); setLoaded(true); }
  }).catch(reason => { if (!cancelled) setFailure(`无法恢复界面切换检查点：${reason instanceof Error ? reason.message : String(reason)}`); });
  return () => { cancelled = true; };
 }, [supported, attempt]);
 useEffect(() => {
  if (!failure) return;
  publishNativeSnapshot({ ...emptyNativeSnapshot(), ready: true, title: '恢复界面切换检查点', error: failure,
   panel: { id: 'native-switch-recovery', title: '恢复草稿', dismissible: false, items: [
    { id: 'error', kind: 'text', text: failure },
    { id: 'retry', kind: 'action', title: '重试恢复', command: { name: 'navigation.refresh', params: {} } },
   ] } });
  const listener = (event: Event) => { if ((event as CustomEvent).detail?.name === 'navigation.refresh') retry(value => value + 1); };
  window.addEventListener('codex-mobile-native-command', listener);
  return () => window.removeEventListener('codex-mobile-native-command', listener);
 }, [failure]);
 if (failure) return <main className="app-shell"><p role="alert">{failure}</p><button onClick={() => retry(value => value + 1)}>重试恢复</button></main>;
 if (!loaded) return <main className="app-shell"><p role="status">正在恢复界面切换检查点…</p></main>;
 if (!supported) return <>{children(initialRegistry)}</>;
 return <SwitchProvider initialRegistry={checkpoint?.registry ?? initialRegistry} restored={restored} checkpoint={checkpoint}>{children(checkpoint?.registry ?? initialRegistry)}</SwitchProvider>;
}
function SwitchProvider({ initialRegistry, checkpoint, restored, children }: { initialRegistry: BackendRegistry; checkpoint: SavedSwitchCheckpoint | null; restored: Map<string, SwitchWorkspace>; children: ReactNode }) {
 const [enabled, setEnabled] = useState(false); const [loading, setLoading] = useState(true);
 const [pending, setPending] = useState(false); const inFlight = useRef(false);
 const [error, setError] = useState(''); const [notice, setNotice] = useState('');
 const armed = useRef(false); const syncing = useRef(false); const dirty = useRef(false); const disposed = useRef(false); const previousSignature = useRef('');
 const [state] = useState(() => ({ workspaces: new Map<string, SwitchWorkspace>(), restored, registry: { current: initialRegistry } }));
 useEffect(() => {
  let cancelled = false; disposed.current = false;
  void requestNativePreference().then(value => { if (!cancelled) setEnabled(value.enabled); }).catch(reason => { if (!cancelled) setError(String(reason)); }).finally(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; disposed.current = true; };
 }, [checkpoint]);
 const capture = () => {
  const storage: Record<string, string> = {};
  const keys = new Set(['codex-mobile:language', 'codex-mobile:font-size', 'codex-mobile:notification-preference', 'codex-mobile:transport-mode', 'codex-mobile:list-backend', 'codex-mobile:new-chat-backend', 'codex-mobile:collapsed-projects']);
  const prefixes = ['codex-mobile:new-chat-project:', 'codex-mobile:new-chat-model-settings:v1:', 'codex-mobile:pinned:', 'codex-mobile:unread:', 'codex-mobile:projectless-threads:'];
  for (let index = 0; index < localStorage.length; index++) { const key = localStorage.key(index); if (key && (keys.has(key) || prefixes.some(prefix => key.startsWith(prefix)))) storage[key] = localStorage.getItem(key)!; }
  return { version: 1 as const, registry: state.registry.current, storage, workspaces: [...state.workspaces.values()] };
 };
 const changed = () => {
  if (!armed.current || disposed.current) return;
  let signature: string;
  try { signature = JSON.stringify(capture()); }
  catch (reason) { setError(`无法更新界面切换检查点：${String(reason)}`); return; }
  if (signature === previousSignature.current) return;
  previousSignature.current = signature; dirty.current = true;
  if (syncing.current) return;
  syncing.current = true;
  void (async () => {
   try { while (dirty.current && !disposed.current) { dirty.current = false; await nativeSwitchStore.save(capture()); } }
   catch (reason) { previousSignature.current = ''; setError(`无法更新界面切换检查点：${reason instanceof Error ? reason.message : String(reason)}`); }
   finally { syncing.current = false; }
  })();
 };
 useLayoutEffect(() => { changed(); });
 useEffect(() => {
  // 设置表单内部状态也可能独立提交，交互完成后捕获白名单内的最新设置。
  const interaction = () => queueMicrotask(changed);
  for (const name of ['input', 'change', 'click', 'pagehide', 'visibilitychange']) window.addEventListener(name, interaction);
  return () => { for (const name of ['input', 'change', 'click', 'pagehide', 'visibilitychange']) window.removeEventListener(name, interaction); };
 });
 const changePreference = async (next: boolean) => {
  if (inFlight.current) throw new Error('界面设置正在保存，请稍后重试');
  inFlight.current = true; setPending(true); setError(''); setNotice('');
  const wasArmed = armed.current; armed.current = false;
  let previous: SavedSwitchCheckpoint | null = null; let wrote = false;
  try {
   // 等待已有同步结束，随后本次保存、commit与回滚均保持顺序。
   while (syncing.current) await new Promise(resolve => setTimeout(resolve, 5));
   previous = await nativeSwitchStore.load();
   await nativeSwitchStore.save(capture()); wrote = true;
   const saved = await requestNativePreference({ enabled: next });
   armed.current = true; setEnabled(saved.enabled); setNotice('下次完整启动 App 时生效');
   previousSignature.current = ''; changed();
  } catch (reason) {
   if (wrote) {
    try { await nativeSwitchStore.restore(previous); }
    catch (rollback) { reason = new Error(`${String(reason)}；无法撤销检查点：${String(rollback)}`); }
   }
   armed.current = wasArmed;
   const message = reason instanceof Error ? reason.message : String(reason); setError(`无法保存界面设置：${message}`); throw reason;
  } finally { inFlight.current = false; setPending(false); }
 };
 return <SwitchContext.Provider value={{ ...state, enabled, loading, pending, error, notice, change: changePreference, changed }}>{children}{error && <p role="alert">{error}</p>}</SwitchContext.Provider>;
}
export function useSwitchWorkspace(backendId: string, value: SwitchWorkspace) {
 const state = useNativeSwitch();
 useLayoutEffect(() => { state?.workspaces.set(backendId, value); state?.changed(); });
 useLayoutEffect(() => () => { state?.workspaces.delete(backendId); }, [state?.workspaces, backendId]);
 return state?.restored.get(backendId);
}
export function useSwitchRegistry(registry: BackendRegistry, enabled = true) {
 const state = useNativeSwitch();
 useLayoutEffect(() => { if (state && enabled) { state.registry.current = registry; state.changed(); } });
}
