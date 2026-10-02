export interface AndroidCompletionNotificationBridge {
  requestCompletionNotificationPermission?: () => void;
  showCompletionNotification?: (
    title: string,
    body: string,
    backendId: string,
    threadId: string,
  ) => void;
  consumeCompletionNotificationTarget?: () => string;
}

interface IosCompletionNotificationBridge {
  postMessage(message: Record<string, string>): void;
}

interface BrowserNotificationInstance {
  onclick: (() => void) | null;
  close(): void;
}

interface BrowserNotificationConstructor {
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  new (
    title: string,
    options?: NotificationOptions,
  ): BrowserNotificationInstance;
}

export interface CompletionNotificationScope {
  JsBridge?: AndroidCompletionNotificationBridge;
  Notification?: BrowserNotificationConstructor;
  __codexMobileCompletionTarget?: unknown;
  focus?: () => void;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
  dispatchEvent?: (event: Event) => boolean;
  webkit?: {
    messageHandlers?: {
      completionNotification?: IosCompletionNotificationBridge;
    };
  };
}

export interface RunCompletionNotification {
  title: string;
  body: string;
  backendId: string;
  threadId: string;
}

export interface RunCompletionNavigationTarget {
  backendId: string;
  threadId: string;
}

export const RUN_COMPLETION_OPEN_EVENT = "codex-mobile-open-thread";

interface CompletionThread {
  id?: unknown;
  name?: unknown;
  preview?: unknown;
}

function currentScope(): CompletionNotificationScope {
  return window as unknown as CompletionNotificationScope;
}

function completionNavigationTarget(
  value: unknown,
): RunCompletionNavigationTarget | null {
  let parsed = value;
  if (typeof parsed === "string") {
    if (!parsed.trim()) return null;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const target = parsed as Record<string, unknown>;
  const backendId =
    typeof target.backendId === "string" ? target.backendId.trim() : "";
  const threadId =
    typeof target.threadId === "string" ? target.threadId.trim() : "";
  return backendId && threadId ? { backendId, threadId } : null;
}

function dispatchRunCompletionNavigation(
  target: RunCompletionNavigationTarget,
  scope: CompletionNotificationScope,
) {
  scope.dispatchEvent?.(
    new CustomEvent(RUN_COMPLETION_OPEN_EVENT, { detail: target }),
  );
}

export function bindRunCompletionNavigation(
  onNavigate: (target: RunCompletionNavigationTarget) => void,
  scope: CompletionNotificationScope = currentScope(),
) {
  const handleNavigation = (event: Event) => {
    const target = completionNavigationTarget(
      (event as CustomEvent<unknown>).detail,
    );
    if (target) {
      scope.__codexMobileCompletionTarget = undefined;
      onNavigate(target);
    }
  };
  scope.addEventListener?.(RUN_COMPLETION_OPEN_EVENT, handleNavigation);

  try {
    const pending =
      completionNavigationTarget(scope.__codexMobileCompletionTarget) ??
      completionNavigationTarget(
        scope.JsBridge?.consumeCompletionNotificationTarget?.(),
      );
    scope.__codexMobileCompletionTarget = undefined;
    if (pending) onNavigate(pending);
  } catch {
    // Native notification navigation is optional.
  }

  return () => {
    scope.removeEventListener?.(RUN_COMPLETION_OPEN_EVENT, handleNavigation);
  };
}

export function completionThreadTitle({
  threadId,
  threads,
  activeThread,
  fallback,
}: {
  threadId: string;
  threads: CompletionThread[];
  activeThread?: CompletionThread | null;
  fallback: string;
}) {
  const thread =
    threads.find((entry) => String(entry.id ?? "") === threadId) ??
    (String(activeThread?.id ?? "") === threadId ? activeThread : null);
  const title = thread?.name || thread?.preview;
  return typeof title === "string" && title.trim() ? title.trim() : fallback;
}

export function shouldNotifyRunCompleted({
  threadId,
  activeThreadId,
  conversationVisible,
  documentVisible,
}: {
  threadId: string;
  activeThreadId: string;
  conversationVisible: boolean;
  documentVisible: boolean;
}) {
  return Boolean(threadId) && (
    threadId !== activeThreadId ||
    !conversationVisible ||
    !documentVisible
  );
}

export function requestRunCompletionNotificationPermission(
  scope: CompletionNotificationScope = currentScope(),
) {
  const android = scope.JsBridge;
  if (typeof android?.requestCompletionNotificationPermission === "function") {
    try {
      android.requestCompletionNotificationPermission();
    } catch {
      // Native notification support is optional.
    }
    return;
  }

  const ios = scope.webkit?.messageHandlers?.completionNotification;
  if (ios) {
    try {
      ios.postMessage({ action: "request" });
    } catch {
      // Native notification support is optional.
    }
    return;
  }

  const BrowserNotification = scope.Notification;
  if (!BrowserNotification || BrowserNotification.permission !== "default") {
    return;
  }
  try {
    void BrowserNotification.requestPermission().catch(() => undefined);
  } catch {
    // Some browsers expose the API but reject permission requests.
  }
}

export function notifyRunCompleted(
  notification: RunCompletionNotification,
  scope: CompletionNotificationScope = currentScope(),
) {
  const android = scope.JsBridge;
  if (typeof android?.showCompletionNotification === "function") {
    try {
      android.showCompletionNotification(
        notification.title,
        notification.body,
        notification.backendId,
        notification.threadId,
      );
    } catch {
      // Native notification support is optional.
    }
    return;
  }

  const ios = scope.webkit?.messageHandlers?.completionNotification;
  if (ios) {
    try {
      ios.postMessage({ action: "show", ...notification });
    } catch {
      // Native notification support is optional.
    }
    return;
  }

  const BrowserNotification = scope.Notification;
  if (!BrowserNotification || BrowserNotification.permission !== "granted") {
    return;
  }
  try {
    const browserNotification = new BrowserNotification(notification.title, {
      body: notification.body,
      tag: `codex-run-${notification.threadId}`,
    });
    browserNotification.onclick = () => {
      scope.focus?.();
      dispatchRunCompletionNavigation(notification, scope);
      browserNotification.close();
    };
  } catch {
    // Notification construction can still fail in an unsupported context.
  }
}
