import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeRuntime, isNativeUIEnabled } from '../../src/native-ui/runtime';
import { emptyNativeSnapshot } from '../../src/native-ui/protocol';

afterEach(() => { vi.useRealTimers(); delete (window as any).__CODEX_NATIVE_UI__; delete (window as any).webkit; });
const command = (id: string, name: string, params: Record<string, unknown> = {}) => ({ id, name, params });
const workspace = (contextId = 'b:t') => ({ ...emptyNativeSnapshot(), backendId: 'b', contextId, threadId: 't', ready: true });
it('列表设备独立于当前对话投影，新建设备可单独指定，明确项目仍校验参数且ACK不伪造新上下文', async () => {
 const runtime = new NativeRuntime(() => {}); const calls: unknown[] = [];
 runtime.setNavigation({ selectedBackendId: 'b', listBackendId: 'all', backends: [], groups: [] }, { 'thread.new': p => calls.push(p) });
 runtime.setWorkspace('b', workspace(), {});
 expect(runtime.snapshot()).toMatchObject({ backendId: 'b', listBackendId: 'all', contextId: 'b:t' });
 expect((await runtime.dispatch(command('project', 'thread.new', { backendId: 'other', cwd: '' }))).ok).toBe(true);
 expect((await runtime.dispatch(command('device-memory', 'thread.new', { backendId: 'other' }))).ok).toBe(true);
 expect(runtime.snapshot().contextId).toBe('b:t');
 for (const params of [{ cwd: '/p' }, { backendId: 'other', cwd: null }, { backendId: 3, cwd: '/p' }, { backendId: 3 }]) {
  expect((await runtime.dispatch(command(`bad-${JSON.stringify(params)}`, 'thread.new', params))).ok).toBe(false);
 }
 expect((await runtime.dispatch(command('legacy-new', 'thread.new'))).ok).toBe(true);
 expect(calls).toEqual([{ backendId: 'other', cwd: '' }, { backendId: 'other' }, {}]); runtime.dispose();
});
describe('原生业务桥', () => {
  it('只有新 flag 与 handler 同时存在才启用，旧残留不启用', () => {
    Object.assign(window, { __CODEX_NATIVE_UI__: true, webkit: { messageHandlers: { nativeConversation: {} } } });
    expect(isNativeUIEnabled()).toBe(false);
    (window as any).webkit.messageHandlers.nativeUI = { postMessage() {} };
    expect(isNativeUIEnabled()).toBe(true);
  });
  it('显式白名单、参数及当前上下文校验，拒绝迟到命令', async () => {
    const changes: string[] = [];
    const runtime = new NativeRuntime(() => {});
    runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
    runtime.setWorkspace('b', workspace(), { 'draft.set': p => { changes.push(p.value as string); } });
    expect((await runtime.dispatch(command('1', 'unknown'))).ok).toBe(false);
    expect((await runtime.dispatch(command('2', 'draft.set', { contextId: 'b:old', value: '旧', revision: 1 }))).ok).toBe(false);
    expect((await runtime.dispatch(command('3', 'draft.set', { contextId: 'b:t', value: 1, revision: 1 }))).ok).toBe(false);
    expect((await runtime.dispatch(command('4', 'draft.set', { contextId: 'b:t', value: '新', revision: 2 }))).ok).toBe(true);
    expect(changes).toEqual(['新']);
    expect(runtime.snapshot().draftRevision).toBe(2);
    runtime.dispose();
  });
  it('按 id 去重且慢发送不阻塞停止，错误回执关联原命令', async () => {
    let release!: () => void; let sent = 0; let stopped = 0;
    const runtime = new NativeRuntime(() => {});
    runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
    runtime.setWorkspace('b', workspace(), {
      'message.send': async () => { sent++; await new Promise<void>(r => { release = r; }); throw new Error('网络失败'); },
      'turn.stop': () => { stopped++; },
    });
    const sending = runtime.dispatch(command('send', 'message.send', { contextId: 'b:t' }));
    const duplicate = runtime.dispatch(command('send', 'message.send', { contextId: 'b:t' }));
    expect((await runtime.dispatch(command('stop', 'turn.stop', { contextId: 'b:t' }))).ok).toBe(true);
    expect(stopped).toBe(1); expect(sent).toBe(1);
    release();
    expect(await sending).toEqual(await duplicate);
    expect(runtime.snapshot().commandResults?.at(-1)).toMatchObject({ id: 'send', ok: false, error: '网络失败' });
    expect(runtime.snapshot().error).toBe('网络失败');
    runtime.dispose();
  });
  it('只读workspace仍拒绝写入和会话写动作，非法列表管理参数不进入业务回调', async () => {
    const runtime = new NativeRuntime(() => {});
    const manage = vi.fn(); const write = vi.fn();
    runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] }, { 'thread.manage': manage });
    runtime.setWorkspace('b', { ...workspace(), readOnly: true }, { 'draft.set': write, 'workspace.thread': write, 'permission.select': write });
    for (const [name, params] of [
      ['draft.set', { value: '不能覆盖', revision: 1 }],
      ['workspace.thread', { action: 'duplicate' }],
      ['permission.select', { value: 'full-access' }],
    ] as const) {
      expect(await runtime.dispatch(command(`readonly-${name}`, name, { contextId: 'b:t', ...params }))).toMatchObject({ ok: false, error: '当前会话只读' });
    }
    expect((await runtime.dispatch(command('invalid-manage', 'thread.manage', { backendId: 'b', threadId: 't', action: 'unknown' }))).ok).toBe(false);
    expect(write).not.toHaveBeenCalled(); expect(manage).not.toHaveBeenCalled();
    runtime.dispose();
  });
  it('只合并当前设备，节流流式输出并在更新后取最新 adapter', async () => {
    vi.useFakeTimers(); const posts: any[] = []; const values: string[] = [];
    const runtime = new NativeRuntime(s => posts.push(s));
    runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [{ id: 'g', title: '真实导航', items: [] }] });
    runtime.setWorkspace('b', { ...workspace(), draft: '初始' }, { 'draft.set': () => { values.push('old'); } });
    runtime.setWorkspace('c', { ...workspace('c:t'), backendId: 'c', draft: '其他设备' }, {});
    runtime.setWorkspace('b', { ...workspace(), draft: '最新' }, { 'draft.set': () => { values.push('latest'); } });
    await vi.advanceTimersByTimeAsync(50);
    expect(posts).toHaveLength(1); expect(posts[0].draft).toBe('最新'); expect(posts[0].groups[0].title).toBe('真实导航');
    await runtime.dispatch(command('draft', 'draft.set', { contextId: 'b:t', value: '新', revision: 1 }));
    expect(values).toEqual(['latest']);
    runtime.dispose(); await vi.runAllTimersAsync();
    expect(runtime.listenerCount).toBe(0);
  });
  it('拒绝乱序 revision 且上下文切换后旧命令不能写新草稿', async () => {
    const runtime = new NativeRuntime(() => {}); const values: string[] = [];
    runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
    const handlers = { 'draft.set': (p: Record<string, unknown>) => { values.push(p.value as string); } };
    runtime.setWorkspace('b', workspace(), handlers);
    await runtime.dispatch(command('2', 'draft.set', { contextId: 'b:t', value: 'AB', revision: 2 }));
    await runtime.dispatch(command('1', 'draft.set', { contextId: 'b:t', value: 'A', revision: 1 }));
    runtime.setWorkspace('b', workspace('b:new'), handlers);
    await runtime.dispatch(command('3', 'draft.set', { contextId: 'b:t', value: 'ABC', revision: 3 }));
    expect(values).toEqual(['AB']); expect(runtime.snapshot().draftRevision).toBe(0);
    runtime.dispose();
  });
});

