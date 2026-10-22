import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppBootstrap } from "../../src/App";
import { saveBackendRegistry } from "../../src/backends/registry";
import type { NativeSnapshot } from "../../src/native-ui/protocol";
import { SidebarSummaryIndex } from "../../server/sidebar-summary-index";

const posts: NativeSnapshot[] = [];
let finishRequests: (() => void) | undefined;
afterEach(async () => {
  cleanup();
  finishRequests?.();
  finishRequests = undefined;
  await Promise.resolve();
  localStorage.clear();
  posts.length = 0;
  for (const key of ["__CODEX_NATIVE_UI__", "webkit", "codexMobilePublishNativeSnapshot"]) delete (window as any)[key];
  vi.unstubAllGlobals();
});

function command(id: string, name: string, params: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent("codex-mobile-native-command", { detail: { id, name, params } }));
}

it("十项目同时展开、每项目五个运行会话：50条列表、逐个打开、通知与100项慢回填均完整", async () => {
  const projects = Array.from({ length: 10 }, (_, i) => `/projects/project-${i}`);
  const threads = projects.flatMap((cwd, project) => Array.from({ length: 5 }, (_, index) => ({
    id: `thread-${project}-${index}`, name: `项目${project}运行会话${index}`, cwd,
    status: { type: "active" }, recencyAt: 1000 - project * 5 - index,
  })));
  const turn = (id: string) => ({ id: `turn-${id}`, status: "inProgress", itemsView: "summary", items: [
    { id: `user-${id}`, type: "userMessage", text: `检查${id}` },
    { id: `commentary-${id}`, type: "agentMessage", phase: "commentary", text: `正在执行${id}` },
  ] });
  let connections = 0, background = 0, maxBackground = 0;
  let released = false, cursor = 0;
  const queued: Array<() => void> = [], slow: Array<() => void> = [];
  const pendingEvents: any[] = [];
  const started: Array<{ method: string; params: any }> = [];
  const completed: Array<{ method: string; params: any }> = [];
  const backgroundMethods = new Set(["/api/projects", "thread/list", "mobile/sidebar/summaries", "account/rateLimits/read", "mobile/turns/commentary", "mobile/turns/details"]);
  let summaryReads = 0;
  const index = new SidebarSummaryIndex(async (method, params) => {
    if (method === "thread/loaded/list") return { data: threads.map(thread => thread.id), nextCursor: null };
    summaryReads++;
    return { thread: threads.find(thread => thread.id === params.threadId) };
  });
  index.setEpoch("stress");
  finishRequests = () => { released = true; slow.splice(0).forEach(finish => finish()); };
  // 用有限连接池覆盖浏览器内部的请求等待，回填保持挂起直到显式释放。
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const url = new URL(String(input));
    const message = init?.body && url.pathname === "/api/rpc" ? JSON.parse(String(init.body)).message : undefined;
    const method = message?.method ?? url.pathname;
    const params = message?.params ?? {};
    const record = { method, params };
    const isBackground = backgroundMethods.has(method);
    let active = false, settled = false;
    const finish = async (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else {
        let result: any = { data: [], items: [], nextCursor: null };
        if (url.pathname === "/api/projects") result = { projects, projectlessThreadIds: [] };
        else if (url.pathname === "/api/events") {
          const messages = pendingEvents.splice(0); cursor += messages.length;
          result = { epoch: "stress", cursor, messages, requests: [], active: true, reset: false, updatedAt: Date.now() };
        } else if (method === "model/list") result.data = [{ model: "test-model", displayName: "Test", supportedReasoningEfforts: [], isDefault: true }];
        else if (method === "permissionProfile/list") result.data = [{ id: ":workspace", allowed: true }];
        else if (method === "config/read") result = { config: { model: "test-model", sandbox_mode: "workspace-write" } };
        else if (method === "threadSection/list") result.data = [{ id: "01984de2-8f74-7c91-a3b2-5c5e937cf318", name: "Pinned" }];
        else if (method === "thread/list") result.data = params.sectionId ? [] : threads.filter(thread => thread.cwd === params.cwd);
        else if (method === "mobile/sidebar/summaries") result = await index.summaries(params);
        else if (method === "thread/resume") result = {
          thread: threads.find(thread => thread.id === params.threadId), model: "test-model",
          initialTurnsPage: { data: [turn(params.threadId)], nextCursor: "older" },
        };
        else if (method === "mobile/turns/commentary") result = { turnId: `turn-${params.threadId}`, items: turn(params.threadId).items };
        else if (["thread/turns/list", "mobile/turns/details"].includes(method)) result.data = [turn(params.threadId)];
        completed.push(record);
        resolve(new Response(JSON.stringify(message ? { id: message.id, result } : result)));
      }
      if (active) {
        connections--; if (isBackground) background--;
        queued.shift()?.();
      } else {
        const position = queued.indexOf(start); if (position >= 0) queued.splice(position, 1);
      }
    };
    const start = () => {
      active = true; connections++;
      if (isBackground) { background++; maxBackground = Math.max(maxBackground, background); }
      started.push(record);
      if (!released && ["mobile/turns/commentary", "mobile/turns/details"].includes(method)) slow.push(() => void finish());
      else void finish();
    };
    init?.signal?.addEventListener("abort", () => void finish(init.signal!.reason), { once: true });
    // 六条同源连接中的一条保留给事件同步；其余最多五条承载 RPC。
    if (connections < 5) start(); else queued.push(start);
  })));
  Object.assign(window, {
    __CODEX_NATIVE_UI__: true,
    webkit: { messageHandlers: { nativeUI: { postMessage() {} } } },
    codexMobilePublishNativeSnapshot: (snapshot: NativeSnapshot) => posts.push(snapshot),
  });
  const registry = { version: 1 as const, selectedBackendId: "stress", backends: [
    { id: "stress", hostId: "stress", name: "压力测试", baseUrl: "http://many-running-projects.test", token: "test", enabled: true, order: 0 },
  ] };
  saveBackendRegistry(localStorage, registry);
  localStorage.setItem("codex-mobile:collapsed-projects", "[]");
  render(<AppBootstrap initialRegistry={registry} />);
  const groups = () => posts.at(-1)?.groups.filter(group => group.category === "project") ?? [];
  await waitFor(() => {
    expect(groups()).toHaveLength(10);
    expect(groups().every(group => !group.collapsed && group.loading === "ready" && group.items.length === 5)).toBe(true);
    expect(groups().flatMap(group => group.items).filter(item => item.running)).toHaveLength(50);
    expect(posts.at(-1)?.navigationLoading).toBe(false);
  });
  expect(new Set(groups().flatMap(group => group.items.map(item => item.threadId))).size).toBe(50);
  const projectReads = started.filter(call => call.method === "thread/list" && !call.params.sectionId);
  expect(projectReads).toHaveLength(10);
  expect(projectReads.every(call => call.params.limit === 5)).toBe(true);
  expect(summaryReads).toBe(50);

  for (const [position, thread] of threads.entries()) {
    await act(async () => command(`open-${thread.id}`, "thread.open", { backendId: "stress", threadId: thread.id }));
    await waitFor(() => expect(posts.at(-1)).toMatchObject({ threadId: thread.id, loading: "ready", busy: true }));
    // 四个慢回填已经占用后台名额，整轮刷新排队期间继续打开剩余会话。
    if (position === 1) await act(async () => command("refresh-during-backfill", "navigation.refresh"));
  }
  expect(started.filter(call => call.method === "thread/resume")).toHaveLength(50);
  expect(slow).toHaveLength(4);
  expect(maxBackground).toBe(4);
  expect(completed.filter(call => ["mobile/turns/commentary", "mobile/turns/details"].includes(call.method))).toHaveLength(0);

  // 50个运行会话同时收到名称更新，经过真实轮询与业务投影核对没有丢事件。
  threads.forEach(thread => {
    thread.name += "已更新";
    pendingEvents.push({ method: "thread/name/updated", params: { threadId: thread.id, threadName: thread.name } });
  });
  await act(async () => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(groups().flatMap(group => group.items).filter(item => item.title.endsWith("已更新"))).toHaveLength(50));
  expect(posts.at(-1)?.loading).toBe("ready");
  expect(posts.at(-1)?.error ?? "").toBe("");

  await act(async () => finishRequests!());
  // online 恢复允许重核对当前会话；用唯一方法/会话对验收100项原始回填。
  await waitFor(() => expect(new Set(completed.filter(call => ["mobile/turns/commentary", "mobile/turns/details"].includes(call.method))
    .map(call => `${call.method}:${call.params.threadId}`)).size).toBe(100));
  expect(new Set(completed.filter(call => call.method === "mobile/turns/commentary").map(call => call.params.threadId)).size).toBe(50);
  expect(new Set(completed.filter(call => call.method === "mobile/turns/details").map(call => call.params.threadId)).size).toBe(50);
  expect(maxBackground).toBe(4);
  await waitFor(() => expect(posts.at(-1)?.commandResults?.find(result => result.id === "refresh-during-backfill")?.ok).toBe(true));
  await waitFor(() => expect(started.filter(call => call.method === "thread/list" && !call.params.sectionId)).toHaveLength(20));
  expect(summaryReads).toBe(50);
  await waitFor(() => expect(groups().every(group => group.loading === "ready" && group.items.length === 5 && group.items.every(item => item.running))).toBe(true));
}, 20_000);
