import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageGenerationFailure } from "../../src/features/conversation/sheets/ToolSheets";
import { TurnCard } from "../../src/features/conversation/Timeline";
import { groupTimelineEntries } from "../../src/ui/conversation";

const backend = { id: "one", name: "Mac", baseUrl: "http://localhost:18766", token: "test-token", enabled: true, order: 0 };
const item = { type: "imageGeneration", id: "image-1", status: "failed" };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("图像生成失败详情", () => {
  it("成功生成仍作为图片展示，失败生成由独立卡片展示", () => {
    expect(groupTimelineEntries([{ type: "imageGeneration", id: "ok", status: "completed", savedPath: "/tmp/generated.png" }])[0].kind).toBe("item");
    expect(groupTimelineEntries([item])[0].kind).toBe("item");
  });

  it("展示审核原因并保留技术详情", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      error: { code: "moderation_blocked", stage: "output", categories: ["sexual"], requestId: "req-image-1" },
    }) }));
    render(<ImageGenerationFailure backend={backend} threadId="thread-1" itemId={item.id} />);

    expect(await screen.findByText(/生成结果被内容审核拦截/)).toBeTruthy();
    expect(screen.getByText(/性相关内容/)).toBeTruthy();
    expect(screen.getByText(/req-image-1/)).toBeTruthy();
  });

  it("服务端没有原因时明确说明而不猜测", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: null }) }));
    render(<ImageGenerationFailure backend={backend} threadId="thread-1" itemId={item.id} />);
    await waitFor(() => expect(screen.getByText("服务端未提供具体原因")).toBeTruthy());
    expect(screen.queryByText(/性相关内容/)).toBeNull();
  });

  it("真实会话直接展示失败原因并携带会话与条目 ID 查询", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: {
      code: "moderation_blocked", stage: "output", categories: ["sexual"], requestId: "req-image-1",
    } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<TurnCard threadId="thread-1" backend={backend} client={null} turn={{
      id: "turn-1", status: "completed", items: [
        { id: "user-1", type: "userMessage", text: "修复图片" },
        item,
      ],
    }} />);
    expect(await screen.findByText(/生成结果被内容审核拦截/)).toBeTruthy();
    expect(screen.getByText(/性相关内容/)).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain("threadId=thread-1&itemId=image-1");
  });
});
