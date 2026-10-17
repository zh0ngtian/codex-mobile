import { useNativeGlobalPanel } from '../../native-ui/adapters';
import type { NativeRuntime } from '../../native-ui/runtime';
import { nativeAction } from '../../native-ui/projection';
import { useEffect, useState } from "react";
import { ActionSheet } from "../../ui/ActionSheet";
import { ErrorBanner } from "../../ui/ErrorBanner";
import { t } from "../../i18n";
import { newChatDraftStore, type SavedNewChatDraft } from "./new-chat-drafts";

export function DraftsSheet({ onClose, onOpenDraft, nativeRuntime }: {
  nativeRuntime?: NativeRuntime | null;
  onClose: () => void;
  onOpenDraft: (draft: SavedNewChatDraft) => void;
}) {
  const [drafts, setDrafts] = useState<SavedNewChatDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void newChatDraftStore.list().then(records => {
      if (!cancelled) setDrafts(records);
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : t("无法读取草稿"));
    }).finally(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; };
  }, [reload]);

  async function remove(draft: SavedNewChatDraft) {
    setDeleting(true);
    setError("");
    try {
      await newChatDraftStore.remove(draft.id);
      setDrafts(current => current.filter(record => record.id !== draft.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("无法删除草稿"));
    } finally {
      setDeleting(false);
    }
  }

  useNativeGlobalPanel(nativeRuntime, 'drafts', { id: 'drafts', title: t('草稿'), items: [
    { id: 'drafts-description', kind: 'text', text: t('仅保存在本地，选择草稿继续新对话') },
    ...(loading ? [{ id: 'drafts-loading', kind: 'text', text: t('正在读取草稿…') }] : []),
    ...(!loading && !drafts.length ? [{ id: 'drafts-empty', kind: 'text', text: t('暂无草稿') }] : []),
    ...(error ? [{ id: 'drafts-error', kind: 'text', text: error }, nativeAction('drafts-retry', t('重试'), 'drafts.retry')] : []),
    ...drafts.map(d => ({ id: d.id, kind: 'section', title: d.text.trim().replace(/\s+/g, ' ').slice(0, 100) || t('附件草稿'), text: `${d.backendName} · ${d.cwd || t('无项目')} · ${d.images.length} ${t('图片')} · ${d.files.length} ${t('文件')} · ${new Date(d.updatedAt).toLocaleString()}`,
      value: JSON.stringify({ backendId: d.backendId, backendName: d.backendName, cwd: d.cwd, text: d.text, updatedAt: d.updatedAt,
        settings: d.settings ? { model: d.settings.model, effort: d.settings.effort, serviceTier: d.settings.serviceTier, permissions: d.settings.permissions, approvalPolicy: d.settings.approvalPolicy, approvalsReviewer: d.settings.approvalsReviewer } : undefined,
        images: d.images.map(image => ({ id: image.id, name: image.name, type: image.type, size: image.size, url: image.url })),
        files: d.files.map(file => ({ id: file.id, name: file.name, type: file.type, size: file.size })),
      }), children: [
      { ...nativeAction(`${d.id}:restore`, t('恢复'), 'drafts.restore', { id: d.id }), disabled: deleting || loading }, { ...nativeAction(`${d.id}:remove`, t('删除'), 'drafts.remove', { id: d.id }), disabled: deleting || loading },
    ] })),
  ] }, {
    'panel.close': onClose,
    'drafts.retry': () => setReload(v => v + 1),
    'drafts.restore': p => { const d = drafts.find(d => d.id === p.id); if (!d || deleting || loading) throw new Error(t('草稿不可用')); try { onOpenDraft(d); } catch (reason) { setError(reason instanceof Error ? reason.message : t('无法恢复草稿')); throw reason; } },
    'drafts.remove': p => { const d = drafts.find(d => d.id === p.id); if (!d || deleting || loading) throw new Error(t('草稿不可用')); return remove(d); },
  });

  return (
    <ActionSheet title={t("草稿")} ariaLabel={t("草稿")} onClose={onClose} className="drafts-sheet">
      <p className="drafts-description">{t("仅保存在本地，选择草稿继续新对话")}</p>
      {error && <><ErrorBanner message={error} /><button type="button" className="drafts-retry" onClick={() => setReload(current => current + 1)}>{t("重试")}</button></>}
      {loading ? <p role="status">{t("正在读取草稿…")}</p> : !drafts.length && !error ? <p className="drafts-empty">{t("暂无草稿")}</p> : (
        <div className="saved-draft-list">
          {drafts.map(draft => {
            const title = draft.text.trim().replace(/\s+/g, " ").slice(0, 100) || t("附件草稿");
            return <div className="saved-draft-row" key={draft.id}>
              <button type="button" className="saved-draft-open" disabled={deleting} aria-label={t("恢复草稿：{title}", { title })} onClick={() => {
                try { onOpenDraft(draft); }
                catch (reason) { setError(reason instanceof Error ? reason.message : t("无法恢复草稿")); }
              }}>
                <strong>{title}</strong>
                <span className="saved-draft-target">{draft.backendName} · {draft.cwd?.split("/").filter(Boolean).at(-1) || t("无项目")}</span>
                {(draft.images.length > 0 || draft.files.length > 0) && <span>{t("{images} 张图片 · {files} 个文件", { images: draft.images.length, files: draft.files.length })}</span>}
                <time dateTime={new Date(draft.updatedAt).toISOString()}>{new Date(draft.updatedAt).toLocaleString()}</time>
              </button>
              <button type="button" className="saved-draft-delete" disabled={deleting} aria-label={t("删除草稿：{title}", { title })} onClick={() => void remove(draft)}>{t("删除")}</button>
            </div>;
          })}
        </div>
      )}
    </ActionSheet>
  );
}
