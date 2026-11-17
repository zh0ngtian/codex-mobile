import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { BackendManagerSheet } from '../../src/features/backends/BackendManagerSheet';
import { gatewayBackends, gatewayUrl, refreshGatewayTargets, transportNamespace } from '../../src/backends/gateway-route';
import { probeBackend } from '../../src/backends/probe';
import { HttpRpcTransport } from '../../src/backends/http-transport';
import { uploadFile } from '../../src/backends/file-upload';
import { gatewayOutbox } from '../../src/backends/outbox';
import { summarizeThreadTitle } from '../../src/backends/title-summary';
import { followUpRequest } from '../../src/backends/follow-ups';
import { loadBackendRegistry } from '../../src/backends/registry';
import { ConversationActionMenu } from '../../src/features/conversation/ConversationControls';
import { BackendConnectionManager } from '../../src/backends/connection-manager';
import type { BackendConfig, GatewayTarget } from '../../src/backends/types';

const target: GatewayTarget = { reference: { mode: 'remote', gatewayId: 'gateway', account: { accountId: 'account', accountUserId: 'user' }, target: { environmentId: 'env', installationId: 'install' } }, name: 'Mac', online: true, busy: false, isGatewayHost: true };
const local: BackendConfig = { id: 'gateway', name: 'Gateway', baseUrl: 'http://gateway.test', token: 'secret', enabled: true, order: 0 };
const remote: BackendConfig = { ...local, gatewayMode: 'remote', remoteTarget: target.reference, remoteTargets: [target] };
const transports: HttpRpcTransport[] = [];
afterEach(() => { transports.splice(0).forEach(value => value.close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('多网关保留，网关本机共享业务 ID，所有 Remote URL 均携完整引用且隔离传输', () => {
  const child = { ...target, isGatewayHost: false, reference: { ...target.reference, target: { environmentId: 'other', installationId: 'other-install' } } };
  const machines = gatewayBackends([{ ...remote, remoteTargets: [target, child] }, { ...local, id: 'second', baseUrl: 'https://other.test' }]);
  expect(machines).toHaveLength(3); expect(machines[0].id).toBe(local.id); expect(machines[1].id).not.toBe(machines[0].id);
  expect(transportNamespace(machines[0])).not.toBe(transportNamespace(local));
  for (const path of ['/api/rpc', '/api/events', '/api/operations', '/api/follow-ups', '/api/images/preview', '/api/notifications/settings', '/ws']) {
    const url = gatewayUrl(machines[0], path); expect(url.searchParams.get('mode')).toBe('remote'); expect(JSON.parse(url.searchParams.get('target')!)).toEqual(target.reference);
  }
  expect(() => gatewayUrl({ ...remote, remoteTarget: undefined }, '/api/rpc')).toThrow();
  const replacement = { ...target, reference: { ...target.reference, target: { ...target.reference.target, installationId: 'new-install' } } };
  const refreshed = refreshGatewayTargets([target], [replacement]);
  expect(refreshed[0]).toMatchObject({ reference: target.reference, online: false }); expect(refreshed[1].isGatewayHost).toBe(false);
});
it('Remote 不支持、缺授权和缺配对分别阻止保存，已配置临时离线允许保存且不初始化上游', async () => {
  const initializeHttp = vi.fn();
  const host = { hostId: 'gateway', displayName: 'Gateway', appServerReady: false, httpPolling: true };
  const run = (capability?: object) => probeBackend(remote, { initializeHttp, fetchHost: async () => new Response(JSON.stringify({ ...host, remote: capability })) });
  await expect(run()).rejects.toThrow('不支持远程模式');
  await expect(run({ version: 1, supported: true })).rejects.toThrow('尚未完成 Remote 授权');
  await expect(run({ version: 1, supported: true, authorized: true })).rejects.toThrow('尚未完成 Remote 配对');
  await expect(run({ version: 1, supported: true, authorized: true, paired: true, temporarilyOffline: true, targets: [target] })).resolves.toMatchObject(host);
  expect(initializeHttp).not.toHaveBeenCalled();
});
it('Remote 即使保留旧流式配置也经过耐久 HTTP，探测与实际连接保持一致', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const initializeHttp = vi.fn(async () => {}); const initializeStream = vi.fn(async () => {});
  const config = { ...remote, transportMode: 'stream' as const };
  await probeBackend(config, { initializeHttp, initializeStream, fetchHost: async () => new Response(JSON.stringify({
    hostId: 'gateway', displayName: 'Gateway', httpPolling: true, appServerReady: false,
    remote: { version: 1, supported: true, authorized: true, paired: true, targets: [target] },
  })) });
  expect(initializeHttp).toHaveBeenCalledWith(expect.objectContaining({ remoteTarget: target.reference }));
  expect(initializeStream).not.toHaveBeenCalled();
  const manager = new BackendConnectionManager();
  try { manager.sync([config]); expect(manager.socket(config.id)).toBeInstanceOf(HttpRpcTransport); }
  finally { manager.close(); }
});
it('Remote 测试保存允许超过本地6秒的握手，仍在60秒内结束', async () => {
  vi.useFakeTimers();
  const fetchHost = async () => new Response(JSON.stringify({ hostId: 'gateway', displayName: 'Gateway', httpPolling: true,
    remote: { version: 1, supported: true, authorized: true, paired: true, targets: [target] } }));
  const initializeHttp = () => new Promise<void>(resolve => setTimeout(resolve, 12_000));
  const result = probeBackend(remote, { fetchHost, initializeHttp }).then(value => ({ value }), error => ({ error }));
  await vi.advanceTimersByTimeAsync(12_001);
  expect(await result).toMatchObject({ value: { hostId: 'gateway' } });
});
it('Remote 实际 HTTP 探测将业务预算传入初始化和只读 RPC，并关闭探测传输', async () => {
  vi.useFakeTimers();
  vi.spyOn(gatewayOutbox, 'list').mockResolvedValue([]);
  const methods: string[] = [];
  const host = { hostId: 'gateway', displayName: 'Gateway', httpPolling: true,
    remote: { version: 1, supported: true, authorized: true, paired: true, targets: [target] } };
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === '/api/host') return new Response(JSON.stringify(host));
    expect(url.searchParams.get('mode')).toBe('remote');
    expect(JSON.parse(url.searchParams.get('target')!)).toEqual(target.reference);
    if (url.pathname === '/api/events') return new Response(JSON.stringify({ epoch: 'probe', cursor: 0, messages: [], requests: [], active: false }));
    const { message } = JSON.parse(String(init?.body)); methods.push(message.method);
    if (message.method !== 'initialized') await new Promise(resolve => setTimeout(resolve, 12_000));
    return new Response(JSON.stringify({ id: message.id, result: {} }));
  }));
  const result = probeBackend(remote).then(value => ({ value }), error => ({ error }));
  await vi.advanceTimersByTimeAsync(24_100);
  expect(await result).toMatchObject({ value: { hostId: 'gateway' } });
  expect(methods).toEqual(['initialize', 'initialized', 'thread/loaded/list']);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([{ config: remote, budget: 60_000 }, { config: local, budget: 6_000 }, { config: remote, budget: 20, explicit: true }])('探测无响应仍在对应预算结束 $budget', async ({ config, budget, explicit }) => {
  vi.useFakeTimers();
  const fetchHost = async () => new Response(JSON.stringify({ hostId: 'gateway', displayName: 'Gateway', appServerReady: true, httpPolling: true,
    remote: { version: 1, supported: true, authorized: true, paired: true, targets: [target] } }));
  let ended = false;
  const result = probeBackend(config, { fetchHost, initializeHttp: () => new Promise<void>(() => {}), ...(explicit ? { timeoutMs: budget } : {}) })
    .then(() => undefined, error => { ended = true; return error; });
  await vi.advanceTimersByTimeAsync(budget - 1); expect(ended).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(await result).toMatchObject({ message: 'HTTP initialize 超时' });
});
it('切换表单模式不探测；测试失败原子保留旧配置与输入', async () => {
  const probe = vi.fn(async () => { throw new Error('网关尚不支持远程模式，请先升级网关'); }); const onChange = vi.fn();
  render(<BackendManagerSheet open registry={{ version: 1, selectedBackendId: local.id, backends: [local] }} summaries={{}} onChange={onChange} onClose={() => {}} probe={probe} />);
  fireEvent.click(screen.getByRole('button', { name: '编辑 Gateway' }));
  fireEvent.change(screen.getByLabelText('连接模式'), { target: { value: 'remote' } }); expect(probe).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '测试并保存' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('尚不支持远程模式'); expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText('连接模式')).toHaveValue('remote');
});
it('202 ACK 只查询原 UUID，确认前后保留完整目标，不重复 POST', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); const posts: any[] = []; let queries = 0;
  const fetcher = vi.fn(async (url: any, options?: RequestInit) => {
    const path = new URL(String(url)); expect(path.searchParams.get('mode')).toBe('remote');
    if (path.pathname === '/api/operations') { queries++; return new Response(JSON.stringify({ status: 'completed', message: { result: { ok: true } } })); }
    posts.push(JSON.parse(String(options?.body))); return new Response(JSON.stringify({ accepted: true, status: 'pending' }), { status: 202 });
  });
  const transport = new HttpRpcTransport(remote, { fetch: fetcher as typeof fetch }); transports.push(transport);
  await new Promise(resolve => transport.addEventListener('open', resolve, { once: true }));
  await transport.send(JSON.stringify({ id: 2, method: 'turn/start', params: { threadId: 'thread', input: [{ type: 'text', text: 'content' }] } }));
  expect(posts).toHaveLength(1); expect(queries).toBe(1); expect(await gatewayOutbox.list()).toHaveLength(0);
});
it('附件 ACK 丢失后重建上传调用只查原 UUID，bytes 和目标已耐久；Sidechat 不写 outbox', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); const bytes = new TextEncoder().encode('data').buffer;
  const file = { name: 'file.txt', type: 'text/plain', size: 4, arrayBuffer: async () => bytes } as File;
  const calls: string[] = [];
  const fetcher = async (url: any) => { calls.push(new URL(String(url)).pathname); if (calls.length === 1) throw new Error('lost ACK'); return new Response(JSON.stringify({ path: '/target/file.txt', name: 'file.txt', type: 'text/plain', size: 4 }), { status: 201 }); };
  await expect(uploadFile(remote, file, fetcher as typeof fetch, { sourceId: 'draft-file' })).rejects.toThrow('lost ACK');
  expect((await gatewayOutbox.list())[0]).toMatchObject({ state: 'submitted', route: { remoteTarget: target.reference }, bytes });
  expect(await uploadFile(remote, file, fetcher as typeof fetch, { sourceId: 'draft-file' })).toMatchObject({ path: '/target/file.txt' });
  expect(calls).toEqual(['/api/uploads/file', '/api/uploads/operations']);
  const old = await gatewayOutbox.list();
  await uploadFile(remote, file, (async () => new Response(JSON.stringify({ path: '/target/sidechat', name: file.name, type: file.type, size: 4 }), { status: 201 })) as typeof fetch, { memoryOnly: true });
  expect(await gatewayOutbox.list()).toEqual(old);
});

