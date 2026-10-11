import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, mkdir, appendFile, unlink, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SharedEndpoint } from './shared-endpoint.mjs';
import { ServiceRuntime } from './runtime.mjs';
import { inspectVersion, snapshotVersion, bundleSignature, retainVersions } from './versions.mjs';
import { createControlHandler } from './control.mjs';
import { SidecarSupervisor } from './components.mjs';

const execute = promisify(execFile), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const windowsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(process.argv[2] ?? 'service.json'), root = dirname(configPath);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const ports = [config.ServerPort, config.PrivateServerPort, config.GatewayPort];
if (ports.some((p) => !Number.isInteger(p) || p < 1024 || p > 65535) || new Set(ports).size !== ports.length) throw new Error('无效服务端口');
const token = (await readFile(join(root, 'control-token'), 'utf8')).trim();
const gatewayToken = process.env.CODEX_MOBILE_TOKEN;
if (!gatewayToken || gatewayToken.length < 16) throw new Error('缺少网关凭据');
const powershell = join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const ssh = join(process.env.WINDIR, 'System32', 'OpenSSH', 'ssh.exe');
const psArgs = (file, args = []) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', join(windowsRoot, file), ...args];
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CODEX_MOBILE_') && !['CODEX_APP_SERVER_WS_URL', 'CODEX_APP_SERVER_FORCE_CLI'].includes(key)));
const publicUrl = `ws://127.0.0.1:${config.ServerPort}`, privateUrl = `ws://127.0.0.1:${config.PrivateServerPort}`;
let sides, runtime, handler, stopping = false, cache;
async function launch(executable, args, env = cleanEnv) {
  const child = spawn(executable, args, { cwd: config.RepositoryPath, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // 下游输出可能包含用户内容，默认不复制到 supervisor 日志。
  child.stdout.resume(); child.stderr.resume();
  const exited = new Promise((r) => { child.once('exit', r); child.once('error', () => r(-1)); });
  await new Promise((r, reject) => { child.once('spawn', r); child.once('error', reject); });
  return { pid: child.pid, alive: () => child.exitCode === null && child.signalCode === null,
    stop: async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; } };
}
async function resolveVersion() {
  const { stdout } = await execute(powershell, psArgs('resolve-desktop.ps1'), { env: cleanEnv, windowsHide: true, encoding: 'utf8', timeout: 30_000, maxBuffer: 65536 });
  const desktop = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''));
  const signature = await bundleSignature(desktop.resourcesDirectory);
  if (!cache || cache.path !== desktop.resourcesDirectory || cache.signature !== signature) {
    cache = { path: desktop.resourcesDirectory, signature, candidate: await inspectVersion(desktop) };
  }
  return cache.candidate;
}
async function launchServer(version) {
  const specPath = join(root, 'workers', `${randomUUID()}.json`);
  await mkdir(dirname(specPath), { recursive: true });
  await writeFile(specPath, JSON.stringify({ executable: version.executable, workingDirectory: config.RepositoryPath,
    arguments: ['-c', 'features.code_mode_host=true', 'app-server', '--listen', privateUrl, '--enable', 'realtime_conversation'] }));
  const handle = await launch(powershell, psArgs('run-owned-process.ps1', ['-SpecPath', specPath]), {
    ...cleanEnv, PATH: `${version.directory};${cleanEnv.PATH ?? cleanEnv.Path ?? ''}`,
  });
  const stop = handle.stop;
  handle.stop = async () => { await stop(); await unlink(specPath).catch(() => {}); };
  return handle;
}
async function log(event, value) {
  const path = join(root, 'service.log');
  try { if ((await stat(path)).size > 1024 * 1024) await rename(path, path + '.previous'); } catch { }
  await appendFile(path, JSON.stringify({ time: new Date().toISOString(), event, ...value }) + '\n');
}
async function saveStatus() {
  const value = { ...runtime.status(), serviceProcessPid: process.pid, executable: runtime.current?.executable ?? null,
    ...sides?.status(), autoUpdate: true };
  const temp = join(root, 'status.tmp'); await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, join(root, 'status.json'));
  return value;
}
async function shutdown(exitCode = 0) {
  if (stopping) return; stopping = true;
  try { await runtime?.stop(); } catch { }
  await sides?.stop();
  if (runtime) await saveStatus().catch(() => {});
  process.exit(exitCode);
}
const endpoint = new SharedEndpoint({ port: config.ServerPort, upstreamUrl: privateUrl,
  handleHttp: (req, res) => handler ? handler(req, res) : false });
