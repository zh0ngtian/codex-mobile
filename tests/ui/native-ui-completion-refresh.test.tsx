import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppBootstrap } from '../../src/App';
import type { NativeSnapshot } from '../../src/native-ui/protocol';

const server = vi.hoisted(() => ({ options: null as any, client: null as any, turns: [] as any[], requests: [] as string[] }));
const thread = { id: 'completion-thread', name: '完成刷新验证', cwd: '/project', status: { type: 'active' } };
vi.mock('../../src/backends/connection-manager', () => ({ BackendConnectionManager: class {
  constructor(options: any) { server.options = options; }
  client() { return server.client; } socket() { return null; } close() {} reconnect() {}
  sync(backends: any[]) {
    server.client = { onNotification() { return () => {}; }, onThreadMetadata() { return () => {}; }, request: async (method: string) => {
      server.requests.push(method);
      if (method === 'model/list') return { data: [{ model: 'test', isDefault: true, supportedReasoningEfforts: [] }] };
      if (method === 'permissionProfile/list') return { data: [{ id: ':workspace', allowed: true }] };
      if (method === 'config/read') return { config: { model: 'test', sandbox_mode: 'workspace-write' } };
      if (method === 'thread/list' || method === 'mobile/sidebar/summaries') return { data: [thread], nextCursor: null };
      if (method === 'thread/resume') return { thread, model: 'test', initialTurnsPage: { data: structuredClone(server.turns), nextCursor: null } };
      if (method === 'thread/turns/list') return { data: structuredClone(server.turns), nextCursor: null };
      return { data: [], items: [], nextCursor: null };
    } };
    queueMicrotask(() => { server.options.onConnection(backends[0].id, 'online'); server.options.onReady(backends[0].id, server.client); });
  }
} }));
const posts: NativeSnapshot[] = [];
afterEach(() => {
  cleanup(); localStorage.clear(); posts.length = 0; server.requests = []; server.client = null; server.options = null;
  for (const key of ['__CODEX_NATIVE_UI__', 'webkit', 'codexMobilePublishNativeSnapshot']) delete (window as any)[key];
  vi.unstubAllGlobals();
});

async function openRunningConversation() {
  server.turns = [{ id: 'turn', status: 'inProgress', startedAt: 100, itemsView: 'summary', items: [
    { id: 'user', type: 'userMessage', text: '检查完成刷新' },
    { id: 'progress', type: 'agentMessage', phase: 'commentary', text: '执行进展' },
  ] }];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ projects: ['/project'], projectlessThreadIds: [] }))));
  Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } },
    codexMobilePublishNativeSnapshot: (snapshot: NativeSnapshot) => posts.push(snapshot) });
  const registry = { version: 1 as const, selectedBackendId: 'a', backends: [
    { id: 'a', hostId: 'a', name: '测试设备', baseUrl: 'http://completion.test', token: 'test', enabled: true, order: 0 },
  ] };
  render(<AppBootstrap initialRegistry={registry} />);
  await waitFor(() => expect(posts.at(-1)?.groups.some(group => group.items.some(item => item.threadId === thread.id))).toBe(true));
  await act(async () => window.dispatchEvent(new CustomEvent('codex-mobile-native-command', {
    detail: { id: 'open-completion', name: 'thread.open', params: { backendId: 'a', threadId: thread.id } },
  })));
  await waitFor(() => expect(posts.at(-1)).toMatchObject({ threadId: thread.id, loading: 'ready', busy: true }));
}
async function notify(method: string, params: Record<string, unknown>) {
  await act(async () => server.options.onNotification('a', { method, params: { threadId: thread.id, ...params } }, server.client));
}
const finalItem = { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '留在会话内收到最终回复' };
function finishServerTurn() {
  server.turns = [{ ...server.turns[0], status: 'completed', completedAt: 155, items: [...server.turns[0].items, finalItem] }];
}

it.each([false, true])('漏收最终消息后 idle 在当前原生会话补齐回复，先收到完成通知=%s', async completedFirst => {
  await openRunningConversation();
  if (completedFirst) {
    // 完成通知先到，但这次读取还没有落盘的 final。
    await notify('turn/completed', { turn: { id: 'turn', status: 'completed', completedAt: 155 } });
    await waitFor(() => expect(server.requests.filter(method => method === 'thread/turns/list').length).toBeGreaterThan(0));
    await waitFor(() => expect(posts.at(-1)?.busy).toBe(false));
  }
  finishServerTurn();
  await notify('thread/status/changed', { status: { type: 'idle' } });
  await waitFor(() => expect(posts.at(-1)?.messages.some(message => message.text === finalItem.text)).toBe(true));
  expect(posts.at(-1)?.busy).toBe(false);
  expect(posts.at(-1)?.messages.find(message => message.itemId === 'final')?.status).toBe('55秒');
  expect(server.requests.filter(method => method === 'thread/resume')).toHaveLength(1);
});

it('其他会话 idle 不触发当前会话读取，正常完成事件直接呈现回复', async () => {
  await openRunningConversation();
  const reads = server.requests.filter(method => method === 'thread/turns/list').length;
  await notify('thread/status/changed', { threadId: 'other-thread', status: { type: 'idle' } });
  expect(server.requests.filter(method => method === 'thread/turns/list')).toHaveLength(reads);
  finishServerTurn();
  await notify('item/completed', { turnId: 'turn', item: finalItem });
  await notify('turn/completed', { turn: server.turns[0] });
  await waitFor(() => expect(posts.at(-1)?.messages.some(message => message.text === finalItem.text)).toBe(true));
  expect(server.requests.filter(method => method === 'thread/resume')).toHaveLength(1);
});
