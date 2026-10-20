import { isClientForeground } from "../../native-ui/foreground";
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
  manualCheckSupported: boolean;
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
  return import.meta.env.VITE_APP_VERSION?.trim().replace(/^v/, "") || "0.3.0";
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
  // iOS 仅从原生桥读取已安装版本，应用内更新只对 Android 开放。
  const supported = bridge !== null && iosBridge === null;
  const [currentVersion] = useState(() => bridgeVersion(bridge ?? iosBridge));
  const [storage] = useState(() => options.storage ?? window.localStorage);
  const [fetchRelease] = useState(
    () => options.fetchRelease ?? (() => fetchLatestRelease()),
  );
  const checker = useMemo(
    () =>
      createReleaseChecker({
        fetchRelease,
        storage,
      }),
    [fetchRelease, storage],
  );
  const [state, setState] = useState<AppUpdateState>({
    phase: "idle",
    currentVersion,
  });
  const [sheetOpen, setSheetOpenState] = useState(false);
  const setSheetOpen = useCallback((open: boolean) => {
    if (iosBridge && open) return;
    setSheetOpenState(open);
  }, [iosBridge]);
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
    [checker, currentVersion, supported, setSheetOpen],
  );

  useEffect(() => {
    if (!supported) return;
    void check(false);
  }, [check, supported]);

  useEffect(() => {
    if (!supported) return;
    const onVisible = () => {
      if (isClientForeground()) void check(false);
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
  }, [supported, setSheetOpen]);

  const install = useCallback(() => {
    if (!supported || !state.release) return;
    try {
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
  }, [bridge, supported, state.release, setSheetOpen]);

  return {
    supported,
    manualCheckSupported: supported,
    state,
    sheetOpen,
    setSheetOpen,
    check,
    install,
  };
}
