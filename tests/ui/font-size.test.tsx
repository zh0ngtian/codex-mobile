import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendManagerSheet } from "../../src/features/backends/BackendManagerSheet";

const props = {
  open: true,
  registry: { version: 1 as const, backends: [], selectedBackendId: "all" },
  summaries: {},
  onChange: () => undefined,
  onClose: () => undefined,
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.style.removeProperty("--app-font-scale");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.style.removeProperty("--app-font-scale");
});

describe("字体大小设置", () => {
  it("首次配置设备时也能调整字号，并在关闭重开后保留选择", () => {
    const view = render(<BackendManagerSheet {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "特大" }));
    expect(document.documentElement.style.getPropertyValue("--app-font-scale")).toBe("1.25");
    expect(window.localStorage.getItem("codex-mobile:font-size")).toBe("extra-large");
    view.rerender(<BackendManagerSheet {...props} open={false} />);
    view.rerender(<BackendManagerSheet {...props} />);
    expect(screen.getByRole("button", { name: "特大" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "标准" }));
    expect(document.documentElement.style.getPropertyValue("--app-font-scale")).toBe("1");
  });

  it("保存值损坏时回退标准字号", () => {
    window.localStorage.setItem("codex-mobile:font-size", "huge");
    render(<BackendManagerSheet {...props} />);
    expect(screen.getByRole("button", { name: "标准" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.style.getPropertyValue("--app-font-scale")).toBe("1");
  });

  it("存储不可用时仍可调整，并显示无法保存的反馈", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<BackendManagerSheet {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "大" }));
    expect(document.documentElement.style.getPropertyValue("--app-font-scale")).toBe("1.125");
    expect(screen.getByRole("alert")).toHaveTextContent("字号已应用，但无法保存；重启后可能恢复原字号");
  });
});
