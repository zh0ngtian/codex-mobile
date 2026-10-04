import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as audio from "../../src/audio/realtime-audio";
import { useRealtimeConversation } from "../../src/features/conversation/useRealtimeConversation";

afterEach(() => vi.restoreAllMocks());

function setup(failCapture = false) {
  vi.spyOn(audio, "hasNativeRealtimeAudioBridge").mockReturnValue(true);
  vi.spyOn(audio, "createRealtimeAudioCapture").mockReturnValue({ open: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockImplementation(() => { if (failCapture) throw new Error("microphone failed"); }), close: vi.fn(), setMuted: vi.fn() } as never);
  vi.spyOn(audio.RealtimeAudioPlayback.prototype, "unlock").mockResolvedValue(undefined);
  vi.spyOn(audio.RealtimeAudioPlayback.prototype, "close").mockImplementation(() => {});
  let notify!: (message: any) => void;
  const client = { request: vi.fn().mockResolvedValue({}), openRealtime: vi.fn().mockResolvedValue(undefined), closeRealtime: vi.fn(), onNotification: vi.fn((handler) => { notify = handler; return () => {}; }) };
  const hook = renderHook(() => useRealtimeConversation({ client: client as never, threadId: "thread", connectionOnline: true }));
  return { ...hook, client, notify: (method: string) => act(() => notify({ method, params: { threadId: "thread" } })) };
}

describe("按需语音通道收尾", () => {
  it("上游自然结束关闭专用连接", async () => {
    const hook = setup();
    await act(() => hook.result.current.start());
    hook.notify("thread/realtime/closed");
    expect(hook.client.closeRealtime).toHaveBeenCalled();
    hook.unmount();
  });

  it("麦克风启动失败停止上游并关闭连接", async () => {
    const hook = setup(true);
    await act(() => hook.result.current.start());
    hook.notify("thread/realtime/started");
    await waitFor(() => expect(hook.client.request).toHaveBeenCalledWith("thread/realtime/stop", { threadId: "thread" }));
    expect(hook.client.closeRealtime).toHaveBeenCalled();
    hook.unmount();
  });

  it("离开活跃语音页面停止上游并关闭连接", async () => {
    const hook = setup();
    await act(() => hook.result.current.start());
    hook.unmount();
    await waitFor(() => expect(hook.client.closeRealtime).toHaveBeenCalled());
    expect(hook.client.request).toHaveBeenCalledWith("thread/realtime/stop", { threadId: "thread" });
  });
});
