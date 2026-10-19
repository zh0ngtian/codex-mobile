import { expect, it } from 'vitest';
import { resolveNativeNewChatTarget } from '../../src/native-ui/new-chat-target';
import { nativeCommand } from '../../src/native-ui/projection';
import type { NativeGroup } from '../../src/native-ui/protocol';

const backends = [{ id: 'a' }, { id: 'b' }];
const groups: NativeGroup[] = ['/p', ''].map(cwd => ({ id: `b:${cwd}`, title: cwd, items: [], newCommand: nativeCommand('thread.new', { backendId: 'b', cwd }) }));
it('项目新建目标使用已挂载设备和当前投影，空串是明确无项目且不恢复旧默认目录', () => {
 expect(resolveNativeNewChatTarget({ backendId: 'b', cwd: '/p' }, backends, groups)).toEqual({ backendId: 'b', cwd: '/p' });
 expect(resolveNativeNewChatTarget({ backendId: 'b', cwd: '' }, backends, groups)).toEqual({ backendId: 'b', cwd: '' });
 expect(resolveNativeNewChatTarget({}, backends, groups)).toBeUndefined();
 expect(resolveNativeNewChatTarget({ contextId: 'old' }, backends, groups)).toBeUndefined();
});
it('设备卸载、过期项目和无效或单边参数不能回落成无参新建', () => {
 for (const params of [{ backendId: 'b', cwd: '/removed' }, { backendId: 'removed', cwd: '/p' }, { backendId: 'b', cwd: null }, { cwd: '/p' }]) {
  expect(() => resolveNativeNewChatTarget(params, backends, groups)).toThrow();
 }
 expect(() => resolveNativeNewChatTarget({ backendId: 'b', cwd: '/p' }, [{ id: 'a' }], groups)).toThrow();
 expect(() => resolveNativeNewChatTarget({ backendId: 'b', cwd: '/p' }, backends, [])).toThrow();
});
it('仅指定设备的新建目标保留项目未指定语义，由该设备恢复上次项目', () => {
 expect(resolveNativeNewChatTarget({ backendId: 'b' }, backends, [])).toEqual({ backendId: 'b' });
 expect(() => resolveNativeNewChatTarget({ backendId: 'removed' }, backends, groups)).toThrow('设备已移除');
});
