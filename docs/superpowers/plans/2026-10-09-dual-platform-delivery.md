# APK 与 IPA 对齐交付实施计划

> **For agentic workers:** 在当前会话按 superpowers:executing-plans 执行，沿用 test-driven-development 与 verification-before-completion；规则文档修改不新增复述正文的测试，发布前运行现有构建契约测试。

**Goal:** 每次交付同步提供 APK、IPA 固定渠道链接、统一版本、各自大小与 SHA-256，并注明 IPA 是否签名。

**Architecture:** 在项目 AGENTS.md 固化双平台构建与回复要求。推送后从同一提交源码快照构建两个安装包，版本高于两个渠道当前版本；分别通过清单、HEAD、完整 GET 核验。

**Tech Stack:** 现有 Vitest 构建契约、PakePlus Android、Xcode、固定局域网发布脚本。

- [x] 阅读交付及提交规范，检查现有 APK 0.2.98、IPA 0.2.97，确认 IPA 尚未包含本次传输开关。
- [x] 更新 AGENTS.md：每次同步构建两个安装包，回复信息按 APK 对齐，并说明 IPA 签名状态。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ci --exclude '**/.mobile-build/**'` 和 `git diff --check`。
- [ ] 按中文 Conventional Commits 提交并推送规则修改。
- [ ] 从已推送提交构建 APK、IPA 0.2.99，沿用 Android 签名，iOS 按现有未签名构建流程打包。
- [ ] 检查两个包版本、嵌入前端的传输方式功能、Android 签名与 IPA 实际签名状态。
- [ ] 使用 `apk-server.py publish-channel codex-mobile <安装包> --version 0.2.99 --notes <说明>` 分别发布 APK、IPA。
- [ ] 分别核验固定 JSON、HEAD、完整 GET 的版本、文件大小及 SHA-256，交付证据保存到 `.mobile-build/dual-delivery-release/delivery.json`。
- [ ] 清理本次临时源码与构建辅助文件，回复两个下载链接及各自校验信息。
