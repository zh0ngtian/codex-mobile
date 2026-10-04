# 会话仅本地置顶实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 置顶和取消置顶只修改当前设备的本地存储，离线时也能操作，不再请求 app-server。

**Architecture:** 复用按 backend ID 隔离的置顶存储键；列表、搜索结果和当前会话统一从本地状态恢复。两个入口共用一个本地切换函数；其他会话管理操作仍使用原有 app-server 请求。

**Tech Stack:** React 19、TypeScript、Vitest、Vite、GitHub Actions Android 构建、固定局域网 APK 渠道。

---

### Task 1: 本地状态成为唯一置顶来源

**Files:**
- Modify: `tests/ui/thread-pinning.test.ts`
- Modify: `src/features/threads/thread-pinning.ts`

- [ ] **Step 1: Write the failing test.** Assert `applyPinnedThreadState([{ id: "a", isPinned: false }, { id: "b", isPinned: true }], new Set(["a"]))` returns `a` pinned and `b` unpinned. Retain the existing per-backend persistence test, using an in-memory `Map` storage so Node 26 Web Storage does not affect it.
- [ ] **Step 2: Verify red.** Run `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/thread-pinning.test.ts`; expect the server-precedence assertion to fail.
- [ ] **Step 3: Implement green.** Make `applyPinnedThreadState` always use `locallyPinnedThreadIds.has(String(thread.id))`. Keep `writeThreadPinned` as the existing persistence API.
- [ ] **Step 4: Verify green.** Run the same focused command; expect every test in the file to pass.

### Task 2: 两个入口离线切换且不写服务端

**Files:**
- Modify: `tests/ui/conversation-controls.test.tsx`
- Modify: `src/features/conversation/ConversationControls.tsx`
- Modify: `src/App.tsx`
- Modify: `src/app-server/thread-metadata.ts`
- Modify: `tests/ui/thread-metadata.test.ts`
- Modify: `src/i18n.tsx`

- [ ] **Step 1: Write the failing UI test.** In the read-only action menu test, assert the pin button is enabled and clicking it invokes `onPin`, while duplicate, rename and archive stay disabled.
- [ ] **Step 2: Verify red.** Run `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/conversation-controls.test.tsx`; expect the pin button assertion to fail.
- [ ] **Step 3: Implement green.** Add a test-first `toggleThreadPinned(storage, backendId, threadId)` helper that inverts locally stored membership and returns the new state. Mark pin as not requiring server write. In `App.tsx`, add `setLocalPinned(threadId)` that calls this helper, updates `threads`, `searchResults` and `active`, and shows the success notice. Call it from both `manageListedThread` and `togglePinned` without requiring `clientRef.current` or interactive access. Keep the client guard for the other actions. Remove the unused `setThreadPinned` server helper, its obsolete tests and its unused error translation.
- [ ] **Step 4: Verify green.** Run `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/conversation-controls.test.tsx tests/ui/thread-pinning.test.ts tests/ui/thread-metadata.test.ts tests/ui/thread-list-page.test.tsx`; expect all to pass. Run `npm run typecheck`; expect exit code 0. Search `src` for `setThreadPinned` and confirm there is no call or `thread/metadata/update` pin request.

### Task 3: 文档、完整验证与固定渠道交付

**Files:**
- Modify: `README.md`
- Modify: `mobile-version-floor.json`

- [ ] **Step 1: Document behavior.** State in `README.md` that pinning is stored on the current device and does not sync to app-server or another device; keep the CLI compatibility note for pagination.
- [ ] **Step 2: Verify.** Run `NODE_OPTIONS=--no-experimental-webstorage npm test`, `npm run build`, and `git diff --check`; expect all to exit 0. Read `docs/commit-conventions.md`, inspect staged paths and diff, then commit using a Conventional Commit title and required Chinese body sections.
- [ ] **Step 3: Push and build.** Read the fixed channel's `latest.json`. Set `mobile-version-floor.json` high enough that the pushed Android workflow resolves a version above the current channel, commit that change with the feature, and push `main`. Watch the matching GitHub Actions build, then download its APK.
- [ ] **Step 4: Publish and verify.** Run `python3 /Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile release/CodexMobile-v0.2.63.apk --version 0.2.63 --notes '会话置顶仅保存在本机，离线可操作。'` when the resolved workflow version is `0.2.63`; otherwise use the actual workflow version and matching APK filename. Check fixed `latest.json`, `HEAD latest.apk`, and `GET latest.apk` for the same version, byte size and SHA-256 as the local APK. Remove temporary downloads and report the fixed APK URL, version, size and SHA-256.
