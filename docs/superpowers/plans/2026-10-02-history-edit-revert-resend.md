# 历史消息编辑、回退与重发实施计划

> **执行要求：** 当前环境未暴露 superpowers Skill；按仓库既有 superpowers 计划格式执行，并严格遵循 TDD、systematic-debugging、verification-before-completion 流程。

**目标：** 支持编辑单用户消息轮次，通过 app-server 回退目标轮次及后续历史，在同一会话中保留原附件并使用当前运行设置重新执行修改后的消息。

**协议证据：** 本机 `codex-cli 0.159.2` 的实验协议提供 `thread/revert { threadId, beforeTurnId }`，返回的线程不携带 turns，需要通过分页历史重新水合；仓库内旧版协议仅提供 `thread/rollback { threadId, numTurns }`。两种操作都只回退持久化对话历史，不撤销文件、命令或远端副作用。

**兼容策略：** 优先调用 `thread/revert`；仅在 JSON-RPC 返回 `-32601` 方法不存在时调用旧版 `thread/rollback`，避免在其他错误后重复执行破坏性操作。回退前在前端再次校验线程空闲、没有排队消息、目标轮次存在且只有一条用户消息。

## 任务 1：先写失败的领域与协议测试

**文件：**

- 新增 `tests/ui/history-edit.test.ts`
- 修改 `tests/ui/app-server-client.test.ts`

1. 覆盖目标轮次资格判断、后续轮次数量计算和用户输入重建。
2. 断言编辑仅替换主要文本，并保留 image、localImage、audio、skill、mention 及其余附件文本。
3. 断言 app-server 错误保留 JSON-RPC code/data，使 `-32601` 可被可靠识别。
4. 先运行聚焦测试，确认测试因实现缺失而失败。

## 任务 2：实现回退协议与状态转换

**文件：**

- 新增 `src/app-server/history-edit.ts`
- 修改 `src/app-server/client.ts`
- 修改 `src/App.tsx`

1. 引入结构化 `AppServerRpcError`，保留服务端错误码和数据。
2. 从目标用户消息构造可编辑快照，保留所有非主要文本输入。
3. 提交时重新读取当前 thread、busy 与队列状态并校验目标轮次。
4. 优先请求 `thread/revert`；仅对 `-32601` 回退到 `thread/rollback`。
5. 清除目标轮次及之后的本地历史，再通过现有 `turn/start` 逻辑携带当前模型、推理强度、服务层级、权限和审批设置启动新一轮。
6. 回退成功但启动失败时保留编辑内容并刷新服务端历史，避免重复回退已不存在的轮次。

## 任务 3：实现编辑态、确认交互与附件保留

**文件：**

- 修改 `src/features/conversation/Timeline.tsx`
- 修改 `src/features/conversation/ConversationPage.tsx`
- 修改 `src/styles.css`
- 修改 `src/i18n.tsx`
- 新增或修改对应 UI 测试

1. 只为满足条件的主用户消息显示“编辑”；引导消息和自动化消息不显示编辑入口。
2. 进入编辑态后显示目标消息说明、取消操作和“保存并重发”按钮；原消息附件只读保留。
3. 目标轮次之后仍有轮次时，提交前显示“删除后续并重发”确认。
4. busy、steering、实时语音、图片读取或排队消息存在时禁用入口；提交时仍进行二次校验。
5. 取消编辑时恢复进入编辑前的草稿与待发送附件。

## 任务 4：验证、提交与固定渠道发布

1. 运行聚焦测试、完整 `npm test`、`npm run typecheck`、`npm run build` 和 `git diff --check`。
2. 保留并排除工作区中不属于本任务的改动，仅暂存本任务文件和补丁块。
3. 按 Conventional Commits 中文规范提交并推送 `main`。
4. 重新读取固定渠道版本，构建版本号更高的新 APK。
5. 使用 `apk-server.py publish-channel codex-mobile` 发布。
6. 通过固定 JSON、HEAD、GET 核对版本、文件大小和 SHA-256，并清理临时构建与校验文件。
