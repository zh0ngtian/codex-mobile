# 侧栏静默刷新实施计划

> **执行要求：** 按 superpowers 的 planning、TDD、verification-before-completion 流程逐项执行。

**目标：** 打开会话侧栏时继续获取最新会话，但保留现有列表且不显示刷新或设备加载转圈；首次加载、手动刷新和连接恢复仍保留明确的加载反馈。

**架构：** 将侧栏打开触发的刷新与用户手动刷新拆成两个独立版本信号。静默刷新复用当前 WebSocket 客户端和列表加载器，但禁止发布项目 `loading` 状态；数据返回后仍通过既有回调原子更新列表。手动刷新沿用当前可见加载状态。

**技术栈：** React、TypeScript、Vitest、WebSocket JSON-RPC

---

### Task 1：用失败测试定义静默刷新契约

**文件：**

- 修改 `tests/ui/sidebar-refresh.test.tsx`
- 修改 `tests/ui/thread-list-loader.test.ts`

- [x] 侧栏从关闭变为打开时只递增静默刷新版本，不递增可见刷新版本。
- [x] 手动刷新仍递增可见刷新版本。
- [x] 列表加载器在静默模式下仍请求并提交最新数据，但不触发项目开始加载回调。
- [x] 运行聚焦测试并确认当前实现失败。

### Task 2：最小实现静默刷新

**文件：**

- 修改 `src/features/threads/sidebar-refresh.ts`
- 修改 `src/app-server/thread-list-loader.ts`
- 修改 `src/App.tsx`

- [x] 增加独立的 `silentRefreshVersion`，侧栏打开只触发该信号。
- [x] 为列表加载器增加可选的静默参数，静默时跳过 `onProjectStart`。
- [x] 后台工作区收到静默信号后复用现有连接刷新，不设置 `refreshing` 或列表骨架状态。
- [x] 运行聚焦测试并确认通过。

### Task 3：验证和交付

- [x] 运行完整测试、类型检查、生产构建与差异检查。
- [ ] 只暂存并提交本任务文件，保留工作区原有未提交修改。
- [ ] 推送 `main`。
- [ ] 构建高于固定渠道当前版本的 APK，并发布到 `codex-mobile` 固定渠道。
- [ ] 通过固定 JSON、HEAD、GET 校验版本、字节数与 SHA-256。
