import { randomUUID } from 'node:crypto';

export interface ModelUploadUsage {
  epoch: string;
  revision: number;
  turnId: string;
  lastRequestBytes: number;
  turnBytes: number;
  requestCount: number;
}

export interface ModelUploadSource {
  read(threadId: string): ModelUploadUsage | null;
  subscribe(listener: (threadId: string, usage: ModelUploadUsage) => void): () => void;
}

export interface ModelRequestIdentity { threadId: string; turnId: string }

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

/** 只提取归属标识，不保留提示词、凭据或请求正文。 */
export function modelRequestIdentity(metadata: unknown): ModelRequestIdentity | undefined {
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { return; }
  }
  const value = metadata as Record<string, unknown> | undefined;
  if (identifier(value?.thread_id) && identifier(value?.turn_id)) {
    return { threadId: value.thread_id, turnId: value.turn_id };
  }
}

type Turn = { lastRequest: number; usage: ModelUploadUsage };
type Thread = { latest: Turn; turns: Map<string, Turn> };

export class ModelUploadMeter implements ModelUploadSource {
  private epoch = randomUUID();
  private sequence = 0;
  private revision = 0;
  private threads = new Map<string, Thread>();
  private listeners = new Set<(threadId: string, usage: ModelUploadUsage) => void>();
  private evictionListeners = new Set<(threadId: string) => void>();

  read(threadId: string): ModelUploadUsage | null {
    const usage = this.threads.get(threadId)?.latest.usage;
    return usage ? { ...usage } : null;
  }

  snapshot(): Map<string, ModelUploadUsage> {
    return new Map(Array.from(this.threads, ([threadId, thread]) => [threadId, { ...thread.latest.usage }]));
  }

  subscribe(listener: (threadId: string, usage: ModelUploadUsage) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  subscribeEvictions(listener: (threadId: string) => void) {
    this.evictionListeners.add(listener);
    return () => { this.evictionListeners.delete(listener); };
  }

  begin(identity: ModelRequestIdentity) {
    const request = ++this.sequence;
    let thread = this.threads.get(identity.threadId);
    let turn = thread?.turns.get(identity.turnId);
    if (!turn) {
      turn = { lastRequest: request, usage: {
        epoch: this.epoch, revision: 0, turnId: identity.turnId,
        lastRequestBytes: 0, turnBytes: 0, requestCount: 0,
      } };
      if (!thread) {
        thread = { latest: turn, turns: new Map() };
        this.threads.set(identity.threadId, thread);
      }
      thread.turns.set(identity.turnId, turn);
      thread.latest = turn;
      // 有界内存；旧回合仅用于防止迟到请求覆盖当前回合。
      while (thread.turns.size > 32) thread.turns.delete(thread.turns.keys().next().value!);
      while (this.threads.size > 2048) {
        const removed = this.threads.keys().next().value!;
        this.threads.delete(removed);
        for (const listener of this.evictionListeners) listener(removed);
      }
    }
    turn.lastRequest = request;
    turn.usage.lastRequestBytes = 0;
    turn.usage.requestCount++;
    const ownedThread = thread!;
    const ownedTurn = turn;
    let requestBytes = 0;
    // 只有成功交给上游传输层的载荷才计入；连接前失败不虚构上传量。
    return (bytes: number) => {
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || !Number.isSafeInteger(ownedTurn.usage.turnBytes + bytes)) return;
      requestBytes += bytes;
      ownedTurn.usage.turnBytes += bytes;
      if (ownedTurn.lastRequest === request) ownedTurn.usage.lastRequestBytes = requestBytes;
      ownedTurn.usage.revision = ++this.revision;
      if (ownedThread.latest === ownedTurn && this.threads.get(identity.threadId) === ownedThread) {
        for (const listener of this.listeners) listener(identity.threadId, { ...ownedTurn.usage });
      }
    };
  }
}
