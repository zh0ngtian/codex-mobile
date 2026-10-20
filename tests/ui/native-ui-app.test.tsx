import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';
const server = vi.hoisted(() => ({ enabled: false, clients: new Map<string, any>(), requests: [] as string[], threads: new Map<string, any[]>(), threadListGate: null as Promise<void> | null, failThreadList: false }));
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
  constructor(private options: any) {}
  sync(backends: any[]) {
   if (!server.enabled) return;
   for (const backend of backends) {
    if (server.clients.has(backend.id)) continue;
    const client = { onNotification() { return () => {}; }, onThreadMetadata() { return () => {}; }, request: async (method: string, params: any) => {
     server.requests.push(method);
     if (method === 'thread/list' && server.threadListGate) await server.threadListGate;
     if (method === 'thread/list' && server.failThreadList) throw new Error('首次会话读取失败');
     if (method === 'config/read') return { config: {} };
     if (method === 'thread/list') return { data: server.threads.get(backend.id) ?? [], nextCursor: null };
     if (method === 'thread/read' || method === 'thread/resume') return { thread: (server.threads.get(backend.id) ?? []).find(thread => thread.id === params.threadId), initialTurnsPage: { data: [], nextCursor: null } };
     return { data: [], items: [], marketplaces: [], nextCursor: null };
    } };
    server.clients.set(backend.id, client);
    queueMicrotask(() => { this.options.onConnection(backend.id, 'online'); this.options.onReady(backend.id, client); });
   }
  }
  close() {} reconnect() {} client(id: string) { return server.clients.get(id) ?? null; } socket() { return null; }
} }));
const posts: any[] = [];
function command(id: string, name: string, params: Record<string, unknown> = {}) { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } })); }
afterEach(() => { cleanup(); localStorage.clear(); delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).webkit; delete (window as any).codexMobilePublishNativeSnapshot; posts.length = 0; server.enabled = false; server.clients.clear(); server.threads.clear(); server.requests = []; server.threadListGate = null; server.failThreadList = false; vi.unstubAllGlobals(); });
it('真实App注册导航与各设备workspace：原生关闭侧栏、切换列表筛选、创建对话和草稿均复用业务状态', async () => {
 Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (value: unknown) => posts.push(value) });
 vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })));
 render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: 'a', backends: [
  { id: 'a', hostId: 'ha', name: '甲设备', enabled: true, order: 0, baseUrl: 'https://a.invalid', token: 'SECRET-A' },
  { id: 'b', hostId: 'hb', name: '乙设备', enabled: true, order: 1, baseUrl: 'https://b.invalid', token: 'SECRET-B' },
 ] }} />);
 await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 expect(posts.at(-1).loading).toBe('ready');
 expect(screen.getAllByRole('textbox', { name: '向 Codex 提问' }).length).toBeGreaterThan(0);
 expect(posts.at(-1).sidebarOpen).toBe(false); expect(posts.at(-1).backends.map((b: any) => b.id)).toEqual(['all', 'a', 'b']);
 expect(JSON.stringify(posts)).not.toContain('SECRET-');
 await act(async () => { command('filter', 'backend.select', { id: 'b' }); });
 await waitFor(() => expect(localStorage.getItem('codex-mobile:list-backend')).toBe('b'));
 await waitFor(() => expect(posts.at(-1)?.listBackendId).toBe('b'));
 expect(posts.at(-1).backendId).toBe('a');
 await act(async () => { command('search-native', 'navigation.search', { value: '没有匹配' }); });
 await waitFor(() => expect(posts.at(-1)?.groups.map((group: any) => group.category)).toEqual(['search']));
 await act(async () => { command('clear-search-native', 'navigation.search', { value: '' }); });
 await waitFor(() => expect(posts.at(-1)?.groups.some((group: any) => group.category === 'recent')).toBe(true));
 await act(async () => { command('invalid-project', 'project.toggle', { backendId: 'removed', cwd: '/fake' }); });
 await waitFor(() => expect(posts.at(-1)?.commandResults?.find((r: any) => r.id === 'invalid-project')?.ok).toBe(false));
 expect(localStorage.getItem('codex-mobile:collapsed-projects')).toBeNull();
 // 列表筛选不改变当前workspace；新建才按筛选目标选择设备。
 expect(posts.at(-1).backendId).toBe('a');
 await act(async () => { command('new', 'thread.new'); });
 await waitFor(() => expect(posts.at(-1)?.backendId).toBe('b'));
 const contextId = posts.at(-1).contextId;
 await act(async () => { command('draft', 'draft.set', { contextId, value: '真正的原生草稿', revision: 1 }); });
 await waitFor(() => expect(posts.at(-1)?.draft).toBe('真正的原生草稿'));
 expect(posts.at(-1).draftRevision).toBe(1);
 await act(async () => { command('open', 'navigation.sidebar', { open: true }); });
 await waitFor(() => expect(posts.at(-1)?.sidebarOpen).toBe(true));
 await act(async () => { command('before-switch', 'draft.set', { contextId, value: '切设备前最新输入', revision: 2 }); command('switch-new-device', 'newchat.backend', { contextId, value: 'a' }); });
 await waitFor(() => expect(posts.at(-1)?.backendId).toBe('a')); expect(posts.at(-1).draft).toBe('切设备前最新输入');
});
it('无设备冷启动直接发布ready原生添加设备表单，配置后沿同一业务入口管理设置和草稿', async () => {
 Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (v: unknown) => posts.push(v) });
 render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: '', backends: [] }} />);
 await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 expect(posts.at(-1).panel.id).toBe('devices'); expect(posts.at(-1).panel.items.some((i: any) => i.id === 'gatewayUrl')).toBe(true);
});
it('无设备关闭表单后仍保持ready并能通过添加设备动作重新打开', async () => {
 Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (v: unknown) => posts.push(v) });
 render(<AppBootstrap initialRegistry={{ version: 1, selectedBackendId: '', backends: [] }} />);
 await waitFor(() => expect(posts.at(-1)?.panel?.id).toBe('devices'));
 await act(async () => { command('close-empty', 'panel.close', { id: 'devices' }); });
 await waitFor(() => expect(posts.at(-1)?.panel).toBeUndefined());
 expect(posts.at(-1).ready).toBe(true); expect(posts.at(-1).conversationActions.some((i: any) => i.command?.name === 'settings.open')).toBe(true);
 await act(async () => { command('reopen-empty', 'settings.open'); }); await waitFor(() => expect(posts.at(-1)?.panel?.id).toBe('devices'));
});

