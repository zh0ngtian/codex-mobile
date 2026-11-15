// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OperationQueue } from '../../server/operation-queue.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
// 固定虚构Local权限的夹具可同步通过；可变权限测试均捕获真实可变状态。
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'operation-queue-')); roots.push(root);
  return { root, queue: new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize: async () => () => {} }) };
}
// 容量边界直接构造合法既有ledger；并发接收与真实fsync另有OS/多实例验证。
async function seedCount(root: string, count: number) {
  const { writeFile } = await import('node:fs/promises'); const path = join(root, 'queue', 'operations.json');
  const ledger = JSON.parse(await readFile(path, 'utf8')); const template = ledger.records[0];
  ledger.records = Array.from({ length: count }, (_, n) => ({ ...template, id: n ? randomUUID() : template.id, receiveOrder: n + 1 })); ledger.nextOrder = count + 1;
  await writeFile(path, JSON.stringify(ledger));
}
const context = () => ({ mode: 'local' as const, gatewayId: 'gateway', businessKey: 'mac', authorizationKey: 'local-auth', localHostId: 'host' });
const input = (id = randomUUID(), conversationId = 'thread') => ({ id, context: context(), conversationId, body: { text: 'first' }, settings: { model: 'test' }, attachmentRefs: ['ref'] });
it('接收后重开读取相同共享收据与冻结正文', async () => {
  const { root, queue } = await fixture(); const original = input(); const receipt = await queue.submit(original);
  expect(receipt).toMatchObject({ id: original.id, state: 'queued', revision: 1, receiveOrder: 1 });
  original.body.text = 'mutated'; original.settings.model = 'other'; original.attachmentRefs.push('new');
  const { OperationQueue } = await import('../../server/operation-queue.js');
  const phone = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize: async () => () => {} });
  expect(await phone.read(original.id)).toMatchObject({ body: { text: 'first' }, settings: { model: 'test' }, attachmentRefs: ['ref'] });
  expect(JSON.parse(await readFile(join(root, 'queue', 'operations.json'), 'utf8')).records).toHaveLength(1);
});
it('UUID原提交签名不随CAS编辑改变，重交只返回当前收据', async () => {
  const { queue } = await fixture(); const original = input(); await queue.submit(original);
  await queue.edit(original.id, 1, { body: { text: 'edited' } });
  expect(await queue.submit(original)).toMatchObject({ revision: 2, state: 'queued' });
  expect(await queue.read(original.id)).toMatchObject({ body: { text: 'edited' } });
  await expect(queue.submit({ ...original, body: { text: 'different' } })).rejects.toMatchObject({ status: 409, code: 'uuid-conflict' });
  await expect(queue.cancel(original.id, 1)).rejects.toMatchObject({ status: 409, code: 'revision-conflict' });
  await queue.cancel(original.id, 2);
  expect(await queue.submit(original)).toMatchObject({ state: 'cancelled', revision: 3 });
  expect(await queue.read(original.id)).not.toHaveProperty('body');
});
it('Sidechat memoryOnly在进入耐久API前拒绝，不留正文', async () => {
  const { root, queue } = await fixture();
  await expect(queue.submit({ ...input(), memoryOnly: true } as never)).rejects.toMatchObject({ code: 'memory-only' });
  expect(await readFile(join(root, 'queue', 'operations.json'), 'utf8').catch(() => '')).not.toContain('first');
});
it('普通容量128显式拒绝第129项且旧UUID收据仍可查', async () => {
  const { root, queue } = await fixture(); const original = input(); await queue.submit(original);
  await seedCount(root, 128);
  await expect(queue.submit(input())).rejects.toMatchObject({ code: 'capacity', status: 429 });
  expect(await queue.submit(original)).toMatchObject({ receiveOrder: 1 });
  await queue.cancel(original.id, 1); expect(await queue.submit(input())).toMatchObject({ receiveOrder: 129 });
});
it('元数据独立64MiB限制拒绝超额编辑且保存旧输入', async () => {
  const { queue } = await fixture(); const original = input(); await queue.submit(original);
  await expect(queue.edit(original.id, 1, { body: 'x'.repeat(64 * 1024 * 1024) })).rejects.toMatchObject({ code: 'capacity' });
  expect(await queue.read(original.id)).toMatchObject({ revision: 1, body: { text: 'first' } });
}, 15000);
it('并发worker只取得一次派发权，未知队首阻塞同会话而其他会话继续', async () => {
  const { queue } = await fixture(); const first = input(); const second = input(); const other = input(randomUUID(), 'other');
  await queue.submit(first); await queue.submit(second); await queue.submit(other);
  const claims = await Promise.all([queue.claimNext('mac'), queue.claimNext('mac')]);
  expect(claims.filter(Boolean).map(value => value!.id).sort()).toEqual([first.id, other.id].sort());
  const claim = claims.find(value => value?.id === first.id)!;
  await queue.markPotentialSend(first.id, claim!.revision, claim!.claimToken!);
  expect(await queue.claimNext('mac')).toBeNull();
  expect(await queue.read(first.id)).toMatchObject({ state: 'uncertain' });
  await expect(queue.edit(first.id, claim.revision + 1, { body: 'retry' })).rejects.toMatchObject({ code: 'not-editable' });
  await expect(queue.claimNext('mac')).resolves.toBeNull();
});
it('只有可信实际neverSent证明允许待确认回queued，404/缺失/超时不是证明', async () => {
  const { queue } = await fixture(); const original = input(); await queue.submit(original);
  const claim = await queue.claimNext('mac');
  expect(claim?.id).toBe(original.id);
  const uncertain = await queue.markPotentialSend(original.id, claim!.revision, claim!.claimToken!);
  await expect(queue.confirmNeverSent(original.id, uncertain.revision, claim!.claimToken!, async () => false)).rejects.toMatchObject({ code: 'not-proven-never-sent' });
  expect(await queue.claimNext('mac')).toBeNull();
  const queued = await queue.confirmNeverSent(original.id, uncertain.revision, claim!.claimToken!, async () => true);
  expect(queued.state).toBe('queued');
  const next = await queue.claimNext('mac'); expect(next!.claimToken).not.toBe(claim!.claimToken!);
  await expect(queue.markPotentialSend(original.id, next!.revision, claim!.claimToken!)).rejects.toMatchObject({ code: 'claim-conflict' });
});
it('失败队首保留正文和阻塞，确认成功后终态最小收据释放后项', async () => {
  const { queue } = await fixture(); const first = input(); const next = input(); await queue.submit(first); await queue.submit(next);
  const claim = await queue.claimNext('mac'); expect(claim?.id).toBe(first.id);
  const uncertain = await queue.markPotentialSend(first.id, claim!.revision, claim!.claimToken!);
  const failed = await queue.settle(first.id, uncertain.revision, claim!.claimToken!, 'failed');
  expect(await queue.claimNext('mac')).toBeNull();
  expect(await queue.read(first.id)).toMatchObject({ body: { text: 'first' }, state: 'failed' });
  await queue.settle(first.id, failed.revision, claim!.claimToken!, 'succeeded');
  expect(await queue.read(first.id)).not.toHaveProperty('body');
  expect((await queue.claimNext('mac'))!.id).toBe(next.id);
});
it('控制预留独立于已满普通队列并优先，过期控制明确失败', async () => {
  const { root, queue } = await fixture(); await queue.submit(input()); await seedCount(root, 128);
  const control = { ...input(), control: { kind: 'stop' as const, turnId: 'turn-original', expiresAt: Date.now() + 60000 } };
  await queue.submit(control);
  const claim = await queue.claimNext('mac'); expect(claim?.id).toBe(control.id);
  expect(claim!.control).toMatchObject({ turnId: 'turn-original' });
  const expired = { ...input(), control: { kind: 'approval' as const, turnId: 'turn-original', requestId: 'request-original', expiresAt: Date.now() - 1 } };
  await queue.submit(expired); await queue.claimNext('mac');
  expect(await queue.read(expired.id)).toMatchObject({ state: 'failed', failure: 'control-expired' });
}, 15000);
it.each(['claimed', 'uncertain', 'failed'] as const)('控制已%s时不能领取同会话下一轮普通写', async state => {
  const { queue } = await fixture(); const ordinary = input(); await queue.submit(ordinary);
  const control = { ...input(), control: { kind: 'stop' as const, turnId: 'turn', expiresAt: Date.now() + 60000 } }; await queue.submit(control);
  const claim = await queue.claimNext('mac'); expect(claim?.id).toBe(control.id);
  if (state !== 'claimed') {
    const marked = await queue.markPotentialSend(control.id, claim!.revision, claim!.claimToken!);
    if (state === 'failed') await queue.settle(control.id, marked.revision, claim!.claimToken!, 'failed');
  }
  expect(await queue.claimNext('mac')).toBeNull();
});
it('userId字段存在但undefined不能静默降为缺省账号身份', async () => {
  const { queue } = await fixture();
  const remote = { mode: 'remote' as const, gatewayId: 'gateway', businessKey: 'mac', authorizationKey: 'remote-auth', managed: { accountId: 'a', accountUserId: 'u', codexHome: '/private/home', userId: undefined }, target: { environmentId: 'e', installationId: 'i' }, generation: 'g1' };
  await expect(queue.submit({ ...input(), context: remote })).rejects.toMatchObject({ code: 'invalid-input' });
});
it('同业务键Local/Remote共享对象但完整账号/代际授权独立，旧账号读改取均拒绝', async () => {
  const { root } = await fixture(); let accountId = 'account-a'; let generation = 'g1'; let sawBody = false;
  const remote = { mode: 'remote' as const, gatewayId: 'gateway', businessKey: 'mac', authorizationKey: 'remote-auth', managed: { accountId, accountUserId: 'owner', userId: 'user', codexHome: '/private/codex-home' }, target: { environmentId: 'env', installationId: 'install' }, generation };
  const authorize = async (frozen: any) => {
    sawBody ||= Object.hasOwn(frozen, 'body');
    const expected = structuredClone(frozen);
    const assert = () => { if (expected.mode === 'remote' && (expected.managed.accountId !== accountId || expected.generation !== generation)) throw new Error('identity-changed'); }; assert();
    frozen.businessKey = 'poison'; if (frozen.mode === 'remote') frozen.managed.codexHome = '/poison'; return assert;
  };
  const first = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize });
  const phone = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize });
  const submitted = { ...input(), context: remote }; await first.submit(submitted);
  expect(await phone.read(submitted.id)).toMatchObject({ context: { businessKey: 'mac', managed: { codexHome: '/private/codex-home', userId: 'user' }, target: { environmentId: 'env', installationId: 'install' }, generation: 'g1' } });
  remote.managed.userId = 'mutated';
  expect(await first.read(submitted.id)).toMatchObject({ context: { managed: { userId: 'user' } } });
  accountId = 'account-b';
  await expect(phone.read(submitted.id)).rejects.toThrow('identity-changed');
  await expect(phone.edit(submitted.id, 1, { body: 'unauthorized' })).rejects.toThrow('identity-changed');
  await expect(phone.cancel(submitted.id, 1)).rejects.toThrow('identity-changed');
  await expect(phone.claimNext('mac')).rejects.toThrow('identity-changed');
  accountId = 'account-a'; generation = 'g2'; await expect(phone.read(submitted.id)).rejects.toThrow('identity-changed');
  generation = 'g1'; expect(await first.read(submitted.id)).toMatchObject({ revision: 1, body: { text: 'first' } }); expect(sawBody).toBe(false);
});
it('同根多实例并发接收从盘内事务取得稳定顺序，不能旧快照覆盖已ACK项', async () => {
  const { root, queue } = await fixture(); const other = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize: async () => () => {} });
  const submissions = Array.from({ length: 18 }, (_, n) => input(randomUUID(), `thread-${n}`));
  const receipts = await Promise.all(submissions.map((value, i) => (i % 2 ? queue : other).submit(value)));
  expect(receipts.map(value => value.receiveOrder).sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  for (const value of submissions) expect(await other.read(value.id)).toMatchObject({ body: value.body });
  const claims = await Promise.all(Array.from({ length: 18 }, (_, n) => (n % 2 ? queue : other).claimNext('mac')));
  expect(new Set(claims.map(value => value?.id)).size).toBe(18);
});
it('文件与目录fsync完成前不ACK，rename后fsync失败保留未知提交并封住本实例', async () => {
  const { root, queue } = await fixture(); const initial = input(); await queue.submit(initial);
  const fs = (await import('node:fs/promises')).default; const { syncBuiltinESMExports } = await import('node:module'); const { vi } = await import('vitest');
  const original = fs.open; let release!: () => void; let reached!: () => void; const gate = new Promise<void>(resolve => release = resolve); const entered = new Promise<void>(resolve => reached = resolve);
  let failDirectory = false; let gateFile = true; let hitDirectory = false;
  const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof original>) => {
    const handle = await Reflect.apply(original, fs, args); const sync = handle.sync.bind(handle); const path = String(args[0]);
    handle.sync = async () => {
      if (path.includes('/.operation-') && gateFile) { reached(); await gate; }
      if (path === join(root, 'queue') && failDirectory) { hitDirectory = true; throw new Error('directory-fsync-failure'); }
      await sync();
    }; return handle;
  }); syncBuiltinESMExports();
  try {
    const next = input(); let ack = false; const pending = queue.submit(next).then(value => { ack = true; return value; }); await entered;
    expect(ack).toBe(false); expect(await readFile(join(root, 'queue', 'operations.json'), 'utf8')).not.toContain(next.id);
    release(); await pending; expect(ack).toBe(true); gateFile = false;
    // 只在实际operations rename完成后注入目录fsync，避开事务锁自身的同步。
    const renameOriginal = fs.rename; const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (...args: Parameters<typeof renameOriginal>) => {
      await Reflect.apply(renameOriginal, fs, args); if (String(args[1]) === join(root, 'queue', 'operations.json')) failDirectory = true;
    }); syncBuiltinESMExports();
    const unknown = input();
    try { await expect(queue.submit(unknown)).rejects.toMatchObject({ code: 'storage' }); } finally { renameSpy.mockRestore(); syncBuiltinESMExports(); failDirectory = false; }
    expect(hitDirectory).toBe(true); const published = await readFile(join(root, 'queue', 'operations.json'), 'utf8'); expect(published).toContain(unknown.id);
    await expect(queue.submit(input())).rejects.toMatchObject({ code: 'reopen-required' });
    expect(await readFile(join(root, 'queue', 'operations.json'), 'utf8')).toBe(published);
    const reopen = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize: async () => () => {} });
    expect(await reopen.submit(unknown)).toMatchObject({ receiveOrder: 3 }); expect(await reopen.read(initial.id)).toMatchObject({ receiveOrder: 1 });
  } finally { release(); spy.mockRestore(); syncBuiltinESMExports(); }
});
it.each(['json', 'utf8', 'schema', 'mode', 'directory', 'symlink', 'hardlink'] as const)('坏或unsafe存储%s原样保留不自动修复', async kind => {
  const { root, queue } = await fixture(); const item = input(); await queue.submit(item);
  const { writeFile, chmod, symlink, link, lstat } = await import('node:fs/promises'); const path = join(root, 'queue', 'operations.json');
  if (kind === 'json') await writeFile(path, '{bad');
  if (kind === 'utf8') await writeFile(path, Buffer.from([255]));
  if (kind === 'schema') { const record = JSON.parse(await readFile(path, 'utf8')); record.records[0].revision = 0; await writeFile(path, JSON.stringify(record)); }
  if (kind === 'mode') await chmod(path, 0o644);
  if (kind === 'directory') await chmod(join(root, 'queue'), 0o755);
  if (kind === 'symlink') { await rm(path); await writeFile(join(root, 'victim'), 'keep'); await symlink(join(root, 'victim'), path); }
  if (kind === 'hardlink') await link(path, join(root, 'hardlink'));
  const before = await readFile(path); const stat = await lstat(path);
  await expect(queue.submit(input())).rejects.toBeDefined();
  expect(await readFile(path)).toEqual(before); expect((await lstat(path)).ino).toBe(stat.ino); expect((await lstat(path)).mode).toBe(stat.mode);
  if (kind === 'directory') expect((await lstat(join(root, 'queue'))).mode & 0o777).toBe(0o755);
});
it('单条超过PrivateStore的1MiB仍耐久，终态65536 UUID满后显式拒绝不驱逐', async () => {
  const { root, queue } = await fixture(); const large = { ...input(), body: 'x'.repeat(1024 * 1024 + 1) }; await queue.submit(large);
  expect((await queue.read(large.id)).body).toBe(large.body); await queue.cancel(large.id, 1);
  const { writeFile } = await import('node:fs/promises'); const path = join(root, 'queue', 'operations.json'); const ledger = JSON.parse(await readFile(path, 'utf8'));
  const template = ledger.records[0]; ledger.records = Array.from({ length: 65536 }, (_, n) => ({ ...template, id: n ? randomUUID() : large.id, receiveOrder: n + 1 })); ledger.nextOrder = 65537;
  await writeFile(path, JSON.stringify(ledger));
  await expect(queue.submit(input())).rejects.toMatchObject({ code: 'receipt-capacity', status: 429 });
  expect(await queue.submit(large)).toMatchObject({ state: 'cancelled', receiveOrder: 1 });
  expect(JSON.parse(await readFile(path, 'utf8')).records).toHaveLength(65536);
}, 20000);
it('控制容量128及2MiB独立有界，普通容量不被控制正文耗尽', async () => {
  const { root, queue } = await fixture();
  const control = { ...input(), control: { kind: 'approval' as const, turnId: 'turn', requestId: 'request', expiresAt: Date.now() + 60000 } }; await queue.submit(control);
  await expect(queue.edit(control.id, 1, { body: 'x'.repeat(2 * 1024 * 1024) })).rejects.toMatchObject({ code: 'capacity' });
  const { writeFile } = await import('node:fs/promises'); const path = join(root, 'queue', 'operations.json'); const ledger = JSON.parse(await readFile(path, 'utf8')); const template = ledger.records[0];
  ledger.records = Array.from({ length: 128 }, (_, n) => ({ ...template, id: n ? randomUUID() : control.id, receiveOrder: n + 1 })); ledger.nextOrder = 129; await writeFile(path, JSON.stringify(ledger));
  await expect(queue.submit({ ...control, id: randomUUID() })).rejects.toMatchObject({ code: 'capacity' });
  expect(await queue.submit(input())).toMatchObject({ receiveOrder: 129 });
});
it('真实OS并发接收、SIGKILL提交前后与已确认项恢复不丢失，待确认重启绝不重发', async () => {
  const { root, queue } = await fixture(); const directory = join(root, 'queue'); const { spawn } = await import('node:child_process');
  const worker = (mode: string, id = randomUUID(), conversationId = 'thread') => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(process.cwd(), 'tests/server/fixtures/operation-queue-worker.ts'), directory, mode, id, conversationId], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let error = ''; child.stdout.on('data', value => output += value); child.stderr.on('data', value => error += value);
    const closed = new Promise<number | null>(resolve => child.once('close', resolve));
    const line = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('隔离worker超时')); }, 8000);
      child.stdout.on('data', () => { if (output.includes('\n')) { clearTimeout(timer); resolve(output.split('\n')[0]!); } });
      child.once('close', code => { clearTimeout(timer); if (!output.includes('\n')) reject(new Error(`worker ${code}: ${error}`)); });
    }); return { child, closed, line };
  };
  const seed = input(); await queue.submit(seed);
  const cancelled = input(); const before = worker('before-rename', cancelled.id); expect(await before.line).toBe('before-rename'); before.child.kill('SIGKILL'); await before.closed;
  await expect(queue.read(cancelled.id)).rejects.toMatchObject({ code: 'not-found' }); expect(await queue.read(seed.id)).toMatchObject({ receiveOrder: 1 });
  const unknown = input(); const after = worker('after-rename', unknown.id); expect(await after.line).toBe('after-rename'); after.child.kill('SIGKILL'); await after.closed;
  expect(await queue.submit(unknown)).toMatchObject({ receiveOrder: 2 });
  const receipts = await Promise.all(Array.from({ length: 4 }, async (_, i) => { const run = worker('submit', randomUUID(), `other-${i}`); const value = JSON.parse(await run.line); expect(await run.closed).toBe(0); return value; }));
  expect(receipts.map(value => value.receiveOrder).sort((a, b) => a - b)).toEqual([3, 4, 5, 6]);
  // 未跨发送边界的死worker claim可重新领取；取得权再次CAS且不复用token。
  const claimed = worker('claim'); const originalClaim = JSON.parse(await claimed.line); expect(originalClaim.id).toBe(seed.id); claimed.child.kill('SIGKILL'); await claimed.closed;
  const marked = worker('mark-hold'); const uncertain = JSON.parse(await marked.line); expect(uncertain).toMatchObject({ id: seed.id, state: 'uncertain' }); expect(uncertain.claimToken).not.toBe(originalClaim.claimToken);
  marked.child.kill('SIGKILL'); await marked.closed;
  const reopen = new OperationQueue({ directory, gatewayId: 'gateway', authorize: async () => () => {} });
  expect(await reopen.read(seed.id)).toMatchObject({ state: 'uncertain' });
  const remaining = await Promise.all(Array.from({ length: 5 }, async () => { const run = worker('mark'); const value = JSON.parse(await run.line); expect(await run.closed).toBe(0); return value; }));
  expect(remaining.filter(Boolean).map(value => value.id)).not.toContain(seed.id); expect(remaining.filter(Boolean).map(value => value.id)).not.toContain(unknown.id);
  expect(remaining.filter(Boolean)).toHaveLength(4); expect(new Set(remaining.filter(Boolean).map(value => value.id)).size).toBe(4);
}, 30000);
it('旧账号队首只阻塞自己的会话，其他已授权会话继续且旧正文保留', async () => {
  const { root } = await fixture(); let allowed = true;
  const authorize = async (scope: any) => { const remote = scope.mode === 'remote'; const assert = () => { if (remote && !allowed) throw new Error('old-account'); }; assert(); return assert; };
  const queue = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize });
  const stale = { ...input(), context: { mode: 'remote' as const, gatewayId: 'gateway', businessKey: 'mac', authorizationKey: 'remote-auth', managed: { accountId: 'old', accountUserId: 'owner', codexHome: '/private/old' }, target: { environmentId: 'env', installationId: 'installation' }, generation: 'old-gen' } };
  const laterSame = input(); const other = input(randomUUID(), 'other'); await queue.submit(stale); await queue.submit(laterSame); await queue.submit(other); allowed = false;
  const chosen = await queue.claimNext('mac').catch(() => null);
  expect(chosen?.id).toBe(other.id);
  await expect(queue.read(stale.id)).rejects.toThrow('old-account'); allowed = true;
  expect(await queue.read(stale.id)).toMatchObject({ state: 'queued', revision: 1, context: { generation: 'old-gen', managed: { accountId: 'old' } } });
  expect(await queue.read(laterSame.id)).toMatchObject({ state: 'queued' });
});
it('多个手机可列出同一目标会话的共享可见队列，逐条授权后才返回正文', async () => {
  const { root, queue } = await fixture(); const first = input(); const second = input(); await queue.submit(first); await queue.submit(second); await queue.submit(input(randomUUID(), 'other'));
  const phone = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize: async () => () => {} });
  const shared = await phone.list('mac', 'thread');
  expect(shared?.map((value: any) => value.id)).toEqual([first.id, second.id]);
  await queue.edit(first.id, 1, { body: 'shared edit' });
  expect((await phone.list('mac', 'thread'))[0]).toMatchObject({ body: 'shared edit', revision: 2 });
});
it.each(['queued-claim', 'failed-no-attempt', 'cancelled-claim', 'fake-expiry', 'extra-context', 'extra-record'] as const)('不接受损坏状态组合%s且保留字节', async kind => {
  const { root, queue } = await fixture(); const item = input(); await queue.submit(item);
  const { writeFile } = await import('node:fs/promises'); const path = join(root, 'queue', 'operations.json'); const ledger = JSON.parse(await readFile(path, 'utf8')); const record = ledger.records[0];
  if (kind === 'queued-claim') { record.claimToken = 'unexpected'; record.claimPid = process.pid; }
  if (kind === 'failed-no-attempt') record.state = 'failed';
  if (kind === 'cancelled-claim') { record.state = 'cancelled'; delete record.body; delete record.settings; delete record.attachmentRefs; record.claimToken = 'unexpected'; record.claimPid = process.pid; }
  if (kind === 'fake-expiry') { record.state = 'failed'; record.failure = 'control-expired'; delete record.body; delete record.settings; delete record.attachmentRefs; }
  if (kind === 'extra-context') record.context.managed = { accountId: 'unexpected' };
  if (kind === 'extra-record') record.memoryOnly = true;
  const bytes = JSON.stringify(ledger); await writeFile(path, bytes);
  await expect(queue.read(item.id)).rejects.toMatchObject({ code: 'storage' }); expect(await readFile(path, 'utf8')).toBe(bytes);
});
it('Sidechat禁止先读body再擦，编辑API也拒绝memoryOnly入参', async () => {
  const { queue, root } = await fixture(); const original = input(); await queue.submit(original); let reads = 0;
  const forbidden = { ...input(), memoryOnly: true, get body() { reads++; return 'secret-sidechat'; } };
  await expect(queue.submit(forbidden as never)).rejects.toMatchObject({ code: 'memory-only' }); expect(reads).toBe(0);
  await expect(queue.edit(original.id, 1, { body: 'secret-sidechat', memoryOnly: true } as never)).rejects.toMatchObject({ code: 'invalid-input' });
  expect(await readFile(join(root, 'queue', 'operations.json'), 'utf8')).not.toContain('secret-sidechat');
});
it('接收顺序与revision达到安全整数界限时不确认不可恢复记录', async () => {
  const { root, queue } = await fixture(); const original = input(); await queue.submit(original);
  const { writeFile } = await import('node:fs/promises'); const path = join(root, 'queue', 'operations.json'); const ledger = JSON.parse(await readFile(path, 'utf8'));
  ledger.nextOrder = Number.MAX_SAFE_INTEGER; ledger.records[0].revision = Number.MAX_SAFE_INTEGER; const bytes = JSON.stringify(ledger); await writeFile(path, bytes);
  await expect(queue.submit(input())).rejects.toMatchObject({ code: 'sequence-exhausted' });
  await expect(queue.edit(original.id, Number.MAX_SAFE_INTEGER, { body: 'edit' })).rejects.toMatchObject({ code: 'sequence-exhausted' });
  expect(await readFile(path, 'utf8')).toBe(bytes);
});
it('重开查询未知提交的重复收据也先同步所有父目录项，不能提前ACK', async () => {
  const { root, queue } = await fixture(); const original = input(); await queue.submit(original);
  const fs = (await import('node:fs/promises')).default; const { syncBuiltinESMExports } = await import('node:module'); const { vi } = await import('vitest'); const open = fs.open;
  let hit = false; const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof open>) => {
    const handle = await Reflect.apply(open, fs, args); const sync = handle.sync.bind(handle);
    handle.sync = async () => { if (String(args[0]) === root) { hit = true; throw new Error('parent-fsync'); } await sync(); }; return handle;
  }); syncBuiltinESMExports();
  try {
    const reopened = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize: async () => () => {} });
    await expect(reopened.submit(original)).rejects.toMatchObject({ code: 'storage' }); expect(hit).toBe(true);
  } finally { spy.mockRestore(); syncBuiltinESMExports(); }
});
it('fsync等待期间账号失效，迟到读取不能返回旧正文', async () => {
  const { root } = await fixture(); let active = true;
  const queue = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize: async () => { const assert = () => { if (!active) throw new Error('identity-expired'); }; assert(); return assert; } });
  const original = input(); await queue.submit(original);
  const fs = (await import('node:fs/promises')).default; const { syncBuiltinESMExports } = await import('node:module'); const { vi } = await import('vitest'); const open = fs.open;
  let reached!: () => void; let release!: () => void; const entered = new Promise<void>(resolve => reached = resolve); const gate = new Promise<void>(resolve => release = resolve);
  const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof open>) => {
    const handle = await Reflect.apply(open, fs, args); const sync = handle.sync.bind(handle);
    handle.sync = async () => { if (String(args[0]) === root) { reached(); await gate; } await sync(); }; return handle;
  }); syncBuiltinESMExports();
  try { const pending = queue.read(original.id); await entered; active = false; release(); await expect(pending).rejects.toThrow('identity-expired'); }
  finally { release(); spy.mockRestore(); syncBuiltinESMExports(); }
});
it('claim已耐久但后置授权失败时可在原授权恢复后CAS释放，uncertain不能释放', async () => {
  const { root } = await fixture(); let active = true;
  const queue = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize: async () => { const assert = () => { if (!active) throw new Error('identity-expired'); }; assert(); return assert; } });
  const original = input(); await queue.submit(original);
  const fs = (await import('node:fs/promises')).default; const { syncBuiltinESMExports } = await import('node:module'); const { vi } = await import('vitest'); const open = fs.open;
  let revoke = true; const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof open>) => {
    const handle = await Reflect.apply(open, fs, args); const sync = handle.sync.bind(handle);
    handle.sync = async () => { await sync(); if (String(args[0]) === root && revoke) { active = false; revoke = false; } }; return handle;
  }); syncBuiltinESMExports();
  try { await expect(queue.claimNext('mac')).rejects.toThrow('identity-expired'); }
  finally { spy.mockRestore(); syncBuiltinESMExports(); }
  active = true; const stranded = await queue.read(original.id); expect(stranded.state).toBe('claimed');
  const released = await queue.releaseClaim(stranded.id, stranded.revision, stranded.claimToken!);
  expect(released?.state).toBe('queued'); const next = await queue.claimNext('mac'); expect(next?.claimToken).not.toBe(stranded.claimToken);
  const uncertain = await queue.markPotentialSend(next!.id, next!.revision, next!.claimToken!);
  await expect(queue.releaseClaim(next!.id, uncertain.revision, next!.claimToken!)).rejects.toMatchObject({ code: 'invalid-transition' });
});

