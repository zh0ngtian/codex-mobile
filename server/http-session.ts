import { SidechatHistory } from './sidechat-history.js';
import { sidechatReplayItems, type SidechatReplayOptions } from './sidechat-replay.js';
import { performance } from 'node:perf_hooks';
import { ResolvedRemoteTarget, TargetResolver } from './targets.js';
import { sameRemoteManaged } from './remote/runtime-state.js';
import type { OperationContext } from './operation-queue.js';
import type { GatewayAttachments } from './gateway-attachments.js';
import { RemoteStream, RemoteSendError } from './remote/relay.js';
import { assertRemoteOperation, captureRemoteOperation, runRemoteCleanup, withRemoteOperation } from './remote/operation-guard.js';
import type { RpcMessage as RemoteRpcMessage } from './remote/envelope.js';
import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import WebSocket from "ws";
import { TurnChangeHistory } from "./turn-change-history.js";
import { compactTurnDetails, compactTurnCommentary, turnCommentaryRequest, validTurnCommentaryParams } from "./turn-details.js";
import { isNavigationResume, canonicalRpc as canonical, rpcSignatureInput, rpcControlRequestKey } from "./rpc-replay.js";
import { InlineImages } from "./inline-images.js";
import { MessageWebCitations } from "./web-citations.js";
import { MessageTimestamps } from "./message-timestamps.js";
import type { BarkNotifications } from "./bark-notifications.js";
import { SidebarSummaryIndex, validSidebarParams } from "./sidebar-summary-index.js";
import type { ModelUploadSource, ModelUploadUsage } from './model-upload-meter.js';

export interface RpcMessage {
  id?: string | number;
  method?: string;
  params?: Record<string, any>;
  result?: unknown;
  error?: unknown;
}

/** 仅可信进程内部装配，不对应公开mode或host能力。 */
export interface HttpSessionRemoteOptions {
  target: ResolvedRemoteTarget;
  resolver: TargetResolver;
  context: OperationContext;
  storageNamespace: string;
  projections: {
    changeHistory: Pick<TurnChangeHistory, 'observe' | 'beforeStart' | 'cancelStart' | 'get' | 'flush'>;
    images: Pick<InlineImages, 'result' | 'notification'>;
    timestamps: Pick<MessageTimestamps, 'result' | 'notification'>;
    webCitations: Pick<MessageWebCitations, 'result' | 'notification'>;
  };
  sidechatReplay: Required<Pick<SidechatReplayOptions, 'files' | 'resolveReference'>>;
  isAvailable?: () => boolean;
}
export interface SessionCallOptions { deadline: number; signal?: AbortSignal }
/** 仅可信scheduler传入；attemptId沿用本次ledger claim token，不能由HTTP参数构造。 */
export interface SessionDispatchAttempt { sessionId: string; requestId: string; attemptId: string }
export type SessionDispatchResult = Readonly<
  { outcome: 'response'; message: RpcMessage } | { outcome: 'neverSent' | 'unknown'; error: unknown }
>;
type SessionSocket = WebSocket | RemoteStream;
type SessionCall = SessionCallOptions & { guardLocalSend?: true; onSubmitted?: () => void; onSendRejected?: () => void; dispatch?: { neverSent: boolean } };
const sessionCall = (): SessionCallOptions => ({ deadline: performance.now() + 60_000 });
function assertCall(call: SessionCallOptions) {
  if (call.signal?.aborted || !Number.isFinite(call.deadline) || performance.now() >= call.deadline) throw new RemoteSendError('Remote 操作已取消或超时', false, undefined, 'timeout');
}

async function authorizeSession(remote: HttpSessionRemoteOptions, call: SessionCallOptions) {
  assertRemoteOperation(); assertCall(call);
  const scope = await remote.target.remoteScope(call.signal);
  if (remote.context.mode !== 'remote' || !sameRemoteManaged(scope.managed, remote.context.managed) ||
    Object.hasOwn(scope.managed, 'userId') !== Object.hasOwn(remote.context.managed, 'userId'))
    throw new TypeError('Remote session 当前传输与原managed身份不一致');
  // 当前handle与原context恢复授权必须来自resolver的同一真实当前代，不能拼接另一个Runtime。
  const current = await remote.resolver.resolve({ mode: 'remote', gatewayId: remote.context.gatewayId, account: {
    accountId: remote.context.managed.accountId, accountUserId: remote.context.managed.accountUserId,
    ...(Object.hasOwn(remote.context.managed, 'userId') ? { userId: remote.context.managed.userId } : {}),
  }, target: remote.context.target }, call.signal);
  const descriptor = remote.target.descriptor;
  if (!current.sharesRuntime(remote.target) || current.descriptor.generation !== descriptor.generation || current.descriptor.authorizationKey !== descriptor.authorizationKey ||
    current.descriptor.transportNamespace !== descriptor.transportNamespace)
    throw new TypeError('Remote session 当前传输不属于resolver当前授权代');
  const fence = await remote.resolver.authorizeOperationExecution(remote.context, call.signal);
  assertCall(call); await remote.target.assertCurrent(call.signal);
  fence.assertCurrent(); assertCall(call);
  return fence;
}

export interface PublicRpcEnvelope { requestId: string; message: RpcMessage; epoch?: string }
export async function readRpcEnvelope(request: IncomingMessage): Promise<PublicRpcEnvelope> {
  let bytes = 0; const parts: Buffer[] = [];
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += part.length;
    if (bytes > MAX_REQUEST_BYTES) throw new HttpError(413, "Request exceeds 16 MiB");
    parts.push(part);
  }
  let body: any;
  try { body = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new HttpError(400, "Invalid JSON"); }
  return validateRpcEnvelope(body);
}
export function validateRpcEnvelope(body: any): PublicRpcEnvelope {
  if (!UUID.test(body?.requestId ?? "") || !body?.message || typeof body.message !== "object" || Array.isArray(body.message)) throw new HttpError(400, "Invalid RPC envelope");
  const message = body.message as RpcMessage;
  if (message.method === "initialize" && message.id == null) throw new HttpError(400, "Initialize must include an RPC id");
  if (message.id != null && !["number", "string"].includes(typeof message.id)) throw new HttpError(400, "Invalid RPC id");
  if (message.method != null && (typeof message.method !== "string" || !message.method.length || message.method.length > 256)) throw new HttpError(400, "Invalid RPC method");
  if (message.method === "mobile/turns/commentary" &&
    (message.id == null || !validTurnCommentaryParams(message.params))) throw new HttpError(400, "Invalid turn commentary parameters");
  if (message.method === "mobile/turns/details") {
    const params = message.params;
    if (message.id == null || !params || Array.isArray(params) || typeof params.threadId !== "string" || !params.threadId.trim() ||
      (params.cursor !== undefined && typeof params.cursor !== "string") ||
      (params.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit <= 0)) ||
      (params.sortDirection !== undefined && params.sortDirection !== "desc")) throw new HttpError(400, "Invalid turn details parameters");
  }
  if (!message.method && message.result === undefined && message.error === undefined) throw new HttpError(400, "Invalid RPC reply");
  if (body.epoch !== undefined && (typeof body.epoch !== "string" || !UUID.test(body.epoch))) throw new HttpError(400, "Invalid session epoch");
  return body;
}

const SIDECHAT_SESSION_ID = "c0dec000-0000-4000-8000-000000000002";
/** 可信内部hosted派发沿用旧FollowUps的Session/WAL身份；公开HTTP仍保留拒绝。 */
export const HOSTED_SESSION_ID = "c0dec000-0000-4000-8000-000000000001";
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
  "thread/read", "threadSection/list", "thread/list", "thread/loaded/list", "thread/archive/list",
  "thread/turns/list", "thread/items/list", "permissionProfile/list", "plugin/list",
  "model/list", "account/read", "account/rateLimits/read", "config/read",
  "configRequirements/read", "skills/list", "mcpServerStatus/list",
  "fs/readFile", "mobile/turns/details", "mobile/turns/commentary",
  "mobile/sidebar/summaries", "mobile/sidebar/projectless", "mobile/uploadUsage/read",
  "mobile/thread/observe",
]);

/** 与Session WAL共用分类；调用方的readOnly标记不参与判断。 */
export function isReadOnlyRpc(message: RpcMessage): boolean {
  return typeof message.method === 'string' && (READ_ONLY_METHODS.has(message.method) || isNavigationResume(message));
}

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
  threadId?: string; method?: string;
};

async function readStoredOperation(root: string, sessionId: string, requestId: string): Promise<Operation | undefined> {
  let entry: Operation;
  try { entry = JSON.parse(await readFile(join(root, sessionId, `${requestId}.json`), "utf8")); }
  catch (error: any) { if (error.code === "ENOENT") return undefined; throw error; }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.requestId !== requestId ||
    !/^[a-f0-9]{64}$/.test(entry.signature) || !["pending", "completed", "uncertain"].includes(entry.status))
    throw new HttpError(503, "Invalid operation storage");
  if (entry.status === "pending") entry.status = "uncertain";
  entry.durable = true;
  return entry;
}

/** 仅可信内部读取原WAL；不依赖当前传输handle，不创建Session或发送上游RPC。
 * 404仅表示原namespace缺失记录，绝不是neverSent证明。 */
