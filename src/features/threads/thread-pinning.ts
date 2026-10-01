interface ThreadPinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type ThreadRecord = Record<string, any>;

function storageKey(backendId: string) {
  return `codex-mobile:pinned:${backendId}`;
}

export function readPinnedThreadIds(
  storage: Pick<ThreadPinStorage, "getItem">,
  backendId: string,
) {
  try {
    const value = JSON.parse(storage.getItem(storageKey(backendId)) ?? "[]");
    if (
      !Array.isArray(value) ||
      !value.every(
        (threadId) => typeof threadId === "string" && Boolean(threadId.trim()),
      )
    ) {
      return new Set<string>();
    }
    return new Set(value);
  } catch {
    return new Set<string>();
  }
}

export function writeThreadPinned(
  storage: ThreadPinStorage,
  backendId: string,
  threadId: string,
  isPinned: boolean,
) {
  const pinned = readPinnedThreadIds(storage, backendId);
  if (isPinned) pinned.add(threadId);
  else pinned.delete(threadId);
  storage.setItem(storageKey(backendId), JSON.stringify([...pinned].sort()));
}

export function applyPinnedThreadState<T extends ThreadRecord>(
  threads: T[],
  locallyPinnedThreadIds: Set<string>,
): Array<T & { isPinned: boolean }> {
  const serverProvidesPinState = threads.some(
    (thread) => typeof thread.isPinned === "boolean",
  );
  return threads.map((thread) => ({
    ...thread,
    isPinned: serverProvidesPinState
      ? thread.isPinned === true
      : locallyPinnedThreadIds.has(String(thread.id)),
  }));
}
