# 最终回复结束后推送实施计划

> **For agentic workers:** 使用 superpowers:test-driven-development，在本任务工作树内执行；先验证失败，再实现和发布。

**Goal:** 系统和 Bark 只在最终回复完成且回合成功结束后通知，避免中途推送。

**Architecture:** 增加浏览器与网关共用的纯 TypeScript 回合完成判定器。实时 `item/completed` 的 `agentMessage/final_answer` 与同一 thread/turn 的 `turn/completed` 成功状态共同满足时才产生完成信号；兼容结束先于 final 以及完成回合内携带 final 的事件。状态缓存限制 512 回合，不保存正文，RPC 历史不参与通知。

**Tech Stack:** TypeScript、React、Node HTTP/WebSocket、Vitest、Playwright、既有 Android/iOS 构建流水线。

## 1. 先验证过早推送

- [x] 修改 `tests/server/bark-notifications.test.ts`：真实本地 Bark 接收端在收到 final 消息但未收到成功回合结束时必须为 0 次；加入 commentary、失败/中断、反向事件顺序和跨回合隔离测试。已有成功场景补发成功回合结束事件。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/server/bark-notifications.test.ts`，确认新增断言在旧实现下失败。
- [x] 在 `tests/e2e/final-answer-push.spec.ts` 模拟实时事件和原生通知桥：final 后通知数为 0，回合成功结束后为 1，重复事件仍为 1，历史回放不通知。

## 2. 共用完成判定与两端接入

- [x] 创建 `server/final-answer-completion.ts`，导出 `FinalAnswerCompletionTracker.observe(message)`，返回 `{ threadId, turnId } | null`。仅处理实时 item/turn 事件，按 JSON(threadId,turnId) 维护有界分类状态。失败、中断和错误状态不产生完成信号；`turn/completed` 的 items 可提供完整 final 证据。
- [x] `server/bark-notifications.ts` 用判定结果代替单条 final 触发，保持磁盘去重、重试和订阅逻辑。
- [x] `src/App.tsx` 每台设备持有判定器，成功信号才执行既有可见性、排队和未读策略以及 `notifyRunCompleted`。历史 catchup 不登记证据；item 仍即时展示，不等待回合结束。
- [x] 运行网关和完成通知相关单元测试、Playwright 回归、`npm run build:package` 与 `git diff --check`，确认新用例变绿并完成自审。

## 3. 发布

- [ ] 更新 README，说明通知同时等待 final 和成功回合结束；按中文 Conventional Commits 提交，集成并推送 main。
- [ ] 读取两端固定清单，选取统一更高版本，从已推送提交同时构建 APK 和未签名 IPA；更新本机网关并核验版本及通知设置接口。
- [ ] 使用 `apk-server.py publish-channel codex-mobile <安装包> --version <版本> --notes '仅在最终回复和回合成功结束后推送，避免中途通知'` 分别发布；JSON、HEAD、完整 GET 验证大小与 SHA-256，交付固定链接和签名状态。
- [ ] 清理本次无用临时环境，保留核验记录与安装包。

验证记录：旧逻辑下 Bark 的 5 个新增断言失败，iOS 通知桥端到端断言在回合未结束时收到 1 次通知；修复后通知相关单元测试 106 项、端到端测试 2 项通过，前端及网关打包成功。
