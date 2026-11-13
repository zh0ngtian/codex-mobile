// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceIdentityHash, type EnrollmentRecord } from '../../server/remote/auth-protocol.js';
import type { RemoteControllerBinding } from '../../server/remote/controller.js';
import { RemoteIdentityRegistry, RemoteIdentityRegistryError, type RemoteIdentityCandidate } from '../../server/remote/identity-registry.js';
import { PrivateStore } from '../../server/remote/private-store.js';

const roots: string[] = []; const workers: ChildProcess[] = [];
const local = { environmentId: 'local-env', installationId: 'local-install' };
const managed = { codexHome: '/synthetic/codex', accountId: 'workspace', accountUserId: 'account-user', userId: 'user' };
const publicKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'remote-registry-test-')); roots.push(root);
  const store = new PrivateStore(join(root, 'private')); return { root, store, registry: new RemoteIdentityRegistry(store) };
}
async function prepare(candidate: RemoteIdentityCandidate, change: Partial<RemoteControllerBinding> = {}) {
  const identity = { keyId: `key-${candidate.generation}`, algorithm: 'ecdsa_p256_sha256' as const, protectionClass: 'hardware_secure_enclave' as const, publicKeySpkiDerBase64: publicKey };
  const enrollment: EnrollmentRecord = { version: 1, clientId: `client-${candidate.generation}`, accountId: managed.accountId, accountUserId: managed.userId, managedAccountUserId: managed.accountUserId, identityHash: deviceIdentityHash(identity), identity };
  const { version: _version, identity: _identity, ...own } = enrollment;
  const binding: RemoteControllerBinding = { version: 1, managed: { ...managed }, enrollment: own, local: { ...local }, targets: [{ ...local }], ...change };
  await candidate.store.createJson('device-key.json', { keyId: identity.keyId, sealedKeyBase64: Buffer.from('synthetic-sealed-key').toString('base64') });
  await candidate.store.createJson('enrollment.json', enrollment);
  await candidate.store.createJson('controller-binding.json', binding);
  return binding;
}
afterEach(async () => {
  await Promise.all(workers.splice(0).map(child => new Promise<void>(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    child.once('exit', () => resolve()); child.kill('SIGKILL');
  })));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

// 独立 OS 进程只使用临时目录和合成公钥；IPC 屏障让两份候选确定共用同一 base。
function worker(directory: string, mode = 'compete') {
  const source = `
    import { PrivateStore } from ${JSON.stringify(pathToFileURL(resolve('server/remote/private-store.ts')).href)};
    import { RemoteIdentityRegistry } from ${JSON.stringify(pathToFileURL(resolve('server/remote/identity-registry.ts')).href)};
    import { deviceIdentityHash } from ${JSON.stringify(pathToFileURL(resolve('server/remote/auth-protocol.ts')).href)};
    import { readFile } from 'node:fs/promises';
    import { join } from 'node:path';
    const registry = new RemoteIdentityRegistry(new PrivateStore(process.argv[1])); const store = registry.store;
    let start; const started = new Promise(resolve => { start = resolve; });
    process.on('message', message => { if (message === 'start') start(); });
    const send = value => process.send(value);
    try {
      const candidate = await registry.beginCandidate();
      const identity = { keyId: 'key-' + candidate.generation, algorithm: 'ecdsa_p256_sha256', protectionClass: 'hardware_secure_enclave', publicKeySpkiDerBase64: ${JSON.stringify(publicKey)} };
      const enrollment = { version: 1, clientId: 'client-' + candidate.generation, accountId: 'workspace', accountUserId: 'user', managedAccountUserId: 'account-user', identityHash: deviceIdentityHash(identity), identity };
      const {version, identity: ignored, ...own} = enrollment;
      const binding = { version: 1, managed: ${JSON.stringify(managed)}, enrollment: own, local: ${JSON.stringify(local)}, targets: [${JSON.stringify(local)}] };
      await candidate.store.createJson('device-key.json', { keyId: identity.keyId, sealedKeyBase64: 'c3ludGhldGlj' });
      await candidate.store.createJson('enrollment.json', enrollment); await candidate.store.createJson('controller-binding.json', binding);
      if (${JSON.stringify(mode)} === 'before-write') {
        const write = store.writeJson.bind(store); store.writeJson = async (name, value) => {
          if (name === 'active-identity.json') { send({ event: 'entered' }); await new Promise(() => {}); }
          return write(name, value);
        };
      }
      if (${JSON.stringify(mode)} === 'after-rename') {
        const sync = store.syncDirectory.bind(store); store.syncDirectory = async path => {
          if ((path ?? store.directory) === store.directory) {
            const actual = await readFile(join(store.directory, 'active-identity.json'), 'utf8').then(value => JSON.parse(value).generation, () => null);
            if (actual === candidate.generation) { send({ event: 'entered', generation: candidate.generation }); await new Promise(() => {}); }
          }
          return sync(path);
        };
      }
      send({ event: 'ready', generation: candidate.generation }); await started;
      const result = await registry.activate(candidate, binding); send({ event: 'result', ok: true, generation: result.generation });
    } catch (error) { send({ event: 'result', ok: false, code: error.code }); }
    finally { process.disconnect(); }
  `;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source, directory], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); workers.push(child);
  const events: Array<{ event: string; ok?: boolean; code?: string; generation?: string }> = []; const wake = new Set<() => void>();
  let exited = false; child.on('exit', () => { exited = true; for (const callback of wake) callback(); });
  child.on('message', message => { events.push(message as typeof events[number]); for (const callback of wake) callback(); });
  const wait = (event: string) => new Promise<typeof events[number]>((resolve, reject) => {
    const timer = setTimeout(() => { wake.delete(check); reject(new Error('子进程等待超时')); }, 5000);
    const check = () => { const found = events.find(value => value.event === event); if (found) { clearTimeout(timer); wake.delete(check); resolve(found); } else if (exited || events.some(value => value.event === 'result' && value.ok === false)) { clearTimeout(timer); wake.delete(check); reject(new Error('子进程提前退出')); } };
    wake.add(check); check();
  });
  return { child, events, wait };
}
async function kill(child: ChildProcess) { const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill('SIGKILL'); await exited; }

