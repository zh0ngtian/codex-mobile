import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';
import { nativeSwitchStore } from '../../src/native-ui/switch-store';
const server = vi.hoisted(() => ({ requests: [] as Array<{ method: string; params: any }>, options: null as any, client: null as any, readOnly: false }));
const restoredSettings = { model: 'local-model', effort: 'high', serviceTier: 'priority', permissions: ':workspace', approvalPolicy: 'never' as const, approvalsReviewer: 'auto_review' as const };
const remoteSettings = { model: 'server-model', reasoningEffort: 'low', serviceTier: null, approvalPolicy: 'on-request', approvalsReviewer: 'user', activePermissionProfile: { id: ':read-only' } };
const turn = { id: 'server-turn', status: 'completed', items: [{ id: 'server-message', type: 'agentMessage', phase: 'final_answer', text: '服务器恢复的消息' }] };
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
 constructor(private options: any) { server.options = options; }
 client() { return server.client; } socket() { return null; } close() {} reconnect() {}
 sync(backends: any[]) {
  const client = { onNotification() { return () => {}; }, onThreadMetadata() { return () => {}; }, request: async (method: string, params: any) => {
   server.requests.push({ method, params });
   if (method === 'thread/list' && params?.sectionId) return { data: [], nextCursor: null };
      if (method === 'threadSection/list') return { data: [{ id: '01984de2-8f74-7c91-a3b2-5c5e937cf318', name: 'Pinned' }], nextCursor: null };
      if (method === 'model/list') return { data: [
    { model: 'server-model', displayName: '服务器模型', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }], serviceTiers: [] },
    { model: 'local-model', displayName: '检查点模型', supportedReasoningEfforts: [{ reasoningEffort: 'high' }], serviceTiers: [{ id: 'priority', name: 'Fast' }] },
   ] };
   if (method === 'permissionProfile/list') return { data: [{ id: ':workspace', allowed: true }, { id: ':read-only', allowed: true }] };
   if (method === 'config/read') return { config: { model: 'server-model', model_reasoning_effort: 'low', sandbox_mode: 'read-only', approval_policy: 'on-request', approvals_reviewer: 'user' } };
   if (method === 'thread/resume') {
    if (server.readOnly) throw new Error('thread already has an active writer');
    return { ...remoteSettings, thread: { id: 'restored-thread', cwd: '/project', turns: [] }, initialTurnsPage: { data: [turn], nextCursor: null } };
   }
   if (method === 'thread/read') return { thread: { id: 'restored-thread', cwd: '/project', turns: [] } };
   if (method === 'thread/turns/list') return { data: [turn], nextCursor: null };
   return { data: [], items: [], marketplaces: [], nextCursor: null };
  } };
  server.client = client;
  queueMicrotask(() => { this.options.onConnection(backends[0].id, 'online'); this.options.onReady(backends[0].id, client); });
 }
} }));
const snapshots: any[] = [];
function command(id: string, name: string, params: Record<string, unknown> = {}) { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } })); }
afterEach(() => { cleanup(); localStorage.clear(); snapshots.length = 0; server.requests = []; server.client = null; server.options = null; server.readOnly = false; for (const key of ['__CODEX_IOS_HOST__', '__CODEX_NATIVE_UI__', 'webkit', 'codexMobilePublishNativeSnapshot', 'codexMobileNativePreference', 'codexMobileNativePreferenceComplete']) delete (window as any)[key]; vi.unstubAllGlobals(); });
async function setup(readOnly: boolean, options: { newChat?: boolean; cwd?: string | null; native?: boolean; projects?: string[] } = {}) {
 server.readOnly = readOnly; vi.stubGlobal('indexedDB', new IDBFactory());
 Object.assign(window, { __CODEX_IOS_HOST__: true, __CODEX_NATIVE_UI__: options.native ?? true, webkit: { messageHandlers: { nativeUI: { postMessage(message: any) { if (message.type === 'nativePreference') { const complete = (window as any).codexMobileNativePreferenceComplete; queueMicrotask(() => complete({ id: message.id, enabled: message.enabled ?? true, active: true })); } } } } }, codexMobilePublishNativeSnapshot: (snapshot: any) => snapshots.push(snapshot) });
 vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ projects: options.projects ?? [], projectlessThreadIds: [], items: [] }))));
 const registry = { version: 1 as const, selectedBackendId: 'a', backends: [{ id: 'a', hostId: 'host', name: '设备', enabled: true, order: 0, baseUrl: 'https://gateway.invalid', token: '' }] };
 const thread = options.newChat ? { id: '', cwd: options.cwd ?? null } : { id: 'restored-thread', cwd: '/project' };
 await nativeSwitchStore.save({ version: 1, registry, storage: {}, workspaces: [{ backendId: 'a', backendName: '设备', cwd: thread.cwd, text: '不自动发送的恢复输入', thread, images: [], files: [], settings: restoredSettings }] });
 render(<AppBootstrap initialRegistry={registry} />);
 if (options.newChat) await screen.findByRole('textbox', { name: '向 Codex 提问' });
 else await waitFor(() => expect(snapshots.at(-1)?.messages.some((message: any) => message.text === '服务器恢复的消息')).toBe(true));
}
it.each([false, true])('已有线程首轮resume保持本地恢复设置，同时接收服务器消息与只读状态=%s', async readOnly => {
 await setup(readOnly);
 expect(snapshots.at(-1).readOnly).toBe(readOnly); expect(snapshots.at(-1).draft).toBe('不自动发送的恢复输入');
 await act(async () => command('checkpoint-after-resume', 'settings.native-ui', { enabled: false }));
 await waitFor(() => expect(snapshots.at(-1)?.commandResults?.find((result: any) => result.id === 'checkpoint-after-resume')?.ok).toBe(true));
 expect((await nativeSwitchStore.load())?.workspaces[0].settings).toEqual(restoredSettings);
 expect(server.requests.some(request => ['thread/settings/update', 'thread/start', 'turn/start'].includes(request.method))).toBe(false);
});
it('首次恢复设置只消费一次，后续普通重连继续同步服务器线程设置', async () => {
 await setup(false);
 await act(async () => { server.options.onReady('a', server.client); });
 await waitFor(() => expect(server.requests.filter(request => request.method === 'thread/resume')).toHaveLength(2));
 await waitFor(() => expect(snapshots.at(-1)?.model).toBe('服务器模型'));
 await act(async () => command('checkpoint-after-reconnect', 'settings.native-ui', { enabled: false }));
 await waitFor(() => expect(snapshots.at(-1)?.commandResults?.find((result: any) => result.id === 'checkpoint-after-reconnect')?.ok).toBe(true));
 expect((await nativeSwitchStore.load())?.workspaces[0].settings).toEqual({ model: 'server-model', effort: 'low', serviceTier: null, permissions: ':read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' });
 expect(server.requests.some(request => ['thread/settings/update', 'turn/start'].includes(request.method))).toBe(false);
});

