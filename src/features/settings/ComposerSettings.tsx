import { useEffect } from "react";
import { t } from "../../i18n";
import {
  modelOptionMeta,
  type ModelCatalogEntry,
  type PermissionMode,
  type PermissionModeId,
} from "../../ui/settings";

export type ComposerPicker =
  | "agent"
  | "model"
  | "permission"
  | null;

function ComposerSettingsForm({
  picker, effortOptions, permissionModes, models, selectedEffort, selectedModel,
  selectedPermissionModeId, onPickerChange, onChooseEffort, onChooseModel, onChoosePermissionMode,
}: {
  picker: ComposerPicker;
  effortOptions: Array<{ id: string; label: string; description?: string }>;
  permissionModes: PermissionMode[];
  models: ModelCatalogEntry[];
  selectedEffort: string | null;
  selectedModel: string;
  selectedPermissionModeId: PermissionModeId | null;
  onPickerChange: (picker: ComposerPicker) => void;
  onChooseEffort: (effort: string) => void;
  onChooseModel: (model: string) => void;
  onChoosePermissionMode: (mode: PermissionModeId) => void;
}) {
  useEffect(() => {
    if (!picker) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") onPickerChange(null);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [picker, onPickerChange]);
  if (!picker) return null;
  return (
    <div className="composer-popover-backdrop" onClick={() => onPickerChange(null)}>
      <section
        className={`composer-popover ${picker === "permission" ? "permission-popover" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={
          picker === "permission"
            ? t("权限模式")
            : picker === "model"
              ? t("模型")
              : t("思考强度")
        }
        onClick={(event) => event.stopPropagation()}
      >
        {picker === "agent" && (
          <>
            <div className="popover-eyebrow">{t("思考强度")}</div>
            <div className="popover-options effort-options">
              {effortOptions.map((option) => {
                const selected = option.id === selectedEffort;
                return (
                  <button
                    key={option.id}
                    className={selected ? "selected" : ""}
                    aria-pressed={selected}
                    onClick={() => {
                      onChooseEffort(option.id);
                      onPickerChange(null);
                    }}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      {option.description && <small>{option.description}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {picker === "model" && (
          <>
            <div className="popover-eyebrow">{t("模型")}</div>
            <div className="popover-options model-options" aria-label={t("模型列表")}>
              {models.map((option) => {
                const value = option.model;
                const selected = value === selectedModel;
                const meta = modelOptionMeta(option);
                return (
                  <button
                    key={option.id || value}
                    className={selected ? "selected" : ""}
                    aria-pressed={selected}
                    onClick={() => {
                      onChooseModel(value as string);
                      onPickerChange(null);
                    }}
                  >
                    <span>
                      <strong>{option.displayName}</strong>
                      <small>{meta.description || meta.identity}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {picker === "permission" && (
          <div className="popover-options permission-options">
            {permissionModes.map((mode) => {
              const selected = mode.id === selectedPermissionModeId;
              return (
                <button
                  key={mode.id}
                  className={selected ? "selected" : ""}
                  aria-pressed={selected}
                  onClick={() => { onChoosePermissionMode(mode.id); onPickerChange(null); }}
                >
                  <span>
                    <strong>{mode.label}</strong>
                    <small>{mode.description}</small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export type ComposerSettingsProps = Parameters<typeof ComposerSettingsForm>[0];

export function ComposerSettings(props: ComposerSettingsProps) {
  return <ComposerSettingsForm {...props} />;
}
