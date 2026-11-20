// @vitest-environment node
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { OperationQueue } from '../../server/operation-queue.js';
import { mkdtemp, readdir, realpath, rm, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { acquireRemoteOwner } from '../../server/remote/owner.js';
import { withRemoteOperation } from '../../server/remote/operation-guard.js';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { RemoteRuntime, type RemoteRuntimeOptions } from '../../server/remote/runtime.js';
import { RemoteRuntimeError } from '../../server/remote/runtime-lifecycle.js';
import { RemoteAuthProviderImpl } from '../../server/remote/auth.js';
import { RemoteIdentityRegistry } from '../../server/remote/identity-registry.js';
import { ManagedAuthLoader } from '../../server/remote/managed-auth.js';
import { PrivateStore } from '../../server/remote/private-store.js';
import { TargetResolver } from '../../server/targets.js';
import type { GatewayIdentity } from '../../server/gateway-identity.js';
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
  const store = change.store ?? new PrivateStore(join(root, 'private'));
  const registry = change.registry ?? new RemoteIdentityRegistry(store);
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
it('Runtime把本次summary预算传给同Controller且不改变后续默认工厂', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const controller = (f.runtime as any).bundle.controller; const calls: unknown[][] = [];
  controller.createManagementSession = async (...args: unknown[]) => { calls.push(args); return { close() {} }; };
  const budget = { maxRequestBytes: 16 * 1024 * 1024, maxInboundBytes: 16 * 1024 * 1024 };
  await f.runtime.createManagementSession(local, undefined, budget); await f.runtime.createManagementSession(local);
  expect(calls).toEqual([[local, budget], [local, undefined]]); expect(f.connections).toHaveLength(1);
});
it('一台目标的管理握手等待真实Relay回复时，不阻塞另一个目标的核验和逻辑流', async () => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  await f.runtime.acceptTarget(remote);
  const resolver = await resolverFor(f.runtime);
  const first = await resolver.resolve(reference(f, local));
  const second = await resolver.resolve(reference(f, remote));
  const ws = f.connections[0]!;
  let finishFirst: (() => void) | undefined;
  ws.on('message', bytes => {
    const frame = JSON.parse(bytes.toString());
    if (frame.type !== 'client_message' || frame.message?.method !== 'initialize') return;
    const reply = () => ws.send(JSON.stringify({ type: 'server_message', client_id: f.runtime.status().clientId,
      env_id: frame.env_id, stream_id: frame.stream_id, seq_id: 1,
      message: { id: frame.message.id, result: { codexHome: '/remote/mac' } } }));
    if (frame.env_id === local.environmentId) finishFirst = reply;
    else reply();
  });
  const opening = first.createManagementSession();
  void opening.catch(() => undefined);
  try {
    await until(() => !!finishFirst);
    expect((await resolver.directory()).data.targets).toHaveLength(2);
    const session = await second.createManagementSession();
    expect(session.ready).toBe(true);
    await session.settled();
    expect(f.connections).toHaveLength(1);
  } finally {
    finishFirst?.();
    const session = await opening;
    await session.settled();
  }
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
it('实际registry原子pointer写锁迟到时有界close返回，settled仍保留归属到真实提交完成', async () => {
 const f = await fixture({ cleanupTimeoutMs: 10 });
 let release!: () => void; let entered = false;
 const held = f.store.withInitialization('record-active-identity.json', async () => { entered = true; await new Promise<void>(resolve => release = resolve); });
 await until(() => entered);
 const abort = new AbortController(); const operation = f.runtime.authorize(abort.signal); const checked = expect(operation).rejects.toMatchObject({ code: 'commit-pending' });
 await until(() => f.runtime.status().reason === 'commit-pending'); abort.abort(); await checked;
 await f.runtime.close(); let settled = false; const barrier = f.runtime.settled().then(() => settled = true);
 await new Promise(resolve => setTimeout(resolve, 20)); expect(settled).toBe(false); expect(f.connections).toHaveLength(0);
 release(); await held; await barrier;
 expect((await f.registry.readActive())?.snapshot.generation).toBeDefined(); expect(f.connections).toHaveLength(0);
});
it('真实controller.storage暂停写锁仍活跃时close有界而settled不提前完成', async () => {
 const f = await fixture({ cleanupTimeoutMs: 10 }); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
 const active = await f.registry.readActive(); const controller = (f.runtime as any).bundle.controller;
 let release!: () => void; let entered = false;
 const held = active!.store.withInitialization('record-controller-pause.json', async () => { entered = true; await new Promise<void>(resolve => release = resolve); }); await until(() => entered);
 f.setKey(false); await controller.refreshTargets().catch(() => undefined); await until(() => controller.state === 'auth-required');
 await f.runtime.close(); let settled = false; const barrier = f.runtime.settled().then(() => settled = true); await new Promise(resolve => setTimeout(resolve, 20)); expect(settled).toBe(false);
 release(); await held; await barrier; expect(await active!.store.readJson('controller-pause.json')).toMatchObject({ paused: true });
});
it('只读queryStatus不把启动证明失败的fault清成可执行idle', async () => {
 const f = await fixture(); await f.runtime.authorize(); await f.runtime.close(); f.setNetwork(true);
 const runtime = new RemoteRuntime(f.options); cleanup.push(() => runtime.close()); await runtime.start(); expect(runtime.status().state).toBe('fault');
 expect((await runtime.queryStatus()).state).toBe('fault'); expect(f.oauth()).toBe(1);
});
it('独立复现：正常授权后的 actual Relay close 必须先于 runtime settled', async () => {
 const f = await fixture();
 await f.runtime.authorize();
 await until(() => f.runtime.status().state === 'online');
 const socket = (f.runtime as any).bundle.controller.relay.socket;
 let actualClose = false;
 socket.once('close', () => actualClose = true);
 await f.runtime.settled();
 expect(socket.readyState).toBe(3);
 expect(actualClose).toBe(true);
});

it('可信目标读取区分client可见与逐台已接受集合，并返回冻结无凭据快照', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const reader = f.runtime.readTargetBinding;
  const snapshot = await reader!.call(f.runtime);
  expect(snapshot.acceptedTargets).toEqual([local]);
  expect(snapshot.targets.map((value: { env_id: string }) => value.env_id)).toEqual([local.environmentId, remote.environmentId]);
  expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.managed)).toBe(true);
  expect(Object.isFrozen(snapshot.acceptedTargets[0])).toBe(true); expect(Object.isFrozen(snapshot.targets[0])).toBe(true);
  expect(JSON.stringify(snapshot)).not.toMatch(/private|accessToken|sealedKey|enrollment|identityHash/);
  await f.runtime.acceptTarget(remote);
  expect((await reader!.call(f.runtime)).acceptedTargets).toEqual([local, remote]);
  expect(snapshot.acceptedTargets).toEqual([local]);
});
it('可信目标读取直接复核当前受管身份，账号变化不能等待monitor后继续授权', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const reader = f.runtime.readTargetBinding;
  f.setManaged({ userId: 'other-user' });
  await expect(reader!.call(f.runtime)).rejects.toMatchObject({ code: 'identity-changed' });
  expect(f.keys()).toBe(1); expect(f.oauth()).toBe(1); expect(f.connections).toHaveLength(1);
});

