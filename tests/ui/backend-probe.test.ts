import { afterEach, describe, expect, it, vi } from "vitest";
import { probeBackend } from "../../src/backends/probe";
import type { BackendConfig } from "../../src/backends/types";

const backend: BackendConfig = {
  id: "mini",
  name: "Mac mini",
  baseUrl: "http://192.168.100.8:4173",
  token: "a b",
  enabled: true,
  order: 0,
};

describe("设备网关探测", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("流式探测完成 initialize 和只读 RPC 后关闭探测连接", async () => {
    const sent: any[] = [];
    let instance: ProbeSocket;
    class ProbeSocket extends EventTarget {
      static OPEN = 1;
      readyState = 0;
      closed = false;
      url: string;
      constructor(url: string) {
        super(); this.url = url; instance = this;
        queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
      }
      send(raw: string) {
        const message = JSON.parse(raw); sent.push(message);
        if (message.id != null) queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: message.id, result: {} }) })));
      }
      close() { this.closed = true; this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    vi.stubGlobal("WebSocket", ProbeSocket);
    const fetchHost = vi.fn(async () => new Response(JSON.stringify({ hostId: "mini", displayName: "Mac mini", appServerReady: true })));
    await probeBackend({ ...backend, transportMode: "stream" }, { fetchHost });
    expect(instance!.url).toBe("ws://192.168.100.8:4173/ws?token=a+b");
    expect(sent.map((message) => message.method)).toEqual(["initialize", "initialized", "thread/loaded/list"]);
    expect(instance!.closed).toBe(true);
  });

  it("流式连接无响应时超时并关闭探测连接", async () => {
    let closed = false;
    class SilentSocket extends EventTarget { close() { closed = true; } }
    vi.stubGlobal("WebSocket", SilentSocket);
    const fetchHost = vi.fn(async () => new Response(JSON.stringify({ hostId: "mini", displayName: "Mac mini", appServerReady: true })));
    await expect(probeBackend({ ...backend, transportMode: "stream" }, { fetchHost, timeoutMs: 10 })).rejects.toThrow("WebSocket initialize 超时");
    expect(closed).toBe(true);
  });

  it("流式探测使用 WebSocket，不依赖 HTTP 轮询能力", async () => {
    const fetchHost = vi.fn(async () => new Response(JSON.stringify({ hostId: "mini", displayName: "Mac mini", appServerReady: true })));
    const initializeHttp = vi.fn(async () => undefined);
    const initializeStream = vi.fn(async () => undefined);
    const config = { ...backend, transportMode: "stream" as const };
    await expect(probeBackend(config, { fetchHost, initializeHttp, initializeStream })).resolves.toMatchObject({ hostId: "mini" });
    expect(initializeStream).toHaveBeenCalledWith(config);
    expect(initializeHttp).not.toHaveBeenCalled();
  });

  it("默认 HTTP 仍要求轮询能力", async () => {
    const fetchHost = vi.fn(async () => new Response(JSON.stringify({ hostId: "mini", displayName: "Mac mini", appServerReady: true })));
    await expect(probeBackend(backend, { fetchHost })).rejects.toThrow("需要升级以支持 HTTP 同步");
  });

  it("验证控制面后再完成一次 HTTP initialize", async () => {
    const fetchHost = vi.fn(async () =>
      new Response(
        JSON.stringify({
          hostId: "mini",
          displayName: "Mac mini",
          hostname: "mac-mini.local",
          gatewayVersion: "0.2.0",
          appServerReady: true,
          httpPolling: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const initializeHttp = vi.fn(async () => undefined);

    await expect(
      probeBackend(backend, { fetchHost, initializeHttp }),
    ).resolves.toMatchObject({
      hostId: "mini",
      appServerReady: true,
    });
    expect(fetchHost).toHaveBeenCalledWith(
      "http://192.168.100.8:4173/api/host?token=a+b",
      expect.objectContaining({ method: "GET" }),
    );
    expect(initializeHttp).toHaveBeenCalledWith(backend);
  });

  it("app-server 未就绪时不尝试建立业务连接", async () => {
    const fetchHost = vi.fn(async () =>
      new Response(
        JSON.stringify({
          hostId: "mini",
          displayName: "Mac mini",
          hostname: "mac-mini.local",
          gatewayVersion: "0.2.0",
          appServerReady: false,
        }),
        { status: 200 },
      ),
    );
    const initializeHttp = vi.fn(async () => undefined);

    await expect(
      probeBackend(backend, { fetchHost, initializeHttp }),
    ).rejects.toThrow("app-server 尚未就绪");
    expect(initializeHttp).not.toHaveBeenCalled();
  });

  it("HTTP initialize 无响应也会超时", async () => {
    const fetchHost = vi.fn(async () =>
      new Response(
        JSON.stringify({
          hostId: "mini",
          displayName: "Mac mini",
          hostname: "mac-mini.local",
          gatewayVersion: "0.2.0",
          appServerReady: true,
          httpPolling: true,
        }),
        { status: 200 },
      ),
    );

    await expect(
      probeBackend(backend, {
        timeoutMs: 10,
        fetchHost,
        initializeHttp: () => new Promise<void>(() => undefined),
      }),
    ).rejects.toThrow("initialize 超时");
  });
});
