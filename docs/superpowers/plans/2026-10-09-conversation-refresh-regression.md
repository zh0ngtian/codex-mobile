# 会话刷新回退修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking。

**Goal:** 刷新和重连收到旧快照时保留已显示的最新回合、完整回复及完成状态。

**Architecture:** 在会话对账层合并快照与当前内容：已完成回合不退回运行中，流式文本不被其较短前缀覆盖，互时间完整的快照与保留回合按时间穿插排序。重连和初始读取复用对账，刷新响应受请求序列及打开会话序列约束。历史编辑的显式回退继续使用原有独立流程。

**Tech Stack:** React、TypeScript、Vitest、Playwright、Vite、Gradle、Xcode。

### Task 1: 复现快照内容回退

- [x] 在 `tests/ui/conversation.test.tsx` 写测试：完成状态遇到运行中快照保持完成；同 item 的回复遇到短前缀保持原文；不重叠的旧回合不得追加至最新回合之后；稀疏快照按时间穿插保留的回合；真实更新和 pending 对账继续生效。
- [x] 运行 `npm test -- tests/ui/conversation.test.tsx` 确认新测试失败。
- [x] 在 `src/ui/conversation.tsx` 修复 `reconcileRecentTurns` 的回合、文本和顺序合并，新增 `reconcileThreadSnapshot(current, incoming)`，同 ID 使用对账，不同 ID 直接切换。
- [x] 重跑聚焦测试确认通过。

### Task 2: 接入刷新及重连

- [x] 在 `tests/e2e/conversation-refresh.spec.ts` 通过模拟传输复现重连旧快照和交错刷新，检查最新回复持续显示。
- [x] 运行 `npx playwright test tests/e2e/conversation-refresh.spec.ts` 确认旧实现失败。
- [x] 在 `src/App.tsx` 将重连与详情加载的快照替换改为同会话对账；刷新捕获递增请求序列和 `openSequenceRef`，返回时检查仍是最新请求及打开上下文；忙碌状态按合并后最后回合更新。
- [x] 重跑浏览器测试及会话、恢复、历史编辑测试，确认真实更新和显式历史回退不受影响。

### Task 3: 验证与双端交付

- [ ] 运行 `npm test`、`npm run build`、`git diff --check`，阅读提交规范并提交、推送到 main。
- [ ] 排队获取固定渠道版本，分配高于 APK、IPA 和 OTA 的统一版本。
- [ ] 在本任务 worktree 构建 APK；运行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes '修复会话刷新和重连偶现内容回退'` 构建签名并发布 IPA。
- [ ] 发布 APK，逐个校验固定清单、HEAD 和完整 GET 的版本、大小和 SHA-256，交付固定链接及签名状态。
- [ ] 清理无用临时文件，归档本次测试会话（如创建）。

## 执行记录

- RED：初次四个单元用例和重连、交错刷新两个浏览器用例复现旧快照覆盖；补充稀疏窗口测试复现中间回合被追加到最新回合之后。
- GREEN：完整单元测试 804 项通过；会话刷新及 HTTP 历史编辑七个浏览器用例通过；TypeScript、Vite 构建通过。
- 交付版本：`0.2.127`，同时发布 Android APK 与 Ad Hoc 已签名 IPA；保留显式历史编辑回退流程。
