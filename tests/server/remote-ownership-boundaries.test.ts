// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { getEventListeners } from 'node:events';
import childProcess from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request, type Server } from 'node:http';
import { performance } from 'node:perf_hooks';
import { PrivateStore } from '../../server/remote/private-store.js';
import { acquireRemoteOwner } from '../../server/remote/owner.js';
import { publishRemoteAdmin } from '../../server/remote/admin.js';
import { RemoteRuntime } from '../../server/remote/runtime.js';
import { RemoteController, type RemoteControllerCanonical } from '../../server/remote/controller.js';
import { ManagedAuthLoader } from '../../server/remote/managed-auth.js';
import { RemoteRelay } from '../../server/remote/relay.js';
import { WebSocketServer } from 'ws';
import { RemoteIdentityRegistry } from '../../server/remote/identity-registry.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';
import { RemoteRuntimeLifecycle, type RemoteRuntimeOperation } from '../../server/remote/runtime-lifecycle.js';
import { ResourceSettlement } from '../../server/remote/resource-settlement.js';
import { deviceIdentityHash } from '../../server/remote/auth.js';
import { RemoteCanonicalLogin } from '../../server/remote/login.js';
import { RemoteStepUpOAuth } from '../../server/remote/oauth.js';
import { RemoteAuthProviderImpl } from '../../server/remote/auth.js';
import { RemoteCatalog } from '../../server/remote/catalog.js';
import { SecureEnclaveDeviceKey } from '../../server/remote/device-key.js';
import { withRemoteOperation } from '../../server/remote/operation-guard.js';

it('成功退役后的真实Relay保持零流保活、后续challenge签名、重连和新canonical不继承旧phase', async () => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'retired-relay-'));
  const owner = await acquireRemoteOwner(new PrivateStore(join(parent, 'r')));
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const identity = { keyId: 'key', algorithm: 'ecdsa_p256_sha256' as const, protectionClass: 'hardware_secure_enclave' as const, publicKeySpkiDerBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  let signatures = 0; let proofFrames = 0;
  const key = new SecureEnclaveDeviceKey({ store: owner.store, runHelper: async (op, input) => {
    if (op === 'sign') signatures++;
    return { ...identity, keyRecord: { keyId: identity.keyId, sealedKeyBase64: 'c2VhbGVk' },
      signatureDerBase64: sign('sha256', Buffer.from(String(input.messageBase64 ?? ''), 'base64'), pair.privateKey).toString('base64') };
  } });
  await key.create();
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => wss.once('listening', resolve));
  wss.on('connection', socket => {
    socket.on('error', () => {});
    socket.on('message', raw => { if (JSON.parse(raw.toString()).type === 'device_key_proof') proofFrames++; });
    setTimeout(() => { if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'device_key_challenge', nonce: 'synthetic' })); }, 40);
  });
  const url = `ws://127.0.0.1:${(wss.address() as { port: number }).port}`;
  const lifecycle = new RemoteRuntimeLifecycle(20, 20, 10);
  let relay: RemoteRelay | undefined;
  let canonical: RemoteRpcSession | undefined;
  let newSession!: Promise<void>;
  const until = async (predicate: () => boolean) => {
    const deadline = performance.now() + 2000;
    while (!predicate()) { if (performance.now() >= deadline) throw new Error('等待隔离WS超时'); await new Promise(resolve => setTimeout(resolve, 5)); }
  };
  try {
    await lifecycle.run(undefined, op => lifecycle.wait(op, async () => {
      relay = new RemoteRelay({ clientId: 'own-client', assertOwnership: () => owner.assert(), reconnectMinMs: 10, reconnectMaxMs: 20,
        authProvider: { prepareConnection: async () => ({ url, headers: {}, signChallenge: async () => ({ signature: await key.sign(Buffer.from('challenge')) }) }) } });
      newSession = new Promise<void>((resolve, reject) => setTimeout(() => {
        RemoteRpcSession.connectCanonical(url).then(value => { canonical = value; resolve(); }, reject);
      }, 50));
      return true;
    }));
    await until(() => proofFrames === 1);
    await newSession;
    expect(signatures).toBe(1); expect(relay!.state).toBe('online'); expect((Reflect.get(relay!, 'streams') as Map<string, unknown>).size).toBe(0);
    await new Promise(resolve => setTimeout(resolve, 35));
    expect(relay!.state).toBe('online');
    for (const socket of wss.clients) socket.terminate();
    await until(() => proofFrames === 2);
    expect(signatures).toBe(2); expect(relay!.state).toBe('online');
  } finally {
    await relay?.settled(); await canonical?.settled(); lifecycle.close(); await lifecycle.settled();
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await owner.close(); await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['timeout', 'cancel', 'failure'] as const)('%s父guard保留到迟到canonical任务，ResourceSettlement实际settled且零WS', async reason => {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => wss.once('listening', resolve));
  let connections = 0;
  wss.on('connection', () => connections++);
  const resources = new ResourceSettlement();
  let release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  let cancelled = false;
  const deadline = performance.now() + 20;
  let late!: Promise<RemoteRpcSession>;
  try {
    await expect(withRemoteOperation(() => { if (cancelled || performance.now() >= deadline) throw new Error('fixed ended'); }, async () => {
      late = resources.create(async () => { await gate; return RemoteRpcSession.connectCanonical(`ws://127.0.0.1:${(wss.address() as { port: number }).port}`); });
      void late.catch(() => undefined);
      if (reason === 'cancel') cancelled = true;
      if (reason === 'failure') throw new Error('synthetic failure');
      if (reason === 'timeout') { const until = performance.now() + 40; while (performance.now() < until) {} }
      return true;
    })).rejects.toBeDefined();
    let settled = false;
    const barrier = resources.settled().then(() => settled = true);
    await Promise.resolve(); expect(settled).toBe(false);
    release();
    await expect(late).rejects.toBeDefined(); await barrier;
    expect(connections).toBe(0);
  } finally {
    release(); await resources.settled();
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
  }
});

