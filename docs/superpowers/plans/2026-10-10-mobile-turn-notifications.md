# 按移动端单条指令推送实施计划

> **执行要求：** 使用 superpowers:executing-plans 在当前会话执行，遵循 TDD；独立 worktree 开发，提交推送并部署网关、发布双端。

**目标：** 系统通知与 Bark 只推送 Codex Mobile 成功提交的具体指令对应回合，不把资格扩散至整个对话。

**架构：** `FinalAnswerCompletionTracker` 增加可选移动来源门槛，通过成功 `turn/start` / `turn/steer` RPC 的返回 ID 登记回合。实时完成证据与来源证据无序合并；列表、恢复和历史读取不能授权。客户端保留原未读判定，另用受来源约束的 tracker 处理推送；客户端 RPC 层把已确认写入转成内部事件，覆盖 HTTP 延迟确认。

**技术栈：** TypeScript、React、Vitest、HTTP/WebSocket、现有 Android 构建配置与 iOS Ad Hoc 发布脚本。

- [x] 在 `tests/server/final-answer-completion.test.ts` 增加同会话不同回合、成功/失败 start 与 steer、返回 ID 校验、完成先到、历史不授权测试；在 `tests/ui/app-server-client.test.ts` 验证同步与 HTTP 延迟确认的来源事件。
- [x] 运行定向测试确认失败；修改 `server/final-answer-completion.ts`，来源与完成证据按 `[threadId, turnId]` 合并，保持有界缓存与一次性发出。
- [x] 修改 `server/bark-notifications.ts` 使用来源门槛并接受迟到 RPC 触发推送；修改 Bark 集成场景明确提交移动指令，新增 HTTP/流式只查看不推送及混合来源回归。
- [x] 修改 `src/app-server/client.ts` 与 `src/App.tsx`，只为成功提交的指令建立系统推送资格，保留未读行为与历史 catchup 静默；在原始来源摘要登记时同步分类。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/server/final-answer-completion.test.ts tests/server/bark-notifications.test.ts tests/ui/app-server-client.test.ts tests/ui/run-completion-notification.test.ts`，预期通过；执行类型检查、客户端和服务端构建与传输回归。
- [ ] 更新 README 推送约定，提交并推送。部署长期网关，健康检查与代码一致性验收。
- [ ] 取得固定渠道发布锁，读取双端清单并分配更高统一版本；按现有配置构建 APK、签名发布 IPA，同步 Cloudflare 软件源。
- [ ] 回验两端固定 JSON、HEAD、GET、文件大小和 SHA-256，保留交付证据，清理临时文件与 worktree。本次协议模拟不创建真实测试会话。

## 开发验证

- 基线 67 项通过；新增来源测试先失败，Bark 两种传输均复现只查看也推送的缺陷。
- 实现后通知、HTTP/流式传输 7 文件共 180 项通过；真实子 Agent 元数据回查 2 项通过。
- `npm run build` 与 `npm run build:server` 通过；浏览器 6 项验证包括实际点击发送、同对话后续电脑指令静默、迟到确认、隐藏来源和历史追赶。
- 浏览器环境未安装系统 Chrome，改用已安装的 Playwright Chromium；未创建真实测试会话。
