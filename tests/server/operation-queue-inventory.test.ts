// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs, { chmod, link, lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OperationQueue, type OperationContext, type OperationInput } from '../../server/operation-queue.js';
import { TargetResolver } from '../../server/targets.js';
import { fixture as remoteFixture, until } from './remote-session-fixture.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); syncBuiltinESMExports();
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
const local = (): OperationContext => ({ mode: 'local', gatewayId: 'gateway', businessKey: 'mac', authorizationKey: 'local-auth', localHostId: 'host' });
const remote = (): Extract<OperationContext, { mode: 'remote' }> => ({
  mode: 'remote', gatewayId: 'gateway', businessKey: 'mac', authorizationKey: 'remote-auth',
  managed: { accountId: 'account', accountUserId: 'owner', userId: 'user', codexHome: '/synthetic/home' },
  target: { environmentId: 'env', installationId: 'install' }, generation: 'g1',
});
const input = (context = local(), conversationId = 'thread'): OperationInput => ({
  id: randomUUID(), context, conversationId, body: { secret: 'body-private' }, settings: { secret: 'settings-private' }, attachmentRefs: ['attachment-private'],
});
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'inventory-')); roots.push(root);
  const directory = join(root, 'queue');
  // 固定合成权限仅验证存储；下方真实Runtime用TargetResolver逐原context授权。
  const reopen = () => new OperationQueue({ directory, gatewayId: 'gateway', authorize: async () => () => {} });
  return { root, directory, path: join(directory, 'operations.json'), reopen, queue: reopen() };
}

it('真实OS子进程耐久接收后无需手机即可发现原Local/Remote各组与全部原id', async () => {
  const f = await fixture(); const contexts = [local(), remote(), { ...remote(), generation: 'g2', authorizationKey: 'g2-auth' }];
  const inputs = [input(contexts[0]), input(contexts[1]), input(contexts[2]), input(contexts[1]), input(contexts[0], 'other-thread')];
  const source = join(f.root, 'inputs.json'); await writeFile(source, JSON.stringify(inputs), { mode: 0o600 });
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', join(process.cwd(), 'tests/server/fixtures/operation-queue-inventory-worker.ts'), f.directory, source], { env: process.env });
  const receipts = JSON.parse(stdout); expect(receipts).toHaveLength(inputs.length);
  const before = await readFile(f.path);
  const groups = await f.reopen().inventory();
  expect(groups).toEqual([
    { context: contexts[0], conversationId: 'thread', operations: [receipts[0]] },
    { context: contexts[1], conversationId: 'thread', operations: [receipts[1], receipts[3]] },
    { context: contexts[2], conversationId: 'thread', operations: [receipts[2]] },
    { context: contexts[0], conversationId: 'other-thread', operations: [receipts[4]] },
  ]);
  expect(JSON.stringify(groups)).not.toMatch(/body|settings|attachment|signature|claimToken|claimPid/);
  expect((await readFile(f.path)).equals(before)).toBe(true);
});

it('完整context字段与userId有无精确隔离，键插入顺序不同仍归同一原组', async () => {
  const f = await fixture(); const base = remote(); const withoutUser = remote(); delete withoutUser.managed.userId;
  const contexts: OperationContext[] = [local(), base, withoutUser,
    { ...remote(), managed: { ...base.managed, userId: 'other-user' } },
    { ...remote(), managed: { ...base.managed, codexHome: '/synthetic/other-home' } },
    { ...remote(), managed: { ...base.managed, accountId: 'other-account' } },
    { ...remote(), managed: { ...base.managed, accountUserId: 'other-owner' } },
    { ...remote(), target: { ...base.target, environmentId: 'other-env' } },
    { ...remote(), target: { ...base.target, installationId: 'other-install' } },
    { ...remote(), generation: 'other-generation' }, { ...remote(), authorizationKey: 'other-auth' },
    { ...remote(), businessKey: 'other-business' }, { ...local(), localHostId: 'other-host' } as OperationContext,
  ];
  const receipts = [];
  for (const context of contexts) receipts.push(await f.queue.submit(input(context)));
  const reordered = { generation: base.generation, target: { installationId: 'install', environmentId: 'env' }, managed: { codexHome: '/synthetic/home', userId: 'user', accountUserId: 'owner', accountId: 'account' }, authorizationKey: base.authorizationKey, businessKey: base.businessKey, gatewayId: base.gatewayId, mode: 'remote' as const };
  const last = await f.queue.submit(input(reordered));
  const groups = await f.reopen().inventory();
  expect(groups).toHaveLength(contexts.length);
  expect(groups.map(group => group.context)).toEqual(contexts);
  expect(groups[1]!.operations).toEqual([receipts[1], last]);
  expect(Object.hasOwn((groups[2]!.context as typeof base).managed, 'userId')).toBe(false);
  expect(groups.flatMap(group => group.operations).map(value => value.id).sort()).toEqual([...receipts, last].map(value => value.id).sort());
});

