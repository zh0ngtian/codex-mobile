import { AppServerClient } from "../app-server/client";
import { HttpRpcTransport, transportUuid } from "./http-transport";
import { gatewayUrl, readGatewayTargets } from './gateway-route';
import type { GatewayTarget, BackendConfig } from "./types";
import { t } from "../i18n";
import { backendWebSocketUrl } from "./connection-manager";
import { httpRequestScheduler, type HttpRequestPriority } from "./http-request-scheduler";
import type { DesktopProjectMembership } from "../../server/codex-projects";

export interface GatewayHostInfo {
  hostId: string;
  displayName: string;
  hostname: string;
  gatewayVersion: string;
  appServerReady: boolean;
  httpPolling?: boolean;
  remote?: { version: number; supported: boolean; configured?: boolean; authorized?: boolean; paired?: boolean; temporarilyOffline?: boolean; targets?: GatewayTarget[] };
}

export interface BackendProjectState {
  projects: string[];
  projectlessThreadIds: string[];
  projectWorktrees?: Record<string, string[]>;
  projectMembership?: DesktopProjectMembership;
}

function projectMembershipFrom(value: unknown, projects: string[]): DesktopProjectMembership | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const membership = value as Partial<Record<keyof DesktopProjectMembership, unknown>>;
  const known = new Set(projects);
  const entries = (input: unknown) => input && typeof input === "object" && !Array.isArray(input)
    ? Object.entries(input) : [];
  const readAssignments = (input: unknown): Record<string, string> => Object.fromEntries(
    entries(input).filter(([id, root]) => id.trim() && typeof root === "string" && known.has(root)),
  );
  const extraRoots: Record<string, string[]> = Object.fromEntries(entries(membership.extraRoots)
    .filter(([root, paths]) => known.has(root) && Array.isArray(paths))
    .map(([root, paths]) => [root, [...new Set((paths as unknown[]).filter(
      (path): path is string => typeof path === "string" && path !== root && known.has(path),
    ))]]));
  return { byThreadId: readAssignments(membership.byThreadId), byProjectId: readAssignments(membership.byProjectId), extraRoots };
}

export async function fetchBackendProjectState(
  config: BackendConfig,
  priority: HttpRequestPriority = "foreground",
  signal?: AbortSignal,
): Promise<BackendProjectState> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await httpRequestScheduler.run(new URL(config.baseUrl).origin, priority, controller.signal, async () => {
      timeout = setTimeout(() => controller.abort(new Error(t("{method} 请求超时", { method: "/api/projects" }))), 10_000);
      const response = await fetch(
        gatewayUrl(config, "/api/projects").toString(),
        { method: "GET", mode: "cors", signal: controller.signal },
      );
      if (!response.ok) throw new Error(t("项目目录接口返回 {status}", { status: response.status }));
      const payload = (await response.json()) as {
        projects?: unknown;
        projectlessThreadIds?: unknown;
        projectWorktrees?: unknown;
        projectMembership?: unknown;
      };
      const projects = Array.isArray(payload.projects)
        ? payload.projects.filter((project): project is string => typeof project === "string") : [];
      const projectWorktrees: Record<string, string[]> = {};
      if (payload.projectWorktrees && typeof payload.projectWorktrees === "object" && !Array.isArray(payload.projectWorktrees)) {
        for (const [root, paths] of Object.entries(payload.projectWorktrees)) {
          if (projects.includes(root) && Array.isArray(paths) && paths.every(path => typeof path === "string" && path.length > 0)) {
            projectWorktrees[root] = [...new Set(paths)].filter(path => !projects.includes(path));
          }
        }
      }
      const projectMembership = projectMembershipFrom(payload.projectMembership, projects);
      return {
        ...(Object.keys(projectWorktrees).length ? { projectWorktrees } : {}),
        ...(projectMembership ? { projectMembership } : {}),
        projects,
        projectlessThreadIds: Array.isArray(payload.projectlessThreadIds)
          ? payload.projectlessThreadIds.filter(
              (threadId): threadId is string => typeof threadId === "string",
            )
          : [],
      };
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function fetchBackendProjects(config: BackendConfig) {
  return (await fetchBackendProjectState(config)).projects;
}


async function initializeHttpSession(
  config: BackendConfig,
  timeoutMs: number,
) {
  const socket = new HttpRpcTransport(config, { sessionId: transportUuid() });
  try {
    await withTimeout(
      (async () => {
        await new Promise<void>((resolve, reject) => {
          socket.addEventListener("open", () => resolve(), { once: true });
          socket.addEventListener(
            "error",
            () => reject(new Error(t("无法连接设备网关"))),
            { once: true },
          );
          socket.addEventListener(
            "close",
            () => reject(new Error(t("与 app-server 的连接已断开"))),
            { once: true },
          );
        });
        const client = new AppServerClient(socket, config.gatewayMode === 'remote' ? { requestTimeoutMs: timeoutMs } : {});
        await client.initialize();
        await client.request("thread/loaded/list", { limit: 1 });
      })(),
      timeoutMs,
      t("HTTP initialize 超时"),
    );
  } finally {
    socket.close();
  }
}

async function initializeStreamSession(config: BackendConfig, timeoutMs: number) {
  const socket = new WebSocket(backendWebSocketUrl(config));
  try {
    await withTimeout((async () => {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error(t("无法连接设备 WebSocket"))), { once: true });
        socket.addEventListener("close", () => reject(new Error(t("设备 WebSocket 已关闭"))), { once: true });
      });
      const client = new AppServerClient(socket);
      await client.initialize();
      await client.request("thread/loaded/list", { limit: 1 });
    })(), timeoutMs, t("WebSocket initialize 超时"));
  } finally {
    socket.close();
  }
}

