import { act, render, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { NativeRuntime } from '../../src/native-ui/runtime';
import { BackendManagerSheet } from '../../src/features/backends/BackendManagerSheet';
import { createDefaultBackendRegistry } from '../../src/backends/registry';
afterEach(cleanup);
it('设备页标题区分列表、新增和编辑，表单仍使用同一设备作用域', async () => {
 const runtime = new NativeRuntime(() => {});
 const backend = { id: 'mac', name: '工作电脑', baseUrl: 'https://gateway.example', token: 'DEVICE_SECRET', enabled: true, order: 0 };
 render(<BackendManagerSheet nativeRuntime={runtime} nativePage="devices" open registry={{ version: 1, backends: [backend], selectedBackendId: backend.id }} summaries={{}} onClose={() => {}} onChange={() => {}} />);
 expect(runtime.snapshot().panel?.title).toBe('设备');
 await act(async () => { await runtime.dispatch({ id: 'open-edit', name: 'device.edit', params: { id: backend.id } }); });
 expect(runtime.snapshot().panel?.title).toBe('编辑设备');
 expect(runtime.snapshot().panel?.id).toBe('devices');
 expect(runtime.snapshot().panel?.items.find(item => item.id === 'gatewayUrl')?.kind).toBe('secureField');
 await act(async () => { await runtime.dispatch({ id: 'cancel-edit', name: 'device.cancel', params: {} }); });
 await act(async () => { await runtime.dispatch({ id: 'open-add', name: 'device.add', params: {} }); });
 expect(runtime.snapshot().panel?.title).toBe('添加设备');
 expect(runtime.snapshot().panel?.id).toBe('devices');
 runtime.dispose();
});
it('设备卡投影独立连接状态并保留地址、队列、审批和错误，不暴露凭证', () => {
 const runtime = new NativeRuntime(() => {});
 const backend = { id: 'online-device', name: '工作电脑', baseUrl: 'https://gateway.example', token: 'DEVICE_SECRET', enabled: true, order: 0 };
 render(<BackendManagerSheet nativeRuntime={runtime} nativePage="devices" open registry={{ version: 1, backends: [backend, { ...backend, id: 'paused-device', name: '备用电脑', enabled: false, order: 1 }], selectedBackendId: backend.id }} summaries={{
  'online-device': { backendId: 'online-device', connection: 'online', busy: true, queuedCount: 2, approvalCount: 1, error: '上一轮连接失败' },
  'paused-device': { backendId: 'paused-device', connection: 'online', busy: false, queuedCount: 0, approvalCount: 0, error: '' },
 }} onClose={() => {}} onChange={() => {}} />);
 const items = runtime.snapshot().panel!.items;
 const online = items.find(item => item.id === 'online-device')!;
 const paused = items.find(item => item.id === 'paused-device')!;
 expect(online.children?.find(item => item.id === 'online-device:connection')).toMatchObject({ kind: 'text', text: '已连接', value: 'online' });
 expect(paused.children?.find(item => item.id === 'paused-device:connection')).toMatchObject({ kind: 'text', text: '已暂停', value: 'paused' });
 expect(online.text).toContain('https://gateway.example');
 expect(online.text).toContain('2 排队中');
 expect(online.text).toContain('1 待审批');
 expect(online.children?.find(item => item.id === 'online-device:error')?.text).toBe('上一轮连接失败');
 expect(online.children?.find(item => item.id === 'online-device:up')?.disabled).toBe(true);
 expect(paused.children?.find(item => item.id === 'paused-device:down')?.disabled).toBe(true);
 expect(JSON.stringify(items)).not.toContain('DEVICE_SECRET');
 runtime.dispose();
});
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
it('通知单选、Bark安全字段和保存继续使用真实回调并保留校验及同步失败信息', async () => {
 const runtime = new NativeRuntime(() => {}); const saves: unknown[] = [];
 const preference = { mode: 'system' as const, barkUrl: '' };
 render(<BackendManagerSheet nativeRuntime={runtime} nativePage="notifications" open registry={createDefaultBackendRegistry('https://gateway.example')} summaries={{}} onClose={() => {}} onChange={() => {}} notificationPreference={preference} onNotificationPreferenceSave={value => saves.push(value)} failedNotificationDevices={['备用电脑']} />);
 const send = async (name: string, params = {}) => act(async () => {
  const result = await runtime.dispatch({ id: crypto.randomUUID(), name, params });
  expect(result.ok, result.error).toBe(true);
 });
 await send('settings.push.mode', { value: 'bark' });
 expect(runtime.snapshot().panel?.id).toBe('settings:notifications');
 expect(runtime.snapshot().panel?.items.find(item => item.id === 'push')?.value).toBe('bark');
 expect(runtime.snapshot().panel?.items.find(item => item.id === 'bark-url')?.kind).toBe('secureField');
 await send('settings.push.url', { value: 'invalid-bark-link' });
 await act(async () => { expect((await runtime.dispatch({ id: crypto.randomUUID(), name: 'settings.push.save', params: {} })).ok).toBe(false); });
 expect(saves).toHaveLength(0);
 expect(runtime.snapshot().panel?.items.find(item => item.id === 'push-status')?.text).toBeTruthy();
 await send('settings.push.url', { value: 'https://api.day.app/VALID_DEVICE_KEY' });
 await send('settings.push.save');
 expect(saves).toEqual([{ mode: 'bark', barkUrl: 'https://api.day.app/VALID_DEVICE_KEY' }]);
 expect(runtime.snapshot().panel?.items.find(item => item.id === 'push-status')?.text).toBe('推送设置已保存');
 expect(runtime.snapshot().panel?.items.find(item => item.id === 'push-failed')?.text).toContain('备用电脑');
 expect(runtime.snapshot().panel?.items.some(item => item.id === 'language' || item.id === 'name')).toBe(false);
 runtime.dispose();
});
it('全局字号操作立即投影新的fontScale', async () => {
 const runtime = new NativeRuntime(() => {});
 render(<BackendManagerSheet nativeRuntime={runtime} nativePage="font" open registry={{ version: 1, backends: [], selectedBackendId: '' }} summaries={{}} onClose={() => {}} onChange={() => {}} />);
 await act(async () => { await runtime.dispatch({ id: 'font', name: 'settings.font', params: { value: 'large' } }); });
 expect(runtime.snapshot().fontScale).toBe(1.125); runtime.dispose();
});
it('设置首页投影既有偏好和真实版本，原地选择后继续留在首页', async () => {
 const runtime = new NativeRuntime(() => {});
 render(<BackendManagerSheet nativeRuntime={runtime} nativePage="settings" open registry={{ version: 1, backends: [], selectedBackendId: '' }} summaries={{}} onClose={() => {}} onChange={() => {}} appUpdate={{ supported: true, manualCheckSupported: true, currentVersion: '0.2.321', checking: false, onCheck() {} }} />);
 expect(runtime.snapshot().panel?.id).toBe('settings:root');
 expect(runtime.snapshot().panel?.items.find(i => i.id === 'app-version')?.text).toContain('0.2.321');
 expect(runtime.snapshot().panel?.items.find(i => i.id === 'language')?.options).toHaveLength(3);
 expect(runtime.snapshot().panel?.items.find(i => i.id === 'font')?.options).toHaveLength(4);
 expect(runtime.snapshot().panel?.items.some(i => i.id === 'check-update')).toBe(true);
 expect(runtime.snapshot().panel?.items.some(i => i.id === 'add')).toBe(false);
 await act(async () => { await runtime.dispatch({ id: 'root-font', name: 'settings.font', params: { value: 'standard' } }); });
 expect(runtime.snapshot().panel?.id).toBe('settings:root');
 expect(runtime.snapshot().panel?.items.find(i => i.id === 'font')?.value).toBe('standard');
 runtime.dispose();
});
it('设备操作待确认时返回设置首页仍投影真实偏好，未确认的设备变更不执行', async () => {
 const runtime = new NativeRuntime(() => {}); const changes: unknown[] = [];
 const backend = { id: 'b', name: 'Mac', baseUrl: 'http://localhost', token: 'SECRET', enabled: true, order: 0 };
 const props = { nativeRuntime: runtime, open: true, registry: { version: 1 as const, backends: [backend, { ...backend, id: 'other', order: 1 }], selectedBackendId: 'b' }, summaries: { b: { backendId: 'b', connection: 'online' as const, busy: true, approvalCount: 0, queuedCount: 1, error: '' } }, onClose() {}, onChange: (v: unknown) => changes.push(v) };
 const { rerender } = render(<BackendManagerSheet {...props} nativePage="devices" />);
 await act(async () => { await runtime.dispatch({ id: 'pending-remove', name: 'device.remove', params: { id: 'b' } }); });
 expect(runtime.snapshot().panel?.items.some(item => item.id === 'device-confirmation')).toBe(true);
 rerender(<BackendManagerSheet {...props} nativePage="settings" />);
 expect(runtime.snapshot().panel?.id).toBe('settings:root');
 expect(runtime.snapshot().panel?.items.find(item => item.id === 'language')?.options).toHaveLength(3);
 expect(runtime.snapshot().panel?.items.find(item => item.id === 'font')?.options).toHaveLength(4);
 expect(runtime.snapshot().panel?.items.some(item => item.id === 'confirm')).toBe(false);
 await act(async () => { const result = await runtime.dispatch({ id: 'pending-root-font', name: 'settings.font', params: { value: 'standard' } }); expect(result.ok, result.error).toBe(true); });
 expect(runtime.snapshot().panel?.items.find(item => item.id === 'font')?.value).toBe('standard');
 expect(changes).toHaveLength(0);
 rerender(<BackendManagerSheet {...props} nativePage="devices" />);
 expect(runtime.snapshot().panel?.items.some(item => item.id === 'device-confirmation')).toBe(true);
 await act(async () => { await runtime.dispatch({ id: 'cancel-remove', name: 'device.cancel', params: {} }); });
 expect(runtime.snapshot().panel?.items.some(item => item.id === 'device-confirmation')).toBe(false);
 expect(changes).toHaveLength(0); runtime.dispose();
});
it.each([['notifications', '通知'], ['updates', '应用更新'], ['transport', '传输方式'], ['language', '语言'], ['font', '字体大小']])('设置子页%s使用对应标题', (page, title) => {
 const runtime = new NativeRuntime(() => {});
 render(<BackendManagerSheet nativeRuntime={runtime} nativePage={page} open registry={{ version: 1, backends: [], selectedBackendId: '' }} summaries={{}} onClose={() => {}} onChange={() => {}} />);
 expect(runtime.snapshot().panel?.title).toBe(title); runtime.dispose();
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
