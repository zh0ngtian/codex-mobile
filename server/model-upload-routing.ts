import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ModelRoute } from './model-upload-proxy.js';

interface RoutingConfig {
  openai_base_url?: string | null;
  chatgpt_base_url?: string | null;
  model_providers?: Record<string, { base_url?: string; wire_api?: string }>;
}

export function modelUploadRoutes(config: RoutingConfig,
  environment: Record<string, string | undefined> = process.env): ModelRoute[] {
  const chatgpt = (config.chatgpt_base_url ?? 'https://chatgpt.com/backend-api/').replace(/\/$/, '') + '/codex';
  const explicitBase = config.openai_base_url || environment.OPENAI_BASE_URL;
  const defaults = { api: 'https://api.openai.com/v1', chatgpt };
  const routes: ModelRoute[] = [{ key: 'openai_base_url', baseUrl:
    explicitBase || defaults.api,
    ...(!explicitBase ? { defaultTargets: defaults } : {}) }];
  for (const [id, provider] of Object.entries(config.model_providers ?? {})) {
    if (provider.base_url && (!provider.wire_api || provider.wire_api === 'responses')) {
      routes.push({ key: `model_providers.${JSON.stringify(id)}.base_url`, baseUrl: provider.base_url });
    }
  }
  return routes;
}

/** 通过 Codex 自己解析用户配置及 profile；不复制 TOML 解析和优先级规则。 */
export async function readModelUploadRoutes(environment: Record<string, string | undefined>,
  options: { executable?: string; args?: string[] } = {}) {
  const child = spawn(options.executable ?? 'codex', [...(options.args ?? []), 'app-server', '--listen', 'stdio://'], {
    env: environment, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout });
  const waiters = new Map<number, { resolve(value: any): void; reject(reason: Error): void }>();
  let nextId = 0;
  let failure: Error | undefined;
  const fail = () => {
    failure = new Error('无法读取 Codex 模型路由配置，未启动计量转发');
    for (const waiter of waiters.values()) waiter.reject(failure);
    waiters.clear();
  };
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('exit', fail);
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiter = waiters.get(message.id);
    if (!waiter) return;
    waiters.delete(message.id);
    if (message.error) waiter.reject(new Error('Codex 拒绝读取模型路由配置'));
    else waiter.resolve(message.result);
  });
  const timeout = setTimeout(fail, 15_000);
  function request(method: string, params: unknown) {
    if (failure) return Promise.reject(failure);
    const id = ++nextId;
    return new Promise<any>((resolve, reject) => {
      waiters.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  try {
    await request('initialize', { clientInfo: { name: 'codex-mobile-model-meter', version: '1' } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const config = await request('config/read', { includeLayers: false });
    // account/read 在新版 CLI 中可能触发远程 workspace discovery；计量启动不额外查询账户。
    // 默认提供商由模型请求自己的 ChatGPT-Account-ID 和网关已有的认证模式事件选路。
    return modelUploadRoutes(config.config, environment);
  } finally {
    clearTimeout(timeout);
    lines.close();
    child.stdin.on('error', () => {});
    if (child.pid && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await exited; } finally { clearTimeout(kill); }
    }
  }
}