const gatewayIdentity = Object.freeze({ version: 1 as const, gatewayId: 'e4b9d953-b470-483d-9eba-ad55b199081f', localHostId: 'a1b2e385-6bc1-449a-a81b-dc6e0fdd0a66' });
async function resolverFor(runtime?: RemoteRuntime, identity: Readonly<GatewayIdentity> = gatewayIdentity) {
  return new TargetResolver({ identity, remoteRuntime: runtime });
}

function reference(f: Awaited<ReturnType<typeof fixture>>, tuple = local) {
  const { accountId, accountUserId, userId } = f.runtime.status().managed!;
  return { mode: 'remote' as const, gatewayId: gatewayIdentity.gatewayId, account: { accountId, accountUserId, ...(userId === undefined ? {} : { userId }) }, target: { ...tuple } };
}
it('目标解析Local首次使用即固定归组，无需Remote授权，未指定模式兼容旧请求', async () => {
  const f = await fixture(); const resolver = await resolverFor(f.runtime);
  const localHandle = await resolver.resolve();
  expect(localHandle.descriptor.mode).toBe('local');
  expect((await resolver.resolve({})).descriptor).toEqual(localHandle.descriptor);
  expect((await resolver.resolve({ mode: undefined })).descriptor).toEqual(localHandle.descriptor);
  expect((await resolver.resolve({ mode: 'local' })).descriptor).toEqual(localHandle.descriptor);
  await localHandle.assertCurrent();
  expect(f.connections).toHaveLength(0); expect(f.keys()).toBe(0); expect(f.canonicals).toHaveLength(0);
  await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  expect((await resolver.resolve()).descriptor.businessKey).toBe(localHandle.descriptor.businessKey);
  const own = await resolver.resolve(reference(f));
  expect(own.descriptor.businessKey).toBe(localHandle.descriptor.businessKey);
  expect(own.descriptor.transportNamespace).not.toBe(localHandle.descriptor.transportNamespace);
  expect(own.descriptor.authorizationKey).not.toBe(localHandle.descriptor.authorizationKey);
  expect(own.descriptor.mode).toBe('remote'); expect(Object.isFrozen(own.descriptor.account)).toBe(true);
  expect(JSON.stringify(own.descriptor)).not.toMatch(/codexHome|synthetic|enrollment|private|token|keyId/);
  const stream = await own.createRawStream(); expect(stream.closed).toBe(false); expect(f.connections).toHaveLength(1);
  await stream.close();
});
it('目标解析显式Remote不可在未配置owner时回退Local', async () => {
  const resolver = await resolverFor();
  await expect(resolver.resolve({ mode: 'remote', gatewayId: gatewayIdentity.gatewayId, account: { accountId: 'a', accountUserId: 'u' }, target: local })).rejects.toMatchObject({ code: 'not-configured' });
});
it.each(([
  ['gatewayId', gatewayIdentity.gatewayId],
  ['account', { accountId: 'workspace', accountUserId: 'account-user' }],
  ['target', local],
] as const).flatMap(([field, value]) => [false, true].flatMap(explicitLocal => [false, true].map(undefinedValue => ({
  field, value: undefinedValue ? undefined : value, explicitLocal, undefinedValue,
})))))('目标解析Local拒绝非枚举Remote字段 $field（local=$explicitLocal，undefined=$undefinedValue）', async ({ field, value, explicitLocal }) => {
  const resolver = await resolverFor();
  const input = explicitLocal ? { mode: 'local' } : {};
  Object.defineProperty(input, field, { enumerable: false, value });
  await expect(resolver.resolve(input)).rejects.toMatchObject({ code: 'invalid-reference' });
});
it.each([
  null, [], 'remote', { mode: 'invalid' }, { target: local }, { mode: 'remote' },
  Object.defineProperty({}, 'mode', { get() { throw new Error('不能执行引用getter'); } }),
  { [Symbol('target')]: local }, Object.create({ mode: 'remote' }),
  { mode: 'local', target: local }, { mode: 'remote', gatewayId: gatewayIdentity.gatewayId, account: {}, target: local },
  { mode: 'remote', gatewayId: gatewayIdentity.gatewayId, account: { accountId: 'a', accountUserId: 'u', userId: undefined }, target: local },
  { mode: 'remote', gatewayId: gatewayIdentity.gatewayId, account: { accountId: 'a', accountUserId: 'u' }, target: { environmentId: 'e' } },
  { mode: 'remote', gatewayId: gatewayIdentity.gatewayId, account: { accountId: 'a', accountUserId: 'u', codexHome: '/forged' }, target: local },
  { mode: 'remote', gatewayId: gatewayIdentity.gatewayId, account: { accountId: 'a', accountUserId: 'u' }, target: { ...local, name: 'Mac' } },
])('目标解析拒绝恶意或不完整引用 %#', async input => {
  const resolver = await resolverFor();
  await expect(resolver.resolve(input)).rejects.toMatchObject({ code: 'invalid-reference' });
});
it('目标解析仅目录可见但尚未accept时拒绝，同名错误installation和错误账号也拒绝', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const resolver = await resolverFor(f.runtime);
  await expect(resolver.resolve(reference(f, remote))).rejects.toMatchObject({ code: 'target-unaccepted' });
  await expect(resolver.resolve(reference(f, { ...local, installationId: 'other' }))).rejects.toMatchObject({ code: 'target-changed' });
  for (const account of [{ ...reference(f).account, accountId: 'other' }, { ...reference(f).account, accountUserId: 'other' }, { accountId: 'workspace', accountUserId: 'account-user' }])
    await expect(resolver.resolve({ ...reference(f), account })).rejects.toMatchObject({ code: 'identity-changed' });
  await f.runtime.acceptTarget(remote);
  const other = await resolver.resolve(reference(f, remote));
  expect(other.descriptor.businessKey).not.toBe((await resolver.resolve()).descriptor.businessKey);
});
it('目标解析名称变化保留身份，重装不接管旧操作，离线只解析不创建流', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online'); await f.runtime.acceptTarget(remote);
  const resolver = await resolverFor(f.runtime); const before = await resolver.resolve(reference(f, remote));
  f.setTargets([target(local), { ...target(remote), online: false }]); await f.runtime.refreshTargets();
  const offline = await resolver.resolve(reference(f, remote)); expect(offline.descriptor.businessKey).toBe(before.descriptor.businessKey); expect(offline.descriptor.online).toBe(false);
  await expect(offline.createRawStream()).rejects.toMatchObject({ code: 'target-offline' });
  await expect(before.createManagementSession()).rejects.toMatchObject({ code: 'target-offline' });
  expect(f.connections).toHaveLength(1);
  f.setTargets([target(local), { ...target({ ...remote, installationId: 'reinstalled' }) }]); await f.runtime.refreshTargets();
  await expect(before.createRawStream()).rejects.toMatchObject({ code: 'target-changed' });
});
it('目标解析目录缺失单独拒绝，跨网关归组和传输隔离', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online'); await f.runtime.acceptTarget(remote);
  const resolver = await resolverFor(f.runtime); const otherIdentity = { ...gatewayIdentity, gatewayId: '295bdf0c-6830-480d-8bdf-0f235273eaf8' };
  const otherResolver = await resolverFor(f.runtime, otherIdentity);
  const own = await resolver.resolve(reference(f)); const other = await otherResolver.resolve({ ...reference(f), gatewayId: otherIdentity.gatewayId });
  expect(other.descriptor.businessKey).not.toBe(own.descriptor.businessKey);
  expect(other.descriptor.transportNamespace).not.toBe(own.descriptor.transportNamespace);
  await expect(otherResolver.resolve(reference(f))).rejects.toMatchObject({ code: 'gateway-mismatch' });
  f.setTargets([target(local)]); await f.runtime.refreshTargets();
  await expect(resolver.resolve(reference(f, remote))).rejects.toMatchObject({ code: 'target-missing' });
});
it('目标解析旧handle在账号userId变化或重新授权后不得新建流，pending明确拒绝', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const resolver = await resolverFor(f.runtime); const own = await resolver.resolve(reference(f));
  f.setManaged({ userId: 'changed' });
  await expect(own.createRawStream()).rejects.toMatchObject({ code: 'identity-changed' });
  f.setManaged({ userId: 'user' }); await f.runtime.recover(); await until(() => f.runtime.status().state === 'online');
  await expect(own.createRawStream()).rejects.toMatchObject({ code: 'identity-changed' });
  await expect(resolver.resolve(reference(f))).rejects.toMatchObject({ code: 'pending-resume' });
});
it('目标解析暂停owner不创建替代runtime或Local会话', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const resolver = await resolverFor(f.runtime); const own = await resolver.resolve(reference(f));
  await f.runtime.close();
  await expect(own.createRawStream()).rejects.toMatchObject({ code: 'closed' });
  expect((await resolver.resolve()).descriptor.mode).toBe('local');
  expect(f.keys()).toBe(1); expect(f.oauth()).toBe(1);
});
it('目标解析只读竞争依次真实核验，不建立第二会话owner或忙等', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online'); const resolver = await resolverFor(f.runtime);
  const loader = (f.runtime as any).bundle.loader;
  const original = loader.verifyIdentity.bind(loader); let release!: () => void; let entered = false; let calls = 0;
  vi.spyOn(loader, 'verifyIdentity').mockImplementation(async (...args: any[]) => { const value = await original(...args); calls++; if (calls === 1) { entered = true; await new Promise<void>(resolve => release = resolve); } return value; });
  const first = f.runtime.readTargetBinding(); await until(() => entered);
  let settled = false; const second = resolver.resolve(reference(f)).then(value => { settled = true; return value; });
  try { await new Promise(resolve => setTimeout(resolve, 20)); expect(settled).toBe(false); expect(calls).toBe(1); }
  finally { release(); await first; }
  expect((await second).descriptor.mode).toBe('remote'); expect(calls).toBe(2); expect(f.connections).toHaveLength(1);
});
it('目标解析句柄序列化只包含冻结descriptor，不能泄露owner或内部scope', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online'); const resolver = await resolverFor(f.runtime);
  const handle = await resolver.resolve(reference(f));
  expect(Object.keys(handle)).toEqual(['descriptor']);
  expect(JSON.stringify(handle)).not.toMatch(/synthetic|codexHome|store|private|enrollment|runtime|reference/);
});
it.each(['identity', 'target-missing'] as const)('真实管理session迟到close保留屏障，全局撤权关闭Relay而目标失效保留健康owner（%s）', async kind => {
  const { RemoteStream } = await import('../../server/remote/relay.js');
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online'); const resolver = await resolverFor(f.runtime);
  const handle = await resolver.resolve(reference(f)); let initialized = false; const frames: any[] = [];
  const existing = await handle.createRawStream(); const bundle = (f.runtime as any).bundle;
  const verify = bundle.loader.verifyIdentity.bind(bundle.loader); let refreshed = false;
  vi.spyOn(bundle.loader, 'verifyIdentity').mockImplementation(async (...args: any[]) => {
    if (kind === 'target-missing' && initialized && !refreshed) { refreshed = true; await bundle.controller.refreshTargets(); }
    return verify(...args);
  });
  f.connections[0]!.on('message', bytes => {
    const frame = JSON.parse(bytes.toString()); frames.push(frame);
    if (frame.type === 'client_message' && frame.message.method === 'initialize') {
      initialized = true;
      if (kind === 'identity') f.setManaged({ userId: 'other-user' }); else f.setTargets([target(remote)]);
      f.connections[0]!.send(JSON.stringify({ type: 'server_message', client_id: f.runtime.status().clientId, env_id: frame.env_id, stream_id: frame.stream_id, seq_id: 1, message: { id: frame.message.id, result: { codexHome: '/remote/mac' } } }));
    }
  });
  let release!: () => void; let closing = false; let settled = false; const gate = new Promise<void>(resolve => release = resolve);
  const original = RemoteStream.prototype.close; const closings = new WeakMap<object, Promise<void>>();
  vi.spyOn(RemoteStream.prototype, 'close').mockImplementation(function (this: InstanceType<typeof RemoteStream>) {
    if (!closings.has(this)) { closing = true; closings.set(this, gate.then(() => original.call(this))); }
    return closings.get(this)!;
  });
  const checked = handle.createManagementSession().then(() => { settled = true; return undefined; }, (error: unknown) => { settled = true; return error; });
  try {
    await until(() => closing); await new Promise(resolve => setTimeout(resolve, 20));
    expect(settled).toBe(false); expect(frames.some(frame => frame.type === 'client_closed')).toBe(false);
  } finally { release(); }
  expect(await checked).toMatchObject({ code: kind === 'identity' ? 'identity-changed' : 'target-missing' });
  if (kind === 'identity') {
    await until(() => f.connections[0]!.readyState === 3);
    await expect(existing.send({ id: 77, method: 'must-not-send' })).rejects.toThrow();
    expect(frames.some(frame => frame.type === 'client_message' && frame.message.id === 77)).toBe(false);
    expect(frames.some(frame => frame.type === 'client_closed')).toBe(false);
  } else {
    await until(() => frames.some(frame => frame.type === 'client_closed'));
    expect(f.connections[0]!.readyState).toBe(1); expect(f.runtime.status().state).toBe('online');
    await existing.close();
  }
  expect(initialized).toBe(true); expect(f.connections).toHaveLength(1);
});
it.each([{ accountId: 'other-workspace' }, { accountUserId: 'other-account-user' }, { userId: undefined }])('目标解析旧handle完整受管维度变化立即拒绝 %#', async change => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online'); const resolver = await resolverFor(f.runtime);
  const handle = await resolver.resolve(reference(f)); f.setManaged(change);
  await expect(handle.assertCurrent()).rejects.toMatchObject({ code: 'identity-changed' });
  await expect(handle.createRawStream()).rejects.toMatchObject({ code: 'identity-changed' });
  expect(f.connections).toHaveLength(1);
});
it('目标解析paused与pending不同，Local继续可用且不自动恢复Remote', async () => {
  const f = await fixture({ createLogin: () => ({ async login() { throw new Error('isolated login cancelled'); }, async close() {} }) });
  await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online'); const resolver = await resolverFor(f.runtime);
  const ref = reference(f); const handle = await resolver.resolve(ref);
  await expect(f.runtime.login()).rejects.toThrow(); expect(f.runtime.status().state).toBe('paused');
  await expect(handle.createRawStream()).rejects.toMatchObject({ code: 'paused' });
  await expect(resolver.resolve(ref)).rejects.toMatchObject({ code: 'paused' });
  expect((await resolver.resolve()).descriptor.mode).toBe('local'); expect(f.oauth()).toBe(1);
});

