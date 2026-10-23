import { useEffect, useRef, useState } from 'react';
import { ActionSheet } from './ActionSheet';
import { t } from '../i18n';
import type { BackendConfig } from '../backends/types';
import { summarizeThreadTitle } from '../backends/title-summary';

export function useThreadRename() {
  const [target, setTarget] = useState<{ backend: BackendConfig; threadId: string; title: string } | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const pending = useRef<((name: string | null) => void) | null>(null);
  useEffect(() => () => { generation.current++; pending.current?.(null); }, []);
  const close = (value: string | null) => { generation.current++; pending.current?.(value); pending.current = null; setTarget(null); setLoading(false); };
  const request = (backend: BackendConfig, threadId: string, title: string): Promise<string | null> => {
    pending.current?.(null); generation.current++; setName(title); setLoading(false); setError('');
    return new Promise(resolve => { pending.current = resolve; setTarget({ backend, threadId, title }); });
  };
  const summarize = async () => {
    if (!target || loading) return;
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      const title = await summarizeThreadTitle(target.backend, target.threadId);
      if (generation.current === current) setName(title);
    } catch (reason) { if (generation.current === current) setError(reason instanceof Error ? reason.message : t('会话标题总结失败，请重试')); }
    finally { if (generation.current === current) setLoading(false); }
  };
  return { request, dialog: target && <ActionSheet className="thread-rename-sheet" title={t('重命名会话')} onClose={() => close(null)}>
    <form onSubmit={event => { event.preventDefault(); if (!loading && name.trim()) close(name.trim()); }}>
      <label>{t('会话名称')}<input aria-label={t('会话名称')} autoFocus value={name} disabled={loading} onChange={event => setName(event.target.value)} /></label>
      <button type="button" className="thread-rename-summary" disabled={loading} aria-busy={loading} onClick={() => void summarize()}>{loading && <span className="action-spinner" aria-label={t('正在总结')} />} {t('模型总结')}</button>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => close(null)}>{t('取消')}</button>
      <button type="submit" disabled={loading || !name.trim() || name.trim() === target.title}>{t('保存')}</button>
    </form>
  </ActionSheet> };
}
