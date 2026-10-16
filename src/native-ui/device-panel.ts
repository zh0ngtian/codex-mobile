import { t } from '../i18n';
import { nativeAction, nativeCommand } from './projection';
import type { NativePanelItem, NativeSnapshot } from './protocol';
/** 此投影只挑选字段；完整设备凭证只在显式编辑表单中进入secureField。 */
export function projectDevicePanel(c: any): NativeSnapshot['panel'] {
 if (!c.open) return undefined;
 // 设备确认只在设备子页呈现；离开时不执行或丢弃尚未确认的操作。
 const confirmation = !c.page || c.page === 'devices' ? c.confirmation : null;
 const field = (id: string, title: string, value: string, secure = false): NativePanelItem => ({ id, kind: secure ? 'secureField' : 'textField', title, value, disabled: c.testing, command: nativeCommand('device.change', { field: id, draftId: c.draft?.id }) });
 const choice = (id: string, title: string, value: string, options: string[][], name: string): NativePanelItem => ({ id, kind: 'singleChoice', title, value, options: options.map(([v, label]) => ({ id: v, value: v, title: t(label) })), command: nativeCommand(name), disabled: c.testing });
 const items: NativePanelItem[] = [];
 if (confirmation) {
  items.push({ id: 'device-confirmation', kind: 'text', text: confirmation.message }, nativeAction('confirm', t('确认'), confirmation.name, { id: confirmation.id, confirmed: true }), nativeAction('back', t('取消'), 'device.cancel'));
 } else if (c.draft) items.push(field('name', t('设备名称'), c.draft.name), field('gatewayUrl', t('网关地址'), c.draft.gatewayUrl, true), nativeAction('scan', t('扫描网关二维码'), 'device.scan'), { ...nativeAction('save', t(c.testing ? '正在测试…' : '测试并保存'), 'device.save'), disabled: c.testing }, { ...nativeAction('cancel', t('取消'), 'device.cancel'), disabled: c.testing });
 else {
  for (const [index, backend] of c.registry.backends.entries()) {
   const summary = c.summaries[backend.id];
   const connection = !backend.enabled ? 'paused' : summary?.connection ?? 'offline';
   const connectionLabels: Record<string, string> = { online: '已连接', connecting: '连接中', offline: '未连接', paused: '已暂停' };
   items.push({ id: backend.id, kind: 'section', title: backend.name, text: `${backend.baseUrl} · ${!backend.enabled ? t('已暂停') : summary?.connection ?? t('未连接')} · ${summary?.queuedCount ?? 0} ${t('排队中')} · ${summary?.approvalCount ?? 0} ${t('待审批')}`, children: [
    { id: `${backend.id}:connection`, kind: 'text', text: t(connectionLabels[connection] ?? '未连接'), value: connection },
    nativeAction(`${backend.id}:edit`, t('编辑'), 'device.edit', { id: backend.id }), nativeAction(`${backend.id}:toggle`, t(backend.enabled ? '暂停' : '启用'), 'device.toggle', { id: backend.id }), nativeAction(`${backend.id}:remove`, t('删除'), 'device.remove', { id: backend.id }),
    { ...nativeAction(`${backend.id}:up`, t('上移'), 'device.move', { id: backend.id, direction: -1 }), disabled: index === 0 }, { ...nativeAction(`${backend.id}:down`, t('下移'), 'device.move', { id: backend.id, direction: 1 }), disabled: index === c.registry.backends.length - 1 },
    ...(summary?.error ? [{ id: `${backend.id}:error`, kind: 'text', text: summary.error }] : []),
   ] });
  }
  items.push(nativeAction('add', t('添加设备'), 'device.add'));
 }
 if (c.error) items.push({ id: 'devices-error', kind: 'text', title: t('错误'), text: c.error });
 if (!confirmation) {
  items.push(choice('transport', t('传输方式'), c.transportMode, [['http', 'HTTP'], ['stream', '流式']], 'settings.transport'), choice('language', t('语言'), c.preference, [['system', '跟随系统'], ['zh-CN', '中文'], ['en', '英文']], 'settings.language'), choice('font', t('字体大小'), c.font.size, [['small', '小'], ['standard', '标准'], ['large', '大'], ['extra-large', '特大']], 'settings.font'));
  if (c.font.saveError) items.push({ id: 'font-error', kind: 'text', text: t('字号已应用，但无法保存；重启后可能恢复原字号') });
  if (c.hasPush) {
   const p = c.push;
   items.push(choice('push', t('推送方式'), p.mode, [['system', '系统推送'], ['bark', 'Bark 推送']], 'settings.push.mode'));
   if (p.mode === 'bark') items.push({ id: 'bark-url', kind: 'secureField', title: t('Bark 推送链接'), value: p.url, command: nativeCommand('settings.push.url') });
   items.push({ id: 'push-hint', kind: 'text', text: t(p.mode === 'system' ? '系统推送会有延迟，并且可能会漏推送。' : '任务完成或需要回答时由设备网关发送 Bark 通知，App 退出后也可接收。') }, nativeAction('push-save', t('保存推送设置'), 'settings.push.save'));
   if (p.error || p.saved) items.push({ id: 'push-status', kind: 'text', text: p.error || t('推送设置已保存') });
   if (c.failedNotificationDevices?.length) items.push({ id: 'push-failed', kind: 'text', text: t('推送设置尚未同步到：{devices}。连接恢复后自动重试；旧网关需升级。', { devices: c.failedNotificationDevices.join('、') }) });
  }
  if (c.appUpdate) {
   items.push({ id: 'app-version', kind: 'text', title: 'Codex Mobile', text: `v${c.appUpdate.currentVersion} ${c.appUpdate.status ?? ''}` });
   if (c.appUpdate.manualCheckSupported) items.push({ ...nativeAction('check-update', t(c.appUpdate.checking ? '正在检查…' : '检查更新'), 'settings.update.check'), disabled: c.appUpdate.checking });
  }
 }
 const prefixes: Record<string, string[]> = { devices: ['device', 'devices-error', 'name', 'gatewayUrl', 'scan', 'save', 'cancel', 'add', ...c.registry.backends.map((b: any) => b.id)], language: ['language'], font: ['font'], transport: ['transport'], notifications: ['push', 'bark'], updates: ['app-version', 'check-update'] };
 const page = c.page;
 const root = page === 'settings';
 const visible = root ? items.filter(item => ['language', 'font', 'font-error', 'transport', 'push', 'app-version', 'check-update'].includes(item.id)) : page && prefixes[page] && !confirmation ? items.filter(item => prefixes[page].some(prefix => item.id === prefix || item.id.startsWith(`${prefix}-`))) : items;
 const titles: Record<string, string> = { settings: t('设置'), language: t('语言'), font: t('字体大小'), transport: t('传输方式'), notifications: t('通知'), updates: t('应用更新') };
 const deviceTitle = confirmation ? '确认设备操作' : c.draft ? c.registry.backends.some((backend: any) => backend.id === c.draft.id) ? '编辑设备' : '添加设备' : '设备';
 return { id: root ? 'settings:root' : page && page !== 'devices' ? `settings:${page}` : 'devices', title: titles[page] ?? t(deviceTitle), items: visible, dismissible: !c.testing };
}
