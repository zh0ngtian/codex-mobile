import { describe, expect, it, vi } from "vitest";
import {
  bindRunCompletionNavigation,
  parseCompletionDeepLink,
  completionThreadTitle,
  notifyRunCompleted,
  requestRunCompletionNotificationPermission,
  shouldNotifyFinalAnswer,
  shouldNotifyRunCompleted,
  type CompletionNotificationScope,
} from "../../src/notifications/run-completion";

describe("运行完成通知", () => {
  it("页面监听就绪后才允许原生入口派发，卸载时撤销就绪标记", () => {
    const scope: CompletionNotificationScope = {};
    const unbind = bindRunCompletionNavigation(() => {}, scope);
    expect(scope.__codexMobileCompletionNavigationReady).toBe(true);
    unbind();
    expect(scope.__codexMobileCompletionNavigationReady).toBe(false);
  });
  it("深链接指定机器和会话，并拒绝其他协议、重复参数和空目标", () => {
    expect(parseCompletionDeepLink("codexmobile://thread?backendId=mini&threadId=thread%2F1")).toEqual({ backendId: "mini", threadId: "thread/1" });
    for (const invalid of ["https://thread?backendId=mini&threadId=t", "codexmobile://other?backendId=mini&threadId=t", "codexmobile://thread?backendId=mini", "codexmobile://thread?backendId=a&backendId=b&threadId=t", "codexmobile://thread?backendId=mini&threadId=", "codexmobile://thread/other?backendId=mini&threadId=t"]) {
      expect(parseCompletionDeepLink(invalid)).toBeNull();
    }
  });
  it("使用完成运行所属会话的标题作为通知内容", () => {
    expect(
      completionThreadTitle({
        threadId: "thread-2",
        threads: [
          { id: "thread-1", name: "当前会话" },
          { id: "thread-2", name: "修复 Android 通知" },
        ],
        activeThread: { id: "thread-1", name: "当前会话" },
        fallback: "新对话",
      }),
    ).toBe("修复 Android 通知");
  });

  it("只在当前会话不可见或其他会话完成时提醒", () => {
    expect(
      shouldNotifyRunCompleted({
        threadId: "thread-1",
        activeThreadId: "thread-1",
        conversationVisible: true,
        documentVisible: true,
      }),
    ).toBe(false);
    expect(
      shouldNotifyRunCompleted({
        threadId: "thread-1",
        activeThreadId: "thread-1",
        conversationVisible: true,
        documentVisible: false,
      }),
    ).toBe(true);
    expect(
      shouldNotifyRunCompleted({
        threadId: "thread-2",
        activeThreadId: "thread-1",
        conversationVisible: true,
        documentVisible: true,
      }),
    ).toBe(true);
  });

  it("只有实时完成的 final answer 才提醒", () => {
    const base = {
      threadId: "thread-2",
      activeThreadId: "thread-1",
      conversationVisible: true,
      documentVisible: true,
      catchingUp: false,
    };

    expect(
      shouldNotifyFinalAnswer({
        ...base,
        item: {
          id: "final",
          type: "agentMessage",
          phase: "final_answer",
          text: "完成",
        },
      }),
    ).toBe(true);
    expect(
      shouldNotifyFinalAnswer({
        ...base,
        item: {
          id: "commentary",
          type: "agentMessage",
          phase: "commentary",
          text: "正在处理",
        },
      }),
    ).toBe(false);
    expect(
      shouldNotifyFinalAnswer({
        ...base,
        item: { id: "legacy", type: "agentMessage", text: "旧协议回复" },
      }),
    ).toBe(false);
    expect(
      shouldNotifyFinalAnswer({
        ...base,
        catchingUp: true,
        item: {
          id: "replayed-final",
          type: "agentMessage",
          phase: "final_answer",
          text: "历史回复",
        },
      }),
    ).toBe(false);
  });

  it("优先通过 Android 原生桥申请权限并发送通知", () => {
    const requestPermission = vi.fn();
    const showNotification = vi.fn();
    const scope = {
      JsBridge: {
        requestCompletionNotificationPermission: requestPermission,
        showCompletionNotification: showNotification,
      },
    } as CompletionNotificationScope;

    requestRunCompletionNotificationPermission(scope);
    notifyRunCompleted(
      {
        title: "Codex 运行结束",
        body: "Mac mini 上的任务已完成",
        backendId: "mini",
        threadId: "thread-1",
      },
      scope,
    );

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith(
      "Codex 运行结束",
      "Mac mini 上的任务已完成",
      "mini",
      "thread-1",
    );
  });

  it("通过 iOS 消息桥申请权限并发送通知", () => {
    const postMessage = vi.fn();
    const scope = {
      webkit: {
        messageHandlers: {
          completionNotification: { postMessage },
        },
      },
    } as CompletionNotificationScope;

    requestRunCompletionNotificationPermission(scope);
    notifyRunCompleted(
      {
        title: "完成",
        body: "任务已完成",
        backendId: "book",
        threadId: "thread-2",
      },
      scope,
    );

    expect(postMessage).toHaveBeenNthCalledWith(1, { action: "request" });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      action: "show",
      title: "完成",
      body: "任务已完成",
      backendId: "book",
      threadId: "thread-2",
    });
  });

  it("浏览器获准后发送可点击聚焦的系统通知", () => {
    const close = vi.fn();
    const focus = vi.fn();
    const created: Array<{
      title: string;
      options?: NotificationOptions;
      instance: { onclick: (() => void) | null; close: () => void };
    }> = [];
    class BrowserNotification {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as const);
      onclick: (() => void) | null = null;
      close = close;

      constructor(title: string, options?: NotificationOptions) {
        created.push({ title, options, instance: this });
      }
    }
    const scope = {
      Notification: BrowserNotification,
      focus,
    } as unknown as CompletionNotificationScope;

    notifyRunCompleted(
      {
        title: "完成",
        body: "任务已完成",
        backendId: "mini",
        threadId: "thread-3",
      },
      scope,
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      title: "完成",
      options: { body: "任务已完成", tag: "codex-run-thread-3" },
    });
    created[0].instance.onclick?.();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("浏览器通知点击后发出对应设备和会话的跳转事件", () => {
    const targets: Array<{ backendId: string; threadId: string }> = [];
    const created: Array<{ onclick: (() => void) | null }> = [];
    const scope = new EventTarget() as CompletionNotificationScope;
    Object.assign(scope, {
      focus: vi.fn(),
      Notification: class BrowserNotification {
        static permission: NotificationPermission = "granted";
        static requestPermission: () => Promise<NotificationPermission> =
          vi.fn(async (): Promise<NotificationPermission> => "granted");
        onclick: (() => void) | null = null;
        close = vi.fn();

        constructor() {
          created.push(this);
        }
      },
    });
    const unbind = bindRunCompletionNavigation(
      (target) => targets.push(target),
      scope,
    );

    notifyRunCompleted(
      {
        title: "完成",
        body: "任务已完成",
        backendId: "mini",
        threadId: "thread-5",
      },
      scope,
    );
    created[0]?.onclick?.();

    expect(targets).toEqual([{ backendId: "mini", threadId: "thread-5" }]);
    unbind();
  });

  it("启动时消费 Android 原生桥保留的通知跳转目标", () => {
    const target = vi.fn();
    const scope = Object.assign(new EventTarget(), {
      JsBridge: {
        consumeCompletionNotificationTarget: () =>
          JSON.stringify({ backendId: "mini", threadId: "thread-6" }),
      },
    }) as CompletionNotificationScope;

    const unbind = bindRunCompletionNavigation(target, scope);

    expect(target).toHaveBeenCalledWith({
      backendId: "mini",
      threadId: "thread-6",
    });
    unbind();
  });

  it("原生壳在页面监听前记录的跳转目标也会被消费", () => {
    const target = vi.fn();
    const scope = Object.assign(new EventTarget(), {
      __codexMobileCompletionTarget: {
        backendId: "book",
        threadId: "thread-7",
      },
    }) as CompletionNotificationScope;

    const unbind = bindRunCompletionNavigation(target, scope);

    expect(target).toHaveBeenCalledWith({
      backendId: "book",
      threadId: "thread-7",
    });
    expect(scope.__codexMobileCompletionTarget).toBeUndefined();
    unbind();
  });

  it("浏览器未授权时只申请权限，不提前发送通知", async () => {
    const requestPermission = vi.fn(async () => "granted" as const);
    const BrowserNotification = Object.assign(vi.fn(), {
      permission: "default" as NotificationPermission,
      requestPermission,
    });
    const scope = {
      Notification: BrowserNotification,
    } as unknown as CompletionNotificationScope;

    requestRunCompletionNotificationPermission(scope);
    notifyRunCompleted(
      {
        title: "完成",
        body: "任务已完成",
        backendId: "mini",
        threadId: "thread-4",
      },
      scope,
    );
    await Promise.resolve();

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(BrowserNotification).not.toHaveBeenCalled();
  });
});
