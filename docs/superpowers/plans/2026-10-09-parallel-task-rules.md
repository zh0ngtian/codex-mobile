# 多任务协作规则与交付计划

> **For agentic workers:** 使用 superpowers:executing-plans 在本任务工作树连续执行；本次仅修改协作规则，不委派子 Agent。

**Goal:** 明确任务工作树隔离、共用模拟器排队及固定渠道发布排队，并按现有规则完成交付。

**Architecture:** 规则维护在项目 AGENTS.md。独立工作树仅提交本次文档，集成远端 main 后推送；发布使用同一已推送源码和统一递增版本。

**Tech Stack:** Markdown、Git、GitHub Actions、固定局域网发布脚本。

---

### 任务 1：写入规则

- [x] 在 AGENTS.md 增加“多任务协调”：各任务在自己的 worktree 开发和构建；共用模拟器排队验证；固定渠道版本分配、双端发布和校验排队。
- [x] 人工核对用户要求和文档差异。本次无生产代码修改，遵守仓库要求，不为文字规则编写复述实现的测试。
- [ ] 运行 git diff --check、git diff --cached --check，确认暂存仅含 AGENTS.md 和本计划。
- [ ] 按 docs/commit-conventions.md 使用中文 Conventional Commits 正文提交，集成远端 main 并推送。

### 任务 2：排队交付

- [ ] 等待已有移动端发布流程结束，读取 Android/iOS 固定清单和 GitHub Release 版本，选取统一更高版本。
- [ ] 从已推送提交触发 Build Mobile Apps，确认 Android 与 iOS 构建成功，下载对应 APK 和未签名 IPA。
- [ ] 分别检查包内版本、大小和 SHA-256，发布到固定 codex-mobile 渠道。
- [ ] 通过两个固定 JSON、HEAD 和完整 GET 核对版本、大小和 SHA-256；交付注明 IPA 签名状态。
- [ ] 保留安装包和交付证据，清理本次无用临时文件并归档本任务工作树。

交付结果保存在主工作区忽略目录 `.mobile-build/parallel-task-rules-release/delivery.json`；本计划的交付步骤执行后以该文件和最终回复为准。
