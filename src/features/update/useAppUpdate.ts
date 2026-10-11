import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  APP_UPDATE_API_URL,
  compareSemanticVersions,
  parseIosRelease,
  createReleaseChecker,
  type AppRelease,
} from "../../app-update/release";
import { t } from "../../i18n";
import {
  APP_UPDATE_EVENT,
  readAndroidAppUpdateBridge,
  readIosAppUpdateBridge,
  type IosAppUpdateBridge,
  type AndroidAppUpdateBridge,
  type AppUpdateNativeEvent,
} from "../../app-update/native-bridge";

export type AppUpdatePhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "verifying"
  | "installing"
  | "error";

export interface AppUpdateState {
  phase: AppUpdatePhase;
  currentVersion: string;
  release?: AppRelease;
  progress?: number;
  error?: string;
}

export interface AppUpdateController {
  supported: boolean;
  state: AppUpdateState;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  check: (force?: boolean) => Promise<void>;
  install: () => void;
}

interface UseAppUpdateOptions {
  bridge?: AndroidAppUpdateBridge | null;
  iosBridge?: IosAppUpdateBridge | null;
  fetchRelease?: () => Promise<unknown>;
  storage?: Storage;
}

function bridgeVersion(bridge: Pick<AndroidAppUpdateBridge, "appVersion"> | null) {
  try {
    const version = bridge?.appVersion?.().trim();
    if (version) return version.replace(/^v/, "");
  } catch {
    // Older containers may expose a partial bridge.
  }
  return import.meta.env.VITE_APP_VERSION?.trim().replace(/^v/, "") || "0.2.0";
}

async function fetchLatestRelease(apiUrl = APP_UPDATE_API_URL) {
  const response = await fetch(
    apiUrl,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(t("检查更新失败（HTTP {status}）", { status: response.status }));
  }
  return response.json() as Promise<unknown>;
}

export function useAppUpdate(
  options: UseAppUpdateOptions = {},
): AppUpdateController {
  const [bridge] = useState(() =>
    options.bridge === undefined
      ? readAndroidAppUpdateBridge()
      : options.bridge,
  );
  const [iosBridge] = useState(() => options.iosBridge === undefined ? readIosAppUpdateBridge() : options.iosBridge);
  const supported = bridge !== null || iosBridge !== null;
  const [currentVersion] = useState(() => bridgeVersion(bridge ?? iosBridge));
  const [storage] = useState(() => options.storage ?? window.localStorage);
  const [fetchRelease] = useState(
    () => options.fetchRelease ?? (() => fetchLatestRelease(iosBridge?.apiUrl)),
  );
  const checker = useMemo(
    () =>
      createReleaseChecker({
        fetchRelease,
        storage,
        ...(iosBridge ? {
          parser: (input: unknown) => parseIosRelease(input, iosBridge),
          cacheKey: `codex-mobile:app-update:ios:${iosBridge.apiUrl}:${iosBridge.applicationIdentifier}`,
          invalidReleaseMessage: t("iOS 更新源未配置或签名身份不兼容"),
        } : {}),
      }),
    [fetchRelease, storage, iosBridge],
  );
  const [state, setState] = useState<AppUpdateState>({
    phase: "idle",
    currentVersion,
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const presentedVersionRef = useRef("");

  const check = useCallback(
    async (force = false) => {
      if (!supported) return;
      setState((current) => ({
        ...current,
        phase: "checking",
        currentVersion,
        error: undefined,
      }));
      try {
        if (iosBridge && (!iosBridge.apiUrl || !iosBridge.installUrl || !iosBridge.applicationIdentifier)) {
          throw new Error(t("iOS 更新源未配置或签名身份不兼容"));
        }
        const release = await checker.check(force);
        const available =
          compareSemanticVersions(release.version, currentVersion) > 0;
        setState({
          phase: available ? "available" : "current",
          currentVersion,
          release: available ? release : undefined,
        });
        if (
          available &&
          (force || presentedVersionRef.current !== release.version)
        ) {
          presentedVersionRef.current = release.version;
          setSheetOpen(true);
        }
      } catch (reason) {
        setState((current) => ({
          ...current,
          phase: "error",
          currentVersion,
          error: reason instanceof Error ? reason.message : String(reason),
        }));
      }
    },
    [checker, currentVersion, supported, iosBridge],
  );

  useEffect(() => {
    if (!supported) return;
    void check(false);
  }, [check, supported]);

  useEffect(() => {
    if (!supported) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void check(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check, supported]);

  useEffect(() => {
    if (!supported) return;
    const onNativeUpdate = (event: Event) => {
      const detail = (event as CustomEvent<AppUpdateNativeEvent>).detail;
      if (!detail?.phase) return;
      setState((current) => ({
        ...current,
        phase: detail.phase,
        progress:
          detail.phase === "downloading"
            ? Math.max(0, Math.min(100, detail.progress ?? 0))
            : current.progress,
        error: detail.phase === "error" ? detail.error : undefined,
      }));
      setSheetOpen(true);
    };
    window.addEventListener(APP_UPDATE_EVENT, onNativeUpdate);
    return () => window.removeEventListener(APP_UPDATE_EVENT, onNativeUpdate);
  }, [supported]);

  const install = useCallback(() => {
    if (!state.release) return;
    try {
      if (iosBridge && state.release.installUrl) {
        iosBridge.installOta(state.release.installUrl);
        setSheetOpen(false);
        return;
      }
      if (!bridge?.installApk) return;
      bridge.installApk(state.release.downloadUrl, state.release.sha256);
      setState((current) => ({
        ...current,
        phase: "downloading",
        progress: 0,
        error: undefined,
      }));
      setSheetOpen(true);
    } catch (reason) {
      setState((current) => ({
        ...current,
        phase: "error",
        error: reason instanceof Error ? reason.message : String(reason),
      }));
    }
  }, [bridge, iosBridge, state.release]);

  return {
    supported,
    state,
    sheetOpen,
    setSheetOpen,
    check,
    install,
  };
}
