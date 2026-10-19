import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';
import { projectNavigationLoading } from '../../src/native-ui/projection';

const boundary = vi.hoisted(() => ({
 requests: [] as Array<{ backendId: string; method: string; options?: { priority?: string } }>,
 directoryBarriers: {} as Record<string, Promise<void>>,
 pageBarriers: {} as Record<string, Promise<void>>,
 threads: {} as Record<string, Array<Record<string, unknown>>>,
}));
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
 private value: any;
 constructor(private options: any) {}
 client() { return this.value; } socket() { return null; } close() {} reconnect() {}
 sync(backends: any[]) {
  const backend = backends[0];
  if (!backend) return;
  const client = { onNotification() { return () => {}; }, onThreadMetadata() { return () => {}; }, request: async (method: string, _params: unknown, options?: { priority?: string }) => {
   boundary.requests.push({ backendId: backend.id, method, options });
   if (method === 'model/list') return { data: [{ model: 'gpt', displayName: 'GPT', isDefault: true, supportedReasoningEfforts: [] }] };
   if (method === 'permissionProfile/list') return { data: [{ id: ':workspace', allowed: true }] };
   if (method === 'config/read') return { config: { model: 'gpt', sandbox_mode: 'workspace-write' } };
   if (method === 'thread/list') { await boundary.pageBarriers[backend.id]; return { data: boundary.threads[backend.id] ?? [], nextCursor: null }; }
   return { data: [], items: [], marketplaces: [], nextCursor: null };
  } };
  this.value = client;
  queueMicrotask(() => { this.options.onConnection(backend.id, 'online'); this.options.onReady(backend.id, client); });
 }
} }));
const posts: any[] = [];
const pending: Array<() => void> = [];
function deferred() {
 let resolve!: () => void;
 const promise = new Promise<void>(done => { resolve = done; });
 pending.push(resolve);
 return { promise, resolve };
}
function command(id: string, name: string, params: Record<string, unknown>) {
 window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } }));
}
afterEach(async () => {
 cleanup();
 await act(async () => pending.splice(0).forEach(resolve => resolve()));
 boundary.requests = []; boundary.directoryBarriers = {}; boundary.pageBarriers = {}; boundary.threads = {}; posts.length = 0;
 localStorage.clear(); vi.unstubAllGlobals();
 delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).webkit; delete (window as any).codexMobilePublishNativeSnapshot;
});
async function setup() {
 Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (snapshot: unknown) => posts.push(snapshot) });
 vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  const backendId = new URL(String(url)).hostname.includes('gateway-b') ? 'b' : 'a';
  if (String(url).includes('/api/projects')) await boundary.directoryBarriers[backendId];
  return new Response(JSON.stringify({ projects: [], projectlessThreadIds: [], items: [] }));
 }));
 render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: 'a', backends: ['a', 'b'].map((id, order) => ({ id, name: id, hostId: id, enabled: true, order, baseUrl: `https://gateway-${id}.invalid`, token: 'SECRET' })) }} />);
 // A 的模型直到自己的列表 bootstrap 完成才投影；B 的目录/分页仍保持挂起。
 await waitFor(() => expect(posts.at(-1)?.models[0]?.value).toBe('gpt'));
 await act(async () => command('bootstrap-snapshot-observed', 'navigation.filter', { value: 'sessions' }));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'bootstrap-snapshot-observed')).toBe(true));
}
it('全部设备中A成功空而B目录或首次分页尚未完成时，真实App不得提前发布成功空导航', async () => {
 const directory = deferred(); const page = deferred();
 boundary.directoryBarriers.b = directory.promise; boundary.pageBarriers.b = page.promise;
 await setup();
 expect(posts.at(-1).groups.every((group: any) => !group.items.length)).toBe(true);
 expect(posts.at(-1).navigationLoading).toBe(true);
 await act(async () => command('select-empty-ready-a', 'backend.select', { id: 'a' }));
 await waitFor(() => expect(posts.at(-1)).toMatchObject({ listBackendId: 'a', navigationLoading: false }));
 await act(async () => command('select-empty-pending-all', 'backend.select', { id: 'all' }));
 await waitFor(() => expect(posts.at(-1)).toMatchObject({ listBackendId: 'all', navigationLoading: true }));
 await act(async () => directory.resolve());
 await waitFor(() => expect(boundary.requests.some(request => request.backendId === 'b' && request.method === 'thread/list')).toBe(true));
 expect(posts.at(-1).navigationLoading).toBe(true);
 await act(async () => page.resolve());
 await waitFor(() => expect(posts.at(-1)?.navigationLoading).toBe(false));
 expect(posts.at(-1).groups.every((group: any) => !group.items.length)).toBe(true);
});
it('全部设备首次加载允许先展示A内容，切换设备范围及后续静默刷新沿用各自完成状态', async () => {
 const page = deferred(); boundary.pageBarriers.b = page.promise;
 boundary.threads.a = [{ id: 'existing-a', name: 'A已有会话', cwd: '/a', turns: [] }];
 await setup();
 const hasA = () => posts.at(-1).groups.some((group: any) => group.items.some((item: any) => item.threadId === 'existing-a'));
 expect(hasA()).toBe(true);
 expect(posts.at(-1).navigationLoading).toBe(false);
 await act(async () => command('pending-empty-favorites', 'navigation.filter', { value: 'favorites' }));
 await waitFor(() => expect(posts.at(-1).groups).toHaveLength(1));
 expect(posts.at(-1)).toMatchObject({ navigationLoading: true, groups: [{ category: 'pinned', items: [] }] });
 await act(async () => command('restore-session-content', 'navigation.filter', { value: 'sessions' }));
 await waitFor(() => expect(hasA()).toBe(true));
 expect(posts.at(-1).navigationLoading).toBe(false);
 await act(async () => command('select-ready-a', 'backend.select', { id: 'a' }));
 await waitFor(() => expect(posts.at(-1)).toMatchObject({ listBackendId: 'a', navigationLoading: false }));
 await act(async () => command('select-pending-all', 'backend.select', { id: 'all' }));
 await waitFor(() => expect(posts.at(-1)).toMatchObject({ listBackendId: 'all', navigationLoading: false }));
 await act(async () => page.resolve());
 await waitFor(() => expect(posts.at(-1)?.navigationLoading).toBe(false));
 const refresh = deferred(); boundary.pageBarriers.b = refresh.promise;
 const before = boundary.requests.filter(request => request.backendId === 'b' && request.method === 'thread/list').length;
 await act(async () => command('multi-sidebar-refresh', 'navigation.sidebar', { open: true }));
 await waitFor(() => expect(boundary.requests.filter(request => request.backendId === 'b' && request.method === 'thread/list').length).toBeGreaterThan(before));
 expect(hasA()).toBe(true);
 expect(posts.at(-1).navigationLoading).toBe(false);
 await act(async () => refresh.resolve());
});


it('A成功空而范围内B业务快照尚未到达时导航继续加载，全部完成或离开B范围后才结束', () => {
 const input = { loading: false, hasContent: false, backendIds: ['a', 'b'], backendSnapshots: { a: { threadListState: 'ready' as const } } };
 expect(projectNavigationLoading(input)).toBe(true);
 expect(projectNavigationLoading({ ...input, backendSnapshots: { ...input.backendSnapshots, b: { threadListState: 'loading' } } })).toBe(true);
 expect(projectNavigationLoading({ ...input, backendSnapshots: { ...input.backendSnapshots, b: { threadListState: 'ready' } } })).toBe(false);
 expect(projectNavigationLoading({ ...input, backendSnapshots: { ...input.backendSnapshots, b: { threadListState: 'error' } } })).toBe(false);
 expect(projectNavigationLoading({ ...input, backendIds: ['a'] })).toBe(false);
 expect(projectNavigationLoading({ ...input, hasContent: true })).toBe(false);
 expect(projectNavigationLoading({ ...input, loading: true, hasContent: true })).toBe(true);
});
