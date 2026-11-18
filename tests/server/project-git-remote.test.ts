// @vitest-environment node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { readCodexProjectState, parseCodexProjectState } from '../../server/codex-projects.js';
import { TurnChangeHistory } from '../../server/turn-change-history.js';
import { remoteRollouts } from '../../server/rollout-source.js';
import { rolloutRemote } from './fixtures/rollout-remote.js';
const exec = promisify(execFile);
const clean: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of clean.splice(0).reverse()) await fn(); }, 30000);
const thread = '01a1260e-bb6b-79c3-abdb-cfdf41878cfc';
async function target(nativeHome = true, name = 'target') {
  const f = await rolloutRemote({ nativeHome, target: name }); clean.push(() => f.close()); return f;
}
async function metadata(f: { root: string }, cwd: string, id = thread) {
  const d = join(f.root, 'archived_sessions'); await mkdir(d, { recursive: true });
  await writeFile(join(d, `rollout-fixture-${id}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { id, cwd } }) + '\nprivate body must never cross wire\n');
}
async function repo(f: { root: string }) {
  const p = join(await realpath(f.root), "repo 空格'[]"); await mkdir(p); await git(p, ['init']); await git(p, ['config', 'user.name', 'Fixture']); await git(p, ['config', 'user.email', 'fixture@example.invalid']); return p;
}
const git = async (cwd: string, args: string[]) => (await exec('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 })).stdout;
async function history(f: Awaited<ReturnType<typeof target>>, gateway = 'gateway', signal?: AbortSignal) {
  const home = await mkdtemp(join(tmpdir(), 'git-gateway-')); clean.push(() => rm(home, { recursive: true, force: true }));
  const rollouts = remoteRollouts(f.session, f.commands, gateway); clean.push(() => rollouts.close());
  return { home, rollouts, value: new TurnChangeHistory(home, { session: f.session, commands: f.commands, rollouts, gatewayId: gateway, signal }) };
}
it.each(['[]', '"local-projects"', 'true', '1e999', '{"unused":1e999,"local-projects":{"p":{"id":"p","rootPaths":["/not-a-repo",1e999,12345678901234567890123456789],"unused":-1e999}}}', '{"project-order":[1e999],"thread-project-membership-host-ids":{"a":1e999}}'])('项目必要字段投影与原JS parser差分保持 %s', async raw => {
  const f = await target(); await writeFile(join(f.root, '.codex-global-state.json'), raw);
  expect(await readCodexProjectState('/gateway', { session: f.session, commands: f.commands })).toEqual(parseCodexProjectState(raw, f.home));
});
it('项目实际坏UTF8字节按原Local readFile替换语义解析，投影不提前拒绝', async () => {
  const f = await target(); const bytes = Buffer.concat([Buffer.from('{"unused":"'), Buffer.from([0xff]), Buffer.from('","local-projects":{"p":{"id":"p","rootPaths":["/not-a-repo-'), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from('"]}}}')]);
  await writeFile(join(f.root, '.codex-global-state.json'), bytes);
  expect(await readCodexProjectState('/gateway', { session: f.session, commands: f.commands })).toEqual(parseCodexProjectState(bytes.toString('utf8'), f.home));
});
it('Remote 项目文件在命令写入和终止不可用时仍通过首次请求取得完整投影', async () => {
  const f = await target(false);
  await writeFile(join(f.root, '.codex-global-state.json'), JSON.stringify({ 'projectless-thread-ids': ['thread'] }));
  const call = f.session.call.bind(f.session);
  const intercepted = vi.spyOn(f.session, 'call').mockImplementation((method, params, options) => {
    if (method === 'command/exec/write' || method === 'command/exec/terminate') return Promise.reject(new Error('目标命令控制通道不可用'));
    return call(method, params, options);
  });
  try {
    const result = await readCodexProjectState('/gateway', { session: f.session, commands: f.commands });
    expect(result.projectlessThreadIds).toEqual(['thread']);
    expect(intercepted.mock.calls.map(([method]) => method)).toEqual(['command/exec']);
    expect(f.active).toBe(0);
  } finally {
    intercepted.mockRestore();
  }
});
it('大项目目录分成有界的 Remote 命令输出且保持全部会话归属', async () => {
  const f = await target();
  const ids = Array.from({ length: 3000 }, (_, index) => createHash('sha256').update(String(index)).digest('hex'));
  const raw = JSON.stringify({ 'projectless-thread-ids': ids });
  await writeFile(join(f.root, '.codex-global-state.json'), raw);
  const execute = f.commands.execute.bind(f.commands);
  const sizes: number[] = [];
  const commands = vi.spyOn(f.commands, 'execute').mockImplementation(async (options, input) => {
    const result = await execute(options, input);
    if (options.argv[3]?.includes('projectless-thread-ids')) sizes.push(result.stdout.length);
    return result;
  });
  try {
    const state = await readCodexProjectState('/gateway', { session: f.session, commands: f.commands });
    expect(state.projectlessThreadIds).toEqual(ids);
    expect(Math.max(...sizes)).toBeLessThan(45_000);
    expect(sizes.length).toBeGreaterThan(1);
  } finally {
    commands.mockRestore();
  }
}, 15000);

it('Remote项目worktree读取允许超过本地3秒的协议往返，仍执行真实只读git', async () => {
  const f = await target(true); const p = await repo(f);
  const linked = join(await realpath(f.root), 'linked');
  await git(p, ['commit', '--allow-empty', '-m', 'base']);
  await git(p, ['worktree', 'add', '-b', 'linked', linked]);
  await writeFile(join(f.root, '.codex-global-state.json'), JSON.stringify({
    'local-projects': { p: { id: 'p', rootPaths: [p] } }, 'project-order': ['p'],
  }));
  const call = f.session.call.bind(f.session); let held = false;
  const intercepted = vi.spyOn(f.session, 'call').mockImplementation(async (method, params, options) => {
    if (method === 'command/exec/terminate') throw new Error('目标终止通道不可用');
    if (method === 'command/exec/write') {
      const payload = JSON.parse(Buffer.from((params as any).deltaBase64, 'base64').toString());
      if (payload.argv?.[3]?.includes('worktree output too large')) {
        held = true;
        await new Promise(resolve => setTimeout(resolve, 3500));
      }
    }
    return call(method, params, options);
  });
  try {
    const state = await readCodexProjectState('/never/gateway', { session: f.session, commands: f.commands });
    expect(held).toBe(true);
    expect(intercepted.mock.calls.some(([method]) => method === 'command/exec/terminate')).toBe(false);
    expect(state.projectWorktrees).toEqual({ [p]: [linked] });
    expect(f.frames.filter(frame => frame.method === 'command/exec').length).toBe(3);
    expect(f.frames.filter(frame => frame.method === 'command/exec').every(frame =>
      !Object.hasOwn(frame.params as object, 'permissions'))).toBe(true);
    expect(f.active).toBe(0);
  } finally { intercepted.mockRestore(); }
}, 15000);
it('多个项目的worktree在目标合批，网络调用不随项目数量增长', async () => {
  const f = await target(); const p = await repo(f); const linked = join(await realpath(f.root), 'batch-linked');
  await git(p, ['commit', '--allow-empty', '-m', 'base']); await git(p, ['worktree', 'add', '-b', 'batch', linked]);
  const projects = [p, linked, '/missing-one', '/missing-two', '/missing-three'];
  await writeFile(join(f.root, '.codex-global-state.json'), JSON.stringify({ 'local-projects': Object.fromEntries(projects.map((root, i) => [String(i), { id: String(i), rootPaths: [root] }])), 'project-order': projects.map((_, i) => String(i)) }));
  const result = await readCodexProjectState('/never/gateway', { session: f.session, commands: f.commands });
  expect(result.projects).toEqual(projects); expect(result.projectWorktrees).toBeUndefined();
  // metadata握手一次 + 状态投影一次 + worktree合批一次。
  expect(f.frames.filter(frame => frame.method === 'command/exec')).toHaveLength(3);
});
it.each(['unused', 'required', 'root', 'mixed'])('合法深层JSON不引入Python递归深度限制：%s', async location => {
  const f = await target(); const deep = location === 'mixed' ? '{"k":['.repeat(12000) + '0' + ']}'.repeat(12000) : '['.repeat(1100) + '0' + ']'.repeat(1100);
  const raw = ['unused', 'mixed'].includes(location) ? `{"unused":${deep},"projectless-thread-ids":["preserved"]}` : location === 'required' ? `{"local-projects":{"p":{"unused":${deep}}},"projectless-thread-ids":["preserved"]}` : deep;
  await writeFile(join(f.root, '.codex-global-state.json'), raw);
  expect(await readCodexProjectState('/gateway', { session: f.session, commands: f.commands })).toEqual(parseCodexProjectState(raw, f.home));
});
it('深层未用字段仍完整校验JSON语法，不能跳过无效内容', async () => {
  const f = await target();
  for (const value of ['01', 'tru', 'NaN', '[0,]', '{"a":1,}', '{"a" 1}', '"bad\u0001"']) {
    const raw = `{"unused":${'['.repeat(1100)}${value}${']'.repeat(1100)},"projectless-thread-ids":["preserved"]}`;
    expect(() => parseCodexProjectState(raw, f.home)).toThrow(); await writeFile(join(f.root, '.codex-global-state.json'), raw);
    await expect(readCodexProjectState('/gateway', { session: f.session, commands: f.commands })).rejects.toThrow();
  }
});
async function until(check: () => boolean | Promise<boolean>, timeout = 3000) {
  const start = Date.now(); while (!await check()) { if (Date.now() - start > timeout) throw new Error('等待fixture超时'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
it('取消已开始的快照后实际git子进程归零且自有临时index被清理', async () => {
  const f = await target(); const p = await repo(f); await metadata(f, p);
  await writeFile(join(p, '.gitattributes'), '*.pause filter=pause\n');
  await writeFile(join(p, 'slow.pause'), 'text\n');
  await git(p, ['config', 'filter.pause.clean', `python3 -c "import os,time;open('child.pid','w').write(str(os.getpid()));time.sleep(30)"`]);
  const abort = new AbortController(); const h = await history(f, 'gateway', abort.signal);
  const op = h.value.beforeStart(thread);
  await until(async () => { try { return Boolean(await readFile(join(p, 'child.pid'), 'utf8')); } catch { return false; } });
  const pid = Number(await readFile(join(p, 'child.pid'), 'utf8'));
  const ownedName = 'codex-turn-index-' + f.requests.find(x => x.mode === 'snapshot')!.operation;
  await until(async () => (await readdir(tmpdir())).includes(ownedName)); abort.abort(); await op;
  await until(() => f.active === 0); await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
  expect((await readdir(tmpdir())).includes(ownedName)).toBe(false);
  expect(await f.session.call('fixture/alive')).toBe(42); expect(f.session.ready).toBe(true);
});
it('项目读取真实目标home，两个同路径目标状态隔离并保留membership/alias', async () => {
  const a = await target(false, 'A'); const b = await target(false, 'B');
  const state = (root: string) => JSON.stringify({ 'local-projects': { p: { id: 'legacy', rootPaths: [root, root + '/extra'] } }, 'project-order': ['legacy'],
    'thread-project-assignments': { yes: { projectKind: 'local', projectId: 'legacy' }, no: { projectKind: 'local', projectId: 'legacy' } },
    'thread-project-membership-host-ids': { yes: 'local:/rollout', no: 'local:/gateway' }, 'app-server-project-id-by-legacy-project-id-by-host': { 'local:/rollout': { legacy: 'native' } }, unrelated: 'x'.repeat(3 * 1024 * 1024) });
  await writeFile(join(a.root, '.codex-global-state.json'), state('/A')); await writeFile(join(b.root, '.codex-global-state.json'), state('/B'));
  const one = await readCodexProjectState('/never/gateway/state.json', { session: a.session, commands: a.commands });
  const two = await readCodexProjectState('/never/gateway/state.json', { session: b.session, commands: b.commands });
  expect(one.projects).toEqual(['/A', '/A/extra']); expect(two.projects).toEqual(['/B', '/B/extra']);
  expect(one.projectMembership).toEqual({ byThreadId: { yes: '/A' }, byProjectId: { legacy: '/A', native: '/A' }, extraRoots: { '/A': ['/A/extra'] } });
});
it('远程快照使用目标metadata并保持用户index和既有staged内容', async () => {
  const f = await target(); const p = await repo(f); await writeFile(join(p, 'a'), 'base\n'); await git(p, ['add', '.']); await git(p, ['commit', '-m', 'base']);
  await writeFile(join(p, 'a'), 'staged\n'); await git(p, ['add', '.']); await writeFile(join(p, 'a'), 'before\n'); await metadata(f, p);
  const before = await readFile(join(p, '.git/index')); const h = await history(f);
  await h.value.beforeStart(thread, '/gateway/wrong'); h.value.observe({ method: 'turn/started', params: { threadId: thread, turn: { id: 'turn' } } }); await h.value.flush();
  await writeFile(join(p, 'a'), 'after\nnew\n'); h.value.observe({ method: 'turn/completed', params: { threadId: thread, turn: { id: 'turn' } } }); await h.value.flush();
  expect(await h.value.get(thread, { id: 'turn' })).toEqual({ additions: 2, deletions: 1, source: 'git-snapshot' });
  expect(await readFile(join(p, '.git/index'))).toEqual(before); expect(await git(p, ['show', ':a'])).toBe('staged\n');
  expect(f.session.ready).toBe(true); expect(f.active).toBe(0);
});
it('Remote missing metadata不负缓存，同thread与gateway的持久历史隔离', async () => {
  const f = await target(); const p = await repo(f); const h = await history(f);
  await h.value.beforeStart(thread); await h.value.cancelStart(thread); await metadata(f, p); await writeFile(join(p, 'new'), 'before\n');
  await h.value.beforeStart(thread); h.value.observe({ method: 'turn/started', params: { threadId: thread, turn: { id: 'turn' } } }); await h.value.flush();
  await writeFile(join(p, 'new'), 'before\nafter\n'); h.value.observe({ method: 'turn/completed', params: { threadId: thread, turn: { id: 'turn' } } }); await h.value.flush();
  expect(await h.value.get(thread, { id: 'turn' })).toMatchObject({ additions: 1, deletions: 0 });
  const otherRollouts = remoteRollouts(f.session, f.commands, 'other'); clean.push(() => otherRollouts.close());
  const other = new TurnChangeHistory(h.home, { session: f.session, commands: f.commands, rollouts: otherRollouts, gatewayId: 'other' });
  expect(await other.get(thread, { id: 'turn' })).toBeNull();
});
it('项目必要数据超过2MiB仍完整分页，真实worktree归属与已注册工作区独立', async () => {
  const f = await target(); const p = await repo(f); await writeFile(join(p, 'a'), 'base\n'); await git(p, ['add', '.']); await git(p, ['commit', '-m', 'base']);
  const root = await realpath(f.root);
  const registered = join(root, 'registered'); const linked = join(root, 'linked'); const plain = join(root, 'plain'); await mkdir(plain);
  await git(p, ['worktree', 'add', '-b', 'registered', registered]); await git(p, ['worktree', 'add', '-b', 'linked', linked]);
  const projectless = Array.from({ length: 3000 }, (_, i) => `${i}-` + 'x'.repeat(1000));
  await writeFile(join(f.root, '.codex-global-state.json'), JSON.stringify({ 'local-projects': { a: { id: 'a', rootPaths: [p] }, b: { id: 'b', rootPaths: [registered] }, c: { id: 'c', rootPaths: [plain] } }, 'projectless-thread-ids': projectless }));
  const state = await readCodexProjectState('/gateway', { session: f.session, commands: f.commands });
  expect(state.projectlessThreadIds).toEqual(projectless); expect(state.projectWorktrees).toEqual({ [p]: [linked] });
  const offsets = f.frames.flatMap(frame => {
    if (frame.method !== 'command/exec') return [];
    const params = frame.params as { command: string[]; streamStdin: boolean };
    if (params.streamStdin) return [];
    const request = JSON.parse(Buffer.from(params.command.at(-1)!, 'base64').toString());
    return [JSON.parse(request.argv.at(-1)).offset];
  });
  expect(offsets).toEqual([0, 1048576, 2097152]);
  await writeFile(join(p, '.git/config'), '[invalid');
  await expect(readCodexProjectState('/gateway', { session: f.session, commands: f.commands })).rejects.toThrow();
}, 30000);
it('历史namespace核验完整session/Commands/gateway，两个目标同thread不混读', async () => {
  const a = await target(true, 'A'); const b = await target(true, 'B'); const h = await history(a); const rolls = remoteRollouts(b.session, b.commands, 'gateway'); clean.push(() => rolls.close());
  expect(() => new TurnChangeHistory(h.home, { session: a.session, commands: a.commands, rollouts: rolls, gatewayId: 'gateway' })).toThrow();
  h.value.observe({ method: 'turn/diff/updated', params: { threadId: thread, turnId: 'same', diff: '--- a/a\n+++ b/a\n@@ -0,0 +1 @@\n+one\n' } }); await h.value.flush();
  const other = new TurnChangeHistory(h.home, { session: b.session, commands: b.commands, rollouts: rolls, gatewayId: 'gateway' });
  expect(await other.get(thread, { id: 'same' })).toBeNull(); expect(await h.value.get(thread, { id: 'same' })).toMatchObject({ additions: 1 });
});
it('Git完整numstat超过Commands的2MiB仍按原8MiB语义统计，无截断且不改用户index', async () => {
  const f = await target(); const p = await repo(f); const directory = join(p, 'a'.repeat(200), 'b'.repeat(200), 'c'.repeat(200)); await mkdir(directory, { recursive: true });
  for (let i = 0; i < 3600; i++) await writeFile(join(directory, String(i)), 'before\n');
  await git(p, ['add', '.']); await git(p, ['commit', '-m', 'base']); await metadata(f, p); const h = await history(f);
  const index = await readFile(join(p, '.git/index')); await h.value.beforeStart(thread);
  h.value.observe({ method: 'turn/started', params: { threadId: thread, turn: { id: 'large' } } }); await h.value.flush();
  for (let i = 0; i < 3600; i++) await writeFile(join(directory, String(i)), 'after\nnew\n');
  h.value.observe({ method: 'turn/completed', params: { threadId: thread, turn: { id: 'large' } } }); await h.value.flush();
  expect(await h.value.get(thread, { id: 'large' })).toEqual({ additions: 7200, deletions: 3600, source: 'git-snapshot' });
  expect(await readFile(join(p, '.git/index'))).toEqual(index);
  expect(f.requests.filter(x => x.mode === 'git' && (x.args as string[])?.[0] === 'diff').map(x => x.offset)).toEqual([0, 1048576, 2097152]);
}, 60000);
it('目标Git实际8MiB输出完整八窗返回，8MiB加一明确失败而不提高Commands捕获上限', async () => {
  const f = await target(); const p = await repo(f); const h = await history(f);
  const run = (h.value as unknown as { git(cwd: string, args: string[]): Promise<string> }).git.bind(h.value);
  const body = 'x'.repeat(8 * 1024 * 1024); await writeFile(join(p, 'blob'), body);
  const hash = (await git(p, ['hash-object', '-w', '--', 'blob'])).trim();
  expect(await run(p, ['show', hash])).toBe(body);
  expect(f.requests.filter(x => x.mode === 'git').map(x => x.offset)).toEqual(Array.from({ length: 8 }, (_, i) => i * 1048576));
  await writeFile(join(p, 'blob'), body + 'x'); const excessive = (await git(p, ['hash-object', '-w', '--', 'blob'])).trim();
  await expect(run(p, ['show', excessive])).rejects.toThrow(); expect(await f.session.call('fixture/alive')).toBe(42); expect(f.active).toBe(0);
}, 30000);
it('Git自身10秒超时后清理临时index和真实filter进程，结果保持未知', async () => {
  const f = await target(); const p = await repo(f); await metadata(f, p);
  await writeFile(join(p, '.gitattributes'), '*.pause filter=pause\n'); await writeFile(join(p, 'slow.pause'), 'text\n');
  await git(p, ['config', 'filter.pause.clean', `python3 -c "import os,time;open('child.pid','w').write(str(os.getpid()));time.sleep(30)"`]);
  const h = await history(f); const start = Date.now(); await h.value.beforeStart(thread);
  const ownedName = 'codex-turn-index-' + f.requests.find(x => x.mode === 'snapshot')!.operation;
  expect(Date.now() - start).toBeLessThan(13000); const pid = Number(await readFile(join(p, 'child.pid'), 'utf8'));
  await until(() => f.active === 0); await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
  expect((await readdir(tmpdir())).includes(ownedName)).toBe(false);
  expect(await h.value.get(thread, { id: 'unknown' })).toBeNull(); expect(await f.session.call('fixture/alive')).toBe(42);
}, 20000);
it('Git主进程已退出而后台filter持有stderr时，10秒内终结实际后代并清理index', async () => {
  const f = await target(); const p = await repo(f); await metadata(f, p);
  await writeFile(join(p, '.gitattributes'), '*.pause filter=pause\n'); await writeFile(join(p, 'pipe.pause'), 'text\n');
  await writeFile(join(p, 'filter.py'), "import os,sys,time\nif os.fork()==0:\n os.dup2(os.open(os.devnull,os.O_WRONLY),1)\n open('pipe.pid','w').write(str(os.getpid()))\n time.sleep(30)\n os._exit(0)\nsys.stdout.write(sys.stdin.read())\n");
  await git(p, ['config', 'filter.pause.clean', 'python3 filter.py']);
  let pid: number | undefined;
  clean.push(async () => { try { pid ??= Number(await readFile(join(p, 'pipe.pid'), 'utf8')); process.kill(pid, 'SIGKILL'); } catch { /* 仅回收本夹具自己记录的后代。 */ } });
  const h = await history(f); const start = Date.now(); await h.value.beforeStart(thread);
  expect(Date.now() - start).toBeLessThan(13000); pid = Number(await readFile(join(p, 'pipe.pid'), 'utf8'));
  await until(() => f.active === 0); await until(() => { try { process.kill(pid!, 0); return false; } catch { return true; } }, 500);
  const ownedName = 'codex-turn-index-' + f.requests.find(x => x.mode === 'snapshot')!.operation;
  expect((await readdir(tmpdir())).includes(ownedName)).toBe(false); expect(await f.session.call('fixture/alive')).toBe(42);
}, 20000);
it('实际损坏的HEAD引用不能伪装unborn并产生可信零快照', async () => {
  const f = await target(); const p = await repo(f); await writeFile(join(p, 'a'), 'base\n'); await git(p, ['add', '.']); await git(p, ['commit', '-m', 'base']); await metadata(f, p);
  const ref = (await git(p, ['symbolic-ref', 'HEAD'])).trim(); await writeFile(join(p, '.git', ref), 'not-a-real-hash\n');
  const h = await history(f); await h.value.beforeStart(thread); h.value.observe({ method: 'turn/started', params: { threadId: thread, turn: { id: 'broken' } } }); await h.value.flush();
  h.value.observe({ method: 'turn/completed', params: { threadId: thread, turn: { id: 'broken' } } }); await h.value.flush();
  expect(await h.value.get(thread, { id: 'broken' })).toBeNull(); expect(await f.session.call('fixture/alive')).toBe(42);
});
it('受控Windows元数据拒绝缺盘符的root-relative cwd，不能执行猜测目录的snapshot', async () => {
  const f = await rolloutRemote({ windows: true }); clean.push(() => f.close()); await metadata(f, '\\repo'); const h = await history(f);
  await h.value.beforeStart(thread); expect(f.requests.filter(x => x.mode === 'snapshot')).toEqual([]);
});
it('目标Git对象目录真实权限失败保持unknown，不修改用户index或提升权限', async () => {
  const f = await target(); const p = await repo(f); await writeFile(join(p, 'a'), 'base\n'); await git(p, ['add', '.']); await git(p, ['commit', '-m', 'base']); await metadata(f, p);
  const h = await history(f); await h.value.beforeStart(thread); h.value.observe({ method: 'turn/started', params: { threadId: thread, turn: { id: 'denied' } } }); await h.value.flush();
  const index = await readFile(join(p, '.git/index')); const objects = join(p, '.git/objects'); const mode = (await stat(objects)).mode & 0o777;
  try {
    await chmod(objects, 0o500); await writeFile(join(p, 'a'), 'new object denied\n');
    h.value.observe({ method: 'turn/completed', params: { threadId: thread, turn: { id: 'denied' } } }); await h.value.flush();
    expect(await h.value.get(thread, { id: 'denied' })).toBeNull(); expect(await readFile(join(p, '.git/index'))).toEqual(index);
    expect((await stat(objects)).mode & 0o777).toBe(0o500); expect(f.frames.filter(x => x.method === 'command/exec').every(x => !Object.hasOwn(x.params as object, 'permissionProfile'))).toBe(true);
  } finally { await chmod(objects, mode); }
});
it('受控Windows项目使用initialize的home与目标membership host，不按网关OS猜路径', async () => {
  const f = await rolloutRemote({ windows: true, home: 'C:\\Codex Home' }); clean.push(() => f.close());
  const raw = JSON.stringify({ 'local-projects': { p: { id: 'p', rootPaths: ['C:\\Project', 'D:\\Shared'] } }, 'thread-project-assignments': { t: { projectKind: 'local', projectId: 'p' } }, 'thread-project-membership-host-ids': { t: 'local:C:\\Codex Home' }, 'app-server-project-id-by-legacy-project-id-by-host': { 'local:C:\\Codex Home': { p: 'native' } } });
  await writeFile(join(f.root, '.codex-global-state.json'), raw);
  expect(await readCodexProjectState('/gateway/linux', { session: f.session, commands: f.commands })).toEqual(parseCodexProjectState(raw, f.home));
});
