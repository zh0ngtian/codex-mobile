import { TitleSummaries } from "./title-summaries.js";
import { readDesktopPinnedThreads } from "./desktop-thread-pins.js";
import { createServer, type Server } from "node:http";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { performance } from 'node:perf_hooks';
import { extname, join, normalize } from "node:path";
import { homedir } from "node:os";
import WebSocket, { WebSocketServer } from "ws";
import type { CodexProjectState } from "./codex-projects.js";
import { readImageGenerationError } from "./image-generation-error.js";
import { TurnChangeHistory } from "./turn-change-history.js";
import { MessageWebCitations } from "./web-citations.js";
import { MessageTimestamps } from "./message-timestamps.js";
import { compactTurnDetails, compactTurnCommentary, turnCommentaryRequest, validTurnCommentaryParams } from "./turn-details.js";
import { FollowUps } from "./follow-ups.js";
import { HttpSessions, HOSTED_SESSION_ID, readOriginalOperation, validateRpcEnvelope } from "./http-session.js";
import { BarkNotifications } from "./bark-notifications.js";
import { FollowedThreadNotifications } from "./followed-thread-notifications.js";
import { ImagePreviews } from "./image-preview.js";
import { downloadFile } from "./file-download.js";
import { previewVideo } from "./video-preview.js";
import type { ModelUploadSource } from './model-upload-meter.js';
import { parseTargetReference, TargetResolver, type ResolvedRemoteTarget } from './targets.js';
import { GatewayRemoteServices } from './gateway-remote-services.js';
import { OperationScheduler } from './operation-scheduler.js';
import { ThreadObserver } from './thread-observer.js';
import { GatewayRpc } from './gateway-rpc.js';
import { GatewayAttachments } from './gateway-attachments.js';
import type { OperationContext } from './operation-queue.js';
import { withIndependentRemoteOperation } from './remote/operation-guard.js';

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
  uploadMeter?: ModelUploadSource;
  onAuthModeChanged?: (mode: string | null) => void;
  targetResolver?: TargetResolver;
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

function authorized(url: URL, expected?: string, cookie?: string) {
  return (
    !expected ||
    url.searchParams.get("token") === expected ||
    cookie?.split(";").some((part) => part.trim() === `codex_mobile_token=${encodeURIComponent(expected)}`)
  );
}

// HTTP 与升级请求在任何本地消费者执行前使用同一校验；公开 Remote 完整装配前禁止回落 Local。
function routingError(url: URL, remoteSupported = false) {
  const modes = url.searchParams.getAll('mode');
  const targets = url.searchParams.getAll('target');
  if (!modes.length && !targets.length) return;
  const invalid = { status: 400, error: { code: 'invalid-reference', message: '连接模式或目标参数无效' } };
  if (modes.length !== 1 || targets.length > 1) return invalid;
  if (modes[0] === 'local') return targets.length ? invalid : undefined;
  if (modes[0] !== 'remote') return invalid;
  if (targets.length) {
    try {
      if (!parseTargetReference(JSON.parse(targets[0]!))) return invalid;
    } catch { return invalid; }
  } else if (url.pathname !== '/api/host') return invalid;
  // host 是全网关能力探测，不选择或读取某个目标。
  if (url.pathname === '/api/host') return;
  if (remoteSupported) return;
  return { status: 503, error: {
    code: 'remote-not-supported', message: '此网关尚未开放远程模式，请使用支持远程模式的网关',
  } };
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
    "content-type, x-codex-file-name, x-codex-upload-id, x-codex-memory-only, x-codex-operation-id",
  );
  response.setHeader("vary", "Origin");
}

