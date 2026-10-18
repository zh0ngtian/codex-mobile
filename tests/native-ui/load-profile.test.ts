import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('默认不发送测量数据，显式启用后也不记录正文、会话ID或凭据', async () => {
  const postMessage = vi.fn();
  const target = { __CODEX_LOAD_PROFILE__: false, webkit: { messageHandlers: { nativeUI: { postMessage } } } };
  vi.stubGlobal('window', target);
  const profile = await import('../../src/diagnostics/conversation-load-profile');
  profile.beginLoadProfile('command-a', 'private-thread');
  expect(profile.startLoadRpc('thread/resume', { threadId: 'private-thread' })).toBeUndefined();
  expect(postMessage).not.toHaveBeenCalled();
  target.__CODEX_LOAD_PROFILE__ = true;
  profile.beginLoadProfile('command-a', 'private-thread');
  const rpc = profile.startLoadRpc('thread/resume', { threadId: 'private-thread', token: 'private-token', text: 'private-body' });
  profile.endLoadRpc(rpc, true);
  profile.profileReadySnapshot({ threadId: 'private-thread', loading: 'ready', messages: [{ text: 'private-body' }] });
  profile.profileReadySnapshot({ threadId: 'private-thread', loading: 'ready', messages: [{ text: 'another-private-body' }] });
  expect(postMessage.mock.calls.map(([value]) => value.phase)).toEqual(['js-command', 'rpc-start', 'rpc-end', 'js-ready-snapshot']);
  expect(postMessage.mock.calls.at(-1)?.[0].data).toEqual({ messages: 1, textChars: 12 });
  const encoded = JSON.stringify(postMessage.mock.calls);
  for (const privateValue of ['private-thread', 'private-token', 'private-body']) expect(encoded).not.toContain(privateValue);
});

it('异步RPC结果保留原测量身份，不把其他会话与后台请求计入当前样本', async () => {
  const postMessage = vi.fn();
  vi.stubGlobal('window', { __CODEX_LOAD_PROFILE__: true, webkit: { messageHandlers: { nativeUI: { postMessage } } } });
  const profile = await import('../../src/diagnostics/conversation-load-profile');
  profile.beginLoadProfile('a', 'thread-a');
  expect(profile.startLoadRpc('account/read', {})).toBeUndefined();
  expect(profile.startLoadRpc('thread/resume', { threadId: 'other' })).toBeUndefined();
  const rpc = profile.startLoadRpc('thread/resume', { threadId: 'thread-a' });
  profile.beginLoadProfile('b', 'thread-b');
  profile.endLoadRpc(rpc, false);
  expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ id: 'a', phase: 'rpc-end', data: { ok: false } });
  profile.profileReadySnapshot({ threadId: 'thread-a', loading: 'ready', messages: [] });
  expect(postMessage.mock.calls.filter(([value]) => value.phase === 'js-ready-snapshot')).toHaveLength(0);
});