it('手机离线普通操作直接失败，重建和恢复网络不会生成待提交请求', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const calls: { path: string; body?: any }[] = [];
  const fetcher = async (url: any, init?: RequestInit) => {
    const path = new URL(String(url)).pathname; const body = init?.body && JSON.parse(String(init.body)); calls.push({ path, body });
    if (path === '/api/events') return new Response(JSON.stringify({ epoch: 'epoch', cursor: 0, messages: [], requests: [], active: false, updatedAt: Date.now(), reset: false }));
    if (path === '/api/operations') return new Response(JSON.stringify({ status: 'completed', message: { result: { ok: true } } }));
    return new Response(JSON.stringify({ result: {} }));
  };
  const sessionId = 'cd881129-8e36-4d94-8181-2573dcd989ae';
  const open = async () => { const transport = new HttpRpcTransport(remote, { sessionId, fetch: fetcher as typeof fetch }); transports.push(transport); await new Promise(resolve => transport.addEventListener('open', resolve, { once: true })); return transport; };
  const first = await open();
  await expect(first.send(JSON.stringify({ id: 11, method: 'turn/start', params: { threadId: 'thread', input: [{ type: 'text', text: 'offline body' }] } }))).rejects.toThrow('设备尚未连接');
  expect(calls).toHaveLength(0); expect(await gatewayOutbox.list()).toHaveLength(0);
  first.close(); online.mockReturnValue(true);
  const second = await open(); await second.send(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'test', version: '1' } } })); await second.send(JSON.stringify({ method: 'initialized' }));
  const until = Date.now() + 3000;
  do { if (!(await gatewayOutbox.list()).length) break; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < until);
  const posts = calls.filter(call => call.body?.message?.method === 'turn/start'); expect(posts).toHaveLength(0);
  expect(await gatewayOutbox.list()).toHaveLength(0);
});

