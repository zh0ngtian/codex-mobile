import { describe, expect, it, vi } from "vitest";
import {
  runWorkspaceBootstrap,
  shouldResumeWorkspaceThread,
} from "../../src/backends/workspace-bootstrap";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("工作区冷启动调度", () => {
  it("额度查询未完成时会话列表和基础设置仍完成关键初始化", async () => {
    const events: string[] = [];
    const rateLimits = deferred<void>();
    const loadThreads = vi.fn(async () => {
      events.push("threads");
    });
    const loadSettings = vi.fn(async () => {
      events.push("settings");
      return { model: "gpt-test" };
    });
    const loadRateLimits = vi.fn(() => {
      events.push("rate-limits");
      return rateLimits.promise;
    });

    const result = await runWorkspaceBootstrap({
      loadThreads,
      loadSettings,
      loadRateLimits,
    });

    expect(events).toEqual(["threads", "settings", "rate-limits"]);
    expect(result).toEqual({ model: "gpt-test" });
    expect(loadThreads).toHaveBeenCalledOnce();
    expect(loadRateLimits).toHaveBeenCalledOnce();
    rateLimits.resolve();
  });

  it("额度查询失败不会让关键初始化失败", async () => {
    await expect(
      runWorkspaceBootstrap({
        loadThreads: async () => undefined,
        loadSettings: async () => "ready",
        loadRateLimits: async () => {
          throw new Error("rate limit unavailable");
        },
      }),
    ).resolves.toBe("ready");
  });

  it("初始化期间用户主动打开会话后跳过末尾重复恢复", () => {
    expect(
      shouldResumeWorkspaceThread(
        { threadId: "thread-a", openSequence: 3 },
        { threadId: "thread-a", openSequence: 3 },
      ),
    ).toBe(true);
    expect(
      shouldResumeWorkspaceThread(
        { threadId: "thread-a", openSequence: 3 },
        { threadId: "thread-a", openSequence: 4 },
      ),
    ).toBe(false);
    expect(
      shouldResumeWorkspaceThread(
        { threadId: null, openSequence: 3 },
        { threadId: "thread-a", openSequence: 4 },
      ),
    ).toBe(false);
  });
});
