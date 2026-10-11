import { t } from "../i18n";

const MAX_APP_SERVER_MESSAGE_BYTES = 16 * 1024 * 1024;

function messageTooLarge(actualBytes: number, limitBytes: number) {
  return t("请求消息 {actual} MiB，超过服务端 {limit} MiB 上限。请压缩或减少图片后重试。", {
    actual: (actualBytes / 1024 / 1024).toFixed(1),
    limit: String(limitBytes / 1024 / 1024),
  });
}

export interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type NotificationListener = (message: RpcMessage) => void;
type RequestListener = (message: RpcMessage) => void;
type ThreadMetadataListener = (thread: Record<string, any>) => void;

interface PendingRequest {
  method: string;
  params: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

interface AppServerClientOptions {
  requestTimeoutMs?: number;
}

export interface AppServerSocket {
  readyState: number;
  managesHttpTimeout?: boolean;
  addEventListener(type: string, listener: (event: any) => void): void;
  send(data: string, timeoutMs?: number): void | Promise<void>;
  close(code?: number, reason?: string): void;
  openRealtime?: () => Promise<void>;
  closeRealtime?: () => void;
  pendingErrorForRequest?: (id: number | string) => Error | undefined;
}

export interface AppServerRequestOptions {
  timeoutMs?: number;
}

export class AppServerRpcError extends Error {
  readonly name = "AppServerRpcError";

  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export class AppServerConnectionUnavailableError extends Error {
  readonly name = "AppServerConnectionUnavailableError";
  readonly requestSent = false;

  constructor() {
    super(t("与 app-server 的连接不可用"));
  }
}

export class AppServerClient {
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private notificationListeners = new Set<NotificationListener>();
  private requestListeners = new Set<RequestListener>();
  private threadMetadataListeners = new Set<ThreadMetadataListener>();
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly socket: AppServerSocket,
    options: AppServerClientOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    socket.addEventListener("message", (event) => this.receive(String(event.data)));
    socket.addEventListener("close", () => {
      const error = new Error(t("与 app-server 的连接已断开"));
      for (const [id, waiter] of this.pending) {
        // HTTP send 自己区分未确认写入；关闭事件不能抢先把它变成普通失败。
        clearTimeout(waiter.timeout);
        waiter.reject(socket.pendingErrorForRequest?.(id) ?? error);
        this.pending.delete(id);
      }
    });
  }

  async initialize() {
    const result = await this.request("initialize", {
      clientInfo: { name: "codex-mobile-web", title: "Codex Mobile Web", version: "0.2.0" },
      capabilities: { experimentalApi: true },
    });
    await this.notify("initialized", {});
    return result;
  }

  request<T = unknown>(
    method: string,
    params: unknown,
    options: AppServerRequestOptions = {},
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) {
        reject(new AppServerConnectionUnavailableError());
        return;
      }
      const timeout = this.socket.managesHttpTimeout && !method.startsWith("thread/realtime/") ? undefined : setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(t("{method} 请求超时", { method })));
        if (this.socket.readyState === WebSocket.OPEN) {
          this.socket.close(4000, "request timeout");
        }
      }, options.timeoutMs ?? this.requestTimeoutMs);
      const pending: PendingRequest = {
        method,
        params: ["turn/start", "turn/steer"].includes(method) ? {
          threadId: (params as any)?.threadId,
          expectedTurnId: (params as any)?.expectedTurnId,
        } : undefined,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      };
      this.pending.set(id, pending);
      try {
        const sending = this.send({ id, method, params }, options.timeoutMs ?? this.requestTimeoutMs);
        if (sending) void sending.catch((reason) => {
          if (!this.pending.delete(id)) return;
          clearTimeout(timeout);
          reject(reason);
        });
      } catch (reason) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(reason);
      }
    });
  }

  notify(method: string, params: unknown) {
    return this.send({ method, params });
  }

  respond(id: number | string, result: unknown) {
    return this.send({ id, result });
  }

  respondError(id: number | string, code: number, message: string, data?: unknown) {
    return this.send({ id, error: { code, message, data } });
  }

  openRealtime() { return this.socket.openRealtime?.() ?? Promise.resolve(); }
  closeRealtime() { this.socket.closeRealtime?.(); }

  onNotification(listener: NotificationListener) {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onRequest(listener: RequestListener) {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  onThreadMetadata(listener: ThreadMetadataListener) {
    this.threadMetadataListeners.add(listener);
    return () => this.threadMetadataListeners.delete(listener);
  }

  private send(message: RpcMessage, timeoutMs?: number) {
    const payload = JSON.stringify(message);
    const bytes = new TextEncoder().encode(payload).byteLength;
    if (bytes > MAX_APP_SERVER_MESSAGE_BYTES) {
      throw new Error(messageTooLarge(bytes, MAX_APP_SERVER_MESSAGE_BYTES));
    }
    return this.socket.send(payload, timeoutMs);
  }

  private publishTurnAcceptance(request: { method?: string; params?: any }, response: RpcMessage) {
    if (response.error != null || !["turn/start", "turn/steer"].includes(request.method ?? "")) return;
    const result = response.result as any;
    // 内部事件只传分类所需 ID，不复制指令正文或完整回合。
    const message = { method: "mobile/turn/accepted", params: {
      request: { method: request.method, params: {
        threadId: request.params?.threadId, expectedTurnId: request.params?.expectedTurnId,
      } },
      response: { result: { turn: { id: result?.turn?.id }, turnId: result?.turnId } },
    } };
    for (const listener of this.notificationListeners) listener(message);
  }

  private receive(raw: string) {
    let message: RpcMessage;
    try {
      message = JSON.parse(raw) as RpcMessage;
    } catch {
      return;
    }
    if (message.id !== undefined && !message.method) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timeout);
      if (message.error) {
        const size = message.error.data as { actualBytes?: unknown; limitBytes?: unknown } | undefined;
        const detail = message.error.code === -32001 &&
          typeof size?.actualBytes === "number" &&
          typeof size?.limitBytes === "number"
          ? messageTooLarge(size.actualBytes, size.limitBytes)
          : message.error.message;
        waiter.reject(
          new AppServerRpcError(
            detail,
            message.error.code,
            message.error.data,
          ),
        );
      }
      else {
        // 在列表/搜索过滤之前登记原始来源，RPC 本身不产生完成通知。
        if (waiter.method.startsWith("thread/") && this.threadMetadataListeners.size) {
          const result = message.result as { thread?: unknown; data?: unknown } | undefined;
          const records = [result?.thread, ...(Array.isArray(result?.data) ? result.data : [])];
          for (const record of records) {
            const thread = record?.thread ?? record;
            if (!thread || typeof thread !== "object" || typeof thread.id !== "string" || !thread.id) continue;
            for (const listener of this.threadMetadataListeners) listener(thread);
          }
        }
        this.publishTurnAcceptance(waiter, message);
        waiter.resolve(message.result);
      }
      return;
    }
    if (message.id !== undefined && message.method) {
      for (const listener of this.requestListeners) listener(message);
      return;
    }
    if (message.method) {
      if (message.method === "mobile/operation/confirmed") {
        const params = message.params as any;
        if (params?.request && params?.response) this.publishTurnAcceptance(params.request, params.response);
      }
      for (const listener of this.notificationListeners) listener(message);
    }
  }
}
