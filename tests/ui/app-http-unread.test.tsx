import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppBootstrap } from "../../src/App";
import type { RpcMessage } from "../../src/app-server/client";
import { DESKTOP_PINNED_SECTION_ID } from "../../server/desktop-thread-pins";
import type { NativeSnapshot } from "../../src/native-ui/protocol";

const cwd = "/work/project";
const backendId = "phone-unread";
const registry = { version: 1 as const, selectedBackendId: backendId, backends: [
  { id: backendId, hostId: "mac", name: "Mac", enabled: true, order: 0, baseUrl: "https://gateway.invalid", token: "" },
] };
const threads = [
  { id: "old-thread", name: "旧会话", cwd, status: { type: "idle" }, turns: [] },
  { id: "new-thread", name: "手机发起的会话", cwd, status: { type: "idle" }, turns: [] },
];

function command(id: string, name: string, params: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent("codex-mobile-native-command", { detail: { id, name, params } }));
}

function completion(threadId: string, turnId: string): RpcMessage[] {
  return [
    { method: "item/completed", params: { threadId, turnId, item: { id: turnId, type: "agentMessage", phase: "final_answer", text: "回复完成" } } },
    { method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [] } } },
  ];
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("手机发送后切走并重建连接，回到列表时只补标新完成的会话，打开后消除圆点", async () => {
  const snapshots: NativeSnapshot[] = [];
  const events = completion("old-thread", "old-turn");
  const submissions: RpcMessage[] = [];
  const publishSystemNotification = vi.fn();
  vi.stubGlobal("__CODEX_NATIVE_UI__", true);
  vi.stubGlobal("__CODEX_NATIVE_ACTIVE__", true);
  vi.stubGlobal("webkit", { messageHandlers: { nativeUI: { postMessage() {} }, completionNotification: { postMessage: publishSystemNotification } } });
  vi.stubGlobal("codexMobilePublishNativeSnapshot", (snapshot: NativeSnapshot) => snapshots.push(snapshot));
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/api/events") {
      const after = Number(url.searchParams.get("after"));
      return Response.json({ epoch: "same-session", cursor: events.length, messages: events.slice(after), requests: [], active: false, reset: false, updatedAt: Date.now() });
    }
    if (url.pathname === "/api/projects") return Response.json({ projects: [cwd], projectlessThreadIds: [] });
    if (url.pathname !== "/api/rpc") return Response.json({ items: [] });
    const { message }: { message: RpcMessage } = JSON.parse(String(init?.body));
    if (message.method === "turn/start") submissions.push(message);
    const params = message.params as { threadId?: string; sectionId?: string; threadIds?: string[] } | undefined;
    const thread = threads.find(entry => entry.id === params?.threadId);
    const replies: Record<string, unknown> = {
      "config/read": { config: { model: "gpt-test" } },
      "model/list": { data: [{ id: "gpt-test", model: "gpt-test", isDefault: true }] },
      "permissionProfile/list": { data: [] },
      "threadSection/list": { data: [{ id: DESKTOP_PINNED_SECTION_ID }], nextCursor: null },
      "thread/list": { data: params?.sectionId ? [] : threads, nextCursor: null },
      "mobile/sidebar/summaries": { data: threads.filter(entry => params?.threadIds?.includes(entry.id)) },
      "mobile/sidebar/projectless": { data: [], nextCursor: null },
      "thread/loaded/list": { data: [], nextCursor: null },
      "thread/resume": { thread, model: "gpt-test", initialTurnsPage: { data: [], nextCursor: null } },
      "thread/read": { thread },
      "mobile/turns/details": { data: [], nextCursor: null },
      "thread/turns/list": { data: [], nextCursor: null },
      "turn/start": { turn: { id: "new-turn", status: "inProgress", items: [] } },
    };
    return Response.json({ id: message.id, result: replies[message.method ?? ""] ?? {} });
  });

  const row = (threadId: string) => snapshots.at(-1)?.groups
    .flatMap(group => group.items).find(item => item.threadId === threadId);
  const first = render(<AppBootstrap initialRegistry={registry} />);
  await waitFor(() => expect(row("new-thread")?.isUnread).toBe(false));
  expect(row("old-thread")?.isUnread).toBe(false);

  await act(async () => command("first-open", "thread.open", { backendId, threadId: "new-thread" }));
  await waitFor(() => expect(snapshots.at(-1)).toMatchObject({ threadId: "new-thread", loading: "ready" }));
  const contextId = snapshots.at(-1)!.contextId;
  await act(async () => {
    command("draft", "draft.set", { contextId, value: "请执行任务", revision: 1 });
    command("send", "message.send", { contextId });
  });
  await waitFor(() => expect(submissions).toHaveLength(1));
  await waitFor(() => expect(snapshots.at(-1)?.busy).toBe(true));

  vi.stubGlobal("__CODEX_NATIVE_ACTIVE__", false);
  document.dispatchEvent(new Event("visibilitychange"));
  first.unmount();
  events.push(...completion("new-thread", "new-turn"));

  vi.stubGlobal("__CODEX_NATIVE_ACTIVE__", true);
  render(<AppBootstrap initialRegistry={registry} />);
  await act(async () => command("return-list", "navigation.sidebar", { open: true }));
  await waitFor(() => expect(row("new-thread")?.isUnread).toBe(true));
  expect(row("old-thread")?.isUnread).toBe(false);
  expect(publishSystemNotification.mock.calls.some(([message]) => message.action === "show")).toBe(false);

  await act(async () => command("read-reply", "thread.open", { backendId, threadId: "new-thread" }));
  await waitFor(() => expect(row("new-thread")?.isUnread).toBe(false));
});
