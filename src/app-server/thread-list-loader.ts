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
) {
  return loadProjectlessThreadRecords(
    client,
    threadIds,
    PROJECT_THREAD_BATCH_SIZE,
  );
}

export function nextProjectThreadLimit(currentCount: number) {
  return Math.max(0, Math.floor(currentCount)) + PROJECT_THREAD_BATCH_SIZE;
}

export async function loadProjectlessThreadRecords(
  client: ThreadListClient,
  threadIds: string[],
  targetCount: number,
) {
  const targetIds = new Set(threadIds);
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
) {
  const result: ThreadListResponse = await client.request("thread/list", {
    limit: PROJECT_THREAD_BATCH_SIZE,
    cwd,
    sortKey: "recency_at",
    ...(cursor ? { cursor } : {}),
  });
  return {
    threads: dedupeThreadsById(result.data),
    hasMore: result.nextCursor
      ? true
      : result.nextCursor === null
        ? false
        : result.data.length >= PROJECT_THREAD_BATCH_SIZE,
    nextCursor: result.nextCursor ?? null,
  };
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
    return loadProjectThreadRecords(client, cwd)
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
    return loadProjectlessThreadPage(client, threadIds)
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
      const projectRequests = projects.length
        ? projects.map((cwd) => loadProject(client, cwd, sequence, options))
        : [client
            .request("thread/list", {
              limit: 50,
              sortKey: "recency_at",
            })
            .then((result: ThreadListResponse) => {
              if (sequence === latestSequence) {
                callbacks.onData?.(
                  markProjectlessThreads(
                    dedupeThreadsById(result.data),
                    currentProjectlessThreadIds,
                  ),
                );
              }
            })];
      if (projectlessThreadIds.length) {
        projectRequests.push(
          loadProjectless(client, projectlessThreadIds, sequence, options),
        );
      }
      const promise = Promise.all(projectRequests)
        .then(() => {
          if (sequence === latestSequence) callbacks.onSettled?.();
        })
        .finally(() => {
          if (pending?.promise === promise) pending = null;
        });

      pending = { client, promise };
      return promise;
    },
    loadProject(client: ThreadListClient, cwd: string) {
      return loadProject(client, cwd);
    },
    loadProjectless(client: ThreadListClient, threadIds: string[]) {
      currentProjectlessThreadIds = new Set(threadIds);
      return loadProjectless(client, threadIds);
    },
  };
}
