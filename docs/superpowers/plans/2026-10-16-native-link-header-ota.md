# 原生链接与顶部图标修正计划

> **For agentic workers:** 使用 Superpowers 计划与 TDD 流程，按以下步骤在当前独立 worktree 执行。

**Goal:** 链接使用虚线下划线，右上角三个图标统一视觉尺寸；本对话按用户新指令仅发布 OTA。

**Architecture:** 沿用 NativeInlineMarkdown 的原生 AttributedString、SF Symbols 与上下文环；共用24pt图标边界、44pt触区。保留真实链接目的地与既有菜单行为。发布复用现有本机构建、Ad Hoc签名、HTTPS OTA与固定IPA入口，在已有协调器同一作用域租约内串行执行。

**Tech Stack:** SwiftUI、原有Swift smoke/XCTest、现有iOS发布组件。

- [x] 在现有Swift smoke中覆盖网页/文件链接虚线属性、不影响普通文字和真实目的地，先确认红灯。
- [x] 链接样式集中在共用解析结果设置，覆盖正文、列表、标题与表格；移除实线覆盖。
- [x] 顶部三图标共享24pt视觉边界与44pt触区，圆环描边内缩避免额外膨胀。
- [x] 运行原生相关回归、iOS编译及同状态截图，确认虚线可见、三图标一致且入口可操作。
- [ ] 提交推送固定SHA；本轮不提交普通客户端ready以免触发GitHub双端Release，不构建APK、不更新软件源。
- [ ] 在既有发布协调器共享作用域中取得排他租约，确认没有进行中批次，读取所有渠道/保留版本后递增；复用现有身份预检、iphoneos构建与签名组件发布OTA及同一签名IPA固定地址。
- [ ] 回验HTTPS清单/manifest/页面、IPA HEAD/完整GET/散列，保留凭证；未创建真实测试会话，模拟器验证后关闭。

本轮分发范围是用户对本对话的显式覆盖，不修改仓库的默认双端正式发布策略。

验证证据：`/tmp/native-link-header-red.log`先因链接未应用虚线失败，`/tmp/native-link-header-green.log`15项通过；`native-link-header-ui.xcresult`真实iOS编译和中文主流程通过。同状态图片及局部对照保存在当前聊天 visualizations 的 `native-link-header-fix/`。
