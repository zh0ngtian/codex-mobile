# iOS 正式版本原生开关缺失排查与修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 定位并修复已安装 0.2.175 中“使用原生界面”缺失，使正式 Release 配置的默认 Web 界面可实际切换。

**Architecture:** 保留已批准的单业务 WKWebView、显式命令快照、默认旧界面与下次完整启动生效。先在正式构建参数下定位宿主到前端的失败边界；不通过显示一个无效开关、放宽可信首页或新增备用业务栈掩盖问题。

**Tech Stack:** SwiftUI/WebKit、React/Vite、Vitest、XCTest、ictrl、XcodeBuildMCP、releasectl。

## Task 1：取得根因证据

- [x] 用 ictrl 检查实际手机：0.2.175 管理设备首项为传输方式，无原生开关，完整 terminate/launch 后仍复现。
- [x] 检查正式 GitHub unsigned 与 Ad Hoc IPA：原生代码、最新开关文案和宿主标记均包含；未将“更新源未配置”直接当作开关根因。
- [x] Release 模拟器宿主flag为true、handler为function，原始href位于/Users路径；真机诊断为bridge存在、handler为function、host为null，原始href位于/private/var路径。使用真实存在的/private/var目录验证Foundation.standardizedFileURL改写为/var，真机进一步直接记录可信URL为/var，实际href为/private/var，确认JS守卫拒绝。详见 [脱敏根因证据](evidence/2026-10-15-native-switch-missing-root-cause.json)。
- [x] 最小修改限定 `mobile/ios/NativeUI/NativeUIBridge.swift` 与 `NativeUITrust.swift`，回归在 `tests/ci/native-ui-trust-fixture.swift`、`ios-native-ui.test.ts`。真实创建 `/private` 别名下的首页，先证明 raw 与 standardized 不同，再执行生产Swift生成的JS。

实现约束：
```swift
// 使用和 WebView.loadFileURL 一样的资源URL；JS收到原始absoluteString。
private let trustedURL = Bundle.main.url(forResource: "index", withExtension: "html")
// NativeUITrust中的生成器保留trustedURL.absoluteString；Swift accepts仍标准化比较。
```
资源缺失应明确不可用，不新增任意路径fallback。JS继续仅允许window.top中的file:首页严格匹配，原生继续校验主文档、query/hash和精确首页。

## Task 2：回归与最小修复

- [x] 真实/private/tmp存在文件的生产Swift脚本回归先失败：bootstrap未设置宿主flag；保留RED日志switch-url-red.log。
- [x] 只修复原始首页URL的选择与JS编码；原生标准化精确比较和业务行为不变，缺资源明确错误。
- [x] 14项真实Swift脚本契约通过，Release模拟器构建运行成功，3项原生/设置UI用例通过；真机诊断候选host恢复true，ictrl实际读到管理设备顶部开关value=0，未更改用户偏好。
- [x] 独立规格审查、随后质量审查均approved。

## Task 3：发布与交付

- [x] 107项CI构建契约、157项发布Python、30项协调器测试和typecheck通过；中文日志只列本次可感知修复。
- [x] 固定修复SHA `6db54bc0eecbf01d0311a95732a9761813cc6a1f` 已推送并ready；协调器冻结 `b02829442883b23cb7ed8a9e963f92ece4cc3769`，分配0.2.176/2176。
- [x] 成功批次 `e691dd32-f0a5-4984-80df-06e97c27b588` 的共同凭证、双端CI、固定APK/签名IPA/HTTPS OTA、unsigned软件源与中文日志均核对；独立HEAD和完整GET散列一致。详见[发布验收](evidence/2026-10-15-native-switch-missing-release.json)。
- [ ] 候选真机已用ictrl确认开关value=0；正式0.2.176签名包已覆盖安装，最后启动遇系统锁屏，待用户解锁后复核正式页面。未卸载或修改用户界面偏好。