it.each(['claimed', 'uncertain', 'failed'] as const)('控制队首%s阻止后控制，其他会话仍继续', async state => {
  const { queue } = await fixture();
  const first = { ...input(), control: { kind: 'stop' as const, turnId: 'turn-original', expiresAt: Date.now() + 60000 } };
  const second = { ...input(), control: { kind: 'approval' as const, turnId: 'turn-original', requestId: 'request-original', expiresAt: Date.now() + 60000 } };
  await queue.submit(first); await queue.submit(second);
  const claim = (await queue.claimNext('mac'))!; expect(claim.id).toBe(first.id);
  if (state !== 'claimed') {
    const marked = await queue.markPotentialSend(first.id, claim.revision, claim.claimToken!);
    if (state === 'failed') await queue.settle(first.id, marked.revision, claim.claimToken!, 'failed');
  }
  expect(await queue.claimNext('mac')).toBeNull();
  const other = { ...input(randomUUID(), 'other'), control: { kind: 'stop' as const, turnId: 'other-turn', expiresAt: Date.now() + 60000 } };
  await queue.submit(other); expect((await queue.claimNext('mac'))?.id).toBe(other.id);
  expect(await queue.read(second.id)).toMatchObject({ state: 'queued', revision: 1 });
});
it.each(['succeeded', 'expired'] as const)('控制队首%s后按接收顺序释放后控制', async state => {
  const { queue } = await fixture();
  const first = { ...input(), control: { kind: 'stop' as const, turnId: 'turn', expiresAt: Date.now() + (state === 'expired' ? -1 : 60000) } };
  const second = { ...input(), control: { kind: 'approval' as const, turnId: 'turn', requestId: 'request', expiresAt: Date.now() + 60000 } };
  await queue.submit(first); await queue.submit(second);
  if (state === 'succeeded') {
    const claim = (await queue.claimNext('mac'))!; expect(claim.id).toBe(first.id);
    const marked = await queue.markPotentialSend(first.id, claim.revision, claim.claimToken!);
    await queue.settle(first.id, marked.revision, claim.claimToken!, 'succeeded');
  }
  expect((await queue.claimNext('mac'))?.id).toBe(second.id);
  expect(await queue.read(first.id)).toMatchObject(state === 'expired' ? { state: 'failed', failure: 'control-expired' } : { state: 'succeeded' });
});
it.each(['claimed', 'uncertain', 'failed'] as const)('控制可越过普通%s队首处理原turn', async state => {
  const { queue } = await fixture(); const ordinary = input(); await queue.submit(ordinary);
  const claim = (await queue.claimNext('mac'))!;
  if (state !== 'claimed') {
    const marked = await queue.markPotentialSend(ordinary.id, claim.revision, claim.claimToken!);
    if (state === 'failed') await queue.settle(ordinary.id, marked.revision, claim.claimToken!, 'failed');
  }
  const control = { ...input(), control: { kind: 'stop' as const, turnId: 'original-turn', expiresAt: Date.now() + 60000 } };
  await queue.submit(control); expect((await queue.claimNext('mac'))?.id).toBe(control.id);
});
it('混合列表最后Local授权自身await期间撤销Remote身份，不能返回旧正文', async () => {
  const { root } = await fixture(); let remoteActive = true; let reviewing = false; let localReads = 0;
  let entered!: () => void; let release!: () => void;
  const reached = new Promise<void>(resolve => entered = resolve); const gate = new Promise<void>(resolve => release = resolve);
  const queue = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize: async (scope, action) => {
    const remote = scope.mode === 'remote';
    if (remote && !remoteActive) throw new Error('remote-identity-revoked');
    if (reviewing && action === 'read' && !remote && ++localReads === 2) { entered(); await gate; }
    return () => { if (remote && !remoteActive) throw new Error('remote-identity-revoked'); };
  } });
  const first = { ...input(), body: { text: 'old-account-private-body' }, context: { mode: 'remote' as const, gatewayId: 'gateway', businessKey: 'mac', authorizationKey: 'remote-auth', managed: { accountId: 'account-a', accountUserId: 'owner', userId: 'user-a', codexHome: '/private/account-a' }, target: { environmentId: 'env', installationId: 'installation' }, generation: 'generation-a' } };
  await queue.submit(first); await queue.submit(input()); reviewing = true;
  const pending = queue.list('mac', 'thread'); const rejected = expect(pending).rejects.toThrow('remote-identity-revoked');
  await reached; remoteActive = false; release(); await rejected;
  await expect(queue.read(first.id)).rejects.toThrow('remote-identity-revoked');
});
it.each(['submit', 'read', 'list', 'edit', 'cancel', 'claim', 'release', 'mark', 'confirm', 'settle'] as const)('%s在最后异步授权中撤销时拒绝正文、claim或ACK', async method => {
  const { root } = await fixture(); let armed = false; let active = true; let checks = 0;
  const queue = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize: async () => {
    if (!active) throw new Error('final-fence-revoked');
    if (armed && ++checks === (method === 'confirm' ? 4 : 2)) { await Promise.resolve(); active = false; }
    return () => { if (!active) throw new Error('final-fence-revoked'); };
  } });
  const item = input(); let revision = 1; let token = '';
  if (method !== 'submit') await queue.submit(item);
  if (['release', 'mark', 'confirm', 'settle'].includes(method)) { const claim = (await queue.claimNext('mac'))!; revision = claim.revision; token = claim.claimToken!; }
  if (['confirm', 'settle'].includes(method)) revision = (await queue.markPotentialSend(item.id, revision, token)).revision;
  armed = true;
  const run = () => {
    switch (method) {
      case 'submit': return queue.submit(item);
      case 'read': return queue.read(item.id);
      case 'list': return queue.list('mac', 'thread');
      case 'edit': return queue.edit(item.id, revision, { body: 'changed' });
      case 'cancel': return queue.cancel(item.id, revision);
      case 'claim': return queue.claimNext('mac');
      case 'release': return queue.releaseClaim(item.id, revision, token);
      case 'mark': return queue.markPotentialSend(item.id, revision, token);
      case 'confirm': return queue.confirmNeverSent(item.id, revision, token, async () => true);
      case 'settle': return queue.settle(item.id, revision, token, 'succeeded');
    }
  };
  await expect(run()).rejects.toThrow('final-fence-revoked'); expect(checks).toBe(method === 'confirm' ? 4 : 2);
});
it.each(['missing', 'null', 'value', 'async-function', 'promise-return'] as const)('缺失、无效或异步授权栅栏%s显式拒绝', async kind => {
  const { root } = await fixture();
  const authorize = async () => {
    if (kind === 'null') return null;
    if (kind === 'value') return true;
    if (kind === 'async-function') return async () => {};
    if (kind === 'promise-return') return () => Promise.resolve();
  };
  const queue = new OperationQueue({ directory: join(root, 'queue'), gatewayId: 'gateway', authorize: authorize as never });
  await expect(queue.submit(input())).rejects.toMatchObject({ code: 'invalid-authorization-fence' });
});