const memoryRegistry = { version: 1 as const, selectedBackendId: 'a', backends: [
 { id: 'a', hostId: 'ha', name: '甲设备', enabled: true, order: 0, baseUrl: 'https://a.invalid', token: '' },
 { id: 'b', hostId: 'hb', name: '乙设备', enabled: true, order: 1, baseUrl: 'https://b.invalid', token: '' },
] };
function enableNativeMemoryTest() {
 server.enabled = true;
 Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } }, codexMobilePublishNativeSnapshot: (snapshot: unknown) => posts.push(snapshot) });
}

it('阅读甲机器对话时无参新建继承甲项目，明确乙机器新建仍恢复乙项目', async () => {
 enableNativeMemoryTest();
 server.threads.set('a', [{ id: 'current-a', cwd: '/a/current', preview: '甲当前对话', turns: [] }]);
 localStorage.setItem('codex-mobile:new-chat-backend', 'b');
 localStorage.setItem('codex-mobile:new-chat-project:b', '/b/remembered');
 vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ projects: String(url).includes('a.invalid') ? ['/a/current'] : ['/b/remembered'], projectlessThreadIds: [] }))));
 render(<AppBootstrap initialRegistry={memoryRegistry} />);
 await waitFor(() => expect(posts.at(-1)?.groups.some((g: any) => g.items.some((item: any) => item.threadId === 'current-a'))).toBe(true));
 await act(async () => command('open-a-current', 'thread.open', { backendId: 'a', threadId: 'current-a' }));
 await waitFor(() => expect(posts.at(-1)?.threadId).toBe('current-a'));
 await act(async () => command('new-current-a', 'thread.new'));
 await waitFor(() => expect(posts.at(-1)?.threadId).toBeUndefined());
 expect(posts.at(-1).backendId).toBe('a'); expect(posts.at(-1).cwd).toBe('/a/current');
 await act(async () => command('new-explicit-b', 'thread.new', { backendId: 'b' }));
 await waitFor(() => expect(posts.at(-1)?.backendId).toBe('b')); expect(posts.at(-1).cwd).toBe('/b/remembered');
});
it('当前机器项目目录稍后返回时仍恢复已保存的项目', async () => {
 enableNativeMemoryTest();
 localStorage.setItem('codex-mobile:new-chat-project:a', '/a/remembered');
 let releaseProjects: (() => void) | undefined;
 const ready = new Promise<void>(resolve => { releaseProjects = resolve; });
 vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (String(url).includes('/api/projects')) { await ready; return new Response(JSON.stringify({ projects: ['/a/first', '/a/remembered'], projectlessThreadIds: [] })); }
  return new Response('{}');
 }));
 render(<AppBootstrap initialRegistry={{ ...memoryRegistry, backends: memoryRegistry.backends.slice(0, 1) }} />);
 await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 await act(async () => command('late-projects-new', 'thread.new'));
 await act(async () => releaseProjects!());
 await waitFor(() => expect(posts.at(-1)?.cwd).toBe('/a/remembered'));
});
it.each([[true, true, false], [true, false, false], [false, true, false], [true, true, true]])('首次读取失败保留待恢复项目（目录失败=%s，会话失败=%s，新上下文替换=%s）', async (initialProjectFailure, initialThreadFailure, replaceContextDuringRetry) => {
 enableNativeMemoryTest(); server.failThreadList = initialThreadFailure;
 localStorage.setItem('codex-mobile:new-chat-project:a', '/a/remembered');
 let firstLoad = true;
 let releaseFirstProjects: (() => void) | undefined;
 const firstProjects = new Promise<void>(resolve => { releaseFirstProjects = resolve; });
 vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (!String(url).includes('/api/projects')) return new Response('{}');
  if (firstLoad) { await firstProjects; if (initialProjectFailure) throw new Error('首次目录读取失败'); return new Response(JSON.stringify({ projects: [], projectlessThreadIds: [] })); }
  return new Response(JSON.stringify({ projects: ['/a/first', '/a/remembered'], projectlessThreadIds: [] }));
 }));
 render(<AppBootstrap initialRegistry={{ ...memoryRegistry, backends: memoryRegistry.backends.slice(0, 1) }} />);
 await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 const previousContextId = posts.at(-1).contextId;
 await act(async () => command('new-before-load-failure', 'thread.new'));
 await waitFor(() => expect(posts.at(-1)?.contextId).not.toBe(previousContextId));
 const contextId = posts.at(-1).contextId;
 await act(async () => releaseFirstProjects!());
 if (initialThreadFailure) await waitFor(() => expect(posts.at(-1)?.error).toContain('首次会话读取失败'));
 else await waitFor(() => expect(server.requests).toContain('thread/list'));
 await act(async () => command('typing-between-project-retries', 'draft.set', { contextId, value: '失败后继续输入的正文', revision: 1 }));
 firstLoad = false; server.failThreadList = false;
 let releaseRetryThreads: (() => void) | undefined;
 if (replaceContextDuringRetry) server.threadListGate = new Promise<void>(resolve => { releaseRetryThreads = resolve; });
 await act(async () => command('retry-failed-projects', 'navigation.refresh'));
 await waitFor(() => expect(posts.at(-1)?.groups.some((group: any) => group.cwd === '/a/remembered')).toBe(true));
 if (replaceContextDuringRetry) {
  await act(async () => command('replace-pending-retry-context', 'thread.new', { backendId: 'a', cwd: '/a/first' }));
  await waitFor(() => expect(posts.at(-1)?.contextId).not.toBe(contextId));
  const replacementContextId = posts.at(-1).contextId;
  await act(async () => command('typing-in-replacement-context', 'draft.set', { contextId: replacementContextId, value: '新上下文的正文', revision: 1 }));
  await waitFor(() => expect(posts.at(-1)?.draft).toBe('新上下文的正文'));
  await act(async () => releaseRetryThreads!());
  await waitFor(() => expect(posts.at(-1)?.cwd).toBe('/a/first'));
  expect(posts.at(-1).contextId).toBe(replacementContextId);
  expect(posts.at(-1).draft).toBe('新上下文的正文');
 } else {
  await waitFor(() => expect(posts.at(-1)?.cwd).toBe('/a/remembered'));
  expect(posts.at(-1).draft).toBe('失败后继续输入的正文');
  expect(posts.at(-1).contextId).toBe(contextId);
 }
 expect(localStorage.getItem('codex-mobile:new-chat-project:a')).toBe('/a/remembered');
});
it('目录等待期间手动选择无项目，迟到恢复不得覆盖该选择', async () => {
 enableNativeMemoryTest();
 localStorage.setItem('codex-mobile:new-chat-project:a', '/a/remembered');
 let releaseProjects: (() => void) | undefined;
 const ready = new Promise<void>(resolve => { releaseProjects = resolve; });
 vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (String(url).includes('/api/projects')) { await ready; return new Response(JSON.stringify({ projects: ['/a/first', '/a/remembered'], projectlessThreadIds: [] })); }
  return new Response('{}');
 }));
 render(<AppBootstrap initialRegistry={{ ...memoryRegistry, backends: memoryRegistry.backends.slice(0, 1) }} />);
 await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 const previousContextId = posts.at(-1).contextId;
 await act(async () => command('pending-projects-new', 'thread.new'));
 await waitFor(() => expect(posts.at(-1)?.contextId).not.toBe(previousContextId));
 const contextId = posts.at(-1).contextId;
 await act(async () => command('choose-projectless-while-loading', 'newchat.project', { contextId, value: '' }));
 await waitFor(() => expect(localStorage.getItem('codex-mobile:new-chat-project:a')).toBe(''));
 await act(async () => releaseProjects!());
 await waitFor(() => expect(posts.at(-1)?.groups.some((group: any) => group.cwd === '/a/remembered')).toBe(true));
 expect(posts.at(-1).projectName).toBe('无项目');
 expect(localStorage.getItem('codex-mobile:new-chat-project:a')).toBe('');
});
it('首次项目读取尚未完成时不先选临时目标，完成后才恢复保存项目', async () => {
 enableNativeMemoryTest();
 localStorage.setItem('codex-mobile:new-chat-project:a', '/a/remembered');
 let releaseThreads: (() => void) | undefined;
 server.threadListGate = new Promise<void>(resolve => { releaseThreads = resolve; });
 vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ projects: ['/a/first', '/a/remembered'], projectlessThreadIds: [] }))));
 render(<AppBootstrap initialRegistry={{ ...memoryRegistry, backends: memoryRegistry.backends.slice(0, 1) }} />);
 await waitFor(() => expect(posts.at(-1)?.groups.some((group: any) => group.cwd === '/a/remembered')).toBe(true));
 const previousContextId = posts.at(-1).contextId;
 await act(async () => command('new-before-first-list-completes', 'thread.new'));
 await waitFor(() => expect(posts.at(-1)?.contextId).not.toBe(previousContextId));
 try { expect(posts.at(-1).cwd).toBeUndefined(); }
 finally { await act(async () => releaseThreads!()); }
 await waitFor(() => expect(posts.at(-1)?.cwd).toBe('/a/remembered'));
});
it('普通新建优先恢复上次机器，目录异步到达后恢复上次项目，重复新建与重新挂载继续记忆', async () => {
 enableNativeMemoryTest();
 localStorage.setItem('codex-mobile:list-backend', 'a');
 localStorage.setItem('codex-mobile:new-chat-backend', 'b');
 localStorage.setItem('codex-mobile:new-chat-project:b', '/b/remembered');
 let releaseProjects: (() => void) | undefined;
 const ready = new Promise<void>(resolve => { releaseProjects = resolve; });
 vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (String(url).includes('/api/projects')) {
   await ready;
   return new Response(JSON.stringify({ projects: String(url).includes('b.invalid') ? ['/b/first', '/b/remembered'] : ['/a/first'], projectlessThreadIds: [] }));
  }
  return new Response('{}');
 }));
 let app = render(<AppBootstrap initialRegistry={memoryRegistry} />);
 await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 await act(async () => command('remembered-new-before-projects', 'thread.new'));
 await waitFor(() => expect(posts.at(-1)?.backendId).toBe('b'));
 const contextId = posts.at(-1).contextId;
 await act(async () => command('typing-before-projects', 'draft.set', { contextId, value: '加载期间的正文', revision: 1 }));
 await act(async () => releaseProjects!());
 await waitFor(() => expect(posts.at(-1)?.cwd).toBe('/b/remembered'));
 expect(posts.at(-1).draft).toBe('加载期间的正文');
 await act(async () => command('remembered-new-again', 'thread.new'));
 await waitFor(() => expect(posts.at(-1)?.contextId).not.toBe(contextId));
 expect(posts.at(-1).backendId).toBe('b'); expect(posts.at(-1).cwd).toBe('/b/remembered');
 app.unmount(); server.clients.clear(); posts.length = 0;
 app = render(<AppBootstrap initialRegistry={memoryRegistry} />);
 await waitFor(() => expect(posts.at(-1)?.ready).toBe(true));
 await act(async () => command('remembered-new-after-remount', 'thread.new'));
 await waitFor(() => expect(posts.at(-1)?.backendId).toBe('b'));
 await waitFor(() => expect(posts.at(-1)?.cwd).toBe('/b/remembered'));
 expect(server.requests).not.toContain('thread/start');
});

