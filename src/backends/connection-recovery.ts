import type { AppServerClient } from "../app-server/client";

interface VisibilityTarget extends EventTarget {
  visibilityState: DocumentVisibilityState;
}

interface ConnectionRecoveryOptions {
  documentTarget?: VisibilityTarget;
  windowTarget?: EventTarget;
  shouldRecover?: () => boolean;
  cooldownMs?: number;
  reconnect: () => void | Promise<void>;
}

interface ReadOnlyThreadRefreshOptions {
  documentTarget?: VisibilityTarget;
  refresh: (isCurrent: () => boolean) => void | Promise<void>;
  intervalMs?: number;
}

export function bindReadOnlyThreadRefresh({
  documentTarget = document,
  refresh,
  intervalMs = 3_000,
}: ReadOnlyThreadRefreshOptions) {
  let disposed = false;
  let refreshInFlight = false;
  const requestRefresh = () => {
    if (
      disposed ||
      refreshInFlight ||
      documentTarget.visibilityState !== "visible"
    ) return;
    refreshInFlight = true;
    const result = refresh(
      () => !disposed && documentTarget.visibilityState === "visible",
    );
    if (result && typeof result.then === "function") {
      void result
        .catch(() => undefined)
        .finally(() => {
          refreshInFlight = false;
        });
    } else {
      refreshInFlight = false;
    }
  };
  const onVisibilityChange = () => requestRefresh();
  const timer = globalThis.setInterval(requestRefresh, intervalMs);

  documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  requestRefresh();

  return () => {
    disposed = true;
    globalThis.clearInterval(timer);
    documentTarget.removeEventListener(
      "visibilitychange",
      onVisibilityChange,
    );
  };
}

export async function reconnectAndWaitUntilReady(
  reconnect: () => void,
  isReady: () => boolean,
  wait: () => Promise<void> = () =>
    new Promise((resolve) => globalThis.setTimeout(resolve, 100)),
  maxChecks = 100,
) {
  reconnect();
  for (let check = 0; check < maxChecks && !isReady(); check += 1) {
    await wait();
  }
}

export async function recoverBackendConnection(
  client: AppServerClient | null,
  reconnect: () => void | Promise<void>,
  reconcile: (client: AppServerClient) => void | Promise<void> = () =>
    undefined,
) {
  if (!client) {
    await reconnect();
    return;
  }
  try {
    await client.request(
      "thread/loaded/list",
      { limit: 1 },
      { timeoutMs: 2_500 },
    );
  } catch {
    await reconnect();
    return;
  }
  try {
    await reconcile(client);
  } catch {
    // A snapshot failure does not prove that the transport is unhealthy.
    // Keep the live connection and let the next foreground/manual refresh retry.
  }
}

export async function reconcileBackendWorkspace(
  client: AppServerClient,
  refreshActive: (client: AppServerClient) => void | Promise<void>,
) {
  await refreshActive(client);
}

export function bindConnectionRecovery({
  documentTarget = document,
  windowTarget = window,
  shouldRecover = () => true,
  cooldownMs = 3_000,
  reconnect,
}: ConnectionRecoveryOptions) {
  let wasHidden = documentTarget.visibilityState === "hidden";
  let recoveryPromise: Promise<void> | null = null;
  let lastRecoveryAt = Number.NEGATIVE_INFINITY;

  const requestRecovery = () => {
    const now = Date.now();
    if (
      !shouldRecover() ||
      recoveryPromise ||
      now - lastRecoveryAt < cooldownMs
    ) return;
    lastRecoveryAt = now;
    recoveryPromise = Promise.resolve(reconnect()).finally(() => {
      recoveryPromise = null;
    });
  };
  const onVisibilityChange = () => {
    if (documentTarget.visibilityState === "hidden") {
      wasHidden = true;
      return;
    }
    if (!wasHidden) return;
    wasHidden = false;
    requestRecovery();
  };
  const onPageShow = (event: Event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    requestRecovery();
  };
  const onOnline = () => requestRecovery();

  documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  windowTarget.addEventListener("pageshow", onPageShow);
  windowTarget.addEventListener("online", onOnline);

  return () => {
    documentTarget.removeEventListener(
      "visibilitychange",
      onVisibilityChange,
    );
    windowTarget.removeEventListener("pageshow", onPageShow);
    windowTarget.removeEventListener("online", onOnline);
  };
}
