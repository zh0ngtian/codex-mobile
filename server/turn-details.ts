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
      };
    }),
    nextCursor: result.nextCursor,
  };
}
