import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
  sync() {} close() {} reconnect() {} client() { return null; } socket() { return null; }
} }));
const posts: any[] = [];
function command(id: string, name: string, params: Record<string, unknown> = {}) { window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: { id, name, params } })); }
afterEach(() => { cleanup(); localStorage.clear(); delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).webkit; delete (window as any).codexMobilePublishNativeSnapshot; posts.length = 0; vi.unstubAllGlobals(); });
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
