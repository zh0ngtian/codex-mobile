import { createServer, type Server } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, isAbsolute, join, normalize } from "node:path";
import { homedir } from "node:os";
import WebSocket, { WebSocketServer } from "ws";
import type { CodexProjectState } from "./codex-projects.js";
import { readImageGenerationError } from "./image-generation-error.js";
import { TurnChangeHistory } from "./turn-change-history.js";
import { compactTurnDetails } from "./turn-details.js";
import { HttpSessions } from "./http-session.js";
import { BarkNotifications } from "./bark-notifications.js";
import { ImagePreviews } from "./image-preview.js";
import { downloadFile } from "./file-download.js";

const MAX_APP_SERVER_MESSAGE_BYTES = 16 * 1024 * 1024;

function rawMessageBytes(data: WebSocket.RawData) {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((total, part) => total + part.byteLength, 0);
  return data.byteLength;
}

function rawMessageText(data: WebSocket.RawData) {
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return data.toString("utf8");
}

export interface GatewayOptions {
  host: string;
  port: number;
  mode: "managed" | "external";
  upstreamUrl: string;
  staticDir: string | null;
  accessToken?: string;
  hostId?: string;
  displayName?: string;
  hostname?: string;
  gatewayVersion?: string;
  appServerReady?: () => Promise<boolean>;
  readProjectDirectories?: () => Promise<string[]>;
  readProjectState?: () => Promise<CodexProjectState>;
  uploadDir?: string;
  codexHome?: string;
  barkFetch?: typeof fetch;
}

export interface Gateway {
  port: number;
  close(): Promise<void>;
}

function sendableCloseCode(code: number) {
  return (
    (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
    (code >= 3000 && code <= 4999)
  );
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const videoContentTypes: Record<string, string> = {
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".ogg": "video/ogg",
  ".ogv": "video/ogg",
  ".webm": "video/webm",
};

function byteRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    end = Math.min(end, size - 1);
  }
  if (start < 0 || start >= size || end < start) return null;
  return { start, end };
}

function authorized(url: URL, expected?: string, cookie?: string) {
  return (
    !expected ||
    url.searchParams.get("token") === expected ||
    cookie?.split(";").some((part) => part.trim() === `codex_mobile_token=${encodeURIComponent(expected)}`)
  );
}

function applyCors(
  response: import("node:http").ServerResponse,
  origin: string | undefined,
) {
  if (!origin) return;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    "content-type, x-codex-file-name",
  );
  response.setHeader("vary", "Origin");
}

