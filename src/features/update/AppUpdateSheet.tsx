import { useNativeGlobalPanel } from '../../native-ui/adapters';
import type { NativeRuntime } from '../../native-ui/runtime';
import { nativeAction } from '../../native-ui/projection';
import type { AppUpdateState } from "./useAppUpdate";
import { ActionSheet } from "../../ui/ActionSheet";
import { t } from "../../i18n";
import { releaseNotesForUpgrade } from "../../app-update/release";

function statusLabel(state: AppUpdateState) {
  switch (state.phase) {
    case "downloading":
      return t("正在下载 {progress}%", { progress: Math.max(0, Math.min(100, Math.round(state.progress ?? 0))) });
    case "verifying":
      return t("正在验证安装包");
    case "installing":
      return t("正在打开系统安装器");
    default:
      return "";
  }
}
export function AppUpdateSheet({
  open,
  nativeRuntime,
  state,
  onClose,
  onInstall,
  onRetry,
}: {
  nativeRuntime?: NativeRuntime | null;
  open: boolean;
  state: AppUpdateState;
  onClose: () => void;
  onInstall: () => void;
  onRetry: () => void;
}) {
  const working = ["downloading", "verifying", "installing"].includes(
    state.phase,
  );
  const label = statusLabel(state);
  const releaseNotes = state.release ? releaseNotesForUpgrade(
    state.release!,
    state.currentVersion,
  ) : [];

  useNativeGlobalPanel(nativeRuntime, 'update', open && state.release ? { id: 'update', title: t('发现新版本'), dismissible: !working, items: [
    { id: 'update-version', kind: 'text', title: `v${state.release.version}`, text: t('当前版本 v{version}', { version: state.currentVersion }) },
    ...releaseNotes.map(note => ({ id: note.version, kind: 'markdown', title: `v${note.version}`, text: note.notes })),
    ...(label ? [{ id: 'update-status', kind: 'text', text: label }] : []),
    ...(state.phase === 'error' ? [{ id: 'update-error', kind: 'text', text: state.error || t('更新失败，请重试') }] : []),
    { ...nativeAction('update-install', t(state.phase === 'error' ? '重试' : working ? label : '立即更新'), state.phase === 'error' ? 'update.retry' : 'update.install'), disabled: working },
    { ...nativeAction('update-close', t('稍后'), 'update.close'), disabled: working },
  ] } : undefined, {
    'panel.close': () => { if (!working) onClose(); },
    'update.install': () => { if (working || !state.release) throw new Error(t('当前无法更新')); onInstall(); },
    'update.retry': () => { if (working || !state.release) throw new Error(t('当前无法更新')); onRetry(); },
    'update.close': () => { if (!working) onClose(); },
  });
  if (!open || !state.release) return null;
  return (
    <ActionSheet
      title={
          <div>
            <small>Codex Mobile</small>
            <h2>{t("发现新版本")}</h2>
          </div>
      }
      ariaLabel={t("发现新版本")}
      className="app-update-sheet"
      backdropClassName="app-update-backdrop"
      closeOnBackdrop={false}
      closeLabel={t("关闭更新")}
      closeDisabled={working}
      footer={
        <>
          <button type="button" disabled={working} onClick={onClose}>
            {t("稍后")}
          </button>
          <button
            className="primary"
            type="button"
            disabled={working}
            onClick={state.phase === "error" ? onRetry : onInstall}
          >
            {state.phase === "error" ? t("重试") : working ? label : t("立即更新")}
          </button>
        </>
      }
    >
        <div className="app-update-content">
          <strong>v{state.release.version}</strong>
          <p className="app-update-current">
            {t("当前版本 v{version}", { version: state.currentVersion })}
          </p>
          <div className="app-update-release-list">
            {releaseNotes.map((releaseNote) => (
              <section key={releaseNote.version}>
                <h3>v{releaseNote.version}</h3>
                <div className="app-update-notes">{releaseNote.notes}</div>
              </section>
            ))}
          </div>
          {label && (
            <div className="app-update-progress" aria-live="polite">
              <span>{label}</span>
              {state.phase === "downloading" && (
                <i style={{ width: `${state.progress ?? 0}%` }} />
              )}
            </div>
          )}
          {state.phase === "error" && (
            <p className="app-update-error" role="alert">
              {state.error || t("更新失败，请重试")}
            </p>
          )}
        </div>
    </ActionSheet>
  );
}