it('队列可信授权入口由真实Runtime提供完整冻结上下文与同步只读fence', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const resolver = await resolverFor(f.runtime);
  // 先断言真实生产入口，缺少能力是产品RED，不能让TypeError或夹具错误冒充行为失败。
  expect(resolver).toHaveProperty('operationContext', expect.any(Function));
  expect(resolver).toHaveProperty('authorizeOperation', expect.any(Function));
  const context = await (resolver as any).operationContext(reference(f));
  expect(context).toMatchObject({ mode: 'remote', managed: f.runtime.status().managed, target: local, generation: f.runtime.status().generation });
  const queue = new OperationQueue({ directory: join(f.root, 'queue'), gatewayId: gatewayIdentity.gatewayId,
    authorize: (context, action) => (resolver as any).authorizeOperation(context, action) });
  const id = randomUUID();
  await queue.submit({ id, context, conversationId: 'conversation', body: 'hello', settings: {}, attachmentRefs: [] });
  const fence = await (resolver as any).authorizeOperation(context, 'read');
  expect(fence()).toBeUndefined();
  expect((await queue.read(id)).body).toBe('hello');
  await f.runtime.close();
  expect(fence).toThrow();
  await expect(queue.read(id)).rejects.toThrow();
});

it('跨generation旧句柄永拒，但原冻结队列仅真实逐目标resume后可恢复且原context字节不改', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online'); await f.runtime.acceptTarget(remote);
  const resolver = await resolverFor(f.runtime); const handle = await resolver.resolve(reference(f));
  const ownContext = await resolver.operationContext(reference(f)); const otherContext = await resolver.operationContext(reference(f, remote));
  const bytes = JSON.stringify([ownContext, otherContext]);
  const queue = new OperationQueue({ directory: join(f.root, 'queue'), gatewayId: gatewayIdentity.gatewayId,
    authorize: (context, action) => resolver.authorizeOperation(context, action) });
  const ownId = randomUUID(); const otherId = randomUUID();
  for (const [id, context] of [[ownId, ownContext], [otherId, otherContext]] as const)
    await queue.submit({ id, context, conversationId: 'conversation', body: 'hello', settings: {}, attachmentRefs: [] });
  await f.runtime.recover(); await until(() => f.runtime.status().state === 'online');
  await expect(queue.read(ownId)).rejects.toThrow(); await expect(queue.read(otherId)).rejects.toThrow();
  await f.runtime.acceptTarget(remote); await expect(queue.read(otherId)).rejects.toThrow();
  await f.runtime.resume(local);
  await expect(handle.assertCurrent()).rejects.toMatchObject({ code: 'identity-changed' });
  await expect(queue.read(ownId)).resolves.toMatchObject({ context: ownContext, state: 'queued' });
  await expect(queue.read(otherId)).rejects.toThrow();
  await f.runtime.resume(remote);
  await expect(queue.read(otherId)).resolves.toMatchObject({ context: otherContext, state: 'queued' });
  expect(JSON.stringify([ownContext, otherContext])).toBe(bytes);
});

