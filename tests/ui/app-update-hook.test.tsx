import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_UPDATE_EVENT,
  type AndroidAppUpdateBridge,
} from "../../src/app-update/native-bridge";
import { useAppUpdate } from "../../src/features/update/useAppUpdate";

const releasePayload = {
  version: "0.2.31",
  tag: "v0.2.31",
  notes: "新版本",
  pageUrl:
    "http://192.168.123.79:8765/channels/codex-mobile/latest.json",
  downloadUrl:
    "http://192.168.123.79:8765/channels/codex-mobile/latest.apk",
  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  size: 1_024,
  publishedAt: "2026-10-02T12:00:00+08:00",
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } satisfies Storage;
}

describe("App 更新控制器", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("普通浏览器不检查也不展示更新能力", () => {
    const fetchRelease = vi.fn(async () => releasePayload);
    const { result } = renderHook(() =>
      useAppUpdate({ bridge: null, fetchRelease, storage }),
    );

    expect(result.current.supported).toBe(false);
    expect(result.current.state.phase).toBe("idle");
    expect(fetchRelease).not.toHaveBeenCalled();
  });

  it("Android 启动时自动检查，手动检查绕过缓存", async () => {
    const bridge: AndroidAppUpdateBridge = {
      appVersion: () => "0.2.0",
      installApk: vi.fn(),
    };
    const fetchRelease = vi.fn(async () => releasePayload);
    const { result } = renderHook(() =>
      useAppUpdate({ bridge, fetchRelease, storage }),
    );

    await waitFor(() => expect(result.current.state.phase).toBe("available"));
    expect(result.current.sheetOpen).toBe(true);
    expect(fetchRelease).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.check(false);
    });
    expect(fetchRelease).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.check(true);
    });
    expect(fetchRelease).toHaveBeenCalledTimes(2);
  });

  it("立即更新调用原生桥，并接收下载、校验和失败状态", async () => {
    const installApk = vi.fn();
    const bridge: AndroidAppUpdateBridge = {
      appVersion: () => "0.2.0",
      installApk,
    };
    const { result } = renderHook(() =>
      useAppUpdate({
        bridge,
        fetchRelease: async () => releasePayload,
        storage,
      }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe("available"));

    act(() => result.current.install());
    expect(installApk).toHaveBeenCalledWith(
      releasePayload.downloadUrl,
      releasePayload.sha256,
    );
    expect(result.current.state.phase).toBe("downloading");

    act(() => {
      window.dispatchEvent(
        new CustomEvent(APP_UPDATE_EVENT, {
          detail: { phase: "downloading", progress: 57 },
        }),
      );
    });
    expect(result.current.state.progress).toBe(57);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(APP_UPDATE_EVENT, {
          detail: { phase: "verifying" },
        }),
      );
    });
    expect(result.current.state.phase).toBe("verifying");

    act(() => {
      window.dispatchEvent(
        new CustomEvent(APP_UPDATE_EVENT, {
          detail: { phase: "error", error: "安装包校验失败" },
        }),
      );
    });
    expect(result.current.state).toMatchObject({
      phase: "error",
      error: "安装包校验失败",
    });
  });
});