it('切换新对话机器恢复各自上次项目，并保留当前正文和附件', async () => {
 enableNativeMemoryTest();
 localStorage.setItem('codex-mobile:new-chat-project:a', '/a/remembered');
 localStorage.setItem('codex-mobile:new-chat-project:b', '/b/remembered');
 let releaseProjectsA: (() => void) | undefined;
 const readyA = new Promise<void>(resolve => { releaseProjectsA = resolve; });
 vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (String(url).includes('/api/projects') && String(url).includes('a.invalid')) await readyA;
  return new Response(JSON.stringify({ projects: String(url).includes('b.invalid') ? ['/b/first', '/b/remembered'] : ['/a/first', '/a/remembered'], projectlessThreadIds: [] }));
 }));
 render(<AppBootstrap initialRegistry={memoryRegistry} />);
 await waitFor(() => expect(posts.at(-1)?.groups.some((group: any) => group.cwd === '/b/remembered')).toBe(true));
 await act(async () => command('explicit-device-new', 'thread.new', { backendId: 'a' }));
 await waitFor(() => expect(posts.at(-1)?.commandResults?.some((result: any) => result.id === 'explicit-device-new' && result.ok)).toBe(true));
 let contextId = posts.at(-1).contextId;
 await act(async () => command('memory-draft', 'draft.set', { contextId, value: '切换保留正文', revision: 1 }));
 await act(async () => command('memory-attachment', 'attachment.import', { contextId, items: [{ name: '保留.png', type: 'image/png', data: 'aGVsbG8=' }] }));
 await waitFor(() => expect(posts.at(-1)?.attachments).toHaveLength(1));
 await act(async () => command('memory-switch-b', 'newchat.backend', { contextId, value: 'b' }));
 await waitFor(() => expect(posts.at(-1)?.backendId).toBe('b'));
 await waitFor(() => expect(posts.at(-1)?.cwd).toBe('/b/remembered'));
 expect(posts.at(-1).draft).toBe('切换保留正文'); expect(posts.at(-1).attachments).toHaveLength(1);
 await act(async () => releaseProjectsA!());
 await waitFor(() => expect(posts.at(-1)?.groups.some((group: any) => group.cwd === '/a/remembered')).toBe(true));
 expect(posts.at(-1).backendId).toBe('b'); expect(posts.at(-1).cwd).toBe('/b/remembered');
 expect(localStorage.getItem('codex-mobile:new-chat-backend')).toBe('b');
 expect(localStorage.getItem('codex-mobile:new-chat-project:a')).toBe('/a/remembered');
 contextId = posts.at(-1).contextId;
 await act(async () => command('memory-switch-a', 'newchat.backend', { contextId, value: 'a' }));
 await waitFor(() => expect(posts.at(-1)?.cwd).toBe('/a/remembered'));
 expect(posts.at(-1).draft).toBe('切换保留正文'); expect(posts.at(-1).attachments).toHaveLength(1);
});
