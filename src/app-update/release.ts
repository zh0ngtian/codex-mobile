export const APP_UPDATE_API_URL =
  "http://192.168.123.79:8765/channels/codex-mobile/latest.json";
export const APP_UPDATE_APK_URL =
  "http://192.168.123.79:8765/channels/codex-mobile/latest.apk";
export const APP_UPDATE_CACHE_KEY = "codex-mobile:app-update:last-lan-release";

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}
export interface AppRelease {
  version: string;
  tag: string;
  notes: string;
  pageUrl: string;
  downloadUrl: string;
  sha256: string;
  size: number;
}

export function parseSemanticVersion(input: string): SemanticVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(input.trim());
  if (!match) return null;
  const version = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
  return Object.values(version).every(Number.isSafeInteger) ? version : null;
}

function requireSemanticVersion(input: string) {
  const version = parseSemanticVersion(input);
  if (!version) throw new Error(t("无效版本号：{version}", { version: input }));
  return version;
}

export function compareSemanticVersions(left: string, right: string) {
  const a = requireSemanticVersion(left);
  const b = requireSemanticVersion(right);
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function nextPatchVersion(latestTag: string, fallbackVersion: string) {
  const current =
    parseSemanticVersion(latestTag) ?? requireSemanticVersion(fallbackVersion);
  return `${current.major}.${current.minor}.${current.patch + 1}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function parseLanRelease(input: unknown): AppRelease | null {
  if (!input || typeof input !== "object") return null;
  const payload = input as Record<string, unknown>;
  const versionValue = stringValue(payload.version);
  const parsed = parseSemanticVersion(versionValue);
  if (!parsed) return null;
  const version = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (stringValue(payload.tag) !== `v${version}`) return null;
  const pageUrl = stringValue(payload.pageUrl);
  const downloadUrl = stringValue(payload.downloadUrl);
  if (pageUrl !== APP_UPDATE_API_URL || downloadUrl !== APP_UPDATE_APK_URL) {
    return null;
  }
  const sha256 = stringValue(payload.sha256);
  if (!/^[a-f0-9]{64}$/i.test(sha256)) return null;
  const size = payload.size;
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0
  ) return null;

  return {
    version,
    tag: `v${version}`,
    notes: stringValue(payload.notes).trim() || t("本次版本未提供更新说明。"),
    pageUrl,
    downloadUrl,
    sha256: sha256.toLowerCase(),
    size,
  };
}

interface ReleaseCheckerOptions {
  fetchRelease: () => Promise<unknown>;
  storage: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  cacheMs?: number;
}

interface CachedRelease {
  checkedAt: number;
  release: AppRelease;
}

export function createReleaseChecker({
  fetchRelease,
  storage,
  now = Date.now,
  cacheMs = 6 * 60 * 60 * 1_000,
}: ReleaseCheckerOptions) {
  const readCache = () => {
    try {
      const cached = JSON.parse(
        storage.getItem(APP_UPDATE_CACHE_KEY) || "null",
      ) as CachedRelease | null;
      if (
        cached &&
        Number.isFinite(cached.checkedAt) &&
        now() - cached.checkedAt >= 0 &&
        now() - cached.checkedAt < cacheMs
      ) {
        return parseLanRelease(cached.release);
      }
    } catch {
      // Invalid local data is treated as a cache miss.
    }
    return null;
  };

  return {
    async check(force = false) {
      if (!force) {
        const cached = readCache();
        if (cached) return cached;
      }
      const release = parseLanRelease(await fetchRelease());
      if (!release) {
        throw new Error(t("内网更新源没有可验证的 Android APK"));
      }
      storage.setItem(
        APP_UPDATE_CACHE_KEY,
        JSON.stringify({ checkedAt: now(), release } satisfies CachedRelease),
      );
      return release;
    },
  };
}
import { t } from "../i18n";
