import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';

const boundary = vi.hoisted(() => ({ connections: {} as Record<string, any>, reads: [] as Array<{ backendId: string; client: any; resolve(value: any): void; reject(reason: Error): void }> }));
const thread = { id: 'same-thread', name: '上传统计验收', cwd: '/fixture', turns: [] };
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
  private value: any;
  private backend: any;
  constructor(private options: any) {}
  client() { return this.value; } socket() { return null; } close() {} reconnect() { this.connect(); }
  sync(backends: any[]) { if (backends.length) { this.backend = backends[0]; this.connect(); } }
  connect() {
    const backendId = this.backend.id;
    const client = { onNotification() { return () => {}; }, onThreadMetadata() { return () => {}; }, request: async (method: string, params: any) => {
      if (method === 'mobile/uploadUsage/read') return new Promise((resolve, reject) => boundary.reads.push({ backendId, client, resolve, reject }));
      if (method === 'model/list') return { data: [{ model: 'fixture', isDefault: true, supportedReasoningEfforts: [] }] };
      if (method === 'permissionProfile/list') return { data: [{ id: ':workspace', allowed: true }] };
      if (method === 'config/read') return { config: { model: 'fixture', sandbox_mode: 'workspace-write' } };
      if (method === 'threadSection/list') return { data: [{ id: '01984de2-8f74-7c91-a3b2-5c5e937cf318', name: 'Pinned' }], nextCursor: null };
      if (method === 'thread/list' && params?.sectionId) return { data: [], nextCursor: null };
      if (method === 'thread/list' || method === 'mobile/sidebar/summaries') return { data: [thread], nextCursor: null };
      if (method === 'thread/read' || method === 'thread/resume') return { thread, model: 'fixture', initialTurnsPage: { data: [], nextCursor: null } };
      return { data: [], items: [], nextCursor: null };
    } };
    this.value = client;
    boundary.connections[backendId] = { options: this.options, client, reconnect: () => this.connect(), manager: this };
    queueMicrotask(() => { this.options.onConnection(backendId, 'online'); this.options.onReady(backendId, client); });
  }
} }));
const posts: any[] = [];
const usage = (turnBytes: number, revision = 1, epoch = 'z') => ({ epoch, revision, turnId: 'turn', lastRequestBytes: turnBytes, turnBytes, requestCount: 1 });
function command(name: string, params: Record<string, unknown>) { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id: `${name}-${Math.random()}`, name, params } })); }
async function notify(backendId: string, value: unknown, threadId = thread.id, source = boundary.connections[backendId].client) {
  await act(async () => boundary.connections[backendId].options.onNotification(backendId, { method: 'mobile/uploadUsage/updated', params: { threadId, usage: value } }, source));
}
async function setup(ids = ['a']) {
  Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (snapshot: unknown) => posts.push(snapshot) });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ projects: ['/fixture'], projectlessThreadIds: [] }))));
  render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: 'a', backends: ids.map((id, order) => ({ id, name: id, hostId: id, enabled: true, order, baseUrl: `https://${id}.invalid`, token: 'fixture' })) }} />);
  await waitFor(() => expect(posts.at(-1)?.groups.some((group: any) => group.items.some((item: any) => item.threadId === thread.id))).toBe(true));
  await open('a');
}
async function open(backendId: string) {
  await act(async () => command('thread.open', { backendId, threadId: thread.id }));
  await waitFor(() => expect(posts.at(-1)).toMatchObject({ backendId, threadId: thread.id, loading: 'ready' }));
  await waitFor(() => expect(boundary.reads.some(read => read.backendId === backendId)).toBe(true));
}
function uploadCard() {
  fireEvent.click(screen.getAllByRole('button', { name: '查看上下文占用情况', hidden: true }).at(-1)!);
  return within(screen.getByRole('dialog', { name: '用量与额度', hidden: true }));
}
afterEach(async () => {
  cleanup(); await act(async () => boundary.reads.forEach(read => read.resolve({ usage: null })));
  boundary.connections = {}; boundary.reads = []; posts.length = 0; localStorage.clear(); vi.unstubAllGlobals();
  for (const key of ['__CODEX_NATIVE_UI__', 'webkit', 'codexMobilePublishNativeSnapshot']) delete (window as any)[key];
});