it('仅过滤既有终态，queued/claimed/uncertain/failed保留原状态和接收序且不恢复claim', async () => {
  const f = await fixture(); const expected = [];
  for (const state of ['claimed', 'uncertain', 'failed', 'succeeded', 'cancelled', 'control-expired', 'queued'] as const) {
    const operation = input(local(), state);
    if (state === 'control-expired') operation.control = { kind: 'stop', turnId: 'old-turn', expiresAt: Date.now() - 1 };
    let receipt = await f.queue.submit(operation);
    if (state === 'cancelled') receipt = await f.queue.cancel(operation.id, receipt.revision);
    else if (state === 'control-expired') expect(await f.queue.claimNext('mac')).toBeNull();
    else if (state !== 'queued') {
      const claim = await f.queue.claimNext('mac'); expect(claim?.id).toBe(operation.id); receipt = claim!;
      if (state !== 'claimed') receipt = await f.queue.markPotentialSend(operation.id, receipt.revision, claim!.claimToken!);
      if (state === 'failed' || state === 'succeeded') receipt = await f.queue.settle(operation.id, receipt.revision, claim!.claimToken!, state);
    }
    if (['claimed', 'uncertain', 'failed', 'queued'].includes(state)) expected.push({ context: operation.context, conversationId: state, operations: [{ id: receipt.id, revision: receipt.revision, receiveOrder: receipt.receiveOrder, state: receipt.state }] });
  }
  const before = await readFile(f.path);
  expect(await f.reopen().inventory()).toEqual(expected);
  expect((await readFile(f.path)).equals(before)).toBe(true);
});

it('按receiveOrder而非磁盘数组位置发现，返回对象与输入均不能反改ledger', async () => {
  const f = await fixture(); const operation = input(remote()); const expectedContext = structuredClone(operation.context);
  const first = await f.queue.submit(operation); const other = await f.queue.submit(input(local(), 'other')); const last = await f.queue.submit(input(remote()));
  if (operation.context.mode === 'remote') operation.context.managed.codexHome = '/mutated-input';
  const ledger = JSON.parse(await readFile(f.path, 'utf8')); ledger.records.reverse(); await writeFile(f.path, JSON.stringify(ledger));
  const before = await readFile(f.path); const groups = await f.reopen().inventory();
  expect(groups).toEqual([{ context: expectedContext, conversationId: 'thread', operations: [first, last] }, { context: local(), conversationId: 'other', operations: [other] }]);
  const saved = structuredClone(groups);
  if (groups[0]!.context.mode === 'remote') groups[0]!.context.managed.codexHome = '/mutated-result';
  groups[0]!.operations[0]!.id = randomUUID(); groups[0]!.operations.length = 0; groups.length = 0;
  expect(await f.reopen().inventory()).toEqual(saved);
  expect((await readFile(f.path)).equals(before)).toBe(true);
});

it('真实Runtime撤权的一组仍可无正文发现，不能读取其正文或阻断Local原记录', async () => {
  const f = await remoteFixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const identity = { version: 1 as const, gatewayId: 'gateway', localHostId: 'host' };
  const resolver = new TargetResolver({ identity, remoteRuntime: f.runtime });
  const managed = f.runtime.status().managed!;
  const context = await resolver.operationContext({ mode: 'remote', gatewayId: identity.gatewayId, account: { accountId: managed.accountId, accountUserId: managed.accountUserId, userId: managed.userId }, target: { environmentId: 'local-env', installationId: 'local-install' } });
  const directory = join(f.root, 'inventory-queue');
  const reopen = () => new OperationQueue({ directory, gatewayId: identity.gatewayId, authorize: (original, action) => resolver.authorizeOperation(original as OperationContext, action) });
  const queue = reopen(); const remoteInput = input(context); const localInput = input(await resolver.operationContext());
  await queue.submit(remoteInput); await queue.submit(localInput);
  f.setManaged({ userId: 'revoked-user' });
  const recovered = reopen(); const groups = await recovered.inventory();
  expect(groups.map(group => group.operations[0]!.id)).toEqual([remoteInput.id, localInput.id]);
  expect(groups.map(group => group.context)).toEqual([context, localInput.context]);
  expect(JSON.stringify(groups)).not.toMatch(/body-private|settings-private|attachment-private/);
  await expect(recovered.read(remoteInput.id)).rejects.toMatchObject({ code: 'identity-changed' });
  expect((await recovered.read(localInput.id)).body).toEqual(localInput.body);
  await expect(recovered.list(context.businessKey, 'thread')).rejects.toBeDefined();
  expect(f.connections).toHaveLength(1);
});

