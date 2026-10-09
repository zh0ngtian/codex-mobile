import { extractGeneratedTitle, stripConversationTitleRequest } from "../../app-server/conversation-title";
import { stripGitDirectives, toolActivityRowLabel } from "../../ui/conversation";
import { t } from "../../i18n";

export interface NativeConversationRow {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  detail?: string;
  turnId?: string;
  messageId?: string;
  timestamp?: string;
  rich?: boolean;
}
export interface NativeConversationAction {
  contextId: string;
  sequence: number;
  type: string;
  text?: string;
  id?: string;
  cursor?: number;
}
export interface NativeConversationSnapshot {
  version: 1;
  locale: string;
  isNewChat: boolean;
  contextId: string;
  title: string;
  subtitle: string;
  draft: string;
  draftCursor: number | null;
  draftCursorSequence: number | null;
  enabled: boolean;
  sendEnabled: boolean;
  sendLabel: string;
  busy: boolean;
  error: string;
  status: string;
  loadState: string;
  olderTurnsState: string;
  fontSize: number;
  rows: NativeConversationRow[];
  attachments: Array<{ id: string; name: string; kind: "image" | "file"; url?: string }>;
  mentions: Array<{ id: string; label: string; description: string }>;
  projects: Array<{ id: string; label: string }>;
  backends: Array<{ id: string; label: string }>;
  selectedProject: string;
  selectedBackendId: string;
  settingsLabel: string;
  queued: Array<{ id: string; text: string; failed: boolean }>;
}

function timestamp(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : undefined;
}

/** 保留真实 item/turn 身份；原生投影不改变 app-server 的业务数据。 */
export function nativeConversationRows(turns: Array<Record<string, any>>): NativeConversationRow[] {
  return turns.flatMap((turn, turnIndex) => (turn.items ?? []).map((item: Record<string, any>, index: number) => {
    const turnId = String(turn.id ?? `turn-${turnIndex}`);
    const messageId = String(item.id ?? `item-${index}`);
    const id = `${turnId}:${messageId}`;
    if (item.type === "userMessage" || item.type === "agentMessage") {
      let text = Array.isArray(item.content)
        ? item.content.filter((part: any) => part.type === "text").map((part: any) => part.text ?? "").join("\n")
        : String(item.text ?? item.content ?? "");
      const user = item.type === "userMessage";
      text = user ? stripConversationTitleRequest(text) : stripGitDirectives(extractGeneratedTitle(text).text);
      const media = Array.isArray(item.content) && item.content.some((part: any) => part.type !== "text");
      return {
        id, turnId, messageId, role: user ? "user" as const : "assistant" as const,
        text: text || (media ? t("附件消息") : ""),
        timestamp: timestamp(user ? turn.startedAt : item.phase === "final_answer" ? turn.completedAt : undefined),
        rich: media || /```|!\[|\[[^\]]*\]\(|\|.+\||<\/?[a-z]/i.test(text),
      };
    }
    const command = Array.isArray(item.command) ? item.command.join(" ") : item.command;
    const text = command || toolActivityRowLabel(item) || String(item.type ?? t("活动"));
    // 未识别的新 item 也保留完整内容，避免原生客户端静默丢失协议扩展。
    const detail = [item.text, item.aggregatedOutput, item.output, item.diff]
      .filter((value) => typeof value === "string" && value).join("\n\n") || JSON.stringify(item, null, 2);
    return { id, turnId, messageId, role: "tool" as const, text, detail,
      rich: ["imageView", "imageGeneration", "fileChange"].includes(item.type) };
  }));
}

export function nativeConversationHandler() {
  const runtime = window as Window & {
    __codexNativeConversationReady?: boolean;
    webkit?: { messageHandlers?: { nativeConversation?: { postMessage: (message: unknown) => void } } };
  };
  return runtime.__codexNativeConversationReady ? runtime.webkit?.messageHandlers?.nativeConversation : undefined;
}