async function queuedFixture() {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const resolver = await resolverFor(f.runtime); const context = await resolver.operationContext(reference(f));
  const queue = new OperationQueue({ directory: join(f.root, 'queue'), gatewayId: gatewayIdentity.gatewayId,
    authorize: (context, action) => resolver.authorizeOperation(context, action) });
  const submit = async (conversationId = 'conversation', value = context) => {
    const id = randomUUID(); await queue.submit({ id, context: value, conversationId, body: 'hello', settings: {}, attachmentRefs: [] }); return id;
  };
  return { ...f, resolver, context, queue, submit };
}
it('队列Local完整固定身份不要求Remote密钥授权，伪造冻结维度均拒绝', async () => {
  const resolver = await resolverFor(); const context = await resolver.operationContext();
  expect(context.mode).toBe('local'); (await resolver.authorizeOperation(context, 'claim'))();
  for (const field of ['gatewayId', 'localHostId', 'businessKey', 'authorizationKey'])
    await expect(resolver.authorizeOperation({ ...context, [field]: 'other' }, 'read')).rejects.toThrow();
  const f = await queuedFixture();
  if (f.context.mode !== 'remote') throw new Error('fixture requires remote');
  for (const change of [
    { gatewayId: 'other' }, { businessKey: 'other' }, { authorizationKey: 'other' }, { generation: 'other' },
    { managed: { ...f.context.managed, codexHome: '/synthetic/other' } },
    { managed: { ...f.context.managed, accountId: 'other' } },
    { managed: { ...f.context.managed, accountUserId: 'other' } },
    { managed: { ...f.context.managed, userId: undefined } },
    { managed: { codexHome: f.context.managed.codexHome, accountId: f.context.managed.accountId, accountUserId: f.context.managed.accountUserId } },
    { target: { ...local, installationId: 'reinstalled' } },
  ]) await expect(f.resolver.authorizeOperation({ ...f.context, ...change }, 'read')).rejects.toThrow();
});
it('队列同代离线接收读取和确定结果落盘，claim与执行独立要求online', async () => {
  const f = await queuedFixture(); const first = await f.submit();
  const claim = await f.queue.claimNext(f.context.businessKey);
  const marked = await f.queue.markPotentialSend(first, claim!.revision, claim!.claimToken!);
  f.setTargets([{ ...target(local), online: false }, target(remote)]); await f.runtime.refreshTargets();
  const second = await f.submit('other');
  expect((await f.queue.read(second)).state).toBe('queued');
  await expect(f.queue.claimNext(f.context.businessKey)).rejects.toThrow();
  await expect(f.resolver.authorizeOperationExecution(f.context)).rejects.toThrow();
  await expect(f.queue.settle(first, marked.revision, claim!.claimToken!, 'succeeded')).resolves.toMatchObject({ state: 'succeeded' });
  f.setTargets([target(local), target(remote)]); await f.runtime.refreshTargets();
  const next = await f.queue.claimNext(f.context.businessKey);
  f.setTargets([{ ...target(local), online: false }, target(remote)]); await f.runtime.refreshTargets();
  await expect(f.queue.releaseClaim(second, next!.revision, next!.claimToken!)).resolves.toMatchObject({ state: 'queued' });
  f.setTargets([target(local), target(remote)]); await f.runtime.refreshTargets();
  const last = await f.queue.claimNext(f.context.businessKey);
  const uncertain = await f.queue.markPotentialSend(second, last!.revision, last!.claimToken!);
  f.setTargets([{ ...target(local), online: false }, target(remote)]); await f.runtime.refreshTargets();
  await expect(f.queue.confirmNeverSent(second, uncertain.revision, last!.claimToken!, async () => true)).resolves.toMatchObject({ state: 'queued' });
});
it('同代多Remote及Local混合批量重复只读不自废，最后自身await关闭owner则全部拒绝', async () => {
  const f = await queuedFixture(); await f.submit(); await f.submit();
  const localContext = await f.resolver.operationContext(); await f.submit('conversation', localContext);
  for (let count = 0; count < 3; count++) expect(await f.queue.list(f.context.businessKey, 'conversation')).toHaveLength(3);
  let count = 0;
  const queue = new OperationQueue({ directory: join(f.root, 'queue'), gatewayId: gatewayIdentity.gatewayId,
    authorize: async (context, action) => {
      const fence = await f.resolver.authorizeOperation(context, action);
      if (++count === 6) await f.runtime.close();
      return fence;
    } });
  await expect(queue.list(f.context.businessKey, 'conversation')).rejects.toThrow();
  expect(count).toBe(6);
});
it.each(['accepted', 'installation', 'missing', 'pending', 'preparing', 'paused', 'identity', 'closed'] as const)(
  '真实同步fence在最后await之后%s变化立即失效', async kind => {
    const f = await queuedFixture(); const guard = await f.resolver.authorizeOperationExecution(f.context);
    guard.assertCurrent(); guard.assertLive();
    if (kind === 'accepted') await f.runtime.acceptTarget(remote);
    if (kind === 'installation') { f.setTargets([target({ ...local, installationId: 'reinstalled' })]); await f.runtime.refreshTargets(); }
    if (kind === 'missing') { f.setTargets([target(remote)]); await f.runtime.refreshTargets(); }
    if (kind === 'pending') (f.runtime as any).active.state.pending.push(local);
    if (kind === 'preparing') (f.runtime as any).preparing = true;
    if (kind === 'paused') (f.runtime as any).active.state.paused = true;
    if (kind === 'identity') {
      f.setManaged({ userId: 'other' }); await expect(f.runtime.readTargetBinding()).rejects.toThrow();
    }
    if (kind === 'closed') await f.runtime.close();
    expect(guard.assertCurrent).toThrow(); expect(guard.assertLive).toThrow();
  },
);
it('queue最终fence真实核验owner inode，不等待定时器或下一次await', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'queue-real-owner-'))); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const owner = await acquireRemoteOwner(new PrivateStore(join(root, 'private'))); cleanup.push(() => owner.close().catch(() => undefined));
  const f = await fixture({ store: owner.store }); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const resolver = await resolverFor(f.runtime); const context = await resolver.operationContext(reference(f));
  const fence = await resolver.authorizeOperation(context, 'read');
  const fs = await import('node:fs');
  fs.renameSync(owner.store.directory, owner.store.directory + '-old'); fs.mkdirSync(owner.store.directory, { mode: 0o700 });
  expect(owner.signal.aborted).toBe(false); expect(fence).toThrow(); expect(owner.signal.aborted).toBe(true);
});

