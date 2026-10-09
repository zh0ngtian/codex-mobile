# iOS 侧栏长按误触文字选择修复实施计划

> **执行要求：** 按 superpowers 的 systematic-debugging、TDD、verification-before-completion 流程逐项执行。

**目标：** 修复 iOS WKWebView 长按会话侧栏时仍打开系统文字选择界面的问题，同时保留会话长按菜单、侧栏滚动和搜索框文字选择。

**根因证据：** 现有修复在侧栏捕获 `selectstart`，并只在 `.thread-row` 上设置 `user-select: none`。WKWebView 可以在 JavaScript 事件前启动原生选词，且缺少侧栏级 `-webkit-user-select` 与 `-webkit-touch-callout` 限制，因此 iOS 仍会进入系统文字选择。

**修复策略：** 在侧栏根滚动容器同时设置 WebKit 和标准的禁止选择规则，并关闭 WebKit 长按呼出；在搜索输入框显式恢复文字选择和触摸呼出。保留现有 JavaScript 监听作为 Android 和浏览器兜底。

## 任务 1：先写失败回归测试

- 修改 `tests/ui/layout-css.test.ts`。
- 断言 `.thread-list-page` 包含 `-webkit-touch-callout: none`、`-webkit-user-select: none` 和 `user-select: none`。
- 断言 `.search-box input` 显式恢复 WebKit 与标准文字选择。
- 运行聚焦测试，确认当前 CSS 不满足契约。

## 任务 2：最小实现与验证

- 修改 `src/styles.css`，建立侧栏级 WebKit 选择边界并恢复搜索框选字。
- 运行布局 CSS、侧栏组件聚焦测试，再运行完整单元测试、类型检查和生产构建。

## 任务 3：双平台交付

- 提交并推送本次修复。
- 重新读取 Android、iOS 固定渠道，选择同时高于两者的新统一版本。
- 从已推送提交同时构建 APK 和未签名 IPA。
- 分别发布两个固定渠道，并通过各自清单、HEAD、完整 GET 核对版本、大小和 SHA-256。
- 清理临时构建文件，交付两个固定链接及签名状态。
