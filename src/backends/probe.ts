import { AppServerClient } from "../app-server/client";
import { HttpRpcTransport, transportUuid } from "./http-transport";
import type { BackendConfig } from "./types";
import { t } from "../i18n";
import { backendWebSocketUrl } from "./connection-manager";

export interface GatewayHostInfo {
  hostId: string;
  displayName: string;
  hostname: string;
  gatewayVersion: string;
  appServerReady: boolean;
  httpPolling?: boolean;
}

export interface BackendProjectState {
  projects: string[];
  projectlessThreadIds: string[];
}

export async function fetchBackendProjectState(
  config: BackendConfig,
): Promise<BackendProjectState> {
  const response = await fetch(
    withToken(config.baseUrl, "/api/projects", config.token),
    { method: "GET", mode: "cors" },
  );
  if (!response.ok) throw new Error(t("项目目录接口返回 {status}", { status: response.status }));
  const payload = (await response.json()) as {
    projects?: unknown;
    projectlessThreadIds?: unknown;
  };
  return {
    projects: Array.isArray(payload.projects)
      ? payload.projects.filter(
          (project): project is string => typeof project === "string",
        )
      : [],
    projectlessThreadIds: Array.isArray(payload.projectlessThreadIds)
      ? payload.projectlessThreadIds.filter(
          (threadId): threadId is string => typeof threadId === "string",
        )
      : [],
  };
}

export async function fetchBackendProjects(config: BackendConfig) {
  return (await fetchBackendProjectState(config)).projects;
}

function withToken(baseUrl: string, path: string, token: string) {
  const url = new URL(path, `${baseUrl}/`);
  if (token) url.searchParams.set("token", token);
  return url.toString();
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
        const client = new AppServerClient(socket);
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
      withToken(config.baseUrl, "/api/host", config.token),
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
  if (!info.appServerReady) {
    throw new Error(t("设备 app-server 尚未就绪"));
  }
  return info;
}

export async function probeBackend(
  config: BackendConfig,
  dependencies: ProbeDependencies = {},
): Promise<GatewayHostInfo> {
  const timeoutMs = dependencies.timeoutMs ?? 6_000;
  const info = await fetchBackendHostInfo(config, dependencies);
  if (config.transportMode === "stream") {
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
