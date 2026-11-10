# Android Material You 原生版本

## 已确认范围

用户选择方案 A：Kotlin / Jetpack Compose 负责原生界面，共享 TypeScript 业务继续由唯一隐藏 WebView 执行。功能对齐现有 iOS 原生版；本次交付源码，不发布安装包、不部署网关。

开始时本地主工作区 main 为 `7772b28f5e716d8e5e3759fb1e84a089158502ec`，远端 main 基线为 `66473c26a4621315536fcd76b28b8822c10e1674`。独立 worktree 从远端基线开始，主工作区已有暂存内容不纳入本次修改。

## 实施与验收

- [x] 可信文档启动桥、快照、命令、生命周期和界面切换；复用 contextId、输入版本与命令回执。
- [x] Compose Material 3 主题、动态取色、侧栏、搜索、会话、输入和设置；消息使用原生文本与媒体组件。
- [x] 接通设备、项目、模型、权限、附件、审批、队列、草稿、历史编辑、Sidechat 和引用。
- [x] 完善抽屉手势、页面进退、底部弹层、列表展开、键盘避让、发送/停止和加载动效；尊重系统动画缩放。
- [x] 构建 recipe 同步接入，本地 Android 工程准备入口可重复执行；执行桥接回归、类型检查、Android 编译和设备验证。
- [x] 更新现行交互文档、架构和构建说明，代码审查后按 main 写入互斥整合并推送。

## 模块边界

`mobile/android/native-ui/bootstrap.js` 只在内置首页启用桥；`AndroidNativeHost.kt` 管理可信来源、启动偏好、宿主生命周期与 Compose 层；`NativeModels.kt` 解码展示 DTO；`NativeState.kt` 管理输入/回执与呈现状态；其余 Compose 文件分别负责主题动效、导航、对话、通用业务面板及原生富文本媒体。业务请求和本地持久化仍归现有共享层。

## 验证状态

实现及关联验证见[Android 原生验收记录](../android-native-verification.md)。TypeScript 105项关联回归、类型检查、前端与工程准备、Android 编译和 R8 检查通过；完整 Android 16 镜像17项 instrumentation 通过，含系统选文、链接点击与真实共享业务设备表单，已保存视觉证据。独立代码复审已完成，已修复确定问题。真机及真实网关端到端验收仍待进行，源码交付不等同于发布。
