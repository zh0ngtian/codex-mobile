import { t } from "../i18n";

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
export interface AppReleaseNote {
  version: string;
  notes: string;
}
export interface AppRelease {
  version: string;
  tag: string;
  notes: string;
  pageUrl: string;
  downloadUrl: string;
  sha256: string;
  size: number;
  releaseNotes: AppReleaseNote[];
  installUrl?: string;
  manifestUrl?: string;
  signed?: boolean;
  bundleId?: string;
  teamId?: string;
  applicationIdentifier?: string;
  profileExpiresAt?: string;
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

function parseRelease(input: unknown, apiUrl: string, packageUrl: string): AppRelease | null {
  if (!input || typeof input !== "object") return null;
  const payload = input as Record<string, unknown>;
  const versionValue = stringValue(payload.version);
  const parsed = parseSemanticVersion(versionValue);
  if (!parsed) return null;
  const version = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (stringValue(payload.tag) !== `v${version}`) return null;
  const pageUrl = stringValue(payload.pageUrl);
  const downloadUrl = stringValue(payload.downloadUrl);
  if (pageUrl !== apiUrl || downloadUrl !== packageUrl) {
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

  const notes = stringValue(payload.notes).trim() || t("本次版本未提供更新说明。");
  const releaseNotesByVersion = new Map<string, AppReleaseNote>();
  const history = Array.isArray(payload.releases)
    ? payload.releases
    : Array.isArray(payload.releaseNotes)
      ? payload.releaseNotes
      : [];
  history.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const candidate = entry as Record<string, unknown>;
    const parsedVersion = parseSemanticVersion(stringValue(candidate.version));
    const candidateNotes = stringValue(candidate.notes).trim();
    if (!parsedVersion || !candidateNotes) return;
    const candidateVersion = `${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch}`;
    if (compareSemanticVersions(candidateVersion, version) > 0) return;
    releaseNotesByVersion.set(candidateVersion, {
      version: candidateVersion,
      notes: candidateNotes,
    });
  });
  releaseNotesByVersion.set(version, { version, notes });
  const releaseNotes = [...releaseNotesByVersion.values()].sort((left, right) =>
    compareSemanticVersions(left.version, right.version),
  );

  return {
    version,
    tag: `v${version}`,
    notes,
    pageUrl,
    downloadUrl,
    sha256: sha256.toLowerCase(),
    size,
    releaseNotes,
  };
}

export function parseLanRelease(input: unknown): AppRelease | null {
  return parseRelease(input, APP_UPDATE_API_URL, APP_UPDATE_APK_URL);
}

export interface IosUpdateConfiguration {
  apiUrl: string;
  installUrl: string;
  bundleId: string;
  teamId: string;
  applicationIdentifier: string;
}

export function parseIosRelease(input: unknown, config: IosUpdateConfiguration): AppRelease | null {
  if (!input || typeof input !== "object") return null;
  const payload = input as Record<string, unknown>;
  const version = stringValue(payload.version);
  if (!parseSemanticVersion(version) || payload.signed !== true) return null;
  if (!config.bundleId || !config.teamId || !config.applicationIdentifier ||
      payload.bundleId !== config.bundleId || payload.teamId !== config.teamId ||
      payload.applicationIdentifier !== config.applicationIdentifier) return null;
  let base: string;
  try {
    const api = new URL(config.apiUrl);
    if (api.protocol !== "https:" || api.username || api.password || api.search || api.hash ||
        !api.pathname.endsWith("/current/latest-ios.json")) return null;
    base = config.apiUrl.slice(0, -"/current/latest-ios.json".length);
    if (config.installUrl !== `${base}/current/install.html`) return null;
  } catch { return null; }
  const manifestUrl = `${base}/releases/${version}/manifest.plist`;
  if (payload.manifestUrl !== manifestUrl || payload.installUrl !== config.installUrl) return null;
  const profileExpiresAt = stringValue(payload.profileExpiresAt);
  if (!Number.isFinite(Date.parse(profileExpiresAt)) || Date.parse(profileExpiresAt) <= Date.now()) return null;
  const release = parseRelease(input, config.apiUrl, `${base}/releases/${version}/latest.ipa`);
  return release ? { ...release, signed: true, installUrl: config.installUrl, manifestUrl,
    bundleId: config.bundleId, teamId: config.teamId, applicationIdentifier: config.applicationIdentifier,
    profileExpiresAt } : null;
}

export function releaseNotesForUpgrade(
  release: AppRelease,
  currentVersion: string,
) {
  if (!parseSemanticVersion(currentVersion)) return release.releaseNotes;
  return release.releaseNotes.filter(
    (entry) => compareSemanticVersions(entry.version, currentVersion) > 0,
  );
}

interface ReleaseCheckerOptions {
  fetchRelease: () => Promise<unknown>;
  storage: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  cacheMs?: number;
  parser?: (input: unknown) => AppRelease | null;
  cacheKey?: string;
  invalidReleaseMessage?: string;
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
  parser = parseLanRelease,
  cacheKey = APP_UPDATE_CACHE_KEY,
  invalidReleaseMessage = t("内网更新源没有可验证的 Android APK"),
}: ReleaseCheckerOptions) {
  const readCache = () => {
    try {
      const cached = JSON.parse(
        storage.getItem(cacheKey) || "null",
      ) as CachedRelease | null;
      if (
        cached &&
        Number.isFinite(cached.checkedAt) &&
        now() - cached.checkedAt >= 0 &&
        now() - cached.checkedAt < cacheMs
      ) {
        return parser(cached.release);
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
      const release = parser(await fetchRelease());
      if (!release) {
        throw new Error(invalidReleaseMessage);
      }
      storage.setItem(
        cacheKey,
        JSON.stringify({ checkedAt: now(), release } satisfies CachedRelease),
      );
      return release;
    },
  };
}
