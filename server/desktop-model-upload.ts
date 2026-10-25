import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createModelUploadProxy } from './model-upload-proxy.js';
import { readModelUploadRoutes } from './model-upload-routing.js';
import { modelUploadConfigArgs } from './app-server-manager.js';
import { publishDesktopModelUsage, connectDesktopModelUsage } from './model-upload-ipc.js';

export interface DesktopModelUploadOptions {
  originalAdapter: string;
  codexExecutable: string;
  nodeExecutable: string;
  socketPath: string;
  upstreamUrl: string;
}

export function desktopMeterSocketPath(codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex')) {
  return join(codexHome, 'mobile-model-upload', 'meter.sock');
}

export function externalDesktopModelUsage(upstreamUrl: string, codexHome?: string) {
  const url = new URL(upstreamUrl);
  if (!['ws:', 'wss:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return;
  return connectDesktopModelUsage({ socketPath: desktopMeterSocketPath(codexHome), upstreamUrl });
}

/** 与既有桌面适配器相同的 canonical 调用边界；其余调用完全透传。 */
export function desktopAppServer(args: string[], environment: Record<string, string | undefined>) {
  const parsed = desktopArguments(args);
  return parsed.command === 'app-server' && !parsed.subcommand && !parsed.transport && !parsed.help && !!environment.CODEX_APP_TOOLS_PIPE_PATH;
}

function desktopArguments(args: string[]) {
  const flags: string[] = [];
  let command: string | undefined;
  let subcommand: string | undefined;
  let transport = false; let help = false;
  const configFlags = ['-c', '--config', '-p', '--profile', '--enable', '--disable'];
  const valueFlags = [...configFlags, '--remote', '--remote-auth-token-env', '-i', '--image', '-m', '--model', '--local-provider',
    '-C', '--cd', '--add-dir', '-a', '--ask-for-approval', '--startup-client-info', '--cloud-skills-snapshot', '--code-mode-host',
    '--listen', '--ws-auth', '--ws-token-file', '--ws-token-sha256', '--ws-shared-secret-file', '--ws-issuer', '--ws-audience', '--ws-max-clock-skew-seconds'];
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (valueFlags.includes(value)) {
      if (args[index + 1] === undefined) throw new Error('桌面配置参数缺少值');
      if (configFlags.includes(value)) flags.push(value, args[index + 1]);
      if (value === '--listen') transport = true;
      index++;
    } else if (/^--(?:config|profile|enable|disable)=/.test(value) || /^-[cp].+/.test(value)) flags.push(value);
    else if (value === '--stdio' || value.startsWith('--listen=')) transport = true;
    else if (['--help', '-h', '--version', '-V'].includes(value)) help = true;
    else if (value === '--') { subcommand = args[index + 1]; break; }
    else if (!value.startsWith('-')) { if (!command) command = value; else subcommand ??= value; }
  }
  return { flags, command, subcommand, transport, help };
}

export function desktopConfigFlags(args: string[]) {
  return desktopArguments(args).flags;
}

/** 在原桌面适配器外测量模型出口，不接管 canonical 服务或其 stdio 协议。 */
export async function startDesktopModelUpload(options: DesktopModelUploadOptions, args: string[],
  environment: Record<string, string | undefined> = process.env) {
  let proxy: Awaited<ReturnType<typeof createModelUploadProxy>> | undefined;
  let publisher: Awaited<ReturnType<typeof publishDesktopModelUsage>> | undefined;
  const childEnvironment = { ...environment };
  const childArgs = [...args];
  try {
    if (desktopAppServer(args, environment)) {
      const routes = await readModelUploadRoutes(childEnvironment, { executable: options.codexExecutable, args: desktopConfigFlags(args) });
      proxy = await createModelUploadProxy(routes);
      publisher = await publishDesktopModelUsage({ socketPath: options.socketPath, upstreamUrl: options.upstreamUrl, meter: proxy.meter });
      childArgs.push(...modelUploadConfigArgs(proxy.overrides));
      delete childEnvironment.OPENAI_BASE_URL;
    }
    const child = spawn(options.nodeExecutable, [options.originalAdapter, ...childArgs], { env: childEnvironment, stdio: 'inherit' });
    const dispose = async () => { await publisher?.close(); await proxy?.close(); };
    const exited = new Promise<number>((resolve, reject) => {
      child.once('error', () => { void dispose().then(() => reject(new Error('无法启动原桌面适配器'))); });
      child.once('exit', code => { void dispose().then(() => resolve(code ?? 1), reject); });
    });
    let closing: Promise<void> | undefined;
    return { child, exited, close() {
      return closing ??= (async () => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          const kill = setTimeout(() => child.kill('SIGKILL'), 3_000);
          try { await exited; } finally { clearTimeout(kill); }
        } else await exited;
      })();
    } };
  } catch (error) {
    await publisher?.close(); await proxy?.close();
    throw error;
  }
}

export async function runDesktopModelUpload(options: DesktopModelUploadOptions) {
  const run = await startDesktopModelUpload(options, process.argv.slice(2));
  const stop = () => { void run.close().catch(() => {}); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try { return await run.exited; }
  finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
}
