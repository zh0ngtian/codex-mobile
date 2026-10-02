# 前台恢复轻量化实施计划

> **执行要求：** 按 superpowers 的 planning、TDD、verification-before-completion 流程逐项执行。

**目标：** App 从后台恢复时避免为所有设备重新拉取完整项目和会话列表，同时保持当前会话、连接状态以及已打开侧栏的数据正确。

**架构：** 将前台恢复拆为连接探测、当前会话对账和侧栏刷新三个层次。仅当前选中设备执行轻量 WebSocket 探测；连接健康时只对账当前会话，不刷新项目列表。侧栏已经打开时，由顶层生命周期监听触发既有静默列表刷新；侧栏关闭时，列表刷新推迟到下次打开。恢复事件增加短暂冷却，避免 `visibilitychange`、`pageshow` 和 `online` 连续重复执行。

**技术栈：** React、TypeScript、Vitest、WebSocket JSON-RPC

---

### Task 1：用失败测试定义轻量恢复契约

**文件：**

- 修改 `tests/ui/connection-recovery.test.ts`
- 修改 `tests/ui/sidebar-refresh.test.tsx`

- [x] 健康探测改用 `thread/loaded/list(limit: 1)`，不读取会话列表。
- [x] 健康连接只对账当前会话，不调用项目列表刷新。
- [x] 非当前设备可通过动态条件跳过恢复。
- [x] 恢复完成后的短时间重复事件被冷却合并。
- [x] 侧栏支持显式触发静默刷新，且不影响手动刷新状态。
- [x] 运行聚焦测试并确认当前实现失败。

### Task 2：最小实现分层恢复

**文件：**

- 修改 `src/backends/connection-recovery.ts`
- 修改 `src/features/threads/sidebar-refresh.ts`
- 修改 `src/App.tsx`

- [x] 为连接恢复监听增加动态启用条件和冷却时间。
- [x] 仅当前选中设备绑定有效恢复，并只对账当前会话。
- [x] 侧栏已打开时，回到前台触发一次静默列表刷新。
- [x] 保持探测失败后的完整重连与初始化行为不变。
- [x] 运行聚焦测试并确认通过。

### Task 3：验证与交付

- [x] 运行完整测试、类型检查、生产构建和差异检查。
- [ ] 按提交规范提交并推送本次修改。
- [ ] 构建高于固定渠道当前版本的新 APK。
- [ ] 发布固定渠道并通过 JSON、HEAD、GET 校验版本、大小和 SHA-256。
