import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import WebSocket from "ws";
import { compactTurnDetails } from "./turn-details.js";

export interface RpcMessage {
  id?: string | number;
  method?: string;
  params?: Record<string, any>;
  result?: unknown;
  error?: unknown;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_OPERATIONS = 2048;
const MAX_TRANSIENT_OPERATIONS = 512;
const MAX_IMAGE_READ_OPERATIONS = 32;
const MAX_STORED_OPERATIONS = 65_536;
const MAX_STORAGE_BYTES = 64 * 1024 * 1024;
const MAX_APPROVAL_BYTES = 2 * 1024 * 1024;
const MAX_SESSIONS = 128;
const MAX_EVENTS = 512;
const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TEXT = 32 * 1024;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const SNAPSHOT_TTL_MS = 60_000;
const SNAPSHOT_CURSOR_MIN = Number.MAX_SAFE_INTEGER - 1_000_000_000;
const IDLE_MS = 30 * 60 * 1000;
const READ_ONLY_METHODS = new Set([
  "thread/read", "thread/list", "thread/loaded/list", "thread/archive/list",
  "thread/turns/list", "thread/items/list", "permissionProfile/list", "plugin/list",
  "model/list", "account/read", "account/rateLimits/read", "config/read",
  "configRequirements/read", "skills/list", "mcpServerStatus/list",
  "fs/readFile", "mobile/turns/details",
]);

class HttpError extends Error {
  constructor(public status: number, message: string, public code = -32000) { super(message); }
}
const uncertain = () => new HttpError(503, "请求结果待确认，请刷新会话后检查，勿重复发送", -32004);

type Operation = {
  requestId: string;
  signature: string;
  status: "pending" | "completed" | "uncertain";
  message?: RpcMessage;
  promise?: Promise<RpcMessage>;
  durable?: boolean;
  connectionEpoch?: string;
  imageRead?: boolean;
};
type Event = { cursor: number; message: RpcMessage; bytes: number };
type Snapshot = { id: string; entries: Event[]; bytes: number; cursor: number; expiresAt: number };
type SnapshotPage = { snapshot: Snapshot; start: number };
type Waiting = { resolve: (message: RpcMessage) => void; reject: (error: Error) => void };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}`;
  return JSON.stringify(value) ?? "null";
}

// Bound arbitrary tool results as well as streaming fields before retaining them.
function bounded(value: any, depth = 0, budget = { remaining: 96 * 1024 }): any {
  if (budget.remaining < 16 || depth > 12) { budget.remaining -= 13; return "[truncated]"; }
  if (typeof value === "string") {
    const limit = Math.min(MAX_TEXT, budget.remaining);
    const fits = (length: number) => Buffer.byteLength(JSON.stringify(value.slice(0, length) + (length < value.length ? "\n[truncated]" : ""))) <= limit;
    let length = Math.min(value.length, MAX_TEXT);
    if (!fits(length)) {
      let low = 0; let high = length;
      while (low < high) { const middle = Math.ceil((low + high) / 2); if (fits(middle)) low = middle; else high = middle - 1; }
      length = low;
    }
    const result = value.slice(0, length) + (length < value.length ? "\n[truncated]" : "");
    budget.remaining -= Buffer.byteLength(JSON.stringify(result));
    return result;
  }
  if (Array.isArray(value)) {
    const result: unknown[] = []; budget.remaining -= 2;
    for (const entry of value.slice(0, 128)) {
      if (budget.remaining < 16) break;
      result.push(bounded(entry, depth + 1, budget)); budget.remaining--;
    }
    return result;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}; budget.remaining -= 2;
    for (const [key, entry] of Object.entries(value).slice(0, 128)) {
      const keyBytes = Buffer.byteLength(JSON.stringify(key)) + 2;
      if (budget.remaining < keyBytes + 16) break;
      budget.remaining -= keyBytes; result[key] = bounded(entry, depth + 1, budget);
    }
    return result;
  }
  budget.remaining -= Buffer.byteLength(JSON.stringify(value) ?? "null");
  return value;
}

class Session {
  epoch = randomUUID();
  updatedAt = Date.now();
  ready = false;
  socket?: WebSocket;
  connecting?: Promise<void>;
  initialized?: RpcMessage;
  initializing?: Promise<RpcMessage>;
  initializationMessage?: RpcMessage;
  initializedNotification = false;
  sentInitialized = false;
  sendingInitialized?: Promise<RpcMessage>;
  cursor = 0;
  history: Event[] = [];
  historyBytes = 0;
  snapshots = new Map<string, Event>();
  snapshotBytes = 0;
  snapshotPages = new Map<number, SnapshotPage>();
  frozenSnapshots = new Map<string, Snapshot>();
  frozenBytes = 0;
  nextSnapshotCursor = Number.MAX_SAFE_INTEGER;
  items = new Map<string, RpcMessage>();
  pending = new Map<string | number, RpcMessage>();
  running = new Set<string>();
  operations = new Map<string, Operation>();
  waiting = new Map<string | number, Waiting>();
  voices = new Set<WebSocket>();
  loadPromise: Promise<void>;
  pong = true;
  closed = false;
  storeQueue: Promise<void> = Promise.resolve();
  storedOperations = 0;
  storageBytes = 0;
  invalidatedSocket?: WebSocket;

  constructor(readonly id: string, private upstreamUrl: string, private root: string) {
    this.loadPromise = this.load();
  }

  get active() { return this.running.size > 0 || this.pending.size > 0; }
  touch() { this.updatedAt = Date.now(); }

  private async load() {
    const directory = join(this.root, this.id);
    let files: string[];
    try { files = await readdir(directory); } catch (error: any) { if (error.code === "ENOENT") return; throw error; }
    const records = files.filter((name) => name.endsWith(".json") && UUID.test(name.slice(0, -5)));
    for (let offset = 0; offset < records.length; offset += 32) {
      await Promise.all(records.slice(offset, offset + 32).map(async (name) => {
        const path = join(directory, name);
        const raw = await readFile(path, "utf8");
        // 旧版曾将 fs/readFile 当成写入操作，保存了大量 base64 图片响应。
        // 仅删除可确认已完成的图片读取结果，保留所有真正的写入记录。
        if (raw.includes('"dataBase64"')) {
          const record = JSON.parse(raw) as { status?: string; message?: { result?: { dataBase64?: unknown } } };
          if (record.status === "completed" && record.message?.result && Object.keys(record.message.result).length === 1 && typeof record.message.result.dataBase64 === "string") {
            await unlink(path);
            return;
          }
        }
        this.storedOperations++;
        this.storageBytes += Buffer.byteLength(raw);
      }));
    }
  }

  private async storedOperation(requestId: string) {
    const cached = this.operations.get(requestId);
    if (cached) return cached;
    let entry: Operation;
    try { entry = JSON.parse(await readFile(join(this.root, this.id, `${requestId}.json`), "utf8")); }
    catch (error: any) { if (error.code === "ENOENT") return undefined; throw error; }
    if (entry.requestId !== requestId || !/^[a-f0-9]{64}$/.test(entry.signature) || !["pending", "completed", "uncertain"].includes(entry.status)) throw new HttpError(503, "Invalid operation storage");
    if (entry.status === "pending") entry.status = "uncertain";
    entry.durable = true;
    return this.operations.get(requestId) ?? entry;
  }

  private trimOperations() {
    const durable = [...this.operations.values()].filter((entry) => entry.durable && entry.status !== "pending" && !entry.promise);
    while (this.operations.size > MAX_OPERATIONS + MAX_TRANSIENT_OPERATIONS && durable.length) this.operations.delete(durable.shift()!.requestId);
    const imageReads = [...this.operations.values()].filter((entry) => entry.imageRead && entry.status !== "pending" && !entry.promise);
    while (imageReads.length > MAX_IMAGE_READ_OPERATIONS) this.operations.delete(imageReads.shift()!.requestId);
  }

  private save(operation: Operation) {
    if (!operation.durable) return Promise.resolve();
    const serializable = { requestId: operation.requestId, signature: operation.signature, status: operation.status, ...(operation.message ? { message: operation.message } : {}) };
    const write = async () => {
      const directory = join(this.root, this.id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const target = join(directory, `${operation.requestId}.json`);
      const data = JSON.stringify(serializable);
      const previousSize = await stat(target).then((entry) => entry.size, (error: any) => { if (error.code === "ENOENT") return 0; throw error; });
      const size = Buffer.byteLength(data);
      if ((!previousSize && this.storedOperations >= MAX_STORED_OPERATIONS) || this.storageBytes - previousSize + size > MAX_STORAGE_BYTES) throw new HttpError(507, "Persistent operation storage is full");
      const temporary = join(directory, `${operation.requestId}.${randomUUID()}.tmp`);
      try {
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
        await rename(temporary, target);
      } finally { await unlink(temporary).catch(() => {}); }
      if (!previousSize) this.storedOperations++;
      this.storageBytes += size - previousSize;
      const dir = await open(directory, "r");
      try { await dir.sync(); } finally { await dir.close(); }
    };
    const result = this.storeQueue.then(write);
    this.storeQueue = result.catch(() => {});
    return result;
  }

  private discard(operation: Operation) {
    if (!operation.durable) return Promise.resolve();
    const remove = async () => {
      const directory = join(this.root, this.id);
      const target = join(directory, `${operation.requestId}.json`);
      const size = await stat(target).then((entry) => entry.size);
      await unlink(target); this.storedOperations--; this.storageBytes -= size;
      const dir = await open(directory, "r");
      try { await dir.sync(); } finally { await dir.close(); }
    };
    const result = this.storeQueue.then(remove);
    this.storeQueue = result.catch(() => {});
    return result;
  }

  private invalidate(socket: WebSocket) {
    if (this.invalidatedSocket === socket) return;
    this.invalidatedSocket = socket;
    this.ready = false; this.initialized = undefined; this.initializing = undefined;
    this.sentInitialized = false; this.sendingInitialized = undefined;
    this.epoch = randomUUID(); this.pending.clear(); this.running.clear(); this.history = []; this.historyBytes = 0;
    this.snapshots.clear(); this.snapshotBytes = 0; this.snapshotPages.clear(); this.frozenSnapshots.clear(); this.frozenBytes = 0; this.items.clear();
    for (const waiter of this.waiting.values()) waiter.reject(uncertain());
    this.waiting.clear();
    for (const voice of this.voices) voice.close(1011, "app-server disconnected");
  }

  async connect() {
    if (this.closed) throw new HttpError(503, "Session closed");
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting && this.socket?.readyState === WebSocket.CONNECTING) return this.connecting;
    if (this.socket) { this.invalidate(this.socket); this.socket.terminate(); }
    const connecting = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.upstreamUrl, { maxPayload: MAX_REQUEST_BYTES, handshakeTimeout: 10_000 });
      this.socket = socket;
      socket.once("open", () => { this.pong = true; resolve(); });
      socket.on("pong", () => { this.pong = true; });
      socket.on("message", (raw) => {
        if (this.socket !== socket) return;
        try { this.receive(JSON.parse(raw.toString())); } catch { socket.terminate(); }
      });
      socket.on("error", () => reject(new HttpError(503, "App-server unavailable")));
      socket.on("close", () => {
        if (this.socket === socket) this.invalidate(socket);
        reject(new HttpError(503, "App-server disconnected"));
      });
    });
    this.connecting = connecting;
    try { await connecting; } finally { if (this.connecting === connecting) this.connecting = undefined; }
  }

  private receive(message: RpcMessage) {
    this.touch();
    if (message.id != null && !message.method) {
      const waiter = this.waiting.get(message.id);
      if (waiter) { this.waiting.delete(message.id); waiter.resolve(message); }
      return;
    }
    if (message.method?.startsWith("thread/realtime/")) {
      for (const socket of this.voices) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      return;
    }
    if (message.method && message.id != null) {
      const bytes = Buffer.byteLength(JSON.stringify(message));
      const retainedBytes = [...this.pending].reduce((sum, [id, request]) => id === message.id ? sum : sum + Buffer.byteLength(JSON.stringify(request)), 0);
      if (this.pending.size >= 128 || bytes + retainedBytes > MAX_APPROVAL_BYTES) {
        this.socket?.send(JSON.stringify({ id: message.id, error: { code: -32001, message: "Approval request exceeds gateway capacity; request was not delivered to the user" } }));
        return;
      }
      this.pending.set(message.id, message);
      return;
    }
    if (!message.method) return;
    this.project(message);
  }

  private itemKey(params: Record<string, any>) { return `${params.threadId}:${params.turnId}:${params.item?.id ?? params.itemId}`; }

  private project(raw: RpcMessage) {
    let message: RpcMessage = { method: raw.method, ...(raw.params ? { params: bounded(raw.params) } : {}) };
    const params = message.params ?? {};
    const method = message.method!;
    const thread = String(params.threadId ?? params.thread?.id ?? "");
    const turn = String(params.turn?.id ?? params.turnId ?? "");
    if (method === "turn/started") this.running.add(`${thread}:${turn}`);
    if (method === "turn/completed") this.running.delete(`${thread}:${turn}`);
    if (method === "thread/status/changed") {
      const status = params.status?.type ?? params.status;
      if (status === "active" && ![...this.running].some((key) => key.startsWith(`${thread}:`))) this.running.add(`${thread}:status`);
      if (["idle", "notLoaded", "systemError"].includes(status)) {
        for (const key of this.running) if (key.startsWith(`${thread}:`)) this.running.delete(key);
      }
    }
    if (method === "turn/started" || method === "turn/completed") this.running.delete(`${thread}:status`);
    const deltaFields: Record<string, [string, string]> = {
      "item/agentMessage/delta": ["agentMessage", "text"],
      "item/commandExecution/outputDelta": ["commandExecution", "aggregatedOutput"],
      "item/fileChange/outputDelta": ["fileChange", "aggregatedOutput"],
      "item/reasoning/summaryTextDelta": ["reasoning", "text"],
      "item/reasoning/textDelta": ["reasoning", "text"],
    };
    const delta = deltaFields[method];
    if (delta) {
      const key = this.itemKey(params);
      const previous = this.items.get(key)?.params?.item ?? { id: params.itemId, type: delta[0] };
      const item = { ...previous, [delta[1]]: bounded(String(previous[delta[1]] ?? "") + String(params.delta ?? "")) };
      message = { method: "item/started", params: { threadId: params.threadId, turnId: params.turnId, item } };
      this.items.set(key, message);
      // Replace an unread contiguous item snapshot. Its new cursor still reaches clients that already polled.
      const last = this.history.at(-1);
      if (last?.message.method === "item/started" && this.itemKey(last.message.params ?? {}) === key) {
        this.history.pop(); this.historyBytes -= last.bytes;
      }
    } else if ((method === "item/started" || method === "item/completed") && params.item) {
      const key = this.itemKey(params);
      message = { ...message, params: { ...params, item: { ...this.items.get(key)?.params?.item, ...params.item } } };
      this.items.set(key, message);
    } else if (method === "item/fileChange/patchUpdated") {
      const key = this.itemKey(params);
      const previous = this.items.get(key);
      if (previous?.params?.item) {
        message = { method: "item/started", params: { ...previous.params, item: { ...previous.params.item, changes: params.changes ?? [] } } };
        this.items.set(key, message);
      }
    }
    // Merging sparse item updates must not grow the retained payload beyond the same budget.
    message = { method: message.method, ...(message.params ? { params: bounded(message.params) } : {}) };
    if (message.params?.item) this.items.set(this.itemKey(message.params), message);
    const bytes = Buffer.byteLength(JSON.stringify(message));
    const event = { cursor: ++this.cursor, message, bytes };
    this.history.push(event); this.historyBytes += bytes;
    const key = message.method?.startsWith("item/") && message.params?.item
      ? `item:${this.itemKey(message.params)}`
      : `${message.method}:${thread}:${turn}`;
    if (method === "turn/completed") {
      const startedKey = `turn/started:${thread}:${turn}`;
      this.snapshotBytes -= this.snapshots.get(startedKey)?.bytes ?? 0;
      this.snapshots.delete(startedKey);
    }
    this.snapshotBytes -= this.snapshots.get(key)?.bytes ?? 0;
    this.snapshots.delete(key); this.snapshots.set(key, event);
    this.snapshotBytes += bytes;
    while (this.history.length > MAX_EVENTS || this.historyBytes > MAX_EVENT_BYTES) this.historyBytes -= this.history.shift()!.bytes;
    while (this.snapshots.size > MAX_EVENTS || this.snapshotBytes > MAX_SNAPSHOT_BYTES) {
      const oldest = this.snapshots.keys().next().value!;
      const removed = this.snapshots.get(oldest)!;
      this.snapshotBytes -= removed.bytes; this.snapshots.delete(oldest);
      if (oldest.startsWith("item:") && this.items.get(oldest.slice(5)) === removed.message) this.items.delete(oldest.slice(5));
    }
    while (this.items.size > MAX_EVENTS) this.items.delete(this.items.keys().next().value!);
  }

  events(after: number) {
    this.touch();
    if (!this.ready) throw new HttpError(503, "Initialize session before polling events");
    this.pruneSnapshots();
    const continuation = this.snapshotPages.get(after);
    if (!continuation && after > this.cursor && after >= SNAPSHOT_CURSOR_MIN) throw new HttpError(503, "Snapshot page expired; bootstrap again");
    const reset = !continuation && (after > this.cursor || (this.history.length > 0 && after < this.history[0].cursor - 1));
    const available = continuation ? continuation.snapshot.entries : reset ? [...this.snapshots.values()].sort((a, b) => {
      const ap = a.message.params ?? {}; const bp = b.message.params ?? {};
      if (ap.threadId === bp.threadId && (ap.turn?.id ?? ap.turnId) === (bp.turn?.id ?? bp.turnId)) {
        if (a.message.method === "turn/completed" && b.message.params?.item) return 1;
        if (b.message.method === "turn/completed" && a.message.params?.item) return -1;
      }
      return a.cursor - b.cursor;
    }) : this.history.filter((entry) => entry.cursor > after);
    const messages: RpcMessage[] = [];
    const frozenCursor = continuation?.snapshot.cursor ?? this.cursor;
    let bytes = 2; let cursor = after; let index = continuation?.start ?? 0;
    for (; index < available.length; index++) {
      const event = available[index];
      const eventBytes = event.bytes + (messages.length ? 1 : 0);
      // An oversized first event must still advance the page, including frozen snapshots.
      if (messages.length && bytes + eventBytes > MAX_RESPONSE_BYTES) break;
      messages.push(event.message); bytes += eventBytes;
      cursor = event.cursor;
    }
    const hasMore = index < available.length;
    if (reset || continuation) {
      if (hasMore) {
        const snapshot = continuation?.snapshot ?? {
          id: randomUUID(), entries: available, bytes: available.reduce((total, event) => total + event.bytes, 0),
          cursor: frozenCursor, expiresAt: Date.now() + SNAPSHOT_TTL_MS,
        };
        if (snapshot.bytes > MAX_SNAPSHOT_BYTES || this.nextSnapshotCursor < SNAPSHOT_CURSOR_MIN) throw new HttpError(503, "Snapshot exceeds capacity; bootstrap again");
        if (!this.frozenSnapshots.has(snapshot.id)) {
          while (this.frozenBytes + snapshot.bytes > MAX_SNAPSHOT_BYTES && this.frozenSnapshots.size) this.releaseSnapshot(this.frozenSnapshots.keys().next().value!);
          this.frozenSnapshots.set(snapshot.id, snapshot); this.frozenBytes += snapshot.bytes;
        }
        cursor = this.nextSnapshotCursor--;
        this.snapshotPages.set(cursor, { snapshot, start: index });
        while (this.snapshotPages.size > 128) this.snapshotPages.delete(this.snapshotPages.keys().next().value!);
      } else {
        cursor = frozenCursor;
        if (continuation) this.releaseSnapshot(continuation.snapshot.id);
      }
    }
    return { epoch: this.epoch, cursor, messages, requests: [...this.pending.values()], active: this.active, updatedAt: this.updatedAt, reset, hasMore };
  }

  private releaseSnapshot(id: string) {
    const snapshot = this.frozenSnapshots.get(id);
    if (!snapshot) return;
    this.frozenSnapshots.delete(id); this.frozenBytes -= snapshot.bytes;
    for (const [token, page] of this.snapshotPages) if (page.snapshot.id === id) this.snapshotPages.delete(token);
  }

  private pruneSnapshots() {
    for (const [id, snapshot] of this.frozenSnapshots) if (Date.now() >= snapshot.expiresAt) this.releaseSnapshot(id);
  }

  private async initialize(message: RpcMessage) {
    await this.connect();
    const socket = this.socket;
    if (!this.initialized) {
      if (!this.initializing) {
        const initializing = this.exchange(message, socket).then((reply) => {
          if (this.socket !== socket || socket?.readyState !== WebSocket.OPEN) throw new HttpError(503, "Initialization connection changed");
          if (reply.error == null) {
            this.initialized = reply; this.initializationMessage = message; this.ready = true;
          }
          return reply;
        }).finally(() => { if (this.initializing === initializing) this.initializing = undefined; });
        this.initializing = initializing;
      }
      return this.initializing;
    }
    return this.initialized;
  }

  private async notifyInitialized(message: RpcMessage, socket = this.socket) {
    if (this.sendingInitialized) return this.sendingInitialized;
    if (this.sentInitialized) return {};
    const sending = this.exchange(message, socket);
    this.sendingInitialized = sending;
    try {
      const result = await sending;
      if (this.socket === socket) { this.initializedNotification = true; this.sentInitialized = true; }
      return result;
    } finally { if (this.sendingInitialized === sending) this.sendingInitialized = undefined; }
  }

  private async exchange(message: RpcMessage, socket = this.socket): Promise<RpcMessage> {
    if (!socket || this.socket !== socket || socket.readyState !== WebSocket.OPEN) throw new HttpError(503, "App-server unavailable");
    if (message.id == null) {
      await new Promise<void>((resolve, reject) => socket.send(JSON.stringify(message), (error) => error ? reject(error) : resolve()));
      return {};
    }
    const id = randomUUID();
    return new Promise<RpcMessage>((resolve, reject) => {
      const timeout = setTimeout(() => { this.waiting.delete(id); reject(uncertain()); }, 60_000);
      this.waiting.set(id, { resolve: (response) => { clearTimeout(timeout); resolve({ ...response, id: message.id }); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
      socket.send(JSON.stringify({ ...message, id }), (error) => {
        if (error) { const waiter = this.waiting.get(id); this.waiting.delete(id); waiter?.reject(uncertain()); }
      });
    });
  }

  private observeRpcState(request: RpcMessage, response: RpcMessage) {
    if (response.error != null || ![
      "turn/start", "turn/steer", "turn/interrupt", "turn/stop",
      "thread/resume", "thread/read", "thread/turns/list",
    ].includes(request.method ?? "")) return;
    const result = response.result as Record<string, any> | undefined;
    if (!result || typeof result !== "object") return;
    const thread = result.thread;
    const threadId = thread?.id ?? request.params?.threadId;
    if (typeof threadId !== "string" || !threadId) return;
    const status = thread?.status?.type ?? thread?.status;
    if (["idle", "notLoaded", "systemError"].includes(status)) {
      for (const key of this.running) if (key.startsWith(`${threadId}:`)) this.running.delete(key);
    }
    const turns = result.turn ? [result.turn] : Array.isArray(thread?.turns) ? thread.turns
      : request.method === "thread/turns/list" && Array.isArray(result.data) ? result.data : [];
    let progress = false;
    for (const turn of turns) {
      if (!turn?.id) continue;
      const key = `${threadId}:${turn.id}`;
      if (["inProgress", "in_progress", "running"].includes(turn.status)) { this.running.add(key); progress = true; }
      else if (["completed", "failed", "interrupted", "cancelled"].includes(turn.status)) this.running.delete(key);
    }
    if (progress) this.running.delete(`${threadId}:status`);
    else if (status === "active" && ![...this.running].some((key) => key.startsWith(`${threadId}:`))) this.running.add(`${threadId}:status`);
  }

  async rpc(requestId: string, message: RpcMessage, epoch?: string) {
    this.touch(); await this.loadPromise;
    const signature = createHash("sha256").update(canonical({ message, ...(!message.method && epoch ? { epoch } : {}) })).digest("hex");
    const durable = !message.method || (message.method !== "initialize" && message.id != null && !READ_ONLY_METHODS.has(message.method));
    const stored = await this.storedOperation(requestId);
    let previous = this.operations.get(requestId) ?? stored;
    if (previous && previous.signature !== signature) throw new HttpError(409, "Request ID already used with different content");
    if (previous && ["initialize", "initialized"].includes(message.method ?? "") &&
      (!this.ready || this.socket?.readyState !== WebSocket.OPEN || previous.connectionEpoch !== this.epoch)) {
      if (this.operations.get(requestId) === previous) this.operations.delete(requestId);
      previous = undefined;
    }
    if (previous) {
      if (previous.promise) return previous.promise;
      if (previous.status === "completed") return previous.message!;
      throw uncertain();
    }
    this.trimOperations();
    const pendingWrites = [...this.operations.values()].filter((entry) => entry.durable && entry.status === "pending").length;
    if (durable && pendingWrites >= MAX_OPERATIONS) throw new HttpError(429, "Too many pending writes");
    const transient = [...this.operations.values()].filter((entry) => !entry.durable);
    if (!durable && transient.length >= MAX_TRANSIENT_OPERATIONS) {
      const oldest = transient.find((entry) => entry.status !== "pending");
      if (!oldest) throw new HttpError(429, "Too many pending read operations");
      this.operations.delete(oldest.requestId);
    }
    const operation: Operation = { requestId, signature, status: "pending", durable, imageRead: message.method === "fs/readFile" };
    this.operations.set(requestId, operation);
    const execution = async () => {
      let recorded = false;
      let submitted = false;
      try {
        if (!message.method && epoch !== this.epoch) throw new HttpError(409, "Approval epoch is missing or stale");
        if (!message.method && (message.id == null || !this.pending.has(message.id))) throw new HttpError(409, "Approval request is not pending");
        if (message.method === "initialize") await this.connect();
        else if (!this.ready && READ_ONLY_METHODS.has(message.method ?? "") && this.initializationMessage) {
          const initialized = await this.initialize(this.initializationMessage);
          if (initialized.error != null) throw new HttpError(503, "Unable to reinitialize session");
          if (this.initializedNotification && !this.sentInitialized) await this.notifyInitialized({ method: "initialized", params: {} });
        }
        else if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) throw new HttpError(503, "Initialize session before sending RPC");
        const submittedSocket = this.socket;
        const submittedEpoch = this.epoch;
        operation.connectionEpoch = submittedEpoch;
        const submittedApproval = !message.method ? this.pending.get(message.id!) : undefined;
        // Durable write-ahead record must precede any upstream send.
        await this.save(operation); recorded = true;
        if (this.socket !== submittedSocket || this.epoch !== submittedEpoch || submittedSocket?.readyState !== WebSocket.OPEN ||
          (!message.method && this.pending.get(message.id!) !== submittedApproval)) throw new HttpError(503, "App-server changed before operation could be submitted");
        let result: RpcMessage;
        if (message.method === "initialize") {
          submitted = true;
          result = await this.initialize(message);
          result = { ...result, ...(message.id != null ? { id: message.id } : {}) };
        } else if (!message.method) {
          submitted = true;
          await new Promise<void>((resolve, reject) => submittedSocket.send(JSON.stringify(message), (error) => error ? reject(error) : resolve()));
          if (this.socket === submittedSocket && this.epoch === submittedEpoch && this.pending.get(message.id!) === submittedApproval) this.pending.delete(message.id!);
          result = { id: message.id, result: null };
        } else {
          submitted = true;
          if (message.method === "initialized") result = await this.notifyInitialized(message, submittedSocket);
          else if (message.method === "mobile/turns/details") {
            const params = message.params!;
            const upstream: RpcMessage = { id: message.id, method: "thread/turns/list", params: {
              threadId: params.threadId, ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
              limit: Math.min(params.limit ?? 5, 5), sortDirection: "desc", itemsView: "full",
            } };
            result = await this.exchange(upstream, submittedSocket);
            if (this.socket === submittedSocket && this.epoch === submittedEpoch) this.observeRpcState(upstream, result);
            if (result.error == null) result = { ...result, result: compactTurnDetails(result.result as Record<string, any>) };
          }
          else result = await this.exchange(message, submittedSocket);
        }
        if (this.socket === submittedSocket && this.epoch === submittedEpoch) this.observeRpcState(message, result);
        operation.status = "completed"; operation.message = result;
        await this.save(operation);
        return result;
      } catch (error) {
        if (recorded && submitted) { operation.status = "uncertain"; delete operation.message; await this.save(operation); throw uncertain(); }
        if (recorded) await this.discard(operation);
        if (this.operations.get(requestId) === operation) this.operations.delete(requestId);
        throw error;
      } finally { delete operation.promise; this.trimOperations(); }
    };
    operation.promise = execution();
    return operation.promise;
  }

  async operation(requestId: string) {
    await this.loadPromise;
    const operation = this.operations.get(requestId) ?? await this.storedOperation(requestId);
    if (!operation) throw new HttpError(404, "Operation not found");
    return { status: operation.status, ...(operation.message ? { message: operation.message } : {}) };
  }

  voice(socket: WebSocket) {
    this.touch(); this.voices.add(socket);
    socket.on("close", () => this.voices.delete(socket));
    socket.on("error", () => {});
    socket.on("message", async (raw) => {
      if (Buffer.byteLength(raw.toString()) > MAX_REQUEST_BYTES) { socket.close(1009, "Realtime message exceeds 16 MiB"); return; }
      let message: RpcMessage;
      try { message = JSON.parse(raw.toString()); } catch { socket.close(1007, "Invalid JSON"); return; }
      if (!message.method?.startsWith("thread/realtime/")) {
        socket.send(JSON.stringify({ id: message.id, error: { code: -32601, message: "Only thread/realtime RPC is allowed" } })); return;
      }
      try {
        if (!this.ready) throw new HttpError(503, "Session unavailable");
        const result = await this.exchange(message);
        if (message.id != null && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(result));
      } catch {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: message.id, error: { code: -32000, message: "Realtime unavailable" } }));
      }
    });
  }

  heartbeat() {
    this.pruneSnapshots();
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (!this.pong) { this.socket.terminate(); return; }
    this.pong = false; this.socket.ping();
  }

  async close() {
    this.closed = true;
    for (const voice of this.voices) voice.terminate();
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      const socket = this.socket;
      await new Promise<void>((resolve) => { socket.once("close", () => resolve()); socket.terminate(); });
    }
    await this.storeQueue;
  }
}

export class HttpSessions {
  private sessions = new Map<string, Session>();
  private timer: NodeJS.Timeout;
  private root: string;
  constructor(private options: { upstreamUrl: string; codexHome?: string }) {
    this.root = join(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"), "codex-mobile-http");
    this.timer = setInterval(() => {
      for (const [id, session] of this.sessions) {
        session.heartbeat();
        if (!session.active && !session.waiting.size && !session.voices.size && Date.now() - session.updatedAt > IDLE_MS) {
          this.sessions.delete(id); void session.close();
        }
      }
    }, 30_000);
    this.timer.unref();
  }

  private session(id: string | null) {
    if (!id || !UUID.test(id)) throw new HttpError(400, "sessionId must be a UUID");
    const existing = this.sessions.get(id);
    if (existing) return existing;
    if (this.sessions.size >= MAX_SESSIONS) throw new HttpError(429, "Too many sessions");
    const session = new Session(id, this.options.upstreamUrl, this.root);
    // Loading errors are returned by APIs rather than emitted as unhandled rejections.
    session.loadPromise.catch(() => {});
    this.sessions.set(id, session);
    return session;
  }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL) {
    try {
      const session = this.session(url.searchParams.get("sessionId"));
      let result: unknown;
      if (url.pathname === "/api/events" && request.method === "GET") {
        const after = Number(url.searchParams.get("after") ?? "0");
        if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400, "Invalid event cursor");
        result = session.events(after);
      } else if (url.pathname === "/api/operations" && request.method === "GET") {
        const id = url.searchParams.get("requestId") ?? "";
        if (!UUID.test(id)) throw new HttpError(400, "requestId must be a UUID");
        result = await session.operation(id);
      } else if (url.pathname === "/api/rpc" && request.method === "POST") {
        let bytes = 0; const parts: Buffer[] = [];
        for await (const chunk of request) {
          const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += part.length;
          if (bytes > MAX_REQUEST_BYTES) throw new HttpError(413, "Request exceeds 16 MiB");
          parts.push(part);
        }
        let body: any;
        try { body = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new HttpError(400, "Invalid JSON"); }
        if (!UUID.test(body?.requestId ?? "") || !body?.message || typeof body.message !== "object" || Array.isArray(body.message)) throw new HttpError(400, "Invalid RPC envelope");
        const message = body.message as RpcMessage;
        if (message.method === "initialize" && message.id == null) throw new HttpError(400, "Initialize must include an RPC id");
        if (message.id != null && !["number", "string"].includes(typeof message.id)) throw new HttpError(400, "Invalid RPC id");
        if (message.method != null && (typeof message.method !== "string" || !message.method.length || message.method.length > 256)) throw new HttpError(400, "Invalid RPC method");
        if (message.method === "mobile/turns/details") {
          const params = message.params;
          if (message.id == null || !params || Array.isArray(params) || typeof params.threadId !== "string" || !params.threadId.trim() ||
            (params.cursor !== undefined && typeof params.cursor !== "string") ||
            (params.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit <= 0)) ||
            (params.sortDirection !== undefined && params.sortDirection !== "desc")) throw new HttpError(400, "Invalid turn details parameters");
        }
        if (!message.method && message.result === undefined && message.error === undefined) throw new HttpError(400, "Invalid RPC reply");
        if (body.epoch !== undefined && (typeof body.epoch !== "string" || !UUID.test(body.epoch))) throw new HttpError(400, "Invalid session epoch");
        result = await session.rpc(body.requestId, message, body.epoch);
      } else throw new HttpError(405, "Method not allowed");
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = error instanceof HttpError ? error.status : 503;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: { code: error instanceof HttpError ? error.code : -32000, message: error instanceof HttpError ? error.message : "Session storage or upstream unavailable" } }));
    }
  }

  realtime(sessionId: string | null, client?: WebSocket) {
    const session = this.session(sessionId);
    if (!session.ready || session.socket?.readyState !== WebSocket.OPEN) throw new HttpError(503, "Initialize session before realtime");
    if (client) session.voice(client);
  }

  async close() {
    clearInterval(this.timer);
    await Promise.all([...this.sessions.values()].map((session) => session.close()));
    this.sessions.clear();
  }
}
