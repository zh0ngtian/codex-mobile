# Windows 项目名称修复的 GitHub Release 计划

> 执行方式：superpowers:executing-plans；功能变更使用 superpowers:test-driven-development，发布前验证真实输出。

**目标：** 按用户明确要求，仅由 GitHub 构建并创建包含 APK 与 unsigned IPA 的新版 Release。

**架构：** 在冻结批次验证器增加明确的 GitHub Release 目标，沿用现有主分支串行双端工作流及回执/标签校验。新增批次绑定实际已推送任务 SHA、真实通过的检查和中文更新日志，不冒用局域网发布或协调器数据库状态。

**技术栈：** Node.js、Vitest、GitHub Actions、现有 Android/iOS 构建配置。

**设计依据：** 用户指示“github 编出 release 就行，不需要你发布”；项目名修复来源为 `1c54d6076576268f779faab1f21e690e96ffae16`。

## 约束与审查重点

- 本次 GitHub 产物范围是 APK 与未签名 IPA；无需 Mac 本机签名、LAN、OTA 或软件源操作。
- 使用 `codex-mobile-github-release` 目标/项目与 `github-release` 环境，继续使用 `codex-mobile-main-production` 工作流串行作用域。
- 保留 main、完整历史、精确冻结 SHA、任务祖先、回执散列与标签来源校验。
- 版本须高于全部现有 GitHub Release/正式标签及仓库下限；冻结时再次检查。
- 发行说明来自冻结清单文本，经 Node 写入文件，避免 shell 插值；原清单未提供说明时保留默认产物信息。

## 任务 1：支持明确的云端发布目标和更新日志

**文件：** `scripts/validate-release-batch.mjs`、`.github/workflows/build-mobile.yml`、`tests/ci/release-batch.test.ts`。

- [x] 为 GitHub 目标的双端输出、目标/环境错配、发行说明文件添加行为测试，观察当前验证器拒绝新目标/参数：3 项预期失败。
- [x] 增加目标映射及 `--notes` 文件输出，令现有发布步骤读取该文件。
- [x] 冻结批次/移动打包契约共 41 项通过，typecheck 与独立审查通过；按仓库规范提交推送。

## 任务 2：冻结、构建与验收

- [ ] 基于最新版 GitHub Release 与标签分配统一更高版本，生成新 UUID 批次与实际输入指纹，引用已验证任务提交。
- [ ] 将新的 `.release-batch.json` 单独冻结提交；运行真实冻结验证，非强制推送 main。
- [ ] 等待相同冻结 SHA 的 Development Checks、Android/iOS 构建及 Release 创建成功；不重复触发同一批。
- [ ] 校验 Release tag 指向、双端回执、完整 GET 大小和 SHA-256，提供 GitHub Release 与下载链接，注明 IPA 未签名。
