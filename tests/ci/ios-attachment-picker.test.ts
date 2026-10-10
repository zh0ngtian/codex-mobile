import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";

function install() {
  expect(existsSync("mobile/ios/AttachmentPickerBridge.swift"), "缺少 iOS 原生附件桥").toBe(true);
  const source = readFileSync("mobile/ios/AttachmentPickerBridge.swift", "utf8");
  const script = source.match(/static let script = """\n([\s\S]*?)\n\s*"""/)?.[1];
  expect(script).toBeTruthy();
  const postMessage = vi.fn();
  (window as any).webkit = { messageHandlers: { attachmentPicker: { postMessage } } };
  new Function(script!)();
  document.body.innerHTML = '<div class="attachment-picker"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple><input type="file" accept="*/*" multiple></div><input id="other" type="file">';
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(".attachment-picker input"));
  return { inputs, postMessage, complete: (window as any).codexMobileAttachmentsComplete };
}

afterEach(() => {
  (window as any).codexMobileAttachmentsDispose?.();
  delete (window as any).webkit;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("iOS 原生附件选择", () => {
  it("图片与文件直接分流，只有会话附件输入阻止系统菜单", () => {
    const { inputs, postMessage } = install();
    inputs.forEach((input, index) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(postMessage.mock.calls[index][0]).toMatchObject({ kind: index ? "files" : "photos", multiple: true });
    });
    const other = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById("other")!.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it("取消不会更改附件，旧请求不能写入新请求，取消后可重新选择", () => {
    const { inputs, postMessage, complete } = install();
    const change = vi.fn();
    inputs[0].addEventListener("change", change);
    inputs[0].click();
    const first = postMessage.mock.calls[0][0].id;
    complete({ id: first, files: [] });
    expect(change).not.toHaveBeenCalled();
    inputs[0].click();
    const second = postMessage.mock.calls[1][0].id;
    expect(second).not.toBe(first);
    complete({ id: first, files: [{ name: "stale.png", type: "image/png", data: "YQ==" }] });
    expect(change).not.toHaveBeenCalled();
    complete({ id: second, files: [] });
    inputs[0].click();
    expect(postMessage).toHaveBeenCalledTimes(3);
  });

  it("原生多选结果按顺序保留名称、MIME 和字节，并仅触发一次 change", async () => {
    const { inputs, postMessage, complete } = install();
    // jsdom 没有 DataTransfer；仅补浏览器边界，执行真实注入脚本。
    vi.stubGlobal("DataTransfer", class {
      files: File[] = [];
      items = { add: (file: File) => this.files.push(file) };
    });
    Object.defineProperty(inputs[1], "files", { writable: true, value: null });
    const change = vi.fn();
    document.body.addEventListener("change", change, { once: true });
    inputs[1].click();
    complete({ id: postMessage.mock.calls[0][0].id, files: [
      { name: "资料.txt", type: "text/plain", data: "aGVsbG8=" },
      { name: "透明.png", type: "image/png", data: "AAEC/w==" },
    ] });
    expect(change).toHaveBeenCalledTimes(1);
    const files = Array.from(inputs[1].files!);
    expect(files.map(file => [file.name, file.type, file.size])).toEqual([
      ["资料.txt", "text/plain", 5], ["透明.png", "image/png", 4],
    ]);
    const bytes = await new Promise<number[]>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
      reader.readAsArrayBuffer(files[1]);
    });
    expect(bytes).toEqual([0, 1, 2, 255]);
  });

  it("本地构建将桥安装到主 WebView，保留相册和文件原生多选", () => {
    expect(existsSync("mobile/ios/AttachmentPickerBridge.swift"), "缺少 iOS 原生附件桥").toBe(true);
    const source = readFileSync("mobile/ios/AttachmentPickerBridge.swift", "utf8");
    expect(source).toContain("PHPickerViewController");
    expect(source).toContain("configuration.filter = .images");
    expect(source).toContain("UIDocumentPickerViewController");
    expect(source).toContain("asCopy: true");
    expect(source).toContain("allowsMultipleSelection");
    const recipe = parse(readFileSync("mobile/ios/build-recipe.yml", "utf8"));
    const steps = recipe.steps;
    expect(steps.find((step: any) => step.name === "Install iOS in-app browser source").run).toContain("mobile/ios/AttachmentPickerBridge.swift");
    expect(steps.find((step: any) => step.name === "Harden and test the iOS host").run).toContain("CodexMobileAttachmentPickerBridge.configure(webView)");
  });
});