it.each(['loss-between-frames', 'proof-delay'] as const)('可信执行实际Relay组合%s保留真实归属且proof之后重查原父期限', async kind => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'queue-relay-owner-'))); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const owner = await acquireRemoteOwner(new PrivateStore(join(root, 'private'))); cleanup.push(() => owner.close().catch(() => undefined));
  const f = await fixture({ store: owner.store }); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const resolver = await resolverFor(f.runtime); const context = await resolver.operationContext(reference(f));
  const guard = await resolver.authorizeOperationExecution(context); const stream = f.runtime.createRawStream(local);
  guard.assertCurrent();
  const socket = (f.runtime as any).bundle.controller.relay.socket;
  const send = socket.send.bind(socket); let physical = 0; let delayed = false;
  const fs = await import('node:fs');
  vi.spyOn(socket, 'send').mockImplementation((...args: any[]) => {
    physical++; const result = send(...args);
    if (kind === 'loss-between-frames' && physical === 1) {
      fs.renameSync(owner.store.directory, owner.store.directory + '-old'); fs.mkdirSync(owner.store.directory, { mode: 0o700 });
    }
    return result;
  });
  const assertOwnership = PrivateStore.prototype.assertOwnership;
  if (kind === 'proof-delay') vi.spyOn(PrivateStore.prototype, 'assertOwnership').mockImplementation(function (this: PrivateStore) {
    assertOwnership.call(this);
    if (!delayed && this.directory.startsWith(owner.store.directory)) {
      delayed = true; const until = performance.now() + 50; while (performance.now() < until) { /* 真实同步proof阻塞 */ }
    }
  });
  const deadline = performance.now() + 25;
  const result = await withRemoteOperation(() => { if (performance.now() >= deadline) throw new Error('original deadline'); },
    () => withRemoteOperation(guard.assertLive, () => stream.send({ id: 1, method: 'test', params: { text: 'x'.repeat(700000) } })))
    .then(() => 'sent', () => 'rejected');
  expect(result).toBe('rejected'); expect(physical).toBe(kind === 'proof-delay' ? 0 : 1);
  if (kind === 'proof-delay') expect(delayed).toBe(true);
});

