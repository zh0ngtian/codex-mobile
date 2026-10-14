import { act, render, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { NativeRuntime } from '../../src/native-ui/runtime';
import { BackendManagerSheet } from '../../src/features/backends/BackendManagerSheet';
import { createDefaultBackendRegistry } from '../../src/backends/registry';
afterEach(cleanup);
it('原生设备面板共用表单与probe，普通列表不泄露口令，编辑并校验hostId后保存', async () => {
 const runtime = new NativeRuntime(() => {}); const changes: any[] = []; const probed: any[] = [];
 render(<BackendManagerSheet nativeRuntime={runtime} open registry={{ version: 1, backends: [], selectedBackendId: '' }} summaries={{}} onClose={() => {}} onChange={v => changes.push(v)} probe={async b => { probed.push(b); return { hostId: 'HOST', displayName: '机器' } as any; }} />);
 await waitFor(() => expect(runtime.snapshot().panel?.id).toBe('devices'));
 const send = async (name: string, params = {}) => { await act(async () => { const r = await runtime.dispatch({ id: crypto.randomUUID(), name, params }); expect(r.ok, r.error).toBe(true); }); };
 await send('device.change', { field: 'name', value: '测试机器' }); await send('device.change', { field: 'gatewayUrl', value: 'http://localhost:18766/?token=SECRET' });
 await send('device.save'); expect(probed[0].token).toBe('SECRET'); expect(changes[0].backends[0].hostId).toBe('HOST');
 expect(JSON.stringify(runtime.snapshot().panel)).not.toContain('SECRET'); runtime.dispose();
});
it('暂停与删除繁忙队列需原生显式确认，更新仅在现有能力允许时显示', async () => {
 const runtime = new NativeRuntime(() => {}); const changes: any[] = [];
 const b = { id: 'b', name: 'Mac', baseUrl: 'http://localhost', token: 'SECRET', enabled: true, order: 0 };
 render(<BackendManagerSheet nativeRuntime={runtime} open registry={{ version: 1, backends: [b, { ...b, id: 'other', hostId: 'OTHER', baseUrl: 'http://other', order: 1 }], selectedBackendId: 'b' }} summaries={{ b: { backendId: 'b', connection: 'online', busy: true, approvalCount: 1, queuedCount: 2, error: '' } }} onClose={() => {}} onChange={v => changes.push(v)} appUpdate={{ supported: true, manualCheckSupported: false, currentVersion: '1', checking: false, onCheck() {} }} />);
 expect(JSON.stringify(runtime.snapshot())).not.toContain('SECRET');
 await act(async () => { await runtime.dispatch({ id: 'toggle', name: 'device.toggle', params: { id: 'b' } }); });
 expect(changes).toHaveLength(0); expect(JSON.stringify(runtime.snapshot().panel)).toContain('确认');
 await act(async () => { await runtime.dispatch({ id: 'confirm', name: 'device.toggle', params: { id: 'b', confirmed: true } }); });
 expect(changes[0].backends[0].enabled).toBe(false);
 expect(JSON.stringify(runtime.snapshot().panel)).not.toContain('settings.update.check'); runtime.dispose();
});
it('原生设置子页只展示指定功能且不复制业务状态', () => {
 const runtime = new NativeRuntime(() => {});
 render(<BackendManagerSheet nativeRuntime={runtime} nativePage="language" open registry={{ version: 1, backends: [], selectedBackendId: '' }} summaries={{}} onClose={() => {}} onChange={() => {}} />);
 expect(runtime.snapshot().panel?.id).toBe('settings:language');
 expect(runtime.snapshot().panel?.items.map(i => i.id)).toEqual(['language']); runtime.dispose();
});
it('全局字号操作立即投影新的fontScale', async () => {
 const runtime = new NativeRuntime(() => {});
 render(<BackendManagerSheet nativeRuntime={runtime} nativePage="font" open registry={{ version: 1, backends: [], selectedBackendId: '' }} summaries={{}} onClose={() => {}} onChange={() => {}} />);
 await act(async () => { await runtime.dispatch({ id: 'font', name: 'settings.font', params: { value: 'large' } }); });
 expect(runtime.snapshot().fontScale).toBe(1.125); runtime.dispose();
});
it('原生表单连续命令同步保留全部字段并同步占用probe，避免不同UUID重复保存', async () => {
 const runtime = new NativeRuntime(() => {}); const probes: any[] = []; let finish!: (v: any) => void;
 render(<BackendManagerSheet nativeRuntime={runtime} open registry={{ version: 1, backends: [], selectedBackendId: '' }} summaries={{}} onClose={() => {}} onChange={() => {}} probe={b => { probes.push(b); return new Promise(r => { finish = r; }); }} />);
 await act(async () => {
  const name = runtime.dispatch({ id: 'name-fast', name: 'device.change', params: { field: 'name', value: '同步名称' } });
  const url = runtime.dispatch({ id: 'url-fast', name: 'device.change', params: { field: 'gatewayUrl', value: 'http://localhost/?token=SYNC' } });
  const first = runtime.dispatch({ id: 'save-fast1', name: 'device.save', params: {} });
  const second = runtime.dispatch({ id: 'save-fast2', name: 'device.save', params: {} });
  await name; await url; expect(probes).toHaveLength(1); expect(probes[0].name).toBe('同步名称'); expect(probes[0].token).toBe('SYNC');
  finish({ hostId: 'HOST', displayName: 'Mac' }); await first; await second;
 }); runtime.dispose();
});
it('设备子页保存探测失败保留真实错误且不更新注册表', async () => {
 const runtime = new NativeRuntime(() => {}); const saved: unknown[] = [];
 render(<BackendManagerSheet nativeRuntime={runtime} nativePage="devices" open registry={{ version: 1, backends: [], selectedBackendId: '' }} summaries={{}} onClose={() => {}} onChange={registry => saved.push(registry)} probe={async () => { throw new Error('设备身份探测失败'); }} />);
 await act(async () => { await runtime.dispatch({ id: 'probe-url', name: 'device.change', params: { field: 'gatewayUrl', value: 'http://localhost/?token=SECRET' } }); });
 await act(async () => { await runtime.dispatch({ id: 'probe-save', name: 'device.save', params: {} }); });
 expect(runtime.snapshot().panel?.items.find(item => item.id === 'devices-error')?.text).toBe('设备身份探测失败');
 expect(saved).toHaveLength(0); expect(runtime.snapshot().panel?.items.find(item => item.id === 'save')?.disabled).toBe(false); runtime.dispose();
});
it('设备字段每次ACK都携带已提交的同版本面板文字，连续快输不会被旧值夺回', async () => {
 const runtime = new NativeRuntime(() => {});
 render(<BackendManagerSheet nativeRuntime={runtime} open registry={{ version: 1, backends: [], selectedBackendId: '' }} summaries={{}} onClose={() => {}} onChange={() => {}} />);
 const observed: Array<{ ack: number | undefined; value: string | undefined }> = [];
 await act(async () => {
  const text = 'CM_NATIVE_UI_QA';
  for (let revision = 1; revision <= text.length; revision++) {
   const result = await runtime.dispatch({ id: `atomic-name-${revision}`, name: 'device.change', params: {
    field: 'name', value: text.slice(0, revision), fieldKey: 'devices:name', fieldRevision: revision,
   } });
   expect(result.ok, result.error).toBe(true);
   // 必须在act替测试冲刷React之前观察：Swift接到ACK便会释放本地字段保护。
   const snapshot = runtime.snapshot();
   observed.push({ ack: snapshot.commandResults?.at(-1)?.fieldRevision, value: snapshot.panel?.items.find(item => item.id === 'name')?.value });
  }
 });
 expect(observed).toEqual(Array.from('CM_NATIVE_UI_QA', (_, index) => ({ ack: index + 1, value: 'CM_NATIVE_UI_QA'.slice(0, index + 1) })));
 runtime.dispose();
});