it('真实BackendWorkspace上传卡与原生投影在null后清旧值，迟到只读不得复活，Token保留', async () => {
  await setup();
  const card = uploadCard();
  await act(async () => boundary.connections.a.options.onNotification('a', { method: 'thread/tokenUsage/updated', params: { threadId: thread.id, tokenUsage: { total: { inputTokens: 1234, cachedInputTokens: 0, outputTokens: 5, totalTokens: 1239 }, last: { totalTokens: 10 }, modelContextWindow: 200000 } } }, boundary.connections.a.client));
  await notify('a', usage(320000));
  await waitFor(() => expect(card.getByText('本轮累计上传').nextElementSibling).toHaveTextContent('320 KB'));
  await waitFor(() => expect(posts.at(-1)?.uploadUsage?.turnBytes).toBe(320000)); const token = posts.at(-1).tokenUsage;
  await notify('a', null);
  await waitFor(() => expect(card.getByText('本轮累计上传').nextElementSibling).toHaveTextContent('暂无数据'));
  await waitFor(() => expect(posts.at(-1).uploadUsage).toBeUndefined()); expect(posts.at(-1).tokenUsage).toEqual(token); expect(token).toBeDefined();
  await act(async () => boundary.reads[0]!.resolve({ usage: usage(999000, 99, 'old-read') }));
  expect(card.getByText('本轮累计上传').nextElementSibling).toHaveTextContent('暂无数据');
  await notify('a', usage(42000, 2)); await notify('a', { broken: true }); await notify('a', null, 'different-thread');
  expect(card.getByText('本轮累计上传').nextElementSibling).toHaveTextContent('42 KB');
  await waitFor(() => expect(posts.at(-1)?.uploadUsage?.turnBytes).toBe(42000)); await notify('a', usage(1000, 1)); expect(posts.at(-1).uploadUsage.turnBytes).toBe(42000);
  await notify('a', usage(0, 0, 'a')); expect(card.getAllByText('0 B')).toHaveLength(2);
});

it('断线清空该来源，旧client读结果和读失败不能覆盖重连后的实时值', async () => {
  await setup(); const old = boundary.connections.a; const oldRead = boundary.reads[0]!;
  await notify('a', usage(42000));
  await act(async () => old.options.onConnection('a', 'offline'));
  await waitFor(() => expect(posts.at(-1).uploadUsage).toBeUndefined());
  await act(async () => { old.options.onConnection('a', 'connecting'); old.reconnect(); });
  await waitFor(() => expect(boundary.reads.length).toBeGreaterThan(1));
  await notify('a', usage(84000, 1, 'a'));
  await act(async () => { oldRead.resolve({ usage: usage(999000) }); boundary.reads.at(-1)!.reject(new Error('迟到只读失败')); });
  await waitFor(() => expect(posts.at(-1)?.uploadUsage?.turnBytes).toBe(84000));
  await notify('a', usage(999000), thread.id, old.client);
  await waitFor(() => expect(posts.at(-1)?.uploadUsage?.turnBytes).toBe(84000));
});

it('两个backend同thread保持各自用量，单线程删除不清另一个backend', async () => {
  await setup(['a', 'b']); await notify('a', usage(42000)); await open('b'); await notify('b', usage(84000));
  await notify('a', null); await waitFor(() => expect(posts.at(-1)?.uploadUsage?.turnBytes).toBe(84000));
  await open('a'); expect(posts.at(-1).uploadUsage).toBeUndefined();
  await open('b'); await waitFor(() => expect(posts.at(-1)?.uploadUsage?.turnBytes).toBe(84000));
});

it('同workspace切换transport时立即清旧值并重读，旧连接迟到read不能回填', async () => {
  await setup(); const oldRead = boundary.reads[0]!; const old = boundary.connections.a;
  await notify('a', usage(42000));
  await act(async () => command('settings.open', { id: 'transport' }));
  await waitFor(() => expect(posts.at(-1).panel).toBeDefined());
  await act(async () => command('settings.transport', { value: 'stream' }));
  await waitFor(() => expect(boundary.connections.a.manager).not.toBe(old.manager));
  await waitFor(() => expect(posts.at(-1).uploadUsage).toBeUndefined());
  await waitFor(() => expect(boundary.reads.length).toBeGreaterThan(1));
  await act(async () => oldRead.resolve({ usage: usage(999000) }));
  expect(posts.at(-1).uploadUsage).toBeUndefined();
  await notify('a', usage(84000, 1, 'a')); await waitFor(() => expect(posts.at(-1)?.uploadUsage?.turnBytes).toBe(84000));
});
