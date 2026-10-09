import { afterEach, describe, expect, it, vi } from "vitest";
import { open } from "node:fs/promises";
import { syncDirectory } from "../../server/sync-directory.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const open = vi.fn();
  return { ...actual, open, default: { ...actual, open } };
});
afterEach(() => vi.resetAllMocks());

describe("跨平台目录持久化", () => {
  it("Windows 不执行不受支持的目录 fsync", async () => {
    await syncDirectory("C:\\data", "win32");
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["darwin", "linux"] as const)("%s 保留目录 fsync 并关闭句柄", async (platform) => {
    const directory = { sync: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(open).mockResolvedValue(directory as unknown as Awaited<ReturnType<typeof open>>);
    await syncDirectory("/data", platform);
    expect(open).toHaveBeenCalledWith("/data", "r");
    expect(directory.sync).toHaveBeenCalledOnce();
    expect(directory.close).toHaveBeenCalledOnce();
  });

  it("macOS 同步失败时仍关闭句柄并向上传递错误", async () => {
    const failure = Object.assign(new Error("disk error"), { code: "EIO" });
    const directory = { sync: vi.fn().mockRejectedValue(failure), close: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(open).mockResolvedValue(directory as unknown as Awaited<ReturnType<typeof open>>);
    await expect(syncDirectory("/data", "darwin")).rejects.toBe(failure);
    expect(directory.close).toHaveBeenCalledOnce();
  });
});
