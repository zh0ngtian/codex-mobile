import { countCompleteDiff } from "./turn-change-history.js";
type RecordValue = Record<string, any>;
type ChangeStats = { additions: number; deletions: number };

function summarizeChanges(turn: RecordValue): ChangeStats | null {
  if (turn.changeStatsUnavailable) return null;
  const diff = turn.liveDiff ?? turn.diff;
  if (typeof diff === "string") return countCompleteDiff(diff);
  const stats = { additions: 0, deletions: 0 };
  let hasFileDiff = false;
  let missingDiff = false;
  for (const item of turn.items ?? []) {
    if (item.type !== "fileChange") continue;
    for (const change of item.changes ?? []) {
      if (typeof change.diff !== "string" || change.diff.endsWith("\n[truncated]")) {
        missingDiff = true;
        continue;
      }
      const diff = countCompleteDiff(change.diff);
      if (!diff) { missingDiff = true; continue; }
      hasFileDiff = true;
      stats.additions += diff.additions;
      stats.deletions += diff.deletions;
    }
  }
  if (missingDiff) return null;
  if (hasFileDiff) return stats;
  if (turn.loadedChangeStats && !turn.changeStatsUnavailable) return turn.loadedChangeStats;
  if (turn.changeStatsUnavailable || turn.itemsView === "summary" || (turn.items ?? []).some((item: RecordValue) =>
    ["commandExecution", "mcpToolCall", "dynamicToolCall", "subAgentActivity", "collabToolCall", "collabAgentToolCall", "fileChange"].includes(item.type),
  )) return null;
  return stats;
}

function imageReferences(items: RecordValue[]): RecordValue[] {
  return items.filter((item) =>
    (item.type === "imageView" && typeof item.path === "string" && item.path) ||
    (item.type === "imageGeneration" && [item.savedPath, item.result].some((value) =>
      typeof value === "string" && /^(data:|\/)/i.test(value))),
  ).map((item) => {
    const hasFileReference = [item.path, item.savedPath, item.result].some((value) =>
      typeof value === "string" && /^(https?:|\/)/i.test(value));
    return {
      id: item.id, type: item.type, backfilled: true,
      ...(typeof item.path === "string" && item.path ? { path: item.path } : {}),
      ...(typeof item.savedPath === "string" && item.savedPath ? { savedPath: item.savedPath } : {}),
      ...(typeof item.result === "string" && /^(https?:|data:|\/)/i.test(item.result) &&
        !(hasFileReference && /^data:/i.test(item.result)) ? { result: item.result } : {}),
    };
  });
}

function messageTimestamp(item: RecordValue) {
  return typeof item.timestamp === "number" && Number.isFinite(item.timestamp) && item.timestamp > 0
    ? { timestamp: item.timestamp } : {};
}

function orderedMessageIds(items: RecordValue[]): string[] {
  return items.filter((item) => ["userMessage", "agentMessage", "imageView", "imageGeneration", "videoGeneration"].includes(item.type) &&
    typeof item.id === "string" && !!item.id).map((item) => item.id);
}

function commentaryDetails(items: RecordValue[]) {
  const commentaryItems = items.filter((item) => item.type === "agentMessage" && item.phase === "commentary" &&
    typeof item.id === "string" && typeof item.text === "string")
    .map((item) => ({ id: item.id, type: item.type, phase: item.phase, text: item.text, ...messageTimestamp(item) }));
  // final 和用户消息只传顺序锚点，正文/附件继续使用首屏摘要或实时数据。
  const messageOrder = orderedMessageIds(items);
  return { ...(commentaryItems.length ? { commentaryItems } : {}), ...(messageOrder.length ? { messageOrder } : {}) };
}

// Whitelist only the details needed for history backfill; never retain tool bodies or diffs.
export function compactTurnDetails(result: RecordValue, savedStats: Record<string, ChangeStats | null> = {}) {
  return {
    data: (result.data ?? []).map((turn: RecordValue) => {
      const stats = savedStats[String(turn.id)] ?? summarizeChanges(turn);
      return {
        id: turn.id,
        ...(stats ? { loadedChangeStats: { additions: stats.additions, deletions: stats.deletions },
          ...(savedStats[String(turn.id)] ? { changeStatsSource: "history" } : {}) }
          : { changeStatsUnavailable: true }),
        items: imageReferences(turn.items ?? []),
        ...commentaryDetails(turn.items ?? []),
      };
    }),
    nextCursor: result.nextCursor,
  };
}


export function validTurnCommentaryParams(params: any): boolean {
  return !!params && !Array.isArray(params) &&
    typeof params.threadId === "string" && !!params.threadId.trim() &&
    typeof params.turnId === "string" && !!params.turnId.trim();
}

export function turnCommentaryRequest(params: RecordValue) {
  return { method: "thread/turns/list", params: {
    threadId: params.threadId, limit: 1, sortDirection: "desc", itemsView: "full",
  } };
}

// 用户文字作为插话位置锚点；附件与工具正文不进入回填响应。
export function compactTurnCommentary(result: RecordValue, turnId: string) {
  const turn = (result.data ?? []).find((entry: RecordValue) => entry.id === turnId);
  const items: RecordValue[] = [];
  let messageOrder: string[] | undefined;
  if (turn && ["inProgress", "in_progress", "running"].includes(turn.status) &&
    !(turn.items ?? []).some((item: RecordValue) => item.type === "agentMessage" && item.phase === "final_answer")) {
    messageOrder = orderedMessageIds(turn.items ?? []);
    for (const item of turn.items ?? []) {
      if (typeof item.id !== "string" || !item.id) continue;
      if (item.type === "agentMessage" && item.phase === "commentary" && typeof item.text === "string") {
        items.push({ id: item.id, type: item.type, phase: item.phase, text: item.text, ...messageTimestamp(item) });
      } else if (item.type === "userMessage") {
        items.push({ id: item.id, type: item.type,
          ...(typeof item.text === "string" ? { text: item.text } : {}),
          ...(Array.isArray(item.content) ? { content: item.content
            .filter((part: RecordValue) => part.type === "text" && typeof part.text === "string")
            .map((part: RecordValue) => ({ type: "text", text: part.text })) } : {}),
        });
      }
    }
  }
  return { turnId, items, ...(messageOrder ? { messageOrder } : {}) };
}