it('标题总结丢 ACK 后复用原 UUID 查询，目录损坏仍保留远程模式及管理入口', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); const calls: string[] = [];
  const fetcher = async (url: any) => { calls.push(new URL(String(url)).pathname); if (calls.length === 1) throw new Error('lost title ACK'); return new Response(JSON.stringify({ title: '确定标题' })); };
  await expect(summarizeThreadTitle(remote, 'thread', {}, fetcher as typeof fetch)).rejects.toThrow('lost title ACK');
  const [saved] = await gatewayOutbox.list(); expect(saved).toMatchObject({ kind: 'title', state: 'submitted', route: { remoteTarget: target.reference } });
  expect(await summarizeThreadTitle(remote, 'thread', {}, fetcher as typeof fetch)).toBe('确定标题'); expect(calls).toHaveLength(2);
  localStorage.setItem('codex-mobile.backend-registry.v1', JSON.stringify({ version: 1, selectedBackendId: local.id, backends: [{ ...remote, remoteTargets: [{}] }] }));
  const registry = loadBackendRegistry(localStorage, 'https://gateway.test');
  expect(registry.backends[0].gatewayMode).toBe('remote'); expect(gatewayBackends(registry.backends)[0].id).toBe(local.id);
  expect(() => gatewayUrl(gatewayBackends(registry.backends)[0], '/api/rpc')).toThrow();
});

