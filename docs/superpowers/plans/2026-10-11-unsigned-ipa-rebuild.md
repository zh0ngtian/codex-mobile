# 未签名 IPA 云端重构计划

> **For agentic workers:** 在当前会话使用 superpowers:executing-plans，按任务执行 TDD 与 verification-before-completion。

**Goal:** 从最新客户端源码及用户的 Windows 兼容分支重新编译未签名 IPA，提供可下载文件。

**Architecture:** 在独立构建分支复用 prepare-ios.mjs 和 iOS build-recipe.yml。GitHub macOS runner 使用 Xcode 关闭签名，执行现有打包校验，并将产物保存为独立预发布附件。

**Tech Stack:** Node.js 22.14.0、pnpm 10、Xcode 26.3、GitHub Actions、Vitest。

**Spec:** 用户明确只需要重新构建的未签名 IPA；无需签名或软件源发布。

## 全局约束

- 版本使用 0.2.147；Bundle ID 保持 vip.loock.codexmobile。
- 不向云端传递软件源 token、签名材料或本机发布配置。
- 不覆盖现有正式签名渠道；构建预发布不标记为 latest。
- 使用独立 worktree 和构建分支，保留用户原有分支。
- 沿用项目固定的 PakePlus 提交及原生补丁。

## 审查重点

- 非法版本不得进入 shell 或原生构建。
- 准备、编译或打包失败必须中止成功交付。
- IPA 必须包含 Payload、应用二进制、内置前端和正确版本。
- 关闭签名，不调用 ios:release 或软件源上传器。
- 下载后的文件大小及完整 SHA-256 必须与构建凭证一致。

### 任务 1：复用构建配置的未签名入口

文件：scripts/build-unsigned-ios.mjs、tests/ci/unsigned-ios-build.test.ts。

- [x] 先写测试：合法版本可在 Windows 预检；非法版本失败。
- [x] 运行测试，确认缺少构建入口而失败。
- [x] 添加 --plan 预检与正式构建；准备后执行配置中的编译和 IPA 校验步骤。
- [x] 运行入口测试和现有移动构建配置测试：15 项通过。

### 任务 2：云端构建与下载

文件：.github/workflows/build-unsigned-ipa.yml。

- [x] 限定构建分支 push 触发，使用 macos-15-intel 与 Xcode 26.3；文档收尾不重复触发构建。
- [x] 安装依赖，运行完整测试和未签名构建；保存构建日志。
- [x] 使用 runner 自带 GitHub token 生成独立预发布下载附件。
- [x] 按中文提交规范提交并推送，核对远端提交并跟踪运行。

### 任务 3：交付核验

- [x] 确认云端构建成功，下载 IPA、摘要及构建日志。
- [x] 检查 Payload、版本 0.2.147、构建号 2147、无描述文件及完整 SHA-256。
- [x] 准备新 IPA 下载链接、未签名状态、版本、大小和 SHA-256 交付信息。

## 基线

原 Windows 工作区完整测试存在已报告的环境及上游平台兼容失败；本次云端在 macOS 执行完整套件，并如实保存失败日志。此次构建分支已合入 origin/main 的追加消息布局修复。

首轮云端运行 38108941725：904 通过、1 失败、2 项 Windows Job 测试跳过。失败为 HTTP 快照压力测试在固定 150 ms 后过早读取通知队列；改为等待实际完成状态及工具通知就绪，保留原有预算、分页和完成事件断言，不修改服务端运行代码。

第二轮 38109262726：快照测试通过；大图片历史读取测试在共享 runner 上超过 15 s，仍为 904 通过、1 失败、2 跳过。云端测试改为两个 worker、60 s 单项超时，减少 CPU/磁盘竞争；不跳过测试或降低功能断言。

## 最终交付证据

- 构建提交：8ba09be2f9687cad26cdabc541e7eb7c2d70af91。
- GitHub 运行：38109534062，完整测试 905 通过、2 项 Windows 专用测试跳过；Xcode 显示 BUILD SUCCEEDED。
- 版本：0.2.147；构建号：2147；Bundle ID：vip.loock.codexmobile。
- 大小：3,758,080 字节。
- SHA-256：9c60af68c37f1ad034d30dd13ee2acc5be1e494e06aee129fd69e738de54d9a1。
- 下载：[CodexMobile-v0.2.147-unsigned.ipa](https://github.com/zh0ngtian/codex-mobile/releases/download/unsigned-ipa-0.2.147-38109534062-1/CodexMobile-v0.2.147-unsigned.ipa)。
- 本机完整 GET、HEAD 和标准库 ZIP/Info.plist 校验通过；确认存在真实 Mach-O 二进制与内置前端，没有 embedded.mobileprovision 或应用 CodeResources。
- 根据用户明确要求，本次仅交付重新编译的未签名 IPA，不执行签名及正式渠道发布。
