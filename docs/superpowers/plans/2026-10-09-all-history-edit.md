# 所有历史用户消息编辑重发实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 逐项执行；遵循 TDD。用户已授权持续实现、提交和发布，在当前工作区只提交本任务文件。

**Goal:** 所有已结束历史轮次的用户消息（包含引导与自动化消息）均可就地编辑重发。

**Architecture:** 按 turnId 和 messageId 定位编辑目标，复用现有轮次回退和重发。由于协议只支持整轮回退，编辑同轮后续消息时同时保留并重发此前用户输入及附件；目标后的用户输入删除，延用现有确认交互。界面把消息级编辑操作传递到各响应片段。

**Tech Stack:** TypeScript、React、Vitest、PakePlus、Gradle、Xcode。

### 任务 1：目标定位与输入保留

文件：`src/app-server/history-edit.ts`、`tests/ui/history-edit.test.ts`、`src/App.tsx`。

- [x] 添加失败测试：`createHistoricalMessageEditTarget(turns, "turn-steered", "user-2")` 返回第二条消息，保留第一条消息输入，`buildEditedHistoryInput(target, "新要求")` 保留先前附件并替换第二条文字。
- [x] 执行 `npm test -- tests/ui/history-edit.test.ts`，确认旧实现拒绝多用户消息而失败。
- [x] 增加可选 `messageId`，使用 `findIndex` 定位用户消息；`input` 为此前用户消息与目标消息的输入拼接，`primaryTextIndex` 加前缀长度；`hasLaterTurns` 覆盖目标之后的同轮用户消息。
- [x] 在 App 开始编辑与提交前重验时传递 `target.messageId`，运行领域测试。

### 任务 2：所有历史消息编辑入口

文件：`src/features/conversation/ConversationPage.tsx`、`src/features/conversation/Timeline.tsx`、`tests/ui/conversation-page-pagination.test.tsx`。

- [x] 添加失败测试：已完成轮次的主消息、引导消息和自动化消息各显示编辑按钮；点击引导消息回调返回对应 messageId，编辑器仅位于该消息。
- [x] 执行 `npm test -- tests/ui/conversation-page-pagination.test.tsx` 并确认失败。
- [x] 页面按每条消息构造目标映射，TurnCard 传递消息 ID；响应片段与 TimelineItem 传递编辑状态，仅目标消息渲染编辑器，自动化消息也显示操作。
- [x] 运行 `npm test -- tests/ui/history-edit.test.ts tests/ui/conversation.test.tsx tests/ui/conversation-page-pagination.test.tsx`，验证运行中与队列保护不回归。

### 任务 3：验证与交付

- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- --exclude '.mobile-build/**' --exclude 'tests/e2e/**' --exclude 'node_modules/**'`、`npm run build`、`git diff --check`。
- [ ] 仅暂存本任务文件，按 `docs/commit-conventions.md` 提交中文 Conventional Commit 并推送。
- [ ] 在独立发布目录从提交快照构建 APK、IPA，版本高于两个固定清单且统一。
- [ ] 使用 `apk-server.py publish-channel codex-mobile <artifact> --version <version> --notes <notes>` 分别发布。
- [ ] 通过固定 JSON、HEAD 与完整 GET 校验版本、大小、SHA-256，标注 IPA 签名状态，删除本次不再需要的临时文件。

## 验证记录

- 回归测试先失败后通过，覆盖多用户消息定位、附件插入与清空目标消息保护。
- 87 个测试文件、740 项测试通过；TypeScript 与生产前端构建通过。
- Chromium 移动端端到端验证 2 项通过，覆盖普通历史消息和同轮引导消息的回退与重发顺序、附件保留、底部草稿保留。
- 当前 Node 26 的实验 Web Storage 会覆盖 jsdom 的 localStorage，测试运行关闭此实验功能；排除并行构建生成的临时源码副本。
