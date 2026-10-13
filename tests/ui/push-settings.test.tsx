import { writeThreadPinned } from "../../src/features/threads/thread-pinning";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppBootstrap } from "../../src/App";
import { notifyRunCompleted } from "../../src/notifications/run-completion";
import { readNotificationPreference, syncNotificationSettings, writeNotificationPreference, useNotificationSync } from "../../src/notifications/preferences";

describe("推送方式设置", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const empty = { version: 1 as const, selectedBackendId: "", backends: [] };

  it("默认系统推送并说明延迟与漏推送", () => {
    render(<AppBootstrap initialRegistry={empty} />);
    expect(screen.getByRole("radio", { name: "系统推送" })).toBeChecked();
    expect(screen.getByText("系统推送会有延迟，并且可能会漏推送。" )).toBeInTheDocument();
    expect(screen.queryByLabelText("Bark 推送链接")).not.toBeInTheDocument();
  });

  it("错误链接不保存，合法链接保存后在冷启动恢复", async () => {
    const view = render(<AppBootstrap initialRegistry={empty} />);
    fireEvent.click(screen.getByRole("radio", { name: "Bark 推送" }));
    const input = screen.getByLabelText("Bark 推送链接");
    fireEvent.change(input, { target: { value: "https://api.day.app/" } });
    fireEvent.click(screen.getByRole("button", { name: "保存推送设置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Bark/);
    expect(readNotificationPreference(window.localStorage).mode).toBe("system");
    fireEvent.change(input, { target: { value: " https://api.day.app/DeviceKey123/ " } });
    fireEvent.click(screen.getByRole("button", { name: "保存推送设置" }));
    await waitFor(() => expect(readNotificationPreference(window.localStorage)).toEqual({ mode: "bark", barkUrl: "https://api.day.app/DeviceKey123" }));
    view.unmount();
    render(<AppBootstrap initialRegistry={empty} />);
    expect(screen.getByRole("radio", { name: "Bark 推送" })).toBeChecked();
    expect(screen.getByLabelText("Bark 推送链接")).toHaveValue("https://api.day.app/DeviceKey123");
    fireEvent.click(screen.getByRole("radio", { name: "系统推送" }));
    fireEvent.click(screen.getByRole("button", { name: "保存推送设置" }));
    await waitFor(() => expect(readNotificationPreference(window.localStorage).mode).toBe("system"));
  });

  it("Bark 生效时不再发送本地系统完成通知", () => {
    writeNotificationPreference(window.localStorage, { mode: "bark", barkUrl: "https://api.day.app/DeviceKey123" });
    const show = vi.fn();
    notifyRunCompleted({ title: "完成", body: "会话", backendId: "mini", threadId: "thread" }, { JsBridge: { showCompletionNotification: show } });
    expect(show).not.toHaveBeenCalled();
    writeNotificationPreference(window.localStorage, { mode: "system", barkUrl: "" });
    notifyRunCompleted({ title: "完成", body: "会话", backendId: "mini", threadId: "thread" }, { JsBridge: { showCompletionNotification: show } });
    expect(show).toHaveBeenCalledOnce();
  });

  it("同步启用设备并在设备删除或切回系统时注销原网关", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetcher = vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init!.body as string) });
      return new Response(JSON.stringify({ saved: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const device = { id: "mini", name: "Mac mini", baseUrl: "http://host.local:18766", token: "secret", enabled: true, order: 0 };
    const bark = { mode: "bark" as const, barkUrl: "https://api.day.app/DeviceKey123" };
    expect(await syncNotificationSettings([device], bark, window.localStorage, fetcher)).toEqual([]);
    expect(calls[0].url).toContain("/api/notifications/settings?token=secret");
    expect(calls[0].body).toMatchObject({ mode: "bark", barkUrl: bark.barkUrl, backendId: "mini" });
    expect(calls[0].body.clientId).toMatch(/^[\da-f-]{36}$/i);
    await syncNotificationSettings([], bark, window.localStorage, fetcher);
    expect(calls[1].body.mode).toBe("system");
    await syncNotificationSettings([device], bark, window.localStorage, fetcher);
    await syncNotificationSettings([device], { mode: "system", barkUrl: "" }, window.localStorage, fetcher);
    expect(calls[3].body.mode).toBe("system");
    expect(calls.every((call) => call.body.clientId === calls[0].body.clientId)).toBe(true);
  });

  it("按设备同步本地关注集合，取消关注同步空集合", async () => {
    const first = { id: "mini", name: "Mac mini", baseUrl: "http://host.local:18766", token: "", enabled: true, order: 0 };
    const second = { ...first, id: "book", name: "MacBook", baseUrl: "http://book.local:18766" };
    const bark = { mode: "bark" as const, barkUrl: "https://api.day.app/DeviceKey123" };
    writeThreadPinned(window.localStorage, "mini", "desktop-thread", true);
    const calls: any[] = [];
    const fetcher = vi.fn(async (_url, init) => {
      calls.push(JSON.parse(init!.body as string));
      return new Response(JSON.stringify({ saved: true }), { status: 200 });
    }) as unknown as typeof fetch;
    await syncNotificationSettings([first, second], bark, window.localStorage, fetcher);
    expect(calls.find(call => call.backendId === "mini").followedThreadIds).toEqual(["desktop-thread"]);
    expect(calls.find(call => call.backendId === "book").followedThreadIds).toEqual([]);
    writeThreadPinned(window.localStorage, "mini", "desktop-thread", false);
    await syncNotificationSettings([first], bark, window.localStorage, fetcher);
    expect(calls.at(-1).followedThreadIds).toEqual([]);
  });

  it("关注变化立即触发订阅同步，卸载后不再同步", async () => {
    const devices = [{ id: "mini", name: "Mac mini", baseUrl: "http://host.local:18766", token: "", enabled: true, order: 0 }];
    const preference = { mode: "bark" as const, barkUrl: "https://api.day.app/DeviceKey123" };
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init!.body as string));
      return new Response(JSON.stringify({ saved: true }), { status: 200 });
    }));
    function Subscription() { useNotificationSync(devices, preference); return null; }
    const view = render(<Subscription />);
    await waitFor(() => expect(bodies).toHaveLength(1));
    writeThreadPinned(window.localStorage, "mini", "desktop-thread", true);
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].followedThreadIds).toEqual(["desktop-thread"]);
    view.unmount();
    writeThreadPinned(window.localStorage, "mini", "desktop-thread", false);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(bodies).toHaveLength(2);
  });

  it("网关拒绝或不支持时返回设备名称并保留注册以便重试", async () => {
    const device = { id: "mini", name: "Mac mini", baseUrl: "http://host.local:18766", token: "secret", enabled: true, order: 0 };
    const bark = { mode: "bark" as const, barkUrl: "https://api.day.app/DeviceKey123" };
    const failed = vi.fn(async () => new Response("Not found", { status: 404 })) as unknown as typeof fetch;
    expect(await syncNotificationSettings([device], bark, window.localStorage, failed)).toEqual(["Mac mini"]);
    const successful = vi.fn(async () => new Response(JSON.stringify({ saved: true }), { status: 200 })) as unknown as typeof fetch;
    expect(await syncNotificationSettings([], { mode: "system", barkUrl: "" }, window.localStorage, successful)).toEqual([]);
    expect(successful).toHaveBeenCalledOnce();
  });

  it("删除最后设备后的冷启动仍会重试注销历史网关", async () => {
    const device = { id: "mini", name: "Mac mini", baseUrl: "http://host.local:18766", token: "secret", enabled: true, order: 0 };
    const bark = { mode: "bark" as const, barkUrl: "https://api.day.app/DeviceKey123" };
    const failed = vi.fn(async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
    await syncNotificationSettings([device], bark, window.localStorage, failed);
    writeNotificationPreference(window.localStorage, bark);
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ saved: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<AppBootstrap initialRegistry={empty} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({ backendId: "mini", mode: "system" });
  });
});