it('另一台手机可读取待创建占位和确认后一次绑定，不伪造真实 threadId', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  let complete = false;
  const fetcher = async (url: any) => new Response(JSON.stringify({ items: new URL(String(url)).pathname === '/api/queue' ? [{ id: 'id', revision: 1,
    method: 'thread/start', state: complete ? 'succeeded' : 'queued', threadId: complete ? 'real-thread' : 'pending:id', ...(complete ? { pendingId: 'pending:id' } : { params: { cwd: '/target/project' } }) }] : [] }));
  expect((await followUpRequest(remote, undefined, fetcher as typeof fetch)).creations).toEqual([{ id: 'id', revision: 1, state: 'queued', threadId: 'pending:id', pendingId: undefined, cwd: '/target/project' }]);
  complete = true;
  expect((await followUpRequest(remote, undefined, fetcher as typeof fetch)).creations?.[0]).toMatchObject({ threadId: 'real-thread', pendingId: 'pending:id', state: 'succeeded' });
});

it('待创建会话仅 queued 可取消，结果未知时不显示真实会话操作', () => {
  const onCancel = vi.fn();
  const props = { open: true, thread: { id: 'pending:id', gatewayPendingCreation: true, gatewayOperationState: 'queued' }, pendingAction: '',
    onClose() {}, onPin() {}, onRefresh() {}, onDuplicate() {}, onCopy() {}, onRename() {}, onArchive: onCancel };
  const view = render(<ConversationActionMenu {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '取消创建' })); expect(onCancel).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: '归档' })).toBeNull();
  view.rerender(<ConversationActionMenu {...props} thread={{ ...props.thread, gatewayOperationState: 'uncertain' }} />);
  expect(screen.queryByRole('button', { name: '取消创建' })).toBeNull();
  expect(screen.queryByRole('button', { name: '重命名' })).toBeNull();
});