export async function readOriginalOperation(options: {
  gatewayCodexHome: string; resolver: TargetResolver; context: OperationContext;
  sessionId: string; requestId: string; call: SessionCallOptions; expected?: { message: RpcMessage; epoch?: string }; expectedSignature?: string;
}) {
  // 第一个await前固定完整原绑定和原预算；保留userId存在性，不能随调用者异步换绑。
  const { gatewayCodexHome, resolver, sessionId, requestId } = options;
  const expectedSignature = options.expectedSignature;
  const expected = options.expected ? structuredClone(options.expected) : undefined;
  if (expectedSignature !== undefined && !/^[a-f0-9]{64}$/.test(expectedSignature)) throw new TypeError('需要合法原WAL签名');
  const expectedHash = expected ? createHash('sha256').update(rpcSignatureInput(expected.message, expected.epoch)).digest('hex') : undefined;
  const context = structuredClone(options.context);
  if (context.mode === 'remote') { Object.freeze(context.managed); Object.freeze(context.target); }
  Object.freeze(context);
  const call = { deadline: options.call.deadline, signal: options.call.signal };
  if (!(resolver instanceof TargetResolver) || typeof gatewayCodexHome !== 'string' || !gatewayCodexHome ||
    !UUID.test(sessionId) || !UUID.test(requestId) || sessionId === SIDECHAT_SESSION_ID)
    throw new TypeError('原收据读取需要显式网关目录、可信resolver与原Session/requestId');
  const { entry, originalFence, finalFence } = await withRemoteOperation(() => assertCall(call), async () => {
    const originalFence = await resolver.authorizeOperation(context, 'read', call.signal);
    originalFence(); assertRemoteOperation();
    const root = context.mode === 'local' ? join(gatewayCodexHome, 'codex-mobile-http') :
      join(gatewayCodexHome, 'codex-mobile-http', 'remote', createHash('sha256').update(JSON.stringify(['transport-v1', 'remote', context.authorizationKey])).digest('hex'));
    const entry = await readStoredOperation(root, sessionId, requestId);
    originalFence(); assertRemoteOperation();
    const finalFence = await resolver.authorizeOperation(context, 'read', call.signal);
    originalFence(); finalFence(); assertCall(call); assertRemoteOperation();
    return { entry, originalFence, finalFence };
  });
  // 包括guard包装Promise在内的最后await之后，再同步核验两道真实fence与原父预算。
  originalFence(); finalFence(); assertCall(call); assertRemoteOperation();
  if (!entry) throw new HttpError(404, 'Operation not found');
  if ((expectedHash && entry.signature !== expectedHash) || (expectedSignature && entry.signature !== expectedSignature)) throw new HttpError(409, 'Original operation signature conflict');
  return { status: entry.status, ...(entry.message ? { message: entry.message } : {}) };
}

