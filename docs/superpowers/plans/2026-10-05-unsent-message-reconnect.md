# 发送前断线自动恢复实施计划

> **执行要求：** 按 superpowers 的 planning、TDD、verification-before-completion 流程逐项执行。

**目标：** 当用户点击发送时，若旧 WebSocket 已进入关闭状态且请求尚未写入连接，客户端自动等待新连接完成工作区初始化和当前会话恢复，再安全重试一次；不得重试任何可能已经送达 App Server 的请求。

**架构：** App Server 客户端用专用错误区分“发送前连接不可用”和“发送后连接中断”。连接恢复层只捕获前者：优先复用已经完成初始化的替代客户端，否则触发一次重连并等待工作区就绪。工作区维护独立的 ready client 引用，仅在模型、权限、线程列表和当前会话恢复完成后发布。发送流程通过同一包装器执行 `thread/start` 与 `turn/start`，替代连接上的请求最多重试一次。

**技术栈：** React、TypeScript、Vitest、WebSocket JSON-RPC、Android WebView

---

### Task 1：用失败测试定义安全重试边界

**文件：**

- 修改 `tests/ui/app-server-client.test.ts`
- 修改 `tests/ui/connection-recovery.test.ts`

- [x] 断言连接不是 `OPEN` 时抛出“请求尚未发送”的专用错误。
- [x] 断言专用错误会等待替代 ready client，并且只重试一次。
- [x] 断言普通 RPC 错误、发送后断线错误不会触发重连或重试。
- [x] 断言已有替代 ready client 时直接复用，不额外拆掉健康连接。
- [x] 运行聚焦测试并确认新增测试先失败。

### Task 2：实现发送前断线自动恢复

**文件：**

- 修改 `src/app-server/client.ts`
- 修改 `src/backends/connection-recovery.ts`
- 修改 `src/App.tsx`

- [x] 增加发送前连接不可用的可识别错误类型。
- [x] 增加最多一次的安全重连请求包装器。
- [x] 仅在工作区初始化和当前会话恢复完成后发布 ready client。
- [x] 将新会话的同步引用及时更新，保证紧随其后的重连能够恢复刚创建的会话。
- [x] 让 `thread/start` 与 `turn/start` 使用安全包装器，失败时继续保留现有草稿恢复行为。
- [x] 运行聚焦测试并确认通过。

### Task 3：验证、真机回归与交付

- [x] 运行完整测试、类型检查、生产构建和差异检查。
- [ ] 在连接的 Android 真机验证指定会话可正常恢复和发送。
- [ ] 按提交规范提交并推送本次修改。
- [ ] 构建高于固定渠道当前版本的新 APK。
- [ ] 发布固定渠道并通过 JSON、HEAD、GET 校验版本、大小和 SHA-256。
