import { transportUuid } from '../backends/http-transport';
export interface NativePreferenceInput { enabled?: boolean }
export interface NativePreference { enabled: boolean; active: boolean }
type PreferenceResponse = Partial<NativePreference> & { id: string; error?: string };
type HostWindow = Window & {
 __CODEX_IOS_HOST__?: boolean;
 webkit?: { messageHandlers?: { nativeUI?: { postMessage(value: unknown): void } } };
 codexMobileNativePreference?: (input: NativePreferenceInput) => Promise<NativePreference>;
 codexMobileNativePreferenceComplete?: (response: PreferenceResponse) => void;
};
const pending = new Map<string, { resolve: (value: NativePreference) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
export function isIOSNativeHost() {
 if (typeof window === 'undefined') return false;
 const host = window as HostWindow;
 return host.__CODEX_IOS_HOST__ === true && typeof host.webkit?.messageHandlers?.nativeUI?.postMessage === 'function';
}
/** 宿主只接收可信主文档消息；此处不更改本进程冻结的 __CODEX_NATIVE_UI__。 */
export function requestNativePreference(input: NativePreferenceInput = {}): Promise<NativePreference> {
 if (!isIOSNativeHost()) return Promise.reject(new Error('当前环境不支持原生界面设置'));
 const host = window as HostWindow;
 host.codexMobileNativePreference = requestNativePreference;
 host.codexMobileNativePreferenceComplete = response => {
  const request = pending.get(response.id); if (!request) return;
  pending.delete(response.id); clearTimeout(request.timer);
  if (response.error) request.reject(new Error(response.error));
  else if (typeof response.enabled !== 'boolean' || typeof response.active !== 'boolean') request.reject(new Error('原生界面设置响应无效'));
  else request.resolve({ enabled: response.enabled, active: response.active });
 };
 return new Promise((resolve, reject) => {
  const id = transportUuid();
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('保存原生界面设置超时，请重试')); }, 15000);
  pending.set(id, { resolve, reject, timer });
  try { host.webkit!.messageHandlers!.nativeUI!.postMessage({ type: 'nativePreference', id, ...input }); }
  catch (reason) { pending.delete(id); clearTimeout(timer); reject(reason); }
 });
}
