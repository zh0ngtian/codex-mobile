import { AppServerRpcError } from "./client";

type AnyRecord = Record<string, any>;

export type HistoricalUserInput = AnyRecord & { type: string };

export interface HistoricalMessageEditTarget {
  turnId: string;
  messageId: string;
  text: string;
  input: HistoricalUserInput[];
  primaryTextIndex: number;
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
              text: typeof part.text === "string" ? part.text : "",
              text_elements: Array.isArray(part.text_elements)
                ? [...part.text_elements]
                : [],
            }
          : { ...part },
      ) as HistoricalUserInput[];
  }
  const text = typeof item.text === "string"
    ? item.text
    : typeof item.content === "string"
      ? item.content
      : "";
  return text
    ? [{ type: "text", text, text_elements: [] }]
    : [];
}

export function createHistoricalMessageEditTarget(
  turns: AnyRecord[],
  turnId: string,
): HistoricalMessageEditTarget | null {
  const turnIndex = turns.findIndex((turn) => String(turn.id ?? "") === turnId);
  if (turnIndex < 0 || !turnId || turnId.startsWith("pending-")) return null;
  const turn = turns[turnIndex];
  if (isRunningStatus(turn.status)) return null;
  const userMessages = (Array.isArray(turn.items) ? turn.items : []).filter(
    (item: AnyRecord) => item.type === "userMessage",
  );
  if (userMessages.length !== 1) return null;
  const message = userMessages[0];
  const messageId = String(message.id ?? "");
  if (!messageId || messageId.startsWith("local-")) return null;
  const input = normalizeUserInput(message);
  const primaryTextIndex = input.findIndex(
    (part) => part.type === "text" && !uploadedFileText(String(part.text ?? "")),
  );
  const text = primaryTextIndex >= 0
    ? String(input[primaryTextIndex].text ?? "")
    : "";
  return {
    turnId,
    messageId,
    text,
    input,
    primaryTextIndex,
    rollbackTurnCount: turns.length - turnIndex,
    hasLaterTurns: turnIndex < turns.length - 1,
    attachmentCount: input.filter(isAttachmentInput).length,
  };
}

export function buildEditedHistoryInput(
  target: HistoricalMessageEditTarget,
  text: string,
): HistoricalUserInput[] {
  const input = target.input.map((part) =>
    part.type === "text"
      ? { ...part, text_elements: [] }
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
    input.unshift({ type: "text", text, text_elements: [] });
  }
  return input;
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
