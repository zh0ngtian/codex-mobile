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
