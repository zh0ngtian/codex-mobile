export interface AndroidCompletionNotificationBridge {
  requestCompletionNotificationPermission?: () => void;
  showCompletionNotification?: (
    title: string,
    body: string,
    threadId: string,
  ) => void;
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
  focus?: () => void;
  webkit?: {
    messageHandlers?: {
      completionNotification?: IosCompletionNotificationBridge;
    };
  };
}

export interface RunCompletionNotification {
  title: string;
  body: string;
  threadId: string;
}

function currentScope(): CompletionNotificationScope {
  return window as unknown as CompletionNotificationScope;
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
      browserNotification.close();
    };
  } catch {
    // Notification construction can still fail in an unsupported context.
  }
}
