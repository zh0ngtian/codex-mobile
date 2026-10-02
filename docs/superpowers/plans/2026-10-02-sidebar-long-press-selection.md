# 侧栏长按误触文字选择修复实施计划

> **执行要求：** 按 superpowers 的 systematic-debugging、TDD、verification-before-completion 流程逐项执行。

**目标：** 修复 Android WebView 中长按会话侧栏时弹出系统“选择文字”界面的问题，同时保留会话长按管理菜单、列表滚动和搜索框文字选择。

**根因证据：** 会话行使用 500ms 前端计时器识别长按，并在 `contextmenu` 阶段阻止默认行为；Android WebView 的原生文字选择也会在长按期间启动。现有 `user-select: none` 只覆盖会话行，侧栏其他非编辑文本未建立统一选择边界，且测试只覆盖 Pointer Event，没有验证可取消的 `selectstart` 默认行为。

**修复策略：** 在侧栏根节点捕获 `selectstart`，对非编辑区域取消默认选择；`input`、`textarea` 和可编辑元素继续允许选字。既有会话行 Pointer Event 长按逻辑保持不变。

## 任务 1：先写失败回归测试

**文件：**

- 修改 `tests/ui/thread-list-page.test.tsx`

1. 触发会话行和侧栏标题的 `selectstart`，断言默认行为被阻止。
2. 触发搜索输入框的 `selectstart`，断言默认行为仍被允许。
3. 运行聚焦测试，确认当前实现因没有侧栏选择边界而失败。

## 任务 2：最小实现并通过聚焦测试

**文件：**

- 修改 `src/features/threads/ThreadListPage.tsx`

1. 为侧栏根节点增加引用。
2. 注册可清理的捕获阶段 `selectstart` 监听器。
3. 仅允许输入框、文本域和可编辑元素保留原生文字选择。
4. 运行会话侧栏单元测试并确认长按管理、滚动取消和选择边界全部通过。

## 任务 3：完整验证与交付

1. 运行完整单元测试、类型检查和生产构建。
2. 检查差异，只提交本次修复与计划，不覆盖工作区原有的输入框样式修改。
3. 推送 `main`，构建高于固定渠道当前版本的新 APK。
4. 发布到 `codex-mobile` 固定局域网渠道，通过 JSON、HEAD、GET 核对版本、文件大小和 SHA-256。
