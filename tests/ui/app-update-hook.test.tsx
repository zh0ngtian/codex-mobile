import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_UPDATE_EVENT,
  type AndroidAppUpdateBridge,
  type IosAppUpdateBridge,
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

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("没有原生版本桥时使用内置前端版本且不检查 APK 更新", () => {
    vi.stubEnv("VITE_APP_VERSION", "0.2.100");
    const fetchRelease = vi.fn(async () => releasePayload);
    const { result } = renderHook(() =>
      useAppUpdate({ bridge: null, fetchRelease, storage }),
    );

    expect(result.current.state.currentVersion).toBe("0.2.100");
    expect(result.current.supported).toBe(false);
    expect(fetchRelease).not.toHaveBeenCalled();
  });

  it("无原生版本桥且未配置 VITE_APP_VERSION 时使用 0.3.0", () => {
    vi.stubEnv("VITE_APP_VERSION", "");
    const { result } = renderHook(() =>
      useAppUpdate({ bridge: null, fetchRelease: async () => releasePayload, storage }),
    );

    expect(result.current.state.currentVersion).toBe("0.3.0");
    expect(result.current.supported).toBe(false);
  });

  const iosModes = [["网页", false], ["原生", true]] as const;

  function prepareIos(nativeUI = false) {
    const iosBridge: IosAppUpdateBridge = {
      appVersion: () => "v0.2.30",
      apiUrl: "https://updates.example.com/mobile/current/latest-ios.json",
      installUrl: "https://updates.example.com/mobile/current/install.html",
      bundleId: "app.example.mobile", teamId: "TEAM123456",
      applicationIdentifier: "PREFIX1234.app.example.mobile", installOta: vi.fn(),
    };
    vi.stubGlobal("CodexMobileAppUpdate", iosBridge);
    vi.stubGlobal("__CODEX_NATIVE_UI__", nativeUI);
    vi.stubGlobal("__CODEX_NATIVE_ACTIVE__", true);
    vi.stubGlobal("webkit", { messageHandlers: { nativeUI: { postMessage: vi.fn() } } });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const payload = {
      ...releasePayload, signed: true, profileExpiresAt: "2027-10-03T04:08:22Z", bundleId: iosBridge.bundleId,
      teamId: iosBridge.teamId, applicationIdentifier: iosBridge.applicationIdentifier,
      pageUrl: iosBridge.apiUrl, installUrl: iosBridge.installUrl,
      downloadUrl: "https://updates.example.com/mobile/releases/0.2.31/latest.ipa",
      manifestUrl: "https://updates.example.com/mobile/releases/0.2.31/manifest.plist",
    };
    return { iosBridge, fetchRelease: vi.fn(async () => payload) };
  }

  it.each(iosModes)("iOS %s界面启动不请求更新源，保留真实原生版本", async (_, nativeUI) => {
    const { fetchRelease } = prepareIos(nativeUI);
    vi.stubEnv("VITE_APP_VERSION", "0.2.100");
    const { result } = renderHook(() => useAppUpdate({ bridge: null, fetchRelease, storage }));
    await act(async () => {});

    expect(fetchRelease).not.toHaveBeenCalled();
    expect(result.current.supported).toBe(false);
    expect(result.current.manualCheckSupported).toBe(false);
    expect(result.current.state).toEqual({ phase: "idle", currentVersion: "0.2.30" });
    expect(result.current.sheetOpen).toBe(false);
  });

  it.each(iosModes)("iOS %s界面回到前台不检查更新", async (_, nativeUI) => {
    const { fetchRelease } = prepareIos(nativeUI);
    const { result } = renderHook(() => useAppUpdate({ bridge: null, fetchRelease, storage }));
    await act(async () => {});
    // 清空缓存，确保断言覆盖回前台入口而不是命中旧检查的缓存。
    storage.clear();
    fetchRelease.mockClear();
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));

    expect(fetchRelease).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.sheetOpen).toBe(false);
  });

  it.each([false, true])("iOS 显式 check(%s) 也不请求更新源", async force => {
    const { fetchRelease } = prepareIos();
    const { result } = renderHook(() => useAppUpdate({ bridge: null, fetchRelease, storage }));
    await act(async () => {});
    storage.clear();
    fetchRelease.mockClear();
    await act(async () => result.current.check(force));

    expect(fetchRelease).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ phase: "idle", currentVersion: "0.2.30" });
    expect(result.current.sheetOpen).toBe(false);
  });

  it.each(["downloading", "verifying", "installing", "error"])("iOS 忽略原生更新事件 %s", async phase => {
    const { fetchRelease } = prepareIos(true);
    const { result } = renderHook(() => useAppUpdate({ bridge: null, fetchRelease, storage }));
    await act(async () => {});
    act(() => result.current.setSheetOpen(false));
    const previousState = result.current.state;
    act(() => window.dispatchEvent(new CustomEvent(APP_UPDATE_EVENT, {
      detail: { phase, progress: 57, error: "安装包校验失败" },
    })));

    expect(result.current.state).toEqual(previousState);
    expect(result.current.sheetOpen).toBe(false);
  });

  it("iOS 不接受显式打开更新弹层或安装操作", async () => {
    const { iosBridge, fetchRelease } = prepareIos(true);
    const { result } = renderHook(() => useAppUpdate({ bridge: null, fetchRelease, storage }));
    await act(async () => {});
    act(() => result.current.setSheetOpen(true));
    act(() => result.current.install());

    expect(iosBridge.installOta).not.toHaveBeenCalled();
    expect(result.current.sheetOpen).toBe(false);
  });

  it("iOS 存有旧更新缓存或签名源缺失时仍保持静默", async () => {
    const { iosBridge, fetchRelease } = prepareIos();
    iosBridge.apiUrl = "";
    iosBridge.installUrl = "";
    storage.setItem("codex-mobile:app-update:last-lan-release", JSON.stringify({ checkedAt: Date.now(), release: releasePayload }));
    const { result } = renderHook(() => useAppUpdate({ bridge: null, fetchRelease, storage }));
    await act(async () => result.current.check(true));

    expect(fetchRelease).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ phase: "idle", currentVersion: "0.2.30" });
    expect(result.current.sheetOpen).toBe(false);
  });

  it("Android 优先显示原生安装包版本", () => {
    vi.stubEnv("VITE_APP_VERSION", "0.2.100");
    const { result } = renderHook(() =>
      useAppUpdate({
        bridge: { appVersion: () => "v0.2.99", installApk: vi.fn() },
        fetchRelease: async () => releasePayload,
        storage,
      }),
    );

    expect(result.current.state.currentVersion).toBe("0.2.99");
    expect(result.current.manualCheckSupported).toBe(true);
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