it('真实queue最终FS归属proof跨原父deadline后不交付正文，即使外层稍后才检查期限', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'queue-parent-proof-'))); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const owner = await acquireRemoteOwner(new PrivateStore(join(root, 'private'))); cleanup.push(() => owner.close().catch(() => undefined));
  const f = await fixture({ store: owner.store }); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const resolver = await resolverFor(f.runtime); const context = await resolver.operationContext(reference(f));
  let arming = false; let calls = 0; let delayed = false; let delivered = false;
  const queue = new OperationQueue({ directory: join(f.root, 'queue'), gatewayId: gatewayIdentity.gatewayId,
    authorize: async (context, action) => {
      const fence = await resolver.authorizeOperation(context, action);
      if (arming && ++calls === 2) delayed = true;
      return fence;
    } });
  const id = randomUUID(); await queue.submit({ id, context, conversationId: 'conversation', body: 'hello', settings: {}, attachmentRefs: [] });
  const proof = PrivateStore.prototype.assertOwnership;
  let deadline = Infinity;
  vi.spyOn(PrivateStore.prototype, 'assertOwnership').mockImplementation(function (this: PrivateStore) {
    proof.call(this);
    if (delayed && this.directory.startsWith(owner.store.directory)) {
      delayed = false; const stop = performance.now() + 40; while (performance.now() < stop) { /* 真同步proof */ }
    }
  });
  arming = true; deadline = performance.now() + 100;
  // final authorize完成后设置期限，避免把普通FS前置耗时混为最后proof的跨期。
  const original = resolver.authorizeOperation.bind(resolver);
  vi.spyOn(resolver, 'authorizeOperation').mockImplementation(async (...args) => {
    const fence = await original(...args); if (calls === 1) deadline = performance.now() + 20; return fence;
  });
  await expect(withRemoteOperation(() => { if (performance.now() >= deadline) throw new Error('original deadline'); }, async () => {
    await queue.read(id); delivered = true;
  })).rejects.toThrow();
  expect(calls).toBe(2); expect(delivered).toBe(false);
});

