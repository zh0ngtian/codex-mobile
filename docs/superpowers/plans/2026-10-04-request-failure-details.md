# 请求失败原因展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 大图片发送和图像生成失败时，在会话内展示可核实的具体原因与重试建议。

**Architecture:** 客户端发送前以完整 JSON 的 UTF-8 字节数核对 app-server 的 16 MiB WebSocket 上限；网关对旧客户端的超限 JSON-RPC 请求直接返回错误并保持连接。官方图像生成条目不包含错误字段，网关按会话与条目 ID 从本机 Codex 原始记录中按需提取审核代码、阶段、类别和请求 ID，前端详情卡片只显示这些受控字段。

**Tech Stack:** TypeScript、React、Node.js、Vitest、Android APK。

---

### Task 1: 大消息错误

**Files:** `src/app-server/client.ts`, `server/gateway.ts`, `src/i18n.tsx`, `tests/ui/app-server-client.test.ts`, `tests/server/gateway.test.ts`

- [x] **Step 1: Write failing tests.** Add a client test sending a `turn/start` JSON body larger than `16 * 1024 * 1024` bytes: it must reject with the actual size and limit, must not call `socket.send`, and must keep the socket open. Add a gateway WebSocket test sending an oversized JSON-RPC request: it must return an error with the same request ID, without forwarding upstream or closing the client socket.
- [x] **Step 2: Verify red.** Run `npx vitest run tests/ui/app-server-client.test.ts tests/server/gateway.test.ts`; both new assertions must fail because existing code sends the oversized body upstream.
- [x] **Step 3: Implement.** Serialize once in `AppServerClient.send`, measure `TextEncoder().encode(payload).byteLength`, and throw a localized error for bodies above `16 * 1024 * 1024`. In the gateway `client.on("message")`, check the received byte length before forwarding; for oversized JSON-RPC requests, parse only the request ID and return `{id,error:{code:-32001,message:"Request too large: ..."}}`. Preserve the connection and existing behavior for smaller messages.
- [x] **Step 4: Verify green.** Run the same focused Vitest command; confirm oversized messages return details and ordinary forwarding still passes.

### Task 2: 图像生成审核原因

**Files:** `server/image-generation-error.ts` (new), `server/gateway.ts`, `src/backends/image-generation-error.ts` (new), `src/features/conversation/sheets/ToolSheets.tsx`, `src/features/conversation/Timeline.tsx`, `src/i18n.tsx`, `tests/server/image-generation-error.test.ts` (new), `tests/ui/image-generation-error.test.tsx` (new)

- [x] **Step 1: Write failing tests.** Create a temporary Codex session JSONL fixture with a failed `image_gen.generation` completion followed by its `custom_tool_call_output` containing `moderation_blocked`, `sexual`, `output`, and a request ID. Assert lookup by matching thread/item IDs returns these fields; another item ID and absent error return `null`. Test that the image-generation detail UI renders the friendly reason when supplied and explicitly states that the server provided no detail when absent.
- [x] **Step 2: Verify red.** Run `npx vitest run tests/server/image-generation-error.test.ts tests/ui/image-generation-error.test.tsx`; tests must fail on the missing lookup and UI.
- [x] **Step 3: Implement.** Decode the version-7 thread UUID timestamp to locate its local-date session directory, match the exact rollout filename suffix, and stream JSONL until the specified failed image-generation item and the following tool output. Parse only the nested structured moderation error; return `{code,stage,categories,requestId}` from authenticated `/api/image-generation-error`. The frontend fetches when rendering a failed image-generation item, shows “生成结果被内容审核拦截（性相关内容）” for the known category, and exposes code/stage/request ID under technical details. If lookup fails, display “服务端未提供具体原因”.
- [x] **Step 4: Verify green.** Run the focused tests and check that mismatched IDs, missing files, and non-moderation failures do not produce an invented category.

### Task 3: 集成、提交与发布

**Files:** above files, `docs/commit-conventions.md` (read only), fixed APK channel.

- [x] Run `git diff --check`, focused tests, `npm test`, `npm run build`, and server build. Fix only concrete failures.
- [x] Review the diff for data exposure: error endpoint requires the gateway token and returns only allowlisted diagnostic fields.
- [ ] Commit with Conventional Commits Chinese title/body per `docs/commit-conventions.md`; push code.
- [ ] Read the fixed channel manifest; build an APK with a higher version; publish with `apk-server.py publish-channel codex-mobile`; verify fixed JSON, HEAD, GET, size, and SHA-256.
- [ ] Remove temporary files and report version, fixed APK URL, size, and SHA-256.
