/** 仅由本机DEBUG宿主显式开启；记录阶段和数量，不记录正文、地址或凭据。 */
type ProfileWindow = Window & { __CODEX_LOAD_PROFILE__?: boolean; webkit?: { messageHandlers?: { nativeUI?: { postMessage: (value: unknown) => void } } } };
type Active = { id: string; threadId: string; readySent: boolean };
export type LoadRpcProfile = { id: string; method: string; started: number; request: number };
let active: Active | undefined;
let rpcSequence = 0;
function enabled() { return typeof window !== 'undefined' && (window as ProfileWindow).__CODEX_LOAD_PROFILE__ === true; }
function emit(id: string, phase: string, data: Record<string, string | number | boolean> = {}) {
  if (!enabled()) return;
  (window as ProfileWindow).webkit?.messageHandlers?.nativeUI?.postMessage({ type: 'loadProfile', id, phase, wallMs: performance.timeOrigin + performance.now(), data });
}
export function beginLoadProfile(id: string, threadId: string) {
  if (!enabled()) return;
  active = { id, threadId, readySent: false };
  emit(id, 'js-command');
}
export function markLoadProfile(threadId: string, phase: string, data: Record<string, string | number | boolean> = {}) {
  if (active?.threadId === threadId) emit(active.id, phase, data);
}
export function startLoadRpc(method: string, params: unknown): LoadRpcProfile | undefined {
  if (!enabled() || !active || (params as {threadId?: string})?.threadId !== active.threadId || !['thread/resume', 'thread/read', 'thread/turns/list', 'thread/items/list', 'mobile/turns/details', 'mobile/turns/commentary'].includes(method)) return;
  const value = { id: active.id, method, started: performance.now(), request: ++rpcSequence };
  emit(value.id, 'rpc-start', { method, request: value.request });
  return value;
}
export function endLoadRpc(value: LoadRpcProfile | undefined, ok: boolean) {
  if (value) emit(value.id, 'rpc-end', { method: value.method, request: value.request, ok, durationMs: performance.now() - value.started });
}
export function profileReadySnapshot(value: {threadId?: string | null; loading?: string; messages: Array<{text?: string; role?: string}>}) {
  if (!enabled() || !active || value.threadId !== active.threadId || value.loading !== 'ready' || active.readySent) return;
  active.readySent = true;
  emit(active.id, 'js-ready-snapshot', { messages: value.messages.length, textChars: value.messages.reduce((n, m) => n + (m.text?.length ?? 0), 0) });
}
