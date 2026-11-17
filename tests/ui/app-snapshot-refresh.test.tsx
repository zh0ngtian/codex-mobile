import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';

const boundary = vi.hoisted(() => ({ options: null as any, client: null as any, rows: [] as any[], reads: [] as any[], pageBarrier: null as Promise<void> | null }));
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
  constructor(options: any) { boundary.options = options; }
  client() { return boundary.client; } socket() { return null; } close() {} reconnect() {}
  sync(backends: any[]) {
    if (!backends.length) return;
    boundary.client = { sidebarIndex: true, onNotification() { return () => {}; }, onThreadMetadata() { return () => {}; }, request: async (method: string, params: any, options: any) => {
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
afterEach(() => { cleanup(); boundary.reads = []; boundary.rows = []; boundary.client = null; boundary.pageBarrier = null; vi.unstubAllGlobals(); });

async function setup() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify({ projects: ['/project'], projectlessThreadIds: [], items: [] })));
  vi.stubGlobal('fetch', fetcher);
  boundary.rows = [{ id: 'old', name: '旧会话', cwd: '/project' }];
  render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: 'a', backends: [{ id: 'a', name: 'Mac', enabled: true, order: 0, baseUrl: 'http://app-snapshot.test', token: '' }] }} />);
  await screen.findByRole('button', { name: /旧会话/ });
  await act(async () => {});
  return fetcher;
}

it('真实App收到列表快照变化后从缓存投影新增和移除，不再次刷新上游或目录，旧连接通知无效', async () => {
  const fetcher = await setup();
  const directories = () => fetcher.mock.calls.filter(([url]) => String(url).includes('/api/projects')).length;
  const beforeDirectories = directories();
  boundary.reads = [];
  boundary.rows = [{ id: 'new', name: '新会话', cwd: '/project' }];
  const notify = (source: any) => boundary.options.onNotification('a', { method: 'mobile/readSnapshot/updated', params: {
    request: { method: 'thread/list', params: { cwd: '/project', limit: 5 } }, response: { result: { data: boundary.rows } }, updatedAt: 200,
  } }, source);
  await act(async () => notify({}));
  expect(boundary.reads).toHaveLength(0);
  await act(async () => notify(boundary.client));
  await screen.findByRole('button', { name: /^新会话/ });
  expect(screen.queryByRole('button', { name: /旧会话/ })).toBeNull();
  expect(boundary.reads.length).toBeGreaterThan(0);
  expect(boundary.reads.every(read => read.options?.refreshSnapshot === false)).toBe(true);
  expect(boundary.reads.filter(read => read.method === 'thread/list' && !read.params.sectionId).map(read => read.params.cwd)).toEqual(['/project']);
  expect(directories()).toBe(beforeDirectories);
});

it('并行列表更新全部收尾后同步提示与刷新按钮立即结束，单个完成不能掩盖其他在途读取', async () => {
  await setup();
  const status = (method: string, refreshing: boolean, extra = {}) => boundary.options.onNotification('a', { method: 'mobile/readSnapshot/status', params: {
    request: { method, params: {} }, updatedAt: 200, refreshing, ...extra,
  } }, boundary.client);
  const refresh = () => screen.getByRole('button', { name: '刷新会话列表' });
  await act(async () => { status('thread/list', true); status('mobile/sidebar/summaries', true); });
  expect(refresh()).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('正在后台更新');
  await act(async () => status('mobile/sidebar/summaries', false));
  expect(refresh()).toHaveAttribute('aria-busy', 'true');
  await act(async () => status('thread/list', false));
  expect(refresh()).toHaveAttribute('aria-busy', 'false');
  expect(screen.getByRole('status')).toHaveTextContent('已同步');
  await act(async () => { status('thread/list', true); status('thread/list', false, { failed: true }); });
  expect(refresh()).toHaveAttribute('aria-busy', 'false');
  expect(screen.getByRole('status')).toHaveTextContent('更新失败，保留已有内容');
});

it('原列表读取挂起时收到新快照，必须等旧页收尾再回填而不吞掉更新', async () => {
  await setup();
  let release!: () => void;
  boundary.pageBarrier = new Promise<void>(done => { release = done; });
  boundary.reads = [];
  fireEvent.click(screen.getByRole('button', { name: '刷新会话列表' }));
  await waitFor(() => expect(boundary.reads.some(read => read.method === 'thread/list' && read.params.cwd)).toBe(true));
  boundary.rows = [{ id: 'late', name: '晚到快照', cwd: '/project' }];
  await act(async () => boundary.options.onNotification('a', { method: 'mobile/readSnapshot/updated', params: {
    request: { method: 'thread/list', params: { cwd: '/project' } }, response: { result: { data: boundary.rows } }, updatedAt: 300,
  } }, boundary.client));
  expect(boundary.reads.some(read => read.options?.refreshSnapshot === false)).toBe(false);
  boundary.pageBarrier = null;
  await act(async () => release());
  await screen.findByRole('button', { name: /^晚到快照/ });
  expect(screen.queryByRole('button', { name: /旧会话/ })).toBeNull();
  expect(boundary.reads.some(read => read.options?.refreshSnapshot === false)).toBe(true);
});
