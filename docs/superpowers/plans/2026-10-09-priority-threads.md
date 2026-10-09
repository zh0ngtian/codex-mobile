# 运行中与未读会话优先显示实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking。

**Goal:** 全部机器和单机视图将运行中、未读会话显示在手动置顶之后，并且不重复展示。

**Architecture:** 列表派生层统一判断顶部展示资格，顶部先保留手动置顶，再追加运行中或未读会话，两类分别沿用最近任务时间排序。单机项目区使用同一判断排除顶部会话，保留原始项目加载信息和分页入口；手动置顶字段及本地存储不变。

**Tech Stack:** React、TypeScript、Vitest、Vite、GitHub Actions。

### Task 1: 回归与实现

- [x] 在 `tests/ui/thread-list-model.test.ts` 添加混合机器、手动置顶兼运行、运行兼未读、同名 ID 跨机器以及清除状态后的分区回归。
- [x] 在 `tests/ui/thread-list-page.test.tsx` 添加全部机器、单机折叠项目、搜索视图的顺序和去重回归，以及自动提升会话仍显示“置顶”操作的回归。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/thread-list-model.test.ts tests/ui/thread-list-page.test.tsx`，确认新增断言因顶部缺少运行中或未读会话而失败。
- [x] 在 `src/features/threads/thread-list-model.ts` 实现统一判断：

```ts
export function isThreadPrioritized(thread: AggregatedThreadItem) {
  return thread.pinned || thread.unread || isThreadRunning(thread.status);
}

export function splitAllThreads(threads: AggregatedThreadItem[]) {
  return {
    pinned: [
      ...threads.filter((thread) => thread.pinned),
      ...threads.filter((thread) => !thread.pinned && isThreadPrioritized(thread)),
    ],
    recent: threads.filter((thread) => !isThreadPrioritized(thread)),
  };
}
```

- [x] 在 `src/features/threads/ThreadListPage.tsx` 导入 `isThreadPrioritized`，两个项目区的 `!thread.pinned` 改成 `!isThreadPrioritized(thread)`。
- [x] 调整旧 UI 断言：默认运行会话提升之后没有普通会话，因此不再显示“最近”标题。
- [x] 重跑聚焦测试，并在 `README.md` 记录临时优先展示和状态恢复规则。

### Task 2: 提交与双端发布

- [x] 运行全套测试、`npm run build` 和 `git diff --check`。首次并发全套运行遇到 HTTP 心跳时序波动，单独 47 项通过；`NODE_OPTIONS=--no-experimental-webstorage npx vitest run --maxWorkers=2` 全部 743 项通过。
- [ ] 只暂存本次六个文件，按 `docs/commit-conventions.md` 提交；推送到 main 前确认远端没有遗漏的新提交。
- [ ] 推送后通过 `Build Mobile Apps` 构建当前提交的 APK 和未签名 IPA；统一版本高于两个固定渠道，构建结束核对提交 SHA 与版本。
- [ ] 下载双端构建产物，用 `apk-server.py publish-channel codex-mobile <安装包> --version <版本> --notes <说明>` 分别发布。
- [ ] 核对两个安装包内置前端和原生版本、IPA 签名状态，以及固定 JSON、HEAD、完整 GET 的版本、大小和 SHA-256；清理本次临时文件后提供固定链接和校验信息。
