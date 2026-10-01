interface ProjectlessThreadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storageKey(backendId: string) {
  return `codex-mobile:projectless-threads:${backendId}`;
}

export function readLocalProjectlessThreadIds(
  storage: Pick<ProjectlessThreadStorage, "getItem">,
  backendId: string,
) {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(backendId)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (threadId): threadId is string =>
        typeof threadId === "string" && Boolean(threadId.trim()),
    );
  } catch {
    return [];
  }
}

export function writeLocalProjectlessThreadIds(
  storage: Pick<ProjectlessThreadStorage, "setItem">,
  backendId: string,
  threadIds: string[],
) {
  storage.setItem(storageKey(backendId), JSON.stringify([...new Set(threadIds)]));
}

export function mergeProjectlessThreadIds(...threadIdGroups: string[][]) {
  return [...new Set(threadIdGroups.flat())];
}
