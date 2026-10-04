import { describe, expect, it } from "vitest";
import {
  newChatModelSettingsStorageKey,
  readNewChatModelSettings,
  resolveNewChatModelSettings,
  writeNewChatModelSettings,
} from "../../src/ui/model-settings-preference";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("新对话模型设置偏好", () => {
  it("按后端保存模型、智能和 Fast，并保留正常速度的 null", () => {
    const storage = new MemoryStorage();
    writeNewChatModelSettings(storage, "mini", {
      model: "gpt-fast",
      effort: "low",
      serviceTier: "priority",
    });
    writeNewChatModelSettings(storage, "macbook", {
      model: "gpt-default",
      effort: "high",
      serviceTier: null,
    });

    expect(readNewChatModelSettings(storage, "mini")).toEqual({
      model: "gpt-fast",
      effort: "low",
      serviceTier: "priority",
    });
    expect(readNewChatModelSettings(storage, "macbook")).toEqual({
      model: "gpt-default",
      effort: "high",
      serviceTier: null,
    });
  });

  it("忽略损坏或字段不完整的本地值", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      newChatModelSettingsStorageKey("mini"),
      "{",
    );
    expect(readNewChatModelSettings(storage, "mini")).toBeNull();

    storage.setItem(
      newChatModelSettingsStorageKey("mini"),
      JSON.stringify({ version: 1, model: "", effort: 42, serviceTier: false }),
    );
    expect(readNewChatModelSettings(storage, "mini")).toBeNull();
  });

  it("优先恢复有效偏好，并把失效选项归一化到模型默认值", () => {
    const models = [
      {
        model: "gpt-default",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "" },
        ],
        defaultServiceTier: null,
        serviceTiers: [],
      },
      {
        model: "gpt-fast",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "" },
          { reasoningEffort: "high", description: "" },
        ],
        defaultServiceTier: null,
        serviceTiers: [
          { id: "priority", name: "Fast", description: "" },
        ],
      },
    ];

    expect(
      resolveNewChatModelSettings(
        models,
        { model: "gpt-fast", effort: "low", serviceTier: "priority" },
        { model: "gpt-default", effort: "medium", serviceTier: null },
      ),
    ).toEqual({
      model: "gpt-fast",
      effort: "low",
      serviceTier: "priority",
    });

    expect(
      resolveNewChatModelSettings(
        models,
        { model: "gpt-fast", effort: "ultra", serviceTier: "retired" },
        { model: "gpt-default", effort: "medium", serviceTier: null },
      ),
    ).toEqual({
      model: "gpt-fast",
      effort: "high",
      serviceTier: null,
    });
  });

  it("偏好模型已下线时回退到服务端配置", () => {
    const models = [
      {
        model: "gpt-default",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "" },
        ],
        serviceTiers: [],
      },
    ];

    expect(
      resolveNewChatModelSettings(
        models,
        { model: "gpt-retired", effort: "low", serviceTier: "priority" },
        { model: "gpt-default", effort: "medium", serviceTier: null },
      ),
    ).toEqual({
      model: "gpt-default",
      effort: "medium",
      serviceTier: null,
    });
  });
});