async function diskRecords(root: string): Promise<any[]> { return JSON.parse(await readFile(join(root, 'queue', 'operations.json'), 'utf8')).records; }
const metadataBytes = (records: unknown[]) => records.reduce<number>((sum, record) => sum + Buffer.byteLength(JSON.stringify(record)), 0);
// 只读真实ledger测长度，通过正常CAS二分找到当前最大可接收正文，不写盘伪造临界状态。
async function fillMetadata(queue: OperationQueue, root: string, id: string, budget: number) {
  const records = await diskRecords(root); let revision = records.find(record => record.id === id).revision;
  let high = budget - metadataBytes(records) + 1; let window = 1024; let low = Math.max(0, high - window);
  const attempt = async (length: number) => {
    try { revision = (await queue.edit(id, revision, { body: 'x'.repeat(length) })).revision; return true; }
    catch (error) { expect(error).toMatchObject({ code: 'capacity', status: 429 }); return false; }
  };
  while (!await attempt(low)) { high = low; window *= 2; low = Math.max(0, high - window); if (!low) { expect(await attempt(0)).toBe(true); break; } }
  while (high - low > 1) { const middle = Math.floor((high + low) / 2); if (await attempt(middle)) low = middle; else high = middle; }
  const before = await readFile(join(root, 'queue', 'operations.json'));
  await expect(queue.edit(id, revision, { body: 'x'.repeat(low + 1) })).rejects.toMatchObject({ code: 'capacity' });
  expect((await readFile(join(root, 'queue', 'operations.json'))).equals(before)).toBe(true);
  return { revision, bodyLength: low };
}
const capacityKinds = [{ name: '控制2MiB', control: true, budget: 2 * 1024 * 1024 }, { name: '普通64MiB', control: false, budget: 64 * 1024 * 1024 }];
for (const kind of capacityKinds) {
  it.each(['submit', 'edit'] as const)(`${kind.name}实际字节恰满但无生命周期预留时%s在ACK前拒绝`, async method => {
    const { root, queue } = await fixture();
    const item = { ...input(), body: '', ...(kind.control ? { control: { kind: 'stop' as const, turnId: 'turn', expiresAt: Date.now() + 3600000 } } : {}) };
    await queue.submit(item); const bytes = metadataBytes(await diskRecords(root)); const before = await readFile(join(root, 'queue', 'operations.json'));
    const length = kind.budget - bytes * (method === 'submit' ? 2 : 1);
    const pending = method === 'submit' ? queue.submit({ ...item, id: randomUUID(), body: 'x'.repeat(length) }) : queue.edit(item.id, 1, { body: 'x'.repeat(length) });
    await expect(pending).rejects.toMatchObject({ code: 'capacity', status: 429 });
    expect((await readFile(join(root, 'queue', 'operations.json'))).equals(before)).toBe(true);
    expect(await queue.read(item.id)).toMatchObject({ state: 'queued', revision: 1, body: '' });
  }, 30000);
}
it('控制满额同时预留现存failed/claimed/queued项，状态推进跨revision位数并保留释放与compact边界', async () => {
  const { root, queue } = await fixture(); const budget = 2 * 1024 * 1024;
  const make = (conversationId: string) => ({ ...input(randomUUID(), conversationId), body: '', control: { kind: 'stop' as const, turnId: 'turn', expiresAt: Date.now() + 3600000 } });
  const first = make('failed'); await queue.submit(first); const firstClaim = (await queue.claimNext('mac'))!;
  let failed = await queue.markPotentialSend(first.id, firstClaim.revision, firstClaim.claimToken!);
  while (failed.revision < 9) failed = await queue.settle(first.id, failed.revision, firstClaim.claimToken!, 'failed');
  const second = make('claimed'); await queue.submit(second); const secondClaim = (await queue.claimNext('mac'))!; expect(secondClaim.id).toBe(second.id);
  const filler = make('queued'); await queue.submit(filler); const filled = await fillMetadata(queue, root, filler.id, budget);
  const fullBytes = metadataBytes(await diskRecords(root)); expect(fullBytes).toBeLessThanOrEqual(budget);
  failed = await queue.settle(first.id, 9, firstClaim.claimToken!, 'failed'); expect(failed.revision).toBe(10);
  expect(metadataBytes(await diskRecords(root))).toBe(fullBytes + 1);
  const marked = await queue.markPotentialSend(second.id, secondClaim.revision, secondClaim.claimToken!);
  expect(metadataBytes(await diskRecords(root))).toBe(fullBytes + 3);
  await expect(queue.confirmNeverSent(second.id, marked.revision, secondClaim.claimToken!, async () => false)).rejects.toMatchObject({ code: 'not-proven-never-sent' });
  await queue.confirmNeverSent(second.id, marked.revision, secondClaim.claimToken!, async () => true);
  let reclaimed = (await queue.claimNext('mac'))!; expect(reclaimed.id).toBe(second.id); expect(reclaimed.claimToken).not.toBe(secondClaim.claimToken);
  await queue.releaseClaim(second.id, reclaimed.revision, reclaimed.claimToken!);
  // 释放未发送claim只删当前元数据，仍须为其未来再领取保留容量。
  await expect(queue.edit(filler.id, filled.revision, { body: 'x'.repeat(filled.bodyLength + 1) })).rejects.toMatchObject({ code: 'capacity' });
  reclaimed = (await queue.claimNext('mac'))!;
  const sent = await queue.markPotentialSend(second.id, reclaimed.revision, reclaimed.claimToken!);
  await queue.settle(second.id, sent.revision, reclaimed.claimToken!, 'succeeded');
  const enlarged = await queue.edit(filler.id, filled.revision, { body: 'x'.repeat(filled.bodyLength + 1) }); expect(enlarged.state).toBe('queued');
  await queue.settle(first.id, failed.revision, firstClaim.claimToken!, 'succeeded');
  const next = (await queue.claimNext('mac'))!; expect(next.id).toBe(filler.id);
  const uncertain = await queue.markPotentialSend(filler.id, next.revision, next.claimToken!);
  const lastFailed = await queue.settle(filler.id, uncertain.revision, next.claimToken!, 'failed');
  expect(metadataBytes(await diskRecords(root))).toBeLessThanOrEqual(budget);
  await queue.settle(filler.id, lastFailed.revision, next.claimToken!, 'succeeded');
  for (const record of await diskRecords(root)) { expect(record.state).toBe('succeeded'); expect(record).not.toHaveProperty('body'); expect(record).not.toHaveProperty('claimToken'); }
}, 30000);
it('普通64MiB最大合法编辑后可claim、标记未知、记录失败并确定成功，实际元数据不越界', async () => {
  const { root, queue } = await fixture(); const budget = 64 * 1024 * 1024; const item = { ...input(), body: '' }; await queue.submit(item);
  const filled = await fillMetadata(queue, root, item.id, budget); expect(filled.bodyLength).toBeGreaterThan(63 * 1024 * 1024);
  const claim = (await queue.claimNext('mac'))!; expect(claim.id).toBe(item.id); expect(metadataBytes(await diskRecords(root))).toBeLessThanOrEqual(budget);
  const uncertain = await queue.markPotentialSend(item.id, claim.revision, claim.claimToken!); expect(uncertain.state).toBe('uncertain');
  const failed = await queue.settle(item.id, uncertain.revision, claim.claimToken!, 'failed'); expect(metadataBytes(await diskRecords(root))).toBeLessThanOrEqual(budget);
  await queue.settle(item.id, failed.revision, claim.claimToken!, 'succeeded'); expect(await queue.read(item.id)).not.toHaveProperty('body');
}, 60000);

it('运行时缺少显式directory必须在采用默认PrivateStore路径前拒绝', () => {
  for (const input of [{}, { directory: undefined }, { store: { directory: '/synthetic/unused' } }]) {
    expect(() => new OperationQueue({ ...input, gatewayId: 'gateway', authorize: async () => () => {} } as any))
      .toThrow('持久操作队列：invalid-input');
  }
});
