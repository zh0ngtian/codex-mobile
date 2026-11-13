import { resolve, join } from 'node:path';
import { hostname as readHostname } from 'node:os';
import { createGateway, type Gateway } from './gateway.js';
import { assertGatewaySecurity, resolveGatewayRuntimeConfig, resolveRuntimeConfig, startManagedAppServer } from './app-server-manager.js';
import { readCodexProjectState } from './codex-projects.js';
import { writeRuntimeAccess } from './runtime-access.js';
import { externalDesktopModelUsage } from './desktop-model-upload.js';
import { RemoteRuntime, RemoteRuntimeError } from './remote/runtime.js';
import { PrivateStore } from './remote/private-store.js';
import { acquireRemoteOwner } from './remote/owner.js';
import { publishRemoteAdmin } from './remote/admin.js';
import { remoteDirectory } from './remote/admin-path.js';
const runtime = resolveRuntimeConfig();
const gatewayRuntime = resolveGatewayRuntimeConfig(process.env, readHostname());
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT || '18766');
const accessToken = process.env.CODEX_MOBILE_TOKEN;
let adminDirectory: string | undefined;
const abort = new AbortController();
let managed: Awaited<ReturnType<typeof startManagedAppServer>> | undefined;
let desktopMeter: ReturnType<typeof externalDesktopModelUsage>;
let gateway: Gateway | undefined;
let remote: RemoteRuntime | undefined;
let admin: Awaited<ReturnType<typeof publishRemoteAdmin>> | undefined;
let adminStarting: ReturnType<typeof publishRemoteAdmin> | undefined;
let owner: Awaited<ReturnType<typeof acquireRemoteOwner>> | undefined;
let stopping: Promise<void> | undefined;
function active() {
  if (abort.signal.aborted) {
    throw new Error('网关启动已取消');
  }
}
function cleanupResources() {
  // 同时触发所有同步关闭部分，一个close抛错也不会跳过其他资源。
  return Promise.allSettled([
    Promise.resolve().then(async () => {
      await admin?.close();
      await admin?.settled();
    }),
    Promise.resolve().then(() => adminStarting?.settled()),
    Promise.resolve().then(() => remote?.settled()),
    Promise.resolve().then(() => gateway?.close()),
    Promise.resolve().then(() => desktopMeter?.close()),
    Promise.resolve().then(() => managed?.close()),
  ]);
}
function stop(code = 0): Promise<void> {
  if (stopping) {
    return stopping;
  }
  abort.abort();
  // 实际收尾迟到时保留归属直到PID退出，不能因有界close已返回而释放锁。
  const forcedExit = setTimeout(() => process.exit(code || 1), 5000);
  stopping = (async () => {
    const early = cleanupResources();
    await starting.catch(() => undefined);
    const first = await early;
    const final = await cleanupResources();
    let exitCode = code;
    if ([...first, ...final].every(result => result.status === 'fulfilled')) {
      try {
        await owner?.close();
      }
      catch {
        exitCode ||= 1;
      }
    }
    else {
      exitCode ||= 1;
    }
    clearTimeout(forcedExit);
    process.exit(exitCode);
  })();
  return stopping;
}
process.on('SIGINT', () => {
  void stop();
});
process.on('SIGTERM', () => {
  void stop();
});
const starting = (async () => {
  assertGatewaySecurity(host, accessToken);
  // 非Unix的Local入口不接触硬件或管理端点；Unix未授权实例也不创建key/OAuth/Relay。
  if (process.platform !== 'win32' && typeof process.getuid === 'function') {
    adminDirectory = remoteDirectory();
    const store = new PrivateStore(adminDirectory);
    owner = await acquireRemoteOwner(store);
    active();
    remote = new RemoteRuntime({ store, canonicalUrl: runtime.upstreamUrl });
  }
  if (runtime.mode === 'managed') {
    managed = await startManagedAppServer(runtime.upstreamPort, abort.signal);
    managed.exited.then(() => {
      if (stopping) {
        return;
      }
      console.error('codex app-server 意外退出');
      void stop(1);
    });
    active();
  }
  if (runtime.mode === 'external') {
    desktopMeter = externalDesktopModelUsage(runtime.upstreamUrl);
  }
  active();
  gateway = await createGateway({
    host, port, mode: runtime.mode, upstreamUrl: runtime.upstreamUrl,
    staticDir: gatewayRuntime.serveStatic ? process.env.CODEX_MOBILE_STATIC_DIR || resolve(process.cwd(), 'dist') : null,
    accessToken,
    hostId: gatewayRuntime.hostId, displayName: gatewayRuntime.displayName, hostname: gatewayRuntime.hostname,
    gatewayVersion: process.env.CODEX_MOBILE_VERSION ?? process.env.npm_package_version ?? '0.2.0',
    uploadDir: process.env.CODEX_MOBILE_UPLOAD_DIR ?? join(process.env.CODEX_HOME || join(process.env.HOME || '', '.codex'), 'codex-mobile-uploads'),
    readProjectState: () => readCodexProjectState(join(process.env.CODEX_HOME || join(process.env.HOME || '', '.codex'), '.codex-global-state.json')),
    appServerReady: async () => {
      try {
        const ready = new URL(runtime.upstreamUrl);
        ready.protocol = ready.protocol === 'wss:' ? 'https:' : 'http:';
        ready.pathname = '/readyz';
        ready.search = '';
        ready.hash = '';
        return (await fetch(ready, { signal: AbortSignal.timeout(2000) })).ok;
      }
      catch {
        return false;
      }
    },
    uploadMeter: managed?.uploadMeter ?? desktopMeter,
    onAuthModeChanged: managed?.onAuthModeChanged,
  });
  active();
  if (remote) {
    try {
      await remote.start();
    }
    catch (error) {
      if (!(error instanceof RemoteRuntimeError)) {
        throw error;
      }
    }
    active();
    adminStarting = publishRemoteAdmin({ directory: adminDirectory!, runtime: remote, signal: abort.signal, access: () => ({ host, port: gateway!.port, token: accessToken ?? '' }) });
    admin = await adminStarting;
    active();
  }
  await writeRuntimeAccess(process.env.CODEX_MOBILE_RUNTIME_FILE, { port: gateway.port, token: accessToken ?? '' });
  active();
  console.log(`Codex Mobile Web: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${gateway.port} (${runtime.mode})`);
})();
void starting.catch(() => {
  if (!stopping) {
    console.error('网关启动失败：配置、私有归属或运行资源不可用');
    void stop(1);
  }
});
await starting.catch(() => undefined);
