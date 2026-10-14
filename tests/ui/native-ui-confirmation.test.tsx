import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { NativeRuntime } from '../../src/native-ui/runtime';
import { useNativeConfirmation } from '../../src/native-ui/confirmation';
afterEach(cleanup);
it('原生确认等待显式答案并捕获其身份，旧答案不能批准下一次确认', async () => {
 const runtime = new NativeRuntime(() => {}); const { result } = renderHook(() => useNativeConfirmation(runtime, 'archive:b'));
 let answer!: Promise<boolean>; act(() => { answer = result.current('删除排队消息？'); });
 const panel = runtime.snapshot().panel!; const command = panel.items[0].command!; expect(panel.id).toContain('archive:b');
 await act(async () => { expect((await runtime.dispatch({ id: 'yes', name: command.name, params: command.params })).ok).toBe(true); }); expect(await answer).toBe(true);
 act(() => { answer = result.current('新的确认'); });
 await act(async () => { expect((await runtime.dispatch({ id: 'stale', name: command.name, params: command.params })).ok).toBe(false); });
 const close = runtime.snapshot().panel!.id;
 await act(async () => { await runtime.dispatch({ id: 'no', name: 'panel.close', params: { id: close } }); }); expect(await answer).toBe(false); runtime.dispose();
});