export async function createGateway(options: GatewayOptions): Promise<Gateway> {
  const home = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const resolver = options.targetResolver;
  const webCitations = new MessageWebCitations(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
  const timestamps = new MessageTimestamps(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
  const changeHistory = new TurnChangeHistory(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
  const notifications = new BarkNotifications({ codexHome: options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"), displayName: options.displayName ?? options.hostname ?? options.hostId ?? "Codex", fetch: options.barkFetch });
  const titleSummaries = new TitleSummaries(options.upstreamUrl);
  const summarize = async (titles: TitleSummaries, notifier: BarkNotifications, threadId: string, automatic: boolean, call: import('./http-session.js').SessionCallOptions) => {
    const naming = automatic ? notifier.beginAutomaticTitle(threadId) : undefined;
    try { const title = await titles.summarize(threadId, call.signal); naming?.candidate(title); return title; }
    catch (error) { naming?.fail(); throw error; }
  };
  const httpSessions = new HttpSessions({ ...options, changeHistory, notifications,
    titleSummary: (threadId, automatic, call) => summarize(titleSummaries, notifications, threadId, automatic, call) });
  const unsubscribeUpload = options.uploadMeter?.subscribe((threadId, usage) => httpSessions.publishUploadUsage(threadId, usage));
  type Bundle = { services: GatewayRemoteServices; notifications: BarkNotifications; meter: ModelUploadSource;
    observers: Set<FollowedThreadNotifications>; unsubscribes: Set<() => void>; close(): Promise<void> };
  const bundles = new Map<string, Promise<Bundle>>(); const contextBundles = new Map<string, Bundle>();
  let closing = false;
  const getBundle = async (target: ResolvedRemoteTarget, context: OperationContext, signal?: AbortSignal): Promise<Bundle> => {
    const key = target.descriptor.authorizationKey; let pending = bundles.get(key);
    if (!pending) {
      pending = (async () => {
        const services = await GatewayRemoteServices.create(target, home, signal);
        if (closing) { await services.close(); throw new Error('网关已关闭'); }
        const scope = createHash('sha256').update(JSON.stringify(['gateway-notifications-v1', context.gatewayId,
          context.mode === 'remote' ? context.managed : null, context.mode === 'remote' ? context.target : null])).digest('hex');
        const child = notifications.forTarget(scope, { displayName: options.displayName ?? 'Codex', rolloutSource: services.rollouts,
          authorize: () => resolver!.authorizeOperation(context, 'read') });
        let meter: import('./remote/model-upload-source.js').RemoteModelUploadSource | undefined;
        let starting: Promise<void> | undefined; let retryAt = 0; let stopped = false;
        const listeners = new Set<Parameters<ModelUploadSource['subscribe']>[0]>(); let unsubscribe: (() => void) | undefined;
        const start = () => {
          if (meter || starting || stopped || Date.now() < retryAt) return;
          starting = withIndependentRemoteOperation(() => { if (closing || stopped) throw new Error('网关已关闭'); }, async () => {
            meter = await services.uploadMeter();
            if (closing || stopped) { await meter.close(); return; }
            unsubscribe = meter.subscribe((threadId, usage) => { for (const listener of listeners) listener(threadId, usage); });
          }).catch(() => { meter = undefined; retryAt = Date.now() + 30000; }).finally(() => { starting = undefined; });
        };
        const source: ModelUploadSource = { read(threadId) { start(); return meter?.read(threadId) ?? null; }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
        const observers = new Set<FollowedThreadNotifications>(); const unsubscribes = new Set<() => void>();
        return { services, notifications: child, meter: source, observers, unsubscribes, async close() {
          stopped = true; unsubscribe?.(); listeners.clear();
          for (const observer of observers) { targetObservers.delete(observer); await observer.close(); }
          for (const unsubscribe of unsubscribes) { targetUnsubscribes.delete(unsubscribe); unsubscribe(); }
          await child.close(); await services.close(); await starting;
        } };
      })();
      bundles.set(key, pending); void pending.catch(() => { if (bundles.get(key) === pending) bundles.delete(key); });
    }
    const bundle = await pending;
    if (!bundle.services.ready) {
      if (bundles.get(key) === pending) bundles.delete(key); await bundle.close();
      if (closing) throw new Error('网关已关闭'); return getBundle(target, context, signal);
    }
    await target.assertCurrent(signal);
    contextBundles.set(context.authorizationKey, bundle); return bundle;
  };
  const targetObservers = new Set<FollowedThreadNotifications>(); const targetUnsubscribes = new Set<() => void>();
  const attachments = resolver ? new GatewayAttachments({ directory: join(home, 'codex-mobile-attachments'), resolver,
    services: async (context, signal) => {
      if (context.mode !== 'remote') throw new Error('附件目标不是 Remote');
      const fence = await resolver.authorizeOperationExecution(context, signal);
      const target = await resolver.resolve({ mode: 'remote', gatewayId: context.gatewayId, account: {
        accountId: context.managed.accountId, accountUserId: context.managed.accountUserId,
        ...(Object.hasOwn(context.managed, 'userId') ? { userId: context.managed.userId } : {}),
      }, target: context.target }, signal);
      const bundle = await getBundle(target, context, signal); fence.assertCurrent(); return bundle.services;
    },
  }) : undefined;
  let restoredFollowUps: FollowUps | undefined;
  let conversationObserver: ThreadObserver | undefined;
  const scheduler = resolver ? new OperationScheduler({ directory: join(home, 'codex-mobile-operations'), gatewayId: (await resolver.operationContext()).gatewayId,
    directRequests: true, messagePending: (context, threadId) => restoredFollowUps?.hasPending(context, threadId) ?? false,
    gatewayCodexHome: home, upstreamUrl: options.upstreamUrl, resolver, localSessions: httpSessions, attachments,
    remoteConsumers: async (context, target, call) => {
      const bundle = await getBundle(target, context, call.signal);
      return { projections: bundle.services.projections, sidechatReplay: bundle.services.sidechatReplay, notifications: bundle.notifications,
        uploadMeter: bundle.meter, isAvailable: () => bundle.services.ready,
        titleSummary: (threadId, automatic, call) => summarize(bundle.services.titles, bundle.notifications, threadId, automatic, call) };
    },
    async onResponse(context, message, response, sessionId) {
      if (message.method !== 'thread/resume' && message.method !== 'thread/start') return;
      const threadId = (response.result as any)?.thread?.id ?? message.params?.threadId;
      if (typeof threadId === 'string') await conversationObserver?.opened(context as OperationContext, threadId, sessionId);
    },
    onEvents(context, sessionId, events) {
      conversationObserver?.touch(context as OperationContext, sessionId);
      for (const message of [...events.messages, ...events.requests]) conversationObserver?.event(context as OperationContext, message);
    },
    onSessions(context, sessions) {
      const unsubscribeEvents = sessions.subscribeHosted(message => conversationObserver?.event(context as OperationContext, message));
      targetUnsubscribes.add(unsubscribeEvents);
      if (context.mode !== 'remote') return;
      const bundle = contextBundles.get(context.authorizationKey)!;
      bundle.unsubscribes.add(unsubscribeEvents);
      const unsubscribeMeter = bundle.meter.subscribe((threadId, usage) => sessions.publishUploadUsage(threadId, usage));
      targetUnsubscribes.add(unsubscribeMeter); bundle.unsubscribes.add(unsubscribeMeter);
      const child = bundle.notifications;
      const background = { hostedRpc: (message: import('./http-session.js').RpcMessage) => scheduler!.hostedRpc(context, message) };
      const observer = new FollowedThreadNotifications({ sessions: background, followedThreadIds: () => child.followedThreadIds,
        refreshFollowedThreadIds: async () => {
          if (!child.subscribed) { child.setFollowedThreadIds([]); return; }
          const revision = child.followingRevision;
          const threads = await readDesktopPinnedThreads(async (method, params) => {
            const response = await background.hostedRpc({ id: randomUUID(), method, params });
            if (response.error != null) throw new Error('无法读取目标桌面置顶'); return response.result;
          });
          child.setFollowedThreadIds(threads.map(thread => String(thread.id)), revision);
          for (const thread of threads) child.observeRpc({ method: 'thread/read' }, { result: { thread } });
        }, notifyCompletion: (threadId, turnId) => child.notifyFollowedCompletion(threadId, turnId),
        rememberThread: thread => child.observeRpc({ method: 'thread/read' }, { result: { thread } }),
      });
      targetObservers.add(observer); bundle.observers.add(observer);
      const unsubscribeFollowing = child.subscribeFollowing(() => { void observer.poll(); });
      targetUnsubscribes.add(unsubscribeFollowing); bundle.unsubscribes.add(unsubscribeFollowing); observer.start();
    },
  }) : undefined;
  conversationObserver = resolver && scheduler ? new ThreadObserver({ directory: join(home, 'codex-mobile-observers'), resolver, scheduler,
    onChanged: async (context, threadId, call) => {
      for (const message of scheduler.snapshots.requestsForThread(context, threadId)) await scheduler.hostedRpc(context, message, call);
    },
    followed: (context, threadId) => context.mode === 'local' ? notifications.followedThreadIds.has(threadId) : contextBundles.get(context.authorizationKey)?.notifications.followedThreadIds.has(threadId) === true,
  }) : undefined;
  conversationObserver?.start();
  const queuedRpc = resolver && scheduler ? new GatewayRpc(resolver, scheduler) : undefined;
  const followUps = await FollowUps.open(home, httpSessions, scheduler && resolver ? {
    context: await resolver.operationContext(),
    sessions: context => scheduler.sessionsForTarget(context, { deadline: performance.now() + 60000 }),
    authorize: (context, action) => resolver.authorizeOperation(context, action),
    migrate: () => scheduler.restorationSnapshot(),
    operation: item => readOriginalOperation({ gatewayCodexHome: home, resolver, context: item.context!, sessionId: HOSTED_SESSION_ID,
      requestId: item.operationId, call: { deadline: performance.now() + 60000 } }),
  } : undefined);
  restoredFollowUps = followUps;
  scheduler?.start();
  const localContext = resolver ? await resolver.operationContext() : undefined;
  const localBackground = { hostedRpc: (message: import('./http-session.js').RpcMessage) => scheduler && localContext ? scheduler.hostedRpc(localContext, message) : httpSessions.hostedRpc(message) };
  const followedNotifications = new FollowedThreadNotifications({
    sessions: localBackground, followedThreadIds: () => notifications.followedThreadIds,
    refreshFollowedThreadIds: async () => {
      if (!notifications.subscribed) { notifications.setFollowedThreadIds([]); return; }
      const revision = notifications.followingRevision;
      try {
        const threads = await readDesktopPinnedThreads(async (method, params) => {
          const response = await localBackground.hostedRpc({ id: randomUUID(), method, params });
          if (response.error != null) throw Object.assign(new Error((response.error as any)?.message ?? "无法读取桌面置顶状态"), { code: (response.error as any)?.code });
          return response.result;
        });
        notifications.setFollowedThreadIds(threads.map(thread => String(thread.id)), revision);
        for (const thread of threads) notifications.observeRpc({ method: "thread/read" }, { result: { thread } });
      } catch (error) { notifications.setFollowedThreadIds([], revision); throw error; }
    },
    notifyCompletion: (threadId, turnId) => notifications.notifyFollowedCompletion(threadId, turnId),
    rememberThread: thread => notifications.observeRpc({ method: "thread/read" }, { result: { thread } }),
  });
  const unsubscribeFollowing = notifications.subscribeFollowing(() => { void followedNotifications.poll(); });
  void notifications.initialized().then(() => followedNotifications.start()).catch(() => {});
  const imagePreviews = new ImagePreviews();
  const server: Server = createServer(async (request, response) => {
    let delivery = () => {};
    try {
    const url = new URL(request.url ?? "/", "http://gateway.local");
    const origin = request.headers.origin;
    const fileDownload = url.pathname.startsWith("/api/files/download/");
    const controlRequest = [
      "/api/status",
      "/api/notifications/settings",
      "/api/host",
      "/api/projects",
      "/api/uploads/file",
      "/api/uploads/operations",
      "/api/files/preview",
      "/api/images/preview",
      "/api/image-generation-error",
      "/api/rpc",
      "/api/read-snapshot",
      "/api/events",
      "/api/operations",
      "/api/follow-ups",
      "/api/queue",
      "/api/threads/title-summary",
    ].includes(url.pathname) || fileDownload;
    const apiRequest =
      url.pathname === "/api" || url.pathname.startsWith("/api/");
    if (apiRequest) {
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
    const routeError = apiRequest ? routingError(url, !!resolver) : undefined;
    if (routeError) {
      response.statusCode = routeError.status;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.end(JSON.stringify({ error: routeError.error }));
      return;
    }
    const reference = url.searchParams.get('mode') === 'remote' && url.searchParams.has('target') ? parseTargetReference(JSON.parse(url.searchParams.get('target')!)) : undefined;
    // RPC入口在handle内核验完整context并在交付前复核，不叠加另一份上下文和授权。
    if (queuedRpc && ['/api/rpc', '/api/events', '/api/operations', '/api/read-snapshot'].includes(url.pathname)) {
      await queuedRpc.handle(request, response, url, reference); return;
    }
    const context = apiRequest && resolver && url.pathname !== '/api/host' ? await resolver.operationContext(reference) : undefined;
    if (context?.mode === 'remote') {
      delivery = await resolver!.authorizeOperation(context, 'read');
      const write = response.write.bind(response); const end = response.end.bind(response); const writeHead = response.writeHead.bind(response);
      response.write = ((...args: any[]) => { delivery(); return Reflect.apply(write, response, args); }) as typeof response.write;
      response.end = ((...args: any[]) => { delivery(); return Reflect.apply(end, response, args); }) as typeof response.end;
      response.writeHead = ((...args: any[]) => { delivery(); return Reflect.apply(writeHead, response, args); }) as typeof response.writeHead;
    }
    if (queuedRpc && context && url.pathname === '/api/threads/title-summary' && (context.mode === 'remote' || request.headers['x-codex-operation-id'] || request.method === 'GET')) {
      const id = String(request.headers['x-codex-operation-id'] ?? url.searchParams.get('requestId') ?? randomUUID());
      let input: any;
      if (request.method === 'POST') {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 4096) throw Object.assign(new Error(), { status: 413 }); chunks.push(Buffer.from(chunk)); }
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error(), { status: 400 }); }
      } else if (request.method === 'GET') input = { threadId: url.searchParams.get('threadId'), automatic: url.searchParams.get('automatic') === 'true' };
      else throw Object.assign(new Error(), { status: 405 });
      if (typeof input?.threadId !== 'string' || !input.threadId.trim() || input.threadId.length > 256 || input.automatic !== undefined && typeof input.automatic !== 'boolean') throw Object.assign(new Error(), { status: 400 });
      const result = await queuedRpc.hosted(context, id, { id, method: 'mobile/titleSummary', params: { threadId: input.threadId, automatic: input.automatic === true } }, { deadline: performance.now() + 60000 }, request.method === 'GET');
      delivery = await resolver!.authorizeOperation(context, 'read');
      response.setHeader('content-type', 'application/json; charset=utf-8'); response.setHeader('cache-control', 'no-store');
      response.statusCode = result.status;
      response.end(JSON.stringify(result.status === 200 ? (result.body as any).error ? { error: (result.body as any).error } : (result.body as any).result : result.body)); return;
    }
    if (scheduler && context && url.pathname === '/api/queue') {
      let value: unknown;
      if (request.method === 'GET') value = await scheduler.publicQueue(context, url.searchParams.get('threadId') ?? undefined, fence => { delivery = fence; });
      else if (request.method === 'POST') {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > MAX_APP_SERVER_MESSAGE_BYTES) throw Object.assign(new Error(), { status: 413 }); chunks.push(Buffer.from(chunk)); }
        let body: any; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error(), { status: 400 }); }
        if (!body || typeof body !== 'object') throw Object.assign(new Error(), { status: 400 });
        value = await scheduler.mutatePublicQueue(context, body, fence => { delivery = fence; });
      } else throw Object.assign(new Error(), { status: 405 });
      response.setHeader('content-type', 'application/json; charset=utf-8'); response.setHeader('cache-control', 'no-store');
      delivery(); response.end(JSON.stringify(value)); return;
    }
    if (context && url.pathname === '/api/follow-ups') {
      await followUps.handle(request, response, context); return;
    }
    if (scheduler && attachments && context?.mode === 'remote' && ['/api/uploads/file', '/api/uploads/operations'].includes(url.pathname)) {
      const rawId = url.pathname === '/api/uploads/file' ? request.headers['x-codex-upload-id'] ?? randomUUID() : url.searchParams.get('requestId');
      if (typeof rawId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(rawId)) throw Object.assign(new Error(), { status: 400 });
      if (url.pathname === '/api/uploads/file') {
        if (request.method !== 'POST') throw Object.assign(new Error(), { status: 405 });
        let name = String(request.headers['x-codex-file-name'] ?? 'attachment'); try { name = decodeURIComponent(name); } catch { /* 保留既有文件名。 */ }
        name = name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240) || 'attachment';
        const type = String(request.headers['content-type'] ?? '').split(';', 1)[0]!;
        if (request.headers['x-codex-memory-only'] === 'true') {
          const controller = new AbortController(); const abort = () => controller.abort();
          request.once('aborted', abort); const timer = setTimeout(abort, 180000); timer.unref();
          try {
            const chunks: Buffer[] = []; let size = 0;
            for await (const chunk of request) { size += chunk.length; if (size > 100 * 1024 * 1024) throw Object.assign(new Error(), { status: 413 }); delivery(); chunks.push(Buffer.from(chunk)); }
            if (!size) throw Object.assign(new Error(), { status: 400 });
            const target = await resolver!.resolve(reference!, controller.signal); const bundle = await getBundle(target as ResolvedRemoteTarget, context, controller.signal);
            const path = await bundle.services.uploadPath(rawId, extname(name).slice(0, 19).replace(/[^.a-zA-Z0-9_-]/g, ''), controller.signal);
            const sha256 = createHash('sha256'); for (const chunk of chunks) sha256.update(chunk);
            const uploaded = await bundle.services.files.upload(path, (async function* () { yield* chunks; })(), { size, sha256: sha256.digest('hex'), expectedVersion: null, signal: controller.signal, timeoutMs: 180000 });
            delivery(); response.statusCode = 201; response.setHeader('content-type', 'application/json; charset=utf-8');
            response.end(JSON.stringify({ path: uploaded.path, name, type, size: uploaded.size })); return;
          } finally { request.removeListener('aborted', abort); clearTimeout(timer); }
        }
        const fence = await resolver!.authorizeOperationExecution(context); fence.assertLive();
        await attachments.retain(rawId, context, request, { name, type });
        const uploaded = await attachments.upload(rawId, context); fence.assertLive();
        response.setHeader('content-type', 'application/json; charset=utf-8'); response.statusCode = 201;
        delivery(); response.end(JSON.stringify(uploaded)); return;
      }
      if (request.method !== 'GET') throw Object.assign(new Error(), { status: 405 });
      const uploaded = await attachments.reconcile(rawId, context);
      response.setHeader('content-type', 'application/json; charset=utf-8'); response.setHeader('cache-control', 'no-store');
      response.statusCode = uploaded ? 201 : 202;
      delivery(); response.end(JSON.stringify(uploaded ?? { accepted: true, requestId: rawId, status: 'uncertain' })); return;
    }
    if (context?.mode === 'remote' && url.pathname === '/api/status') {
      response.setHeader('content-type', 'application/json; charset=utf-8');
      delivery(); response.end(JSON.stringify({ mode: 'remote' })); return;
    }
    const target = context?.mode === 'remote' ? await resolver!.resolve(reference!) : undefined;
    const bundle = target && context ? await getBundle(target, context) : undefined;
    const selectedNotifications = bundle?.notifications ?? notifications;
    const selectedTitles = bundle?.services.titles ?? titleSummaries;
    let mediaSource = bundle?.services.media;
    if (bundle && (fileDownload || ['/api/images/preview', '/api/files/preview'].includes(url.pathname))) {
      const reference = bundle.services.resolveReference(url.searchParams.get('path') ?? '');
      if (!reference) throw Object.assign(new Error(), { status: 400 });
      mediaSource = reference.source; url.searchParams.set('path', reference.path);
    }
    if (url.pathname === "/api/threads/title-summary") {
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ error: { message: "仅支持 POST" } })); return; }
      let automatic: ReturnType<BarkNotifications["beginAutomaticTitle"]>;
      try {
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 4096) throw new Error("标题总结参数过长"); chunks.push(chunk); }
        let body: any;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { response.statusCode = 400; response.end(JSON.stringify({ error: { message: "标题总结参数无效" } })); return; }
        if (typeof body?.threadId !== "string" || !body.threadId.trim() || body.threadId.length > 256) { response.statusCode = 400; response.end(JSON.stringify({ error: { message: "会话 ID 无效" } })); return; }
        if (body.automatic !== undefined && typeof body.automatic !== "boolean") { response.statusCode = 400; response.end(JSON.stringify({ error: { message: "自动命名参数无效" } })); return; }
        if (body.automatic === true) automatic = selectedNotifications.beginAutomaticTitle(body.threadId);
        const title = await selectedTitles.summarize(body.threadId);
        automatic?.candidate(title);
        response.end(JSON.stringify({ title }));
      } catch (error) { automatic?.fail(); response.statusCode = 503; response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : "标题总结失败" } })); }
      return;
    }
    if (url.pathname === "/api/follow-ups") {
      await followUps.handle(request, response);
      return;
    }
    if (url.pathname === "/api/notifications/settings") {
      await selectedNotifications.handle(request, response);
      return;
    }
    if (fileDownload) {
      await downloadFile(request, response, url, mediaSource);
      return;
    }
    if (url.pathname === "/api/images/preview") {
      await imagePreviews.handle(request, response, url, mediaSource);
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
      const error = await readImageGenerationError(codexHome, threadId, itemId, bundle?.services.rollouts);
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error }));
      return;
    }
    if (url.pathname === "/api/host") {
      let remote: unknown = { version: 1, supported: false };
      if (resolver) {
        try { const directory = await resolver.directory(); const value = { version: 1, supported: true, ...directory.data }; directory.assertCurrent(); remote = value; delivery = directory.assertCurrent; }
        catch { remote = { version: 1, supported: true, configured: false, authorized: false, paired: false, temporarilyOffline: false, state: 'authorization-required', targets: [] }; }
      }
      let appServerReady = false;
      try {
        appServerReady = options.appServerReady
          ? await options.appServerReady()
          : true;
      } catch {
        appServerReady = false;
      }
      response.setHeader("content-type", "application/json; charset=utf-8");
      delivery();
      response.end(
        JSON.stringify({
          hostId: options.hostId ?? "local",
          displayName:
            options.displayName ?? options.hostname ?? options.hostId ?? "Codex",
          hostname: options.hostname ?? "localhost",
          gatewayVersion: options.gatewayVersion ?? "0.1.0",
          appServerReady,
          httpPolling: true,
          followUpQueue: true,
          remote,
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
        const projectState = bundle ? await bundle.services.projectState() : options.readProjectState
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
      await previewVideo(request, response, url, mediaSource);
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
    } catch (error) {
      if (response.headersSent || response.destroyed) response.destroy();
      else {
        response.statusCode = [400, 403, 404, 405, 409, 413, 429, 507].includes((error as any)?.status) ? (error as any).status : 503;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        try { response.end(JSON.stringify({ error: { code: (error as any)?.code ?? 'target-unavailable', message: '目标或授权暂时不可用' } })); } catch { response.destroy(); }
      }
    }
  });

  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true });
  const queuedSocket = (client: WebSocket, context: OperationContext) => {
    const sessionId = randomUUID(); const controller = new AbortController(); let after = 0; let epoch: string | undefined;
    let initialized = false; let polling = false; let requests = new Set<string>();
    sockets.add(client);
    const send = (message: unknown) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message)); };
    const call = () => ({ deadline: performance.now() + 60000, signal: controller.signal });
    const poll = async () => {
      if (!initialized || polling || client.readyState !== WebSocket.OPEN) return;
      polling = true;
      try {
        const events = await scheduler!.events(context, sessionId, after, call());
        if (controller.signal.aborted) return;
        if (epoch && epoch !== events.epoch) { client.close(1012, 'session changed'); return; }
        epoch = events.epoch; after = events.cursor;
        const fence = await resolver!.authorizeOperation(context, 'read', controller.signal);
        for (const message of events.messages) { fence(); send(message); }
        const next = new Set<string>();
        for (const message of events.requests) {
          const key = JSON.stringify(message.id); next.add(key); if (!requests.has(key)) { fence(); send(message); }
        }
        requests = next;
      } catch { /* 暂时离线保留原游标与原逻辑 Session。 */ }
      finally { polling = false; }
    };
    const timer = setInterval(() => { void poll(); }, 250); timer.unref();
    client.on('error', () => {});
    client.on('close', () => { clearInterval(timer); controller.abort(); sockets.delete(client); });
    client.on('message', data => {
      void (async () => {
        if (rawMessageBytes(data) > MAX_APP_SERVER_MESSAGE_BYTES) { client.close(1009, 'message too large'); return; }
        const message = JSON.parse(rawMessageText(data));
        const requestId = randomUUID(); const envelope = validateRpcEnvelope({ requestId, message, ...(!message.method && epoch ? { epoch } : {}) });
        let result = await queuedRpc!.dispatch(context, sessionId, envelope, call());
        while (result.status === 202 && !controller.signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 250));
          const state = await scheduler!.operation(requestId, context, sessionId, call());
          if (state.message) result = { status: 200, body: state.message };
        }
        if (message.method === 'initialized') { initialized = true; void poll(); }
        const fence = await resolver!.authorizeOperation(context, 'read', controller.signal); fence();
        if (message.id != null) send({ ...result.body, id: message.id });
      })().catch(() => { if (!controller.signal.aborted) client.close(1011, 'RPC unavailable'); });
    });
  };
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
    const routeError = routingError(url, !!resolver);
    if (routeError) {
      const body = JSON.stringify({ error: routeError.error });
      socket.end(`HTTP/1.1 ${routeError.status} ${routeError.status === 400 ? 'Bad Request' : 'Service Unavailable'}\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      return;
    }
    if (resolver && scheduler) {
      void (async () => {
        const reference = url.searchParams.get('mode') === 'remote' ? parseTargetReference(JSON.parse(url.searchParams.get('target')!)) : undefined;
        const context = await resolver.operationContext(reference);
        const fence = await resolver.authorizeOperation(context, 'read');
        if (closing || socket.destroyed) throw new Error('连接已结束');
        if (url.pathname === '/api/realtime') {
          const sessions = await scheduler.sessionsForTarget(context, { deadline: performance.now() + 60000 });
          sessions.realtime(url.searchParams.get('sessionId')); fence();
          wss.handleUpgrade(request, socket, head, client => {
            sockets.add(client); client.on('close', () => sockets.delete(client)); sessions.realtime(url.searchParams.get('sessionId'), client);
          });
        } else { fence(); wss.handleUpgrade(request, socket, head, client => queuedSocket(client, context)); }
      })().catch(() => { if (!socket.destroyed) socket.end('HTTP/1.1 503 Target Unavailable\r\nConnection: close\r\n\r\n'); });
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
    let unsubscribeHosted: (() => void) | undefined;
    client.on("close", () => unsubscribeHosted?.());
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
      if (message.method === "serverRequest/resolved" && approvals.get(params.requestId) === thread) approvals.delete(params.requestId);
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
            if (request.method === "mobile/turns/commentary") {
              if (request.id == null || !validTurnCommentaryParams(request.params)) {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id: request.id ?? null, error: { code: -32602, message: "Invalid turn commentary parameters" } }));
                return;
              }
              data = Buffer.from(JSON.stringify({ id: request.id, ...turnCommentaryRequest(request.params) }));
            }
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
          if (message.method === 'mobile/uploadUsage/read') {
            try { client.send(JSON.stringify(httpSessions.uploadUsageRpc(message))); }
            catch { client.send(JSON.stringify({ id: message.id, error: { code: -32602, message: 'Invalid upload usage parameters' } })); }
            return;
          }
          if (["mobile/sidebar/summaries", "mobile/sidebar/projectless"].includes(message.method)) {
            void httpSessions.sidebarRpc(message).then(reply => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(reply)); })
              .catch(error => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id: message.id, error: { code: -32000, message: error.message } })); });
            return;
          }
          if (message.method === 'mobile/sidechat/rpc' || (httpSessions.sidechats.has(message.params?.threadId) && ['thread/settings/update', 'turn/interrupt'].includes(message.method))) {
            const envelope = message.method === 'mobile/sidechat/rpc' ? message : { ...message, params: { method: message.method, params: message.params } };
            void httpSessions.sidechatRpc(envelope).then(response => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(response)); }).catch(error => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id: message.id, error: { code: -32000, message: error.message } })); });
            return;
          }
          if (!message.method && typeof message.id === "string" && message.id.startsWith("hosted:")) {
            void httpSessions.replyHosted(randomUUID(), message).catch((error) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id: message.id, error: { code: -32000, message: error.message } })); });
            return;
          }
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
          if (message?.method === 'account/updated') options.onAuthModeChanged?.(message.params?.authMode ?? null);
          changeHistory.observe(message!);
          observeNotification(message!);
        } catch { /* Preserve non-JSON upstream messages. */ }
      }
      const request = message?.id != null && !message.method ? requests.get(message.id) : undefined;
      if (message) observeState(message, request);
      if (request && message) {
        requests.delete(message.id);
        if (request?.method === "initialize" && message.error == null && !unsubscribeHosted) {
          unsubscribeHosted = httpSessions.subscribeHosted((event) => {
            // App-server supplies subscribed events; gateway adds connection-local approvals and mobile origin authorization.
            if ((event.id != null || event.method === "serverRequest/resolved" || event.method === "mobile/turn/accepted" || event.method === 'mobile/uploadUsage/updated' || httpSessions.sidechats.has(event.params?.threadId) || event.method === "thread/closed") && client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
          });
        }
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
        if (message?.method === "item/completed") {
          const projected = await webCitations.notification(await timestamps.notification(message));
          if (projected !== message) output = JSON.stringify(projected);
        }
        if (request?.method === "mobile/turns/commentary" && message?.error == null) {
          output = JSON.stringify({ ...message, result: compactTurnCommentary(await webCitations.result(request.params!.threadId, await timestamps.result(request.params!.threadId, message!.result)), request.params!.turnId) });
        }
        if (request?.method === "thread/turns/list" && request.params?.itemsView === "full" &&
          message?.error == null && Array.isArray(message?.result?.data)) {
          const full = await timestamps.result(request.params!.threadId, message!.result);
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
        if (request && message?.error == null && message?.result &&
          ["thread/resume", "thread/read", "thread/turns/list", "thread/items/list"].includes(request.method ?? "")) {
          const response = typeof output === "string" ? JSON.parse(output) : message;
          response.result = await webCitations.result(request.params?.threadId ?? response.result?.thread?.id, response.result);
          output = JSON.stringify(response);
        }
        if (client.readyState === WebSocket.OPEN) client.send(output, { binary: isBinary });
      }).catch(() => {
        if (client.readyState === WebSocket.OPEN) client.send(request?.method === "mobile/turns/commentary"
          ? JSON.stringify({ id: message?.id, error: { code: -32000, message: "Commentary recovery unavailable" } })
          : data, { binary: isBinary });
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
      closing = true;
      titleSummaries.close();
      unsubscribeFollowing();
      unsubscribeUpload?.();
      await followedNotifications.close();
      for (const unsubscribe of targetUnsubscribes) unsubscribe();
      await Promise.all([...targetObservers].map(observer => observer.close()));
      await followUps.close();
      await conversationObserver?.close();
      await scheduler?.close();
      await httpSessions.close();
      await Promise.all([...bundles.values()].map(async value => (await value.catch(() => undefined))?.close()));
      await notifications.close();
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
