type RecordValue = Record<string, any>;
type ChangeStats = { additions: number; deletions: number };

function diffLineStats(diff: string): ChangeStats {
  let additions = 0; let deletions = 0; let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) inHunk = false;
    if (line.startsWith("@@")) inHunk = true;
    if (line.startsWith("+") && (inHunk || !line.startsWith("+++"))) additions++;
    if (line.startsWith("-") && (inHunk || !line.startsWith("---"))) deletions++;
  }
  return { additions, deletions };
}

function summarizeChanges(turn: RecordValue): ChangeStats {
  if (typeof turn.liveDiff === "string" && turn.liveDiff.length) return diffLineStats(turn.liveDiff);
  const stats = { additions: 0, deletions: 0 }; let hasFileDiff = false;
  for (const item of turn.items ?? []) {
    if (item.type !== "fileChange") continue;
    for (const change of item.changes ?? []) {
      if (change.diff) hasFileDiff = true;
      const diff = diffLineStats(change.diff ?? "");
      stats.additions += diff.additions; stats.deletions += diff.deletions;
    }
  }
  return !hasFileDiff && turn.loadedChangeStats
    ? { additions: turn.loadedChangeStats.additions, deletions: turn.loadedChangeStats.deletions }
    : stats;
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
export function compactTurnDetails(result: RecordValue) {
  return {
    data: (result.data ?? []).map((turn: RecordValue) => ({
      id: turn.id, loadedChangeStats: summarizeChanges(turn), items: imageReferences(turn.items ?? []),
    })),
    nextCursor: result.nextCursor,
  };
}
