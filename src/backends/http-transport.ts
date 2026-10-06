import type { RpcMessage } from "../app-server/client";
import { t } from "../i18n";
import { isNavigationResume } from "../../server/rpc-replay";

export interface HttpSyncState { updatedAt: number | null; stale: boolean }
interface Config { baseUrl: string; token: string; id: string }
interface PollResponse {
  epoch: string; cursor: number; messages: RpcMessage[]; requests: RpcMessage[];
  active: boolean; updatedAt: number; reset: boolean; hasMore?: boolean;
}
const readMethods = new Set(["initialize", "initialized", "thread/list", "thread/read", "thread/loaded/list", "thread/turns/list", "thread/items/list", "permissionProfile/list", "plugin/list", "model/list", "config/read", "configRequirements/read", "account/read", "account/rateLimits/read", "skills/list", "mcpServerStatus/list", "collaborationMode/list", "app/list", "fs/readFile"]);
interface PendingWrite { requestId: string; message: RpcMessage; epoch?: string }
const pendingWrites = new Map<string, Map<string, PendingWrite>>();

export class HttpOperationPendingError extends Error {
  constructor(readonly requestId: string, readonly request: RpcMessage, cause?: unknown) {
    super(t("请求结果待确认，请刷新会话后检查，勿重复发送"), { cause });
    this.name = "HttpOperationPendingError";
  }
}

export function transportUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 3) | 8).toString(16);
  });
}

