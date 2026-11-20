# iPhone 换行键提示与客户端发布计划

> 使用 superpowers:executing-plans 在当前任务逐项执行，沿用已完成的 TDD 证据，由主执行者检查代码与交付结果。

**目标** 将换行键提示修复整合到 main，发布 GitHub APK、unsigned IPA，并核对既有 iOS 软件源。

**架构** 使用现有发布主机的 releasectl、项目 codex-mobile-github-only 与共享锁 codex-mobile-main-production。协调器执行 main、build、source、verify，分配版本、冻结并推进正式分支。

**工具** Git、Vitest、Python unittest、Xcode、GitHub Actions、releasectl。

**依据** 用户明确要求 push main 并发布 Release，仓库 AGENTS.md、发布协调说明与交互约定。

## 范围与约束

- 本次发布起始 main 基线为 `7c941ee6c89dbd871bdbfa60eec8cf09c11334d3`，原功能来源为 `3364b381bbb0c5a527b192de3085ac27e0dc5235`。
- 最近两端客户端标签为 v0.3.48，冻结提交为 `972e3462409cdfadba848f36e3ca83509ed32fb5`。新版本由协调器按标签、仓库下限和失败预留分配。
- 包含 iOS 原生换行键显示、Xcode 16.4 编译兼容及 main 中待发的远程连接提示修复。发布日志只写用户可见变化。
- 软件源复用既有 unsigned IPA 订阅，读取实际 gh 登录用户名并保留已有开发者署名。
- 本轮仅发布客户端。旧渠道、签名材料与历史失败批次按现行合同保留。

## 任务一 登记与来源检查

- [ ] 在现有发布主机登记 ios-return-key-github-only-20261120，持续 heartbeat。
- [x] 核对最新 main、v0.3.48 标签和待发客户端差异，更新中文 release/notes.md。
- [x] 已有控件编译回归先失败后通过，6 文件 25 项相关回归和完整 Debug 构建通过。旧 SDK 使用现有兼容样式。
- [x] iPhone 16 Pro／iOS 18.6 离线调试确认实际换行标签、两行草稿及发送。临时实例已清理，没有远程测试会话。
- [ ] 在具备相应 SDK 的环境完成 iPhone 17 Pro、正常字号、竖屏的本次原生交互验收。

## 任务二 发布门禁与就绪

- [x] adapter-regression 290 项通过，1 项既有跳过，日志及散列已保存到仓库外私有验证目录。
- [x] build-contract 22 文件 164 项通过，typecheck 退出 0，日志及散列已保存。
- [ ] 在现有发布主机完成 coordinator-recovery，核对实际安装的协调器版本与验证结果。
- [ ] 重新核对远端 main。有新提交时整合后回归受影响范围。
- [ ] 提交并推送固定来源 SHA，生成仓库外的验证记录，heartbeat 标记 closing 后提交 ready。

## 任务三 构建发布与独立回验

- [ ] 等待 main、build、source、verify 完成，核对成功 receipt、固定 SHA 和任务包含关系。
- [ ] 独立完整下载本批 APK 和 unsigned IPA，逐项核对文件名、字节数和 SHA-256。
- [ ] 核对既有 iOS 软件源版本、IPA 地址与散列、中文日志和开发者署名。
- [ ] 保存公开白名单凭证，注明 distribution=github-only、两端 platforms 和 softwareSourceUpdated=true。
- [ ] 更新交互约定的发布状态，交付 Release、APK、未签名 IPA、软件源链接及本批文件大小和散列。

## 当前执行状态

发布说明及本机可执行的三项门禁已完成。历史发布主机 macmini.local 无法解析，192.168.123.79 连接超时，本机没有 releasectl。等待现有发布主机的可用 SSH 地址和用户名，以完成登记、协调器恢复验证和正式发布。任务尚未登记、未提交 ready、未冻结或分配发布版本。