async function recoveryInNewProcess(f: Awaited<ReturnType<typeof queuedFixture>>, field: 'allowed' | 'paused' = 'allowed') {
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx',
    new URL('./fixtures/remote-queue-recovery-worker.ts', import.meta.url).pathname, f.store.directory, JSON.stringify(f.context)],
  { timeout: 10000, env: process.env });
  const proof = JSON.parse(result.stdout); expect(proof.pid).not.toBe(process.pid); return proof[field];
}
it('真实OS新进程验证多代逐target持久证明，原record字节保留且uncertain和failed从不自动重排', async () => {
  const f = await queuedFixture(); const unknown = await f.submit('unknown'); const failed = await f.submit('failed'); const queued = await f.submit('queued');
  const a = await f.queue.claimNext(f.context.businessKey); const mark = await f.queue.markPotentialSend(unknown, a!.revision, a!.claimToken!);
  expect(mark.state).toBe('uncertain'); const b = await f.queue.claimNext(f.context.businessKey);
  const bm = await f.queue.markPotentialSend(failed, b!.revision, b!.claimToken!); await f.queue.settle(failed, bm.revision, b!.claimToken!, 'failed');
  const original = await readFile(join(f.root, 'queue/operations.json'));
  for (let generation = 0; generation < 3; generation++) {
    await f.runtime.recover(); await until(() => f.runtime.status().state === 'online');
    expect(await recoveryInNewProcess(f)).toBe(false);
  }
  await f.runtime.resume(local); expect(await recoveryInNewProcess(f)).toBe(true);
  await f.runtime.close();
  const restarted = new RemoteRuntime(f.options); cleanup.push(() => restarted.close()); await restarted.start(); await until(() => restarted.status().state === 'online');
  const resolver = await resolverFor(restarted);
  (await resolver.authorizeOperation(f.context, 'read'))();
  const reopened = new OperationQueue({ directory: join(f.root, 'queue'), gatewayId: gatewayIdentity.gatewayId,
    authorize: (context, action) => resolver.authorizeOperation(context, action) });
  expect((await reopened.read(unknown)).state).toBe('uncertain'); expect((await reopened.read(failed)).state).toBe('failed');
  expect((await readFile(join(f.root, 'queue/operations.json'))).equals(original)).toBe(true);
  expect((await reopened.claimNext(f.context.businessKey))?.id).toBe(queued);
}, 20000);
it('恢复拒绝缺链损坏与未提交候选，不以pending空或pair/accept代替逐tuple成功事实', async () => {
  const f = await queuedFixture(); const id = await f.submit(); const old = await f.registry.readActive();
  await f.runtime.recover(); await until(() => f.runtime.status().state === 'online'); await f.runtime.resume(local);
  const current = await f.registry.readActive(); const state = await current!.store.readJson('runtime-state.json') as any;
  await current!.store.writeJson('runtime-state.json', { ...state, resumed: [] });
  await expect(f.queue.read(id)).rejects.toThrow(); expect(await recoveryInNewProcess(f)).toBe(false);
  await current!.store.writeJson('runtime-state.json', state);
  const candidate = await f.registry.beginCandidate();
  if (f.context.mode !== 'remote') throw new Error('requires remote');
  await expect(f.runtime.proveOperationRecovery(candidate.generation, f.context.managed, local)).rejects.toThrow();
  for (const name of ['candidate.json', 'identity.json', 'enrollment.json', 'device-key.json', 'controller-binding.json']) {
    const path = join(old!.store.directory, name); const kept = path + '.kept'; await rename(path, kept);
    await expect(f.queue.read(id)).rejects.toThrow(); expect(await recoveryInNewProcess(f)).toBe(false);
    await rename(kept, path);
  }
  const oldCandidate = await old!.store.readJson('candidate.json') as any;
  await old!.store.writeJson('candidate.json', { ...oldCandidate, expectedActive: current!.snapshot });
  await expect(f.queue.read(id)).rejects.toThrow(); await old!.store.writeJson('candidate.json', oldCandidate);
  const original = await readFile(join(f.root, 'queue/operations.json'));
  await expect(f.queue.read(id)).resolves.toMatchObject({ state: 'queued', context: f.context });
  expect((await readFile(join(f.root, 'queue/operations.json'))).equals(original)).toBe(true);
}, 20000);
it.each(['cancelled', 'write-failed'] as const)('显式resume最终证明%s不会产生可重启的跨代授权', async kind => {
  const f = await queuedFixture(); const id = await f.submit(); await f.runtime.recover(); await until(() => f.runtime.status().state === 'online');
  const active = (f.runtime as any).active; const write = active.stateStore.write.bind(active.stateStore);
  const abort = new AbortController(); let entered = false; let release!: () => void;
  vi.spyOn(active.stateStore, 'write').mockImplementation(async (state: any) => {
    if (!entered && state.resumed?.some((value: any) => value.environmentId === local.environmentId)) {
      entered = true;
      if (kind === 'write-failed') throw new Error('synthetic durable failure');
      await new Promise<void>(resolve => release = resolve);
    }
    return write(state);
  });
  const pending = f.runtime.resume(local, abort.signal); const result = expect(pending).rejects.toThrow();
  await until(() => entered); if (kind === 'cancelled') { abort.abort(); release(); }
  await result; await f.runtime.settled(); expect(await recoveryInNewProcess(f)).toBe(false);
  const persisted = await active.stateStore.read(); expect(persisted.paused).toBe(true); expect(persisted.resumed).toEqual([]);
  const restarted = new RemoteRuntime(f.options); cleanup.push(() => restarted.close()); await restarted.start();
  expect(restarted.status().state).toBe('paused');
  const resolver = await resolverFor(restarted); await expect(resolver.authorizeOperation(f.context, 'read')).rejects.toThrow();
  expect(id).toBeTruthy();
});

it('已经resume的远端目标显式重新关联新installation仅影响未来，旧队列永不接管', async () => {
  const f = await queuedFixture(); await f.runtime.acceptTarget(remote); await f.runtime.resume(remote);
  const context = await f.resolver.operationContext(reference(f, remote)); const id = await f.submit('remote', context);
  const next = { ...remote, installationId: 'new-installation' };
  f.setTargets([target(local), target(next)]);
  await expect(f.runtime.reassociate(remote, next)).resolves.toMatchObject({ pendingResume: [remote] });
  await expect(f.queue.read(id)).rejects.toThrow();
  const future = await f.resolver.operationContext(reference(f, next));
  expect(future.authorizationKey).not.toBe(context.authorizationKey);
  const newId = await f.submit('future', future); await expect(f.queue.read(newId)).resolves.toMatchObject({ state: 'queued' });
});

