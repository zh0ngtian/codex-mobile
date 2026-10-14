import type {
  ApprovalPolicy,
  ApprovalsReviewer,
} from "../ui/settings";
import { hasTurnChangeStats, summarizeTurnChanges, reconcileRecentTurns } from "../ui/conversation";

type AnyRecord = Record<string, any>;
const initialTurnsLimit = 5;
const threadHistoryRequestTimeoutMs = 60_000;
const threadHistoryRequestOptions = {
  timeoutMs: threadHistoryRequestTimeoutMs,
};

export interface TurnCommentary { turnId: string; items: AnyRecord[] }

export function runningTurnNeedingCommentary(turns: AnyRecord[]): AnyRecord | undefined {
  const turn = turns.at(-1);
  return turn?.id && ["inProgress", "in_progress", "running"].includes(turn.status) &&
    !(turn.items ?? []).some((item: AnyRecord) => item.type === "agentMessage" && item.phase === "final_answer")
    ? turn : undefined;
}

export async function loadRunningTurnCommentary(client: Requester, threadId: string, turns: AnyRecord[]): Promise<TurnCommentary | null> {
  const turn = runningTurnNeedingCommentary(turns);
  if (!turn) return null;
  const result = await client.request("mobile/turns/commentary", { threadId, turnId: turn.id }, threadHistoryRequestOptions);
  return result?.turnId === turn.id && Array.isArray(result.items) ? result : null;
}

export function applyTurnCommentary(turns: AnyRecord[], detail: TurnCommentary): AnyRecord[] {
  return turns.map((turn) => {
    if (turn.id !== detail.turnId || !detail.items.length) return turn;
    const items = detail.items.map((item) => {
      const existing = (turn.items ?? []).find((current: AnyRecord) => current.id === item.id);
      // 回填只有用户文字，保留摘要或实时通知中的附件。
      return existing && (item.type === "userMessage" || existing.phase === "final_answer")
        ? { ...item, ...existing } : item;
    });
    return reconcileRecentTurns([turn], [{ ...turn, items }])[0];
  });
}

export type TurnChangeStats = { additions: number; deletions: number };
export type TurnBackfill = Partial<TurnChangeStats> & { images: AnyRecord[]; commentaryItems?: AnyRecord[]; messageOrder?: string[]; unavailable?: boolean; source?: string };

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
      const commentaryItems = (turn.commentaryItems ?? turn.items ?? []).filter((item: AnyRecord) =>
        item.type === "agentMessage" && item.phase === "commentary" && typeof item.id === "string" && typeof item.text === "string",
      ).map((item: AnyRecord) => ({ id: item.id, type: item.type, phase: item.phase, text: item.text }));
      const messageOrder = (turn.messageOrder ?? (turn.items ?? [])
        .filter((item: AnyRecord) => ["userMessage", "agentMessage"].includes(item.type))
        .map((item: AnyRecord) => item.id)).filter((id: unknown) => typeof id === "string");
      const messages = commentaryItems.length ? { commentaryItems, messageOrder } : {};
      return [String(turn.id), hasTurnChangeStats(turn)
        ? { ...summarizeTurnChanges(turn), images, ...messages, ...(turn.changeStatsSource ? { source: turn.changeStatsSource } : {}) }
        : { unavailable: true, images, ...messages }];
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
    const recovered = detail.commentaryItems?.length
      ? applyTurnCommentary([turn], { turnId: String(turn.id), items: detail.commentaryItems })[0]
      : turn;
    let items: AnyRecord[] = [...(recovered.items ?? [])];
    if (detail.commentaryItems?.length && detail.messageOrder?.length) {
      const order = [...new Set(detail.messageOrder)];
      const known = new Set(order);
      const byId = new Map(items.map((item) => [item.id, item]));
      items = [...order.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []),
        ...items.filter((item) => !known.has(item.id))];
    }
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
