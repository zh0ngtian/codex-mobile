import type { MessageReference } from '../../server/user-message-format';
import type { MessageQuote, QuoteSource } from '../features/conversation/message-quotes';
/** v1 仅包含可序列化的展示数据；禁止传递 BackendConfig 或客户端对象。 */
export type NativeParams = Record<string, unknown>;
export interface NativeCommand { id?: string; name: string; params: NativeParams }
export interface NativeOption { id: string; title: string; value: string; subtitle?: string; efforts?: NativeOption[]; defaultEffort?: string }
export interface NativePanelItem {
  id: string; kind: string; title?: string; text?: string; value?: string; previewURL?: string; values?: string[];
  line?: number; options?: NativeOption[]; command?: NativeCommand; children?: NativePanelItem[]; disabled?: boolean;
}
export interface NativeNavigationItem { id: string; title: string; subtitle?: string; badge?: string; selected?: boolean; command?: NativeCommand; actions?: NativePanelItem[];
  backendId?: string; threadId?: string; cwd?: string; isPinned?: boolean; isUnread?: boolean; running?: boolean; timestamp?: number;
  inputText?: string; queueState?: string; attachmentCount?: number; revision?: number; error?: string; attachments?: NativeAttachment[]; configuration?: NativeQueueConfiguration }
export interface NativeGroup { id: string; title: string; items: NativeNavigationItem[]; command?: NativeCommand; actions?: NativePanelItem[]; collapsed?: boolean;
  category?: 'pinned' | 'project' | 'recent' | 'search'; subtitle?: string; loading?: string; newCommand?: NativeCommand;
  backendId?: string; cwd?: string; hasMore?: boolean; allItems?: NativeNavigationItem[] }
export interface NativeCommentaryEntry { quoteSource?: QuoteSource; id: string; text: string; timestamp?: number; blocks?: NativePanelItem[]; isPreviousReply?: boolean }
export interface NativeMessage { rawText?: string; references?: MessageReference[]; quoteSource?: QuoteSource; id: string; role: string; text: string; activityKind?: 'tool' | 'reasoning' | 'plan'; status?: string; blocks?: NativePanelItem[]; actions?: NativePanelItem[]; timestamp?: number; historyEdit?: NativeSnapshot['panel']; turnId?: string; itemId?: string; phase?: string;
  /** 独立于分组turn前缀的展示锚点，不用于真实业务动作。 */
  scrollAnchorId?: string;
  /** 仅历史与工具聚合行提供成员别名，以便前插成员后恢复旧锚点。 */
  scrollAnchorIds?: string[];
  /** 新界面使用语义条目；旧v1界面继续读取commentaryBlockId指向的disclosure。 */
  commentary?: NativeCommentaryEntry[]; commentaryBlockId?: string;
  /** 连续历史可归入紧随final；旧回答保留原消息身份，同时以isPreviousReply条目收入过程。 */
  commentaryCanAttachToReply?: boolean;
  /** 仅所属逻辑回合仍在运行时展开过程，不借用整个会话的busy状态。 */
  commentaryIsRunning?: boolean;
  /** 由normalized原始顺序确定当前运行turn的连续commentary尾段，不能按Native工具汇总位置猜测。 */
  commentaryIsLiveTail?: boolean }
export interface NativeAttachment { id: string; name: string; detail?: string; imageURL?: string; type?: string; command?: NativeCommand; size?: number }
export interface NativeBackend { id: string; title: string; subtitle?: string; connected?: boolean; gatewayAddress?: string; enabled?: boolean;
  connectionState?: string; projects?: string[]; approvalCount?: number; queuedCount?: number }
export interface NativeSettingsPreferences { language?: string; transportMode?: string; fontSize?: string; notificationMode?: string; barkConfigured?: boolean }
export interface NativeTokenUsage { lastRequestTokens?: number; modelContextWindow?: number; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningOutputTokens?: number }
export interface NativeQueueConfiguration { model?: string; effort?: string; serviceTier?: string; permission?: string }
export interface NativeResult { id: string; name: string; ok: boolean; value?: string; contextId?: string; error?: string; fieldKey?: string; fieldRevision?: number }
export interface NativeSnapshot {
  quotes?: MessageQuote[]; quoteFocusToken?: string;
  sidechatActive?: boolean; sidechatParentId?: string; sidechatActions?: NativePanelItem[];
  version: 1; ready: boolean; locale: string; fontScale: number; title: string;
  threadId?: string; backendId?: string; cwd?: string; contextId?: string; draftRevision?: number; caretOffset?: number;
  connection: string; busy: boolean; draft: string; canSend: boolean; readOnly: boolean;
  backends: NativeBackend[];
  groups: NativeGroup[]; messages: NativeMessage[]; attachments: NativeAttachment[]; queued: NativeNavigationItem[];
  approvalCount: number; model: string; effort: string; models: NativeOption[]; efforts: NativeOption[];
  richContent?: NativePanelItem[];
  error?: string; badge?: string; panel?: { id: string; title: string; items: NativePanelItem[]; dismissible?: boolean };
  /** 会话列表首查进度，独立于详情loading；旧快照缺省时由ready兼容。 */
  navigationLoading?: boolean;
  commandResults?: NativeResult[]; sidebarOpen?: boolean; search?: string; loading?: string;
  olderTurnsState?: string;
  canInterrupt?: boolean; conversationActions?: NativePanelItem[]; permission?: string; pending?: boolean; mentions?: NativeOption[];
  projectName?: string; backendName?: string; listBackendId?: string;
  modelValue?: string; effortValue?: string; speed?: string; speedValue?: string; speeds?: NativeOption[];
  permissionValue?: string; permissions?: NativeOption[];
  contextUsage?: { used: number; total: number; usedPercent: number; remainingPercent: number };
  inputTokenUsage?: string; outputTokenUsage?: string; inputCacheHitPercent?: number;
  fiveHourRateLimit?: { remainingPercent: number; resetsAt?: number; windowDurationMins?: number };
  sevenDayRateLimit?: { remainingPercent: number; resetsAt?: number; windowDurationMins?: number };
  tokenUsage?: NativeTokenUsage; preferences?: NativeSettingsPreferences; approvalPanel?: NativeSnapshot['panel'];
}
export function emptyNativeSnapshot(): NativeSnapshot {
  return { version: 1, ready: false, locale: 'zh-CN', fontScale: 1, title: 'Codex Mobile', connection: 'disconnected', busy: false,
    draft: '', canSend: false, readOnly: false, backends: [], groups: [], messages: [], attachments: [], queued: [], approvalCount: 0,
    model: '模型', effort: '推理强度', models: [], efforts: [] };
}
export type NativeHandler = (params: NativeParams) => unknown | Promise<unknown>;
export type NativeHandlers = Partial<Record<string, NativeHandler>>;
export interface NativeNavigation { selectedBackendId: string; listBackendId?: string; backends: NativeSnapshot['backends']; groups: NativeGroup[]; navigationLoading?: boolean; sidebarOpen?: boolean; search?: string; error?: string; preferences?: NativeSettingsPreferences }
