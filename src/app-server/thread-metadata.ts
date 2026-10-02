import type { AppServerClient } from "./client";
import type { DisplayRecord } from "../ui/app-display";
import { t } from "../i18n";

export interface ThreadPinUpdateResult {
  thread: DisplayRecord;
  persistence: "server" | "local";
}

function isUnsupportedThreadPinUpdate(reason: unknown) {
  if (!(reason instanceof Error)) return false;
  const message = reason.message.toLowerCase();
  return (
    message.includes("thread metadata update must include at least one field") ||
    (message.includes("ispinned") &&
      (message.includes("unknown field") || message.includes("invalid params")))
  );
}

export async function setThreadPinned(
  client: Pick<AppServerClient, "request">,
  threadId: string,
  isPinned: boolean,
): Promise<ThreadPinUpdateResult> {
  let result: { thread: DisplayRecord };
  try {
    result = await client.request<{ thread: DisplayRecord }>(
      "thread/metadata/update",
      { threadId, isPinned },
    );
  } catch (reason) {
    if (!isUnsupportedThreadPinUpdate(reason)) throw reason;
    return {
      thread: { id: threadId, isPinned },
      persistence: "local",
    };
  }
  if (result.thread?.isPinned !== isPinned) {
    throw new Error(t("服务端返回的置顶状态不一致"));
  }
  return { thread: result.thread, persistence: "server" };
}

export async function duplicateThread(
  client: Pick<AppServerClient, "request">,
  threadId: string,
): Promise<DisplayRecord> {
  const result = await client.request<{ thread: DisplayRecord }>(
    "thread/fork",
    { threadId, excludeTurns: true },
  );
  if (!result.thread?.id || String(result.thread.id) === threadId) {
    throw new Error(t("复制会话响应无效，请重试"));
  }
  return result.thread;
}

export function activeThreadAfterArchive(
  active: DisplayRecord | null,
  archivedThreadId: string,
) {
  return active?.id === archivedThreadId ? null : active;
}

export function applyThreadNameUpdate<T extends DisplayRecord>(
  thread: T | null,
  threadId: string,
  threadName: string | null | undefined,
): T | null {
  if (!thread || String(thread.id ?? "") !== threadId) return thread;
  if (threadName == null) {
    const { name: _name, ...rest } = thread;
    return rest as T;
  }
  return { ...thread, name: threadName };
}

export function applyThreadNameUpdateToList<T extends DisplayRecord>(
  threads: T[],
  threadId: string,
  threadName: string | null | undefined,
) {
  return threads.map((thread) =>
    applyThreadNameUpdate(thread, threadId, threadName) as T,
  );
}