describe('Remote 私有候选身份 registry', () => {
  it('首次显式尝试产生独立随机候选，读取绝不采用未提交候选', async () => {
    const f = await fixture(); expect(await f.registry.readActive()).toBeNull();
    const a = await f.registry.beginCandidate(); const b = await f.registry.beginCandidate();
    expect(a.generation).toMatch(/^identity-[a-f0-9-]{36}$/); expect(a.generation).not.toBe(b.generation);
    expect(a.store.directory).toBe(join(f.store.directory, a.generation)); expect(a.expectedActive).toBeNull();
    await prepare(a); await prepare(b); expect(await f.registry.readActive()).toBeNull();
    expect(await f.store.readJson('enrollment.json')).toBeNull();
    expect((await lstat(a.store.directory)).mode & 0o777).toBe(0o700);
    for (const file of ['candidate.json', 'device-key.json', 'enrollment.json', 'controller-binding.json']) expect((await lstat(join(a.store.directory, file))).mode & 0o777).toBe(0o600);
  });
  it('完整准备后只切换原子指针，新实例恢复精确代际并保留旧身份', async () => {
    const f = await fixture(); const first = await f.registry.beginCandidate(); const firstBinding = await prepare(first);
    const one = await f.registry.activate(first, firstBinding);
    expect(one).toEqual({ version: 1, revision: 1, generation: first.generation, managed, enrollment: firstBinding.enrollment, local });
    const second = await f.registry.beginCandidate(); expect(second.expectedActive).toEqual(one); const secondBinding = await prepare(second);
    const two = await f.registry.activate(second, secondBinding); expect(two.revision).toBe(2);
    const restored = await new RemoteIdentityRegistry(new PrivateStore(f.store.directory)).readActive();
    expect(restored?.snapshot).toEqual(two); expect(restored?.store.directory).toBe(second.store.directory);
    expect(await first.store.readJson('enrollment.json')).toMatchObject({ clientId: firstBinding.enrollment.clientId });
    expect(await readFile(join(f.store.directory, 'active-identity.json'), 'utf8')).not.toContain('sealedKeyBase64');
  });
  it('未准备或缺任何关键文件均拒绝激活且没有活动指针', async () => {
    const f = await fixture(); const candidate = await f.registry.beginCandidate();
    await expect(f.registry.activate(candidate, {} as RemoteControllerBinding)).rejects.toMatchObject({ code: 'candidate-unprepared' });
    const binding = await prepare(candidate);
    for (const file of ['device-key.json', 'enrollment.json', 'controller-binding.json']) {
      const bytes = await readFile(join(candidate.store.directory, file)); await rm(join(candidate.store.directory, file));
      await expect(f.registry.activate(candidate, binding)).rejects.toMatchObject({ code: 'candidate-unprepared' });
      await writeFile(join(candidate.store.directory, file), bytes, { mode: 0o600 });
    }
    expect(await f.registry.readActive()).toBeNull();
  });
  it.each(['codexHome', 'accountId', 'accountUserId', 'userId', 'userId-missing', 'environmentId', 'installationId'])('再授权禁止改变原完整身份字段 %s', async field => {
    const f = await fixture(); const original = await f.registry.beginCandidate(); await f.registry.activate(original, await prepare(original));
    const candidate = await f.registry.beginCandidate(); const nextManaged = { ...managed }; const nextLocal = { ...local };
    if (field === 'userId-missing') delete (nextManaged as Partial<typeof managed>).userId;
    else if (field === 'environmentId' || field === 'installationId') nextLocal[field] += '-changed';
    else nextManaged[field as keyof typeof managed] += '-changed';
    const binding = await prepare(candidate, { managed: nextManaged, local: nextLocal, targets: [nextLocal] });
    // 账号字段变更同时改变登记以保持候选内部合法，仍不能越过旧身份 CAS。
    if (['accountId', 'accountUserId', 'userId', 'userId-missing'].includes(field)) {
      const enrollment = await candidate.store.readJson('enrollment.json') as EnrollmentRecord;
      enrollment.accountId = nextManaged.accountId; enrollment.managedAccountUserId = nextManaged.accountUserId; enrollment.accountUserId = nextManaged.userId ?? nextManaged.accountUserId;
      await candidate.store.writeJson('enrollment.json', enrollment);
      binding.enrollment = { clientId: enrollment.clientId, accountId: enrollment.accountId, accountUserId: enrollment.accountUserId, managedAccountUserId: enrollment.managedAccountUserId, identityHash: enrollment.identityHash };
      await candidate.store.writeJson('controller-binding.json', binding);
    }
    await expect(f.registry.activate(candidate, binding)).rejects.toMatchObject({ code: 'identity-changed' });
    expect((await f.registry.readActive())?.snapshot.generation).toBe(original.generation);
  });
  it('显式本机重新关联只允许冻结的 next，沿用原登记且保留旧 local', async () => {
    const f = await fixture(); const old = await f.registry.beginCandidate(); const oldBinding = await prepare(old); await f.registry.activate(old, oldBinding);
    const next = { ...local, installationId: 'explicit-new-install' };
    const request = { reassociateLocal: { previous: { ...local }, next: { ...next } } };
    const candidate = await f.registry.beginCandidate(request); request.reassociateLocal.next.installationId = 'mutated';
    await candidate.store.createJson('device-key.json', await old.store.readJson('device-key.json'));
    await candidate.store.createJson('enrollment.json', await old.store.readJson('enrollment.json'));
    const binding = { ...oldBinding, local: next, targets: [next] }; await candidate.store.createJson('controller-binding.json', binding);
    const result = await f.registry.activate(candidate, binding); expect(result.local).toEqual(next); expect(result.enrollment).toEqual(oldBinding.enrollment);
    expect(await old.store.readJson('controller-binding.json')).toEqual(oldBinding);
    expect((await new RemoteIdentityRegistry(f.store).readActive())?.snapshot).toEqual(result);
  });
  it.each(['no-active', 'wrong-previous', 'same-next', 'illegal-next'])('显式本机重新关联拒绝无效意图 %s', async kind => {
    const f = await fixture(); if (kind !== 'no-active') { const old = await f.registry.beginCandidate(); await f.registry.activate(old, await prepare(old)); }
    const previous = kind === 'wrong-previous' ? { ...local, installationId: 'other' } : local;
    const next = kind === 'same-next' ? local : { ...local, installationId: kind === 'illegal-next' ? '' : 'new-install' };
    await expect(f.registry.beginCandidate({ reassociateLocal: { previous, next } })).rejects.toMatchObject({ code: 'candidate-invalid' });
  });
  it.each(['new-enrollment', 'wrong-next', 'managed-change', 'tampered-intent'])('显式本机重新关联拒绝越界准备 %s', async kind => {
    const f = await fixture(); const old = await f.registry.beginCandidate(); const oldBinding = await prepare(old); await f.registry.activate(old, oldBinding);
    const next = { ...local, installationId: 'new-install' }; const candidate = await f.registry.beginCandidate({ reassociateLocal: { previous: local, next } });
    let binding: RemoteControllerBinding;
    if (kind === 'new-enrollment') binding = await prepare(candidate, { local: next, targets: [next] });
    else {
      await candidate.store.createJson('device-key.json', await old.store.readJson('device-key.json'));
      await candidate.store.createJson('enrollment.json', await old.store.readJson('enrollment.json'));
      const actualLocal = kind === 'wrong-next' ? { ...next, installationId: 'unexpected' } : next;
      binding = { ...oldBinding, managed: kind === 'managed-change' ? { ...managed, codexHome: '/other/home' } : managed, local: actualLocal, targets: [actualLocal] };
      await candidate.store.createJson('controller-binding.json', binding);
    }
    if (kind === 'tampered-intent') { const raw = await candidate.store.readJson('candidate.json') as any; raw.intent.next = local; await candidate.store.writeJson('candidate.json', raw); }
    await expect(f.registry.activate(candidate, binding)).rejects.toMatchObject({ code: kind === 'tampered-intent' ? 'candidate-invalid' : 'identity-changed' });
    expect((await f.registry.readActive())?.snapshot.generation).toBe(old.generation);
  });
  it('同实例和跨实例共用 base 的候选最多一个成功，陈旧候选与旧身份不能重放', async () => {
    const f = await fixture(); const other = new RemoteIdentityRegistry(new PrivateStore(f.store.directory));
    const a = await f.registry.beginCandidate(); const b = await other.beginCandidate();
    const [ab, bb] = await Promise.all([prepare(a), prepare(b)]);
    const results = await Promise.allSettled([f.registry.activate(a, ab), other.activate(b, bb)]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(value => value.status === 'rejected') as PromiseRejectedResult; expect(rejected.reason).toMatchObject({ code: 'active-changed' });
    await expect(f.registry.activate(a, ab)).rejects.toMatchObject({ code: 'active-changed' });
    await expect(other.activate(b, bb)).rejects.toMatchObject({ code: 'active-changed' });
  });
  it('冻结返回对象且不信任伪造 handle、另一 registry 或改动 store 路径', async () => {
    const f = await fixture(); const candidate = await f.registry.beginCandidate(); const binding = await prepare(candidate);
    await expect(new RemoteIdentityRegistry(f.store).activate(candidate, binding)).rejects.toMatchObject({ code: 'candidate-invalid' });
    await expect(f.registry.activate({ ...candidate }, binding)).rejects.toMatchObject({ code: 'candidate-invalid' });
    const other = await fixture(); await expect(other.registry.activate(candidate, binding)).rejects.toMatchObject({ code: 'candidate-invalid' });
    Object.defineProperty(candidate.store, 'directory', { value: other.store.directory });
    const snapshot = await f.registry.activate(candidate, binding);
    expect(snapshot.generation).toBe(candidate.generation); expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.managed)).toBe(true);
    const next = await f.registry.beginCandidate(); expect(Object.isFrozen(next)).toBe(true); expect(Object.isFrozen(next.expectedActive?.managed)).toBe(true);
  });
  it.each(['base', 'generation', 'registry'])('候选持久记录遭混用 %s 时拒绝，不信任内存快照', async kind => {
    const f = await fixture(); const candidate = await f.registry.beginCandidate(); const binding = await prepare(candidate);
    const raw = await candidate.store.readJson('candidate.json') as Record<string, unknown>;
    if (kind === 'base') raw.expectedActive = { version: 1, revision: 99, generation: candidate.generation, managed, enrollment: binding.enrollment, local };
    if (kind === 'generation') raw.generation = 'identity-00000000-0000-4000-8000-000000000000';
    if (kind === 'registry') raw.registryId = '00000000-0000-4000-8000-000000000000';
    await candidate.store.writeJson('candidate.json', raw);
    await expect(f.registry.activate(candidate, binding)).rejects.toMatchObject({ code: 'candidate-invalid' }); expect(await f.registry.readActive()).toBeNull();
  });
  it.each(['enrollment', 'controller', 'key', 'proof', 'bad-target', 'extra-field'])('半记录或混合身份 %s 显式拒绝', async kind => {
    const f = await fixture(); const candidate = await f.registry.beginCandidate(); const binding = await prepare(candidate); let proof = binding;
    if (kind === 'enrollment') { const raw = await candidate.store.readJson('enrollment.json') as any; raw.clientId += '-other'; await candidate.store.writeJson('enrollment.json', raw); }
    if (kind === 'controller') await candidate.store.writeJson('controller-binding.json', { ...binding, local: { ...local, installationId: 'other-install' } });
    if (kind === 'key') await candidate.store.writeJson('device-key.json', { keyId: 'other-key', sealedKeyBase64: 'c3ludGhldGlj' });
    if (kind === 'proof') proof = { ...binding, enrollment: { ...binding.enrollment, clientId: 'other-client' } };
    if (kind === 'bad-target') await candidate.store.writeJson('controller-binding.json', { ...binding, targets: [local, local] });
    if (kind === 'extra-field') await candidate.store.writeJson('controller-binding.json', { ...binding, accessToken: 'synthetic-secret' });
    await expect(f.registry.activate(candidate, proof)).rejects.toMatchObject({ code: 'candidate-unprepared' }); expect(await f.registry.readActive()).toBeNull();
  });
  it.each(['enrollment.json', 'device-key.json', 'controller-binding.json', 'controller-pause.json'])('无指针旧根登记 %s 拒绝自动迁移或覆盖', async file => {
    const f = await fixture(); await f.store.writeJson(file, { secret: 'synthetic-old-record' });
    const before = await readFile(join(f.store.directory, file), 'utf8');
    await expect(f.registry.readActive()).rejects.toMatchObject({ code: 'legacy-root' });
    await expect(f.registry.beginCandidate()).rejects.toMatchObject({ code: 'legacy-root' });
    expect(await readFile(join(f.store.directory, file), 'utf8')).toBe(before);
  });
  it.each(['version', 'path', 'revision', 'missing-generation', 'missing-complete', 'missing-enrollment', 'invalid-json', 'unknown-field', 'registry'])('活动指针损坏 %s 不回退或扫描最新候选', async kind => {
    const f = await fixture(); const candidate = await f.registry.beginCandidate(); const binding = await prepare(candidate); await f.registry.activate(candidate, binding);
    const unused = await f.registry.beginCandidate(); await prepare(unused);
    const raw = await f.store.readJson('active-identity.json') as any;
    if (kind === 'version') raw.version = 2;
    if (kind === 'path') raw.generation = '../escape';
    if (kind === 'revision') raw.revision = 0;
    if (kind === 'missing-generation') raw.generation = 'identity-00000000-0000-4000-8000-000000000000';
    if (kind === 'registry') raw.registryId = '00000000-0000-4000-8000-000000000000';
    if (kind === 'unknown-field') raw.token = 'synthetic-secret';
    await f.store.writeJson('active-identity.json', raw);
    if (kind === 'missing-complete') await rm(join(candidate.store.directory, 'identity.json'));
    if (kind === 'missing-enrollment') await rm(join(candidate.store.directory, 'enrollment.json'));
    if (kind === 'invalid-json') await writeFile(join(f.store.directory, 'active-identity.json'), '{synthetic-secret', { mode: 0o600 });
    await expect(new RemoteIdentityRegistry(f.store).readActive()).rejects.toBeInstanceOf(RemoteIdentityRegistryError);
    await expect(f.registry.beginCandidate()).rejects.toBeInstanceOf(RemoteIdentityRegistryError);
    expect(await unused.store.readJson('enrollment.json')).not.toBeNull();
  });
  it('首份指针恰在缺失读取后提交时重读完整记录，不把并发提交误报为损坏', async () => {
    const f = await fixture(); const other = new RemoteIdentityRegistry(f.store); const candidate = await other.beginCandidate(); const binding = await prepare(candidate);
    const internal = (f.registry as unknown as { store: PrivateStore }).store; const read = internal.readJson.bind(internal); let submitted = false;
    internal.readJson = async name => {
      const value = await read(name);
      if (!submitted && name === 'active-identity.json' && value === null) { submitted = true; await other.activate(candidate, binding); }
      return value;
    };
    expect((await f.registry.readActive())?.snapshot.generation).toBe(candidate.generation);
  });
  it.each(['pointer', 'registry', 'candidate', 'complete'])('显式 JSON null 的 %s 记录不能作为未登记恢复', async kind => {
    const f = await fixture(); const candidate = await f.registry.beginCandidate(); await f.registry.activate(candidate, await prepare(candidate));
    const store = kind === 'pointer' || kind === 'registry' ? f.store : candidate.store;
    const file = kind === 'pointer' ? 'active-identity.json' : kind === 'registry' ? 'identity-registry.json' : kind === 'candidate' ? 'candidate.json' : 'identity.json';
    await store.writeJson(file, null); await expect(f.registry.readActive()).rejects.toBeInstanceOf(RemoteIdentityRegistryError);
  });
  it('未来显式新增目标合法更新 targets 后活动身份仍恢复同一 generation', async () => {
    const f = await fixture(); const candidate = await f.registry.beginCandidate(); const binding = await prepare(candidate); const active = await f.registry.activate(candidate, binding);
    await candidate.store.writeJson('controller-binding.json', { ...binding, targets: [...binding.targets, { environmentId: 'future-env', installationId: 'future-install' }] });
    expect((await f.registry.readActive())?.snapshot).toEqual(active);
  });
  it('generation 符号链接与关键记录硬链接均拒绝，错误不泄漏路径或原因', async () => {
    const f = await fixture(); const candidate = await f.registry.beginCandidate(); const binding = await prepare(candidate); await f.registry.activate(candidate, binding);
    await link(join(candidate.store.directory, 'enrollment.json'), join(f.root, 'outside-hardlink'));
    const error = await f.registry.readActive().catch(error => error);
    expect(error).toBeInstanceOf(RemoteIdentityRegistryError); expect(error.cause).toBeUndefined(); expect(error.message).not.toContain(f.root); expect(error.message).not.toContain('synthetic');
    await rm(join(f.root, 'outside-hardlink'));
    const saved = join(f.root, 'moved'); await import('node:fs/promises').then(fs => fs.rename(candidate.store.directory, saved)); await symlink(saved, candidate.store.directory);
    await expect(f.registry.readActive()).rejects.toBeInstanceOf(RemoteIdentityRegistryError);
  });
  it('提交前存储异常保留原指针、旧身份和完整候选', async () => {
    const f = await fixture(); const old = await f.registry.beginCandidate(); await f.registry.activate(old, await prepare(old));
    const candidate = await f.registry.beginCandidate(); const binding = await prepare(candidate); const before = await readFile(join(f.store.directory, 'active-identity.json'), 'utf8');
    const internalStore = (f.registry as unknown as { store: PrivateStore }).store;
    const write = internalStore.writeJson.bind(internalStore); internalStore.writeJson = async name => { if (name === 'active-identity.json') throw new Error('synthetic-token ' + f.root); };
    const error = await f.registry.activate(candidate, binding).catch(error => error); expect(error).toMatchObject({ code: 'storage-unavailable' }); expect(error.message).not.toContain(f.root); expect(error.cause).toBeUndefined();
    internalStore.writeJson = write; expect(await readFile(join(f.store.directory, 'active-identity.json'), 'utf8')).toBe(before);
    expect((await f.registry.readActive())?.snapshot.generation).toBe(old.generation); expect(await candidate.store.readJson('identity.json')).not.toBeNull();
  });
  it('rename 后 fsync 报错不假称回滚，下一次读采用实际已提交指针', async () => {
    const f = await fixture(); const old = await f.registry.beginCandidate(); await f.registry.activate(old, await prepare(old));
    const candidate = await f.registry.beginCandidate(); const binding = await prepare(candidate);
    const internal = (f.registry as unknown as { store: { syncDirectory(path?: string): Promise<void> } }).store; const sync = internal.syncDirectory.bind(internal); let injected = false;
    internal.syncDirectory = async path => {
      const current = await readFile(join(f.store.directory, 'active-identity.json'), 'utf8').then(value => JSON.parse(value).generation, () => null);
      if (!injected && (path ?? f.store.directory) === f.store.directory && current === candidate.generation) { injected = true; throw new Error('synthetic-fsync-failure'); }
      await sync(path);
    };
    await expect(f.registry.activate(candidate, binding)).rejects.toMatchObject({ code: 'storage-unavailable' });
    expect((await new RemoteIdentityRegistry(new PrivateStore(f.store.directory)).readActive())?.snapshot.generation).toBe(candidate.generation);
    expect(await old.store.readJson('enrollment.json')).not.toBeNull(); expect(await candidate.store.readJson('identity.json')).not.toBeNull();
  });
  it('真正 OS 子进程竞争同一 base 只提交一个候选', async () => {
    const f = await fixture(); const pair = [worker(f.store.directory), worker(f.store.directory)]; await Promise.all(pair.map(value => value.wait('ready'))); pair.forEach(value => value.child.send('start'));
    const results = await Promise.all(pair.map(value => value.wait('result')));
    expect(results.filter(value => value.ok)).toHaveLength(1); expect(results.find(value => !value.ok)?.code).toBe('active-changed');
    expect((await f.registry.readActive())?.snapshot.generation).toBe(results.find(value => value.ok)?.generation);
  });
  it.each(['before-write', 'after-rename'])('提交进程在 %s 被终止只按已提交指针恢复', async mode => {
    const f = await fixture(); const old = await f.registry.beginCandidate(); await f.registry.activate(old, await prepare(old));
    const child = worker(f.store.directory, mode); const ready = await child.wait('ready'); child.child.send('start'); await child.wait('entered'); await kill(child.child);
    const restored = await new RemoteIdentityRegistry(new PrivateStore(f.store.directory)).readActive();
    expect(restored?.snapshot.generation).toBe(mode === 'before-write' ? old.generation : ready.generation);
    const next = await f.registry.beginCandidate(); expect(next.expectedActive).toEqual(restored?.snapshot);
    expect(await old.store.readJson('enrollment.json')).not.toBeNull(); expect(await new PrivateStore(join(f.store.directory, ready.generation!)).readJson('identity.json')).not.toBeNull();
  });
});
