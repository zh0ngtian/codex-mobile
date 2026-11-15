// @vitest-environment node
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, vi } from 'vitest';
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
export async function until(check: () => boolean, timeout = 3000) {
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
export async function fixture(change: Partial<RemoteRuntimeOptions> = {}) {
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