it('同一批draft.set后发送清空不保留旧echo，迟到旧会话错误不污染新会话', async () => {
  const runtime = new NativeRuntime(() => {}); let release!: () => void;
  runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
  runtime.setWorkspace('b', workspace(), { 'draft.set': () => {}, 'message.send': async () => { await new Promise<void>(r => { release = r; }); throw new Error('旧请求失败'); } });
  await runtime.dispatch(command('d', 'draft.set', { contextId: 'b:t', value: '待发送', revision: 1 }));
  const pending = runtime.dispatch(command('s', 'message.send', { contextId: 'b:t' }));
  runtime.setWorkspace('b', { ...workspace(), draft: '' }, {});
  expect(runtime.snapshot().draft).toBe('');
  runtime.setWorkspace('b', { ...workspace('b:new'), draft: '新会话输入' }, {});
  release(); await pending;
  expect(runtime.snapshot().error).toBeUndefined(); expect(runtime.snapshot().draft).toBe('新会话输入');
  runtime.dispose();
});

it('handler同步重注册workspace不丢revision，并发旧草稿完成不能倒退新版本', async () => {
 const runtime = new NativeRuntime(() => {}); const completions = new Map<number, () => void>();
 runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 const handlers = { 'draft.set': (params: Record<string, unknown>) => {
  runtime.setWorkspace('b', { ...workspace(), draft: String(params.value) }, handlers);
  return new Promise<void>(resolve => { completions.set(Number(params.revision), resolve); });
 } };
 runtime.setWorkspace('b', workspace(), handlers);
 const first = runtime.dispatch(command('r1', 'draft.set', { contextId: 'b:t', value: 'A', revision: 1 }));
 const second = runtime.dispatch(command('r2', 'draft.set', { contextId: 'b:t', value: 'AB', revision: 2 }));
 completions.get(2)!(); await second;
 completions.get(1)!(); await first;
 expect(runtime.snapshot()).toMatchObject({ draft: 'AB', draftRevision: 2 });
 runtime.dispose();
});

