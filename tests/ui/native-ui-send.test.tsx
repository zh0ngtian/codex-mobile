import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AppBootstrap } from '../../src/App';
import { HttpOperationPendingError } from '../../src/backends/http-transport';
import * as threadListLoader from '../../src/app-server/thread-list-loader';
const boundary = vi.hoisted(() => ({ requests: [] as Array<{ method: string; params: any; options?: { priority?: string } }>, threadRecords: [] as Array<Record<string, any>>, threadReadBarrier: null as Promise<void> | null, projectBarrier: null as Promise<void> | null, priorityBarrier: null as Promise<void> | null, listBarrier: null as Promise<void> | null, searchBarrier: null as Promise<void> | null, listFailure: false, options: null as any, client: null as any, release: null as null | (() => void), failSend: false, immediateSend: false, nextThreadId: 'sent-thread', delayRevert: false, pendingMethod: '', releaseRevert: null as null | (() => void), rejectStart: null as null | (() => void) }));
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
 constructor(private options: any) { boundary.options = options; }
 client() { return boundary.client; } socket() { return null; } close() {} reconnect() {}
 sync(backends: any[]) {
  if (!backends.length) return;
  const client = { onNotification() { return () => {}; }, onThreadMetadata() { return () => {}; }, request: async (method: string, params: any, options?: { priority?: string }) => {
   boundary.requests.push({ method, params, options });
   if (method === 'model/list') return { data: [{ model: 'gpt', displayName: 'GPT', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] }] };
   if (method === 'permissionProfile/list') return { data: [{ id: ':workspace', allowed: true }] };
   if (method === 'config/read') return { config: { model: 'gpt', sandbox_mode: 'workspace-write', model_reasoning_effort: 'high' } };
   if (method === 'thread/list') { await boundary.listBarrier; if (boundary.listFailure) throw new Error('列表查询失败'); }
   if (method === 'thread/search') { await boundary.searchBarrier; return { data: [], nextCursor: null }; }
   if (method === 'thread/read') { const thread = boundary.threadRecords.find(thread => thread.id === params.threadId); await boundary.threadReadBarrier; if (thread) return { thread }; }
   if (method === 'thread/list' && params.cwd) { const records = boundary.threadRecords.filter(thread => thread.cwd === params.cwd); const offset = Number(params.cursor ?? 0); const end = offset + params.limit; return { data: records.slice(offset, end), nextCursor: end < records.length ? String(end) : null }; }
   if (method === 'thread/loaded/list') { await boundary.priorityBarrier; return { data: boundary.threadRecords.filter(thread => thread.status?.type === 'active').map(thread => thread.id), nextCursor: null }; }
   if (method === 'thread/start') return { thread: { id: boundary.nextThreadId, cwd: null, turns: [] }, model: 'gpt' };
   if (method === boundary.pendingMethod) throw new HttpOperationPendingError(`pending-${params.threadId}-${method}`, { id: 'pending-rpc', method, params });
   if (method === 'thread/revert' && boundary.delayRevert) return new Promise(resolve => { boundary.releaseRevert = () => resolve({ thread: { id: params.threadId, turns: [] } }); });
   if (method === 'turn/start') { const turnId = params.threadId === 'thread-b' ? 'turn-b' : 'turn-live'; if (boundary.failSend) throw new Error('真实发送失败'); if (boundary.immediateSend) return { turn: { id: turnId, status: 'inProgress', items: [] } }; return new Promise((resolve, reject) => { boundary.release = () => resolve({ turn: { id: turnId, status: 'inProgress', items: [] } }); boundary.rejectStart = () => reject(new Error('旧会话发送失败')); }); }
   if (method === 'thread/turns/list') return { data: [], nextCursor: null };
   if (method === 'thread/read' && params.threadId === 'unloaded') return { thread: { id: 'unloaded', cwd: null, turns: [] } };
   return { data: [], items: [], marketplaces: [], nextCursor: null };
  } };
  boundary.client = client;
  queueMicrotask(() => { this.options.onConnection(backends[0].id, 'online'); this.options.onReady(backends[0].id, client); });
 }
} }));
const posts: any[] = []; let queueItems: any[] = [];
function command(id: string, name: string, params: Record<string, unknown> = {}) { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } })); }
const pendingReads: Array<() => void> = [];
function deferredRead() {
 let resolve!: () => void; let reject!: (reason: Error) => void;
 const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
 pendingReads.push(resolve);
 return { promise, resolve, reject };
}
afterEach(async () => { cleanup(); await act(async () => { pendingReads.splice(0).forEach(resolve => resolve()); }); boundary.requests = []; boundary.threadRecords = []; boundary.threadReadBarrier = null; boundary.projectBarrier = null; boundary.priorityBarrier = null; boundary.listBarrier = null; boundary.searchBarrier = null; boundary.listFailure = false; boundary.client = null; boundary.options = null; boundary.release = null; boundary.failSend = false; boundary.immediateSend = false; boundary.nextThreadId = 'sent-thread'; boundary.delayRevert = false; boundary.pendingMethod = ''; boundary.releaseRevert = null; boundary.rejectStart = null; queueItems = []; posts.length = 0; localStorage.clear(); delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).webkit; delete (window as any).codexMobilePublishNativeSnapshot; vi.unstubAllGlobals(); });
async function setup(native = true, projectState = { projects: [] as string[], projectlessThreadIds: [] as string[] }, waitForSettings = true) {
 if (native) Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (s: unknown) => posts.push(s) });
 vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
  if (String(url).includes('/api/follow-ups')) {
   if (options?.body) { const action = JSON.parse(String(options.body)); if (action.action === 'enqueue') queueItems.push({ ...action, revision: 1, state: 'queued' }); if (action.action === 'cancel') queueItems = queueItems.filter(item => item.id !== action.id); }
   return new Response(JSON.stringify({ items: queueItems }));
  }
  if (String(url).includes('/api/projects')) await boundary.projectBarrier;
  return new Response(JSON.stringify(projectState));
 }));
 render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: 'a', backends: [{ id: 'a', hostId: 'host', name: 'Mac', enabled: true, order: 0, baseUrl: 'https://gateway.invalid', token: 'SECRET' }] }} />);
 if (native) await waitFor(() => expect(waitForSettings ? posts.at(-1)?.models?.[0]?.value === 'gpt' : posts.at(-1)?.ready).toBe(true));
 else await waitFor(() => expect(boundary.requests.some(request => request.method === 'model/list')).toBe(true));
 return posts.at(-1)?.contextId as string;
}

function assertSwiftNavigationSnapshots(snapshots: any[]) {
 if (process.platform !== 'darwin') return;
 const directory = mkdtempSync(join(tmpdir(), 'native-startup-navigation-'));
 try {
  const names = ['NativeJSONValue', 'NativeCommand', 'NativeCommandResult', 'NativeOption', 'NativeBackend', 'NativeNavigationItem', 'NativeGroup', 'NativeAttachment', 'NativeMessage', 'NativePanelItem', 'NativePanel', 'NativeContextUsage', 'NativeRateLimit', 'NativeSnapshot'];
  const executable = join(directory, 'decode');
  const compiled = spawnSync('xcrun', ['swiftc', ...names.map(name => `mobile/ios/NativeUI/${name}.swift`), 'tests/ci/native-ui-decode.swift', '-o', executable], { encoding: 'utf8', timeout: 90_000 });
  expect(compiled.status, compiled.error?.message ?? compiled.stderr).toBe(0);
  const result = spawnSync(executable, ['--navigation'], { input: JSON.stringify(snapshots), encoding: 'utf8', timeout: 15_000 });
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(result.stdout).toContain('Native navigation snapshots decoded');
 } finally { rmSync(directory, { recursive: true, force: true }); }
}

