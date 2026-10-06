import { AppServerRpcError } from "./client";

type ThreadRecord = Record<string, any>;

interface ThreadSearchClient {
  request(
    method: string,
    params: unknown,
    options?: { timeoutMs?: number },
  ): Promise<any>;
}

interface ThreadSearchResult {
  thread: ThreadRecord;
  snippet: string;
}

interface ThreadSearchResponse {
  data: ThreadSearchResult[];
  nextCursor?: string | null;
}

interface ThreadListResponse {
  data: ThreadRecord[];
  nextCursor?: string | null;
}

const searchRequestOptions = { timeoutMs: 60_000 };

function threadTimestamp(thread: ThreadRecord) {
  return Number(thread.updatedAt ?? thread.createdAt ?? 0);
}

function isPersistentTopLevelThread(thread: ThreadRecord) {
  return thread.ephemeral !== true && !thread.parentThreadId;
}

function dedupeSearchRecords(records: ThreadRecord[]) {
  const unique = new Map<string, ThreadRecord>();
  for (const record of records) {
    const id = String(record.id ?? "").trim();
    if (!id || !isPersistentTopLevelThread(record)) continue;
    const current = unique.get(id);
    if (!current || threadTimestamp(record) > threadTimestamp(current)) {
      unique.set(id, record);
    }
  }
  return [...unique.values()].sort(
    (left, right) =>
      threadTimestamp(right) - threadTimestamp(left) ||
      String(left.id).localeCompare(String(right.id)),
  );
}

async function searchWithThreadSearch(
  client: ThreadSearchClient,
  searchTerm: string,
) {
  const records: ThreadRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const result: ThreadSearchResponse = await client.request(
      "thread/search",
      {
        searchTerm,
        limit: 50,
        sortKey: "updated_at",
        sortDirection: "desc",
        ...(cursor ? { cursor } : {}),
      },
      searchRequestOptions,
    );
    records.push(
      ...result.data.map(({ thread, snippet }) => ({
        ...thread,
        searchSnippet: snippet,
      })),
    );
    const nextCursor = result.nextCursor ?? null;
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);
  return dedupeSearchRecords(records);
}

async function searchWithThreadList(
  client: ThreadSearchClient,
  searchTerm: string,
) {
  const records: ThreadRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const result: ThreadListResponse = await client.request(
      "thread/list",
      {
        searchTerm,
        limit: 50,
        sortKey: "updated_at",
        ...(cursor ? { cursor } : {}),
      },
      searchRequestOptions,
    );
    records.push(
      ...result.data.map((thread) => ({
        ...thread,
        searchSnippet: String(thread.name ?? thread.preview ?? ""),
      })),
    );
    const nextCursor = result.nextCursor ?? null;
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);
  return dedupeSearchRecords(records);
}

export async function searchThreadRecords(
  client: ThreadSearchClient,
  query: string,
) {
  const searchTerm = query.trim();
  if (!searchTerm) return [];
  try {
    return await searchWithThreadSearch(client, searchTerm);
  } catch (reason) {
    if (!(reason instanceof AppServerRpcError) || reason.code !== -32601) {
      throw reason;
    }
    return searchWithThreadList(client, searchTerm);
  }
}
