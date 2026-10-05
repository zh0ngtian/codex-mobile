import type {
  ApprovalPolicy,
  ApprovalsReviewer,
} from "../ui/settings";
import { hasTurnChangeStats, summarizeTurnChanges } from "../ui/conversation";

type AnyRecord = Record<string, any>;
const initialTurnsLimit = 5;
const threadHistoryRequestTimeoutMs = 60_000;
const threadHistoryRequestOptions = {
  timeoutMs: threadHistoryRequestTimeoutMs,
};

export type TurnChangeStats = { additions: number; deletions: number };
export type TurnBackfill = Partial<TurnChangeStats> & { images: AnyRecord[]; unavailable?: boolean; source?: string };

export async function loadTurnChangeStatsPage(
  client: Requester,
  threadId: string,
  cursor?: string,
  limit = initialTurnsLimit,
): Promise<Record<string, TurnBackfill>> {
  const response = await client.request(
    "thread/turns/list",
    {
      threadId,
      ...(cursor ? { cursor } : {}),
      limit,
      sortDirection: "desc",
      itemsView: "full",
    },
    threadHistoryRequestOptions,
  );
  return Object.fromEntries(
    (response.data ?? []).map((turn: AnyRecord) => {
      const images = (turn.items ?? []).filter((item: AnyRecord) =>
        (item.type === "imageView" && typeof item.path === "string" && item.path) ||
        (item.type === "imageGeneration" &&
          [item.savedPath, item.result].some((value) =>
            typeof value === "string" && /^(data:|\/)/i.test(value))),
      ).map((item: AnyRecord) => ({
        id: item.id,
        type: item.type,
        backfilled: true,
        ...(item.path ? { path: item.path } : {}),
        ...(item.savedPath ? { savedPath: item.savedPath } : {}),
        ...(item.result && /^(https?:|data:|\/)/i.test(item.result) ? { result: item.result } : {}),
      }));
      return [String(turn.id), hasTurnChangeStats(turn)
        ? { ...summarizeTurnChanges(turn), images, ...(turn.changeStatsSource ? { source: turn.changeStatsSource } : {}) }
        : { unavailable: true, images }];
    }),
  );
}

export function applyTurnChangeStats(
  turns: AnyRecord[],
  stats: Record<string, TurnBackfill>,
  requestedTurnIds: string[] = [],
): AnyRecord[] {
  const requested = new Set(requestedTurnIds);
  return turns.map((turn) => {
    const detail = stats[String(turn.id)];
    if (!detail) return requested.has(String(turn.id))
      ? { ...turn, changeStatsUnavailable: true }
      : turn;
    const items = [...(turn.items ?? [])];
    const finalIndex = items.findIndex((item: AnyRecord) =>
      item.type === "agentMessage" && item.phase === "final_answer",
    );
    let insertAt = finalIndex < 0 ? items.length : finalIndex;
    for (const image of detail.images ?? []) {
      const source = image.path ?? image.savedPath ?? image.result;
      if (items.some((item: AnyRecord) =>
        (image.id && item.id === image.id) ||
        (item.type === image.type &&
          (item.path ?? item.savedPath ?? item.result) === source) ||
        (item.type === "agentMessage" && typeof item.text === "string" && item.text.includes(source)),
      )) continue;
      items.splice(insertAt, 0, image);
      insertAt += 1;
    }
    return {
      ...turn,
      items,
      loadedChangeStats: detail.unavailable ? undefined : { additions: detail.additions ?? 0, deletions: detail.deletions ?? 0 },
      changeStatsSource: detail.source,
      loadedMediaStatus: turn.status,
      changeStatsUnavailable: detail.unavailable === true,
    };
  });
}

interface Requester {
  request(
    method: string,
    params: unknown,
    options?: { timeoutMs?: number },
  ): Promise<any>;
}

export interface ResumedThreadSession {
  thread: AnyRecord;
  accessMode: ThreadAccessMode;
  resumeError?: string;
  model?: string;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  approvalPolicy?: ApprovalPolicy;
  approvalsReviewer?: ApprovalsReviewer;
  activePermissionProfile?: { id: string } | null;
  settingsSynchronized: boolean;
  nextTurnsCursor: string | null;
}

export type ThreadAccessMode = "interactive" | "readOnly";

export interface ThreadTurnsPage {
  turns: AnyRecord[];
  nextCursor: string | null;
}

export type OlderTurnsLoadState =
  | "idle"
  | "loading"
  | "error"
  | "exhausted";

