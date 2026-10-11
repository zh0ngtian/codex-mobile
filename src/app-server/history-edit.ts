import { AppServerRpcError } from "./client";
import { stripConversationTitleRequest } from "./conversation-title";

type AnyRecord = Record<string, any>;

export type HistoricalUserInput = AnyRecord & { type: string };

export interface HistoricalMessageEditTarget {
  turnId: string;
  messageId: string;
  text: string;
  input: HistoricalUserInput[];
  primaryTextIndex: number;
  precedingInputCount: number;
  precedingMessageCount: number;
  rollbackTurnCount: number;
  hasLaterTurns: boolean;
  attachmentCount: number;
}

function isRunningStatus(status: unknown) {
  return ["inProgress", "in_progress", "running"].includes(String(status));
}

function uploadedFileText(text: string) {
  return /^(?:已上传文件：|Uploaded file:)[\s\S]*\n(?:本机路径：|Host path:|Local path:)/.test(
    text,
  );
}

function isAttachmentInput(part: HistoricalUserInput) {
  return ["image", "localImage", "audio", "localAudio"].includes(part.type) ||
    (part.type === "text" && uploadedFileText(String(part.text ?? "")));
}

function normalizeUserInput(item: AnyRecord): HistoricalUserInput[] {
  if (Array.isArray(item.content)) {
    return item.content
      .filter((part: unknown): part is AnyRecord => Boolean(part && typeof part === "object"))
      .map((part) =>
        part.type === "text"
          ? {
              ...part,
              text: stripConversationTitleRequest(
                typeof part.text === "string" ? part.text : "",
              ),
              text_elements: Array.isArray(part.text_elements)
                ? [...part.text_elements]
                : [],
            }
          : { ...part },
      ) as HistoricalUserInput[];
  }
  const text = typeof item.text === "string"
    ? stripConversationTitleRequest(item.text)
    : typeof item.content === "string"
      ? stripConversationTitleRequest(item.content)
      : "";
  return text
    ? [{ type: "text", text, text_elements: [] }]
    : [];
}

export function createHistoricalMessageEditTarget(
  turns: AnyRecord[],
  turnId: string,
  selectedMessageId?: string,
): HistoricalMessageEditTarget | null {
  const turnIndex = turns.findIndex((turn) => String(turn.id ?? "") === turnId);
  if (turnIndex < 0 || !turnId || turnId.startsWith("pending-")) return null;
  const turn = turns[turnIndex];
  if (isRunningStatus(turn.status)) return null;
  const userMessages = (Array.isArray(turn.items) ? turn.items : []).filter(
    (item: AnyRecord) => item.type === "userMessage",
  );
  const messageIndex = selectedMessageId == null
    ? 0
    : userMessages.findIndex((item: AnyRecord) => String(item.id ?? "") === selectedMessageId);
  const message = userMessages[messageIndex];
  if (!message) return null;
  const messageId = String(message.id ?? "");
  if (!messageId || messageId.startsWith("local-")) return null;
  const precedingInput = userMessages.slice(0, messageIndex).flatMap(normalizeUserInput);
  const messageInput = normalizeUserInput(message);
  const messageTextIndex = messageInput.findIndex(
    (part) => part.type === "text" && !uploadedFileText(String(part.text ?? "")),
  );
  const input = [...precedingInput, ...messageInput];
  const primaryTextIndex = messageTextIndex < 0 ? -1 : precedingInput.length + messageTextIndex;
  const text = messageTextIndex >= 0
    ? String(messageInput[messageTextIndex].text ?? "")
    : "";
  return {
    turnId,
    messageId,
    text,
    input,
    primaryTextIndex,
    precedingInputCount: precedingInput.length,
    precedingMessageCount: messageIndex,
    rollbackTurnCount: turns.length - turnIndex,
    hasLaterTurns: turnIndex < turns.length - 1 || messageIndex < userMessages.length - 1,
    attachmentCount: input.filter(isAttachmentInput).length,
  };
}

export function buildEditedHistoryInput(
  target: HistoricalMessageEditTarget,
  text: string,
): HistoricalUserInput[] {
  const input: HistoricalUserInput[] = target.input.map((part) =>
    part.type === "text"
      ? { ...part, text_elements: [] }
      : part.type === "image" && typeof part.url === "string" && /^(?:\/|[a-z]:[\\/])/i.test(part.url)
        ? { type: "localImage", path: part.url }
        : { ...part },
  );
  if (target.primaryTextIndex >= 0) {
    if (text) {
      input[target.primaryTextIndex] = {
        ...input[target.primaryTextIndex],
        type: "text",
        text,
        text_elements: [],
      };
    } else {
      input.splice(target.primaryTextIndex, 1);
    }
  } else if (text) {
    input.splice(target.precedingInputCount, 0, { type: "text", text, text_elements: [] });
  }
  // 不能把清空目标消息误当作只重发同轮此前输入。
  return input.length > target.precedingInputCount ? input : [];
}

interface HistoryEditRequester {
  request(method: string, params: unknown): Promise<unknown>;
}

export async function revertHistoricalMessage(
  requester: HistoryEditRequester,
  threadId: string,
  target: HistoricalMessageEditTarget,
) {
  try {
    const response = await requester.request("thread/revert", {
      threadId,
      beforeTurnId: target.turnId,
    });
    return { method: "thread/revert" as const, response };
  } catch (reason) {
    if (!(reason instanceof AppServerRpcError) || reason.code !== -32601) {
      throw reason;
    }
  }
  const response = await requester.request("thread/rollback", {
    threadId,
    numTurns: target.rollbackTurnCount,
  });
  return { method: "thread/rollback" as const, response };
}
