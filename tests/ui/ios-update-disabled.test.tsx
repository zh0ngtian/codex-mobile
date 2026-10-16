import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { APP_UPDATE_EVENT, type IosAppUpdateBridge } from "../../src/app-update/native-bridge";
import { BackendManagerSheet } from "../../src/features/backends/BackendManagerSheet";
import { AppUpdateSheet } from "../../src/features/update/AppUpdateSheet";
import { useAppUpdate } from "../../src/features/update/useAppUpdate";
import { NativeRuntime } from "../../src/native-ui/runtime";

function IosSettings({ runtime }: { runtime: NativeRuntime | null }) {
  const update = useAppUpdate();
  return <>
    <BackendManagerSheet nativeRuntime={runtime} nativePage="settings" open
      registry={{ version: 1, selectedBackendId: "mac", backends: [{ id: "mac", name: "Mac", baseUrl: "http://localhost", token: "", enabled: true, order: 0 }] }}
      summaries={{}} onClose={() => {}} onChange={() => {}}
      appUpdate={{ supported: update.supported, manualCheckSupported: update.manualCheckSupported,
        currentVersion: update.state.currentVersion, checking: update.state.phase === "checking",
        onCheck: () => void update.check(true) }} />
    <AppUpdateSheet nativeRuntime={runtime} open={update.sheetOpen} state={update.state}
      onClose={() => update.setSheetOpen(false)} onInstall={update.install} onRetry={update.install} />
  </>;
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(["网页", "原生"])("iOS %s设置保留版本信息，更新事件和原生命令均无法打开升级提示", async mode => {
  const runtime = mode === "原生" ? new NativeRuntime(() => {}) : null;
  const iosBridge: IosAppUpdateBridge = {
    appVersion: () => "v0.2.321", installOta: vi.fn(),
    apiUrl: "https://updates.example.com/current/latest-ios.json",
    installUrl: "https://updates.example.com/current/install.html",
    bundleId: "app.example.mobile", teamId: "TEAM123456", applicationIdentifier: "PREFIX1234.app.example.mobile",
  };
  const fetchRelease = vi.fn(async () => ({ ok: true, json: async () => ({
    version: "0.2.999", notes: "新版本", signed: true, profileExpiresAt: "2027-10-03T04:08:22Z",
    bundleId: iosBridge.bundleId, teamId: iosBridge.teamId, applicationIdentifier: iosBridge.applicationIdentifier,
    pageUrl: iosBridge.apiUrl, installUrl: iosBridge.installUrl,
    downloadUrl: "https://updates.example.com/releases/0.2.999/latest.ipa",
    manifestUrl: "https://updates.example.com/releases/0.2.999/manifest.plist",
    sha256: "a".repeat(64), size: 1024,
  }) }));
  vi.stubEnv("VITE_APP_VERSION", "0.2.0");
  vi.stubGlobal("CodexMobileAppUpdate", iosBridge);
  vi.stubGlobal("fetch", fetchRelease);
  const { unmount } = render(<IosSettings runtime={runtime} />);
  try {
    await act(async () => {});
    act(() => window.dispatchEvent(new CustomEvent(APP_UPDATE_EVENT, { detail: { phase: "error", error: "更新失败" } })));
    if (runtime) {
      expect(runtime.snapshot().panel?.id).toBe("settings:root");
      expect(runtime.snapshot().panel?.items.find(item => item.id === "app-version")).toMatchObject({ kind: "text", text: expect.stringContaining("0.2.321") });
      expect(runtime.snapshot().panel?.items.some(item => item.id === "check-update")).toBe(false);
      for (const name of ["settings.update.check", "update.install", "update.retry"]) {
        await act(async () => {
          const result = await runtime.dispatch({ id: name, name, params: {} });
          expect(result.ok).toBe(false);
        });
      }
      expect(runtime.snapshot().panel?.id).toBe("settings:root");
    } else {
      expect(screen.getByRole("region", { name: "应用信息" })).not.toBeNull();
      expect(screen.getByText("当前版本 v0.2.321")).not.toBeNull();
      expect(screen.queryByRole("button", { name: "检查更新" })).toBeNull();
    }
    expect(screen.queryByRole("dialog", { name: "发现新版本" })).toBeNull();
    expect(fetchRelease).not.toHaveBeenCalled();
    expect(iosBridge.installOta).not.toHaveBeenCalled();
  } finally {
    unmount();
    runtime?.dispose();
  }
});