function sessionFor(config: Config) {
  const key = `codex-mobile:http-session:${config.id}:${config.baseUrl}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved && /^[\da-f-]{36}$/i.test(saved)) return saved;
    const created = transportUuid();
    localStorage.setItem(key, created);
    return created;
  } catch { return transportUuid(); }
}

/** 手机 HTTP 生命周期与网关持有的上游会话相互独立。 */
export class HttpRpcTransport extends EventTarget {
  readyState = 0;
  readonly managesHttpTimeout = true;
  private readonly fetcher: typeof fetch;
  private readonly sessionId: string;
  private cursor = 0;
  private epoch = "";
  private initialized = false;
  private polling = false;
  private catchingUp = true;
  private catchUpAnnounced = false;
  private active = false;
  private hasMore = false;
  private failures = 0;
  private updatedAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly controllers = new Set<AbortController>();
  private readonly seenRequests = new Set<string>();
  private readonly answeredRequests = new Set<string>();
  private latestRequests: RpcMessage[] = [];
  private realtimeThreadId = "";
  private readonly writes: Map<string, PendingWrite>;
  private readonly writesKey: string;
  private realtime: WebSocket | null = null;
  private realtimeOpening: Promise<void> | null = null;
  private firstPoll: Promise<void> | undefined;
  private operationTimer: ReturnType<typeof setTimeout> | undefined;
  private operationDueAt = 0;
  private detailsUnsupported = false;
  private reconciling = false;
  private reconcileOffset = 0;
  private readonly inflightWrites = new Set<string>();
  private readonly inflightRpcWrites = new Map<number | string, PendingWrite>();

  pendingErrorForRequest(id: number | string) {
    const operation = this.inflightRpcWrites.get(id);
    return operation ? new HttpOperationPendingError(operation.requestId, operation.message) : undefined;
  }

  constructor(private readonly config: Config, options: { fetch?: typeof fetch; sessionId?: string } = {}) {
    super();
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sessionId = options.sessionId ?? sessionFor(config);
    this.writesKey = `codex-mobile:http-writes:${config.id}:${this.sessionId}`;
    this.writes = pendingWrites.get(this.writesKey) ?? new Map();
    if (!pendingWrites.has(this.writesKey)) {
      try {
        const saved = JSON.parse(localStorage.getItem(this.writesKey) ?? "[]");
        for (const pair of saved) if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1]?.requestId === "string" && pair[1]?.message) this.writes.set(pair[0], pair[1]);
      } catch { /* 存储不可用时同一页面内仍保留未确认操作。 */ }
      pendingWrites.set(this.writesKey, this.writes);
    }
    // 旧版把文件读取当作写入；清除遗留的待确认项以恢复图片读取配额。
    let removedRead = false;
    for (const [signature, operation] of this.writes) {
      if (operation.message.method && (readMethods.has(operation.message.method) || isNavigationResume(operation.message))) {
        this.writes.delete(signature);
        removedRead = true;
      }
    }
    if (removedRead) this.saveWrites();
    document.addEventListener("visibilitychange", this.onResume);
    window.addEventListener("online", this.onResume);
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    }, 0);
  }

  private url(path: string, params: Record<string, string> = {}) {
    const url = new URL(path, `${this.config.baseUrl}/`);
    url.searchParams.set("sessionId", this.sessionId);
    if (this.config.token) url.searchParams.set("token", this.config.token);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }

  private emit(message: RpcMessage) {
    if (this.readyState === 1) this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  private saveWrites() {
    try { localStorage.setItem(this.writesKey, JSON.stringify([...this.writes])); }
    catch { /* 配额不足时不影响当前页面的同 ID 对账。 */ }
  }

  private async fetchJson(path: string, init: RequestInit = {}, params: Record<string, string> = {}, timeoutMs = 10_000) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetcher(this.url(path, params), { ...init, mode: "cors", cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        const error = new Error(response.status === 404
          ? t("设备网关需要升级以支持 HTTP 同步")
          : response.status === 401 ? t("访问口令不正确") : t("设备网关返回 {status}", { status: response.status }));
        Object.assign(error, { status: response.status });
        throw error;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  async send(raw: string, timeoutMs = 10_000): Promise<void> {
    if (this.readyState !== 1) throw new Error(t("设备尚未连接，请稍后重试"));
    const message = JSON.parse(raw) as RpcMessage;
    if (message.method?.startsWith("thread/realtime/")) {
      if (this.realtime?.readyState !== 1) throw new Error(t("实时会话连接不可用"));
      if (message.method === "thread/realtime/start") this.realtimeThreadId = String((message.params as { threadId?: string })?.threadId ?? "");
      this.realtime.send(raw);
      return;
    }
    // 审批必须绑定从首个事件页读取的 epoch，不能在握手完成时猜测。
    if (!message.method && message.id != null && !this.epoch) {
      await this.firstPoll;
      if (!this.epoch || this.readyState !== 1) throw new Error(t("设备尚未连接，请稍后重试"));
    }
    const signature = !message.method || (!readMethods.has(message.method) && !isNavigationResume(message))
      ? JSON.stringify(message.method ? { method: message.method, params: message.params } : { ...message, epoch: this.epoch }) : null;
    if (signature && !this.writes.has(signature) && this.writes.size >= 32) throw new Error(t("请求结果待确认，请刷新会话后检查，勿重复发送"));
    const existing = signature ? this.writes.get(signature) : undefined;
    const operation = existing || { requestId: transportUuid(), message, epoch: this.epoch || undefined };
    let requestId = operation.requestId;
    const original = operation.message;
    const params = original.params as Record<string, unknown> | undefined;
    const wireMessage = !this.detailsUnsupported && original.method === "thread/turns/list" && params?.itemsView === "full"
      ? { ...original, method: "mobile/turns/details", params: { ...params, itemsView: undefined, limit: Math.min(5, Math.max(1, Number(params.limit) || 5)), sortDirection: "desc" } }
      : original;
    let wireOperation = { ...operation, message: wireMessage };
    if (signature) { this.writes.set(signature, operation); this.saveWrites(); }
    let response: RpcMessage | undefined;
    let failure: unknown;
    let mayHaveBeenAccepted = Boolean(existing);
    const deadline = Date.now() + timeoutMs;
    const fallbackDetails = async () => {
      if (signature || wireOperation.message.method !== "mobile/turns/details" || response?.error?.code !== -32601) return;
      this.detailsUnsupported = true;
      // 网关绑定 UUID 与原方法签名；回退是另一条只读 RPC，不能复用旧 UUID。
      requestId = transportUuid();
      wireOperation = { ...operation, requestId, message: original };
      response = undefined;
      response = await this.fetchJson("/api/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(wireOperation) }, {}, Math.max(1, deadline - Date.now()));
    };
    if (signature) this.inflightWrites.add(requestId);
    if (signature && message.method && message.id != null) this.inflightRpcWrites.set(message.id, operation);
    try {
      for (let attempt = 0; attempt < 3 && this.readyState === 1; attempt++) {
        try {
          response = await this.fetchJson("/api/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(wireOperation) }, {}, Math.max(1, deadline - Date.now()));
          await fallbackDetails();
          break;
        } catch (reason) {
          failure = reason;
          if ([401, 409, 404, 400].includes((reason as { status?: number }).status ?? 0)) {
            // 旧未知项可能早已执行；新一轮拒绝不能撤销早先的受理事实。
            if (mayHaveBeenAccepted && signature) throw new HttpOperationPendingError(requestId, operation.message, reason);
            if (signature && this.readyState === 1 && this.writes.get(signature) === operation) { this.writes.delete(signature); this.saveWrites(); }
            throw reason;
          }
          mayHaveBeenAccepted = true;
        }
        if (this.readyState !== 1) break;
        try {
          const result = await this.fetchJson("/api/operations", {}, { requestId }, 5_000);
          if (result.status === "completed" && result.message) { response = result.message; await fallbackDetails(); break; }
          if (result.status === "uncertain") break;
        } catch { /* 404 和弱网都不能证明操作未提交。 */ }
        if (Date.now() >= deadline || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
      if (!response || this.readyState !== 1) {
        if (signature) throw new HttpOperationPendingError(requestId, operation.message, failure);
        throw failure ?? new Error(t("设备尚未连接，请稍后重试"));
      }
      if (signature) { this.writes.delete(signature); this.saveWrites(); }
      if (message.id != null && message.method) this.emit({ ...response, id: message.id });
      else if (response.error) throw new Error(response.error.message);
      if (message.method === "initialized") {
        this.initialized = true;
        this.firstPoll = this.poll();
        this.scheduleOperations(0);
      } else if (!response.error && (message.method === "turn/start" || message.method === "turn/steer")) {
        this.active = true;
        this.schedule(0);
      } else if (!message.method && message.id != null) {
        this.answeredRequests.add(String(message.id));
        this.schedule(0);
      }
    } finally {
      this.inflightWrites.delete(requestId);
      if (message.id != null) this.inflightRpcWrites.delete(message.id);
      if (existing && signature && response && this.readyState === 1 && this.writes.get(signature) !== operation) {
        this.emit({ method: "mobile/operation/confirmed", params: { requestId, request: operation.message, response } });
      }
      this.scheduleOperations();
    }
  }

  private scheduleOperations(delay = this.writes.size ? 3_000 : 15_000) {
    const dueAt = Date.now() + delay;
    if (this.readyState === 1 && this.initialized && document.visibilityState === "visible"
      && this.operationTimer !== undefined && this.operationDueAt <= dueAt) return;
    clearTimeout(this.operationTimer);
    this.operationTimer = undefined;
    this.operationDueAt = 0;
    if (this.readyState !== 1 || !this.initialized || document.visibilityState !== "visible") return;
    this.operationDueAt = dueAt;
    this.operationTimer = setTimeout(() => {
      this.operationTimer = undefined;
      this.operationDueAt = 0;
      void this.reconcileOperations();
    }, delay);
  }

  private async reconcileOperations() {
    if (this.reconciling || !this.initialized || this.readyState !== 1 || document.visibilityState !== "visible") return;
    this.reconciling = true;
    const entries = [...this.writes];
    const start = entries.length ? this.reconcileOffset % entries.length : 0;
    this.reconcileOffset = start + 4;
    try {
      for (let index = 0; index < Math.min(4, entries.length); index++) {
        const [signature, operation] = entries[(start + index) % entries.length];
        if (this.inflightWrites.has(operation.requestId)) continue;
        if (!operation.message.method && !this.epoch) continue;
        try {
          const result = await this.fetchJson("/api/operations", {}, { requestId: operation.requestId }, 5_000);
          if (this.readyState !== 1 || document.visibilityState !== "visible") return;
          if (result.status !== "completed" || !result.message || this.inflightWrites.has(operation.requestId) || this.writes.get(signature) !== operation) continue;
          this.writes.delete(signature);
          this.saveWrites();
          if (!operation.message.method && !result.message.error && operation.epoch === this.epoch) {
            this.answeredRequests.add(String(operation.message.id));
            this.latestRequests = this.latestRequests.filter((request) => String(request.id) !== String(operation.message.id));
            this.emit({ method: "mobile/requests", params: { requests: this.latestRequests } });
            this.schedule(0);
          }
          this.emit({ method: "mobile/operation/confirmed", params: {
            requestId: operation.requestId, request: operation.message, response: result.message,
            ...(!operation.message.method && operation.epoch !== this.epoch ? { staleApproval: true } : {}),
          } });
        } catch { /* 未确认项保留，下一轮继续查询原 UUID。 */ }
      }
    } finally {
      this.reconciling = false;
      this.scheduleOperations();
    }
  }

  private onResume = () => {
    clearTimeout(this.timer);
    clearTimeout(this.operationTimer);
    this.operationTimer = undefined;
    this.operationDueAt = 0;
    if (document.visibilityState === "visible") { void this.poll(); void this.reconcileOperations(); }
  };

  private schedule(delay?: number) {
    clearTimeout(this.timer);
    if (this.readyState !== 1 || !this.initialized || document.visibilityState !== "visible") return;
    this.timer = setTimeout(() => void this.poll(), delay ?? (this.hasMore && !this.failures ? 0 : this.failures
      ? Math.min(30_000, 3_000 * 2 ** this.failures) : this.active ? 3_000 : 15_000));
  }

  private async poll() {
    if (!this.initialized || this.polling || this.readyState !== 1 || document.visibilityState !== "visible") return;
    clearTimeout(this.timer);
    this.polling = true;
    try {
      const payload = await this.fetchJson("/api/events", {}, { after: String(this.cursor) }) as PollResponse;
      if (this.readyState !== 1 || document.visibilityState !== "visible") return;
      if (this.epoch && this.epoch !== payload.epoch) { this.close(4001, "gateway session changed"); return; }
      this.epoch = payload.epoch;
      this.active = payload.active || payload.requests.length > 0;
      this.hasMore = payload.hasMore === true;
      if (this.catchingUp && !this.catchUpAnnounced) {
        this.catchUpAnnounced = true;
        this.emit({ method: "mobile/events/catchup", params: { active: true } });
      }
      if (payload.reset) this.emit({ method: "mobile/reset", params: {} });
      for (const message of payload.messages) this.emit(message);
      const pending = new Set(payload.requests.map((request) => String(request.id)));
      for (const id of this.answeredRequests) if (!pending.has(id)) this.answeredRequests.delete(id);
      const requests = payload.requests.filter((request) => !this.answeredRequests.has(String(request.id)));
      this.latestRequests = requests;
      for (const id of this.seenRequests) if (!pending.has(id)) this.seenRequests.delete(id);
      for (const request of requests) {
        if (this.seenRequests.has(String(request.id))) continue;
        this.seenRequests.add(String(request.id));
        this.emit(request);
      }
      this.emit({ method: "mobile/requests", params: { requests } });
      this.cursor = payload.cursor;
      if (this.catchingUp && !this.hasMore) {
        this.catchingUp = false;
        this.emit({ method: "mobile/events/catchup", params: { active: false } });
      }
      this.updatedAt = Date.now();
      this.failures = 0;
      this.sync(false);
    } catch (reason) {
      if (this.readyState !== 1) return;
      this.failures++;
      this.sync(true);
      if ([401, 503].includes((reason as { status?: number }).status ?? 0)) this.close(4001, "upstream unavailable");
    } finally {
      this.polling = false;
      this.schedule();
    }
  }

  private sync(stale: boolean) {
    const state: HttpSyncState = { updatedAt: this.updatedAt, stale };
    this.dispatchEvent(new CustomEvent("sync", { detail: state }));
    this.emit({ method: "mobile/sync", params: state });
  }

  openRealtime(): Promise<void> {
    if (this.realtime?.readyState === 1) return Promise.resolve();
    if (this.realtimeOpening) return this.realtimeOpening;
    const url = new URL(this.url("/api/realtime"));
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.realtime = socket;
    this.realtimeOpening = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error(t("实时会话连接超时"))); }, 10_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error(t("实时会话连接不可用"))); }, { once: true });
      socket.addEventListener("close", () => {
        clearTimeout(timer);
        reject(new Error(t("实时会话连接不可用")));
        if (this.realtime === socket) this.emit({ method: "thread/realtime/closed", params: { threadId: this.realtimeThreadId } });
      });
      socket.addEventListener("message", (event) => this.dispatchEvent(new MessageEvent("message", { data: event.data })));
    }).finally(() => { this.realtimeOpening = null; });
    return this.realtimeOpening;
  }

  closeRealtime() { this.realtime?.close(); this.realtime = null; }

  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    clearTimeout(this.timer);
    clearTimeout(this.operationTimer);
    this.operationTimer = undefined;
    this.operationDueAt = 0;
    this.controllers.forEach((controller) => controller.abort());
    this.closeRealtime();
    document.removeEventListener("visibilitychange", this.onResume);
    window.removeEventListener("online", this.onResume);
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }
}
