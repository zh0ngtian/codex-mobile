import { isThreadRunning } from "../ui/conversation";
import { isVisibleThread } from "../features/threads/thread-visibility";
import { AppServerRpcError, type AppServerRequestOptions } from "./client";

type ThreadRecord = Record<string, any>;

interface ThreadListClient {
  request(method: string, params: unknown, options?: AppServerRequestOptions): Promise<any>;
}

interface ThreadListResponse {
  data: ThreadRecord[];
  nextCursor?: string | null;
}

export type ProjectThreadLoadState = "idle" | "loading" | "ready" | "error";
export const PROJECTLESS_GROUP_ID = "codex-mobile://projectless";
export const PROJECT_THREAD_BATCH_SIZE = 5;

interface ThreadListLoaderCallbacks {
  onData?: (threads: ThreadRecord[]) => void;
  onPinnedData?: (threads: ThreadRecord[]) => void;
  onProjectStart?: (cwd: string) => void;
  onProjectData?: (
    cwd: string,
    threads: ThreadRecord[],
    hasMore: boolean,
    nextCursor: string | null,
  ) => void;
  onProjectError?: (cwd: string, reason: Error) => void;
  onSettled?: () => void;
}

interface ThreadListLoadOptions {
  silent?: boolean;
  pinnedThreadIds?: string[];
  prioritizedThreadIds?: string[];
  includeRunningThreads?: boolean;
}

