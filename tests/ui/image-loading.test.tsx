import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCachedImage } from "../../src/features/conversation/image-cache";
import { RemoteImage } from "../../src/features/conversation/sheets/RemoteFileSheets";
import { TurnCard } from "../../src/features/conversation/Timeline";

const image = { source: "/tmp/screenshot.png", name: "screenshot.png", local: true };
const backend = { id: "local", name: "Mac", baseUrl: "http://mac.local:18766", token: "secret", enabled: true, order: 0 };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

function visibleObserver() {
  const callbacks: IntersectionObserverCallback[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); }
    observe() {}
    disconnect() {}
  });
  return () => act(() => callbacks.forEach(callback => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)));
}

function blobResponse(text: string, status = 200) {
  return { ok: status === 200, status, headers: new Headers({ "x-codex-image-preview": "1" }), blob: async () => new Blob([text], { type: "image/jpeg" }) };
}

describe("会话图片按需加载", () => {
  it("多张过程截图默认折叠，展开后才读取，且不重复放入之前消息", async () => {
    const request = vi.fn().mockResolvedValue({ dataBase64: "aGVsbG8=" });
    render(<TurnCard client={{ request } as never} turn={{ id: "turn", status: "completed", items: [
      { id: "u", type: "userMessage", text: "检查" },
      { id: "a", type: "agentMessage", phase: "commentary", text: "过程" },
      { id: "i1", type: "imageView", path: "/tmp/a.png" },
      { id: "i2", type: "imageView", path: "/tmp/b.png" },
      { id: "f", type: "agentMessage", phase: "final_answer", text: "完成" },
    ] }} />);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "过程截图（2）" }));
    await screen.findByRole("button", { name: "查看图片 a.png" });
    expect(request).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: /之前的 1 条消息/ }));
    expect(screen.getAllByRole("button", { name: "查看图片 a.png" })).toHaveLength(1);
  });

  it("最终回复之后的过程截图也只在过程截图展开区显示", async () => {
    const request = vi.fn().mockResolvedValue({ dataBase64: "aGVsbG8=" });
    render(<TurnCard client={{ request } as never} turn={{ id: "after", status: "completed", items: [
      { id: "i1", type: "imageView", path: "/tmp/a.png" },
      { id: "f", type: "agentMessage", phase: "final_answer", text: "完成" },
      { id: "i2", type: "imageView", path: "/tmp/b.png" },
    ] }} />);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "过程截图（2）" }));
    await screen.findByRole("button", { name: "查看图片 b.png" });
    expect(screen.getAllByRole("button", { name: "查看图片 b.png" })).toHaveLength(1);
  });

  it("旧 WebView 没有 AbortSignal.timeout 时仍能加载缩略图", async () => {
    vi.stubGlobal("AbortSignal", {});
    const fetcher = vi.fn().mockResolvedValue(blobResponse("small"));
    vi.stubGlobal("fetch", fetcher);
    render(<RemoteImage image={image} client={{ request: vi.fn() } as never} backend={backend} />);
    await screen.findByRole("img");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("不可见图片不发请求，进入可见范围后读取", async () => {
    const reveal = visibleObserver();
    const request = vi.fn().mockResolvedValue({ dataBase64: "aGVsbG8=" });
    render(<RemoteImage image={image} client={{ request } as never} />);
    expect(request).not.toHaveBeenCalled();
    reveal();
    await screen.findByRole("button", { name: "查看图片 screenshot.png" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("图片路径更换后重新等待可见，不能沿用上一张的可见状态", async () => {
    const reveal = visibleObserver();
    const request = vi.fn().mockResolvedValue({ dataBase64: "aGVsbG8=" });
    const client = { request } as never;
    const view = render(<RemoteImage image={image} client={client} />);
    reveal();
    await screen.findByRole("img");
    view.rerender(<RemoteImage image={{ ...image, source: "/tmp/next.png", name: "next.png" }} client={client} />);
    expect(request).toHaveBeenCalledTimes(1);
    reveal();
    await screen.findByRole("img", { name: "next.png" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("同设备并发和再次挂载复用读取，另一设备独立读取", async () => {
    const request = vi.fn().mockResolvedValue({ dataBase64: "aGVsbG8=" });
    const client = { request } as never;
    const first = render(<><RemoteImage image={image} client={client} /><RemoteImage image={image} client={client} /></>);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(request).toHaveBeenCalledTimes(1);
    first.unmount();
    render(<RemoteImage image={image} client={client} />);
    await screen.findByRole("img");
    expect(request).toHaveBeenCalledTimes(1);
    const otherRequest = vi.fn().mockResolvedValue({ dataBase64: "b3RoZXI=" });
    render(<RemoteImage image={image} client={{ request: otherRequest } as never} />);
    await waitFor(() => expect(otherRequest).toHaveBeenCalledTimes(1));
  });

  it("有效缓存超时后刷新相同路径的新内容", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const request = vi.fn().mockResolvedValue({ dataBase64: "aGVsbG8=" });
    const client = { request } as never;
    const first = render(<RemoteImage image={image} client={client} />);
    await screen.findByRole("img"); first.unmount();
    clock.mockReturnValue(2000);
    const warm = render(<RemoteImage image={image} client={client} />);
    await screen.findByRole("img");
    expect(request).toHaveBeenCalledTimes(1);
    warm.unmount();
    clock.mockReturnValue(62000);
    render(<RemoteImage image={image} client={client} />);
    await screen.findByRole("img");
    expect(request).toHaveBeenCalledTimes(2);
    clock.mockRestore();
  });

  it("失效截图短期内再次挂载不重复读取", async () => {
    const request = vi.fn().mockRejectedValue(new Error("file missing"));
    const client = { request } as never;
    const first = render(<RemoteImage image={{ ...image, hideIfMissing: true }} client={client} />);
    await waitFor(() => expect(first.container.querySelector(".image-placeholder")).toBeNull());
    first.unmount();
    const second = render(<RemoteImage image={{ ...image, hideIfMissing: true }} client={client} />);
    await waitFor(() => expect(second.container.querySelector(".image-placeholder")).toBeNull());
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("失效图片隐藏后更换路径仍能重新观察并加载", async () => {
    const observe = vi.fn();
    const callbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); }
      observe = observe;
      disconnect() {}
    });
    const request = vi.fn().mockRejectedValueOnce(new Error("file missing")).mockResolvedValue({ dataBase64: "aGVsbG8=" });
    const client = { request } as never;
    const view = render(<RemoteImage image={{ ...image, hideIfMissing: true }} client={client} />);
    act(() => callbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await waitFor(() => expect(view.container.querySelector(".image-placeholder")).toBeNull());
    view.rerender(<RemoteImage image={{ ...image, source: "/tmp/restored.png", hideIfMissing: true }} client={client} />);
    expect(observe).toHaveBeenCalledTimes(2);
    act(() => callbacks.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await screen.findByRole("img");
  });

  it("缓存拒绝保留超过8MiB的单张原图", async () => {
    const request = vi.fn().mockResolvedValue({ dataBase64: "A".repeat(4 * 1024 * 1024 + 1) });
    const client = { request } as never;
    await loadCachedImage(client, image.source, "image/png");
    await loadCachedImage(client, image.source, "image/png");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("缓存总量超过8MiB时释放最旧图片", async () => {
    const request = vi.fn().mockResolvedValue({ dataBase64: "A".repeat(2 * 1024 * 1024) });
    const client = { request } as never;
    for (const path of ["/tmp/a.png", "/tmp/b.png", "/tmp/c.png"]) await loadCachedImage(client, path, "image/png");
    await loadCachedImage(client, "/tmp/c.png", "image/png");
    expect(request).toHaveBeenCalledTimes(3);
    await loadCachedImage(client, "/tmp/a.png", "image/png");
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("先取缩略图，点击才取原图，重新打开复用两种图片", async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => blobResponse(url.includes("thumbnail=1") ? "small" : "original"));
    vi.stubGlobal("fetch", fetcher);
    const client = { request: vi.fn() } as never;
    const first = render(<RemoteImage image={image} client={client} backend={backend} />);
    const button = await screen.findByRole("button", { name: "查看图片 screenshot.png" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("thumbnail=1");
    expect(String(fetcher.mock.calls[0][0])).toContain("token=secret");
    fireEvent.click(button);
    await screen.findByRole("dialog", { name: "图片预览" });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(String(fetcher.mock.calls[1][0])).not.toContain("thumbnail=1");
    await waitFor(() => expect(screen.getByRole("dialog").querySelector("img")?.src).toContain("b3JpZ2luYWw="));
    first.unmount();
    render(<RemoteImage image={image} client={client} backend={backend} />);
    fireEvent.click(await screen.findByRole("button", { name: "查看图片 screenshot.png" }));
    await screen.findByRole("dialog");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("旧网关跨源404被CORS拒绝时，经已有接口确认能力后回退", async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/host")) return { ok: true, json: async () => ({ httpPolling: true }) };
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetcher);
    const request = vi.fn().mockResolvedValue({ dataBase64: "aGVsbG8=" });
    const client = { request } as never;
    render(<RemoteImage image={image} client={client} backend={backend} />);
    await screen.findByRole("img");
    expect(request).toHaveBeenCalledTimes(1);
    render(<RemoteImage image={{ ...image, source: "/tmp/other.png", name: "other.png" }} client={client} backend={backend} />);
    await screen.findByRole("img", { name: "other.png" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("新网关网络失败不能误判为旧网关并读取原图", async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/host")) return { ok: true, json: async () => ({ imagePreview: true }) };
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetcher);
    const request = vi.fn();
    render(<RemoteImage image={image} client={{ request } as never} backend={backend} />);
    await screen.findByText("无法读取 screenshot.png");
    expect(request).not.toHaveBeenCalled();
  });

  it("新网关图片404不回退读取原图，旧网关不存在接口时正常回退", async () => {
    const fetcher = vi.fn().mockResolvedValue(blobResponse("missing", 404));
    vi.stubGlobal("fetch", fetcher);
    const request = vi.fn().mockResolvedValue({ dataBase64: "aGVsbG8=" });
    const first = render(<RemoteImage image={{ ...image, hideIfMissing: true }} client={{ request } as never} backend={backend} />);
    await waitFor(() => expect(first.container.querySelector(".image-placeholder")).toBeNull());
    expect(request).not.toHaveBeenCalled();
    first.unmount();
    fetcher.mockResolvedValue({ ...blobResponse("missing", 404), headers: new Headers() });
    render(<RemoteImage image={image} client={{ request } as never} backend={backend} />);
    await screen.findByRole("img");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
