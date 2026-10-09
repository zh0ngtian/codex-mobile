import { isThreadRunning } from "../ui/conversation";

type ThreadRecord = Record<string, any>;

interface ThreadListClient {
  request(method: string, params: unknown): Promise<any>;
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
      // 旧服务端或单页失败不影响已发现对话与本机主动置顶、未读摘要。
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
  const unique = new Map<string, ThreadRecord>();
  const unidentified: ThreadRecord[] = [];
  for (const thread of threads) {
    const id = String(thread.id ?? "").trim();
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
    ...current.filter((thread) => retainedIds.has(String(thread.id))),
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

function projectlessThreadsFromPage(
  threads: ThreadRecord[],
  threadIds: Set<string>,
) {
  return threads.flatMap((thread) =>
    threadIds.has(String(thread.id ?? ""))
      ? [{ ...thread, isProjectless: true }]
      : [],
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
  const targetIds = new Set(threadIds.filter((id) => !pinnedThreadIds.has(id)));
  const effectiveTargetCount = Math.min(
    Math.max(0, Math.floor(targetCount)),
    targetIds.size,
  );
  if (!effectiveTargetCount) return { threads: [], hasMore: false };
  const found: ThreadRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const result: ThreadListResponse = await client.request("thread/list", {
      limit: 50,
      sortKey: "recency_at",
      ...(cursor ? { cursor } : {}),
    });
    found.push(...projectlessThreadsFromPage(result.data, targetIds));
    if (dedupeThreadsById(found).length >= effectiveTargetCount) {
      const threads = dedupeThreadsById(found);
      return {
        threads: threads.slice(0, effectiveTargetCount),
        hasMore:
          threads.length > effectiveTargetCount ||
          (Boolean(result.nextCursor) &&
            targetIds.size > effectiveTargetCount),
      };
    }
    const nextCursor = result.nextCursor ?? null;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);
  const threads = dedupeThreadsById(found).slice(0, effectiveTargetCount);
  return {
    threads,
    hasMore: false,
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
    // 无过滤时保留原有单页行为；有过滤时只补足本批缺少的普通对话。
    if (!nextCursor || !excludedThreadIds.size || threads.length >= PROJECT_THREAD_BATCH_SIZE) {
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
      currentPinnedThreadIds = explicitIds;
      const priorityRequest = explicitIds.size || options.includeRunningThreads
        ? loadPrioritizedThreadRecords(client, explicitIds, options.includeRunningThreads === true)
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
          ? projects.map((cwd) => loadProject(client, cwd, sequence, options))
          : projectlessThreadIds.length
            ? []
            : [client.request("thread/list", { limit: 50, sortKey: "recency_at" })
              .then((result: ThreadListResponse) => {
                if (sequence === latestSequence) {
                  callbacks.onData?.(markProjectlessThreads(
                    dedupeThreadsById(result.data), new Set(projectlessThreadIds),
                  ));
                }
              })];
        if (projectlessThreadIds.length) {
          projectRequests.push(loadProjectless(client, projectlessThreadIds, sequence, options));
        }
        return Promise.all(projectRequests).then(() => undefined);
      };
      // 先确定被动置顶集合，普通项目分页才能准确补足五条。
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
