export interface QueuedFollowUpRecord {
  id: string;
  threadId: string;
  draftContext: number;
  inputText: string;
  text: string;
}

export function queuedFollowUpsForThread<T extends QueuedFollowUpRecord>(
  queued: T[],
  threadId: string,
) {
  return queued.filter((item) => item.threadId === threadId);
}

export function hasQueuedFollowUpsForThread<T extends QueuedFollowUpRecord>(
  queued: T[],
  threadId: string,
) {
  return queued.some((item) => item.threadId === threadId);
}

export function updateQueuedFollowUpText<T extends QueuedFollowUpRecord>(
  queued: T[],
  id: string,
  inputText: string,
  text: string,
) {
  return queued.map((item) =>
    item.id === id ? { ...item, inputText, text } : item,
  );
}

export function removeQueuedFollowUp<T extends QueuedFollowUpRecord>(
  queued: T[],
  id: string,
) {
  return queued.filter((item) => item.id !== id);
}

export function rebindQueuedFollowUpsToContext<
  T extends QueuedFollowUpRecord,
>(queued: T[], threadId: string, draftContext: number) {
  return queued.map((item) =>
    item.threadId === threadId ? { ...item, draftContext } : item,
  );
}
