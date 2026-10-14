import { useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useNativeGlobalPanel } from './adapters';
import { nativeAction } from './projection';
import type { NativeRuntime } from './runtime';
/** 隐藏业务WK无JS对话框时，确认仍由原生用户操作完成；Web保留原confirm语义。 */
export function useNativeConfirmation(runtime: NativeRuntime | null, owner: string) {
 const serial = useRef(0); const pending = useRef<{ key: string; resolve: (value: boolean) => void } | null>(null);
 const [display, setDisplay] = useState<{ key: string; message: string } | null>(null);
 const settle = (key: unknown, value: boolean) => { if (!pending.current || pending.current.key !== key) throw new Error(t('确认操作已变化')); const current = pending.current; pending.current = null; setDisplay(null); current.resolve(value); };
 useNativeGlobalPanel(runtime, `confirmation:${owner}`, display ? { id: display.key, title: t('确认操作'), items: [
  { ...nativeAction('confirmation-yes', t('确认'), 'confirmation.answer', { key: display.key, confirmed: true }), text: display.message },
  nativeAction('confirmation-no', t('取消'), 'confirmation.answer', { key: display.key, confirmed: false }),
 ] } : undefined, { 'confirmation.answer': p => settle(p.key, p.confirmed === true), 'panel.close': p => settle(p.id, false) });
 useLayoutEffect(() => () => { pending.current?.resolve(false); pending.current = null; }, []);
 return (message: string): Promise<boolean> => {
  if (!runtime) return Promise.resolve(window.confirm(message));
  if (pending.current) return Promise.reject(new Error(t('已有确认操作等待处理')));
  const key = `confirmation:${owner}:${++serial.current}`;
  return new Promise(resolve => { pending.current = { key, resolve }; setDisplay({ key, message }); });
 };
}
