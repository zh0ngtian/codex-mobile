type ThreadRecord = Record<string, any>;

interface ThreadListClient {
  request(method: string, params: unknown): Promise<any>;
}

interface ThreadListResponse {
  data: ThreadRecord[];
  nextCursor?: string | null;
}

export type ProjectThreadLoadState = "idle" | "loading" | "ready" | "error";

interface ThreadListLoaderCallbacks {
  onData?: (threads: ThreadRecord[]) => void;
  onProjectStart?: (cwd: string) => void;
  onProjectData?: (
    cwd: string,
    threads: ThreadRecord[],
    hasMore: boolean,
  ) => void;
  onProjectError?: (cwd: string, reason: Error) => void;
  onSettled?: () => void;
}

function threadTimestamp(thread: ThreadRecord) {
  return Number(thread.updatedAt ?? thread.createdAt ?? 0);
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
    if (!current || threadTimestamp(thread) > threadTimestamp(current)) {
      unique.set(id, thread);
    }
  }
  return [...unique.values(), ...unidentified].sort(
    (left, right) => threadTimestamp(right) - threadTimestamp(left),
  );
}

export async function loadAllProjectThreadRecords(
  client: ThreadListClient,
  cwd: string,
) {
  const all: ThreadRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const result: ThreadListResponse = await client.request("thread/list", {
      limit: 50,
      cwd,
      sortKey: "updated_at",
      ...(cursor ? { cursor } : {}),
    });
    all.push(...result.data);
    const nextCursor = result.nextCursor ?? null;
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);
  return dedupeThreadsById(all);
}

export function createLatestThreadListLoader(
  callbacks: ThreadListLoaderCallbacks,
) {
  let pending:
    | { client: ThreadListClient; promise: Promise<void> }
    | null = null;
  let latestSequence = 0;
  const projectAttempts = new Map<string, number>();

  const nextProjectAttempt = (cwd: string) => {
    const attempt = (projectAttempts.get(cwd) ?? 0) + 1;
    projectAttempts.set(cwd, attempt);
    return attempt;
  };

  const loadProject = (
    client: ThreadListClient,
    cwd: string,
    sequence = latestSequence,
  ) => {
    const attempt = nextProjectAttempt(cwd);
    callbacks.onProjectStart?.(cwd);
    return client
      .request("thread/list", {
        limit: 5,
        cwd,
        sortKey: "updated_at",
      })
      .then((result: ThreadListResponse) => {
        if (
          sequence === latestSequence &&
          projectAttempts.get(cwd) === attempt
        ) {
          const hasMore = result.nextCursor
            ? true
            : result.nextCursor === null
              ? false
              : result.data.length >= 5;
          callbacks.onProjectData?.(
            cwd,
            dedupeThreadsById(result.data),
            hasMore,
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

  return {
    load(client: ThreadListClient, projects: string[] = []) {
      if (pending?.client === client) return pending.promise;

      const sequence = ++latestSequence;
      const request = projects.length
        ? Promise.all(projects.map((cwd) => loadProject(client, cwd, sequence)))
        : client
            .request("thread/list", {
              limit: 50,
              sortKey: "updated_at",
            })
            .then((result: ThreadListResponse) => {
              if (sequence === latestSequence) {
                callbacks.onData?.(dedupeThreadsById(result.data));
              }
            });
      const promise = request
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
  };
}