it('只接受追上revision的权威草稿，程序插入与发送恢复不会被旧echo永久遮盖', async () => {
 const runtime = new NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 const handlers = { 'draft.set': () => {} };
 runtime.setWorkspace('b', { ...workspace(), draftRevision: 0 }, handlers);
 await runtime.dispatch(command('r1', 'draft.set', { contextId: 'b:t', value: 'A', revision: 1 }));
 await runtime.dispatch(command('r2', 'draft.set', { contextId: 'b:t', value: 'AB', revision: 2 }));
 runtime.setWorkspace('b', { ...workspace(), draft: 'A', draftRevision: 1 }, handlers);
 expect(runtime.snapshot().draft).toBe('AB');
 runtime.setWorkspace('b', { ...workspace(), draft: 'AB 当前位置', draftRevision: 2 }, handlers);
 expect(runtime.snapshot().draft).toBe('AB 当前位置');
 runtime.dispose();
});

it('当前workspace切换会话时导航选择来自真实threadId，其他设备不能覆盖', () => {
 const runtime = new NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [{ id: 'list', title: '会话', items: [
  { id: 'b:t', title: '当前', command: { name: 'thread.open', params: { backendId: 'b', threadId: 't' } } },
  { id: 'c:t', title: '另一设备', command: { name: 'thread.open', params: { backendId: 'c', threadId: 't' } } },
 ] }] });
 runtime.setWorkspace('b', workspace(), {});
 expect(runtime.snapshot().groups[0].items.map(item => item.selected)).toEqual([true, false]);
 runtime.dispose();
});

it('同文光标移动也受revision保护，旧render不能回写旧UTF16光标', async () => {
 const runtime = new NativeRuntime(() => {}); const handlers = { 'draft.set': () => {} };
 runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 runtime.setWorkspace('b', { ...workspace(), draft: '前 @sw 后', draftRevision: 1, caretOffset: 7 }, handlers);
 await runtime.dispatch(command('caret', 'draft.set', { contextId: 'b:t', value: '前 @sw 后', revision: 2, caretOffset: 5 }));
 runtime.setWorkspace('b', { ...workspace(), draft: '前 @sw 后', draftRevision: 1, caretOffset: 7 }, handlers);
 expect(runtime.snapshot().caretOffset).toBe(5);
 runtime.dispose();
});