function chronologicalTurns(data: AnyRecord[] | undefined) {
  return [...(data ?? [])].reverse();
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function isActiveWriterConflict(reason: unknown) {
  return errorMessage(reason).includes("already has an active writer");
}

export function prependUniqueTurns(
  current: AnyRecord[],
  older: AnyRecord[],
) {
  const currentIds = new Set(current.map((turn) => String(turn.id)));
  return [
    ...older.filter((turn) => !currentIds.has(String(turn.id))),
    ...current,
  ];
}

export async function loadOlderThreadTurns(
  client: Requester,
  threadId: string,
  cursor: string,
): Promise<ThreadTurnsPage> {
  const response = await client.request(
    "thread/turns/list",
    {
      threadId,
      cursor,
      limit: initialTurnsLimit,
      sortDirection: "desc",
      itemsView: "summary",
    },
    threadHistoryRequestOptions,
  );
  return {
    turns: chronologicalTurns(response.data),
    nextCursor: response.nextCursor ?? null,
  };
}

export async function loadRecentThreadTurns(
  client: Requester,
  threadId: string,
  limit = initialTurnsLimit,
): Promise<AnyRecord[]> {
  const response = await client.request(
    "thread/turns/list",
    {
      threadId,
      limit,
      sortDirection: "desc",
      itemsView: "summary",
    },
    threadHistoryRequestOptions,
  );
  return chronologicalTurns(response.data);
}

export async function loadStableRecentThreadTurns(
  client: Requester,
  threadId: string,
  readNotificationSequence: () => number,
  maxAttempts = 3,
  limit = initialTurnsLimit,
): Promise<AnyRecord[] | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const sequence = readNotificationSequence();
    const turns = await loadRecentThreadTurns(client, threadId, limit);
    if (sequence === readNotificationSequence()) return turns;
  }
  return null;
}

export async function loadRecoverableRecentThreadTurns(
  client: Requester,
  threadId: string,
  readNotificationSequence: () => number,
  wait: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise((resolve) => globalThis.setTimeout(resolve, delayMs)),
  maxAttempts = 3,
  limit = initialTurnsLimit,
): Promise<AnyRecord[] | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const turns = await loadStableRecentThreadTurns(
        client,
        threadId,
        readNotificationSequence,
        3,
        limit,
      );
      if (turns != null) return turns;
    } catch {
      // 快照读取失败不代表 WebSocket 已断开；先在当前连接上限次重试。
    }
    if (attempt < maxAttempts - 1) {
      await wait(300 * 2 ** attempt);
    }
  }
  return null;
}

export async function resumeThreadSession(
  client: Requester,
  threadId: string,
): Promise<ResumedThreadSession> {
  try {
    const response = await client.request(
      "thread/resume",
      {
        threadId,
        excludeTurns: true,
        initialTurnsPage: {
          limit: initialTurnsLimit,
          sortDirection: "desc",
          itemsView: "summary",
        },
      },
      threadHistoryRequestOptions,
    );
    const initialTurnsPage = response.initialTurnsPage;
    return {
      thread: {
        ...response.thread,
        turns: initialTurnsPage?.data
          ? chronologicalTurns(initialTurnsPage.data)
          : response.thread.turns ?? [],
      },
      model: response.model,
      reasoningEffort: response.reasoningEffort,
      serviceTier: response.serviceTier,
      approvalPolicy: response.approvalPolicy,
      approvalsReviewer: response.approvalsReviewer,
      activePermissionProfile: response.activePermissionProfile,
      accessMode: "interactive",
      settingsSynchronized: true,
      nextTurnsCursor: initialTurnsPage?.nextCursor ?? null,
    };
  } catch (reason) {
    if (!isActiveWriterConflict(reason)) throw reason;
    const resumeError = errorMessage(reason);
    const response = await client.request("thread/read", {
      threadId,
      includeTurns: false,
    });
    const turnsPage = await client.request(
      "thread/turns/list",
      {
        threadId,
        limit: initialTurnsLimit,
        sortDirection: "desc",
        itemsView: "summary",
      },
      threadHistoryRequestOptions,
    );
    return {
      thread: {
        ...response.thread,
        turns: chronologicalTurns(turnsPage.data),
      },
      accessMode: "readOnly",
      resumeError,
      settingsSynchronized: false,
      nextTurnsCursor: turnsPage.nextCursor ?? null,
    };
  }
}
