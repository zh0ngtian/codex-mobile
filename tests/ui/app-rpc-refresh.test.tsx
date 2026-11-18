import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';

const boundary = vi.hoisted(() => ({ options: null as any, client: null as any, rows: [] as any[], reads: [] as any[], pageBarrier: null as Promise<void> | null, snapshotWaits: 0 }));
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
  constructor(options: any) { boundary.options = options; }
  client() { return boundary.client; } socket() { return null; } close() {} reconnect() {}
  sync(backends: any[]) {
    if (!backends.length) return;
    boundary.client = { sidebarIndex: true, waitForListSnapshotRefresh: async () => { boundary.snapshotWaits++; }, onNotification() { return () => {}; }, onThreadMetadata() { return () => {}; }, request: async (method: string, params: any, options: any) => {
      boundary.reads.push({ method, params, options });
      if (method === 'threadSection/list') return { data: [{ id: '01984de2-8f74-7c91-a3b2-5c5e937cf318' }], nextCursor: null };
      if (method === 'thread/list' && params.sectionId) return { data: [], nextCursor: null };
      if (method === 'thread/list') { const data = boundary.rows; await boundary.pageBarrier; return { data, nextCursor: null }; }
      if (method === 'mobile/sidebar/summaries') return { data: [], nextCursor: null };
      if (method === 'model/list') return { data: [{ model: 'test', isDefault: true, supportedReasoningEfforts: [] }] };
      if (method === 'permissionProfile/list') return { data: [{ id: ':workspace', allowed: true }] };
      if (method === 'config/read') return { config: { model: 'test', sandbox_mode: 'workspace-write' } };
      return { data: [], items: [], nextCursor: null };
    } };
    queueMicrotask(() => { boundary.options.onConnection(backends[0].id, 'online'); boundary.options.onReady(backends[0].id, boundary.client); });
  }
} }));
afterEach(() => { cleanup(); vi.useRealTimers(); boundary.reads = []; boundary.rows = []; boundary.client = null; boundary.pageBarrier = null; boundary.snapshotWaits = 0; vi.unstubAllGlobals(); });

async function setup(gatewayMode: "local" | "remote" = "local") {
  const values = new Map<string, string>([['codex-mobile:collapsed-projects', '[]']]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify({ projects: ['/project'], projectlessThreadIds: [], items: [] })));
  vi.stubGlobal('fetch', fetcher);
  boundary.rows = [{ id: 'old', name: '旧会话', cwd: '/project' }];
  render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: 'a', backends: [{ id: 'a', name: 'Mac', enabled: true, order: 0, baseUrl: 'http://app-rpc.test', token: '', gatewayMode, ...(gatewayMode === 'remote' ? { remoteTarget: { mode: 'remote' as const, gatewayId: 'g', account: { accountId: 'a', accountUserId: 'u' }, target: { environmentId: 'e', installationId: 'i' } } } : {}) }] }} />);
  await screen.findByRole('button', { name: /旧会话/ });
  await act(async () => {});
  return fetcher;
}

it.each(['local', 'remote'] as const)('%s手动刷新复用连接并等待本轮RPC结果，已有列表保持可见', async gatewayMode => {
  const fetcher = await setup(gatewayMode);
  let release!: () => void;
  boundary.pageBarrier = new Promise<void>(resolve => { release = resolve; });
  boundary.rows = [{ id: 'new', name: '新会话', cwd: '/project' }];
  boundary.reads = [];
  const directoriesBefore = fetcher.mock.calls.filter(([url]) => String(url).includes('/api/projects')).length;
  const refresh = () => screen.getByRole('button', { name: '刷新会话列表' });
  fireEvent.click(refresh());
  await waitFor(() => expect(boundary.reads.some(read => read.method === 'thread/list' && read.params.cwd)).toBe(true));
  expect(refresh()).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('button', { name: /旧会话/ })).toBeVisible();
  await act(async () => release());
  await screen.findByRole('button', { name: /^新会话/ });
  await waitFor(() => expect(refresh()).toHaveAttribute('aria-busy', 'false'));
  expect(screen.queryByRole('button', { name: /旧会话/ })).toBeNull();
  expect(boundary.snapshotWaits).toBe(0);
  expect(boundary.reads.filter(read => read.method === 'thread/list' && read.params.cwd)).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/api/projects'))).toHaveLength(directoriesBefore + 1);
});

it('前台桌面置顶每30秒自动同步，手动刷新即时同步', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  await setup('remote');
  boundary.reads = [];
  const pinReads = () => boundary.reads.filter(read => read.method === 'thread/list' && read.params.sectionId);

  await act(async () => vi.advanceTimersByTimeAsync(29_999));
  expect(pinReads()).toHaveLength(0);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(pinReads()).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: '刷新会话列表' }));
  await waitFor(() => expect(pinReads()).toHaveLength(2));
});

it('旧快照通知不能启动新一轮读取、改变同步提示或延长手动刷新', async () => {
  await setup();
  boundary.reads = [];
  const refresh = () => screen.getByRole('button', { name: '刷新会话列表' });
  await act(async () => {
    boundary.options.onNotification('a', { method: 'mobile/readSnapshot/status', params: {
      request: { method: 'thread/list', params: {} }, updatedAt: 200, refreshing: true,
    } }, boundary.client);
    boundary.options.onNotification('a', { method: 'mobile/readSnapshot/updated', params: {
      request: { method: 'thread/list', params: { cwd: '/project' } }, response: { result: { data: [] } }, updatedAt: 200,
    } }, boundary.client);
  });
  expect(boundary.reads).toHaveLength(0);
  expect(refresh()).toHaveAttribute('aria-busy', 'false');
  expect(screen.queryByText(/快照更新于|正在后台更新/)).toBeNull();
  expect(screen.getByRole('button', { name: /旧会话/ })).toBeVisible();
});

it('本轮项目RPC读取失败结束刷新并保留已有内容，重试可更新', async () => {
  await setup();
  let fail!: (reason: unknown) => void;
  boundary.pageBarrier = new Promise<void>((_, reject) => { fail = reject; });
  const refresh = () => screen.getByRole('button', { name: '刷新会话列表' });
  boundary.reads = [];
  fireEvent.click(refresh());
  await waitFor(() => expect(boundary.reads.some(read => read.method === 'thread/list' && read.params.cwd)).toBe(true));
  await act(async () => fail(new Error('列表读取失败')));
  await waitFor(() => expect(refresh()).toHaveAttribute('aria-busy', 'false'));
  expect(screen.getByRole('button', { name: /旧会话/ })).toBeVisible();
  boundary.pageBarrier = null;
  boundary.rows = [{ id: 'recovered', name: '重试后的会话', cwd: '/project' }];
  fireEvent.click(refresh());
  await screen.findByRole('button', { name: /重试后的会话/ });
  await waitFor(() => expect(refresh()).toHaveAttribute('aria-busy', 'false'));
  expect(boundary.snapshotWaits).toBe(0);
});