it.each([false, true])('明确无项目的新对话在非空项目列表到达后仍保留null，原生模式=%s', async native => {
 await setup(false, { native, newChat: true, cwd: null, projects: ['/work/SignOs', '/work/Other'] });
 await screen.findByRole('option', { name: 'SignOs' });
 expect(screen.getByRole('combobox', { name: '选择项目' })).toHaveValue('');
 expect(screen.getByRole('textbox', { name: '向 Codex 提问' })).toHaveValue('不自动发送的恢复输入');
 expect(server.requests.some(request => ['thread/resume', 'thread/start', 'turn/start'].includes(request.method))).toBe(false);
});
it('明确选择的恢复项目在项目列表加载后保留，不会改成首个项目', async () => {
 await setup(false, { native: false, newChat: true, cwd: '/work/Other', projects: ['/work/SignOs', '/work/Other'] });
 await screen.findByRole('option', { name: 'SignOs' });
 expect(screen.getByRole('combobox', { name: '选择项目' })).toHaveValue('/work/Other');
});
it('用户显式新建仍沿用现有首项目默认行为，区别于检查点恢复', async () => {
 await setup(false, { newChat: true, cwd: null, projects: ['/work/SignOs', '/work/Other'] });
 await screen.findByRole('option', { name: 'SignOs' });
 await waitFor(() => expect(snapshots.at(-1)?.ready).toBe(true));
 await act(async () => command('explicit-new-chat', 'thread.new'));
 await waitFor(() => expect(screen.getByRole('combobox', { name: '选择项目' })).toHaveValue('/work/SignOs'));
 expect(screen.getByRole('textbox', { name: '向 Codex 提问' })).toHaveValue('');
});