// 只替换外部连接与HTTP边界，以下断言经过真实App业务状态、导航投影和NativeRuntime发布。
it('真实App冷启动在目录、优先摘要和首批普通会话未完成前持续加载，成功空项目才ready', async () => {
 const directory = deferredRead(); const priority = deferredRead(); const page = deferredRead(); const projectless = deferredRead();
 boundary.projectBarrier = directory.promise; boundary.priorityBarrier = priority.promise; boundary.listBarrier = page.promise; boundary.threadReadBarrier = projectless.promise;
 await setup(true, { projects: ['/pending'], projectlessThreadIds: ['missing'] }, false);
 expect(posts.at(-1)).toMatchObject({ ready: true, navigationLoading: true });
 const startupSnapshots = [posts.at(-1)];
 expect(posts.at(-1).groups.filter((group: any) => group.category === 'project')).toEqual([]);
 await act(async () => directory.resolve());
 const groups = () => posts.at(-1).groups.filter((group: any) => group.category === 'project');
 await waitFor(() => expect(groups()).toHaveLength(2));
 expect(groups().every((group: any) => group.loading === 'loading' && !group.items.length)).toBe(true);
 startupSnapshots.push(posts.at(-1));
 expect(posts.at(-1).navigationLoading).toBe(true);
 const project = groups().find((group: any) => group.cwd === '/pending');
 await act(async () => command('collapse-pending', 'project.toggle', project.command.params));
 await waitFor(() => expect(groups().find((group: any) => group.cwd === '/pending').collapsed).toBe(true));
 await act(async () => command('expand-pending', 'project.toggle', project.command.params));
 await waitFor(() => expect(groups().find((group: any) => group.cwd === '/pending')).toMatchObject({ collapsed: false, loading: 'loading' }));
 await act(async () => priority.resolve());
 await waitFor(() => expect(boundary.requests.some(request => request.method === 'thread/list')).toBe(true));
 expect(groups().every((group: any) => group.loading === 'loading')).toBe(true);
 expect(posts.at(-1).navigationLoading).toBe(true);
 await act(async () => { page.resolve(); projectless.resolve(); });
 await waitFor(() => expect(groups().every((group: any) => group.loading === 'ready')).toBe(true));
 expect(posts.at(-1).navigationLoading).toBe(false);
 expect(groups().every((group: any) => !group.items.length)).toBe(true);
 assertSwiftNavigationSnapshots([...startupSnapshots, posts.at(-1)]);
}, 120_000);
it('真实App空优先摘要不能提前结束普通列表首查，成功真空列表才停止加载', async () => {
 const page = deferredRead(); boundary.listBarrier = page.promise;
 await setup(true, undefined, false);
 await waitFor(() => expect(boundary.requests.some(request => request.method === 'thread/list')).toBe(true));
 expect(posts.at(-1)).toMatchObject({ ready: true, navigationLoading: true });
 await act(async () => page.resolve());
 await waitFor(() => expect(posts.at(-1)?.navigationLoading).toBe(false));
 expect(posts.at(-1).groups.every((group: any) => !group.items.length)).toBe(true);
});
it('真实App普通列表首次失败可见且重试期间加载，成功后退出错误', async () => {
 boundary.listFailure = true;
 await setup(true, undefined, false);
 const failure = () => posts.at(-1)?.groups.find((group: any) => group.id === 'list-error');
 await waitFor(() => expect(failure()).toBeDefined());
 expect(posts.at(-1).navigationLoading).toBe(false);
 const page = deferredRead(); boundary.listBarrier = page.promise; boundary.listFailure = false;
 await act(async () => command('retry-empty-list', failure().items[0].command.name));
 await waitFor(() => expect(posts.at(-1)?.navigationLoading).toBe(true));
 await act(async () => page.resolve());
 await waitFor(() => expect(posts.at(-1)?.navigationLoading).toBe(false));
 expect(failure()).toBeUndefined();
});
it('真实App项目首查失败保留重试动作，重试成功空项目成为ready', async () => {
 boundary.listFailure = true;
 await setup(true, { projects: ['/failed'], projectlessThreadIds: [] });
 const project = () => posts.at(-1)?.groups.find((group: any) => group.cwd === '/failed');
 await waitFor(() => expect(project()?.loading).toBe('error'));
 expect(posts.at(-1).navigationLoading).toBe(false);
 const page = deferredRead(); boundary.listBarrier = page.promise; boundary.listFailure = false;
 const retry = project().actions.find((action: any) => action.command?.name === 'project.retry');
 await act(async () => command('retry-empty-project', retry.command.name, retry.command.params));
 await waitFor(() => expect(project()?.loading).toBe('loading'));
 await act(async () => page.resolve());
 await waitFor(() => expect(project()).toMatchObject({ loading: 'ready', items: [] }));
});
it('真实App搜索空结果不沿用仍在进行的普通列表加载', async () => {
 const page = deferredRead(); const search = deferredRead(); boundary.listBarrier = page.promise; boundary.searchBarrier = search.promise;
 await setup(true, undefined, false);
 await act(async () => { command('open-empty-search', 'navigation.sidebar', { open: true }); command('query-empty-search', 'navigation.search', { value: '不存在的结果' }); });
 await waitFor(() => expect(posts.at(-1)?.groups[0]).toMatchObject({ category: 'search', loading: 'loading' }));
 expect(posts.at(-1).navigationLoading).toBe(true);
 await act(async () => search.resolve());
 await waitFor(() => expect(posts.at(-1)?.groups[0]).toMatchObject({ category: 'search', items: [], loading: undefined }));
 expect(posts.at(-1).navigationLoading).toBe(true);
 await act(async () => page.resolve());
});
it('真实App已有项目会话在展开侧栏触发的静默刷新期间保留内容且不闪加载', async () => {
 boundary.threadRecords = [{ id: 'existing', name: '已有会话', cwd: '/existing', turns: [] }];
 await setup(true, { projects: ['/existing'], projectlessThreadIds: [] });
 const project = () => posts.at(-1)?.groups.find((group: any) => group.cwd === '/existing');
 await waitFor(() => expect(project()?.items[0]?.threadId).toBe('existing'));
 const before = boundary.requests.filter(request => request.method === 'thread/list').length;
 const page = deferredRead(); boundary.listBarrier = page.promise;
 await act(async () => command('open-for-silent-refresh', 'navigation.sidebar', { open: true }));
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'thread/list').length).toBeGreaterThan(before));
 expect(project()).toMatchObject({ loading: 'ready', items: [{ threadId: 'existing' }] });
 expect(posts.at(-1).navigationLoading).toBe(false);
 await act(async () => page.resolve());
});

