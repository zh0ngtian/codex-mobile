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

export function activeThreadAfterArchive(
  active: DisplayRecord | null,
  archivedThreadId: string,
) {
  return active?.id === archivedThreadId ? null : active;
}