it('真实可信执行guard可包住同owner管理session初始化，不把自身只读与资源operation误判撤权', async () => {
  const f = await queuedFixture();
  f.connections[0]!.on('message', bytes => {
    const frame = JSON.parse(bytes.toString());
    if (frame.type === 'client_message' && frame.message.method === 'initialize')
      f.connections[0]!.send(JSON.stringify({ type: 'server_message', client_id: f.runtime.status().clientId,
        env_id: frame.env_id, stream_id: frame.stream_id, seq_id: 1, message: { id: frame.message.id, result: { codexHome: '/remote/mac' } } }));
  });
  const guard = await f.resolver.authorizeOperationExecution(f.context);
  const session = await withRemoteOperation(guard.assertLive, () => f.runtime.createManagementSession(local));
  guard.assertCurrent(); await session.settled(); expect(f.connections).toHaveLength(1);
});

it('真实recover未决提交仍拒绝binding查询，不把资源只读分类扩大为queryStatus例外', async () => {
  const f = await queuedFixture(); const activate = f.registry.activate.bind(f.registry);
  let release!: () => void; let entered = false;
  vi.spyOn(f.registry, 'activate').mockImplementation(async (...args) => {
    entered = true; await new Promise<void>(resolve => release = resolve); return activate(...args);
  });
  const abort = new AbortController(); const flight = f.runtime.recover(abort.signal);
  const checked = expect(flight).rejects.toMatchObject({ code: 'commit-pending' });
  await until(() => entered); abort.abort(); await checked;
  await expect(f.runtime.readTargetBinding()).rejects.toMatchObject({ code: 'commit-pending' });
  release(); await f.runtime.settled();
});
it('真实挂起mutation与readonly各自busy拒绝不覆盖当前operation的授权分类', async () => {
  const f = await queuedFixture(); const guard = await f.resolver.authorizeOperationExecution(f.context);
  const begin = f.registry.beginCandidate.bind(f.registry); let release!: () => void; let entered = false;
  vi.spyOn(f.registry, 'beginCandidate').mockImplementation(async (...args) => {
    entered = true; await new Promise<void>(resolve => release = resolve); return begin(...args);
  });
  const recover = f.runtime.recover(); await until(() => entered);
  const busyRead = f.runtime.readTargetBinding(); const readCheck = expect(busyRead).rejects.toMatchObject({ code: 'busy' });
  expect(() => guard.assertLive()).toThrow(); await readCheck;
  release(); await recover; await until(() => f.runtime.status().state === 'online'); await f.runtime.resume(local);
  const fresh = await f.resolver.authorizeOperationExecution(f.context);
  const bundle = (f.runtime as any).bundle; const verify = bundle.provider.verifyBinding.bind(bundle.provider);
  entered = false;
  vi.spyOn(bundle.provider, 'verifyBinding').mockImplementation(async () => {
    entered = true; await new Promise<void>(resolve => release = resolve); return verify();
  });
  const readonly = f.runtime.readTargetBinding(); await until(() => entered);
  const busyWrite = f.runtime.recover(); const writeCheck = expect(busyWrite).rejects.toMatchObject({ code: 'busy' });
  expect(() => fresh.assertLive()).not.toThrow(); await writeCheck; release(); await readonly;
  expect(() => fresh.assertCurrent()).not.toThrow();
});

it.each((['file', 'key'] as const).flatMap(boundary =>
  (['unavailable', 'timeout', 'cancelled'] as const).map(code => ({ boundary, code })),
))('父操作失效 $boundary/$code 不误判身份变化或暂停原授权', async ({ boundary, code }) => {
  const f = await fixture();
  await f.runtime.authorize();
  await until(() => f.runtime.status().state === 'online');
  const before = f.runtime.status();
  const bundle = (f.runtime as any).bundle;
  let live = true;
  const source = boundary === 'file' ? bundle.loader.options : bundle.key;
  const method = boundary === 'file' ? 'readAuthFile' : 'getIdentity';
  const original = source[method].bind(source);
  const spy = vi.spyOn(source, method).mockImplementation(async (...args: unknown[]) => {
    const result = await original(...args);
    live = false;
    return result;
  });
  await expect(withRemoteOperation(() => {
    if (!live) throw new RemoteRuntimeError(code);
  }, () => f.runtime.readTargetBinding())).rejects.toMatchObject({ code });
  spy.mockRestore(); live = true;
  expect(f.runtime.status()).toMatchObject({ state: 'online', generation: before.generation });
  expect(await (await f.registry.readActive())!.store.readJson('runtime-state.json')).toMatchObject({ paused: false });
  await expect(f.runtime.readTargetBinding()).resolves.toMatchObject({ generation: before.generation, state: 'online' });
  expect(f.connections).toHaveLength(1);
});

it.each(['start', 'restart'] as const)('readonly已发现身份变化后还原凭据再%s仍持久暂停，不能绕过Mac显式resume', async kind => {
  const f = await queuedFixture(); const id = await f.submit();
  f.setManaged({ accountId: 'other' }); await expect(f.runtime.readTargetBinding()).rejects.toMatchObject({ code: 'identity-changed' });
  f.setManaged({ accountId: 'workspace' });
  let runtime = f.runtime;
  if (kind === 'restart') {
    await runtime.close(); runtime = new RemoteRuntime(f.options); cleanup.push(() => runtime.close());
  }
  await runtime.start();
  const resolver = await resolverFor(runtime);
  await expect(resolver.authorizeOperation(f.context, 'read')).rejects.toThrow();
  await expect(resolver.authorizeOperation(f.context, 'claim')).rejects.toThrow();
  expect((await (await f.registry.readActive())!.store.readJson('runtime-state.json'))).toMatchObject({ paused: true, resumed: [] });
  expect(await recoveryInNewProcess(f, 'paused')).toBe(true);
  expect(id).toBeTruthy();
});