it('真实App冷启动将额度查询的后台选项传给客户端', async () => {
 await setup();
 expect(boundary.requests.find(request => request.method === 'account/rateLimits/read')?.options).toEqual({ priority: 'background' });
});
it.each([
 ['未读', ['unread']],
 ['运行中', ['running']],
 ['关注、未读和运行中', ['pin', 'unread', 'running']],
] as Array<[string, string[]]>)('无项目有%s独立摘要时，真实加载更多路由按五条增加普通会话并保留摘要', async (_label, prioritizedIds) => {
 const ordinary = Array.from({ length: 17 }, (_, index) => ({ id: `regular-${index}`, cwd: null, recencyAt: 100 - index, status: { type: 'idle' }, turns: [] }));
 boundary.threadRecords = [
  ...prioritizedIds.map(id => ({ id, cwd: null, recencyAt: 1, status: { type: id === 'running' ? 'active' : 'idle' }, turns: [] })),
  ...ordinary,
 ];
 if (prioritizedIds.includes('pin')) localStorage.setItem('codex-mobile:pinned:a', '["pin"]');
 if (prioritizedIds.includes('unread')) localStorage.setItem('codex-mobile:unread:a', '["unread"]');
 const projectlessThreadIds = boundary.threadRecords.map(thread => thread.id);
 const loadProjectless = vi.spyOn(threadListLoader, 'loadProjectlessThreadRecords');
 const group = () => posts.at(-1)?.groups.find((entry: any) => entry.category === 'project' && entry.cwd === '');
 const ordinaryIds = () => group()?.items.filter((item: any) => !item.isPinned && !item.isUnread && !item.running).map((item: any) => item.threadId);
 const expectRetainedSummaries = () => {
  for (const id of prioritizedIds) {
   const expected = { threadId: id, ...(id === 'pin' ? { isPinned: true } : id === 'unread' ? { isUnread: true } : { running: true }) };
   expect(group().items).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
   if (id === 'pin') expect(posts.at(-1).groups.find((entry: any) => entry.category === 'pinned').items).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
  }
 };
 try {
  await setup(true, { projects: [], projectlessThreadIds });
  await waitFor(() => expect(ordinaryIds()).toEqual(ordinary.slice(0, 5).map(thread => thread.id)));
  expectRetainedSummaries();
  for (const targetCount of [10, 15]) {
   const more = group().actions.find((action: any) => action.command?.name === 'project.more');
   expect(more.disabled).toBe(false);
   await act(async () => { command(`projectless-more-${targetCount}`, more.command.name, more.command.params); });
   expect(loadProjectless).toHaveBeenLastCalledWith(boundary.client, projectlessThreadIds, targetCount, new Set(prioritizedIds));
   await waitFor(() => expect(ordinaryIds()).toEqual(ordinary.slice(0, targetCount).map(thread => thread.id)));
   await waitFor(() => expect(group().actions.find((action: any) => action.command?.name === 'project.more').disabled).toBe(false));
   expectRetainedSummaries();
  }
 } finally {
  loadProjectless.mockRestore();
 }
});
async function setupProjectlessPaginationRace(withOtherProject = false) {
 boundary.threadRecords = [
  { id: 'unread', cwd: null, recencyAt: 1, status: { type: 'idle' }, turns: [] },
  ...Array.from({ length: 17 }, (_, index) => ({ id: `regular-${index}`, name: `旧连接-${index}`, cwd: null, recencyAt: 100 - index, status: { type: 'idle' }, turns: [] })),
 ];
 const projectlessThreadIds = boundary.threadRecords.map(thread => thread.id);
 if (withOtherProject) boundary.threadRecords.push(...Array.from({ length: 11 }, (_, index) => ({ id: `other-${index}`, cwd: '/other', recencyAt: 100 - index, status: { type: 'idle' }, turns: [] })));
 localStorage.setItem('codex-mobile:unread:a', '["unread"]');
 await setup(true, { projects: withOtherProject ? ['/other'] : [], projectlessThreadIds });
 const group = () => posts.at(-1)?.groups.find((entry: any) => entry.category === 'project' && entry.cwd === '');
 const ordinaryIds = () => group()?.items.filter((item: any) => !item.isPinned && !item.isUnread && !item.running).map((item: any) => item.threadId);
 const more = () => group()?.actions.find((action: any) => action.command?.name === 'project.more');
 const expectedIds = (count: number) => Array.from({ length: count }, (_, index) => `regular-${index}`);
 const loadMore = async (id: string) => {
  const action = more();
  await act(async () => { command(id, action.command.name, action.command.params); });
 };
 await waitFor(() => expect(ordinaryIds()).toEqual(expectedIds(5)));
 return { group, ordinaryIds, more, expectedIds, loadMore };
}
it('无项目分页悬挂时拒绝disabled原生命令且快速重复点击只读取一轮，完成后继续加载十五条', async () => {
 const { group, ordinaryIds, more, expectedIds, loadMore } = await setupProjectlessPaginationRace();
 const first = deferredRead();
 boundary.threadReadBarrier = first.promise;
 const loadProjectless = vi.spyOn(threadListLoader, 'loadProjectlessThreadRecords');
 try {
  await loadMore('pending-more-a');
  await waitFor(() => expect(more()?.disabled).toBe(true));
  await act(async () => {
   const params = more().command.params;
   command('pending-more-b', 'project.more', params);
   command('pending-more-c', 'project.more', params);
  });
  await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'pending-more-c')).toBeDefined());
  expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'pending-more-b')).toMatchObject({ ok: false });
  expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'pending-more-c')).toMatchObject({ ok: false });
  expect(loadProjectless).toHaveBeenCalledTimes(1);
  expect(ordinaryIds()).toEqual(expectedIds(5));
  await act(async () => { first.resolve(); });
  await waitFor(() => expect(ordinaryIds()).toEqual(expectedIds(10)));
  await waitFor(() => expect(more()?.disabled).toBe(false));
  boundary.threadReadBarrier = null;
  await loadMore('pending-more-next');
  await waitFor(() => expect(ordinaryIds()).toEqual(expectedIds(15)));
  expect(loadProjectless).toHaveBeenCalledTimes(2);
  expect(loadProjectless.mock.calls.map(call => call[2])).toEqual([10, 15]);
  expect(group().items).toEqual(expect.arrayContaining([expect.objectContaining({ threadId: 'unread', isUnread: true })]));
 } finally {
  await act(async () => { first.resolve(); });
  loadProjectless.mockRestore();
 }
});
it('其他项目完成加载让共享loading恢复后，同一连接的无项目在途请求仍同步去重', async () => {
 const { ordinaryIds, more, expectedIds, loadMore } = await setupProjectlessPaginationRace(true);
 const first = deferredRead();
 boundary.threadReadBarrier = first.promise;
 const loadProjectless = vi.spyOn(threadListLoader, 'loadProjectlessThreadRecords');
 try {
  await loadMore('locked-projectless-first');
  await waitFor(() => expect(more()?.disabled).toBe(true));
  const other = posts.at(-1).groups.find((entry: any) => entry.cwd === '/other');
  const otherMore = other.actions.find((action: any) => action.command?.name === 'project.more');
  await act(async () => { command('other-project-more', otherMore.command.name, otherMore.command.params); });
  await waitFor(() => expect(posts.at(-1).groups.find((entry: any) => entry.cwd === '/other').items).toHaveLength(10));
  await waitFor(() => expect(more()?.disabled).toBe(false));
  await loadMore('locked-projectless-duplicate');
  expect(loadProjectless).toHaveBeenCalledTimes(1);
  expect(ordinaryIds()).toEqual(expectedIds(5));
  await act(async () => { first.resolve(); });
  await waitFor(() => expect(ordinaryIds()).toEqual(expectedIds(10)));
 } finally {
  await act(async () => { first.resolve(); });
  loadProjectless.mockRestore();
 }
});
it.each(['success', 'error'].flatMap(outcome => ['loading', 'completed'].map(stage => ({ outcome, stage }))))('旧连接无项目分页$outcome在新分页$stage时返回，不回写旧结果、错误或清除新loading', async ({ outcome, stage }) => {
 const { group, ordinaryIds, more, expectedIds, loadMore } = await setupProjectlessPaginationRace();
 const old = deferredRead(), next10 = deferredRead(), next15 = deferredRead();
 const loadProjectless = vi.spyOn(threadListLoader, 'loadProjectlessThreadRecords');
 try {
  boundary.threadReadBarrier = old.promise;
  await loadMore('old-client-more');
  expect(loadProjectless).toHaveBeenCalledTimes(1);
  const previous = boundary.client;
  const replacement = { ...previous };
  boundary.threadReadBarrier = null;
  boundary.threadRecords = boundary.threadRecords.map(thread => ({ ...thread, name: `新连接-${thread.id}` }));
  await act(async () => {
   boundary.options.onConnection('a', 'offline');
   boundary.options.onConnection('a', 'connecting');
   boundary.client = replacement;
   boundary.options.onConnection('a', 'online');
   boundary.options.onReady('a', replacement);
  });
  await waitFor(() => expect(group()?.items.find((item: any) => item.threadId === 'regular-0')?.title).toBe('新连接-regular-0'));
  boundary.threadReadBarrier = next10.promise;
  await loadMore('new-client-ten');
  expect(loadProjectless).toHaveBeenCalledTimes(2);
  await act(async () => { next10.resolve(); });
  await waitFor(() => expect(ordinaryIds()).toEqual(expectedIds(10)));
  await waitFor(() => expect(more()?.disabled).toBe(false));
  boundary.threadReadBarrier = next15.promise;
  await loadMore('new-client-fifteen');
  expect(loadProjectless.mock.calls.map(call => call[2])).toEqual([10, 10, 15]);
  await waitFor(() => expect(more()?.disabled).toBe(true));
  if (stage === 'completed') {
   await act(async () => { next15.resolve(); });
   await waitFor(() => expect(ordinaryIds()).toEqual(expectedIds(15)));
   await waitFor(() => expect(more()?.disabled).toBe(false));
  }
  await act(async () => {
   if (outcome === 'error') old.reject(new Error('旧连接分页失败'));
   else old.resolve();
   await loadProjectless.mock.results[0].value.catch(() => undefined);
  });
  await act(async () => { command('old-response-observed', 'navigation.filter', { value: 'projects' }); });
  await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'old-response-observed')).toMatchObject({ ok: true }));
  expect(ordinaryIds()).toEqual(expectedIds(stage === 'loading' ? 10 : 15));
  expect(group().items.find((item: any) => item.threadId === 'regular-0')?.title).toBe('新连接-regular-0');
  expect(more()?.disabled).toBe(stage === 'loading');
  expect(posts.at(-1)?.error ?? '').not.toContain('旧连接分页失败');
  await act(async () => { next15.resolve(); });
  await waitFor(() => expect(ordinaryIds()).toEqual(expectedIds(15)));
 } finally {
  await act(async () => { old.resolve(); next10.resolve(); next15.resolve(); });
  loadProjectless.mockRestore();
 }
});
it('项目新对话沿真实App命令路由，点击不启动thread，无项目空串覆盖保存目录，无参保留旧默认目录', async () => {
 localStorage.setItem('codex-mobile:new-chat-project:a', '/saved');
 await setup(true, { projects: ['/saved', '/target'], projectlessThreadIds: ['unloaded'] });
 await waitFor(() => expect(posts.at(-1)?.groups.some((group: any) => group.newCommand?.params.cwd === '/target')).toBe(true));
 const initialContext = posts.at(-1).contextId;
 const target = posts.at(-1).groups.find((group: any) => group.newCommand?.params.cwd === '/target').newCommand;
 await act(async () => { command('project-new', target.name, target.params); });
 await waitFor(() => expect(posts.at(-1)?.projectName).toBe('target'));
 expect(posts.at(-1).contextId).not.toBe(initialContext);
 expect(boundary.requests.some(request => request.method === 'thread/start')).toBe(false);
 const targetContext = posts.at(-1).contextId;
 await act(async () => { command('new-invalid', 'thread.new', { backendId: 'a', cwd: '/removed' }); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'new-invalid' && !result.ok)).toBe(true));
 expect(posts.at(-1).contextId).toBe(targetContext);
 const projectless = posts.at(-1).groups.find((group: any) => group.newCommand?.params.cwd === '').newCommand;
 await act(async () => { command('new-projectless', projectless.name, projectless.params); });
 await waitFor(() => expect(posts.at(-1)?.projectName).toBe('无项目'));
 expect(posts.at(-1).contextId).not.toBe(targetContext);
 // 显式项目路由不覆盖旧保存选择；无参仍使用原有保存目录策略。
 await act(async () => { command('new-legacy-default', 'thread.new'); });
 await waitFor(() => expect(posts.at(-1)?.projectName).toBe('saved'));
 expect(boundary.requests.some(request => request.method === 'thread/start')).toBe(false);
});
it('原生命令进入现有send与托管队列，慢发送不阻塞停止和继续输入，final立即进入快照', async () => {
 const contextId = await setup();
 await act(async () => { command('draft1', 'draft.set', { contextId, value: '原生第一条', revision: 1 }); command('send1', 'message.send', { contextId }); command('send1', 'message.send', { contextId }); });
 await waitFor(() => expect(boundary.release).toBeTypeOf('function'));
 expect(boundary.requests.filter(r => r.method === 'turn/start')).toHaveLength(1);
 expect(boundary.requests.find(r => r.method === 'turn/start')?.params.input[0].text).toContain('原生第一条');
 await act(async () => { command('stop', 'turn.stop', { contextId }); command('draft2', 'draft.set', { contextId, value: '忙时仍可排队', revision: 2 }); command('send2', 'message.send', { contextId }); });
 await waitFor(() => expect(queueItems[0]?.inputText).toBe('忙时仍可排队'));
 expect(boundary.requests.some(r => r.method === 'turn/interrupt')).toBe(true);
 expect(queueItems[0].id).toMatch(/^[0-9a-f-]{36}$/i);
 await act(async () => { boundary.release!(); });
 await act(async () => boundary.options.onNotification('a', { method: 'item/completed', params: { threadId: 'sent-thread', turnId: 'turn-live', item: { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '最终正文' } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.messages.some((m: any) => m.text === '最终正文')).toBe(true));
 expect(posts.at(-1).busy).toBe(true);
});
it('发送失败保留原输入可恢复且原生命令返回关联错误', async () => {
 const contextId = await setup(); boundary.failSend = true;
 await act(async () => { command('draft-fail', 'draft.set', { contextId, value: '失败保留', revision: 1 }); });
 await waitFor(() => expect(posts.at(-1)?.draft).toBe('失败保留'));
 await act(async () => { command('send-fail', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((r: any) => r.id === 'send-fail' && r.ok === false)).toBe(true));
 expect(posts.at(-1).draft === '失败保留' || posts.at(-1).queued.some((q: any) => q.title.includes('失败保留'))).toBe(true);
 expect(posts.at(-1).error).toBeTruthy();
});

it('同一React flush中的不同请求UUID只消费一次草稿，不重复创建会话或turn', async () => {
 const contextId = await setup();
 await act(async () => {
  command('draft-double', 'draft.set', { contextId, value: '同一份草稿', revision: 1 });
  command('11111111-1111-4111-8111-111111111111', 'message.send', { contextId });
  command('22222222-2222-4222-8222-222222222222', 'message.send', { contextId });
 });
 await waitFor(() => expect(boundary.release).toBeTypeOf('function'));
 expect(boundary.requests.filter(request => request.method === 'thread/start')).toHaveLength(1);
 expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(1);
 await act(async () => { boundary.release!(); });
});
it('新会话首次发送仍在等待时保留同一flush继续输入的新草稿，不再创建第二个会话', async () => {
 const contextId = await setup();
 await act(async () => {
  command('draft-initial', 'draft.set', { contextId, value: '首次发送', revision: 1 });
  command('send-initial', 'message.send', { contextId });
  command('draft-next', 'draft.set', { contextId, value: '等待期间继续输入', revision: 2 });
  command('send-before-thread', 'message.send', { contextId });
 });
 await waitFor(() => expect(boundary.release).toBeTypeOf('function'));
 expect(boundary.requests.filter(request => request.method === 'thread/start')).toHaveLength(1);
 await waitFor(() => expect(posts.at(-1)?.draft).toBe('等待期间继续输入'));
 await act(async () => { command('send-after-thread', 'message.send', { contextId }); });
 await waitFor(() => expect(queueItems[0]?.inputText).toBe('等待期间继续输入'));
 await act(async () => { boundary.release!(); });
});
it('已有会话在同一flush发送后输入的新消息走托管队列，不能并发再开turn', async () => {
 const contextId = await setup();
 await act(async () => { command('initial-draft', 'draft.set', { contextId, value: '建立会话', revision: 1 }); command('initial-send', 'message.send', { contextId }); });
 await waitFor(() => expect(boundary.release).toBeTypeOf('function'));
 await act(async () => { boundary.release!(); });
 await act(async () => boundary.options.onNotification('a', { method: 'turn/completed', params: { threadId: 'sent-thread', turn: { id: 'turn-live', status: 'completed', items: [] } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.busy).toBe(false));
 boundary.release = null;
 await act(async () => {
  command('draft-current', 'draft.set', { contextId, value: '直接发送', revision: 2 });
  command('send-current', 'message.send', { contextId });
  command('draft-queue', 'draft.set', { contextId, value: '随后排队', revision: 3 });
  command('send-queue', 'message.send', { contextId });
 });
 await waitFor(() => expect(boundary.release).toBeTypeOf('function'));
 expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(2);
 await waitFor(() => expect(queueItems[0]?.inputText).toBe('随后排队'));
 await act(async () => { boundary.release!(); });
});
it('原发送失败时保留期间新输入，并将失败的原输入留在现有恢复队列', async () => {
 const contextId = await setup(); boundary.failSend = true;
 await act(async () => {
  command('draft-original-fail', 'draft.set', { contextId, value: '失败的原输入', revision: 1 });
  command('send-original-fail', 'message.send', { contextId });
  command('draft-during-fail', 'draft.set', { contextId, value: '期间的新输入', revision: 2 });
 });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'send-original-fail' && !result.ok)).toBe(true));
 expect(posts.at(-1).draft).toBe('期间的新输入');
 expect(posts.at(-1).queued.some((item: any) => item.title.includes('失败的原输入'))).toBe(true);
});

it('默认网页表单同一flush重复submit也只发送一次，继续输入保持可编辑', async () => {
 await setup(false);
 fireEvent.click(screen.getByRole('button', { name: '聊天' }));
 const input = screen.getByRole('textbox', { name: '向 Codex 提问' });
 fireEvent.change(input, { target: { value: '网页第一份草稿' } });
 const form = input.closest('form')!;
 await act(async () => {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
 });
 await waitFor(() => expect(boundary.release).toBeTypeOf('function'));
 expect(boundary.requests.filter(request => request.method === 'thread/start')).toHaveLength(1);
 expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(1);
 fireEvent.change(input, { target: { value: '网页继续输入' } });
 await act(async () => { boundary.release!(); });
 expect(input).toHaveValue('网页继续输入');
 expect(posts).toHaveLength(0);
});

it('快速网络ACK先于React提交时仍按实时busy状态排队，不并发启动第二个turn', async () => {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => {
  command('draft-fast', 'draft.set', { contextId, value: '快速ACK的第一条', revision: 1 });
  command('send-fast', 'message.send', { contextId });
  for (let index = 0; index < 20; index++) await Promise.resolve();
  command('draft-after-ack', 'draft.set', { contextId, value: 'ACK后立即输入', revision: 2 });
  command('send-after-ack', 'message.send', { contextId });
 });
 expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(1);
 await waitFor(() => expect(queueItems[0]?.inputText).toBe('ACK后立即输入'));
});
it('历史编辑连续change与submit消费最新文本并同步占用提交状态', async () => {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => { command('hist-draft', 'draft.set', { contextId, value: '原历史', revision: 1 }); command('hist-send', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async () => boundary.options.onNotification('a', { method: 'turn/completed', params: { threadId: 'sent-thread', turn: { id: 'turn-live', status: 'completed', items: [{ id: 'history-user', type: 'userMessage', content: [{ type: 'text', text: '原历史' }] }] } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.busy).toBe(false));
 await act(async () => { command('hist-edit', 'message.edit', { contextId, turnId: 'turn-live', messageId: 'history-user' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.find((message: any) => message.id === 'turn-live:history-user')?.historyEdit?.id).toContain('history-edit:'));
 expect(posts.at(-1).panel).toBeUndefined();
 const editKey = 'sent-thread:turn-live:history-user';
 await act(async () => {
  command('hist-change', 'history.change', { contextId, editKey, value: '最新历史正文' });
  command('hist-submit1', 'history.submit', { contextId, editKey });
  command('hist-submit2', 'history.submit', { contextId, editKey });
 });
 await waitFor(() => expect(boundary.requests.filter(r => r.method === 'turn/start')).toHaveLength(2));
 expect(boundary.requests.filter(r => r.method === 'turn/start')[1].params.input[0].text).toContain('最新历史正文');
 expect(boundary.requests.filter(r => r.method === 'thread/revert')).toHaveLength(1);
 await waitFor(() => expect(posts.at(-1)?.messages.every((message: any) => !message.historyEdit)).toBe(true));
});
it('原位历史编辑失败恢复目标草稿和原附件，重试保留同轮此前消息并只回退一次', async () => {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => { command('history-failure-draft', 'draft.set', { contextId, value: '同轮此前消息', revision: 1 }); command('history-failure-send', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await act(async () => boundary.options.onNotification('a', { method: 'turn/completed', params: { threadId: 'sent-thread', turn: { id: 'turn-live', status: 'completed', items: [
  { id: 'before', type: 'userMessage', content: [{ type: 'text', text: '同轮此前消息' }, { type: 'localImage', path: '/cache/before.png' }] },
  { id: 'target', type: 'userMessage', content: [{ type: 'text', text: '原目标' }, { type: 'localImage', path: '/cache/target.png' }] },
 ] } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.busy).toBe(false));
 await act(async () => { command('history-failure-composer', 'draft.set', { contextId, value: '普通草稿仍保留', revision: 2 }); command('history-failure-edit', 'message.edit', { contextId, turnId: 'turn-live', messageId: 'target' }); });
 const edited = () => posts.at(-1)?.messages.find((message: any) => message.id === 'turn-live:target');
 await waitFor(() => expect(edited()?.historyEdit?.id).toBe('history-edit:sent-thread:turn-live:target'));
 expect(JSON.stringify(edited().historyEdit)).toContain('同轮此前的 1 条用户消息及附件会一起重发');
 boundary.failSend = true;
 await act(async () => { command('history-failure-change', 'history.change', { contextId, editKey: 'sent-thread:turn-live:target', value: '失败后保留的新草稿' }); command('history-failure-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:target' }); });
 await waitFor(() => expect(posts.at(-1)?.error).toContain('真实发送失败'));
 await waitFor(() => expect(edited()?.historyEdit?.items.find((item: any) => item.id === 'history-text')?.disabled).toBe(false));
 expect(edited().historyEdit.items.find((item: any) => item.id === 'history-text').value).toBe('失败后保留的新草稿');
 expect(JSON.stringify(edited().blocks)).toContain(encodeURIComponent('/cache/target.png'));
 expect(JSON.stringify(edited().historyEdit)).toContain('原对话已回退，待重新发送的编辑草稿');
 expect(posts.at(-1).draft).toBe('普通草稿仍保留'); expect(posts.at(-1).panel).toBeUndefined();
 const attempted = boundary.requests.filter(request => request.method === 'turn/start').at(-1)!.params.input;
 expect(attempted.filter((part: any) => part.type === 'text').map((part: any) => part.text)).toEqual(['同轮此前消息', '失败后保留的新草稿']);
 expect(attempted.filter((part: any) => part.type === 'localImage').map((part: any) => part.path)).toEqual(['/cache/before.png', '/cache/target.png']);
 boundary.failSend = false;
 await act(async () => { command('history-failure-retry', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:target' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.every((message: any) => !message.historyEdit)).toBe(true));
 expect(boundary.requests.filter(request => request.method === 'thread/revert')).toHaveLength(1);
});

async function createHistorySource() {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => { command('source-draft', 'draft.set', { contextId, value: 'A原消息', revision: 1 }); command('source-send', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 await completeHistoryThread('sent-thread', 'turn-live', 'message-a', 'A原消息');
 await act(async () => { command('source-edit', 'message.edit', { contextId, turnId: 'turn-live', messageId: 'message-a' }); command('source-edit-change', 'history.change', { contextId, editKey: 'sent-thread:turn-live:message-a', value: 'A授权重发内容' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.some((message: any) => message.historyEdit)).toBe(true));
 return contextId;
}
async function completeHistoryThread(threadId: string, turnId: string, messageId: string, text: string) {
 await act(async () => boundary.options.onNotification('a', { method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed', items: [{ id: messageId, type: 'userMessage', content: [{ type: 'text', text }] }] } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.busy).toBe(false));
}
async function switchHistoryDestination(existing: boolean) {
 await act(async () => { command('destination-new', 'thread.new'); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBeUndefined());
 const contextId = posts.at(-1).contextId;
 if (existing) {
  boundary.nextThreadId = 'thread-b'; boundary.immediateSend = true;
  await act(async () => { command('destination-draft', 'draft.set', { contextId, value: 'B原消息', revision: 1 }); command('destination-send', 'message.send', { contextId }); });
  await waitFor(() => expect(posts.at(-1)?.threadId).toBe('thread-b'));
  await completeHistoryThread('thread-b', 'turn-b', 'message-b', 'B原消息');
 }
 await act(async () => { command('destination-composer', 'draft.set', { contextId, value: 'B普通草稿', revision: 2 }); });
 await waitFor(() => expect(posts.at(-1)?.draft).toBe('B普通草稿'));
 return contextId;
}
it.each([false, true])('A历史回退迟到时已切换目标existing=%s，仍重发A但不能覆盖新目标上下文', async existing => {
 const contextId = await createHistorySource(); boundary.delayRevert = true;
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(boundary.releaseRevert).toBeTypeOf('function'));
 const destinationContext = await switchHistoryDestination(existing);
 const expectedThread = existing ? 'thread-b' : undefined;
 await act(async () => { boundary.releaseRevert!(); });
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'turn/start' && request.params.threadId === 'sent-thread')).toHaveLength(2));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'source-submit')).toBe(true));
 expect(posts.at(-1)).toMatchObject({ contextId: destinationContext, draft: 'B普通草稿', busy: false, pending: false, readOnly: false });
 expect(posts.at(-1).threadId).toBe(expectedThread);
 expect(posts.at(-1).messages.some((message: any) => message.text.includes('A授权重发内容'))).toBe(false);
 const resend = boundary.requests.filter(request => request.method === 'turn/start' && request.params.threadId === 'sent-thread').at(-1)!;
 expect(resend.params.input[0].text).toBe('A授权重发内容');
 expect(boundary.requests.filter(request => request.method === 'thread/revert')).toHaveLength(1);
});
it.each(['success', 'failure'])('A历史发送%s迟到时B的新编辑、错误、草稿和pending状态不被清空', async outcome => {
 const contextId = await createHistorySource(); boundary.immediateSend = false;
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(2));
 const finish = outcome === 'success' ? boundary.release! : boundary.rejectStart!;
 const destinationContext = await switchHistoryDestination(true);
 await act(async () => { command('destination-edit', 'message.edit', { contextId: destinationContext, turnId: 'turn-b', messageId: 'message-b' }); command('destination-change', 'history.change', { contextId: destinationContext, editKey: 'thread-b:turn-b:message-b', value: 'B新编辑草稿' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.find((message: any) => message.id === 'turn-b:message-b')?.historyEdit?.items[0].value).toBe('B新编辑草稿'));
 await act(async () => { command('destination-error', 'model.select', { contextId: destinationContext, value: 'invalid' }); });
 await waitFor(() => expect(posts.at(-1)?.error).toBeTruthy());
 const error = posts.at(-1).error;
 await act(async () => { finish(); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'source-submit')).toBe(true));
 expect(posts.at(-1)).toMatchObject({ threadId: 'thread-b', contextId: destinationContext, draft: 'B普通草稿', busy: false, pending: false, readOnly: true, error });
 expect(posts.at(-1).messages.find((message: any) => message.id === 'turn-b:message-b')?.historyEdit?.items[0].value).toBe('B新编辑草稿');
});

it.each(['thread/revert', 'turn/start'])('A历史%s的HTTP待确认成功只完成A授权操作并保持B编辑状态', async method => {
 const contextId = await createHistorySource(); boundary.pendingMethod = method;
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(posts.at(-1)?.pending).toBe(true));
 boundary.pendingMethod = '';
 const destinationContext = await switchHistoryDestination(true);
 await act(async () => { command('destination-edit', 'message.edit', { contextId: destinationContext, turnId: 'turn-b', messageId: 'message-b' }); command('destination-change', 'history.change', { contextId: destinationContext, editKey: 'thread-b:turn-b:message-b', value: 'B新编辑草稿' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.find((message: any) => message.id === 'turn-b:message-b')?.historyEdit?.items[0].value).toBe('B新编辑草稿'));
 const result = method === 'thread/revert' ? { thread: { id: 'sent-thread', turns: [] } } : { turn: { id: 'turn-a-retry', status: 'inProgress', items: [] } };
 await act(async () => boundary.options.onNotification('a', { method: 'mobile/operation/confirmed', params: { requestId: `pending-sent-thread-${method}`, request: { method, params: { threadId: 'sent-thread' } }, response: { id: 'pending-rpc', result } } }, boundary.client));
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'turn/start' && request.params.threadId === 'sent-thread')).toHaveLength(2));
 expect(posts.at(-1)).toMatchObject({ threadId: 'thread-b', contextId: destinationContext, draft: 'B普通草稿', busy: false, pending: false, readOnly: true });
 expect(posts.at(-1).messages.find((message: any) => message.id === 'turn-b:message-b')?.historyEdit?.items[0].value).toBe('B新编辑草稿');
 expect(boundary.requests.filter(request => request.method === 'thread/revert' && request.params.threadId === 'sent-thread')).toHaveLength(1);
});
it('A历史发送迟到不解除B自己正在等待HTTP回退确认的busy和pending', async () => {
 const contextId = await createHistorySource(); boundary.immediateSend = false;
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(2));
 const finish = boundary.release!;
 const destinationContext = await switchHistoryDestination(true);
 await act(async () => { command('destination-edit', 'message.edit', { contextId: destinationContext, turnId: 'turn-b', messageId: 'message-b' }); command('destination-change', 'history.change', { contextId: destinationContext, editKey: 'thread-b:turn-b:message-b', value: 'B待确认编辑草稿' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.find((message: any) => message.id === 'turn-b:message-b')?.historyEdit).toBeDefined());
 boundary.pendingMethod = 'thread/revert';
 await act(async () => { command('destination-submit', 'history.submit', { contextId: destinationContext, editKey: 'thread-b:turn-b:message-b' }); });
 await waitFor(() => expect(posts.at(-1)?.pending).toBe(true));
 await act(async () => { finish(); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'source-submit')).toBe(true));
 expect(posts.at(-1)).toMatchObject({ threadId: 'thread-b', contextId: destinationContext, busy: true, pending: true, readOnly: true, draft: 'B普通草稿' });
 expect(posts.at(-1).messages.find((message: any) => message.id === 'turn-b:message-b')?.historyEdit?.items[0]).toMatchObject({ value: 'B待确认编辑草稿', disabled: true });
});

async function reconnectHistoryClient() {
 const previous = boundary.client;
 const replacement = { ...previous, request: async (method: string, params: any) => {
  if (method === 'thread/resume') {
   boundary.requests.push({ method, params });
   return { thread: { id: params.threadId, turns: [] }, model: 'gpt' };
  }
  return previous.request(method, params);
 } };
 const before = boundary.requests.filter(request => request.method === 'thread/resume').length;
 await act(async () => {
  boundary.options.onConnection('a', 'offline');
  boundary.options.onConnection('a', 'connecting');
  boundary.client = replacement;
  boundary.options.onConnection('a', 'online');
  boundary.options.onReady('a', replacement);
 });
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'thread/resume')).toHaveLength(before + 1));
 return replacement;
}
it.each(['thread/revert', 'turn/start'].flatMap(method => ['success', 'error'].map(outcome => ({ method, outcome }))))('历史$method等待期间原上下文重连后可信确认$outcome能释放旧提交', async ({ method, outcome }) => {
 const contextId = await createHistorySource(); boundary.pendingMethod = method;
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(posts.at(-1)?.pending).toBe(true));
 const replacement = await reconnectHistoryClient();
 boundary.pendingMethod = '';
 const response = outcome === 'error' ? { id: 'pending-rpc', error: { code: -1, message: '确认发送失败' } }
  : { id: 'pending-rpc', result: method === 'thread/revert' ? { thread: { id: 'sent-thread', turns: [] } } : { turn: { id: 'turn-resend', status: 'inProgress', items: [] } } };
 await act(async () => boundary.options.onNotification('a', { method: 'mobile/operation/confirmed', params: { requestId: `pending-sent-thread-${method}`, request: { method }, response } }, replacement));
 await waitFor(() => expect(posts.at(-1)?.pending).toBe(false));
 expect(posts.at(-1).contextId).toBe(contextId);
 if (outcome === 'success') {
  await waitFor(() => expect(posts.at(-1)?.readOnly).toBe(false));
  expect(posts.at(-1).messages.every((message: any) => !message.historyEdit)).toBe(true);
 } else {
  await waitFor(() => expect(posts.at(-1)?.messages.find((message: any) => message.id === 'turn-live:message-a')?.historyEdit?.items[0].disabled).toBe(false));
  expect(posts.at(-1)).toMatchObject({ busy: false, error: '确认发送失败' });
  await act(async () => { command('cancel-after-reconnect', 'history.cancel', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
  await waitFor(() => expect(posts.at(-1)?.readOnly).toBe(false));
 }
});
it('普通历史发送错误在同一编辑重连后到达仍能释放编辑且保留失败草稿', async () => {
 const contextId = await createHistorySource(); boundary.immediateSend = false;
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(boundary.requests.filter(request => request.method === 'turn/start')).toHaveLength(2));
 const fail = boundary.rejectStart!;
 await reconnectHistoryClient();
 await act(async () => { fail(); });
 await waitFor(() => expect(posts.at(-1)?.error).toContain('旧会话发送失败'));
 expect(posts.at(-1)).toMatchObject({ busy: false, pending: false, contextId });
 expect(posts.at(-1).messages.find((message: any) => message.id === 'turn-live:message-a')?.historyEdit?.items[0]).toMatchObject({ value: 'A授权重发内容', disabled: false });
});
it('历史start待确认前已完成，迟到inProgress确认不能倒退终态或阻止再次编辑', async () => {
 const contextId = await createHistorySource(); boundary.pendingMethod = 'turn/start';
 await act(async () => { command('source-submit', 'history.submit', { contextId, editKey: 'sent-thread:turn-live:message-a' }); });
 await waitFor(() => expect(posts.at(-1)?.pending).toBe(true));
 boundary.pendingMethod = '';
 await act(async () => boundary.options.onNotification('a', { method: 'turn/completed', params: { threadId: 'sent-thread', turn: { id: 'turn-resend', status: 'completed', items: [{ id: 'message-resend', type: 'userMessage', content: [{ type: 'text', text: 'A授权重发内容' }] }, { id: 'final-resend', type: 'agentMessage', phase: 'final_answer', text: '重发已完成' }] } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.messages.some((message: any) => message.text === '重发已完成')).toBe(true));
 const beforeReads = boundary.requests.filter(request => request.method === 'thread/turns/list').length;
 await act(async () => boundary.options.onNotification('a', { method: 'mobile/operation/confirmed', params: { requestId: 'pending-sent-thread-turn/start', request: { method: 'turn/start' }, response: { id: 'pending-rpc', result: { turn: { id: 'turn-resend', status: 'inProgress', items: [] } } } } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.pending).toBe(false));
 expect(posts.at(-1).busy).toBe(false);
 expect(posts.at(-1).groups.flatMap((group: any) => group.items).filter((item: any) => item.command?.params?.threadId === 'sent-thread').every((item: any) => item.badge !== '运行中')).toBe(true);
 await act(async () => { command('edit-completed-resend', 'message.edit', { contextId, turnId: 'turn-resend', messageId: 'message-resend' }); });
 await waitFor(() => expect(posts.at(-1)?.messages.find((message: any) => message.id === 'turn-resend:message-resend')?.historyEdit).toBeDefined());
 expect(boundary.requests.filter(request => request.method === 'thread/turns/list').length).toBeGreaterThan(beforeReads);
});

it('新对话连续输入与保存草稿使用同一实时草稿且不会发送消息', async () => {
 const { newChatDraftStore } = await import('../../src/features/drafts/new-chat-drafts');
 const save = vi.spyOn(newChatDraftStore, 'save').mockImplementation(async input => ({ ...input, id: 'draft-native', revision: '1', updatedAt: Date.now(), files: [] }));
 const contextId = await setup();
 await act(async () => { command('save-input', 'draft.set', { contextId, value: '立即保存的最新草稿', revision: 1 }); command('save-current', 'draft.save', { contextId }); });
 expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0].text).toBe('立即保存的最新草稿'); expect(boundary.requests.some(r => r.method === 'turn/start')).toBe(false); save.mockRestore();
});

it('列表关注运行中会话等待真实管理结果，重复请求只切换一次且不影响运行回合', async () => {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => { command('pin-seed-draft', 'draft.set', { contextId, value: '运行中关注测试', revision: 1 }); command('pin-seed-send', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.busy).toBe(true));
 await waitFor(() => expect(posts.at(-1)?.groups.flatMap((group: any) => group.items).some((item: any) => item.threadId === 'sent-thread' && item.running)).toBe(true));
 const params = { backendId: 'a', threadId: 'sent-thread', action: 'pin' };
 await act(async () => { command('pin-running', 'thread.manage', params); command('pin-running', 'thread.manage', params); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'pin-running')).toMatchObject({ ok: true }));
 expect(localStorage.getItem('codex-mobile:pinned:a')).toBe('["sent-thread"]');
 expect(posts.at(-1).groups.find((group: any) => group.category === 'pinned').items).toEqual(expect.arrayContaining([expect.objectContaining({ threadId: 'sent-thread', isPinned: true, running: true })]));
 expect(posts.at(-1).busy).toBe(true);
 expect(boundary.requests.filter(request => ['thread/start', 'turn/start'].includes(request.method))).toHaveLength(2);
 expect(boundary.requests.some(request => request.method === 'turn/interrupt')).toBe(false);
 await act(async () => boundary.options.onNotification('a', { method: 'thread/name/updated', params: { threadId: 'sent-thread', threadName: '持续运行中的会话' } }, boundary.client));
 await waitFor(() => expect(posts.at(-1)?.title).toBe('持续运行中的会话'));
 expect(localStorage.getItem('codex-mobile:pinned:a')).toBe('["sent-thread"]');
 expect(posts.at(-1).commandResults.filter((result: any) => result.id === 'pin-running')).toHaveLength(1);
 await act(async () => { command('unpin-running', 'thread.manage', params); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'unpin-running')).toMatchObject({ ok: true }));
 expect(localStorage.getItem('codex-mobile:pinned:a')).toBe('[]');
 expect(posts.at(-1).busy).toBe(true);
});

it('关注运行中会话与打开命令在同一flush到达时不丢管理回执或永久占用管理锁', async () => {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => { command('pin-open-draft', 'draft.set', { contextId, value: '关注和导航并发', revision: 1 }); command('pin-open-send', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.groups.flatMap((group: any) => group.items).some((item: any) => item.threadId === 'sent-thread' && item.running)).toBe(true));
 const target = { backendId: 'a', threadId: 'sent-thread' };
 await act(async () => { command('pin-before-open', 'thread.manage', { ...target, action: 'pin' }); command('open-after-pin', 'thread.open', target); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'open-after-pin')).toMatchObject({ ok: true }));
 await act(async () => { command('unpin-after-open', 'thread.manage', { ...target, action: 'pin' }); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'unpin-after-open')).toEqual({ id: 'unpin-after-open', name: 'thread.manage', ok: true }));
 expect(posts.at(-1).commandResults.find((result: any) => result.id === 'pin-before-open')).toMatchObject({ ok: true });
 expect(posts.at(-1).commandResults.filter((result: any) => result.id === 'pin-before-open')).toHaveLength(1);
 expect(localStorage.getItem('codex-mobile:pinned:a')).toBe('[]');
});

it('管理确认在途时仍拒绝其他管理动作，取消完成后关注可以恢复', async () => {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => { command('pin-pending-draft', 'draft.set', { contextId, value: '管理锁测试', revision: 1 }); command('pin-pending-send', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 const target = { backendId: 'a', threadId: 'sent-thread' };
 await act(async () => { command('archive-before-pin', 'thread.manage', { ...target, action: 'archive' }); });
 await waitFor(() => expect(posts.at(-1)?.panel?.id).toMatch(/^confirmation:/));
 await act(async () => { command('pin-during-confirmation', 'thread.manage', { ...target, action: 'pin' }); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'pin-during-confirmation')).toMatchObject({ ok: false, error: '会话操作未完成' }));
 expect(localStorage.getItem('codex-mobile:pinned:a')).toBeNull();
 const cancel = posts.at(-1).panel.items.find((item: any) => item.id === 'confirmation-no').command;
 await act(async () => { command('cancel-before-pin', cancel.name, cancel.params); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'archive-before-pin')).toBe(true));
 await act(async () => { command('pin-after-cancel', 'thread.manage', { ...target, action: 'pin' }); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((result: any) => result.id === 'pin-after-cancel')).toMatchObject({ ok: true }));
 expect(localStorage.getItem('codex-mobile:pinned:a')).toBe('["sent-thread"]');
 expect(posts.at(-1).busy).toBe(true);
 expect(boundary.requests.some(request => request.method === 'thread/archive')).toBe(false);
});

it.each([['workspace.thread', false], ['thread.manage', false], ['workspace.thread', true], ['thread.manage', true]] as const)('%s 归档先确认（存在队列：%s），取消不改队列，确认仅归档一次', async (entry, queued) => {
 const contextId = await setup(); boundary.immediateSend = true;
 await act(async () => { command('archive-seed-draft', 'draft.set', { contextId, value: '归档确认测试', revision: 1 }); command('archive-seed-send', 'message.send', { contextId }); });
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('sent-thread'));
 if (queued) {
  await act(async () => { command('archive-queue-draft', 'draft.set', { contextId, value: '归档前保留队列', revision: 2 }); command('archive-queue-send', 'message.send', { contextId }); });
  await waitFor(() => expect(queueItems).toHaveLength(1));
 }
 const params = entry === 'workspace.thread' ? { contextId, action: 'archive' } : { backendId: 'a', threadId: 'sent-thread', action: 'archive' };
 await act(async () => { command('archive-cancelled', entry, params); });
 await waitFor(() => expect(posts.at(-1)?.panel?.id).toMatch(/^confirmation:/));
 expect(boundary.requests.filter(r => r.method === 'thread/archive')).toHaveLength(0);
 const cancel = posts.at(-1).panel.items.find((i: any) => i.id === 'confirmation-no').command;
 await act(async () => { command('archive-answer-no', cancel.name, cancel.params); });
 await waitFor(() => expect(posts.at(-1)?.panel?.id ?? '').not.toMatch(/^confirmation:/));
 expect(boundary.requests.filter(r => r.method === 'thread/archive')).toHaveLength(0);
 expect(posts.at(-1).threadId).toBe('sent-thread');
 expect(queueItems).toHaveLength(queued ? 1 : 0);
 await act(async () => { command('archive-confirmed', entry, params); });
 await waitFor(() => expect(posts.at(-1)?.panel?.id).toMatch(/^confirmation:/));
 const yes = posts.at(-1).panel.items.find((i: any) => i.id === 'confirmation-yes').command;
 await act(async () => { command('archive-answer-yes', yes.name, yes.params); });
 await waitFor(() => expect(boundary.requests.filter(r => r.method === 'thread/archive')).toHaveLength(1));
 expect(boundary.requests.find(r => r.method === 'thread/archive')?.params.threadId).toBe('sent-thread');
 expect(queueItems).toHaveLength(0);
});