async function loadPrioritizedThreadRecords(
  client: ThreadListClient,
  explicitIds: Set<string>,
  includeRunningThreads: boolean,
) {
  const ids = new Set(explicitIds);
  if (includeRunningThreads) {
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    try {
      do {
        const result = await client.request("thread/loaded/list", {
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        for (const id of result.data ?? []) {
          if (typeof id === "string" && id) ids.add(id);
        }
        cursor = result.nextCursor ?? null;
        if (!cursor || seenCursors.has(cursor)) break;
        seenCursors.add(cursor);
      } while (cursor);
    } catch {
      // 旧服务端或单页失败不影响已发现对话与本机关注、未读摘要。
    }
  }
  const results = await Promise.allSettled(
    [...ids].map(async (threadId) => {
      const result = await client.request("thread/read", { threadId, includeTurns: false });
      if (String(result.thread?.id ?? "") !== threadId) return null;
      const { turns: _turns, ...metadata } = result.thread;
      return explicitIds.has(threadId) || isThreadRunning(metadata.status)
        ? metadata as ThreadRecord
        : null;
    }),
  );
  return dedupeThreadsById(results.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  ));
}

function threadTimestamp(thread: ThreadRecord) {
  // 恢复会话会更新 updatedAt；最近任务排序使用只在任务开始时推进的 recencyAt。
  return Number(thread.recencyAt ?? thread.updatedAt ?? thread.createdAt ?? 0);
}

export function dedupeThreadsById(threads: ThreadRecord[]) {
  // 同批稀疏摘要不能抹掉已确认的子会话身份。
  const hiddenIds = new Set(threads.filter((thread) => !isVisibleThread(thread))
    .map((thread) => String(thread.id ?? "").trim()));
  const unique = new Map<string, ThreadRecord>();
  const unidentified: ThreadRecord[] = [];
  for (const thread of threads) {
    const id = String(thread.id ?? "").trim();
    if (!isVisibleThread(thread) || (id && hiddenIds.has(id))) continue;
    if (!id) {
      unidentified.push(thread);
      continue;
    }
    const current = unique.get(id);
    // 排序时间不决定元数据新鲜度，同一会话仍保留最新快照。
    if (
      !current ||
      Number(thread.updatedAt ?? thread.createdAt ?? 0) >
        Number(current.updatedAt ?? current.createdAt ?? 0)
    ) {
      unique.set(id, thread);
    }
  }
  return [...unique.values(), ...unidentified].sort(
    (left, right) => threadTimestamp(right) - threadTimestamp(left),
  );
}

export function mergeThreadListPage(
  current: ThreadRecord[],
  incoming: ThreadRecord[],
  retainedIds: Set<string>,
) {
  return dedupeThreadsById([
    ...incoming,
    ...current.filter((thread) => retainedIds.has(String(thread.id)) ||
      thread.isPinned === true || thread.isUnread === true || isThreadRunning(thread.status)),
  ]);
}

function markProjectlessThreads(
  threads: ThreadRecord[],
  projectlessThreadIds: Set<string>,
) {
  return threads.map((thread) =>
    projectlessThreadIds.has(String(thread.id))
      ? { ...thread, isProjectless: true }
      : thread,
  );
}

async function loadProjectlessThreadPage(
  client: ThreadListClient,
  threadIds: string[],
  pinnedThreadIds: Set<string>,
) {
  return loadProjectlessThreadRecords(
    client,
    threadIds,
    PROJECT_THREAD_BATCH_SIZE,
    pinnedThreadIds,
  );
}

export function nextProjectThreadLimit(currentCount: number) {
  return Math.max(0, Math.floor(currentCount)) + PROJECT_THREAD_BATCH_SIZE;
}

export async function loadProjectlessThreadRecords(
  client: ThreadListClient,
  threadIds: string[],
  targetCount: number,
  pinnedThreadIds: Set<string> = new Set(),
) {
  const targetIds = new Set(threadIds.filter((id) => id && !pinnedThreadIds.has(id)));
  const effectiveTargetCount = Math.min(
    Math.max(0, Math.floor(targetCount)),
    targetIds.size,
  );
  if (!effectiveTargetCount) return { threads: [], hasMore: false };
  // 本机标记的 ID 不保证有序；只核对本分组轻量摘要，才能取到真正最近的普通会话。
  const found = await Promise.all([...targetIds].map(async (threadId) => {
    try {
      const result = await client.request("thread/read", { threadId, includeTurns: false });
      const thread = result.thread;
      if (String(thread?.id ?? "") !== threadId || !isVisibleThread(thread) ||
        thread.archived === true ||
        (typeof thread.path === "string" && /(?:^|[\\/])archived_sessions(?:[\\/]|$)/.test(thread.path))) {
        return null;
      }
      const { turns: _turns, ...metadata } = thread;
      return { ...metadata, isProjectless: true } as ThreadRecord;
    } catch (error) {
      // 上游对已从持久化索引消失的遗留 ID 返回此精确错误；其他读取失败需交给分组错误状态。
      if (error instanceof AppServerRpcError && error.code === -32600 &&
        error.message === `thread not loaded: ${threadId}`) return null;
      throw error;
    }
  }));
  const threads = dedupeThreadsById(found.filter((thread): thread is ThreadRecord => thread !== null))
    .sort((left, right) => threadTimestamp(right) - threadTimestamp(left) ||
      (String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0));
  return {
    threads: threads.slice(0, effectiveTargetCount),
    hasMore: threads.length > effectiveTargetCount,
  };
}

export async function loadProjectThreadRecords(
  client: ThreadListClient,
  cwd: string,
  cursor?: string | null,
  excludedThreadIds: Set<string> = new Set(),
) {
  let threads: ThreadRecord[] = [];
  const seenCursors = new Set<string>(cursor ? [cursor] : []);
  let nextCursor = cursor ?? null;
  while (true) {
    const limit = PROJECT_THREAD_BATCH_SIZE - threads.length;
    const result: ThreadListResponse = await client.request("thread/list", {
      limit,
      cwd,
      sortKey: "recency_at",
      ...(nextCursor ? { cursor: nextCursor } : {}),
    });
    threads = dedupeThreadsById([
      ...threads,
      ...result.data.filter((thread) => !excludedThreadIds.has(String(thread.id))),
    ]);
    nextCursor = result.nextCursor ?? null;
    if (nextCursor && seenCursors.has(nextCursor)) {
      return { threads, hasMore: false, nextCursor: null };
    }
    // 子会话和独立补取的关注/运行/未读记录均不占普通项目本批五条的名额。
    if (!nextCursor ||
      (!excludedThreadIds.size && result.data.every(isVisibleThread)) ||
      threads.length >= PROJECT_THREAD_BATCH_SIZE) {
      return {
        threads,
        hasMore: nextCursor
          ? true
          : result.nextCursor === null
            ? false
            : result.data.length >= limit,
        nextCursor,
      };
    }
    seenCursors.add(nextCursor);
  }
}

export function createLatestThreadListLoader(
  callbacks: ThreadListLoaderCallbacks,
) {
  let pending:
    | { client: ThreadListClient; promise: Promise<void> }
    | null = null;
  let latestSequence = 0;
  const projectAttempts = new Map<string, number>();
  let currentProjectlessThreadIds = new Set<string>();
  let currentPinnedThreadIds = new Set<string>();

  const nextProjectAttempt = (cwd: string) => {
    const attempt = (projectAttempts.get(cwd) ?? 0) + 1;
    projectAttempts.set(cwd, attempt);
    return attempt;
  };

  const loadProject = (
    client: ThreadListClient,
    cwd: string,
    sequence = latestSequence,
    options: ThreadListLoadOptions = {},
  ) => {
    const attempt = nextProjectAttempt(cwd);
    if (!options.silent) callbacks.onProjectStart?.(cwd);
    return loadProjectThreadRecords(
      client,
      cwd,
      null,
      new Set([...currentPinnedThreadIds, ...currentProjectlessThreadIds]),
    )
      .then(({ threads, hasMore, nextCursor }) => {
        if (
          sequence === latestSequence &&
          projectAttempts.get(cwd) === attempt
        ) {
          const projectThreads = threads.filter(
            (thread) =>
              !currentProjectlessThreadIds.has(String(thread.id)),
          );
          callbacks.onProjectData?.(
            cwd,
            projectThreads,
            hasMore,
            nextCursor,
          );
        }
      })
      .catch((reason: unknown) => {
        if (
          sequence === latestSequence &&
          projectAttempts.get(cwd) === attempt
        ) {
          callbacks.onProjectError?.(
            cwd,
            reason instanceof Error ? reason : new Error(String(reason)),
          );
        }
      });
  };

  const loadProjectless = (
    client: ThreadListClient,
    threadIds: string[],
    sequence = latestSequence,
    options: ThreadListLoadOptions = {},
  ) => {
    const attempt = nextProjectAttempt(PROJECTLESS_GROUP_ID);
    if (!options.silent) callbacks.onProjectStart?.(PROJECTLESS_GROUP_ID);
    return loadProjectlessThreadPage(client, threadIds, currentPinnedThreadIds)
      .then(({ threads, hasMore }) => {
        if (
          sequence === latestSequence &&
          projectAttempts.get(PROJECTLESS_GROUP_ID) === attempt
        ) {
          callbacks.onProjectData?.(
            PROJECTLESS_GROUP_ID,
            threads,
            hasMore,
            null,
          );
        }
      })
      .catch((reason: unknown) => {
        if (
          sequence === latestSequence &&
          projectAttempts.get(PROJECTLESS_GROUP_ID) === attempt
        ) {
          callbacks.onProjectError?.(
            PROJECTLESS_GROUP_ID,
            reason instanceof Error ? reason : new Error(String(reason)),
          );
        }
      });
  };

  return {
    load(
      client: ThreadListClient,
      projects: string[] = [],
      projectlessThreadIds: string[] = [],
      options: ThreadListLoadOptions = {},
    ) {
      if (pending?.client === client) return pending.promise;

      const sequence = ++latestSequence;
      currentProjectlessThreadIds = new Set(projectlessThreadIds);
      const explicitIds = new Set([
        ...(options.pinnedThreadIds ?? []),
        ...(options.prioritizedThreadIds ?? []),
      ]);
      const background: ThreadListClient = {
        request: (method, params) => client.request(method, params, { priority: "background" }),
      };
      currentPinnedThreadIds = explicitIds;
      const priorityRequest = explicitIds.size || options.includeRunningThreads
        ? loadPrioritizedThreadRecords(background, explicitIds, options.includeRunningThreads === true)
          .then((threads) => {
            if (sequence !== latestSequence) return;
            currentPinnedThreadIds = new Set([
              ...explicitIds, ...threads.map((thread) => String(thread.id)),
            ]);
            callbacks.onPinnedData?.(
              markProjectlessThreads(threads, new Set(projectlessThreadIds)),
            );
          })
        : Promise.resolve();
      const loadProjects = () => {
        if (sequence !== latestSequence) return Promise.resolve();
        const projectRequests = projects.length
          ? projects.map((cwd) => loadProject(background, cwd, sequence, options))
          : projectlessThreadIds.length
            ? []
            : [background.request("thread/list", { limit: 50, sortKey: "recency_at" })
              .then((result: ThreadListResponse) => {
                if (sequence === latestSequence) {
                  callbacks.onData?.(markProjectlessThreads(
                    dedupeThreadsById(result.data), new Set(projectlessThreadIds),
                  ));
                }
              })];
        if (projectlessThreadIds.length) {
          projectRequests.push(loadProjectless(background, projectlessThreadIds, sequence, options));
        }
        return Promise.all(projectRequests).then(() => undefined);
      };
      // 先补取运行与未读摘要，普通项目分页才能准确补足五条。
      const projectRequest = options.includeRunningThreads || options.prioritizedThreadIds
        ? priorityRequest.then(loadProjects)
        : loadProjects();
      const promise = Promise.all([priorityRequest, projectRequest])
        .then(() => {
          if (sequence === latestSequence) callbacks.onSettled?.();
        })
        .finally(() => {
          if (pending?.promise === promise) pending = null;
        });

      pending = { client, promise };
      return promise;
    },
    loadProject(
      client: ThreadListClient,
      cwd: string,
      options: ThreadListLoadOptions = {},
    ) {
      if (options.pinnedThreadIds || options.prioritizedThreadIds) {
        currentPinnedThreadIds = new Set([
          ...(options.pinnedThreadIds ?? []), ...(options.prioritizedThreadIds ?? []),
        ]);
      }
      return loadProject(client, cwd);
    },
    loadProjectless(
      client: ThreadListClient,
      threadIds: string[],
      options: ThreadListLoadOptions = {},
    ) {
      currentProjectlessThreadIds = new Set(threadIds);
      if (options.pinnedThreadIds || options.prioritizedThreadIds) {
        currentPinnedThreadIds = new Set([
          ...(options.pinnedThreadIds ?? []), ...(options.prioritizedThreadIds ?? []),
        ]);
      }
      return loadProjectless(client, threadIds);
    },
  };
}