type Event = { cursor: number; message: RpcMessage; bytes: number };
type Snapshot = { id: string; entries: Event[]; bytes: number; cursor: number; expiresAt: number };
type SnapshotPage = { snapshot: Snapshot; start: number };
type Waiting = { resolve: (message: RpcMessage) => void; reject: (error: Error) => void };

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
  socket?: SessionSocket;
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
  private loadInterrupted = false;
  pong = true;
  closed = false;
  storeQueue: Promise<void> = Promise.resolve();
  notificationQueue: Promise<void> = Promise.resolve();
  storedOperations = 0;
  storageBytes = 0;
  invalidatedSocket?: SessionSocket;

  constructor(readonly id: string, private upstreamUrl: string, private root: string, private changeHistory: HttpSessionRemoteOptions['projections']['changeHistory'], private images: HttpSessionRemoteOptions['projections']['images'], private timestamps: HttpSessionRemoteOptions['projections']['timestamps'], private webCitations: HttpSessionRemoteOptions['projections']['webCitations'], private notifications?: BarkNotifications, private hostedObserver?: (message?: RpcMessage) => void, private hostedReply?: (requestId: string, message: RpcMessage, call: SessionCallOptions) => Promise<RpcMessage | undefined>, private memoryOnly = false, private onAuthModeChanged?: (mode: string | null) => void, private remote?: HttpSessionRemoteOptions, private loadCheck?: () => void, private gatewayRpc?: (message: RpcMessage, call: SessionCallOptions) => Promise<RpcMessage>) {
    this.loadPromise = memoryOnly ? Promise.resolve() : this.load();
  }

  get active() { return this.running.size > 0 || this.pending.size > 0; }
  touch() { this.updatedAt = Date.now(); }

  private async load() {
    const interrupted = new Set<unknown>();
    const check = () => {
      try { if (this.remote) { this.loadCheck!(); assertRemoteOperation(); } }
      catch (error) { interrupted.add(error); throw error; }
    };
    let storedOperations = 0, storageBytes = 0;
    try {
      check();
      const directory = join(this.root, this.id);
      let files: string[];
      try { files = await readdir(directory); } catch (error: any) { if (error.code === "ENOENT") files = []; else throw error; }
      check();
      const records = files.filter((name) => name.endsWith(".json") && UUID.test(name.slice(0, -5)));
      for (let offset = 0; offset < records.length; offset += 32) {
        const results = await Promise.allSettled(records.slice(offset, offset + 32).map(async (name) => {
          check();
          const path = join(directory, name);
          const raw = await readFile(path, "utf8");
          check();
          // 旧版曾将 fs/readFile 当成写入操作，保存了大量 base64 图片响应。
          // 仅删除可确认已完成的图片读取结果，保留所有真正的写入记录。
          if (raw.includes('"dataBase64"')) {
            const record = JSON.parse(raw) as { status?: string; message?: { result?: { dataBase64?: unknown } } };
            if (record.status === "completed" && record.message?.result && Object.keys(record.message.result).length === 1 && typeof record.message.result.dataBase64 === "string") {
              await unlink(path);
              return;
            }
          }
          storedOperations++;
          storageBytes += Buffer.byteLength(raw);
        }));
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        // 必须等旧批全部实际结束；真实IO/坏记录不能被同时发生的取消掩盖。
        const failure = failures.find(result => !interrupted.has(result.reason)) ?? failures[0];
        if (failure) throw failure.reason;
      }
      check();
      this.storedOperations = storedOperations; this.storageBytes = storageBytes;
    } catch (error) {
      this.loadInterrupted = interrupted.has(error);
      throw error;
    }
  }

  resumeLoad(authorize: () => void) {
    if (!this.loadInterrupted || this.closed) return;
    authorize();
    this.loadInterrupted = false;
    this.loadCheck = authorize;
    this.loadPromise = this.load();
    this.loadPromise.catch(() => {});
  }

  private async storedOperation(requestId: string) {
    const cached = this.operations.get(requestId);
    if (cached) return cached;
    const entry = await readStoredOperation(this.root, this.id, requestId);
    return this.operations.get(requestId) ?? entry;
  }

  private trimOperations() {
    const durable = [...this.operations.values()].filter((entry) => entry.durable && entry.status !== "pending" && !entry.promise);
    while (this.operations.size > MAX_OPERATIONS + MAX_TRANSIENT_OPERATIONS && durable.length) this.operations.delete(durable.shift()!.requestId);
    const imageReads = [...this.operations.values()].filter((entry) => entry.imageRead && entry.status !== "pending" && !entry.promise);
    while (imageReads.length > MAX_IMAGE_READ_OPERATIONS) this.operations.delete(imageReads.shift()!.requestId);
  }

  private save(operation: Operation, onPublishing?: () => void) {
    if (!operation.durable) return Promise.resolve();
    const serializable = { requestId: operation.requestId, signature: operation.signature, status: operation.status, ...(operation.message ? { message: operation.message } : {}) };
    const write = async () => {
      const directory = join(this.root, this.id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // New root/session directory entries must be durable before a WAL can authorize upstream send.
      for (const parentPath of [this.root, dirname(this.root)]) {
        const parent = await open(parentPath, "r");
        try { await parent.sync(); } finally { await parent.close(); }
      }
      const target = join(directory, `${operation.requestId}.json`);
      const data = JSON.stringify(serializable);
      const previousSize = await stat(target).then((entry) => entry.size, (error: any) => { if (error.code === "ENOENT") return 0; throw error; });
      const size = Buffer.byteLength(data);
      if ((!previousSize && this.storedOperations >= MAX_STORED_OPERATIONS) || this.storageBytes - previousSize + size > MAX_STORAGE_BYTES) throw new HttpError(507, "Persistent operation storage is full");
      const temporary = join(directory, `${operation.requestId}.${randomUUID()}.tmp`);
      try {
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
        // rename或之后的目录fsync失败仍可能留下WAL，不能以save未完成推断未落盘。
        onPublishing?.();
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

  private invalidate(socket: SessionSocket) {
    if (this.invalidatedSocket === socket) return;
    this.invalidatedSocket = socket;
    this.hostedObserver?.();
    this.ready = false; this.initialized = undefined; this.initializing = undefined;
    this.sentInitialized = false; this.sendingInitialized = undefined;
    this.epoch = randomUUID(); if (this.memoryOnly) this.operations.clear(); this.pending.clear(); this.running.clear(); this.history = []; this.historyBytes = 0;
    this.snapshots.clear(); this.snapshotBytes = 0; this.snapshotPages.clear(); this.frozenSnapshots.clear(); this.frozenBytes = 0; this.items.clear();
    for (const waiter of this.waiting.values()) waiter.reject(uncertain());
    this.waiting.clear();
    for (const voice of this.voices) voice.close(1011, "app-server disconnected");
  }

  get open() { return this.isOpen(this.socket); }
  private isOpen(socket: SessionSocket | undefined): socket is SessionSocket {
    return !!socket && (socket instanceof RemoteStream ? !socket.closed : socket.readyState === WebSocket.OPEN);
  }
  private closingStreams = new Set<Promise<void>>();
  private streamClosures = new WeakMap<RemoteStream, Promise<void>>();
  private closeSocket(socket: SessionSocket): Promise<void> {
    if (socket instanceof RemoteStream) {
      const existing = this.streamClosures.get(socket);
      if (existing) return existing;
      let resolve!: () => void; let reject!: (error: unknown) => void;
      // 在调用close及其同步监听前先固定同一实际屏障，重入也必须等待物理提交。
      const closing = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
      this.streamClosures.set(socket, closing); this.closingStreams.add(closing);
      try {
        const actual = runRemoteCleanup(() => { try { return socket.close(); } catch { return socket.close(); } });
        void actual.then(resolve, reject);
      } catch (error) { reject(error); }
      void closing.finally(() => this.closingStreams.delete(closing)).catch(() => {});
      return closing;
    }
    if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise(resolve => { socket.once('close', () => resolve()); socket.terminate(); });
  }
  private authorization(call: SessionCallOptions) { return authorizeSession(this.remote!, call); }

  private async send(message: RpcMessage, socket: SessionSocket, call: SessionCall) {
    if (!(socket instanceof RemoteStream)) {
      const bytes = JSON.stringify(message);
      // 仅可信派发沿原call传递；序列化完成后仍须在物理send前同步核验。
      if (call.guardLocalSend) { assertCall(call); assertRemoteOperation(); }
      await new Promise<void>((resolve, reject) => socket.send(bytes, error => error ? reject(error) : resolve())); return;
    }
    let committed = false;
    const originalSequence = socket.lastSentSeqId;
    try {
      const fence = await this.authorization(call);
      await withRemoteOperation(() => { assertCall(call); fence.assertLive(); }, async () => {
        if (this.closed || this.socket !== socket || !this.isOpen(socket)) throw new RemoteSendError('Remote session 已失效', false);
        fence.assertCurrent(); assertCall(call);
        const previousSequence = socket.lastSentSeqId;
        const sending = socket.send(message as RemoteRpcMessage, call.deadline);
        // Relay第一帧实际调用send前同步commit；回调/响应可以任意交错，WAL须立即可见。
        if (socket.lastSentSeqId > previousSequence) { committed = true; call.onSubmitted?.(); }
        await sending; committed = true; call.onSubmitted?.();
      });
    } catch (error) {
      // 仅此真实stream发送边界能记录零发送；业务投影抛出的同名错误不能生成证明。
      if (!committed && socket.lastSentSeqId === originalSequence) call.onSendRejected?.();
      if (error instanceof RemoteSendError) { if (error.mayHaveBeenSent) call.onSubmitted?.(); throw error; }
      if (committed) call.onSubmitted?.();
      throw new RemoteSendError('Remote 发送被拒绝', committed);
    }
  }
  private onMessage(message: RpcMessage, socket: SessionSocket) {
    if (this.socket !== socket || !this.isOpen(socket)) return;
    if (message.method && (this.remote || (message.id == null && !message.method.startsWith('thread/realtime/')))) {
      const epoch = this.epoch; const call: SessionCall = sessionCall();
      this.notificationQueue = this.notificationQueue.then(async () => {
        const fence = this.remote ? await this.authorization(call) : undefined;
        const project = async () => {
          const projected = this.memoryOnly || message.id != null || message.method?.startsWith('thread/realtime/') ? message : await this.webCitations.notification(await this.timestamps.notification(await this.images.notification(message)));
          if (fence) { fence.assertCurrent(); assertCall(call); assertRemoteOperation(); }
          if (this.socket === socket && this.epoch === epoch && this.isOpen(socket)) this.receive(projected);
        };
        if (fence) await withRemoteOperation(() => { assertCall(call); fence.assertLive(); }, project);
        else await project();
      }).catch(() => { void this.closeSocket(socket).catch(() => {}); });
    } else this.receive(message);
  }
  async connect(call: SessionCall = sessionCall()) {
    if (this.closed) throw new HttpError(503, 'Session closed');
    if (this.isOpen(this.socket)) return;
    if (this.connecting) return this.connecting;
    if (this.socket) { this.invalidate(this.socket); await this.closeSocket(this.socket).catch(() => {}); }
    const connecting = this.remote ? (async () => {
      const fence = await this.authorization(call);
      let stream: RemoteStream | undefined;
      try {
        await withRemoteOperation(() => { assertCall(call); fence.assertLive(); }, async () => {
          stream = await this.remote!.target.createRawStream(call.signal);
          await this.remote!.target.assertCurrent(call.signal);
          fence.assertCurrent(); assertCall(call);
          if (this.closed) throw new HttpError(503, 'Session closed');
          this.socket = stream;
          stream.on('message', message => this.onMessage(message, stream!));
          stream.on('disconnect', () => { if (this.socket === stream) this.invalidate(stream!); void this.closeSocket(stream!).catch(() => {}); });
          stream.on('close', () => { if (this.socket === stream) this.invalidate(stream!); });
        });
      } catch (error) { if (stream) await this.closeSocket(stream).catch(() => {}); throw error; }
    })() : new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.upstreamUrl, { maxPayload: MAX_REQUEST_BYTES, handshakeTimeout: 10_000 });
      this.socket = socket;
      socket.once('open', () => { this.pong = true; resolve(); });
      socket.on('pong', () => { this.pong = true; });
      socket.on('message', raw => {
        if (this.socket !== socket) return;
        try { this.onMessage(JSON.parse(raw.toString()), socket); } catch { socket.terminate(); }
      });
      socket.on('error', () => reject(new HttpError(503, 'App-server unavailable')));
      socket.on('close', () => { if (this.socket === socket) this.invalidate(socket); reject(new HttpError(503, 'App-server disconnected')); });
    });
    this.connecting = connecting;
    try { await connecting; } finally { if (this.connecting === connecting) this.connecting = undefined; }
  }

  mirror(message: RpcMessage, transient = false) {
    if (message.method && message.id != null) {
      const bytes = Buffer.byteLength(JSON.stringify(message));
      const retained = [...this.pending.values()].reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0);
      if ((!this.pending.has(message.id) && this.pending.size >= 128) || retained + bytes > MAX_APPROVAL_BYTES) return;
      this.pending.set(message.id, message); return;
    }
    this.receive(message, transient);
  }

  private receive(message: RpcMessage, transient = false) {
    if (message.method === 'account/updated') this.onAuthModeChanged?.(message.params?.authMode ?? null);
    // Remote RPC响应先仅结算waiter；派生历史必须由RPC最终授权后观察。
    if (!this.memoryOnly && !transient && (!this.remote || message.method != null)) this.changeHistory.observe(message);
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
        if (this.socket) void this.send({ id: message.id, error: { code: -32001, message: 'Approval request exceeds gateway capacity; request was not delivered to the user' } }, this.socket, sessionCall()).catch(() => {});
        return;
      }
      this.pending.set(message.id, message);
      this.notifications?.observe(message);
      this.hostedObserver?.(message);
      return;
    }
    if (!message.method) return;
    this.hostedObserver?.(message);
    if (message.method === "serverRequest/resolved") {
      const params = message.params ?? {};
      const request = this.pending.get(params.requestId);
      if (request && request.params?.threadId === params.threadId) this.pending.delete(params.requestId);
    }
    this.project(message);
  }

  forgetThread(threadId: string) {
    const belongs = (message: RpcMessage) => message.params?.threadId === threadId || message.params?.thread?.id === threadId;
    this.history = this.history.filter(event => !belongs(event.message));
    this.historyBytes = this.history.reduce((sum, event) => sum + event.bytes, 0);
    for (const [key, event] of this.snapshots) if (belongs(event.message)) this.snapshots.delete(key);
    this.snapshotBytes = [...this.snapshots.values()].reduce((sum, event) => sum + event.bytes, 0);
    for (const [key, message] of this.items) if (belongs(message)) this.items.delete(key);
    for (const [key, message] of this.pending) if (belongs(message)) this.pending.delete(key);
    for (const key of this.running) if (key.startsWith(`${threadId}:`)) this.running.delete(key);
    for (const [key, operation] of this.operations) if (this.memoryOnly && operation.threadId === threadId && operation.method !== 'thread/unsubscribe') this.operations.delete(key);
    const snapshots = new Set([...this.frozenSnapshots.values(), ...[...this.snapshotPages.values()].map(page => page.snapshot)]);
    for (const snapshot of snapshots) {
      const old = snapshot.entries;
      for (const page of this.snapshotPages.values()) if (page.snapshot === snapshot) page.start = old.slice(0, page.start).filter(event => !belongs(event.message)).length;
      snapshot.entries = old.filter(event => !belongs(event.message));
      snapshot.bytes = snapshot.entries.reduce((sum, event) => sum + event.bytes, 0);
    }
    this.frozenBytes = [...this.frozenSnapshots.values()].reduce((sum, snapshot) => sum + snapshot.bytes, 0);
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
    this.notifications?.observe(message);
    const bytes = Buffer.byteLength(JSON.stringify(message));
    const event = { cursor: ++this.cursor, message, bytes };
    this.history.push(event); this.historyBytes += bytes;
    // Origin authorization is a live event, never a reconnect/reset snapshot or durable operation replay.
    if (method === "mobile/turn/accepted") {
      while (this.history.length > MAX_EVENTS || this.historyBytes > MAX_EVENT_BYTES) this.historyBytes -= this.history.shift()!.bytes;
      return;
    }
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
        if (continuation) snapshot.expiresAt = Date.now() + SNAPSHOT_TTL_MS;
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

  private async initialize(message: RpcMessage, call: SessionCall = sessionCall()) {
    await this.connect(call);
    const socket = this.socket;
    if (!this.initialized) {
      if (!this.initializing) {
        const initializing = this.exchange(message, socket, call).then((reply) => {
          if (this.socket !== socket || !this.isOpen(socket)) throw new HttpError(503, "Initialization connection changed");
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

  private async notifyInitialized(message: RpcMessage, socket = this.socket, call: SessionCall = sessionCall()) {
    if (this.sendingInitialized) return this.sendingInitialized;
    if (this.sentInitialized) return {};
    const sending = this.exchange(message, socket, call);
    this.sendingInitialized = sending;
    try {
      const result = await sending;
      if (this.socket === socket) { this.initializedNotification = true; this.sentInitialized = true; }
      return result;
    } finally { if (this.sendingInitialized === sending) this.sendingInitialized = undefined; }
  }

  private async exchange(message: RpcMessage, socket = this.socket, call: SessionCall = sessionCall()): Promise<RpcMessage> {
    if (!socket || this.socket !== socket || !this.isOpen(socket)) throw new HttpError(503, 'App-server unavailable');
    if (message.id == null) { await this.send(message, socket, call); return {}; }
    const id = randomUUID();
    return new Promise<RpcMessage>((resolve, reject) => {
      const timeout = setTimeout(() => { this.waiting.delete(id); reject(uncertain()); }, Math.max(0, call.deadline - performance.now()));
      const abort = () => { this.waiting.delete(id); clearTimeout(timeout); reject(uncertain()); };
      call.signal?.addEventListener('abort', abort, { once: true });
      const done = () => { clearTimeout(timeout); call.signal?.removeEventListener('abort', abort); };
      this.waiting.set(id, { resolve: response => { done(); resolve({ ...response, id: message.id }); }, reject: error => { done(); reject(error); } });
      void this.send({ ...message, id }, socket, call).catch(error => {
        const waiter = this.waiting.get(id); this.waiting.delete(id); waiter?.reject(error);
      });
    });
  }

  private observeRpcState(request: RpcMessage, response: RpcMessage) {
    if (!this.memoryOnly) this.notifications?.observeRpc(request, response);
    if (response.error != null || ![
      "turn/start", "turn/steer", "turn/interrupt", "turn/stop",
      "thread/resume", "thread/read", "thread/turns/list",
    ].includes(request.method ?? "")) return;
    const result = response.result as Record<string, any> | undefined;
    if (!result || typeof result !== "object") return;
    if (["turn/start", "turn/steer"].includes(request.method ?? "")) this.hostedObserver?.({ method: "mobile/turn/accepted", params: {
      request: { method: request.method, params: { threadId: request.params?.threadId, expectedTurnId: request.params?.expectedTurnId } },
      response: { result: { turn: { id: result.turn?.id }, turnId: result.turnId } },
    } });
    const thread = result.thread;
    if (!this.memoryOnly && thread?.id) this.changeHistory.observe({ method: "thread/started", params: { thread } });
    if (!this.memoryOnly && request.method === "turn/start" && result.turn?.id) this.changeHistory.observe({
      method: "turn/started", params: { threadId: request.params?.threadId, turn: result.turn },
    });
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

  async rpc(requestId: string, message: RpcMessage, epoch?: string, call: SessionCall = sessionCall()) {
    const callEpoch = this.epoch;
    let physicallySubmitted = false; let rejectedBeforeSend = false;
    const parentSubmitted = call.onSubmitted;
    call = { ...call, onSubmitted: () => { physicallySubmitted = true; parentSubmitted?.(); }, onSendRejected: () => { rejectedBeforeSend = true; } };
    const fence = this.remote ? await this.authorization(call) : undefined;
    const check = () => {
      if (call.guardLocalSend && !this.remote) { assertCall(call); assertRemoteOperation(); }
      if (fence) { fence.assertCurrent(); assertCall(call); if (this.closed || this.epoch !== callEpoch) throw uncertain(); }
    };
    this.touch(); await this.loadPromise;
    check();
    const signature = createHash("sha256").update(rpcSignatureInput(message, epoch)).digest("hex");
    const durable = !this.memoryOnly && (!message.method || (message.method !== "initialize" && message.id != null && !isReadOnlyRpc(message)));
    const stored = this.memoryOnly ? undefined : await this.storedOperation(requestId);
    let previous = this.operations.get(requestId) ?? stored;
    if (previous && previous.signature !== signature) throw new HttpError(409, "Request ID already used with different content");
    if (previous && ["initialize", "initialized"].includes(message.method ?? "") &&
      (!this.ready || !this.open || previous.connectionEpoch !== this.epoch)) {
      if (this.operations.get(requestId) === previous) this.operations.delete(requestId);
      previous = undefined;
    }
    if (previous) {
      if (previous.promise) { const result = await previous.promise; check(); return result; }
      if (previous.status === "completed") { check(); return previous.message!; }
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
    const operation: Operation = { requestId, signature, status: "pending", durable, imageRead: message.method === "fs/readFile", ...(this.memoryOnly ? { threadId: message.params?.threadId, method: message.method } : {}) };
    this.operations.set(requestId, operation);
    const execution = async () => {
      let recorded = false;
      let mayBeRecorded = false;
      let submitted = false;
      try {
        if (!message.method && epoch !== this.epoch) throw new HttpError(409, "Approval epoch is missing or stale");
        if (!message.method && (message.id == null || !this.pending.has(message.id))) throw new HttpError(409, "Approval request is not pending");
        if (message.method === "initialize") await this.connect(call);
        else if (!this.ready && (READ_ONLY_METHODS.has(message.method ?? "") || isNavigationResume(message)) && this.initializationMessage) {
          const initialized = await this.initialize(this.initializationMessage, call);
          if (initialized.error != null) throw new HttpError(503, "Unable to reinitialize session");
          if (this.initializedNotification && !this.sentInitialized) await this.notifyInitialized({ method: "initialized", params: {} }, this.socket, call);
        }
        else if (!this.ready || !this.open) throw new HttpError(503, "Initialize session before sending RPC");
        const submittedSocket = this.socket;
        const submittedEpoch = this.epoch;
        operation.connectionEpoch = submittedEpoch;
        const submittedApproval = !message.method ? this.pending.get(message.id!) : undefined;
        // Durable write-ahead record must precede any upstream send.
        await this.save(operation, () => { mayBeRecorded = true; }); recorded = true;
        if (this.socket !== submittedSocket || this.epoch !== submittedEpoch || !this.isOpen(submittedSocket) ||
          (!message.method && this.pending.get(message.id!) !== submittedApproval)) throw new HttpError(503, "App-server changed before operation could be submitted");
        let result: RpcMessage;
        let upstreamObservation: { request: RpcMessage; response: RpcMessage } | undefined;
        if (message.method === "initialize") {
          check(); submitted = true;
          result = await this.initialize(message, call);
          result = { ...result, ...(message.id != null ? { id: message.id } : {}) };
        } else if (!message.method) {
          check(); submitted = true;
          const hosted = await this.hostedReply?.(requestId, message, call);
          if (!hosted) await this.send(message, submittedSocket, call);
          if (this.socket === submittedSocket && this.epoch === submittedEpoch && this.pending.get(message.id!) === submittedApproval) this.pending.delete(message.id!);
          result = { id: message.id, result: null };
        } else {
          if (!this.memoryOnly && message.method === "turn/start" && typeof message.params?.threadId === "string") {
            await this.changeHistory.beforeStart(message.params.threadId, message.params.cwd).catch(() => {});
            if (this.socket !== submittedSocket || this.epoch !== submittedEpoch || !this.isOpen(submittedSocket)) {
              await this.changeHistory.cancelStart(message.params.threadId);
              throw new HttpError(503, "App-server changed before operation could be submitted");
            }
          }
          check(); submitted = true;
          if (message.method === "initialized") result = await this.notifyInitialized(message, submittedSocket, call);
          else if (message.method === "mobile/turns/commentary") {
            const upstream: RpcMessage = { id: message.id, ...turnCommentaryRequest(message.params!) };
            result = await this.exchange(upstream, submittedSocket, call);
            if (result.error == null) result = { ...result, result: compactTurnCommentary(await this.webCitations.result(message.params!.threadId, await this.timestamps.result(message.params!.threadId, result.result as Record<string, any>)), message.params!.turnId) };
          }
          else if (message.method === "mobile/turns/details") {
            const params = message.params!;
            const upstream: RpcMessage = { id: message.id, method: "thread/turns/list", params: {
              threadId: params.threadId, ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
              limit: Math.min(params.limit ?? 5, 5), sortDirection: "desc", itemsView: "full",
            } };
            result = await this.exchange(upstream, submittedSocket, call);
            if (this.socket === submittedSocket && this.epoch === submittedEpoch) {
              if (this.remote) upstreamObservation = { request: upstream, response: result };
              else this.observeRpcState(upstream, result);
            }
            if (result.error == null) {
              const full = await this.webCitations.result(params.threadId, await this.timestamps.result(params.threadId, result.result as Record<string, any>));
              const stats = Object.fromEntries(await Promise.all((full.data ?? []).map(async (turn: Record<string, any>) =>
                [String(turn.id), await this.changeHistory.get(params.threadId, turn)],
              )));
              result = { ...result, result: compactTurnDetails(full, stats) };
            }
          }
          else if (this.gatewayRpc && ['mobile/sidebar/summaries', 'mobile/sidebar/projectless', 'mobile/uploadUsage/read', 'mobile/attachments/upload', 'mobile/titleSummary', 'mobile/thread/observe'].includes(message.method)) result = await this.gatewayRpc(message, call);
          else result = await this.exchange(message, submittedSocket, call);
        }
        if (!this.memoryOnly && result.error == null && message.method === "thread/turns/list" && message.params?.itemsView === "full") {
          result = { ...result, result: await this.timestamps.result(message.params.threadId, result.result as Record<string, any>) };
        }
        if (!this.memoryOnly && result.error == null && result.result && typeof result.result === "object" && ["thread/resume", "thread/read", "thread/turns/list", "thread/items/list", "mobile/turns/details"].includes(message.method ?? "")) {
          result = { ...result, result: await this.images.result(await this.webCitations.result(message.params?.threadId ?? (result.result as any)?.thread?.id, result.result as Record<string, any>)) };
        }
        if (!this.memoryOnly && message.method === "turn/start" && result.error != null && typeof message.params?.threadId === "string") {
          await this.changeHistory.cancelStart(message.params.threadId);
        }
        if (!this.remote && this.socket === submittedSocket && this.epoch === submittedEpoch) this.observeRpcState(message, result);
        if (this.memoryOnly && (result.result as any)?.thread?.id) operation.threadId = (result.result as any).thread.id;
        if (this.remote) {
          await this.authorization(call);
          if (this.socket !== submittedSocket || this.epoch !== submittedEpoch || !this.isOpen(submittedSocket)) throw uncertain();
        }
        operation.status = "completed"; operation.message = result;
        await this.save(operation);
        if (fence) {
          await this.authorization(call);
          fence.assertCurrent(); assertCall(call); assertRemoteOperation();
          if (this.closed || this.socket !== submittedSocket || this.epoch !== submittedEpoch || !this.isOpen(submittedSocket)) throw uncertain();
          if (upstreamObservation) this.observeRpcState(upstreamObservation.request, upstreamObservation.response);
          this.observeRpcState(message, result);
        }
        return result;
      } catch (error) {
        if (recorded && submitted && ((!this.remote && call.guardLocalSend) || physicallySubmitted || !(error instanceof RemoteSendError && !error.mayHaveBeenSent))) { operation.status = "uncertain"; delete operation.message; await this.save(operation); throw uncertain(); }
        if (recorded) await this.discard(operation);
        if (this.operations.get(requestId) === operation) this.operations.delete(requestId);
        // 只属于本次新建operation；previous/promise分支及清理失败均到不了这里。
        // 首次保存可能已发布但未完成时保留pending WAL，不能签发零发送证明。
        if (call.dispatch && (!mayBeRecorded || recorded) && !physicallySubmitted && (!submitted || (this.remote && rejectedBeforeSend))) call.dispatch.neverSent = true;
        throw error;
      } finally { delete operation.promise; this.trimOperations(); }
    };
    operation.promise = fence ? withRemoteOperation(() => { assertCall(call); fence.assertLive(); }, execution) : execution();
    return operation.promise;
  }

  async operation(requestId: string, call: SessionCallOptions = sessionCall()) {
    const epoch = this.epoch;
    const fence = this.remote ? await this.authorization(call) : undefined;
    const read = async () => {
      await this.loadPromise;
      const operation = this.operations.get(requestId) ?? await this.storedOperation(requestId);
      if (fence) {
        await this.authorization(call);
        fence.assertCurrent(); assertCall(call); assertRemoteOperation();
        if (this.closed || this.epoch !== epoch) throw uncertain();
      }
      if (!operation) throw new HttpError(404, "Operation not found");
      return { status: operation.status, ...(operation.message ? { message: operation.message } : {}) };
    };
    return fence ? withRemoteOperation(() => { assertCall(call); fence.assertLive(); }, read) : read();
  }
  async confirmAttachment(requestId: string, request: RpcMessage, uploaded: unknown, call: SessionCallOptions): Promise<RpcMessage | undefined> {
    const fence = this.remote ? await this.authorization(call) : undefined;
    if (request.method !== 'mobile/attachments/upload' || request.params?.attachmentId !== requestId) throw new HttpError(409, '原附件请求不一致');
    await this.loadPromise;
    const original = this.operations.get(requestId) ?? await this.storedOperation(requestId);
    fence?.assertCurrent(); assertCall(call); assertRemoteOperation();
    if (!original || original.signature !== createHash('sha256').update(rpcSignatureInput(request)).digest('hex') || original.promise) return;
    if (original.status === 'completed') return original.message;
    const message = { id: request.id, result: uploaded };
    const confirmed: Operation = { ...original, status: 'completed', message };
    await this.save(confirmed); fence?.assertCurrent(); assertCall(call); assertRemoteOperation();
    this.operations.set(requestId, confirmed); return message;
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
        const upstream = this.socket; const epoch = this.epoch; const call = sessionCall();
        const fence = this.remote ? await this.authorization(call) : undefined;
        const deliver = async () => {
          const result = await this.exchange(message, upstream, call);
          if (fence) {
            await this.authorization(call);
            fence.assertCurrent(); assertCall(call); assertRemoteOperation();
            if (this.closed || this.socket !== upstream || this.epoch !== epoch || !this.isOpen(upstream)) throw uncertain();
          }
          if (message.id != null && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(result));
        };
        if (fence) await withRemoteOperation(() => { assertCall(call); fence.assertLive(); }, deliver);
        else await deliver();
      } catch {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: message.id, error: { code: -32000, message: "Realtime unavailable" } }));
      }
    });
  }

  heartbeat() {
    this.pruneSnapshots();
    if (!this.open || !(this.socket instanceof WebSocket)) return;
    if (!this.pong) { this.socket.terminate(); return; }
    this.pong = false; this.socket.ping();
  }

  async close() {
    this.closed = true;
    for (const voice of this.voices) voice.terminate();
    await this.connecting?.catch(() => {});
    if (this.socket) await this.closeSocket(this.socket).catch(() => {});
    await Promise.allSettled([...this.closingStreams]);
    await this.storeQueue;
  }
}

export class HttpSessions {
  private sidebar = new SidebarSummaryIndex(async (method, params) => {
    return this.sidebarRequest(method, params);
  });
  private async sidebarRequest(method: string, params: Record<string, any>, call?: SessionCallOptions) {
    const response = await this.hostedRpc({ id: randomUUID(), method, params }, randomUUID(), call);
    if (response.error != null) throw response.error;
    return response.result;
  }
  private sessions = new Map<string, Session>();
  readonly sidechats = new SidechatHistory();
  private timer: NodeJS.Timeout;
  private root: string;
  private changeHistory: HttpSessionRemoteOptions['projections']['changeHistory'];
  private images: HttpSessionRemoteOptions['projections']['images'];
  private timestamps: HttpSessionRemoteOptions['projections']['timestamps'];
  private webCitations: HttpSessionRemoteOptions['projections']['webCitations'];
  private hostedRequests = new Map<string, { message: RpcMessage; originalId: string | number; epoch: string; sessionId: string }>();
  private hostedListeners = new Set<(message: RpcMessage) => void>();
  private observationEpochs = new Map<string, string>();
  constructor(private options: { upstreamUrl: string; codexHome?: string; remote?: HttpSessionRemoteOptions; changeHistory?: TurnChangeHistory; notifications?: BarkNotifications; uploadMeter?: ModelUploadSource; attachments?: GatewayAttachments; titleSummary?: (threadId: string, automatic: boolean, call: SessionCallOptions) => Promise<string>; onAuthModeChanged?: (mode: string | null) => void }) {
    // 只快照绑定容器；consumer保留原可信实例，原context与传输handle不可在await期间换绑。
    const remote = options.remote ? { ...options.remote, context: structuredClone(options.remote.context) } : undefined;
    if (remote?.context.mode === 'remote') { Object.freeze(remote.context.managed); Object.freeze(remote.context.target); }
    if (remote) { Object.freeze(remote.context); Object.freeze(remote); }
    this.options = { ...options, remote };
    if (remote) {
      if (!(remote.target instanceof ResolvedRemoteTarget) || !(remote.resolver instanceof TargetResolver) || remote.context?.mode !== 'remote' ||
        !options.codexHome || !/^[a-f0-9]{64}$/.test(remote.storageNamespace) ||
        !remote.sidechatReplay?.files || remote.sidechatReplay.files.kind !== 'remote' || typeof remote.sidechatReplay.resolveReference !== 'function' ||
        !remote.projections?.changeHistory || !remote.projections.images || !remote.projections.timestamps || !remote.projections.webCitations)
        throw new TypeError('Remote session 需要可信目标、显式来源及独立存储namespace');
      const descriptor = remote.target.descriptor; const context = remote.context;
      const sameGeneration = context.generation === descriptor.generation;
      const originalNamespace = createHash('sha256').update(JSON.stringify(['transport-v1', 'remote', context.authorizationKey])).digest('hex');
      if (context.gatewayId !== descriptor.gatewayId || context.businessKey !== descriptor.businessKey ||
        !/^[a-f0-9]{64}$/.test(context.authorizationKey) || remote.storageNamespace !== originalNamespace ||
        (sameGeneration ? context.authorizationKey !== descriptor.authorizationKey || remote.storageNamespace !== descriptor.transportNamespace : context.authorizationKey === descriptor.authorizationKey) ||
        context.managed.accountId !== descriptor.account.accountId || context.managed.accountUserId !== descriptor.account.accountUserId ||
        Object.hasOwn(context.managed, 'userId') !== Object.hasOwn(descriptor.account, 'userId') || context.managed.userId !== descriptor.account.userId ||
        context.target.environmentId !== descriptor.target.environmentId || context.target.installationId !== descriptor.target.installationId)
        throw new TypeError('Remote session 原context必须与目标身份一致');
      const consumers: [unknown, string[]][] = [
        [remote.projections.changeHistory, ['observe', 'beforeStart', 'cancelStart', 'get', 'flush']],
        [remote.projections.images, ['result', 'notification']], [remote.projections.timestamps, ['result', 'notification']], [remote.projections.webCitations, ['result', 'notification']],
      ];
      if (consumers.some(([source, methods]) => methods.some(name => typeof (source as Record<string, unknown>)[name] !== 'function')))
        throw new TypeError('Remote session 需要完整的显式consumer');
      this.root = join(options.codexHome, 'codex-mobile-http', 'remote', remote.storageNamespace);
      this.changeHistory = remote.projections.changeHistory; this.images = remote.projections.images;
      this.timestamps = remote.projections.timestamps; this.webCitations = remote.projections.webCitations;
    } else {
      const home = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
      this.root = join(home, 'codex-mobile-http');
      this.webCitations = new MessageWebCitations(home); this.timestamps = new MessageTimestamps(home);
      this.images = new InlineImages(join(home, 'codex-mobile-inline-images'));
      this.changeHistory = options.changeHistory ?? new TurnChangeHistory(home);
    }
    this.timer = setInterval(() => {
      for (const id of this.sidechats.expired()) {
        void this.sidechatRpc({ method: 'mobile/sidechat/rpc', params: { method: 'thread/unsubscribe', params: { threadId: id } } }, randomUUID()).catch(() => {});
      }
      for (const [id, session] of this.sessions) {
        session.heartbeat();
        if ((id !== SIDECHAT_SESSION_ID || !this.sidechats.size) && !session.active && !session.waiting.size && !session.voices.size && Date.now() - session.updatedAt > IDLE_MS) {
          this.sessions.delete(id); void session.close();
        }
      }
    }, 30_000);
    this.timer.unref();
  }

  private closed = false;
  get consumersAvailable(): boolean { return !this.closed && (this.options.remote?.isAvailable?.() ?? true); }
  private async withCall<T>(call: SessionCallOptions, operation: (originalCall: SessionCallOptions, authorize?: () => void) => Promise<T>): Promise<T> {
    call = { ...call, deadline: call.deadline, signal: call.signal };
    if (!this.consumersAvailable) throw new HttpError(503, 'Sessions closed or consumers unavailable');
    if (!this.options.remote) return operation(call);
    const parents = captureRemoteOperation();
    const fence = await authorizeSession(this.options.remote, call);
    const authorize = () => { parents(); fence.assertCurrent(); assertCall(call); assertRemoteOperation(); if (this.closed) throw new HttpError(503, 'Sessions closed'); };
    const result = await withRemoteOperation(() => { assertCall(call); fence.assertLive(); }, async () => {
      const result = await operation(call, authorize);
      fence.assertCurrent(); assertCall(call);
      if (this.closed) throw new HttpError(503, 'Sessions closed');
      return result;
    });
    // 包装Promise本身也有await窗口；在最后一次await后才交付正文。
    fence.assertCurrent(); assertCall(call); assertRemoteOperation();
    if (this.closed) throw new HttpError(503, 'Sessions closed');
    return result;
  }

  private session(id: string | null, authorize?: () => void) {
    if (this.closed) throw new HttpError(503, 'Sessions closed');
    if (!id || !UUID.test(id)) throw new HttpError(400, "sessionId must be a UUID");
    const existing = this.sessions.get(id);
    if (existing) { if (authorize) existing.resumeLoad(authorize); return existing; }
    if (this.options.remote && !authorize) throw new TypeError('Remote session 创建需要原调用真实授权');
    authorize?.();
    if (this.sessions.size >= MAX_SESSIONS) throw new HttpError(429, "Too many sessions");
    const session = new Session(id, this.options.upstreamUrl, this.root, this.changeHistory, this.images, this.timestamps, this.webCitations, this.options.notifications,
      [HOSTED_SESSION_ID, SIDECHAT_SESSION_ID].includes(id) ? (message) => this.observeHosted(message, id) : undefined,
      ![HOSTED_SESSION_ID, SIDECHAT_SESSION_ID].includes(id) ? (requestId, message, call) => this.replyHosted(requestId, message, call) : undefined,
      id === SIDECHAT_SESSION_ID, this.options.onAuthModeChanged, this.options.remote, authorize,
      async (message, call) => {
        if (message.method === 'mobile/thread/observe') return this.observeThread(message, call);
        if (message.method === 'mobile/titleSummary') {
          if (!this.options.titleSummary || typeof message.params?.threadId !== 'string' || !message.params.threadId.trim() || message.params.threadId.length > 256 || typeof message.params.automatic !== 'boolean') throw new HttpError(400, '标题总结参数无效');
          return { id: message.id, result: { title: await this.options.titleSummary(message.params.threadId, message.params.automatic, call) } };
        }
        if (message.method === 'mobile/attachments/upload') {
          const attachmentId = message.params?.attachmentId;
          if (!this.options.attachments || this.options.remote?.context.mode !== 'remote' || typeof attachmentId !== 'string' || attachmentId !== message.id) throw new HttpError(400, '原附件请求不一致');
          return { id: message.id, result: await this.options.attachments.upload(attachmentId, this.options.remote.context, call.signal) };
        }
        return message.method === 'mobile/uploadUsage/read' ? this.uploadUsageRpc(message) : this.sidebarRpc(message, call);
      });
    // Loading errors are returned by APIs rather than emitted as unhandled rejections.
    session.loadPromise.catch(() => {});
    this.sessions.set(id, session);
    if (![HOSTED_SESSION_ID, SIDECHAT_SESSION_ID].includes(id)) for (const entry of this.hostedRequests.values()) session.mirror(entry.message);
    return session;
  }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL) {
    const call = sessionCall();
    let authorization: (() => void) | undefined;
    try {
      const result = await this.withCall(call, async (call, authorize) => {
        authorization = authorize;
        if ([HOSTED_SESSION_ID, SIDECHAT_SESSION_ID].includes(url.searchParams.get("sessionId") ?? "")) throw new HttpError(403, "Internal session is reserved");
        const session = this.session(url.searchParams.get("sessionId"), authorize);
        let result: unknown;
        if (url.pathname === "/api/events" && request.method === "GET") {
          const after = Number(url.searchParams.get("after") ?? "0");
          if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400, "Invalid event cursor");
          for (const [id, entry] of this.hostedRequests) if (!session.pending.has(id)) session.mirror(entry.message);
          result = session.events(after);
        } else if (url.pathname === "/api/operations" && request.method === "GET") {
          const id = url.searchParams.get("requestId") ?? "";
          if (!UUID.test(id)) throw new HttpError(400, "requestId must be a UUID");
          const ephemeral = this.sessions.get(SIDECHAT_SESSION_ID);
          try { result = await session.operation(id, call); }
          catch (error) { if (!(error instanceof HttpError) || error.status !== 404 || !ephemeral) throw error; result = await ephemeral.operation(id, call); }
        } else if (url.pathname === "/api/rpc" && request.method === "POST") {
          const body = await readRpcEnvelope(request);
          result = await this.rpcForSession(session, body, call);
        } else throw new HttpError(405, "Method not allowed");
        return result;
      });
      const body = JSON.stringify(result);
      authorization?.();
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.end(body);
    } catch (error) {
      response.statusCode = error instanceof HttpError ? error.status : 503;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: { code: error instanceof HttpError ? error.code : -32000, message: error instanceof HttpError ? error.message : "Session storage or upstream unavailable" } }));
    }
  }

  isEphemeralRpc(message: RpcMessage): boolean {
    return message.method === 'mobile/sidechat/rpc' ||
      (!message.method && typeof message.id === 'string' && this.hostedRequests.get(message.id)?.sessionId === SIDECHAT_SESSION_ID) ||
      (this.sidechats.has(message.params?.threadId) && ['thread/settings/update', 'turn/interrupt'].includes(message.method ?? ''));
  }
  /** 只能从原 Session 的实际通知/待审批请求赋予控制优先级，不能信任手机自报的 readOnly/control。 */
  controlFor(sessionId: string, message: RpcMessage, epoch: string | undefined, expiresAt: number): import('./operation-queue.js').OperationControl | undefined {
    const session = this.sessions.get(sessionId);
    if (message.method === 'turn/interrupt') {
      const { threadId, turnId } = message.params ?? {};
      if (typeof threadId !== 'string' || typeof turnId !== 'string' || !session?.running.has(`${threadId}:${turnId}`)) throw new HttpError(409, '原运行回合已失效');
      return { kind: 'stop', turnId, expiresAt };
    }
    if (!message.method) {
      const pending = message.id == null ? undefined : session?.pending.get(message.id);
      const turnId = pending?.params?.turnId ?? pending?.params?.turn?.id;
      const requestId = rpcControlRequestKey(message.id, epoch);
      if (!session || !epoch || epoch !== session.epoch || !pending || typeof turnId !== 'string' || !requestId) throw new HttpError(409, '原审批请求已失效');
      return { kind: 'approval', turnId, requestId, expiresAt };
    }
  }
  conversationFor(sessionId: string, message: RpcMessage): string | undefined {
    const value = message.params?.threadId ?? (message.id == null ? undefined : this.sessions.get(sessionId)?.pending.get(message.id)?.params?.threadId);
    return typeof value === 'string' && value.trim() ? value : undefined;
  }
  publicRpc(sessionId: string, body: PublicRpcEnvelope, call: SessionCallOptions = sessionCall()): Promise<RpcMessage> {
    return this.withCall(call, (call, authorize) => this.rpcForSession(this.session(sessionId, authorize), body, call));
  }
  private async rpcForSession(session: Session, body: PublicRpcEnvelope, call: SessionCallOptions): Promise<RpcMessage> {
    const message = body.message;
    let result: RpcMessage | undefined;
    if (message.method === 'mobile/uploadUsage/read') result = this.uploadUsageRpc(message);
    else if (["mobile/sidebar/summaries", "mobile/sidebar/projectless"].includes(message.method ?? "")) result = await this.sidebarRpc(message, call);
    else if (message.method === 'mobile/sidechat/rpc') result = await this.sidechatRpc(message, body.requestId, call);
    else if (!message.method && typeof message.id === 'string' && this.hostedRequests.get(message.id)?.sessionId === SIDECHAT_SESSION_ID) result = await this.replyHosted(body.requestId, message, call);
    else if (this.sidechats.has(message.params?.threadId) && ['thread/settings/update', 'turn/interrupt'].includes(message.method ?? '')) result = await this.sidechatRpc({ ...message, params: { method: message.method, params: message.params } }, body.requestId, call);
    else result = await session.rpc(body.requestId, message, body.epoch, call);
    return result!;
  }

  private observeHosted(message?: RpcMessage, sessionId = HOSTED_SESSION_ID) {
    if (sessionId === HOSTED_SESSION_ID) {
      if (message) this.sidebar.observe(message);
      else this.sidebar.setEpoch("");
    }
    if (!message) {
      if (sessionId === SIDECHAT_SESSION_ID) {
        for (const id of this.sidechats.expired().concat([...this.sidechatIds])) this.broadcastHosted({ method: 'thread/closed', params: { threadId: id } });
        this.sidechats.clear(); this.sidechatIds.clear();
      }
      for (const [id, entry] of this.hostedRequests) if (entry.sessionId === sessionId) this.broadcastHosted({ method: "serverRequest/resolved", params: { requestId: id, threadId: entry.message.params?.threadId } });
      for (const [id, entry] of this.hostedRequests) if (entry.sessionId === sessionId) this.hostedRequests.delete(id); return;
    }
    if (sessionId === SIDECHAT_SESSION_ID && message.id == null && this.sidechats.observe(message)) {
      this.broadcastHosted(message); return;
    }
    if (message.id != null && message.method) {
      const session = this.sessions.get(sessionId)!;
      const id = `hosted:${session.epoch}:${JSON.stringify(message.id)}`;
      const mirrored = { ...message, id };
      this.hostedRequests.set(id, { message: mirrored, originalId: message.id, epoch: session.epoch, sessionId });
      this.broadcastHosted(mirrored);
    } else if (message.method === "mobile/turn/accepted") {
      this.broadcastHosted(message); return;
    } else if (message.method === "serverRequest/resolved") {
      for (const [id, entry] of this.hostedRequests) if (entry.sessionId === sessionId && entry.originalId === message.params?.requestId) {
        this.hostedRequests.delete(id); this.broadcastHosted({ ...message, params: { ...message.params, requestId: id } });
      }
    }
    // App-server broadcasts subscribed turn events itself. Internal approval requests are connection-local.
    for (const listener of this.hostedListeners) if (message.id == null && message.method !== "serverRequest/resolved") listener(message);
  }
  private broadcastHosted(message: RpcMessage) {
    for (const [id, session] of this.sessions) if (![HOSTED_SESSION_ID, SIDECHAT_SESSION_ID].includes(id) &&
      (message.method !== "mobile/turn/accepted" || (session.ready && session.open))) session.mirror(message, this.sidechats.has(message.params?.threadId));
    for (const listener of this.hostedListeners) listener(message);
  }
  async replyHosted(requestId: string, message: RpcMessage, call: SessionCallOptions = sessionCall()): Promise<RpcMessage | undefined> {
    return this.withCall(call, async call => {
      if (typeof message.id !== "string" || !message.id.startsWith("hosted:")) return undefined;
      const entry = this.hostedRequests.get(message.id);
      const session = this.sessions.get(entry?.sessionId ?? HOSTED_SESSION_ID);
      if (!entry || !session || session.epoch !== entry.epoch || !session.pending.has(entry.originalId)) throw new HttpError(409, "后台审批已失效，请刷新会话");
      const response = await session.rpc(requestId, { ...message, id: entry.originalId }, entry.epoch, call);
      this.hostedRequests.delete(message.id);
      this.broadcastHosted({ method: "serverRequest/resolved", params: { requestId: message.id, threadId: entry.message.params?.threadId } });
      return { ...response, id: message.id };
    });
  }
  private async observeThread(message: RpcMessage, call: SessionCallOptions): Promise<RpcMessage> {
    const threadId = message.params?.threadId;
    if (typeof threadId !== 'string' || !threadId || threadId.length > 1024) throw new HttpError(400, '观察会话 ID 无效');
    const epoch = await this.hostedReady(call);
    if (this.observationEpochs.get(threadId) !== epoch) {
      const resumed = await this.hostedRpc({ id: randomUUID(), method: 'thread/resume', params: { threadId, excludeTurns: true, initialTurnsPage: { limit: 1, itemsView: 'summary' } } }, randomUUID(), call);
      if (resumed.error) return { id: message.id, error: resumed.error };
      if (await this.hostedReady(call) !== epoch) throw new HttpError(503, '观察连接已经变化');
      this.observationEpochs.set(threadId, epoch);
    }
    const response = await this.hostedRpc({ id: randomUUID(), method: 'thread/read', params: { threadId, includeTurns: false } }, randomUUID(), call);
    if (response.error) return { id: message.id, error: response.error };
    const turns = await this.hostedRpc({ id: randomUUID(), method: 'thread/turns/list', params: { threadId, limit: 1, sortDirection: 'desc', itemsView: 'full' } }, randomUUID(), call);
    if (turns.error) return { id: message.id, error: turns.error };
    if (await this.hostedReady(call) !== epoch) throw new HttpError(503, '观察连接已经变化');
    return { id: message.id, result: { thread: (response.result as any)?.thread, data: (turns.result as any)?.data } };
  }
  subscribeHosted(listener: (message: RpcMessage) => void) {
    let active = true;
    if (this.options.remote && this.hostedRequests.size) {
      const call = sessionCall();
      void authorizeSession(this.options.remote, call).then(fence => {
        fence.assertCurrent(); assertCall(call); assertRemoteOperation();
        if (!active || this.closed) return;
        this.hostedListeners.add(listener);
        for (const entry of this.hostedRequests.values()) {
          const session = this.sessions.get(entry.sessionId);
          fence.assertCurrent(); assertCall(call); assertRemoteOperation();
          if (active && session?.epoch === entry.epoch && session.ready && session.open) listener(entry.message);
        }
      }).catch(() => {});
    } else {
      this.hostedListeners.add(listener);
      for (const entry of this.hostedRequests.values()) listener(entry.message);
    }
    return () => { active = false; this.hostedListeners.delete(listener); };
  }

  /** Dedicated durable identity survives gateway restarts and is never exposed to clients. */
  async hostedReady(call: SessionCallOptions = sessionCall()) {
    return this.withCall(call, async (call, authorize) => {
      const session = this.session(HOSTED_SESSION_ID, authorize);
      if (!session.ready || !session.open) {
        const initialized = await session.rpc(randomUUID(), { id: "hosted-initialize", method: "initialize", params: {
          clientInfo: { name: "codex-mobile-follow-ups", version: "1" }, capabilities: { experimentalApi: true },
        } }, undefined, call);
        if (initialized.error != null) throw new HttpError(503, "Unable to initialize follow-up session");
      }
      if (!session.sentInitialized) await session.rpc(randomUUID(), { method: "initialized", params: {} }, undefined, call);
      return session.epoch;
    });
  }
  async hostedRpc(message: RpcMessage, requestId: string = randomUUID(), call: SessionCallOptions = sessionCall()) {
    return this.withCall(call, async (call, authorize) => {
      await this.hostedReady(call);
      return this.session(HOSTED_SESSION_ID, authorize).rpc(requestId, message, undefined, call);
    });
  }

  private dispatchAttempts = new WeakMap<SessionDispatchAttempt, object>();
  private dispatchProofs = new WeakMap<SessionDispatchResult, { attempt: SessionDispatchAttempt; binding: string; invocation: object; session: Session; namespace: string; call: SessionCallOptions }>();

  private dispatchNamespace() {
    return canonical({ root: this.root, context: this.options.remote?.context, storageNamespace: this.options.remote?.storageNamespace,
      targetNamespace: this.options.remote?.target.descriptor.transportNamespace });
  }

  /** 零发送证明只核验原身份，允许同代暂时离线；业务发送仍使用原在线执行授权。 */
  private async withDispatchProofCall<T>(call: SessionCallOptions, operation: (authorize: () => void) => T): Promise<T> {
    let fence: (() => void) | undefined;
    const authorize = () => { fence?.(); assertCall(call); assertRemoteOperation(); if (this.closed) throw uncertain(); };
    const result = await withRemoteOperation(() => assertCall(call), async () => {
      const remote = this.options.remote;
      if (remote) {
        await remote.target.assertCurrent(call.signal);
        fence = await remote.resolver.authorizeOperation(remote.context, 'transition', call.signal);
        await remote.target.assertCurrent(call.signal);
      }
      fence?.(); assertCall(call); assertRemoteOperation();
      if (this.closed) throw uncertain();
      return operation(authorize);
    });
    fence?.(); assertCall(call); assertRemoteOperation();
    if (this.closed) throw uncertain();
    return result;
  }

  /** 内部执行结果；不接HTTP路由、不增加派发owner或重试。公开错误不携带证明。 */
  async dispatchRpc(attempt: SessionDispatchAttempt, message: RpcMessage, call: SessionCallOptions = sessionCall(), epoch?: string): Promise<SessionDispatchResult> {
    const originalAttempt = { ...attempt }; const binding = canonical(originalAttempt); const invocation = {}; const namespace = this.dispatchNamespace();
    this.dispatchAttempts.set(attempt, invocation);
    const originalCall: SessionCall = { deadline: call.deadline, signal: call.signal, guardLocalSend: true };
    const dispatch = { neverSent: false }; let session: Session | undefined; let originalEpoch: string | undefined;
    let executionAuthorization: (() => void) | undefined; let proofAuthorization: (() => void) | undefined;
    const check = (response = true) => {
      if (response) executionAuthorization?.(); else proofAuthorization?.();
      assertCall(originalCall); assertRemoteOperation();
      if (this.closed || !session || session.closed || this.sessions.get(originalAttempt.sessionId) !== session || this.dispatchNamespace() !== namespace || (response && session.epoch !== originalEpoch)) throw uncertain();
    };
    try {
      if (!UUID.test(originalAttempt.requestId) || !UUID.test(originalAttempt.attemptId) || originalAttempt.sessionId === SIDECHAT_SESSION_ID) throw new HttpError(400, 'Invalid dispatch attempt');
      // 冻结原调用输入，异步期间调用方改对象不能将证明换绑到另一次请求。
      const originalMessage = structuredClone(message);
      if (originalMessage.method === 'thread/unsubscribe' && typeof originalMessage.params?.threadId === 'string') this.observationEpochs.delete(originalMessage.params.threadId);
      const response = await this.withCall(originalCall, async (_call, authorize) => {
        executionAuthorization = authorize;
        assertCall(originalCall); assertRemoteOperation();
        if (this.dispatchNamespace() !== namespace) throw uncertain();
        session = this.session(originalAttempt.sessionId, authorize); originalEpoch = session.epoch;
        check(); if (originalAttempt.sessionId === HOSTED_SESSION_ID) await this.hostedReady(originalCall);
        check(); const response = await session!.rpc(originalAttempt.requestId, originalMessage, epoch, { ...originalCall, dispatch }); check(); return response;
      });
      check(); return Object.freeze({ outcome: 'response', message: response });
    } catch (error) {
      if (dispatch.neverSent) {
        try {
          await this.withDispatchProofCall(originalCall, authorize => { proofAuthorization = authorize; check(false); }); check(false);
          const result: SessionDispatchResult = Object.freeze({ outcome: 'neverSent', error });
          this.dispatchProofs.set(result, { attempt, binding, invocation, session: session!, namespace, call: originalCall });
          return result;
        } catch { /* 原预算/身份/会话失效只能返回未知，不能交付旧正文或证明。 */ }
      }
      return Object.freeze({ outcome: 'unknown', error });
    }
  }

  /** 可用于ledger.confirmNeverSent回调；必须保留本实例的原结果及原attempt对象，同对象再次执行使旧证明失效。 */
  async provesNeverSent(result: SessionDispatchResult, attempt: SessionDispatchAttempt, capture?: (recheck: () => boolean) => void): Promise<boolean> {
    const proof = this.dispatchProofs.get(result);
    const originalAttempt = { ...attempt };
    if (!proof || proof.attempt !== attempt || proof.binding !== canonical(originalAttempt)) return false;
    let authorization: (() => void) | undefined;
    const check = () => {
      authorization?.();
      assertCall(proof.call); assertRemoteOperation();
      return canonical(attempt) === proof.binding && this.dispatchAttempts.get(attempt) === proof.invocation && this.sessions.get(originalAttempt.sessionId) === proof.session && !proof.session.closed && this.dispatchNamespace() === proof.namespace;
    };
    try {
      const valid = await this.withDispatchProofCall(proof.call, authorize => { authorization = authorize; return check(); });
      if (!valid || !check()) return false;
      // 仅可信ledger CAS接线捕获；不能缓存boolean代替原对象及真实fence的最终复核。
      capture?.(check);
      return check();
    } catch { return false; }
  }

  /** 内部普通Session的协议恢复；只重建原初始化，不产生业务ledger或替换审批epoch。 */
  async initializeQueuedSession(sessionId: string, initialization: { message: RpcMessage; notification?: RpcMessage }, call: SessionCallOptions): Promise<void> {
    const snapshot = structuredClone(initialization); let authorization: (() => void) | undefined;
    if (snapshot.message.method !== 'initialize' || snapshot.message.id == null || (snapshot.notification && snapshot.notification.method !== 'initialized') || sessionId === SIDECHAT_SESSION_ID) throw new TypeError('需要原Session已完成的初始化快照');
    await this.withCall(call, async (call, authorize) => {
      authorization = authorize; const session = this.session(sessionId, authorize);
      if (!session.ready || !session.open) {
        const result = await session.rpc(randomUUID(), snapshot.message, undefined, { ...call, guardLocalSend: true });
        if (result.error != null) throw result.error;
        if (snapshot.notification) await session.rpc(randomUUID(), snapshot.notification, undefined, { ...call, guardLocalSend: true });
      }
    });
    authorization?.(); assertCall(call); assertRemoteOperation();
  }
  /** 与内部调度的协议/审批共用同一真实Session；公开路由保持原实现。 */
  async readEvents(sessionId: string, after: number, call: SessionCallOptions) {
    let authorization: (() => void) | undefined;
    const result = await this.withCall(call, async (_call, authorize) => { authorization = authorize; return this.session(sessionId, authorize).events(after); });
    authorization?.(); assertCall(call); assertRemoteOperation(); return result;
  }
  reconcileAttachment(requestId: string, message: RpcMessage, call: SessionCallOptions): Promise<RpcMessage | undefined> {
    return this.withCall(call, async (call, authorize) => {
      if (!this.options.attachments || this.options.remote?.context.mode !== 'remote' || message.method !== 'mobile/attachments/upload' ||
        message.params?.attachmentId !== requestId || message.id !== requestId) return;
      const uploaded = await this.options.attachments.reconcile(requestId, this.options.remote.context, call.signal);
      if (!uploaded) return;
      return this.session(HOSTED_SESSION_ID, authorize).confirmAttachment(requestId, message, uploaded, call);
    });
  }
  async sidebarRpc(message: RpcMessage, call: SessionCallOptions = sessionCall()): Promise<RpcMessage> {
    return this.withCall(call, async call => {
      if (message.id == null || !validSidebarParams(message.method!, message.params)) throw new HttpError(400, "Invalid sidebar parameters");
      this.sidebar.setEpoch(await this.hostedReady(call));
      const params = message.params as any;
      const context = this.options.remote ? { deadline: call.deadline, signal: call.signal,
        request: (method: string, params: Record<string, any>) => this.sidebarRequest(method, params, call),
        assertCurrent: () => { assertCall(call); assertRemoteOperation(); } } : undefined;
      const result = message.method === "mobile/sidebar/summaries"
        ? await this.sidebar.summaries(params, context) : await this.sidebar.projectless(params, context);
      return { id: message.id, result };
    });
  }

  uploadUsageRpc(message: RpcMessage): RpcMessage {
    const id = message.params?.threadId;
    if (message.id == null || typeof id !== 'string' || !id.trim() || id.length > 256) throw new HttpError(400, 'Invalid upload usage parameters');
    return { id: message.id, result: { usage: this.options.uploadMeter?.read(id) ?? null } };
  }

  publishUploadUsage(threadId: string, usage: ModelUploadUsage | null) {
    this.broadcastHosted({ method: 'mobile/uploadUsage/updated', params: { threadId, usage } });
  }

  private sidechatIds = new Set<string>();
  async sidechatRpc(envelope: RpcMessage, requestId: string = randomUUID(), call: SessionCallOptions = sessionCall()): Promise<RpcMessage> {
    try { return await this.withCall(call, (call, authorize) => this.sidechatExecution(envelope, requestId, call, authorize)); }
    catch (error) { if (error instanceof HttpError) throw error; return { id: envelope.id, error: { code: -32001, message: error instanceof Error ? error.message : 'Sidechat 不可用' } }; }
  }
  private async sidechatExecution(envelope: RpcMessage, requestId: string, call: SessionCallOptions, authorize?: () => void): Promise<RpcMessage> {
    const method = envelope.params?.method; const params = envelope.params?.params;
    if (typeof method !== 'string' || !params || Array.isArray(params) || typeof params !== 'object') throw new HttpError(400, 'Sidechat 参数无效');
    if (!['read', 'thread/fork', 'replay', 'turn/start', 'turn/steer', 'turn/interrupt', 'thread/unsubscribe', 'thread/settings/update'].includes(method)) throw new HttpError(400, '不支持的 Sidechat 操作');
    try {
      if (method === 'read') return { id: envelope.id, result: this.sidechats.read(params.threadId) };
      const replacement = method === 'thread/fork' && this.sidechats.has(params.threadId);
      let upstreamParams = params;
      if (method === 'thread/fork') {
        if (replacement) {
          const source = this.sidechats.replacement(params.threadId, params.beforeTurnId);
          upstreamParams = { ...params, threadId: source.parentId, lastTurnId: source.forkTurnId };
          delete upstreamParams.beforeTurnId;
        }
        if (params.ephemeral !== true || params.excludeTurns !== true || typeof upstreamParams.lastTurnId !== 'string' || !upstreamParams.lastTurnId || typeof params.threadId !== 'string') throw new HttpError(400, 'Sidechat 必须从明确的结束回合临时分叉');
      } else if (!this.sidechats.has(params.threadId)) throw new Error('Sidechat 已失效，请返回主聊天重新创建');
      if (method === 'replay') upstreamParams = { threadId: params.threadId, items: await sidechatReplayItems(this.sidechats.replay(params.threadId, params.sourceThreadId, params.beforeTurnId), this.options.remote ? { ...this.options.remote.sidechatReplay, signal: call.signal } : undefined) };
      const session = this.session(SIDECHAT_SESSION_ID, authorize);
      if (!session.ready || !session.open) {
        const initialized = await session.rpc(randomUUID(), { id: 'sidechat-initialize', method: 'initialize', params: { clientInfo: { name: 'codex-mobile-sidechat', version: '1' }, capabilities: { experimentalApi: true } } }, undefined, call);
        if (initialized.error) return { ...initialized, id: envelope.id };
      }
      if (!session.sentInitialized) await session.rpc(randomUUID(), { method: 'initialized', params: {} }, undefined, call);
      const response = await session.rpc(requestId, { id: `sidechat:${requestId}`, method: method === 'replay' ? 'thread/inject_items' : method, params: upstreamParams }, undefined, call);
      if (!response.error) {
        if (method === 'thread/fork') {
          if (replacement) this.sidechats.registerReplacement(params.threadId, params.beforeTurnId, response.result as Record<string, any>);
          else this.sidechats.register(params, response.result as Record<string, any>);
          this.sidechatIds.add((response.result as any).thread.id);
        }
        if (method === 'turn/start') this.sidechats.observe({ method: 'turn/started', params: { threadId: params.threadId, turn: (response.result as any).turn } });
        if (method === 'thread/settings/update') this.sidechats.settings(params.threadId, params);
        if (method === 'thread/unsubscribe') {
          for (const [key, entry] of this.hostedRequests) if (entry.message.params?.threadId === params.threadId) this.hostedRequests.delete(key);
          for (const retained of this.sessions.values()) retained.forgetThread(params.threadId);
          this.sidechats.remove(params.threadId); this.sidechatIds.delete(params.threadId); this.broadcastHosted({ method: 'thread/closed', params: { threadId: params.threadId } }); }
      }
      return { ...response, id: envelope.id };
    } catch (error) { if (error instanceof HttpError) throw error; return { id: envelope.id, error: { code: -32001, message: error instanceof Error ? error.message : 'Sidechat 不可用' } }; }
  }

  hostedOperation(requestId: string, call: SessionCallOptions = sessionCall()) { return this.withCall(call, (call, authorize) => this.session(HOSTED_SESSION_ID, authorize).operation(requestId, call)); }

  realtime(sessionId: string | null, client?: WebSocket) {
    if (sessionId === HOSTED_SESSION_ID) throw new HttpError(403, "Internal session is reserved");
    const session = this.session(sessionId);
    if (!session.ready || !session.open) throw new HttpError(503, "Initialize session before realtime");
    if (client) session.voice(client);
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.all([...this.sessions.values()].map((session) => session.close()));
    await this.changeHistory.flush();
    this.sessions.clear();
  }
}
