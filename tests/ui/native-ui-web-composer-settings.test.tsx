import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ComposerSettings, type ComposerSettingsProps } from '../../src/features/settings/ComposerSettings';
import { WebInterfaceProvider, WEB_INTERFACE_KEY } from '../../src/features/web-ui/preference';
const props: ComposerSettingsProps = {
 picker: 'agent', effortOptions: [{ id: 'high', label: '高' }], speedOptions: [{ id: null, label: '普通', description: '正常速度' }, { id: 'priority', label: 'Fast', description: '更快' }],
 permissionModes: [], models: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, model: `m${i}`, displayName: `模型${i}` } as any)), selectedEffort: 'high', selectedModel: 'm0', selectedModelLabel: '模型0', selectedServiceTier: 'priority', selectedSpeedLabel: 'Fast', selectedPermissionModeId: null,
 onPickerChange() {}, onChooseEffort() {}, onChooseModel() {}, onChooseSpeed() {}, onChoosePermissionMode() {},
};
afterEach(() => { cleanup(); localStorage.removeItem(WEB_INTERFACE_KEY); for (const key of ['__CODEX_NATIVE_UI__', '__CODEX_NATIVE_COMPOSER__', 'webkit']) delete (window as any)[key]; });
it.each([false, true])('混合模式网页菜单保留完整模型与语义选中，移除视觉勾选并区分Fast图标（modern=%s）', modern => {
 Object.assign(window, { __CODEX_NATIVE_UI__: false, __CODEX_NATIVE_COMPOSER__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } } });
 localStorage.setItem(WEB_INTERFACE_KEY, modern ? 'modern' : 'legacy');
 const choose = vi.fn(); const restore = vi.fn();
 const page = (picker: ComposerSettingsProps['picker']) => <WebInterfaceProvider><ComposerSettings {...props} picker={picker} onChooseSpeed={choose} onRestoreComposerFocus={restore} /></WebInterfaceProvider>;
 const view = render(page('model'));
 expect(screen.getByText('模型19')).toBeVisible(); expect(view.container.textContent).not.toContain('✓');
 expect(view.container.querySelector('[aria-pressed="true"]')).not.toBeNull();
 view.rerender(page('agent')); expect(view.container.textContent).not.toContain('✓');
 view.rerender(page('speed')); expect(view.container.textContent).not.toContain('✓');
 expect(view.container.querySelector('[data-icon="speed"]')).not.toBeNull();
 expect(view.container.querySelector('[data-icon="speed-off"]')).not.toBeNull();
 fireEvent.click(screen.getByRole('button', { name: /Fast.*更快/ })); expect(choose).toHaveBeenCalledWith('priority'); expect(restore).toHaveBeenCalledOnce();
});

it('旧版混合权限选择恢复原生文字焦点并沿用原权限回调', () => {
 Object.assign(window, { __CODEX_NATIVE_UI__: false, __CODEX_NATIVE_COMPOSER__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } } });
 const permission = vi.fn(); const restore = vi.fn();
 render(<ComposerSettings {...props} picker="permission" permissionModes={[{ id: 'default', label: '默认权限', description: '默认', permissions: ':workspace', approvalPolicy: 'on-request', approvalsReviewer: 'user' }]} onChoosePermissionMode={permission} onRestoreComposerFocus={restore} />);
 fireEvent.click(screen.getByRole('button', { name: /默认权限/ }));
 expect(permission).toHaveBeenCalledWith('default'); expect(restore).toHaveBeenCalledOnce();
});
