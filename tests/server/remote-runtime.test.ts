// @vitest-environment node
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { RemoteRuntime, type RemoteRuntimeOptions } from '../../server/remote/runtime.js';
import { RemoteAuthProviderImpl } from '../../server/remote/auth.js';
import { RemoteIdentityRegistry } from '../../server/remote/identity-registry.js';
import { ManagedAuthLoader } from '../../server/remote/managed-auth.js';
import { PrivateStore } from '../../server/remote/private-store.js';
import type { DeviceIdentity } from '../../server/remote/device-key.js';
const NOW = 1794530000000;
const NS = 'https://api.openai.com/auth';
const local = { environmentId: 'local-env', installationId: 'local-install' };
const remote = {
  environmentId: 'remote-env',
  installationId: 'remote-install',
};
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  vi.restoreAllMocks();
});
async function until(check: () => boolean, timeout = 3000) {
  const begin = Date.now();
  while (!check()) {
    if (Date.now() - begin > timeout) throw new Error('等待条件超时');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
const jwt = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`;
const target = (value: typeof local) => ({
  env_id: value.environmentId,
  installation_id: value.installationId,
  kind: 'single',
  online: true,
  busy: false,
});
async function fixture(change: Partial<RemoteRuntimeOptions> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'remote-runtime-')));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const store = new PrivateStore(join(root, 'private'));
  const registry = new RemoteIdentityRegistry(store);
  let managed = {
    codexHome: '/synthetic/codex',
    accountId: 'workspace',
    accountUserId: 'account-user',
    userId: 'user',
  };
  let localTuple = { ...local };
  let grants = [target(local), target(remote)];
  let client = 0;
  let keysCreated = 0;
  let oauth = 0;
  let activeKey = true;
  let network = false;
  let pairCalls = 0;
  const log: string[] = [];
  const connections: WebSocket[] = [];
  const controllers: any[] = [];
  const canonicals: EventEmitter[] = [];
  const keyMap = new Map<
    string,
    {
      identity: DeviceIdentity;
      privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
    }
  >();
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  wss.on('connection', (socket) => {
    connections.push(socket);
    log.push('relay');
    socket.send(JSON.stringify({ type: 'device_key_challenge' }));
    socket.on('error', () => {});
    socket.on('close', () => log.push('relay-close'));
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of wss.clients) socket.terminate();
        wss.close(() => resolve());
      }),
  );
  const canonicalFactory = async () => {
    const value = Object.assign(new EventEmitter(), {
      async initialize() {
        return { codexHome: managed.codexHome };
      },
      async call(method: string) {
        if (network) throw new Error('private-token network');
        if (method === 'account/read') return { account: { type: 'chatgpt' } };
        if (method === 'remoteControl/status/read') return { status: 'connected', ...localTuple };
        if (method === 'remoteControl/pairing/start') {
          pairCalls++;
          return {
            pairingCode: 'private-pair-code',
            manualPairingCode: null,
            environmentId: localTuple.environmentId,
            expiresAt: NOW / 1000 + 60,
          };
        }
        throw new Error('unexpected RPC');
      },
      close() {
        value.removeAllListeners();
      },
    });
    canonicals.push(value);
    return value;
  };
  const token = () =>
    jwt({
      exp: NOW / 1000 + 3600,
      [NS]: {
        chatgpt_account_id: managed.accountId,
        chatgpt_account_user_id: managed.accountUserId,
        user_id: managed.userId,
      },
    });
  let authorize = async () => {
    oauth++;
    log.push('oauth');
    expect(connections.filter((socket) => socket.readyState === 1)).toHaveLength(0);
    return jwt({
      exp: NOW / 1000 + 300,
      iat: NOW / 1000,
      pwd_auth_time: NOW,
      scope: 'codex.remote_control.enroll',
      [NS]: {
        chatgpt_account_id: managed.accountId,
        chatgpt_account_user_id: managed.accountUserId,
        user_id: managed.userId,
      },
    });
  };
  let fetcher = async (url: string, init?: RequestInit) => {
    if (network) throw new Error('private-token network');
    if (url.endsWith('/client/pair')) {
      grants = grants.some(
        (value) => value.env_id === localTuple.environmentId && value.installation_id === localTuple.installationId,
      )
        ? grants
        : [...grants, target(localTuple)];
      return new Response(
        JSON.stringify({
          client_id: JSON.parse(init!.body as string).client_id,
          pairing_code: JSON.parse(init!.body as string).pairing_code,
          server_id: 'server',
          environment_id: localTuple.environmentId,
          claimed_at: '2026-11-13T00:00:00Z',
        }),
      );
    }
    if (url.includes('/enroll/start')) {
      client++;
      log.push('enroll');
      return new Response(
        JSON.stringify({
          client_id: `client-${client}`,
          account_user_id: managed.userId,
          device_key_challenge: {
            client_id: `client-${client}`,
            account_user_id: managed.userId,
            purpose: 'remote_control_client_enrollment',
            audience: 'remote_control_client_enrollment',
            target_origin: 'https://chatgpt.com',
            target_path: '/backend-api/codex/remote/control/client/enroll/finish',
            challenge_expires_at: NOW / 1000 + 120,
            challenge_id: 'challenge',
            nonce: 'nonce',
            challenge_token: 'private-challenge',
          },
        }),
      );
    }
    if (url.includes('/enroll/finish'))
      return new Response(
        JSON.stringify({
          client_id: `client-${client}`,
          account_user_id: managed.userId,
          scopes: ['remote_control_controller_websocket'],
          expires_at: new Date(NOW + 3600000).toISOString(),
          remote_control_token: 'private-remote-token',
        }),
      );
    return new Response(JSON.stringify({ items: grants, cursor: null }));
  };
  const options: RemoteRuntimeOptions = {
    registry,
    store,
    canonicalFactory,
    now: () => NOW,
    operationTimeoutMs: 1500,
    interactionTimeoutMs: 10000,
    cleanupTimeoutMs: 100,
    controllerOptions: {
      monitorIntervalMs: 10000,
      relayOptions: { nativePingMs: 10000, streamPingMs: 10000 },
    },
    fetch: (async (input, init) => fetcher(String(input), init)) as typeof fetch,
    createManagedAuth: (config) =>
      new ManagedAuthLoader({
        ...config,
        readAuthFile: async () => ({
          auth_mode: 'chatgpt',
          tokens: { account_id: managed.accountId, access_token: token() },
        }),
      }),
    createDeviceKey: (ownStore) => ({
      async create() {
        keysCreated++;
        const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const identity: DeviceIdentity = {
          keyId: `key-${keysCreated}`,
          algorithm: 'ecdsa_p256_sha256',
          protectionClass: 'hardware_secure_enclave',
          publicKeySpkiDerBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        };
        keyMap.set(identity.keyId, { identity, privateKey: pair.privateKey });
        await ownStore.createJson('device-key.json', {
          keyId: identity.keyId,
          sealedKeyBase64: 'c3ludGhldGlj',
        });
        return identity;
      },
      async getIdentity() {
        if (!activeKey) throw new Error('private-hardware');
        const record = (await ownStore.readJson('device-key.json')) as {
          keyId: string;
        };
        return keyMap.get(record.keyId)!.identity;
      },
      async sign(bytes) {
        const record = (await ownStore.readJson('device-key.json')) as {
          keyId: string;
        };
        return sign('sha256', bytes, keyMap.get(record.keyId)!.privateKey).toString('base64');
      },
    }),
    createAuthProvider: (config) => {
      const provider = new RemoteAuthProviderImpl(config);
      provider.prepareConnection = async () => {
        const enrollment = await provider.verifyBinding();
        return {
          url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`,
          headers: {},
          async signChallenge() {
            return { clientId: enrollment.clientId };
          },
        };
      };
      return provider;
    },
    createOAuth: () => ({ authorize: () => authorize(), close() {} }),
    createController: undefined,
    ...change,
  };
  const runtime = new RemoteRuntime(options);
  cleanup.push(() => runtime.close());
  return {
    runtime,
    options,
    registry,
    store,
    root,
    log,
    controllers,
    connections,
    canonicals,
    keys: () => keysCreated,
    oauth: () => oauth,
    pairs: () => pairCalls,
    client: () => client,
    setManaged(value: Partial<typeof managed>) {
      managed = { ...managed, ...value };
    },
    setLocal(value: typeof local) {
      localTuple = { ...value };
    },
    setTargets(value: typeof grants) {
      grants = value;
    },
    setNetwork(value: boolean) {
      network = value;
    },
    setKey(value: boolean) {
      activeKey = value;
    },
    setOAuth(value: typeof authorize) {
      authorize = value;
    },
    setFetch(value: typeof fetcher) {
      fetcher = value;
    },
  };
}
it('未授权构造/start/status幂等，无key/OAuth/登记/canonical或Relay且必须明确canonical', async () => {
  expect(() => new RemoteRuntime({})).toThrow('Remote 运行配置无效');
  const f = await fixture();
  expect(f.runtime.status().state).toBe('unconfigured');
  await Promise.all(Array.from({ length: 8 }, () => f.runtime.start()));
  expect(f.runtime.status().state).toBe('unconfigured');
  expect(f.keys()).toBe(0);
  expect(f.oauth()).toBe(0);
  expect(f.connections).toHaveLength(0);
  expect(f.canonicals).toHaveLength(0);
});
it('首次授权真实provider登记、canonical与REST本机配对后才提交并唯一Relay，状态不含凭据', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  const active = await f.registry.readActive();
  expect(active).not.toBeNull();
  expect(f.keys()).toBe(1);
  expect(f.oauth()).toBe(1);
  expect(f.pairs()).toBe(1);
  expect(f.connections).toHaveLength(1);
  expect(f.log.indexOf('relay')).toBeGreaterThan(f.log.indexOf('enroll'));
  expect(JSON.stringify(f.runtime.status())).not.toMatch(/private|accessToken|sealedKey|step_up/);
  await expect(f.runtime.authorize()).rejects.toMatchObject({
    code: 'already-configured',
  });
});
it('恢复关闭旧Relay后才准备独立新身份，pair不解除pending且跨新实例保持逐tuple暂停', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  await f.runtime.acceptTarget(remote);
  const previous = await f.registry.readActive();
  await f.runtime.recover();
  await until(() => f.connections.length === 2);
  expect(f.keys()).toBe(2);
  expect(f.log.lastIndexOf('oauth')).toBeGreaterThan(f.log.indexOf('relay-close'));
  expect(f.runtime.status().pendingResume).toEqual([local, remote]);
  expect((await f.registry.readActive())!.snapshot.generation).not.toBe(previous!.snapshot.generation);
  expect(await previous!.store.readJson('enrollment.json')).toBeTruthy();
  await f.runtime.pairLocal();
  expect(f.runtime.status().pendingResume).toEqual([local, remote]);
  expect(() => f.runtime.createRawStream(local)).toThrow('需要在 Mac 显式恢复');
  await f.runtime.close();
  const runtime = new RemoteRuntime(f.options);
  cleanup.push(() => runtime.close());
  await runtime.start();
  expect(runtime.status().pendingResume).toEqual([local, remote]);
  await runtime.resume(local);
  expect(runtime.status().pendingResume).toEqual([remote]);
  await expect(runtime.resume(remote)).rejects.toMatchObject({
    code: 'target-unaccepted',
  });
  await runtime.acceptTarget(remote);
  expect(runtime.status().pendingResume).toEqual([remote]);
  await runtime.resume(remote);
  expect(runtime.status().pendingResume).toEqual([]);
});
it.each([
  { accountId: 'changed' },
  { accountUserId: 'changed' },
  { userId: 'changed' },
  { codexHome: '/synthetic/other' },
])('恢复不能改变完整managed %j，不提交或打开新Relay', async (change) => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  const previous = await f.registry.readActive();
  f.setManaged(change);
  await expect(f.runtime.recover()).rejects.toMatchObject({
    code: 'identity-changed',
  });
  expect((await f.registry.readActive())!.snapshot).toEqual(previous!.snapshot);
  expect(f.connections).toHaveLength(1);
  expect(f.runtime.status().pendingResume).toEqual([local]);
});
it('普通恢复拒绝本机重装，显式本机重新关联只复制原自有key/enrollment并保留旧tuple暂停', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  const previous = await f.registry.readActive();
  const next = {
    environmentId: 'replacement-env',
    installationId: 'replacement-install',
  };
  f.setLocal(next);
  f.setTargets([target(next)]);
  await expect(f.runtime.recover()).rejects.toMatchObject({
    code: 'unavailable',
  });
  expect(f.pairs()).toBe(1);
  const keyCount = f.keys();
  const oauthCount = f.oauth();
  await f.runtime.reassociate(local, next);
  expect(f.keys()).toBe(keyCount);
  expect(f.oauth()).toBe(oauthCount);
  const active = await f.registry.readActive();
  expect(active!.snapshot.local).toEqual(next);
  expect(active!.snapshot.enrollment).toEqual(previous!.snapshot.enrollment);
  expect(f.runtime.status().pendingResume).toContainEqual(local);
  expect(f.runtime.status().pendingResume).not.toContainEqual(next);
});
it('非本机双ID显式重新关联只改未来accepted，不移除旧tuple暂停', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  await f.runtime.acceptTarget(remote);
  const stream = f.runtime.createRawStream(remote);
  const next = { environmentId: 'new-env', installationId: 'new-install' };
  f.setTargets([target(local), target(next)]);
  await f.runtime.reassociate(remote, next);
  expect(stream.closed).toBe(true);
  expect(f.runtime.status().pendingResume).toContainEqual(remote);
  const active = await f.registry.readActive();
  const binding = (await active!.store.readJson('controller-binding.json')) as {
    targets: unknown[];
  };
  expect(binding.targets).toContainEqual(next);
  expect(binding.targets).not.toContainEqual(remote);
});
it('并发不同命令互斥，取消/close截断挂起stepup，迟到token不登记不启动Relay', async () => {
  const f = await fixture();
  let finish!: (value: string) => void;
  let entered = false;
  f.setOAuth(async () => {
    entered = true;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const abort = new AbortController();
  const pending = f.runtime.authorize(abort.signal);
  const checked = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await until(() => entered);
  await expect(f.runtime.login()).rejects.toMatchObject({ code: 'busy' });
  abort.abort();
  await checked;
  finish('private-late-token');
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(f.client()).toBe(0);
  expect(f.connections).toHaveLength(0);
  expect(await f.registry.readActive()).toBeNull();
  await f.runtime.close();
  await expect(f.runtime.authorize()).rejects.toMatchObject({ code: 'closed' });
});
it('提交后fsync报错按真实指针保留已提交暂停身份，不伪回滚/重试或打开Relay', async () => {
  const f = await fixture();
  const activate = f.registry.activate.bind(f.registry);
  vi.spyOn(f.registry, 'activate').mockImplementation(async (...args) => {
    await activate(...args);
    throw new Error('private-fsync');
  });
  await expect(f.runtime.authorize()).rejects.toMatchObject({
    code: 'commit-pending',
  });
  const active = await f.registry.readActive();
  expect(active).not.toBeNull();
  expect(f.runtime.status().generation).toBe(active!.snapshot.generation);
  expect(f.connections).toHaveLength(0);
  const runtime = new RemoteRuntime(f.options);
  cleanup.push(() => runtime.close());
  await runtime.start();
  expect(runtime.status().state).toBe('paused');
  expect(f.connections).toHaveLength(0);
  expect(f.oauth()).toBe(1);
});
it('原子提交挂起时取消报告待核对且晚提交不晚启动，后续显式start只恢复持久暂停', async () => {
  const f = await fixture();
  const activate = f.registry.activate.bind(f.registry);
  let finish!: () => void;
  let entered = false;
  vi.spyOn(f.registry, 'activate').mockImplementation(async (...args) => {
    entered = true;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return activate(...args);
  });
  const abort = new AbortController();
  const pending = f.runtime.authorize(abort.signal);
  const checked = expect(pending).rejects.toMatchObject({
    code: 'commit-pending',
  });
  await until(() => entered);
  abort.abort();
  await checked;
  await expect(f.runtime.authorize()).rejects.toMatchObject({
    code: 'commit-pending',
  });
  finish();
  await until(() => !(f.runtime as any).committing);
  await f.runtime.start();
  expect(f.runtime.status().state).toBe('paused');
  expect(f.connections).toHaveLength(0);
});
it('临时离线和硬件失效不丢失pending，失败重试不自动OAuth', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  await f.runtime.recover();
  f.setNetwork(true);
  await expect(f.runtime.resume(local)).rejects.toBeTruthy();
  expect(f.runtime.status().pendingResume).toContainEqual(local);
  f.setNetwork(false);
  f.setKey(false);
  await expect(f.runtime.resume(local)).rejects.toMatchObject({
    code: 'identity-changed',
  });
  expect(f.oauth()).toBe(2);
});
it('普通login先持久暂停并关闭Relay，不自动重新登记，账号变化不能恢复原scope', async () => {
  const f = await fixture({
    createLogin: () => ({
      async login() {
        f.setManaged({ accountId: 'other' });
        await until(() => f.connections[0]!.readyState === 3);
        return {
          codexHome: '/synthetic/codex',
          accountId: 'other',
          accountUserId: 'account-user',
          userId: 'user',
        };
      },
      async close() {},
    }),
  });
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  await f.runtime.login();
  expect(f.runtime.status().state).toBe('paused');
  expect(f.runtime.status().pendingResume).toEqual([local]);
  expect(f.oauth()).toBe(1);
  await expect(f.runtime.resume(local)).rejects.toMatchObject({
    code: 'identity-changed',
  });
});
it('queryStatus只读核对晚提交真实pointer，取消不能使已提交身份永远停在旧generation', async () => {
  const f = await fixture();
  const activate = f.registry.activate.bind(f.registry);
  let finish!: () => void;
  let entered = false;
  vi.spyOn(f.registry, 'activate').mockImplementation(async (...args) => {
    entered = true;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return activate(...args);
  });
  const abort = new AbortController();
  const pending = f.runtime.authorize(abort.signal);
  const checked = expect(pending).rejects.toMatchObject({
    code: 'commit-pending',
  });
  await until(() => entered);
  abort.abort();
  await checked;
  expect((await f.runtime.queryStatus()).reason).toBe('commit-pending');
  finish();
  await until(() => !(f.runtime as any).committing);
  const queried = await f.runtime.queryStatus();
  expect(queried.generation).toBe((await f.registry.readActive())!.snapshot.generation);
  expect(queried.state).toBe('paused');
  expect(f.connections).toHaveLength(0);
});
it('真实controller持久pause跨runtime重启后，一次显式resume完整复验且只清指定tuple', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  await f.runtime.acceptTarget(remote);
  f.setKey(false);
  const controller = (f.runtime as any).bundle.controller;
  await expect(controller.pairLocal()).rejects.toBeTruthy();
  await until(() => f.runtime.status().state === 'paused');
  await f.runtime.close();
  f.setKey(true);
  const runtime = new RemoteRuntime(f.options);
  cleanup.push(() => runtime.close());
  await runtime.start();
  expect(runtime.status().state).toBe('paused');
  await runtime.resume(local);
  expect(runtime.status().pendingResume).toEqual([remote]);
});
it('authorize返回实际运行状态，管理session挂起被取消后迟到资源关闭', async () => {
  const f = await fixture();
  const authorized = await f.runtime.authorize();
  expect(authorized.state).not.toBe('preparing');
  await until(() => f.runtime.status().state === 'online');
  const controller = (f.runtime as any).bundle.controller;
  let finish!: (value: unknown) => void;
  let entered = false;
  let closed = 0;
  controller.createManagementSession = () => {
    entered = true;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const abort = new AbortController();
  const pending = f.runtime.createManagementSession(local, abort.signal);
  const checked = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await until(() => entered);
  abort.abort();
  await checked;
  finish({
    close() {
      closed++;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 1));
  expect(closed).toBe(1);
});
it('旧controller storage关闭挂起时不准备新身份，迟到关闭前其他命令也不能越过', async () => {
  const f = await fixture({ cleanupTimeoutMs: 15 });
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  const controller = (f.runtime as any).bundle.controller;
  const close = controller.close.bind(controller);
  let finish!: () => void;
  controller.close = async () => {
    await close();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  await expect(f.runtime.recover()).rejects.toMatchObject({ code: 'timeout' });
  expect(f.keys()).toBe(1);
  const pending = f.runtime.recover();
  const checked = expect(pending).rejects.toMatchObject({ code: 'timeout' });
  await checked;
  expect(f.keys()).toBe(1);
  finish();
});
it('运行层主动发现hardware失效后立即关闭旧Relay并持久暂停，修复后重启也不自动恢复', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  f.setKey(false);
  await expect(f.runtime.acceptTarget(remote)).rejects.toMatchObject({ code: 'identity-changed' });
  await until(() => f.connections[0]!.readyState === 3);
  await f.runtime.close();
  f.setKey(true);
  const runtime = new RemoteRuntime(f.options);
  cleanup.push(() => runtime.close());
  await runtime.start();
  expect(runtime.status().state).toBe('paused');
  expect(runtime.status().pendingResume).toContainEqual(local);
});
it('提交后解除全局暂停写入迟到时取消会恢复持久暂停，重启不能自动打开Relay', async () => {
  const { RemoteRuntimeStateStore } = await import('../../server/remote/runtime-state.js');
  const f = await fixture();
  const write = RemoteRuntimeStateStore.prototype.write;
  let held = false;
  let entered = false;
  let finish!: () => void;
  vi.spyOn(RemoteRuntimeStateStore.prototype, 'write').mockImplementation(async function (
    this: InstanceType<typeof RemoteRuntimeStateStore>,
    value,
  ) {
    if (!held && !value.paused) {
      held = true;
      entered = true;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
    return write.call(this, value);
  });
  const abort = new AbortController();
  const pending = f.runtime.authorize(abort.signal);
  const checked = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await until(() => entered);
  abort.abort();
  await checked;
  finish();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await f.runtime.close();
  const runtime = new RemoteRuntime(f.options);
  cleanup.push(() => runtime.close());
  await runtime.start();
  expect(runtime.status().state).toBe('paused');
  expect(f.connections).toHaveLength(0);
});
it('resume等待期间新增的其他tuple暂停不能被旧快照清除', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  await f.runtime.acceptTarget(remote);
  const runtime = f.runtime as any;
  const active = runtime.active;
  await runtime.save(active, { ...active.state, paused: true, pending: [local] });
  const expected = runtime.expected.bind(runtime);
  let changed = false;
  runtime.expected = async (...args: unknown[]) => {
    await expected(...args);
    if (!changed) {
      changed = true;
      await runtime.save(active, { ...active.state, paused: true, pending: [local, remote] });
    }
  };
  await f.runtime.resume(local);
  expect(f.runtime.status().pendingResume).toEqual([remote]);
});
it.each(['cancelled', 'timeout', 'closed'] as const)(
  'resume启动load挂起时%s仍关闭controller并恢复持久暂停，迟到load不能打开Relay',
  async (reason) => {
    const f = await fixture({
      createLogin: () => ({
        async login() {
          return {
            codexHome: '/synthetic/codex',
            accountId: 'workspace',
            accountUserId: 'account-user',
            userId: 'user',
          };
        },
        async close() {},
      }),
    });
    await f.runtime.authorize();
    await until(() => f.runtime.status().state === 'online');
    await f.runtime.login();
    await until(() => f.connections[0]!.readyState === 3);
    await f.runtime.refreshTargets();
    const { controller, loader } = (f.runtime as any).bundle;
    const start = controller.start.bind(controller);
    const load = loader.load.bind(loader);
    let entered = false;
    let settled = false;
    let release!: () => void;
    controller.start = () => {
      loader.load = async () => {
        entered = true;
        try {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return await load();
        } finally {
          settled = true;
        }
      };
      return start();
    };
    const abort = new AbortController();
    const pending = f.runtime.resume(local, abort.signal);
    const checked = expect(pending).rejects.toMatchObject({ code: reason });
    await until(() => entered);
    if (reason === 'cancelled') abort.abort();
    if (reason === 'closed') await f.runtime.close();
    await checked;
    expect(controller.state).toBe('closed');
    expect(f.runtime.status().pendingResume).toContainEqual(local);
    release();
    await until(() => settled);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.connections).toHaveLength(1);
    await f.runtime.close();
    const restarted = new RemoteRuntime(f.options);
    cleanup.push(() => restarted.close());
    await restarted.start();
    expect(restarted.status().state).toBe('paused');
    expect(restarted.status().pendingResume).toContainEqual(local);
    expect(f.connections).toHaveLength(1);
  },
);
it('目录仍有完整tuple但目标离线时resume拒绝且保留原暂停', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  await f.runtime.acceptTarget(remote);
  await f.runtime.recover();
  const before = f.runtime.status();
  const pointer = (await f.registry.readActive())!.snapshot;
  f.setTargets([{ ...target(local), online: false }, target(remote)]);
  await expect(f.runtime.resume(local)).rejects.toMatchObject({ code: 'target-unavailable' });
  expect(f.runtime.status().pendingResume).toEqual(before.pendingResume);
  expect((await f.registry.readActive())!.snapshot).toEqual(pointer);
});
it('本机重新关联到已接受目标时在候选创建和配对前拒绝', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  await f.runtime.acceptTarget(remote);
  const before = f.runtime.status();
  const pointer = (await f.registry.readActive())!.snapshot;
  const pairs = f.pairs();
  const begin = vi.spyOn(f.registry, 'beginCandidate');
  f.setLocal(remote);
  await expect(f.runtime.reassociate(local, remote)).rejects.toMatchObject({ code: 'identity-changed' });
  expect(begin).not.toHaveBeenCalled();
  expect(f.pairs()).toBe(pairs);
  expect(f.runtime.status().pendingResume).toEqual(before.pendingResume);
  expect((await f.registry.readActive())!.snapshot).toEqual(pointer);
});
it('离线pending目标恢复被拒绝时保留其他已恢复目标的流，重启也不扩大暂停', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  await f.runtime.acceptTarget(remote);
  await f.runtime.recover();
  await f.runtime.acceptTarget(remote);
  await f.runtime.resume(local);
  await until(() => f.runtime.status().state === 'online');
  const before = f.runtime.status();
  const pointer = (await f.registry.readActive())!.snapshot;
  const stream = f.runtime.createRawStream(local);
  f.setTargets([target(local), { ...target(remote), online: false }]);
  await expect(f.runtime.resume(remote)).rejects.toMatchObject({ code: 'target-unavailable' });
  expect(f.runtime.status().state).toBe('online');
  expect(f.runtime.status().pendingResume).toEqual([remote]);
  expect(f.runtime.status().managed).toEqual(before.managed);
  expect((await f.registry.readActive())!.snapshot).toEqual(pointer);
  expect(stream.closed).toBe(false);
  await expect(
    f.runtime.resume({ environmentId: 'unaccepted-env', installationId: 'unaccepted-install' }),
  ).rejects.toMatchObject({ code: 'target-unaccepted' });
  expect(f.runtime.status().state).toBe('online');
  expect(stream.closed).toBe(false);
  await f.runtime.close();
  const restarted = new RemoteRuntime(f.options);
  cleanup.push(() => restarted.close());
  await restarted.start();
  await until(() => restarted.status().state === 'online');
  expect(restarted.status().pendingResume).toEqual([remote]);
  expect(restarted.createRawStream(local).closed).toBe(false);
  expect(() => restarted.createRawStream(remote)).toThrow('需要在 Mac 显式恢复');
});
it('管理session同步阻塞超过实际阶段期限，已返回但未交付的资源仍关闭', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  const controller = (f.runtime as any).bundle.controller;
  let closed = 0;
  controller.createManagementSession = async () => {
    const deadline = performance.now() + 1600;
    while (performance.now() < deadline) {}
    return {
      close() {
        closed++;
      },
    };
  };
  await expect(f.runtime.createManagementSession(local)).rejects.toMatchObject({ code: 'timeout' });
  expect(closed).toBe(1);
});
