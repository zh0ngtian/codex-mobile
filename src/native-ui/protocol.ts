/** v1 仅包含可序列化的展示数据；禁止传递 BackendConfig 或客户端对象。 */
export type NativeParams = Record<string, unknown>;
export interface NativeCommand { id?: string; name: string; params: NativeParams }
export interface NativeOption { id: string; title: string; value: string; subtitle?: string }
export interface NativePanelItem {
  id: string; kind: string; title?: string; text?: string; value?: string; previewURL?: string; values?: string[];
  options?: NativeOption[]; command?: NativeCommand; children?: NativePanelItem[]; disabled?: boolean;
}
export interface NativeNavigationItem { id: string; title: string; subtitle?: string; badge?: string; selected?: boolean; command?: NativeCommand; actions?: NativePanelItem[] }
export interface NativeGroup { id: string; title: string; items: NativeNavigationItem[]; command?: NativeCommand; actions?: NativePanelItem[]; collapsed?: boolean }
export interface NativeMessage { id: string; role: string; text: string; status?: string; blocks?: NativePanelItem[]; actions?: NativePanelItem[] }
export interface NativeAttachment { id: string; name: string; detail?: string; imageURL?: string }
export interface NativeResult { id: string; name: string; ok: boolean; contextId?: string; error?: string; fieldKey?: string; fieldRevision?: number }
export interface NativeSnapshot {
  version: 1; ready: boolean; locale: string; fontScale: number; title: string;
  threadId?: string; backendId?: string; contextId?: string; draftRevision?: number; caretOffset?: number;
  connection: string; busy: boolean; draft: string; canSend: boolean; readOnly: boolean;
  backends: Array<{ id: string; title: string; subtitle?: string; connected?: boolean }>;
  groups: NativeGroup[]; messages: NativeMessage[]; attachments: NativeAttachment[]; queued: NativeNavigationItem[];
  approvalCount: number; model: string; effort: string; models: NativeOption[]; efforts: NativeOption[];
  error?: string; badge?: string; panel?: { id: string; title: string; items: NativePanelItem[]; dismissible?: boolean };
  commandResults?: NativeResult[]; sidebarOpen?: boolean; search?: string; loading?: string;
  canInterrupt?: boolean; conversationActions?: NativePanelItem[]; permission?: string; pending?: boolean; mentions?: NativeOption[];
}
export function emptyNativeSnapshot(): NativeSnapshot {
  return { version: 1, ready: false, locale: 'zh-CN', fontScale: 1, title: 'Codex Mobile', connection: 'disconnected', busy: false,
    draft: '', canSend: false, readOnly: false, backends: [], groups: [], messages: [], attachments: [], queued: [], approvalCount: 0,
    model: '模型', effort: '推理强度', models: [], efforts: [] };
}
export type NativeHandler = (params: NativeParams) => unknown | Promise<unknown>;
export type NativeHandlers = Partial<Record<string, NativeHandler>>;
export interface NativeNavigation { selectedBackendId: string; backends: NativeSnapshot['backends']; groups: NativeGroup[]; sidebarOpen?: boolean; search?: string; error?: string }