it.each(['create', 'public', 'sign', 'invoke', 'cancel', ...(process.platform === 'darwin' ? ['compile' as const] : [])] as const)('key %s最终proof沿用原父phase，禁止helper/编译器新进程', async point => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'key-preproof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const identity = { keyId: 'key', algorithm: 'ecdsa_p256_sha256' as const, protectionClass: 'hardware_secure_enclave' as const, publicKeySpkiDerBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  if (point !== 'create') await owner.store.writeJson('device-key.json', { keyId: identity.keyId, sealedKeyBase64: 'c2VhbGVk' });
  const runner = vi.fn(async (_operation: string, input: Record<string, unknown>) => ({ ...identity,
    keyRecord: { keyId: identity.keyId, sealedKeyBase64: 'c2VhbGVk' },
    signatureDerBase64: sign('sha256', Buffer.from(String(input.messageBase64 ?? ''), 'base64'), pair.privateKey).toString('base64') }));
  const key = new SecureEnclaveDeviceKey({ store: owner.store, ...(point === 'invoke' || point === 'compile' ? {} : { runHelper: runner }) });
  let armed = false; let delayed = false; let cancelled = false;
  const calls = key as unknown as { call(op: string, input: Record<string, unknown>): Promise<Record<string, unknown>>; compiledHelper(): Promise<string> };
  const originalCall = calls.call.bind(key);
  const callSpy = vi.spyOn(calls, 'call').mockImplementation((op, input) => {
    if (point === 'create' || point === 'public' || point === 'cancel' || (point === 'sign' && op === 'sign')) armed = true;
    return originalCall(op, input);
  });
  const compiledSpy = point === 'invoke' ? vi.spyOn(calls, 'compiledHelper').mockImplementation(async () => { armed = true; return process.execPath; }) : undefined;
  const fork = owner.store.fork.bind(owner.store);
  const forkSpy = point === 'compile' ? vi.spyOn(owner.store, 'fork').mockImplementation(path => { armed = true; return fork(path); }) : undefined;
  const original = fsSync.lstatSync;
  const statSpy = vi.spyOn(fsSync, 'lstatSync').mockImplementation((...args: Parameters<typeof original>) => {
    const stat = Reflect.apply(original, fsSync, args);
    if (armed && !delayed && String(args[0]) === root) {
      delayed = true;
      if (point === 'cancel') cancelled = true;
      else {
        const until = performance.now() + 250;
        while (performance.now() < until) {}
      }
    }
    return stat;
  });
  const spawn = vi.spyOn(childProcess, 'spawn');
  syncBuiltinESMExports();
  const deadline = performance.now() + 100;
  const check = () => { if (cancelled || performance.now() >= deadline) throw new Error('fixed deadline'); };
  try {
    await expect(withRemoteOperation<unknown>(check, () => point === 'create' ? key.create() : point === 'sign' ? key.sign(Buffer.from('challenge')) : key.getIdentity())).rejects.toBeDefined();
    expect(delayed).toBe(true);
    expect(runner.mock.calls.filter(([operation]) => point === 'sign' ? operation === 'sign' : true)).toEqual([]);
    expect(spawn).not.toHaveBeenCalled();
    if (point === 'create') expect(await owner.store.readJson('device-key.json')).toBeNull();
  } finally {
    statSpy.mockRestore(); spawn.mockRestore(); callSpy.mockRestore(); compiledSpy?.mockRestore(); forkSpy?.mockRestore(); syncBuiltinESMExports();
    await owner.close(); await fs.rm(parent, { recursive: true, force: true });
  }
});

