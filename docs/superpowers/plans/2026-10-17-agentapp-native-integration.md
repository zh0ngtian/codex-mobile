# AgentApp 原生界面接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 完整迁移 AgentApp 界面并接入现有真实业务，完成模拟器验收准备，不发布。

**Architecture:** 复用 NativeSnapshot / NativeCommand 及唯一 WKWebView。AppSession 只负责呈现状态映射和命令分发；共享业务维持原有数据归属。RootView 挂载于 NativeUIHost。

**Tech Stack:** SwiftUI、Observation、WKWebView、TypeScript、Vitest、XCTest。

## 任务 1：原始界面与资源导入

- [x] 将 AgentApp/ 除独立 @main 入口之外的代码与资源导入 mobile/ios/AgentUI/；保留页面结构、交互与主题。
- [x] 新增宿主装配回归，先观察新宿主未接入的失败，再让 NativeUIHost 挂载 RootView 并注入 AppSession / AppPreferences。
- [x] 修改 mobile/ios/build-recipe.yml，递归复制 AgentUI 源码与资源，保持既有 iOS 18 最低版本与 Bundle ID。仅生成并构建模拟器 Debug。

## 任务 2：真实业务投影与契约

- [x] 在 tests/native-ui/ 下补充真实导航身份、配置能力、原始用量及附件导入契约；先运行 Vitest 得到预期失败。
- [x] 在 src/native-ui/ 和全局导航适配中提供 AgentApp 所需的显式展示字段；不得投影完整注册表、token 或客户端实例。
- [x] NativeSnapshot、NativeBackend、NativeNavigationItem、NativeGroup、NativePanelItem 增加对应可选 Codable 字段并保持 v1 兼容。
- [x] 执行 npm run typecheck 与相关 Vitest，验证命令上下文、过期回执、隐藏会话和无设备路径。

## 任务 3：AppSession 真实状态与命令

- [x] 用真实 NativeUIStore 注入初始化 AppSession，清空原型示例和模拟执行器；加 Swift 回归验证空启动无演示设备与发送分发。
- [x] 映射服务端身份、列表、消息、commentary、预览、额度、模型配置、队列、审批及草稿；UUID 与原始 ID 双向映射。
- [x] AppSession 的用户动作发送现有命令；输入使用 draft.set 的 revision，操作等待 commandResults，错误保留本地输入且显式展示。
- [x] 运行 Swift 适配回归及 iOS 构建，避免替代网关实现和第二份业务持久化。

## 任务 4：页面交互真实接线

- [x] 设备页面真实测试保存/编辑/扫码/排序/删除；现有业务确认不能被跳过。
- [x] AgentApp 附件选择、位置、提及、模型、强度、权限、设置、通知保存与预览全部调用真实 AppSession；移除模拟专用按钮和成功提示。
- [x] 外观与强调色保留 AgentApp 本地偏好，语言/传输/通知同步既有设置，保留网页模式切换入口。
- [x] 回归真实能力为空和失败状态，不让默认演示能力充当真实值。

## 任务 5：集成、验收与提交

- [x] 使用共用模拟器互斥锁，在 iPhone 17 Pro 正常字号竖屏构建安装。
- [x] 连接用户提供网关，运行真实消息、搜索、模型、草稿、附件、设置验收；新建测试会话验证后归档。
- [x] 双阶段代码审查、修复并复验；更新本轮验证记录，执行 git diff --check。
- [x] 按中文 Conventional Commits 提交并推送 codex/agentapp-native-integration 分支；不整合发布批次、不发包。
- [x] 将已连接应用停留于用户验收页面，交付模拟器与验证结果。
