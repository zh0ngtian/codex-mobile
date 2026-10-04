import {
  normalizeModelSettings,
  type ModelCatalogEntry,
} from "./settings";

const storagePrefix = "codex-mobile:new-chat-model-settings:v1:";

export interface ModelSettingsSelection {
  model: string;
  effort: string | null;
  serviceTier: string | null;
}

export function newChatModelSettingsStorageKey(backendId: string) {
  return `${storagePrefix}${backendId}`;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function readNewChatModelSettings(
  storage: Storage,
  backendId: string,
): ModelSettingsSelection | null {
  try {
    const raw = storage.getItem(newChatModelSettingsStorageKey(backendId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value.version !== 1 ||
      typeof value.model !== "string" ||
      !value.model ||
      !nullableString(value.effort) ||
      !nullableString(value.serviceTier)
    ) {
      return null;
    }
    return {
      model: value.model,
      effort: value.effort,
      serviceTier: value.serviceTier,
    };
  } catch {
    return null;
  }
}

export function writeNewChatModelSettings(
  storage: Storage,
  backendId: string,
  settings: ModelSettingsSelection,
) {
  try {
    storage.setItem(
      newChatModelSettingsStorageKey(backendId),
      JSON.stringify({ version: 1, ...settings }),
    );
  } catch {
    // 本机存储不可用时仍允许当前会话继续使用内存中的选择。
  }
}

export function resolveNewChatModelSettings(
  models: ModelCatalogEntry[],
  preferred: ModelSettingsSelection | null,
  configured: ModelSettingsSelection,
): ModelSettingsSelection {
  const preferredModel = preferred?.model
    ? models.find((model) => model.model === preferred.model)
    : null;
  const source = preferredModel ? preferred! : configured;
  const model =
    preferredModel ??
    models.find((entry) => entry.model === configured.model) ??
    models.find((entry) => entry.isDefault) ??
    models[0] ??
    null;
  const normalized = normalizeModelSettings(
    model,
    source.effort,
    source.serviceTier,
  );
  return {
    model: model?.model ?? source.model ?? "",
    effort: normalized.effort,
    serviceTier: normalized.serviceTier,
  };
}