interface ProbeDependencies {
  timeoutMs?: number;
  fetchHost?: (
    input: string,
    init: RequestInit,
  ) => Promise<Response>;
  initializeHttp?: (config: BackendConfig) => Promise<void>;
  initializeStream?: (config: BackendConfig) => Promise<void>;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function fetchBackendHostInfo(
  config: BackendConfig,
  dependencies: Pick<ProbeDependencies, "timeoutMs" | "fetchHost"> = {},
): Promise<GatewayHostInfo> {
  const timeoutMs = dependencies.timeoutMs ?? 6_000;
  const fetchHost = dependencies.fetchHost ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchHost(
      gatewayUrl(config, "/api/host").toString(),
      {
        method: "GET",
        mode: "cors",
        signal: controller.signal,
      },
    );
  } catch (reason) {
    if (controller.signal.aborted) throw new Error(t("设备探测超时"));
    throw reason;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error(t("访问口令不正确"));
    if (response.status === 403) throw new Error(t("当前前端地址未被设备允许"));
    throw new Error(t("设备网关返回 {status}", { status: response.status }));
  }
  const info = (await response.json()) as GatewayHostInfo;
  if (
    !info ||
    typeof info.hostId !== "string" ||
    typeof info.displayName !== "string"
  ) {
    throw new Error(t("设备身份响应无效"));
  }
  if (config.gatewayMode === 'remote') {
    if (info.remote?.version !== 1 || !info.remote.supported) throw new Error(t('网关尚不支持远程模式，请先升级网关'));
    if (!info.remote.authorized) throw new Error(t('网关尚未完成 Remote 授权'));
    if (!info.remote.paired) throw new Error(t('网关本机尚未完成 Remote 配对'));
    info.remote.targets = readGatewayTargets(info.remote.targets);
    if (!info.remote.targets.some(target => target.isGatewayHost)) throw new Error(t('远程机器目录不可用'));
  } else if (!info.appServerReady) {
    throw new Error(t("设备 app-server 尚未就绪"));
  }
  return info;
}

export async function probeBackend(
  config: BackendConfig,
  dependencies: ProbeDependencies = {},
): Promise<GatewayHostInfo> {
  // Remote 需经官方中继建立逻辑流并验证目标；控制面仍沿用独立的6秒预算。
  const timeoutMs = dependencies.timeoutMs ?? (config.gatewayMode === 'remote' ? 60_000 : 6_000);
  const info = await fetchBackendHostInfo(config, dependencies);
  if (config.gatewayMode === 'remote') {
    if (info.remote?.temporarilyOffline) return info;
    const target = info.remote?.targets?.find(target => target.isGatewayHost);
    if (!target) throw new Error(t('远程机器目录不可用'));
    config = { ...config, remoteTarget: target.reference };
  }
  if (config.gatewayMode !== 'remote' && config.transportMode === "stream") {
    await withTimeout(
      dependencies.initializeStream?.(config) ?? initializeStreamSession(config, timeoutMs),
      timeoutMs,
      t("WebSocket initialize 超时"),
    );
    return info;
  }
  if (!info.httpPolling) throw new Error(t("设备网关需要升级以支持 HTTP 同步"));
  const initializeHttp =
    dependencies.initializeHttp ??
    ((config: BackendConfig) => initializeHttpSession(config, timeoutMs));
  await withTimeout(
    initializeHttp(config),
    timeoutMs,
    t("HTTP initialize 超时"),
  );
  return info;
}
