# iOS 本地构建与模拟器验证实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话逐项执行；本任务共享生成工程和模拟器状态，不委派子 Agent。

**Goal:** 提供能本地生成、构建并在 iOS 模拟器运行的 Codex Mobile，完成实际交互验证。

**Architecture:** 复用固定提交的 PakePlus iOS 容器和当前 React 前端。本地准备脚本读取现有 iOS CI 的构建、配置与原生硬化步骤，避免维护第二套容器补丁。生成工程保存在忽略的 `.mobile-build/ios/`，私人连接配置只保存在模拟器本地。

**Tech Stack:** Node.js、YAML、SwiftUI、WKWebView、XcodeBuildMCP、Vitest。

---

### 任务 1：可重复生成本地 iOS 工程

文件：`scripts/prepare-ios.mjs`、`tests/ci/ios-local-build.test.ts`、`package.json`、`.gitignore`。

- [x] 先写本地计划测试：断言固定容器提交、构建步骤顺序、生成工程位置；错误版本及缺失硬化步骤必须拒绝。
- [x] 执行 `npm test -- tests/ci/ios-local-build.test.ts`，确认失败原因是缺少本地构建入口。
- [x] 实现 `npm run ios:prepare -- --version 0.2.91`：下载固定容器、构建内置前端、沿用 CI 配置及硬化、生成所有尺寸图标，并输出 Xcode 工程路径。`--plan` 只显示计划，不产生文件。
- [x] 重新执行上述测试及 `tests/ci/mobile-packaging-workflows.test.ts`，确认通过。

### 任务 2：模拟器构建与实际流程测试

- [x] 生成工程后，用 XcodeBuildMCP 配置 PakePlus scheme、iPhone 17 Pro / iOS 26.5 和独立 DerivedData。
- [x] 执行 `build_run_sim`；用户已明确要求模拟器测试，允许启动当前关闭的模拟器。
- [x] 检查首次启动及安全区，确认内置静态前端加载成功。
- [x] 在模拟器通过 UI 添加网关，验证错误地址可重试、成功保存、会话列表与详情、消息输入发送及结果、退出重启后设备配置保留。
- [x] 有缺陷时先补失败回归测试，再修复并重新构建。保留截图和可复现验证记录。

### 任务 3：文档、提交与交付

文件：`README.md`、`docs/ios-simulator-verification.md`。

- [x] 文档写明准备、构建、模拟器流程、实际验证结果和真机签名边界。
- [x] 执行 `npm run typecheck`、相关 Vitest 和 `git diff --check`。
- [ ] 按 `docs/commit-conventions.md` 提交本次修改并推送。
- [ ] 读取固定渠道版本后，以更高版本构建 APK，发布固定渠道；用 JSON、HEAD、完整 GET 核对大小和 SHA-256。
- [ ] 交付 iOS 工程、模拟器证据及 APK 固定链接，移除本次不再需要的临时文件。

## 交付前证据

- 实际首次连接测试与最终完整 XCTest 均通过；最终集成测试耗时约 26.6 秒。
- TypeScript 检查和 21 项相关 Vitest 通过。
- 发现并修复键盘遮挡及原生版本号固定为 1.0 两个问题；版本为 0.2.91，build 为 2091。
- 未签名 iPhoneOS Release 构建及流水线 IPA 验证通过。
- 提交、推送、APK 发布与摘要核验属于本次提交后的交付动作，结果在交付回复中报告。
