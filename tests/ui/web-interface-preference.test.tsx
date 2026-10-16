import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppBootstrap } from "../../src/App";
import { WebInterfaceProvider, useWebInterface } from "../../src/features/web-ui/preference";
import { nativeSwitchStore } from "../../src/native-ui/switch-store";

const preferenceKey = "codex-mobile:web-interface";
const emptyRegistry = { version: 1 as const, selectedBackendId: "", backends: [] };
type NativeHost = Window & {
  __CODEX_IOS_HOST__?: boolean;
  __CODEX_NATIVE_UI__?: boolean;
  __CODEX_NATIVE_UI_RECOVERED__?: boolean;
  webkit?: { messageHandlers: { nativeUI: { postMessage(message: { type: string; id: string; enabled?: boolean }): void } } };
  codexMobileNativePreferenceComplete?: (response: { id: string; enabled: boolean; active: boolean }) => void;
};
const host = window as NativeHost;

function useIOSHost(active: boolean) {
  host.__CODEX_IOS_HOST__ = true;
  host.__CODEX_NATIVE_UI__ = active;
  host.webkit = { messageHandlers: { nativeUI: { postMessage(message) {
    if (message.type === "nativePreference") {
      queueMicrotask(() => host.codexMobileNativePreferenceComplete?.({
        id: message.id, enabled: message.enabled ?? active, active,
      }));
    }
  } } } };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.webInterface;
  for (const key of ["__CODEX_IOS_HOST__", "__CODEX_NATIVE_UI__", "__CODEX_NATIVE_UI_RECOVERED__", "webkit", "codexMobileNativePreference", "codexMobileNativePreferenceComplete"]) {
    delete (window as unknown as Record<string, unknown>)[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Web 界面偏好", () => {
  it.each([null, "", "invalid", "true", "legacy"])("未保存或无效偏好 %s 默认使用旧版，空设备设置也能访问开关", (saved) => {
    if (saved !== null) localStorage.setItem(preferenceKey, saved);
    render(<AppBootstrap initialRegistry={emptyRegistry} />);
    expect(screen.getByRole("checkbox", { name: "使用新版界面" })).not.toBeChecked();
    expect(document.documentElement.dataset.webInterface).toBe("legacy");
    expect(screen.queryByRole("checkbox", { name: "使用原生界面" })).not.toBeInTheDocument();
  });

  it("手动启用后立即应用并持久保存，重新挂载仍启用，关闭后恢复旧版", () => {
    const first = render(<AppBootstrap initialRegistry={emptyRegistry} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "使用新版界面" }));
    expect(localStorage.getItem(preferenceKey)).toBe("modern");
    expect(document.documentElement.dataset.webInterface).toBe("modern");
    first.unmount();

    const second = render(<AppBootstrap initialRegistry={emptyRegistry} />);
    expect(screen.getByRole("checkbox", { name: "使用新版界面" })).toBeChecked();
    expect(document.documentElement.dataset.webInterface).toBe("modern");
    fireEvent.click(screen.getByRole("checkbox", { name: "使用新版界面" }));
    expect(localStorage.getItem(preferenceKey)).toBe("legacy");
    expect(document.documentElement.dataset.webInterface).toBe("legacy");
    second.unmount();

    render(<AppBootstrap initialRegistry={emptyRegistry} />);
    expect(screen.getByRole("checkbox", { name: "使用新版界面" })).not.toBeChecked();
  });

  it("切换时保留设备表单的未保存输入", () => {
    render(<AppBootstrap initialRegistry={emptyRegistry} />);
    const name = screen.getByRole("textbox", { name: "设备名称" });
    fireEvent.change(name, { target: { value: "未保存的设备草稿" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "使用新版界面" }));
    expect(screen.getByRole("textbox", { name: "设备名称" })).toHaveValue("未保存的设备草稿");
    fireEvent.click(screen.getByRole("checkbox", { name: "使用新版界面" }));
    expect(screen.getByRole("textbox", { name: "设备名称" })).toHaveValue("未保存的设备草稿");
  });

  it("偏好变化只更新上下文，子组件仅挂载一次且受控草稿保留", () => {
    let mounts = 0;
    function DraftProbe() {
      const { enabled, modern, change } = useWebInterface();
      const [draft, setDraft] = useState("");
      useEffect(() => { mounts++; }, []);
      return <>
        <input aria-label="探针草稿" value={draft} onChange={event => setDraft(event.target.value)} />
        <button onClick={() => change(!enabled)}>{modern ? "旧版" : "新版"}</button>
      </>;
    }
    render(<WebInterfaceProvider><DraftProbe /></WebInterfaceProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "探针草稿" }), { target: { value: "保持输入" } });
    fireEvent.click(screen.getByRole("button", { name: "新版" }));
    expect(screen.getByRole("textbox", { name: "探针草稿" })).toHaveValue("保持输入");
    fireEvent.click(screen.getByRole("button", { name: "旧版" }));
    expect(screen.getByRole("textbox", { name: "探针草稿" })).toHaveValue("保持输入");
    expect(mounts).toBe(1);
  });

  it.each(["legacy", "modern"])("保存失败时保留 %s 模式并显示可重试错误", (saved) => {
    localStorage.setItem(preferenceKey, saved);
    render(<AppBootstrap initialRegistry={emptyRegistry} />);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("磁盘已满"); });
    fireEvent.click(screen.getByRole("checkbox", { name: "使用新版界面" }));
    expect(screen.getByRole("checkbox", { name: "使用新版界面" })).toHaveProperty("checked", saved === "modern");
    expect(document.documentElement.dataset.webInterface).toBe(saved);
    expect(localStorage.getItem(preferenceKey)).toBe(saved);
    expect(screen.getByRole("alert")).toHaveTextContent("无法保存界面偏好");
    expect(screen.getByRole("alert")).toHaveTextContent("磁盘已满");
    write.mockRestore();
    fireEvent.click(screen.getByRole("checkbox", { name: "使用新版界面" }));
    expect(document.documentElement.dataset.webInterface).toBe(saved === "modern" ? "legacy" : "modern");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("读取存储失败仍可打开旧版设置", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("拒绝访问"); });
    render(<AppBootstrap initialRegistry={emptyRegistry} />);
    expect(screen.getByRole("checkbox", { name: "使用新版界面" })).not.toBeChecked();
    expect(document.documentElement.dataset.webInterface).toBe("legacy");
  });

  it.each([undefined, "existing"])("卸载后恢复原本的文档标记 %s", (previous) => {
    if (previous !== undefined) document.documentElement.dataset.webInterface = previous;
    const view = render(<AppBootstrap initialRegistry={emptyRegistry} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "使用新版界面" }));
    expect(document.documentElement.dataset.webInterface).toBe("modern");
    view.unmount();
    expect(document.documentElement.dataset.webInterface).toBe(previous);
  });

  it("完整原生界面启用时保留新版偏好但不应用，人工恢复 Web 后应用", async () => {
    useIOSHost(true);
    localStorage.setItem(preferenceKey, "modern");
    render(<AppBootstrap initialRegistry={emptyRegistry} />);
    await screen.findByRole("checkbox", { name: "使用新版界面" });
    expect(document.documentElement.dataset.webInterface).toBe("legacy");
    expect(localStorage.getItem(preferenceKey)).toBe("modern");
    act(() => {
      host.__CODEX_NATIVE_UI_RECOVERED__ = true;
      window.dispatchEvent(new Event("codex-mobile-native-recovery"));
    });
    expect(document.documentElement.dataset.webInterface).toBe("modern");
    expect(host.__CODEX_NATIVE_UI__).toBe(true);
  });

  it("原生开关独立保存，并将新版偏好同步到检查点且在业务挂载前恢复", async () => {
    useIOSHost(false);
    const first = render(<AppBootstrap initialRegistry={emptyRegistry} />);
    const nativeToggle = await screen.findByRole("checkbox", { name: "使用原生界面" });
    await waitFor(() => expect(nativeToggle).not.toBeDisabled());
    fireEvent.click(nativeToggle);
    await waitFor(() => expect(nativeToggle).toBeChecked());
    expect(document.documentElement.dataset.webInterface).toBe("legacy");
    fireEvent.click(screen.getByRole("checkbox", { name: "使用新版界面" }));
    expect(nativeToggle).toBeChecked();
    expect(host.__CODEX_NATIVE_UI__).toBe(false);
    await waitFor(async () => expect((await nativeSwitchStore.load())?.storage[preferenceKey]).toBe("modern"));
    first.unmount();

    localStorage.setItem(preferenceKey, "legacy");
    render(<AppBootstrap initialRegistry={emptyRegistry} />);
    expect(await screen.findByRole("checkbox", { name: "使用新版界面" })).toBeChecked();
    expect(document.documentElement.dataset.webInterface).toBe("modern");
  });
});