it('去重和回执均有界，近期重复请求不重新执行', async () => {
 const runtime = new NativeRuntime(() => {}); let executions = 0;
 runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 runtime.setWorkspace('b', workspace(), { 'turn.stop': () => { executions++; } });
 for (let index = 0; index < 300; index++) await runtime.dispatch(command(String(index), 'turn.stop', { contextId: 'b:t' }));
 await runtime.dispatch(command('299', 'turn.stop', { contextId: 'b:t' })); expect(executions).toBe(300);
 expect(runtime.snapshot().commandResults).toHaveLength(64);
 await runtime.dispatch(command('0', 'turn.stop', { contextId: 'b:t' })); expect(executions).toBe(301);
 runtime.dispose();
});

it('全局面板独立于会话面板路由并支持无设备的ready引导', async () => {
 const events: string[] = []; const runtime = new NativeRuntime(() => {});
 runtime.setGlobalPanel('devices', { id: 'devices', title: '设备', items: [] }, { 'device.add': () => events.push('add') });
 expect(runtime.snapshot().ready).toBe(true); expect(runtime.snapshot().panel?.id).toBe('devices');
 expect((await runtime.dispatch({ id: 'add', name: 'device.add', params: {} })).ok).toBe(true);
 expect(events).toEqual(['add']); runtime.removeGlobalPanel('devices');
 expect(runtime.snapshot().panel).toBeUndefined(); runtime.dispose();
});
it('全局面板按实际打开顺序展示，后台组件render不会抢走当前面板', () => {
 const runtime = new NativeRuntime(() => {});
 runtime.setGlobalPanel('devices', undefined, {}); runtime.setGlobalPanel('drafts', { id: 'drafts', title: '', items: [] }, {});
 runtime.setGlobalPanel('devices', { id: 'devices', title: '', items: [] }, {}); expect(runtime.snapshot().panel?.id).toBe('devices');
 runtime.setGlobalPanel('drafts', { id: 'drafts', title: '更新标题', items: [] }, {}); expect(runtime.snapshot().panel?.id).toBe('devices'); runtime.dispose();
});


it('导航加载字段独立于详情加载透传，缺失字段不污染ready夹具', () => {
 const runtime = new NativeRuntime(() => {});
 runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [], navigationLoading: true });
 runtime.setWorkspace('b', { ...workspace(), loading: 'ready' }, {});
 expect(runtime.snapshot()).toMatchObject({ navigationLoading: true, loading: 'ready' });
 runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [], navigationLoading: false });
 runtime.setWorkspace('b', { ...workspace(), loading: 'loading' }, {});
 expect(runtime.snapshot()).toMatchObject({ navigationLoading: false, loading: 'loading' });
 runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
 expect(runtime.snapshot().navigationLoading).toBeUndefined();
 expect({ ...emptyNativeSnapshot(), ready: true }.navigationLoading).toBeUndefined();
 runtime.dispose();
});

it('主聊天只读时可创建独立Sidechat，仍拒绝向主聊天发送', async () => {
 const runtime = new NativeRuntime(() => {}); const create = vi.fn(); const send = vi.fn();
 runtime.setNavigation({selectedBackendId:'b',backends:[],groups:[]});
 runtime.setWorkspace('b',{...workspace(),readOnly:true},{'sidechat.create':create,'message.send':send});
 expect((await runtime.dispatch(command('side-readonly','sidechat.create',{contextId:'b:t'}))).ok).toBe(true);
 expect((await runtime.dispatch(command('main-readonly','message.send',{contextId:'b:t'}))).ok).toBe(false);
 expect(create).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled();runtime.dispose();
});
