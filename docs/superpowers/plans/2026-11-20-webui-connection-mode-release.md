# WebUI 连接模式与 GitHub 客户端发布计划

> 按 Superpowers 计划、TDD 和逐项验收流程执行。

**目标** 发布含连接模式卡片及主分支待发修复的客户端。

**范围** 以远端 main `6211b7dd` 为基线。上个 Android 与 iOS 正式版本均为 `0.3.47`（`248b05eb`）。待发内容包含 iOS 原生设备连接、侧栏刷新和排队消息操作变化，使用 `codex-mobile-github-only`，仅执行 main、build、source、verify。

**工具** Vitest、Python unittest、XCTest、releasectl、GitHub Actions。

- [x] 在独立工作树取 `6211b7dd^`，复制 `6211b7dd` 的 `tests/ui/remote-gateway.test.tsx`。执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/remote-gateway.test.tsx`，旧页面因缺少标为「连接模式」的单选组产生 1 项预期失败。候选源码的连接设置、侧栏、网页配图和原生桥接回归共 124 项通过。
- [x] 在专用 iPhone 17 Pro 模拟器以正常字号、竖屏执行现有 `AgentAppUITests/testGatewayModePickerKeepsAddressAndDoesNotStartTesting`、`testExpandedProjectRemainsVisibleThroughoutRefreshAndHeightUpdates` 及 `testQueuedMessageActionsShareOneRow`。3 项通过，使用离线夹具。
- [x] 核对 `v0.3.47..6211b7dd` 的用户可见差异，更新 `release/notes.md`。290 项适配器回归、59 项协调器恢复、164 项构建契约及类型检查通过。构建契约首次与 iOS 工程准备的依赖安装重叠，安装结束后顺序重跑通过。
- [ ] 将发布说明和计划提交到独立分支，推送后提交绑定该 SHA 的验证记录。任务为 `webui-connection-mode-github-only-20261120`。间隔最多 45 秒检查批次，直至协调器生成成功回执。
- [ ] 核对回执中的任务包含关系、冻结 SHA、四阶段和版本。通过 GitHub 重新完整下载同版 APK 和未签名 IPA，核对大小与 SHA-256。核对现有 iOS 软件源同版 IPA、中文日志及开发者署名。将结果写入交互与功能约定。
