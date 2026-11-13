// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { RemoteCanonicalLogin } from '../../server/remote/login.js';
const identity = {
  codexHome: '/synthetic/codex',
  accountId: 'workspace',
  accountUserId: 'account-user',
  userId: 'user',
};
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function fixture(change: Record<string, unknown> = {}) {
  const calls: { method: string; params: unknown }[] = [];
  const urls: string[] = [];
  let closed = 0;
  let confirmed = 0;
  let start: () => Promise<unknown> = async () => ({
    type: 'chatgpt',
    loginId: 'login-id',
    authUrl: 'https://auth.openai.com/oauth/authorize?secret=private',
  });
  const session = Object.assign(new EventEmitter(), {
    async initialize() {
      return { codexHome: identity.codexHome };
    },
    async call(method: string, params: unknown) {
      calls.push({ method, params });
      if (method === 'account/login/start') return start();
      return {};
    },
    close() {
      closed++;
    },
  });
  const login = new RemoteCanonicalLogin({
    canonicalFactory: async () => session,
    timeoutMs: 200,
    operationTimeoutMs: 40,
    browserTimeoutMs: 40,
    openBrowser: async (url: string) => {
      urls.push(url);
      queueMicrotask(() =>
        session.emit('notification', {
          method: 'account/login/completed',
          params: { loginId: 'login-id', success: true, error: null },
        }),
      );
    },
    createManagedAuth: () => ({
      async load() {
        confirmed++;
        return { accessToken: 'private-token', ...identity };
      },
      async verifyIdentity() {
        return identity;
      },
      close() {},
    }),
    ...change,
  });
  cleanup.push(() => login.close());
  return {
    login,
    session,
    calls,
    urls,
    closed: () => closed,
    confirmed: () => confirmed,
    setStart(value: typeof start) {
      start = value;
    },
  };
}
it('显式普通登录只发送ChatGPT请求并在匹配完成后用新loader确认', async () => {
  const f = fixture();
  expect(f.calls).toHaveLength(0);
  await expect(f.login.login()).resolves.toEqual(identity);
  expect(f.calls).toEqual([{ method: 'account/login/start', params: { type: 'chatgpt' } }]);
  expect(f.confirmed()).toBe(1);
  expect(f.closed()).toBe(1);
  expect(f.session.eventNames()).toHaveLength(0);
});
it('同步完成通知按loginId匹配，错误和无关完成不能使登录成功', async () => {
  const f = fixture();
  f.setStart(async () => {
    f.session.emit('notification', {
      method: 'account/login/completed',
      params: { loginId: 'other', success: true },
    });
    f.session.emit('notification', {
      method: 'account/login/completed',
      params: { loginId: 'login-id', success: true },
    });
    return {
      type: 'chatgpt',
      loginId: 'login-id',
      authUrl: 'https://chatgpt.com/auth/login?secret=private',
    };
  });
  await expect(f.login.login()).resolves.toEqual(identity);
});
it.each(['apiKey', 'chatgptAuthTokens', 'amazonBedrock', 'chatgptDeviceCode'])(
  '拒绝%s模式，不打开浏览器或读凭据',
  async (type) => {
    const f = fixture();
    f.setStart(async () => ({
      type,
      loginId: 'login-id',
      authUrl: 'https://auth.openai.com/oauth/authorize',
    }));
    await expect(f.login.login()).rejects.toMatchObject({
      code: 'response-invalid',
    });
    expect(f.urls).toHaveLength(0);
    expect(f.confirmed()).toBe(0);
  },
);
it.each([
  'http://auth.openai.com/a',
  'https://auth.openai.com.evil/a',
  'https://user:pass@auth.openai.com/a',
  'https://auth.openai.com:444/a',
  'file:///tmp/a',
])('拒绝非官方HTTPS地址%s', async (authUrl) => {
  const f = fixture();
  f.setStart(async () => ({ type: 'chatgpt', loginId: 'login-id', authUrl }));
  await expect(f.login.login()).rejects.toMatchObject({
    code: 'response-invalid',
  });
  expect(f.urls).toHaveLength(0);
});
it('取消有ID的登录发送cancel并移除监听，晚成功不读取凭据', async () => {
  const f = fixture({ openBrowser: async () => {} });
  const abort = new AbortController();
  const pending = f.login.login(abort.signal);
  while (!f.calls.length) await new Promise((resolve) => setTimeout(resolve, 1));
  await new Promise((resolve) => setTimeout(resolve, 2));
  abort.abort();
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  expect(f.calls).toContainEqual({
    method: 'account/login/cancel',
    params: { loginId: 'login-id' },
  });
  f.session.emit('notification', {
    method: 'account/login/completed',
    params: { loginId: 'login-id', success: true },
  });
  expect(f.confirmed()).toBe(0);
  expect(f.session.eventNames()).toHaveLength(0);
});
it('断线和任意外部错误只返回固定错误，无token/URL/cause', async () => {
  const f = fixture({
    openBrowser: async () => {
      f.session.emit('disconnect', new Error('private-token https://evil/secret'));
    },
  });
  const error = await f.login.login().catch((value) => value);
  expect(error.code).toBe('network');
  expect(error.message).not.toMatch(/private|https/);
  expect(error.cause).toBeUndefined();
  expect(f.confirmed()).toBe(0);
});
it('close终止挂起工厂，迟到会话只关闭而不initialize，关闭后永久拒绝', async () => {
  let finish!: (value: unknown) => void;
  let initialized = 0;
  let closed = 0;
  const f = fixture({
    canonicalFactory: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = f.login.login();
  await Promise.resolve();
  await f.login.close();
  await expect(pending).rejects.toMatchObject({ code: 'closed' });
  finish({
    async initialize() {
      initialized++;
      return {};
    },
    close() {
      closed++;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 1));
  expect(initialized).toBe(0);
  expect(closed).toBe(1);
  await expect(f.login.login()).rejects.toMatchObject({ code: 'closed' });
});
it('最后资源关闭await期间调用者取消仍失败，不因完成通知提前解除取消', async () => {
  const abort = new AbortController();
  let closing = false;
  const f = fixture({
    createManagedAuth: () => ({
      async load() {
        return { accessToken: 'private', ...identity };
      },
      async verifyIdentity() {
        return identity;
      },
      async close() {
        closing = true;
        await new Promise((resolve) => setTimeout(resolve, 5));
        abort.abort();
      },
    }),
  });
  await expect(f.login.login(abort.signal)).rejects.toMatchObject({
    code: 'cancelled',
  });
  expect(closing).toBe(true);
  expect(f.calls).toContainEqual({
    method: 'account/login/cancel',
    params: { loginId: 'login-id' },
  });
});
it.each(['cancelled', 'closed', 'timeout'] as const)(
  '最后loader清理期间%s仍在关闭canonical前尽力取消已知loginId',
  async (reason) => {
    const abort = new AbortController();
    const f = fixture({
      timeoutMs: reason === 'timeout' ? 60 : 200,
      operationTimeoutMs: 100,
      createManagedAuth: () => ({
        async load() {
          return { accessToken: 'private', ...identity };
        },
        async verifyIdentity() {
          return identity;
        },
        async close() {
          await Promise.resolve();
          if (reason === 'cancelled') abort.abort();
          if (reason === 'closed') void f.login.close();
          if (reason === 'timeout') await new Promise((resolve) => setTimeout(resolve, 80));
        },
      }),
    });
    const call = f.session.call.bind(f.session);
    f.session.call = async (method, params) => {
      if (method === 'account/login/cancel') expect(f.closed()).toBe(0);
      return call(method, params);
    };
    await expect(f.login.login(abort.signal)).rejects.toMatchObject({ code: reason });
    expect(f.calls).toContainEqual({
      method: 'account/login/cancel',
      params: { loginId: 'login-id' },
    });
    expect(f.closed()).toBe(1);
    expect(f.session.eventNames()).toHaveLength(0);
  },
);
it('最后清理取消请求失败时仍返回固定取消错误并关闭canonical', async () => {
  const abort = new AbortController();
  const f = fixture({
    createManagedAuth: () => ({
      async load() {
        return { accessToken: 'private', ...identity };
      },
      async verifyIdentity() {
        return identity;
      },
      async close() {
        await Promise.resolve();
        abort.abort();
      },
    }),
  });
  const call = f.session.call.bind(f.session);
  let cancelled = 0;
  f.session.call = async (method, params) => {
    if (method === 'account/login/cancel') {
      cancelled++;
      throw new Error('private-token cancel failure');
    }
    return call(method, params);
  };
  const error = await f.login.login(abort.signal).catch((value) => value);
  expect(error).toMatchObject({ code: 'cancelled', message: '普通登录已取消' });
  expect(error.cause).toBeUndefined();
  expect(cancelled).toBe(1);
  expect(f.closed()).toBe(1);
  expect(f.session.eventNames()).toHaveLength(0);
});
it('同步浏览器阻塞超过实际绝对阶段deadline，即使timer未触发仍拒绝晚成功', async () => {
  const f = fixture({
    browserTimeoutMs: 5,
    openBrowser: async () => {
      const end = performance.now() + 15;
      while (performance.now() < end) {}
      f.session.emit('notification', {
        method: 'account/login/completed',
        params: { loginId: 'login-id', success: true },
      });
    },
  });
  await expect(f.login.login()).rejects.toMatchObject({ code: 'timeout' });
  expect(f.confirmed()).toBe(0);
});
it('start已发出但ID迟到时仍取消该ID，不打开浏览器或确认auth', async () => {
  const f = fixture();
  let finish!: (value: unknown) => void;
  f.setStart(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const abort = new AbortController();
  const pending = f.login.login(abort.signal);
  const checked = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  while (!f.calls.length) await new Promise((resolve) => setTimeout(resolve, 1));
  abort.abort();
  await checked;
  finish({
    type: 'chatgpt',
    loginId: 'late-id',
    authUrl: 'https://auth.openai.com/oauth/authorize',
  });
  await new Promise((resolve) => setTimeout(resolve, 1));
  expect(f.calls).toContainEqual({
    method: 'account/login/cancel',
    params: { loginId: 'late-id' },
  });
  expect(f.urls).toHaveLength(0);
  expect(f.confirmed()).toBe(0);
});
