# 模型提问 UI 与通知实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在本会话逐项执行，遵循 TDD，不委派共享状态工作。

**Goal:** 模型提问时可在手机回答或暂存，并收到系统/Bark 通知。

**Architecture:** 复用 app-server `item/tool/requestUserInput` 与现有回答 RPC。新增共用问题通知 tracker，按会话、回合、item 去重并保持隐藏来源静默；HTTP 收到服务器请求时也交给通知器。回答队列保留草稿，允许收起与重新打开。

**Tech Stack:** TypeScript、React、Vitest、Playwright、现有原生通知桥与 Ad Hoc OTA。

- [x] 运行审批与通知基线；在 `tests/ui/approval-requests.test.tsx` 写收起/恢复草稿用例，在 `tests/server/question-notifications.test.ts` 写重复请求、不同问题、隐藏会话及 catchup 用例，在 Bark HTTP/流式集成测试加入问题立即推送。
- [x] 执行定向测试确认失败；实现 `server/question-notifications.ts` 的 `observe(message, catchingUp)`、`rememberThread(thread)`，以 `[threadId, turnId, itemId ?? requestId]` 去重，有界保存且不保存回答或正文。
- [x] 执行定向测试确认失败后，给 `useApprovalRequests` 增加 `dismiss/reopen`；`ApprovalSheet` 增加“稍后回答”、会话标题、问题数量及多行输入；`App.tsx` 显示待回答入口并在 onRequest 发送通知，复用点击通知导航。
- [x] 在 `server/bark-notifications.ts` 接入问题 tracker，问题/完成使用不同去重命名空间；`server/http-session.ts` 收到待处理请求后提交通知观察，使用原有目的地址合并与持久去重。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/approval-requests.test.tsx tests/ui/approval-sheet.test.tsx tests/server/question-notifications.test.ts tests/server/bark-notifications.test.ts tests/server/http-session.test.ts tests/server/gateway.test.ts tests/ui/run-completion-notification.test.ts`；执行 `npm run build`、`npm run build:server` 与 `npm exec playwright test -- --config tests/e2e/approvals.config.ts`。
- [ ] 更新 README；检查差异，按中文 Conventional Commits 提交，集成推送 main。持部署锁部署本次服务端模块并验证健康。
- [ ] 持固定渠道锁分配高于双端现役的统一版本，构建发布 APK 与已签名 IPA，并检查 GitHub unsigned IPA 软件源版本；核对 JSON、HEAD、完整 GET 的大小与 SHA-256。
- [ ] 保留包与发布凭证到长期工作区，清理临时文件，归档 worktree；协议模拟不创建真实测试会话。

## 开发验收

- 原有审批与通知基线 73 项通过。
- 新增用例先复现缺少提问推送、收起/恢复和多行输入；实现后 8 文件 150 项通过。
- 浏览器 3 项通过：失败保留回答与准确提交、审批待确认恢复、新提问通知与暂存多行草稿。
- 375px、大字号、横屏和减少动态效果截图已检查；应用沿用现有浅色主题，在系统深色偏好下仍可读。
- 客户端及服务端构建通过。仅使用协议模拟，不创建真实测试会话或向真实 Bark 地址发送测试通知。
