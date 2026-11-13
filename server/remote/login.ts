import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { isAbsolute, normalize } from 'node:path';
import { ManagedAuthLoader, type ManagedAuthIdentity } from './managed-auth.js';
import { RemoteRpcSession } from './rpc-session.js';
import type { RemoteControllerCanonical } from './controller.js';
import type { ManagedAuth } from './auth-protocol.js';

export type RemoteLoginFailure =
  | 'configuration'
  | 'response-invalid'
  | 'browser'
  | 'denied'
  | 'network'
  | 'auth-required'
  | 'timeout'
  | 'cancelled'
  | 'closed'
  | 'busy';
const MESSAGES: Record<RemoteLoginFailure, string> = {
  configuration: '普通登录配置无效',
  'response-invalid': '普通登录响应无效',
  browser: '无法打开普通登录浏览器',
  denied: '普通登录未完成',
  network: '普通登录连接不可用',
  'auth-required': '普通 ChatGPT 账号尚未确认',
  timeout: '普通登录已超时',
  cancelled: '普通登录已取消',
  closed: '普通登录已关闭',
  busy: '普通登录正在进行',
};
export class RemoteLoginError extends Error {
  constructor(readonly code: RemoteLoginFailure) {
    super(MESSAGES[code]);
    this.name = 'RemoteLoginError';
  }
}
export interface RemoteLoginManagedAuth {
  load(): Promise<ManagedAuth>;
  verifyIdentity(): Promise<Readonly<ManagedAuthIdentity>>;
  close?(): unknown;
}
export interface RemoteCanonicalLoginOptions {
  canonicalUrl?: string;
  canonicalFactory?: () => Promise<RemoteControllerCanonical>;
  timeoutMs?: number;
  operationTimeoutMs?: number;
  browserTimeoutMs?: number;
  /** 仅供可信本机组合和隔离测试；不接受来自 IPC 的工厂。 */
  createManagedAuth?: () => RemoteLoginManagedAuth;
  openBrowser?: (url: string, signal: AbortSignal) => Promise<void>;
}
interface Flow {
  abort: AbortController;
  deadline: number;
  session?: RemoteControllerCanonical;
  loader?: RemoteLoginManagedAuth;
  loginId?: string;
  removers: (() => void)[];
  timer?: NodeJS.Timeout;
  active: boolean;
  completed: Map<string, boolean>;
  wake?: () => void;
  canonicalRemovers: (() => void)[];
  cancelRequest?: Promise<void>;
}
function duration(value: number | undefined, fallback: number, max: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > max) throw new RemoteLoginError('configuration');
  return result;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteLoginError('response-invalid');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u0020\u007f]/.test(value))
    throw new RemoteLoginError('response-invalid');
  return value;
}
function identity(value: Readonly<ManagedAuthIdentity>): ManagedAuthIdentity {
  const home = value.codexHome;
  if (
    typeof home !== 'string' ||
    home.length > 4096 ||
    !isAbsolute(home) ||
    normalize(home) !== home ||
    /[\u0000-\u001f\u007f]/.test(home)
  )
    throw new RemoteLoginError('auth-required');
  return {
    codexHome: home,
    accountId: text(value.accountId),
    accountUserId: text(value.accountUserId),
    ...(value.userId === undefined ? {} : { userId: text(value.userId) }),
  };
}
function authUrl(value: unknown): string {
  const raw = text(value, 16384);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteLoginError('response-invalid');
  }
  if (
    url.protocol !== 'https:' ||
    !['auth.openai.com', 'chatgpt.com'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    throw new RemoteLoginError('response-invalid');
  return url.toString();
}
function openBrowser(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') {
      reject(new RemoteLoginError('browser'));
      return;
    }
    execFile('/usr/bin/open', [url], { signal, timeout: 10000, maxBuffer: 1024, windowsHide: true }, (error) =>
      error ? reject(new RemoteLoginError('browser')) : resolve(),
    );
  });
}
function dispose(value: { close?(): unknown } | undefined): Promise<void> {
  try {
    return Promise.resolve(value?.close?.()).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

/** 显式普通 ChatGPT 登录：canonical 独占刷新和 auth.json 写入，和 Remote step-up 完全分开。 */
export class RemoteCanonicalLogin {
  private readonly timeout: number;
  private readonly operationTimeout: number;
  private readonly browserTimeout: number;
  private readonly factory: () => Promise<RemoteControllerCanonical>;
  private closed = false;
  private flow?: Flow;
  private flight?: Promise<Readonly<ManagedAuthIdentity>>;
  constructor(private readonly options: RemoteCanonicalLoginOptions) {
    if (
      (options.canonicalUrl === undefined) === (options.canonicalFactory === undefined) ||
      options.canonicalUrl === ''
    )
      throw new RemoteLoginError('configuration');
    this.timeout = duration(options.timeoutMs, 600000, 600000);
    this.operationTimeout = duration(options.operationTimeoutMs, 20000, 60000);
    this.browserTimeout = duration(options.browserTimeoutMs, 10000, 60000);
    this.factory =
      options.canonicalFactory ??
      (() =>
        RemoteRpcSession.connectCanonical(options.canonicalUrl!, {
          connectTimeoutMs: this.operationTimeout,
          initializeTimeoutMs: this.operationTimeout,
          responseTimeoutMs: this.operationTimeout,
        }));
  }
  private cancel(flow: Flow, code: RemoteLoginFailure): void {
    if (!flow.abort.signal.aborted) flow.abort.abort(new RemoteLoginError(code));
  }
  private assert(flow: Flow, phaseDeadline = Infinity): void {
    if (performance.now() >= Math.min(flow.deadline, phaseDeadline)) this.cancel(flow, 'timeout');
    if (!flow.active || flow.abort.signal.aborted)
      throw flow.abort.signal.reason instanceof RemoteLoginError
        ? flow.abort.signal.reason
        : new RemoteLoginError('closed');
  }
  private async wait<T>(
    flow: Flow,
    operation: () => Promise<T>,
    code: RemoteLoginFailure,
    timeout = this.operationTimeout,
  ): Promise<T> {
    this.assert(flow);
    const phaseDeadline = performance.now() + timeout;
    let timer: NodeJS.Timeout | undefined;
    let abort: (() => void) | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          this.assert(flow, phaseDeadline);
          return operation();
        }),
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(flow.abort.signal.reason);
          flow.abort.signal.addEventListener('abort', abort, { once: true });
          timer = setTimeout(
            () => this.cancel(flow, 'timeout'),
            Math.min(timeout, Math.max(1, flow.deadline - performance.now())),
          );
          if (flow.abort.signal.aborted) abort();
        }),
      ]);
      this.assert(flow, phaseDeadline);
      return result;
    } catch {
      this.assert(flow, phaseDeadline);
      throw new RemoteLoginError(code);
    } finally {
      clearTimeout(timer);
      if (abort) flow.abort.signal.removeEventListener('abort', abort);
    }
  }
  private async settle(operation: () => Promise<unknown>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve()
          .then(operation)
          .catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.operationTimeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private cancelKnownLogin(flow: Flow): Promise<void> {
    if (!flow.session || !flow.loginId) return Promise.resolve();
    if (!flow.cancelRequest) {
      const session = flow.session;
      const loginId = flow.loginId;
      flow.cancelRequest = this.settle(() => session.call('account/login/cancel', { loginId }));
    }
    return flow.cancelRequest;
  }
  private async cleanup(flow: Flow, cancel: boolean): Promise<void> {
    for (const remove of flow.canonicalRemovers.splice(0)) {
      try {
        remove();
      } catch {
        /* 继续清理其余资源。 */
      }
    }
    // 保留取消通道直到最终返回；先收回 loader，避免它最后的 await 期间已关闭 canonical。
    const aborted = () => void this.cancelKnownLogin(flow);
    flow.abort.signal.addEventListener('abort', aborted);
    flow.removers.push(() => flow.abort.signal.removeEventListener('abort', aborted));
    if (cancel || flow.abort.signal.aborted) void this.cancelKnownLogin(flow);
    await this.settle(() => dispose(flow.loader));
    if (performance.now() >= flow.deadline) this.cancel(flow, 'timeout');
    await flow.cancelRequest;
    await this.settle(() => dispose(flow.session));
    if (performance.now() >= flow.deadline) this.cancel(flow, 'timeout');
    await flow.cancelRequest;
    flow.completed.clear();
    flow.wake = undefined;
  }
  private async run(flow: Flow): Promise<Readonly<ManagedAuthIdentity>> {
    let success = false;
    let abandoned = false;
    let verifiedIdentity: Readonly<ManagedAuthIdentity> | undefined;
    let failure: RemoteLoginError | undefined;
    const pending = Promise.resolve().then(() => {
      this.assert(flow);
      return this.factory();
    });
    void pending.then(
      (value) => {
        if (abandoned) dispose(value);
      },
      () => undefined,
    );
    try {
      flow.session = await this.wait(flow, () => pending, 'network');
      const metadata = object(await this.wait(flow, () => flow.session!.initialize(), 'network'));
      if (typeof metadata.codexHome !== 'string' || !isAbsolute(metadata.codexHome))
        throw new RemoteLoginError('response-invalid');
      if (!flow.session.on || !flow.session.off) throw new RemoteLoginError('configuration');
      const notification = (message: unknown) => {
        if (!flow.active || flow.abort.signal.aborted || !message || typeof message !== 'object') return;
        const raw = message as Record<string, unknown>;
        if (raw.method !== 'account/login/completed') return;
        try {
          const result = object(raw.params);
          const id = text(result.loginId);
          if (typeof result.success !== 'boolean') return;
          if (flow.completed.size >= 32 && !flow.completed.has(id)) {
            this.cancel(flow, 'response-invalid');
            return;
          }
          // 首个完成结果固定，不能被后续通知从失败改写为成功。
          if (!flow.completed.has(id)) flow.completed.set(id, result.success);
          flow.wake?.();
        } catch {
          /* 不采用空 ID、其他登录模式和畸形通知。 */
        }
      };
      const disconnected = () => this.cancel(flow, 'network');
      for (const [event, listener] of [
        ['notification', notification],
        ['close', disconnected],
        ['disconnect', disconnected],
      ] as const) {
        flow.session.on(event, listener);
        flow.canonicalRemovers.push(() => flow.session!.off!(event, listener));
      }
      const started = Promise.resolve().then(() => {
        this.assert(flow);
        return flow.session!.call('account/login/start', { type: 'chatgpt' });
      });
      // 响应先于/晚于取消都只对 canonical 返回的有界 ID 取消，不再打开浏览器。
      void started.then(
        (value) => {
          if (flow.active && !flow.abort.signal.aborted) return;
          try {
            const raw = object(value);
            if (raw.type !== 'chatgpt') return;
            const loginId = text(raw.loginId);
            void Promise.resolve()
              .then(() => flow.session!.call('account/login/cancel', { loginId }))
              .catch(() => undefined);
          } catch {
            /* 畸形迟到响应没有可取消的 ID。 */
          }
        },
        () => undefined,
      );
      const raw = object(await this.wait(flow, () => started, 'network'));
      if (raw.type !== 'chatgpt') throw new RemoteLoginError('response-invalid');
      flow.loginId = text(raw.loginId);
      const url = authUrl(raw.authUrl);
      await this.wait(
        flow,
        () => (this.options.openBrowser ?? openBrowser)(url, flow.abort.signal),
        'browser',
        this.browserTimeout,
      );
      await this.wait(
        flow,
        async () => {
          while (!flow.completed.has(flow.loginId!))
            await new Promise<void>((resolve) => {
              flow.wake = resolve;
            });
        },
        'network',
        this.timeout,
      );
      if (!flow.completed.get(flow.loginId)) throw new RemoteLoginError('denied');
      flow.loader =
        this.options.createManagedAuth?.() ??
        new ManagedAuthLoader({
          canonicalUrl: this.options.canonicalUrl,
          canonicalFactory: this.options.canonicalFactory,
          operationTimeoutMs: this.operationTimeout,
        });
      const auth = await this.wait(flow, () => flow.loader!.load(), 'auth-required');
      const verified = identity(await this.wait(flow, () => flow.loader!.verifyIdentity(), 'auth-required'));
      if (
        verified.codexHome !== metadata.codexHome ||
        auth.accountId !== verified.accountId ||
        auth.accountUserId !== verified.accountUserId ||
        auth.userId !== verified.userId
      )
        throw new RemoteLoginError('auth-required');
      this.assert(flow);
      success = true;
      verifiedIdentity = verified;
    } catch (error) {
      abandoned = !flow.session;
      failure =
        error instanceof RemoteLoginError && Object.hasOwn(MESSAGES, error.code)
          ? new RemoteLoginError(error.code)
          : new RemoteLoginError('network');
    }
    try {
      await this.cleanup(flow, !success);
      this.assert(flow);
      if (failure) throw failure;
      return verifiedIdentity!;
    } catch (error) {
      // 实际期限检查也可能在最后一个 await 后触发；已知 ID 仍尽力取消，不撤回普通账号登录。
      await this.cancelKnownLogin(flow);
      this.assert(flow);
      throw error;
    } finally {
      flow.active = false;
      clearTimeout(flow.timer);
      for (const remove of flow.removers.splice(0)) {
        try {
          remove();
        } catch {
          /* 其他清理继续。 */
        }
      }
    }
  }
  login(signal?: AbortSignal): Promise<Readonly<ManagedAuthIdentity>> {
    if (this.closed) return Promise.reject(new RemoteLoginError('closed'));
    if (this.flight) return Promise.reject(new RemoteLoginError('busy'));
    if (signal?.aborted) return Promise.reject(new RemoteLoginError('cancelled'));
    const flow: Flow = {
      abort: new AbortController(),
      deadline: performance.now() + this.timeout,
      removers: [],
      active: true,
      completed: new Map(),
      canonicalRemovers: [],
    };
    this.flow = flow;
    if (signal) {
      const abort = () => this.cancel(flow, 'cancelled');
      signal.addEventListener('abort', abort, { once: true });
      flow.removers.push(() => signal.removeEventListener('abort', abort));
    }
    flow.timer = setTimeout(() => this.cancel(flow, 'timeout'), this.timeout);
    const flight = this.run(flow).finally(() => {
      if (this.flow === flow) {
        this.flow = undefined;
        this.flight = undefined;
      }
    });
    this.flight = flight;
    return flight;
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.flow) this.cancel(this.flow, 'closed');
    await this.flight?.catch(() => undefined);
  }
}
