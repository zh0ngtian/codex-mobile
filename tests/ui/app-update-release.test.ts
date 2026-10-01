import { describe, expect, it, vi } from "vitest";
import {
  APP_UPDATE_APK_URL,
  APP_UPDATE_API_URL,
  compareSemanticVersions,
  createReleaseChecker,
  nextPatchVersion,
  parseLanRelease,
  parseSemanticVersion,
} from "../../src/app-update/release";

const releasePayload = {
  version: "0.2.31",
  tag: "v0.2.31",
  notes: "固定局域网更新渠道",
  pageUrl:
    "http://192.168.123.79:8765/channels/codex-mobile/latest.json",
  downloadUrl:
    "http://192.168.123.79:8765/channels/codex-mobile/latest.apk",
  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  size: 12_345,
  publishedAt: "2026-10-02T12:00:00+08:00",
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("App 固定局域网更新模型", () => {
  it("使用不可变的局域网清单和 APK 地址", () => {
    expect(APP_UPDATE_API_URL).toBe(
      "http://192.168.123.79:8765/channels/codex-mobile/latest.json",
    );
    expect(APP_UPDATE_APK_URL).toBe(
      "http://192.168.123.79:8765/channels/codex-mobile/latest.apk",
    );
  });

  it("解析、比较语义版本并自动增加补丁版本", () => {
    expect(parseSemanticVersion("v1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    });
    expect(parseSemanticVersion("1.2")).toBeNull();
    expect(compareSemanticVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemanticVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(nextPatchVersion("v1.2.3", "0.2.0")).toBe("1.2.4");
    expect(nextPatchVersion("not-semver", "0.2.0")).toBe("0.2.1");
  });

  it("只接受固定局域网渠道、正文件大小和 SHA-256", () => {
    expect(parseLanRelease(releasePayload)).toMatchObject({
      version: "0.2.31",
      tag: "v0.2.31",
      notes: "固定局域网更新渠道",
      sha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      size: 12_345,
    });
    expect(
      parseLanRelease({
        ...releasePayload,
        downloadUrl: "http://192.168.123.80:8765/channels/codex-mobile/latest.apk",
      }),
    ).toBeNull();
    expect(
      parseLanRelease({
        ...releasePayload,
        pageUrl: "http://example.com/latest.json",
      }),
    ).toBeNull();
    expect(
      parseLanRelease({ ...releasePayload, sha256: null }),
    ).toBeNull();
    expect(parseLanRelease({ ...releasePayload, size: 0 })).toBeNull();
    expect(parseLanRelease({ ...releasePayload, tag: "v0.2.30" })).toBeNull();
  });

  it("自动检测在缓存时间内复用结果，手动检测绕过缓存", async () => {
    const fetchRelease = vi.fn(async () => releasePayload);
    const storage = memoryStorage();
    const checker = createReleaseChecker({
      fetchRelease,
      storage,
      now: () => 10_000,
      cacheMs: 60_000,
    });

    await expect(checker.check(false)).resolves.toMatchObject({
      version: "0.2.31",
    });
    await expect(checker.check(false)).resolves.toMatchObject({
      version: "0.2.31",
    });
    expect(fetchRelease).toHaveBeenCalledTimes(1);

    await checker.check(true);
    expect(fetchRelease).toHaveBeenCalledTimes(2);
  });
});
