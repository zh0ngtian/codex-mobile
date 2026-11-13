import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { createModelUploadProxy } from './model-upload-proxy.js';
import { readModelUploadRoutes } from './model-upload-routing.js';

export interface RuntimeConfig {
  mode: "managed" | "external";
  upstreamUrl: string;
  upstreamPort: number;
}

export interface GatewayRuntimeConfig {
  hostId: string;
  displayName: string;
  hostname: string;
  serveStatic: boolean;
}

export function resolveGatewayRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
  hostname = "localhost",
): GatewayRuntimeConfig {
  return {
    hostId: environment.CODEX_MOBILE_HOST_ID?.trim() || hostname,
    displayName: environment.CODEX_MOBILE_HOST_NAME?.trim() || hostname,
    hostname,
    serveStatic: environment.CODEX_MOBILE_SERVE_STATIC !== "false",
  };
}

export function modelUploadConfigArgs(overrides: ReadonlyArray<readonly [string, string]>) {
  // Codex 的 -c 路径按点直接分割；提供商 ID 使用一个 TOML 内联表覆盖，避免引号成为 ID 的一部分。
  const providers = overrides.flatMap(([key, value]) => {
    const match = /^model_providers\.(".*")\.base_url$/.exec(key);
    return match ? [`${match[1]}={base_url=${JSON.stringify(value)}}`] : [];
  });
  return [
    ...overrides.filter(([key]) => !key.startsWith('model_providers.')).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]),
    ...(providers.length ? ['-c', `model_providers={${providers.join(',')}}`] : []),
  ];
}

export function appServerCommand(port: number, overrides: ReadonlyArray<readonly [string, string]> = []) {
  return [
    "app-server",
    "--enable",
    "realtime_conversation",
    "--listen",
    `ws://127.0.0.1:${port}`,
    ...modelUploadConfigArgs(overrides),
  ];
}

export function appServerEnvironment(
  environment: Record<string, string | undefined> = process.env,
) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !key.startsWith("CODEX_MOBILE_"),
    ),
  );
}

export function assertGatewaySecurity(
  host: string,
  accessToken: string | undefined,
) {
  if (["127.0.0.1", "::1", "localhost"].includes(host)) return;
  if (!accessToken) {
    throw new Error("非回环监听必须配置 CODEX_MOBILE_TOKEN 访问口令");
  }
}

export function resolveRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const mode = environment.CODEX_APP_SERVER_MODE === "external" ? "external" : "managed";
  const upstreamPort = Number(environment.CODEX_APP_SERVER_PORT ?? "18765");
  return {
    mode,
    upstreamPort,
    upstreamUrl:
      mode === "external"
        ? environment.CODEX_APP_SERVER_URL ?? `ws://127.0.0.1:${upstreamPort}`
        : `ws://127.0.0.1:${upstreamPort}`,
  };
}

async function portAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

function assertStartupActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('app-server 启动已取消');
}

async function waitUntilReady(port: number, child: ChildProcess, signal?: AbortSignal) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    assertStartupActive(signal);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('codex app-server 已退出');
    try {
      const timeout = AbortSignal.timeout(Math.max(1, Math.min(2000, Math.ceil(deadline - performance.now()))));
      const response = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      assertStartupActive(signal);
      if (response.ok && performance.now() < deadline) return;
    } catch {
      assertStartupActive(signal);
      // 启动期间连接失败是预期行为。
    }
    await delay(100, undefined, { signal });
  }
  throw new Error('等待 codex app-server 就绪超时');
}

export async function startManagedAppServer(port: number, signal?: AbortSignal) {
  assertStartupActive(signal);
  if (!(await portAvailable(port))) throw new Error(`app-server 端口 ${port} 已被占用`);
  assertStartupActive(signal);
  const environment = appServerEnvironment();
  const routes = await readModelUploadRoutes(environment, { signal });
  assertStartupActive(signal);
  const proxy = await createModelUploadProxy(routes);
  let child: ChildProcess;
  try {
    assertStartupActive(signal);
    // 已将原 OPENAI_BASE_URL 纳入固定上游，子进程只使用本次命令行路由。
    delete environment.OPENAI_BASE_URL;
    child = spawn('codex', appServerCommand(port, proxy.overrides), {
      stdio: ['ignore', 'inherit', 'inherit'], env: environment,
    });
  } catch (error) {
    await proxy.close();
    throw error;
  }
  let closing: Promise<void> | undefined;
  let stopped = false;
  let reportExit!: (code: number | null) => void;
  const exited = new Promise<number | null>(resolve => reportExit = resolve);
  const actualExit = new Promise<void>(resolve => {
    child.once('exit', code => { if (!stopped) reportExit(code); resolve(); });
    child.once('error', () => resolve());
  });
  const spawnError = new Promise<never>((_, reject) => child.once('error', () => reject(new Error('无法启动 codex app-server'))));
  const cancel = () => { void close().catch(() => undefined); };
  function close(): Promise<void> {
    if (closing) return closing;
    stopped = true;
    closing = (async () => {
      try {
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          const kill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 3000);
          try { await actualExit; } finally { clearTimeout(kill); }
        }
        await actualExit;
        await proxy.close();
      } finally { signal?.removeEventListener('abort', cancel); }
    })();
    return closing;
  }
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    assertStartupActive(signal);
    await Promise.race([waitUntilReady(port, child, signal), spawnError]);
    assertStartupActive(signal);
    return { child, uploadMeter: proxy.meter, onAuthModeChanged: proxy.setAuthMode, exited, close };
  } catch (error) {
    await close();
    throw error;
  }
}