it('只有真正缺失ledger返回空目录，另一gateway的完整存储不能继承', async () => {
  const f = await fixture(); expect(await f.queue.inventory()).toEqual([]);
  await expect(readFile(f.path)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.queue.submit(input());
  const foreign = new OperationQueue({ directory: f.directory, gatewayId: 'foreign-gateway', authorize: async () => () => {} });
  await expect(foreign.inventory()).rejects.toMatchObject({ code: 'storage' });
});

it.each(['json', 'utf8', 'schema', 'mode', 'directory', 'symlink', 'hardlink', 'directory-symlink', 'bad-other-group'] as const)('恢复目录拒绝坏或unsafe存储%s，原字节与权限保留', async kind => {
  const f = await fixture(); await f.queue.submit(input());
  if (kind === 'json') await writeFile(f.path, '{bad');
  if (kind === 'utf8') await writeFile(f.path, Buffer.from([255]));
  if (kind === 'schema' || kind === 'bad-other-group') {
    const ledger = JSON.parse(await readFile(f.path, 'utf8'));
    if (kind === 'schema') ledger.records[0].revision = 0;
    else { ledger.records.push({ ...ledger.records[0], id: randomUUID(), receiveOrder: 2, conversationId: 'unrelated', context: { ...remote(), generation: null } }); ledger.nextOrder = 3; }
    await writeFile(f.path, JSON.stringify(ledger));
  }
  if (kind === 'mode') await chmod(f.path, 0o644);
  if (kind === 'directory') await chmod(f.directory, 0o755);
  if (kind === 'symlink') { const victim = join(f.root, 'victim'); await writeFile(victim, await readFile(f.path), { mode: 0o600 }); await rm(f.path); await symlink(victim, f.path); }
  if (kind === 'hardlink') await link(f.path, join(f.root, 'duplicate'));
  let queue = f.reopen();
  if (kind === 'directory-symlink') { const alias = join(f.root, 'alias'); await symlink(f.directory, alias); queue = new OperationQueue({ directory: alias, gatewayId: 'gateway', authorize: async () => () => {} }); }
  const before = await readFile(f.path); const stat = await lstat(f.path); const directoryStat = await lstat(f.directory);
  await expect(queue.inventory()).rejects.toBeDefined();
  expect((await readFile(f.path)).equals(before)).toBe(true);
  expect((await lstat(f.path)).ino).toBe(stat.ino); expect((await lstat(f.path)).mode).toBe(stat.mode);
  expect((await lstat(f.directory)).mode).toBe(directoryStat.mode);
});

it('真实文件读取边界EIO不能变为空目录，恢复后仍发现原项', async () => {
  const f = await fixture(); const original = input(); await f.queue.submit(original); const before = await readFile(f.path);
  const open = fs.open; let hit = false;
  const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof open>) => {
    const handle = await Reflect.apply(open, fs, args);
    if (String(args[0]) === f.path) handle.readFile = (async () => { hit = true; throw Object.assign(new Error('synthetic EIO'), { code: 'EIO' }); }) as typeof handle.readFile;
    return handle;
  }); syncBuiltinESMExports();
  try { await expect(f.reopen().inventory()).rejects.toMatchObject({ code: 'storage' }); expect(hit).toBe(true); }
  finally { spy.mockRestore(); syncBuiltinESMExports(); }
  expect((await readFile(f.path)).equals(before)).toBe(true);
  expect((await f.reopen().inventory())[0]!.operations[0]!.id).toBe(original.id);
});