export async function createGateway(options: GatewayOptions): Promise<Gateway> {
  const changeHistory = new TurnChangeHistory(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
  const notifications = new BarkNotifications({ codexHome: options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"), displayName: options.displayName ?? options.hostname ?? options.hostId ?? "Codex", fetch: options.barkFetch });
  const httpSessions = new HttpSessions({ ...options, changeHistory, notifications });
  const imagePreviews = new ImagePreviews();
  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://gateway.local");
    const origin = request.headers.origin;
    const fileDownload = url.pathname.startsWith("/api/files/download/");
    const controlRequest = [
      "/api/status",
      "/api/notifications/settings",
      "/api/host",
      "/api/projects",
      "/api/uploads/file",
      "/api/files/preview",
      "/api/images/preview",
      "/api/image-generation-error",
      "/api/rpc",
      "/api/events",
      "/api/operations",
    ].includes(url.pathname) || fileDownload;
    const apiRequest =
      url.pathname === "/api" || url.pathname.startsWith("/api/");
    if (controlRequest) {
      applyCors(response, origin);
    }
    if (fileDownload) {
      response.setHeader("access-control-allow-methods", "GET, HEAD, OPTIONS");
      response.setHeader("access-control-expose-headers", "content-disposition, content-length, content-type");
    }
    if (url.pathname === "/api/images/preview") {
      response.setHeader("x-codex-image-preview", "1");
      response.setHeader("access-control-expose-headers", "x-codex-image-preview, content-type, etag");
      if (origin) {
        response.setHeader("access-control-allow-methods", "GET, HEAD, OPTIONS");
        response.setHeader("access-control-allow-headers", "content-type, if-none-match");
      }
    }
    if (
      apiRequest &&
      !authorized(url, options.accessToken, request.headers.cookie)
    ) {
      response.statusCode = 401;
      response.end("Unauthorized");
      return;
    }
    if (options.accessToken && url.searchParams.get("token") === options.accessToken) {
      response.setHeader(
        "set-cookie",
        `codex_mobile_token=${encodeURIComponent(options.accessToken)}; Path=/; HttpOnly; SameSite=Strict`,
      );
    }
    if (controlRequest && request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (url.pathname === "/api/notifications/settings") {
      await notifications.handle(request, response);
      return;
    }
    if (fileDownload) {
      await downloadFile(request, response, url);
      return;
    }
    if (url.pathname === "/api/images/preview") {
      await imagePreviews.handle(request, response, url);
      return;
    }
    if (["/api/rpc", "/api/events", "/api/operations"].includes(url.pathname)) {
      await httpSessions.handle(request, response, url);
      return;
    }
    if (url.pathname === "/api/image-generation-error") {
      const threadId = url.searchParams.get("threadId") ?? "";
      const itemId = url.searchParams.get("itemId") ?? "";
      const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
      const error = await readImageGenerationError(codexHome, threadId, itemId);
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error }));
      return;
    }
    if (url.pathname === "/api/host") {
      let appServerReady = false;
      try {
        appServerReady = options.appServerReady
          ? await options.appServerReady()
          : true;
      } catch {
        appServerReady = false;
      }
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          hostId: options.hostId ?? "local",
          displayName:
            options.displayName ?? options.hostname ?? options.hostId ?? "Codex",
          hostname: options.hostname ?? "localhost",
          gatewayVersion: options.gatewayVersion ?? "0.1.0",
          appServerReady,
          httpPolling: true,
          barkPush: true,
          imagePreview: true,
        }),
      );
      return;
    }
    if (url.pathname === "/api/status") {
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ mode: options.mode, upstreamUrl: options.upstreamUrl }));
      return;
    }
    if (url.pathname === "/api/projects") {
      try {
        const projectState = options.readProjectState
          ? await options.readProjectState()
          : {
              projects: options.readProjectDirectories
                ? await options.readProjectDirectories()
                : [],
              projectlessThreadIds: [],
            };
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify(projectState));
      } catch {
        response.statusCode = 500;
        response.end("无法读取 Codex 本地项目");
      }
      return;
    }
    if (url.pathname === "/api/uploads/file" && request.method === "POST") {
      const type = String(request.headers["content-type"] ?? "").split(";", 1)[0];
      if (!options.uploadDir) {
        response.statusCode = 503;
        response.end("Upload directory unavailable");
        return;
      }
      const declaredSize = Number(request.headers["content-length"] ?? 0);
      const maxBytes = 100 * 1024 * 1024;
      if (declaredSize > maxBytes) {
        response.statusCode = 413;
        response.end("File exceeds 100 MB");
        return;
      }
      const rawName = Array.isArray(request.headers["x-codex-file-name"])
        ? request.headers["x-codex-file-name"][0]
        : request.headers["x-codex-file-name"];
      let name = "attachment";
      if (rawName) {
        try {
          name = decodeURIComponent(rawName);
        } catch {
          name = rawName;
        }
      }
      name = name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240) || "attachment";
      const extension = extname(name)
        .slice(0, 20)
        .replace(/[^.a-zA-Z0-9_-]/g, "");
      try {
        await mkdir(options.uploadDir, { recursive: true });
      } catch {
        response.statusCode = 500;
        response.end("Unable to prepare upload directory");
        return;
      }
      const filePath = join(options.uploadDir, `${Date.now()}-${randomUUID()}${extension}`);
      let file;
      try {
        file = await open(filePath, "wx");
      } catch {
        response.statusCode = 500;
        response.end("Unable to create upload file");
        return;
      }
      let size = 0;
      try {
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.byteLength;
          if (size > maxBytes) throw new Error("FILE_TOO_LARGE");
          await file.write(buffer);
        }
      } catch (error) {
        await file.close();
        await rm(filePath, { force: true });
        response.statusCode = error instanceof Error && error.message === "FILE_TOO_LARGE" ? 413 : 400;
        response.end("Unable to upload file");
        return;
      }
      await file.close();
      if (!size) {
        await rm(filePath, { force: true });
        response.statusCode = 400;
        response.end("File is empty");
        return;
      }
      response.statusCode = 201;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ path: filePath, name, type, size }));
      return;
    }
    if (url.pathname === "/api/files/preview" && request.method === "GET") {
      const filePath = url.searchParams.get("path") ?? "";
      const contentType = videoContentTypes[extname(filePath).toLowerCase()];
      if (!filePath || !isAbsolute(filePath) || !contentType) {
        response.statusCode = 415;
        response.end("Unsupported video path");
        return;
      }
      try {
        const details = await stat(filePath);
        if (!details.isFile()) throw new Error("NOT_A_FILE");
        response.setHeader("accept-ranges", "bytes");
        response.setHeader("content-type", contentType);
        response.setHeader("cache-control", "private, no-store");
        const rangeHeader = request.headers.range;
        if (rangeHeader) {
          const range = byteRange(rangeHeader, details.size);
          if (!range) {
            response.statusCode = 416;
            response.setHeader("content-range", `bytes */${details.size}`);
            response.end();
            return;
          }
          response.statusCode = 206;
          response.setHeader(
            "content-range",
            `bytes ${range.start}-${range.end}/${details.size}`,
          );
          response.setHeader("content-length", range.end - range.start + 1);
          createReadStream(filePath, range).pipe(response);
          return;
        }
        response.setHeader("content-length", details.size);
        createReadStream(filePath).pipe(response);
      } catch {
        response.statusCode = 404;
        response.end("Video not found");
      }
      return;
    }
    if (apiRequest) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    if (!options.staticDir) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
    let filePath = join(options.staticDir, safePath);
    try {
      const body = await readFile(filePath);
      response.setHeader("content-type", contentTypes[extname(filePath)] ?? "application/octet-stream");
      response.end(body);
    } catch {
      filePath = join(options.staticDir, "index.html");
      try {
        response.setHeader("content-type", contentTypes[".html"]);
        response.end(await readFile(filePath));
      } catch {
        response.statusCode = 404;
        response.end("Not found");
      }
    }
  });

  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://gateway.local");
    if (url.pathname !== "/ws" && url.pathname !== "/api/realtime") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!authorized(url, options.accessToken, request.headers.cookie)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (url.pathname === "/api/realtime") {
      try { httpSessions.realtime(url.searchParams.get("sessionId")); }
      catch (error) {
        socket.write(`HTTP/1.1 ${(error as { status?: number }).status ?? 503} Session Unavailable\r\nConnection: close\r\n\r\n`);
        socket.destroy(); return;
      }
      wss.handleUpgrade(request, socket, head, (client) => {
        sockets.add(client); client.on("close", () => sockets.delete(client));
        httpSessions.realtime(url.searchParams.get("sessionId"), client);
      });
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
  });

  wss.on("connection", (client) => {
    sockets.add(client);
    const upstream = new WebSocket(options.upstreamUrl);
    sockets.add(upstream);
    const pending: Array<{ data: WebSocket.RawData; binary: boolean }> = [];
    let detached = false;
    let lastCompletionAt = 0;
    let retentionTimer: NodeJS.Timeout | undefined;
    let retentionDeadline = 0;
    const running = new Set<string>();
    const completed = new Set<string>();
    const pendingStarts = new Map<string | number, string>();
    const approvals = new Map<string | number, string>();
    // 仅为稀疏完成通知保留分类信息，不缓存会话正文；连接之间相互隔离。
    const itemMetadata = new Map<string, { type?: string; phase?: string }>();
    const observeNotification = (message: Record<string, any>) => {
      const params = message.params;
      const item = params?.item;
      if (message.id == null && ["item/started", "item/completed"].includes(message.method) &&
        typeof params?.threadId === "string" && params.threadId.length <= 1024 &&
        typeof params.turnId === "string" && params.turnId.length <= 1024 &&
        typeof item?.id === "string" && item.id.length <= 1024) {
        const key = JSON.stringify([params.threadId, params.turnId, item.id]);
        const previous = itemMetadata.get(key);
        const metadata = {
          ...(previous ?? {}),
          ...(typeof item.type === "string" && item.type.length <= 64 ? { type: item.type } : {}),
          ...(typeof item.phase === "string" && item.phase.length <= 64 ? { phase: item.phase } : {}),
        };
        itemMetadata.set(key, metadata);
        while (itemMetadata.size > 512) itemMetadata.delete(itemMetadata.keys().next().value!);
        notifications.observe({ ...message, params: { ...params, item: { ...metadata, ...item } } });
      } else notifications.observe(message);
    };
    const release = () => {
      if (retentionTimer) clearTimeout(retentionTimer);
      retentionTimer = undefined;
      if (upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
    };
    const retain = () => {
      if (!detached) return;
      if (retentionTimer) clearTimeout(retentionTimer);
      if (!notifications.subscribed) { release(); return; }
      // 运行或等待审批时保留；静默最多半小时，完成后留一秒接收迟到的 final。
      const delay = running.size || pendingStarts.size || approvals.size ? 30 * 60 * 1000 : 1000;
      retentionDeadline = Date.now() + delay;
      const checkRetention = () => {
        if (!notifications.subscribed || Date.now() >= retentionDeadline) { release(); return; }
        retentionTimer = setTimeout(checkRetention, Math.min(1000, retentionDeadline - Date.now()));
        retentionTimer.unref();
      };
      retentionTimer = setTimeout(checkRetention, Math.min(1000, delay));
      retentionTimer.unref();
    };
    const observeState = (message: Record<string, any>, request?: { method?: string; params?: Record<string, any> }) => {
      const params = message.params ?? {};
      const thread = params.threadId ?? params.thread?.id;
      const turn = params.turn?.id ?? params.turnId;
      const key = `${thread}:${turn}`;
      if (message.method === "turn/started" && !completed.has(key)) running.add(key);
      if (message.method === "turn/completed") {
        lastCompletionAt = Date.now();
        running.delete(key); running.delete(`${thread}:status`); completed.add(key);
        while (completed.size > 512) completed.delete(completed.values().next().value!);
        for (const [id, approvalThread] of approvals) if (approvalThread === thread) approvals.delete(id);
      }
      if (message.method === "thread/status/changed") {
        const status = params.status?.type ?? params.status;
        if (status === "active") running.add(`${thread}:status`);
        if (["idle", "notLoaded", "systemError"].includes(status)) for (const entry of running) if (entry.startsWith(`${thread}:`)) running.delete(entry);
      }
      if (message.method && message.id != null) approvals.set(message.id, String(thread ?? ""));
      if (request?.method === "turn/start") {
        pendingStarts.delete(message.id);
        const resultTurn = message.result?.turn;
        const resultKey = `${request.params?.threadId}:${resultTurn?.id}`;
        if (message.error == null && resultTurn?.id && !completed.has(resultKey) && !["completed", "failed", "interrupted", "cancelled"].includes(resultTurn.status)) running.add(resultKey);
      }
      if (request && message.error == null && ["thread/resume", "thread/read"].includes(request.method ?? "")) {
        const resultThread = message.result?.thread;
        const status = resultThread?.status?.type ?? resultThread?.status;
        if (status === "active") running.add(`${resultThread.id}:status`);
        for (const resultTurn of resultThread?.turns ?? []) if (["inProgress", "in_progress", "running"].includes(resultTurn.status) && !completed.has(`${resultThread.id}:${resultTurn.id}`)) running.add(`${resultThread.id}:${resultTurn.id}`);
      }
      retain();
    };
    let pendingBytes = 0;
    const maxPendingBytes = 1024 * 1024;

    const requests = new Map<string | number, { method?: string; params?: Record<string, any> }>();
    let sendQueue = Promise.resolve();
    let responseQueue = Promise.resolve();
    const forward = (data: WebSocket.RawData, isBinary: boolean) => {
      sendQueue = sendQueue.then(async () => {
        let preparedThread: string | undefined;
        if (!isBinary) {
          try {
            const request = JSON.parse(rawMessageText(data));
            if (request.method && request.id != null) {
              requests.set(request.id, request);
              if (requests.size > 512) requests.delete(requests.keys().next().value!);
            }
            if (request.method === "turn/start" && typeof request.params?.threadId === "string") {
              preparedThread = request.params.threadId;
              await changeHistory.beforeStart(request.params.threadId, request.params.cwd).catch(() => {});
            }
          } catch { /* Invalid JSON is forwarded for upstream validation. */ }
        }
        if (upstream.readyState === WebSocket.OPEN) {
          try { upstream.send(data, { binary: isBinary }); }
          catch { if (preparedThread) await changeHistory.cancelStart(preparedThread); }
        } else if (preparedThread) await changeHistory.cancelStart(preparedThread);
      }).catch(() => {});
    };

    client.on("message", (data, isBinary) => {
      const bytes = rawMessageBytes(data);
      if (bytes > MAX_APP_SERVER_MESSAGE_BYTES) {
        let id: unknown;
        if (!isBinary) {
          try { id = JSON.parse(rawMessageText(data)).id; } catch { /* Invalid JSON has no request ID. */ }
        }
        if ((typeof id === "string" || typeof id === "number") && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            id,
            error: {
              code: -32001,
              message: "Request message exceeds the app-server 16 MiB limit",
              data: { actualBytes: bytes, limitBytes: MAX_APP_SERVER_MESSAGE_BYTES },
            },
          }));
        } else {
          client.close(1009, "message exceeds app-server limit");
        }
        return;
      }
      if (!isBinary) {
        try {
          const message = JSON.parse(rawMessageText(data));
          if (message.method === "turn/start" && message.id != null && typeof message.params?.threadId === "string") pendingStarts.set(message.id, message.params.threadId);
          if (!message.method && message.id != null) approvals.delete(message.id);
        } catch { /* 上游验证消息格式。 */ }
      }
      if (upstream.readyState === WebSocket.OPEN) forward(data, isBinary);
      else if (upstream.readyState === WebSocket.CONNECTING) {
        pendingBytes += bytes;
        if (pendingBytes > maxPendingBytes) {
          client.close(1009, "pending messages exceeded limit");
          upstream.terminate();
          return;
        }
        pending.push({ data, binary: isBinary });
      }
    });
    upstream.on("open", () => {
      for (const message of pending.splice(0)) forward(message.data, message.binary);
      pendingBytes = 0;
    });
    upstream.on("message", (data, isBinary) => {
      let message: Record<string, any> | undefined;
      if (!isBinary) {
        try {
          message = JSON.parse(rawMessageText(data));
          changeHistory.observe(message!);
          observeNotification(message!);
        } catch { /* Preserve non-JSON upstream messages. */ }
      }
      const request = message?.id != null && !message.method ? requests.get(message.id) : undefined;
      if (message) observeState(message, request);
      if (request && message) {
        requests.delete(message.id);
        notifications.observeRpc(request, message);
        const thread = message.result?.thread;
        if (thread?.id) changeHistory.observe({ method: "thread/started", params: { thread } });
        if (request.method === "turn/start" && message.result?.turn?.id) changeHistory.observe({
          method: "turn/started", params: { threadId: request.params?.threadId, turn: message.result.turn },
        });
      }
      responseQueue = responseQueue.then(async () => {
        if (request?.method === "turn/start" && message?.error != null && typeof request.params?.threadId === "string") {
          await changeHistory.cancelStart(request.params.threadId);
        }
        let output: WebSocket.RawData | string = data;
        if (request?.method === "thread/turns/list" && request.params?.itemsView === "full" &&
          message?.error == null && Array.isArray(message?.result?.data)) {
          const full = message!.result;
          const stats = Object.fromEntries(await Promise.all(full.data.map(async (turn: Record<string, any>) =>
            [String(turn.id), await changeHistory.get(request.params!.threadId, turn)],
          )));
          const details = compactTurnDetails(full, stats).data;
          output = JSON.stringify({ ...message, result: { ...full, data: full.data.map((turn: Record<string, any>, index: number) => ({
            ...turn, ...(details[index].loadedChangeStats
              ? { loadedChangeStats: details[index].loadedChangeStats,
                ...(details[index].changeStatsSource ? { changeStatsSource: details[index].changeStatsSource } : {}),
                changeStatsUnavailable: false }
              : { loadedChangeStats: undefined, changeStatsUnavailable: true }),
          })) } });
        }
        if (client.readyState === WebSocket.OPEN) client.send(output, { binary: isBinary });
      }).catch(() => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      });
    });
    upstream.on("error", () => {
      if (client.readyState === WebSocket.OPEN) client.close(1011, "app-server unavailable");
    });
    client.on("close", (code, reason) => {
      detached = true;
      if (notifications.subscribed && (running.size || pendingStarts.size || approvals.size || Date.now() - lastCompletionAt < 1000)) { retain(); return; }
      if (upstream.readyState === WebSocket.OPEN) {
        if (sendableCloseCode(code)) upstream.close(code, reason);
        else upstream.terminate();
      }
      else upstream.terminate();
    });
    upstream.on("close", (code, reason) => {
      itemMetadata.clear();
      if (retentionTimer) clearTimeout(retentionTimer);
      retentionTimer = undefined;
      if (client.readyState === WebSocket.OPEN) {
        if (sendableCloseCode(code)) client.close(code, reason);
        else client.close(1011, "app-server disconnected");
      }
    });
    const forget = (socket: WebSocket) => () => sockets.delete(socket);
    client.on("close", forget(client));
    upstream.on("close", forget(upstream));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法读取网关端口");

  return {
    port: address.port,
    async close() {
      await httpSessions.close();
      await notifications.close();
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
