import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppBootstrap } from "../../src/App";

describe("应用后端初始化", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const emptyRegistry = { version: 1 as const, selectedBackendId: "", backends: [] };

  it("默认 HTTP，选择流式后保存并在冷启动恢复", () => {
    const view = render(<AppBootstrap initialRegistry={emptyRegistry} />);
    expect(screen.getByRole("button", { name: "HTTP" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "流式" }));
    expect(window.localStorage.getItem("codex-mobile:transport-mode")).toBe("stream");
    expect(screen.getByRole("button", { name: "流式" }).getAttribute("aria-pressed")).toBe("true");
    view.unmount();
    render(<AppBootstrap initialRegistry={emptyRegistry} />);
    expect(screen.getByRole("button", { name: "流式" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "HTTP" }));
    expect(window.localStorage.getItem("codex-mobile:transport-mode")).toBe("http");
  });

  it("非法传输偏好回退到 HTTP", () => {
    window.localStorage.setItem("codex-mobile:transport-mode", "invalid");
    render(<AppBootstrap initialRegistry={emptyRegistry} />);
    expect(screen.getByRole("button", { name: "HTTP" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("本机存储拒绝访问时仍默认 HTTP，并允许本次切换", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("storage unavailable"); },
      setItem: () => { throw new Error("storage unavailable"); },
    });
    render(<AppBootstrap initialRegistry={emptyRegistry} />);
    expect(screen.getByRole("button", { name: "HTTP" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "流式" }));
    expect(screen.getByRole("button", { name: "流式" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("空后端首次启动时直接打开添加设备表单", () => {
    render(
      <AppBootstrap
        initialRegistry={{
          version: 1,
          selectedBackendId: "",
          backends: [],
        }}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "设备连接" }),
    ).not.toBeNull();
    expect(screen.getByLabelText("设备名称")).not.toBeNull();
    expect(screen.getByLabelText("网关地址")).not.toBeNull();
  });
});
