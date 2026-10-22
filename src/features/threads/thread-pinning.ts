// 沿用旧键作为服务端置顶投影缓存；首次成功同步完整替换，不迁移旧关注。
export const THREAD_FOLLOWING_CHANGED_EVENT = "codex-mobile-following-changed";

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

export function replacePinnedThreadIds(storage: ThreadPinStorage, backendId: string, ids: Iterable<string>) {
  const value = JSON.stringify([...new Set(ids)].sort());
  if (storage.getItem(storageKey(backendId)) === value) return;
  storage.setItem(storageKey(backendId), value);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(THREAD_FOLLOWING_CHANGED_EVENT));
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
  replacePinnedThreadIds(storage, backendId, pinned);
}

export function applyPinnedThreadState<T extends ThreadRecord>(
  threads: T[],
  locallyPinnedThreadIds: Set<string>,
): Array<T & { isPinned: boolean }> {
  return threads.map((thread) => ({
    ...thread,
    isPinned: locallyPinnedThreadIds.has(String(thread.id)),
  }));
}