it('Runtime.authorize实际候选key.call proof跨短phase，零合成helper进程及后续OAuth/Relay', async () => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'runtime-key-preproof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const managed = { codexHome: '/synthetic/codex', accountId: 'workspace', accountUserId: 'account-user', userId: 'user' };
  let armed = false; let delayed = false;
  const helper = vi.fn(async () => { const child = childProcess.spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }); await new Promise(resolve => child.once('close', resolve)); throw new Error('synthetic helper unavailable'); });
  const oauth = vi.fn(async () => { throw new Error('unused'); });
  const controller = vi.fn();
  const runtime = new RemoteRuntime({ store: owner.store, canonicalFactory: async () => { throw new Error('unused'); }, operationTimeoutMs: 500, interactionTimeoutMs: 2000, cleanupTimeoutMs: 20,
    createManagedAuth: () => ({ load: async () => ({ ...managed, accessToken: 'synthetic' }), currentIdentity: managed, verifyIdentity: async () => managed, close() {} }),
    createDeviceKey: store => {
      const key = new SecureEnclaveDeviceKey({ store, runHelper: helper });
      const calls = key as unknown as { call(op: string, input: Record<string, unknown>): Promise<Record<string, unknown>> };
      const original = calls.call.bind(key);
      calls.call = (op, input) => { armed = true; return original(op, input); };
      return key;
    }, createOAuth: () => ({ authorize: oauth, close() {} }), createController: () => ({ close: controller }) as unknown as RemoteController });
  const original = fsSync.lstatSync;
  const statSpy = vi.spyOn(fsSync, 'lstatSync').mockImplementation((...args: Parameters<typeof original>) => {
    const stat = Reflect.apply(original, fsSync, args);
    if (armed && !delayed && String(args[0]) === root) {
      delayed = true;
      const until = performance.now() + 1000;
      while (performance.now() < until) {}
    }
    return stat;
  });
  const spawn = vi.spyOn(childProcess, 'spawn'); syncBuiltinESMExports();
  try {
    await expect(runtime.authorize()).rejects.toMatchObject({ code: 'timeout' });
    await runtime.settled();
    expect(delayed).toBe(true);
    for (const factory of [helper, spawn, oauth]) expect(factory).not.toHaveBeenCalled();
    expect(controller).toHaveBeenCalledTimes(1);
  } finally {
    statSpy.mockRestore(); spawn.mockRestore(); syncBuiltinESMExports();
    await runtime.settled(); await owner.close(); await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each([
  ['oauth', 'timeout'], ['oauth', 'cancel'],
  ['auth', 'timeout'], ['auth', 'cancel'],
  ['catalog', 'timeout'], ['catalog', 'cancel'],
] as const)('%s原阶段的%s贯穿Runtime ownedFetch最终proof，零本机TCP或HTTP请求', async (kind, reason) => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'fetch-preproof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const now = 1800000000000;
  const claims = { chatgpt_account_id: 'workspace', chatgpt_account_user_id: 'account-user', user_id: 'user' };
  const jwt = (value: object) => `e30.${Buffer.from(JSON.stringify(value)).toString('base64url')}.c2ln`;
  const managed = { codexHome: '/synthetic/codex', accountId: 'workspace', accountUserId: 'account-user', userId: 'user' };
  const auth = { ...managed, accessToken: jwt({ exp: now / 1000 + 3600, 'https://api.openai.com/auth': claims }) };
  const stepUp = jwt({ exp: now / 1000 + 300, iat: now / 1000, pwd_auth_time: now, scope: 'codex.remote_control.enroll', 'https://api.openai.com/auth': claims });
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const identity = { keyId: 'key', algorithm: 'ecdsa_p256_sha256' as const, protectionClass: 'hardware_secure_enclave' as const, publicKeySpkiDerBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const enrollment = { version: 1 as const, clientId: 'own-client', accountId: managed.accountId, accountUserId: 'user', managedAccountUserId: managed.accountUserId, identityHash: deviceIdentityHash(identity), identity };
  let tcp = 0; let requests = 0;
  const tokenServer = createServer((req, res) => { requests++; req.resume(); res.end('{}'); });
  tokenServer.on('connection', () => tcp++);
  await new Promise<void>(resolve => tokenServer.listen(0, '127.0.0.1', resolve));
  const nativeFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => fetch(`http://127.0.0.1:${(tokenServer.address() as { port: number }).port}/token`, init));
  const runtime = new RemoteRuntime({ store: owner.store, canonicalFactory: async () => { throw new Error('unused'); }, fetch: nativeFetch });
  const owned = (Reflect.get(runtime, 'options') as { fetch: typeof fetch }).fetch;
  let armed = false; let delayed = false;
  const fetcher: typeof fetch = (input, init) => { armed = true; return owned(input, init); };
  let listener: Server | undefined;
  const callbacks: Promise<void>[] = [];
  const oauth = new RemoteStepUpOAuth({ managedAuth: { load: async () => auth, currentIdentity: managed, verifyIdentity: async () => managed },
    assertOwnership: () => owner.assert(), now: () => now, timeoutMs: 2000, browserTimeoutMs: 500, exchangeTimeoutMs: 100, fetch: fetcher,
    bindListener: async server => { listener = server; await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); },
    openBrowser: async value => {
      const url = new URL(value);
      callbacks.push(new Promise(resolve => {
        const req = request({ host: '127.0.0.1', port: (listener!.address() as { port: number }).port,
          path: `/auth/callback?code=synthetic&state=${url.searchParams.get('state')}`, headers: { Host: new URL(url.searchParams.get('redirect_uri')!).host } }, res => { res.resume(); res.once('end', resolve); });
        req.once('error', () => resolve()); req.end();
      }));
    } });
  const provider = new RemoteAuthProviderImpl({ store: owner.store, deviceKey: { getIdentity: async () => identity, sign: async () => { throw new Error('unused'); } },
    loadManagedAuth: async () => auth, fetch: fetcher, now: () => now, requestTimeoutMs: 100 });
  const catalog = new RemoteCatalog({ loadManagedAuth: async () => auth, getEnrollment: async () => enrollment, fetch: fetcher, requestTimeoutMs: 100 });
  const abort = new AbortController();
  const original = fsSync.lstatSync;
  const spy = vi.spyOn(fsSync, 'lstatSync').mockImplementation((...args: Parameters<typeof original>) => {
    const stat = Reflect.apply(original, fsSync, args);
    if (armed && !delayed && String(args[0]) === root) {
      delayed = true;
      if (reason === 'cancel') {
        if (kind === 'oauth') abort.abort();
        else if (kind === 'catalog') catalog.close();
        else runtime.close();
      } else {
        const until = performance.now() + 250;
        while (performance.now() < until) {}
      }
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    // Provider没有独立close；取消通过真实Runtime父操作，不能另造预算。
    const lifecycle = Reflect.get(runtime, 'lifecycle') as RemoteRuntimeLifecycle;
    const pending = kind === 'oauth' ? oauth.authorize(abort.signal) : kind === 'catalog' ? catalog.refresh()
      : lifecycle.run(undefined, () => provider.enroll(stepUp));
    await expect(pending).rejects.toBeDefined();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(delayed).toBe(true);
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(tcp).toBe(0); expect(requests).toBe(0);
  } finally {
    spy.mockRestore(); syncBuiltinESMExports();
    oauth.close(); catalog.close(); await runtime.settled();
    await Promise.all(callbacks);
    tokenServer.closeAllConnections();
    await new Promise<void>(resolve => tokenServer.close(() => resolve()));
    await owner.close(); await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each([
  ['managed-auth', 'initial'], ['managed-auth', 'factory'], ['managed-auth', 'cancel'],
  ['controller', 'initial'], ['controller', 'factory'], ['controller', 'cancel'],
  ['login', 'initial'], ['login', 'factory'], ['login', 'cancel'],
] as const)('真实%s公开入口在%s归属proof跨期或取消，不调用canonical工厂', async (kind, point) => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'canonical-preproof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => wss.once('listening', resolve));
  let connections = 0;
  wss.on('connection', () => connections++);
  const canonicalFactory = vi.fn(() => RemoteRpcSession.connectCanonical(`ws://127.0.0.1:${(wss.address() as { port: number }).port}`, { connectTimeoutMs: 100 }));
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const identity = { keyId: 'key', algorithm: 'ecdsa_p256_sha256' as const, protectionClass: 'hardware_secure_enclave' as const, publicKeySpkiDerBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const enrollment = { version: 1 as const, clientId: 'own-client', accountId: 'workspace', accountUserId: 'user', managedAccountUserId: 'account-user', identityHash: deviceIdentityHash(identity), identity };
  const prepareConnection = vi.fn(async (): Promise<never> => { throw new Error('隔离测试不得建立Relay'); });
  const resource = kind === 'managed-auth'
    ? new ManagedAuthLoader({ canonicalFactory, assertOwnership: () => owner.assert(), operationTimeoutMs: 100,
      readAuthFile: async () => { throw new Error('隔离测试不得读取真实凭据'); } })
    : kind === 'login' ? new RemoteCanonicalLogin({ canonicalFactory, assertOwnership: () => owner.assert(), operationTimeoutMs: 100,
      timeoutMs: 2000, openBrowser: async () => { throw new Error('隔离测试不打开浏览器'); } })
    : new RemoteController({ store: owner.store, canonicalFactory, operationTimeoutMs: 100,
      managedAuth: { load: async () => ({ accessToken: 'synthetic', accountId: 'workspace', accountUserId: 'account-user', userId: 'user' }),
        verifyIdentity: async () => ({ codexHome: '/synthetic/codex', accountId: 'workspace', accountUserId: 'account-user', userId: 'user' }) },
      authProvider: { getEnrollment: async () => enrollment, verifyBinding: async () => enrollment, prepareConnection } });
  const resources = Reflect.get(resource, 'resources') as ResourceSettlement;
  const create = resources.create.bind(resources);
  let armed = false;
  let connecting = kind !== 'controller';
  const connector = resource as unknown as { connectCanonical(epoch: number): Promise<RemoteControllerCanonical> };
  const connect = resource instanceof RemoteController ? connector.connectCanonical.bind(resource) : undefined;
  const connectingSpy = connect ? vi.spyOn(connector, 'connectCanonical').mockImplementation(epoch => {
    connecting = true;
    return connect(epoch);
  }) : undefined;
  const creationSpy = vi.spyOn(resources, 'create').mockImplementation(<T>(factory: () => Promise<T>) => create(() => {
    armed = true;
    return factory();
  }));
  const original = fsSync.lstatSync;
  let delayed = false;
  const statSpy = vi.spyOn(fsSync, 'lstatSync').mockImplementation((...args: Parameters<typeof original>) => {
    const stat = Reflect.apply(original, fsSync, args);
    const selected = point === 'initial' ? connecting : armed;
    if (!delayed && selected && String(args[0]) === root) {
      delayed = true;
      if (point === 'cancel') void resource.close();
      else {
        const until = performance.now() + 250;
        while (performance.now() < until) {}
      }
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    const pending = resource instanceof ManagedAuthLoader ? resource.verifyIdentity() : resource instanceof RemoteCanonicalLogin ? resource.login() : resource.pairLocal();
    await expect(pending).rejects.toBeDefined();
    await resource.settled();
    expect(delayed).toBe(true);
    expect(canonicalFactory).not.toHaveBeenCalled();
    expect(prepareConnection).not.toHaveBeenCalled();
    expect(connections).toBe(0);
  } finally {
    statSpy.mockRestore(); creationSpy.mockRestore(); connectingSpy?.mockRestore();
    syncBuiltinESMExports();
    await resource.settled();
    await owner.close();
    for (const peer of wss.clients) peer.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['parent', 'phase', 'cancel'] as const)('Runtime同步归属proof跨%s边界后不调用业务回调', async kind => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'runtime-preproof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const runtime = new RemoteRuntime({ store: owner.store, canonicalUrl: 'ws://127.0.0.1:1', operationTimeoutMs: kind === 'parent' ? 20 : 1000 });
  const lifecycle = Reflect.get(runtime, 'lifecycle') as RemoteRuntimeLifecycle;
  const wait = Reflect.get(runtime, 'wait') as (op: RemoteRuntimeOperation, callback: () => Promise<string>, limit: number) => Promise<string>;
  const abort = new AbortController();
  const callback = vi.fn(async () => 'must-not-deliver');
  const original = fsSync.lstatSync;
  let delayed = false;
  const spy = vi.spyOn(fsSync, 'lstatSync').mockImplementation((...args: Parameters<typeof original>) => {
    const stat = Reflect.apply(original, fsSync, args);
    if (!delayed && String(args[0]) === root) {
      delayed = true;
      if (kind === 'cancel') abort.abort();
      else {
        const until = performance.now() + 80;
        while (performance.now() < until) {}
      }
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    await expect(lifecycle.run(abort.signal, op => wait.call(runtime, op, callback, kind === 'phase' ? 20 : 1000)))
      .rejects.toMatchObject({ code: kind === 'cancel' ? 'cancelled' : 'timeout' });
    expect(delayed).toBe(true);
    expect(callback).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    await runtime.settled();
    await owner.close();
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['timeout', 'cancel'] as const)('真实Runtime.login归属proof中%s，不创建canonical、Relay或子进程', async kind => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'runtime-login-preproof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => wss.once('listening', resolve));
  let connections = 0;
  wss.on('connection', () => connections++);
  const canonicalFactory = vi.fn(() => RemoteRpcSession.connectCanonical(`ws://127.0.0.1:${(wss.address() as { port: number }).port}`, { connectTimeoutMs: 100 }));
  const createController = vi.fn(); const createDeviceKey = vi.fn(); const createOAuth = vi.fn();
  const openBrowser = vi.fn(async () => { throw new Error('隔离测试不打开浏览器'); });
  const abort = new AbortController();
  const runtime = new RemoteRuntime({ store: owner.store, canonicalFactory, operationTimeoutMs: 1000,
    interactionTimeoutMs: kind === 'timeout' ? 100 : 1000, cleanupTimeoutMs: 20,
    createController, createDeviceKey, createOAuth, loginOptions: { openBrowser } });
  const original = fsSync.lstatSync;
  let delayed = false;
  const statSpy = vi.spyOn(fsSync, 'lstatSync').mockImplementation((...args: Parameters<typeof original>) => {
    const stat = Reflect.apply(original, fsSync, args);
    if (!delayed && String(args[0]) === root && Reflect.get(runtime, 'loginFlow')) {
      delayed = true;
      if (kind === 'cancel') abort.abort();
      else {
        const until = performance.now() + 250;
        while (performance.now() < until) {}
      }
    }
    return stat;
  });
  const spawn = vi.spyOn(childProcess, 'spawn');
  const execFile = vi.spyOn(childProcess, 'execFile');
  syncBuiltinESMExports();
  try {
    await expect(runtime.login(abort.signal)).rejects.toMatchObject({ code: kind === 'cancel' ? 'cancelled' : 'timeout' });
    await runtime.settled();
    expect(delayed).toBe(true);
    for (const factory of [canonicalFactory, createController, createDeviceKey, createOAuth, openBrowser, spawn, execFile])
      expect(factory).not.toHaveBeenCalled();
    expect(connections).toBe(0);
  } finally {
    statSpy.mockRestore(); spawn.mockRestore(); execFile.mockRestore();
    syncBuiltinESMExports();
    await runtime.settled();
    await owner.close();
    for (const peer of wss.clients) peer.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['managed-auth', 'controller'] as const)('%s最终同步真实root证明跨期限，不交付外部操作的晚结果', async kind => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'resource-final-proof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const resource = kind === 'managed-auth'
    ? new ManagedAuthLoader({ canonicalFactory: async () => ({} as any), operationTimeoutMs: 20, assertOwnership: () => owner.assert() })
    : new RemoteController({ store: owner.store, canonicalUrl: 'ws://127.0.0.1:1', managedAuth: {} as any, authProvider: {} as any, operationTimeoutMs: 20 });
  const original = fsSync.lstatSync;
  let returned = false;
  let delayed = false;
  const spy = vi.spyOn(fsSync, 'lstatSync').mockImplementation((...args: Parameters<typeof original>) => {
    const stat = Reflect.apply(original, fsSync, args);
    if (returned && !delayed && String(args[0]) === root) {
      delayed = true;
      const until = performance.now() + 80;
      while (performance.now() < until) {}
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    const operation = async () => { returned = true; return 'late-result'; };
    const pending = kind === 'managed-auth'
      ? (resource as any).external(operation, true)
      : (resource as any).external((resource as any).epoch, operation);
    const result = await pending.then(() => 'delivered', () => 'rejected');
    expect(delayed).toBe(true);
    expect(result).toBe('rejected');
  } finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    await resource.settled();
    await owner.close();
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['timeout', 'cancel'] as const)('owner最终同步真实root证明期间%s，不交付归属且实际settled释放锁', async reason => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-final-proof-'));
  const store = new PrivateStore(root);
  const abort = new AbortController();
  const initialize = store.withGatewayOwnership.bind(store);
  let ready = false;
  let delayed = false;
  let owner: Awaited<ReturnType<typeof acquireRemoteOwner>> | undefined;
  const initializeSpy = vi.spyOn(store, 'withGatewayOwnership').mockImplementation((operation, options) =>
    initialize(proof => { ready = true; return operation(proof); }, options));
  const original = fsSync.lstatSync;
  const statSpy = vi.spyOn(fsSync, 'lstatSync').mockImplementation((...args: Parameters<typeof original>) => {
    const stat = Reflect.apply(original, fsSync, args);
    if (ready && !delayed && String(args[0]) === root) {
      delayed = true;
      if (reason === 'cancel') abort.abort();
      else {
        const until = performance.now() + 250;
        while (performance.now() < until) {}
      }
    }
    return stat;
  });
  syncBuiltinESMExports();
  const pending = acquireRemoteOwner(store, { timeoutMs: reason === 'timeout' ? 100 : 1000, signal: abort.signal });
  try {
    const result = await pending.then(value => { owner = value; return 'acquired'; }, () => 'rejected');
    expect(delayed).toBe(true);
    expect(result).toBe('rejected');
    await pending.settled();
    expect(await fs.readdir(root)).toEqual([]);
  } finally {
    statSpy.mockRestore();
    initializeSpy.mockRestore();
    syncBuiltinESMExports();
    await owner?.close();
    await pending.settled();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('归属清理末次锁检查await期间替换root，不删除新root中的空锁目录', async () => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-cleanup-proof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const lock = join(root, '.init-gateway-owner.lock');
  const original = fs.lstat;
  let changed = false;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof original>) => {
    const stat = await Reflect.apply(original, fs, args);
    if (String(args[0]) === lock && !changed && (await fs.readdir(lock)).length === 0) {
      changed = true;
      await fs.rename(root, `${root}-moved`);
      await fs.mkdir(root, { mode: 0o700 });
      await fs.mkdir(lock, { mode: 0o700 });
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    await expect(owner.close()).rejects.toBeDefined();
    expect(changed).toBe(true);
    expect(await fs.readdir(root)).toEqual(['.init-gateway-owner.lock']);
    expect(await fs.readdir(lock)).toEqual([]);
    expect(owner.signal.aborted).toBe(true);
  } finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it('Runtime正常收尾解除自己的归属监听器，同一owner可再次创建Runtime', async () => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-listener-proof-'));
  const owner = await acquireRemoteOwner(new PrivateStore(join(parent, 'r')));
  try {
    for (let iteration = 0; iteration < 2; iteration++) {
      const runtime = new RemoteRuntime({ store: owner.store, canonicalUrl: 'ws://127.0.0.1:1' });
      await runtime.start();
      expect(getEventListeners(owner.signal, 'abort')).toHaveLength(1);
      await runtime.settled();
      expect(getEventListeners(owner.signal, 'abort')).toHaveLength(0);
    }
  }
  finally {
    await owner.close();
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['root', 'ancestor'] as const)('首次异步FS返回前替换%s也不能重建或chmod后来目录', async (kind) => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-first-proof-'));
  const ancestor = join(parent, 'a');
  const root = join(ancestor, 'r');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const original = fs.lstat;
  let changed = false;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof original>) => {
    const stat = await Reflect.apply(original, fs, args);
    if (String(args[0]) === (kind === 'root' ? root : ancestor) && !changed) {
      changed = true;
      await fs.rename(kind === 'root' ? root : ancestor, `${kind === 'root' ? root : ancestor}-moved`);
      await fs.mkdir(root, { recursive: true, mode: 0o755 });
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    const pending = acquireRemoteOwner(new PrivateStore(root));
    await expect(pending).rejects.toBeDefined();
    await pending.settled().catch(() => undefined);
    expect(changed).toBe(true);
    expect(await fs.readdir(root)).toEqual([]);
    expect((await original(root)).mode & 0o777).toBe(0o755);
  }
  finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it('原root移回原路径也不能恢复已失效归属；同PID/nonce的owner替换inode仍拒绝', async () => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-permanent-proof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const lock = join(root, '.init-gateway-owner.lock');
  const name = (await fs.readdir(lock))[0]!;
  const contents = await fs.readFile(join(lock, name), 'utf8');
  try {
    await fs.rename(join(lock, name), join(parent, 'old-owner'));
    await fs.writeFile(join(lock, name), contents, { mode: 0o600 });
    expect(() => owner.assert()).toThrow();
    expect(owner.signal.aborted).toBe(true);
    await fs.rm(join(lock, name));
    await fs.rename(join(parent, 'old-owner'), join(lock, name));
    await expect(owner.store.writeJson('must-not-write.json', {})).rejects.toBeDefined();
    expect(() => owner.assert()).toThrow();
    expect(await fs.readFile(join(lock, name), 'utf8')).toBe(contents);
    expect(await fs.readdir(root)).toEqual(['.init-gateway-owner.lock']);
  }
  finally {
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['root', 'ancestor'] as const)('Runtime读取指针await期间替换%s：不交付结果、不创建canonical，可信settled完成', async (kind) => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-runtime-await-'));
  const ancestor = join(parent, 'a');
  const root = join(ancestor, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  let entered!: () => void;
  const started = new Promise<void>(resolve => entered = resolve);
  let release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  const factory = vi.fn();
  const runtime = new RemoteRuntime({ store: owner.store, canonicalFactory: factory, registry: { readActive: async () => {
        entered();
        await gate;
        return null;
      } } as any });
  try {
    const pending = runtime.start().then(() => 'delivered', () => 'rejected');
    await started;
    const target = kind === 'root' ? root : ancestor;
    await fs.rename(target, `${target}-moved`);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    release();
    expect(await pending).toBe('rejected');
    await runtime.settled();
    expect(runtime.status().state).toBe('closed');
    expect(factory).not.toHaveBeenCalled();
    expect(await fs.readdir(root)).toEqual([]);
  }
  finally {
    release();
    await runtime.settled();
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['root', 'ancestor'] as const)('Registry克隆与generation子store保留同一%s归属，不能写入替换目录', async (kind) => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-registry-proof-'));
  const ancestor = join(parent, 'a');
  const root = join(ancestor, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const registry = new RemoteIdentityRegistry(owner.store);
  const candidate = await registry.beginCandidate();
  try {
    const target = kind === 'root' ? root : ancestor;
    await fs.rename(target, `${target}-moved`);
    await fs.mkdir(root, { recursive: true, mode: 0o755 });
    await expect(candidate.store.writeJson('must-not-write.json', {})).rejects.toBeDefined();
    await expect(registry.beginCandidate()).rejects.toBeDefined();
    expect(await fs.readdir(root)).toEqual([]);
    expect((await fs.lstat(root)).mode & 0o777).toBe(0o755);
  }
  finally {
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it('Registry generation mkdir await期间替换root，不在新目录继续提交candidate', async () => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-generation-proof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const registry = new RemoteIdentityRegistry(owner.store);
  const original = fs.mkdir;
  let changed = false;
  const spy = vi.spyOn(fs, 'mkdir').mockImplementation(async (...args: Parameters<typeof original>) => {
    const value = await Reflect.apply(original, fs, args);
    if (String(args[0]).startsWith(join(root, 'identity-')) && !changed) {
      changed = true;
      await fs.rename(root, `${root}-moved`);
      await Reflect.apply(original, fs, [root, { mode: 0o700 }]);
    }
    return value;
  });
  syncBuiltinESMExports();
  try {
    await expect(registry.beginCandidate()).rejects.toBeDefined();
    expect(changed).toBe(true);
    expect(await fs.readdir(root)).toEqual([]);
  }
  finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it('Relay等待认证期间root被替换，晚认证结果不得再建立物理连接', async () => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-relay-proof-'));
  const root = join(parent, 'r');
  const owner = await acquireRemoteOwner(new PrivateStore(root));
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => wss.once('listening', resolve));
  let connections = 0;
  wss.on('connection', () => connections++);
  let release!: (value: any) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => entered = resolve);
  const relay = new RemoteRelay({ clientId: 'synthetic-client', assertOwnership: () => owner.assert(), authProvider: { prepareConnection: () => {
        entered();
        return new Promise(resolve => release = resolve);
      } } } as any);
  try {
    await started;
    await fs.rename(root, `${root}-moved`);
    await fs.mkdir(root, { mode: 0o700 });
    release({ url: `ws://127.0.0.1:${(wss.address() as any).port}`, headers: {}, signChallenge: async () => ({}) });
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(connections).toBe(0);
    expect(relay.state).toBe('closed');
    expect(owner.signal.aborted).toBe(true);
  }
  finally {
    await relay.settled();
    for (const peer of wss.clients)
      peer.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['root', 'ancestor'] as const)('取得归属的root fsync返回前替换%s：不得交付错位归属或污染新目录', async (kind) => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-proof-'));
  const ancestor = join(parent, 'a');
  const root = join(ancestor, 'r');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const target = kind === 'root' ? root : ancestor;
  const original = fs.open;
  let changed = false;
  const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof original>) => {
    const handle = await Reflect.apply(original, fs, args);
    if (String(args[0]) === root && !changed) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        await sync();
        if (!changed) {
          changed = true;
          await fs.rename(target, `${target}-moved`);
          await fs.mkdir(root, { recursive: true, mode: 0o700 });
        }
      };
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    const pending = acquireRemoteOwner(new PrivateStore(root));
    const result = await pending.then(async (owner) => {
      await owner.close().catch(() => undefined);
      return 'acquired';
    }, () => 'rejected');
    await pending.settled().catch(() => undefined);
    expect(changed).toBe(true);
    expect(result).toBe('rejected');
    expect(await fs.readdir(root)).toEqual([]);
  }
  finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it.each(['store', 'runtime', 'admin'] as const)('已交付归属后替换root：%s不得采用新目录', async (kind) => {
  const parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'owner-proof-live-'));
  const root = join(parent, 'r');
  const originalStore = new PrivateStore(root);
  const owner = await acquireRemoteOwner(originalStore);
  const store = (owner as any).store ?? originalStore;
  let runtime: RemoteRuntime | undefined;
  let publication: ReturnType<typeof publishRemoteAdmin> | undefined;
  try {
    await fs.rename(root, `${root}-moved`);
    await fs.mkdir(root, { mode: 0o700 });
    if (kind === 'store')
      await expect(store.writeJson('must-not-write.json', {})).rejects.toBeDefined();
    if (kind === 'runtime') {
      runtime = new RemoteRuntime({ store, canonicalUrl: 'ws://127.0.0.1:1' });
      const status = await runtime.start().catch(() => runtime!.status());
      expect(['closed', 'fault']).toContain(status.state);
    }
    if (kind === 'admin') {
      publication = publishRemoteAdmin({ directory: root, owner, runtime: { queryStatus: async () => ({ state: 'unconfigured' }) } as any, access: () => ({ host: 'localhost', port: 1, token: 'x' }) } as any);
      const result = await publication.then(async (server) => {
        await server.settled();
        return 'published';
      }, () => 'rejected');
      expect(result).toBe('rejected');
    }
    expect(await fs.readdir(root)).toEqual([]);
  }
  finally {
    await publication?.settled().catch(() => undefined);
    await runtime?.settled();
    await owner.close().catch(() => undefined);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

it('独立复现：owner 首个 FS 挂起受 timeoutMs 约束', async () => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'spec-owner-'));
  const original = fs.lstat;
  let release!: () => void;
  let entered = false;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof original>) => {
    if (String(args[0]) === root && !entered) {
      entered = true;
      await new Promise<void>(resolve => release = resolve);
    }
    return Reflect.apply(original, fs, args);
  });
  syncBuiltinESMExports();
  try {
    const operation = acquireRemoteOwner(new PrivateStore(root), { timeoutMs: 20 });
    const result = await Promise.race([operation.then(() => 'acquired', () => 'rejected'), new Promise<string>(resolve => setTimeout(() => resolve('still-pending-after-100ms'), 100))]);
    release();
    const late = await operation.catch(() => undefined);
    await late?.close();
    await operation.settled().catch(() => undefined);
    expect(await fs.readdir(root)).not.toContain('.init-gateway-owner.lock');
    expect(result).toBe('rejected');
  } finally {
    spy.mockRestore(); syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('独立复现：owner 首个 FS 同步跨期限不应晚成功', async () => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'spec-owner-sync-'));
  const original = fs.lstat;
  let entered = false;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof original>) => {
    if (String(args[0]) === root && !entered) {
      entered = true;
      const deadline = performance.now() + 80;
      while (performance.now() < deadline) {}
    }
    return Reflect.apply(original, fs, args);
  });
  syncBuiltinESMExports();
  try {
    const began = performance.now();
    const operation = acquireRemoteOwner(new PrivateStore(root), { timeoutMs: 20 });
    const result = await operation.then(async owner => {
      await owner.close();
      return 'acquired';
    }, () => 'rejected');
    await operation.settled().catch(() => undefined);
    expect(await fs.readdir(root)).not.toContain('.init-gateway-owner.lock');
    expect(performance.now() - began).toBeGreaterThanOrEqual(20);
    expect(result).toBe('rejected');
  } finally {
    spy.mockRestore(); syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('独立复现：close 的 inode 检查后替换公开 socket 不应删除替换物', async () => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'spec-unlink-'));
  await fs.chmod(root, 0o700);
  const admin = await publishRemoteAdmin({ directory: root, runtime: { queryStatus: async () => ({ state: 'unconfigured' }) } as any, access: () => ({ host: 'localhost', port: 1, token: 'x' }) });
  const socketPath = join(root, 'admin.sock');
  const original = fs.lstat;
  let replaced = false;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof original>) => {
    const stat = await Reflect.apply(original, fs, args);
    if (String(args[0]) === socketPath && !replaced) {
      replaced = true;
      await fs.rename(socketPath, join(root, 'old.sock'));
      await fs.writeFile(socketPath, 'must-remain', { mode: 0o600 });
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    await admin.settled();
    expect(replaced).toBe(true);
    const quarantine = (await fs.readdir(root)).filter(name => name.startsWith('.cleanup-'));
    expect(quarantine).toHaveLength(1);
    expect(await fs.readFile(join(root, quarantine[0]!, 'entry'), 'utf8')).toBe('must-remain');
  } finally {
    spy.mockRestore(); syncBuiltinESMExports();
    await admin.settled();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('独立复现：Runtime settled 等待真实 Relay 的 WebSocket close', async () => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'spec-relay-'));
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => wss.once('listening', resolve));
  let peer: any;
  wss.on('connection', socket => {
    peer = socket;
    socket.send(JSON.stringify({ type: 'device_key_challenge', nonce: 'synthetic' }));
  });
  const relay = new RemoteRelay({ clientId: 'synthetic-client', authProvider: { prepareConnection: async () => ({ url: `ws://127.0.0.1:${(wss.address() as any).port}`, headers: {}, signChallenge: async () => ({ signature: 'synthetic' }) }) } });
  const deadline = performance.now() + 2000;
  while (relay.state !== 'online') {
    if (performance.now() > deadline) throw new Error('local relay startup timeout');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  const socket = (relay as any).socket;
  let actualClose = false;
  socket.once('close', () => actualClose = true);
  const store = new PrivateStore(root);
  const controller = new RemoteController({ store, canonicalUrl: 'ws://127.0.0.1:1', managedAuth: {} as any, authProvider: {} as any });
  (controller as any).relay = relay;
  const runtime = new RemoteRuntime({ store, canonicalUrl: 'ws://127.0.0.1:1' });
  (runtime as any).bundle = { controller, loader: { close() {} }, oauth: { close() {} } };
  try {
    await runtime.settled();
    expect(socket.readyState).toBe(3);
    expect(actualClose).toBe(true);
  } finally {
    await runtime.settled();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('捕获socket替换物时后来又出现新公开路径，保留两者且不覆盖新文件', async () => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'spec-capture-'));
  const admin = await publishRemoteAdmin({ directory: root, runtime: {} as any, access: () => ({ host: 'localhost', port: 1, token: 'x' }) });
  const path = join(root, 'admin.sock'); const originalStat=fs.lstat;const originalRename=fs.rename;
  let replaced=false;let later=false;let capturedIdentity:any;
  const statSpy=vi.spyOn(fs,'lstat').mockImplementation((async (...args:Parameters<typeof originalStat>)=>{
    const stat=await Reflect.apply(originalStat,fs,args);
    if(String(args[0])===path&&!replaced){replaced=true;await originalRename(path,join(root,'old.sock'));await fs.writeFile(path,'first-replacement',{mode:0o600});capturedIdentity=await originalStat(path);}
    return stat;
  }) as typeof fs.lstat);
  const renameSpy=vi.spyOn(fs,'rename').mockImplementation((async (from:any,to:any)=>{
    await originalRename(from,to);
    if(String(from)===path&&String(to).includes('.cleanup-')&&!later){later=true;await fs.writeFile(path,'later-replacement',{mode:0o600});}
  }) as typeof fs.rename);syncBuiltinESMExports();
  try {
    await admin.settled();expect(later).toBe(true);expect(await fs.readFile(path,'utf8')).toBe('later-replacement');
    const captures=(await fs.readdir(root)).filter(name=>name.startsWith('.cleanup-'));expect(captures).toHaveLength(1);const held=join(root,captures[0]!,'entry');const stat=await originalStat(held);
    expect([stat.dev,stat.ino]).toEqual([capturedIdentity.dev,capturedIdentity.ino]);expect(await fs.readFile(held,'utf8')).toBe('first-replacement');
  } finally {statSpy.mockRestore();renameSpy.mockRestore();syncBuiltinESMExports();await admin.settled();await fs.rm(root,{recursive:true,force:true});}
});

it.each([false,true])('已摘除的真实Relay连接仍阻止Runtime settled（storage失败=%s）；原bounded close保持有界', async failedStorage => {
  const root=await fs.mkdtemp(join(await fs.realpath(tmpdir()),'retired-relay-'));
  const wss=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise<void>(resolve=>wss.once('listening',resolve));
  wss.on('connection',socket=>socket.send(JSON.stringify({type:'device_key_challenge',nonce:'synthetic'})));
  const relay=new RemoteRelay({clientId:'synthetic',authProvider:{prepareConnection:async()=>({url:`ws://127.0.0.1:${(wss.address() as any).port}`,headers:{},signChallenge:async()=>({signature:'synthetic'})})}});
  const deadline=performance.now()+2000;while(relay.state!=='online'){if(performance.now()>deadline)throw new Error('local relay timeout');await new Promise(resolve=>setTimeout(resolve,2));}
  const socket=(relay as any).socket;const native=socket._socket;const destroy=native.destroy.bind(native);const spy=vi.spyOn(native,'destroy').mockImplementation(()=>native);
  const store=new PrivateStore(root);const controller=new RemoteController({store,canonicalUrl:'ws://127.0.0.1:1',managedAuth:{} as any,authProvider:{} as any});(controller as any).relay=relay;
  const runtime=new RemoteRuntime({store,canonicalUrl:'ws://127.0.0.1:1',cleanupTimeoutMs:10});(runtime as any).bundle={controller,loader:{close(){}},oauth:{close(){}}};
  if (failedStorage) {
    await fs.writeFile(join(root,'victim'),'must-remain'); await fs.symlink(join(root,'victim'),join(root,'blocked.json'));
    const failed=store.writeJson('blocked.json',{});void failed.catch(()=>undefined);(controller as any).storage=failed;
  }
  let finished=false;
  try {
    (controller as any).suspend('auth-required');expect((controller as any).relay).toBeUndefined();
    const began=performance.now();await runtime.close();expect(performance.now()-began).toBeLessThan(500);
    const actual=runtime.settled().then(()=>finished=true);await new Promise(resolve=>setTimeout(resolve,25));expect(finished).toBe(false);expect(socket.readyState).toBe(2);
    spy.mockRestore();destroy();await actual;expect(socket.readyState).toBe(3);
  } finally {spy.mockRestore();destroy();await runtime.settled();for(const peer of wss.clients)peer.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await fs.rm(root,{recursive:true,force:true});}
});

it('取得归属前已取消不执行FS，也不遗留未处理的ready拒绝', async () => {
  const root=await fs.mkdtemp(join(await fs.realpath(tmpdir()),'cancel-owner-'));const path=join(root,'absent');const abort=new AbortController();abort.abort();
  const operation=acquireRemoteOwner(new PrivateStore(path),{signal:abort.signal});
  try {await expect(operation).rejects.toMatchObject({code:'cancelled'});await operation.settled();await expect(fs.lstat(path)).rejects.toMatchObject({code:'ENOENT'});await new Promise(resolve=>setImmediate(resolve));}
  finally {await fs.rm(root,{recursive:true,force:true});}
});
