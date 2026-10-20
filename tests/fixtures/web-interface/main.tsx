/** 独立验收入口：真实 App 与 HTTP 适配层，协议响应全部隔离在内存，不连接生产网关。 */
import React from "react";
import { createRoot } from "react-dom/client";
import { AppBootstrap } from "../../../src/App";
import { I18nProvider } from "../../../src/i18n";
import { applyRuntimeEnvironment } from "../../../src/ui/runtime-environment";
import { applyFontSize, readFontSize } from "../../../src/ui/font-size";
import "../../../src/polyfills";
import "../../../src/styles.css";

const now = Math.floor(Date.now() / 1000);
const answer = `项目里的 Sidechat 本质是**从主聊天分叉出的临时独立聊天**：

- **继承上下文**：通过 Codex App Server 的 \`thread/fork\`，从主聊天最近一轮已结束的对话创建分支，继承模型设置、远程机器、目录和容器。
- **独立运行**：有自己的消息和执行轮次，可与主聊天并行；界面只显示分叉后新增的消息。
- **明确边界**：注入专门指令，要求继承历史仅作参考，不自动接着执行主任务；默认只读探索。
- **临时存储**：聊天内容由 Codex 管理，本地只保存关联信息和消息轮次 ID。

注意：**对话独立，但文件环境共享**，Sidechat 中获准进行的文件修改仍会影响同一工作目录。

核心实现在 \`codex-sessions.mjs\`。`;
const sampleTurn = {
  id: "sample-turn", status: "completed", startedAt: now - 80, completedAt: now - 56,
  items: [
    { id: "sample-user", type: "userMessage", content: [{ type: "text", text: "简单说一下你是怎么支持 sidechat 的" }] },
    { id: "sample-answer", type: "agentMessage", phase: "final_answer", text: answer },
  ],
};
const threads = [
  { id: "sidechat", name: "说明 Sidechat 支持方式", preview: "说明 Sidechat 支持方式", cwd: "/work/amd_gpu_monitor", turns: [sampleTurn] },
  { id: "token", name: "获取方舟 token", preview: "获取方舟 token", cwd: "/work/bytenn_rt", turns: [] },
  { id: "clone", name: "克隆 bytenn_rt 到开发机", preview: "克隆 bytenn_rt 到开发机", cwd: "/work/amd_gpu_monitor", turns: [] },
  { id: "sync", name: "排查 app-server 同步失败", preview: "排查 app-server 同步失败", cwd: "/work/amd_gpu_monitor", turns: [] },
  { id: "recent", name: "更新项目说明", preview: "更新项目说明", cwd: null, turns: [] },
].map((thread, index) => ({ ...thread, createdAt: now - 500 - index, updatedAt: now - index * 60, status: { type: "idle" }, source: "cli" }));
const models = [
  { id: "gpt-test", model: "gpt-test", displayName: "GPT-5 Mini", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [
    { reasoningEffort: "low", description: "更快响应" }, { reasoningEffort: "medium", description: "平衡速度与深度" }, { reasoningEffort: "high", description: "深入思考" },
  ], serviceTiers: [{ id: "fast", name: "Fast", description: "更快" }] },
  { id: "gpt-other", model: "gpt-other", displayName: "GPT 测试模型", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "深入思考" }] },
];
const messages: unknown[] = [{ method: "thread/tokenUsage/updated", params: { threadId: "sidechat", tokenUsage: { last: { totalTokens: 7000 }, modelContextWindow: 100000 } } }];
const threadSettings = new Map<string, { model: string; effort: string | null; serviceTier: string | null }>();
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const originalFetch = window.fetch.bind(window);
// 流式传输不属于该 HTTP fixture；即使误切换，也不能向真实网关建立 WebSocket。
class FixtureSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
  readonly readyState = FixtureSocket.CLOSED;
  onclose: ((event: CloseEvent) => void) | null = null;
  constructor() {
    super();
    queueMicrotask(() => {
      const event = new CloseEvent("close", { code: 1000, reason: "隔离验收入口仅模拟 HTTP 传输" });
      this.dispatchEvent(event); this.onclose?.(event);
    });
  }
  close() {}
  send() { throw new Error("隔离验收入口仅模拟 HTTP 传输"); }
}
window.WebSocket = FixtureSocket as unknown as typeof WebSocket;
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
  if (url.pathname === "/api/host") return json({ hostId: "visual-fixture", displayName: "FWWJ5VYDY4", gatewayVersion: "0.2.0", appServerReady: true, httpPolling: true });
  if (url.pathname === "/api/projects") return json({ projects: ["/work/bytenn_rt", "/work/seedance-v2-prod", "/work/WorkIntensity", "/work/bytenn-amd-ops", "/work/amd_gpu_monitor"], projectlessThreadIds: ["recent"] });
  if (url.pathname === "/api/events") return json({ epoch: "visual-fixture", cursor: messages.length, messages: Number(url.searchParams.get("after")) < messages.length ? messages : [], requests: [], active: false, updatedAt: Date.now(), reset: false });
  if (url.pathname === "/api/follow-ups") return json({ items: [] });
  if (url.pathname !== "/api/rpc") return json({});
  const { message } = JSON.parse(String(init?.body ?? "{}"));
  if (!message) return json({});
  const thread = threads.find(item => item.id === message.params?.threadId) ?? threads[0];
  const settings = threadSettings.get(thread.id) ?? { model: "gpt-test", effort: "medium", serviceTier: null };
  if (message.method === "thread/settings/update") {
    threadSettings.set(thread.id, {
      model: message.params.model ?? settings.model,
      effort: message.params.effort === undefined ? settings.effort : message.params.effort,
      serviceTier: message.params.serviceTier === undefined ? settings.serviceTier : message.params.serviceTier,
    });
    return json({ id: message.id, result: {} });
  }
  const results: Record<string, unknown> = {
    "initialize": { userAgent: "visual-fixture" },
    "thread/list": { data: message.params?.cwd ? threads.filter(item => item.cwd === message.params.cwd) : threads, nextCursor: null },
    "thread/search": { data: threads.filter(item => item.name.toLowerCase().includes(String(message.params?.searchTerm ?? "").toLowerCase())).map(thread => ({ thread, snippet: thread.preview })), nextCursor: null },
    "thread/read": { thread }, "thread/resume": { thread, model: settings.model, reasoningEffort: settings.effort, serviceTier: settings.serviceTier, cwd: thread.cwd },
    "thread/turns/list": { data: thread.turns, nextCursor: null },
    "mobile/turns/details": { data: thread.turns, nextCursor: null },
    "model/list": { data: models },
    "permissionProfile/list": { data: [{ id: ":workspace", allowed: true }, { id: ":danger-full-access", allowed: true }] },
    "config/read": { config: { model: "gpt-test", model_reasoning_effort: "medium", sandbox_mode: "workspace-write" } },
    "account/rateLimits/read": { rateLimits: { secondary: { usedPercent: 28, windowDurationMins: 10080, resetsAt: now + 260064 } } },
    "thread/start": { thread: { id: "fixture-new", cwd: message.params?.cwd ?? null, turns: [], status: { type: "idle" } }, model: "gpt-test" },
    "turn/start": { turn: { id: "fixture-live", status: "inProgress", items: [] } },
  };
  return json({ id: message.id, result: results[message.method] ?? { data: [], items: [], marketplaces: [], nextCursor: null } });
};

localStorage.setItem("codex-mobile:language", "zh-CN");
if (!localStorage.getItem("codex-mobile:pinned:visual")) localStorage.setItem("codex-mobile:pinned:visual", JSON.stringify(["token", "sidechat"]));
applyFontSize(readFontSize());
applyRuntimeEnvironment(document.documentElement, navigator.userAgent);
createRoot(document.getElementById("root")!).render(<I18nProvider><AppBootstrap initialRegistry={{ version: 1, selectedBackendId: "visual", backends: [{ id: "visual", hostId: "visual-fixture", name: "FWWJ5VYDY4", baseUrl: location.origin, token: "", enabled: true, order: 0 }] }} /></I18nProvider>);
