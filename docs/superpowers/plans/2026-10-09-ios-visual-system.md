# iOS 统一视觉规范与原生体验实施计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development / executing-plans 执行；独立 Apple API 复审负责机制检查，主任务负责连续 UI 决策、实现与集成。修改交互先获得真实失败回归，再实施与视觉验收。

**Goal:** 以 ui-ux-pro-max 的阅读、触控与层级规范约束原生对话，让紧凑输入、短消息和系统大字号都有可检查的表现。

**Architecture:** 保留 UIKit 时间线 / UITextView 与 React 权威业务桥接。新增共享 Appearance 管理字体、间距、图标和语义颜色；布局按内容与系统字号适配。设计规范保存到 design-system/codex-mobile/MASTER.md。

**Tech Stack:** UIKit / UIFontMetrics / UIContextMenuInteraction / XCTest / TypeScript。

## 1. 规范与失败证据

- [x] 确认 ui-ux-pro-max 检索适用项，舍弃营销页、网页字体和非用户指定配色，保存中文 Master。
- [x] 新增空态紧凑输入 UI 回归：默认空输入区域高度不超过 64pt，输入与发送/附件均可操作。
- [x] 新增系统最大字号 UI 回归：正文/输入字号实际变大，按钮仍至少 44pt，输入内容与键盘可见。
- [x] 先在上一版运行上述用例，记录真实失败。

## 2. 原生落地

- [x] 新增 NativeConversationAppearance.swift，集中 4/8pt 视觉参数、系统字体角色、动态字号与足够对比的次级文字。
- [x] Controller 使用统一图标配置与真正 SF chevron，默认紧凑输入，多行/辅助字号扩展；刷新环境时保持草稿与阅读锚点。
- [x] Cell 使用可读最大宽度、短消息适合文字的气泡和系统消息上下文菜单/VoiceOver 操作；代码/表格采用一致字体与圆角。
- [x] 移除 reduce-motion 下程序滚动与 sheet 动画，保留原生触控反馈。
- [x] 修改复制源码流水线及相称的契约回归，原有业务协议不变化。

## 3. 验收与交付

- [x] 实际检查默认/大字号、浅色/深色、375pt 小屏、大屏和横屏/平板受支持范围；不以源码检查代替截图。
- [x] 运行新增 UI 回归与原有草稿、发送、历史锚点回归；UI helper 只归档本轮产生的测试会话。
- [x] 检查相关 Vitest、TypeScript、前端构建、Foundation、Git diff 和独立 Apple API 复审。
- [ ] 按中文 Conventional Commits 提交推送并合入 main；统一更高版本构建 APK 与已签名 IPA，发布固定 LAN 与 HTTPS OTA。
- [ ] JSON、HEAD、完整 GET 核对双端版本、字节与 SHA-256，保留截图、停止临时网关、归档 worktree。


## 验收证据

- 旧版两个新用例真实失败：紧凑输入跨度 88pt，大字号输入仍为 44pt；新版两用例均通过。
- iPhone 17 Pro / iOS 26.5 与本轮专用 iPhone SE 3 / 375pt：紧凑输入、多行展开、最大辅助字号、中文草稿与键盘收起通过；真实发送、Markdown、分页、阅读锚点、用户消息长按菜单通过。
- 截图：`docs/assets/ios-simulator/visual-system/`；浅色、深色、最大字号正文/输入和键盘画面均已实际检查。包保留 iPhone / iPad，竖屏为支持声明；iPad Pro 13 竖屏居中阅读、空输入与多行键盘均通过，未新增横屏支持。
- Vitest 824 / 92 文件、Python iOS 87、Markdown 37 与 NativeConversationState 检查通过；独立 Apple API 实现复审无交付阻碍，富内容 VoiceOver 操作已补齐。
- 本次测试创建会话仅为 Markdown 阅读验收、NATIVE_IOS_OK 和短消息 OK；视觉证据完成后归档，用户历史会话只读。

- 追加视觉缺陷回归：最大字号末列文字左侧原为 7.5pt（小于阅读边界20pt），修复列宽上限后完整可见断言通过。

- Xcode 的部分结果包导出收尾超时，验收断言已结束并显示通过；UI helper 同时保存同一 screenshot 的 PNG 原图到测试 Runner Documents，平板和短气泡证据由此保留。