it('历史托管追问丢 ACK 的待确认项仍只查原接收收据，包括已发送的终态', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); const calls: { method?: string; id: string | null }[] = [];
  const action = { action: 'enqueue' as const, id: 'c756518e-e2b8-4ffc-aea7-cc326b4c7a90', threadId: 'thread', inputText: 'body', text: 'body', attachmentCount: 0, extraInput: [], settings: { model: 'frozen-model' } };
  const fetcher = async (input: any, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push({ method: init?.method, id: url.searchParams.get('requestId') });
    if (init?.method === 'POST') throw new Error('lost follow-up ACK');
    return new Response(JSON.stringify(url.searchParams.has('requestId') ? { accepted: true, operation: { id: action.id, state: 'succeeded' } } : { items: [] }));
  };
  await expect(followUpRequest(remote, action, fetcher as typeof fetch)).rejects.toThrow('lost follow-up ACK');
  expect(await gatewayOutbox.list()).toHaveLength(0);
  // 升级前已提交的旧项继续只对账；新入队复用本地模式的直接HTTP路径。
  await gatewayOutbox.put({ id: action.id, kind: 'follow-up', state: 'submitted', message: action, route: remote });
  expect((await followUpRequest(remote, undefined, fetcher as typeof fetch)).items).toEqual([]);
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1); expect(calls[1].id).toBe(action.id);
  expect(await gatewayOutbox.list()).toHaveLength(0);
});
it('Remote 事件暂时 503 保持手机提交连接并标记过期，不因上游不可读丢掉 outbox', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const fetcher = async (url: any) => new URL(String(url)).pathname === '/api/events' ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ result: {} }));
  const transport = new HttpRpcTransport(remote, { fetch: fetcher as typeof fetch }); transports.push(transport);
  await new Promise(resolve => transport.addEventListener('open', resolve, { once: true }));
  let stale = false; transport.addEventListener('sync', event => { stale = (event as CustomEvent).detail.stale; });
  await transport.send(JSON.stringify({ id: 1, method: 'initialize', params: {} })); await transport.send(JSON.stringify({ method: 'initialized' }));
  const until = Date.now() + 1000;
  while (!stale && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
  expect(transport.readyState).toBe(1); expect(stale).toBe(true);
});

it('历史未提交普通RPC保留原记录，在线恢复只读不自动POST', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const id = 'cd881129-8e36-4d94-8181-2573dcd989a0'; const sessionId = 'cd881129-8e36-4d94-8181-2573dcd989a1';
  const message = { id: 11, method: 'turn/start', params: { threadId: 'thread', input: [{ type: 'text', text: 'old retained body' }] } };
  await gatewayOutbox.put({ id, kind: 'rpc', route: remote, state: 'retained', sessionId, message, signature: JSON.stringify({ method: message.method, params: message.params }) });
  const posts: string[] = [];
  const transport = new HttpRpcTransport(remote, { sessionId, fetch: (async (input, options) => {
    const url = new URL(String(input)); if (options?.method === 'POST') posts.push(JSON.parse(String(options.body)).message?.method);
    if (url.pathname === '/api/events') return new Response(JSON.stringify({ epoch: 'epoch', cursor: 0, messages: [], requests: [], active: false, updatedAt: Date.now(), reset: false }));
    return new Response(JSON.stringify({ result: {} }));
  }) as typeof fetch }); transports.push(transport);
  await new Promise(resolve => transport.addEventListener('open', resolve, { once: true }));
  await transport.send(JSON.stringify({ id: 1, method: 'initialize', params: {} })); await transport.send(JSON.stringify({ method: 'initialized' }));
  window.dispatchEvent(new Event('online'));
  await expect(transport.send(JSON.stringify(message))).rejects.toThrow('旧版待提交操作已暂停');
  expect(posts).not.toContain('turn/start'); expect(await gatewayOutbox.get(id)).toMatchObject({ state: 'retained', message });
});