runtime = new ServiceRuntime({ endpoint, upstreamUrl: privateUrl, resolveVersion,
  prepareVersion: (candidate) => snapshotVersion(candidate, join(root, 'versions')), launchServer,
  onEvent: (event, value) => {
    log(event, value).catch(() => {});
    if (event === 'updated') retainVersions(join(root, 'versions'), [runtime.current?.fingerprint, runtime.previous?.fingerprint]).catch(() => log('versions-cleanup-deferred', {}).catch(() => {}));
  } });
handler = createControlHandler({ token, runtime: { status: () => ({ ...runtime.status(), ...sides?.status() }),
  restart: (options) => runtime.restart(options), prepareStop: (options) => runtime.prepareStop(options) }, requestStop: () => shutdown(0) });
process.on('SIGTERM', () => shutdown(0)); process.on('SIGINT', () => shutdown(0));
try {
  await runtime.start();
  sides = new SidecarSupervisor({ onEvent: (event) => log(event, {}).catch(() => {}), launchGateway: async () => {
  const gateway = await launch(process.execPath, [join(config.RepositoryPath, 'npm-dist', 'server', 'index.js')], {
    ...cleanEnv, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(config.GatewayPort), CODEX_MOBILE_TOKEN: gatewayToken,
    CODEX_APP_SERVER_MODE: 'external', CODEX_APP_SERVER_URL: publicUrl, CODEX_MOBILE_HOST_NAME: 'Windows Codex', CODEX_MOBILE_SERVE_STATIC: 'true',
    CODEX_MOBILE_RUNTIME_FILE: config.RuntimeFile ?? join(root, 'gateway-runtime.json'),
  });
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline && gateway.alive()) {
    try { const r = await fetch(`http://127.0.0.1:${config.GatewayPort}/api/host`, { headers: { cookie: `codex_mobile_token=${encodeURIComponent(gatewayToken)}` }, signal: AbortSignal.timeout(2000) }); if (r.ok) { ready = true; break; } } catch { }
    await sleep(150);
  }
  if (!ready) { await gateway.stop(); throw new Error('网关未就绪'); }
  return gateway;
  }, launchTunnel: () => launch(ssh, ['-N', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=10',
    '-i', config.IdentityFile, '-R', `127.0.0.1:${config.RemotePort}:127.0.0.1:${config.GatewayPort}`, config.SshTarget]) });
  await sides.tick();
  let nextVersionCheck = Date.now() + 60_000, waitingIdle = false;
  while (!stopping) {
    if (!runtime.operation && !runtime.server?.alive()) throw new Error('app-server 已退出');
    await sides.tick();
    const refresh = Date.now() >= nextVersionCheck;
    if (refresh || waitingIdle) {
      await runtime.checkUpdate({ refresh });
      waitingIdle = ['waiting-idle', 'rollback', 'update-deferred'].includes(runtime.updateState);
      if (refresh) nextVersionCheck = Date.now() + 60_000;
    }
    await saveStatus().catch(() => log('status-write-deferred', {}).catch(() => {})); await sleep(waitingIdle ? 1000 : 2000);
  }
} catch {
  await log('service-failed', { updateState: runtime.updateState }).catch(() => {});
  await shutdown(1);
}
