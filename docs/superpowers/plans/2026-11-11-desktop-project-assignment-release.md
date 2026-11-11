# 会话项目归属修复发布计划

> 使用 superpowers:executing-plans 执行，并复用项目归属修复中先失败再通过的回归。

**目标**为将原生 App 项目归属修复合入远端 main，并发布同版 APK、未签名 IPA 与配套网关。

**来源**为修复 `a9289df0eb3ba056abf0fa197c91167d71b93935`。发布准备从远端 main `cfb0c76` 开始，期间更新到 `ddf58d1`，该提交已冻结另一批次 0.3.45。此次中文日志记录项目归属修复，正式就绪前核对上一批次的实际交付范围。

## 准备与验证

- [ ] 在原发布主机用现有 `releasectl` 健康检查，分别向 `codex-mobile-github-only` 和 `codex-mobile-gateway-production` 登记本次任务，按分钟更新 heartbeat。
- [x] 在修复分支整合远端 main，核对两边交互文档，更新 `release/notes.md`。
- [ ] 重跑项目归属回归、服务端构建及必需门禁。记录 `adapter-regression`、`coordinator-recovery`、`build-contract` 和 `typecheck` 的命令、退出状态和证据。已有真实会话只读回放和原生页头回归作为功能证据。
- [ ] 推送固定 SHA 到共享远端，向原发布主机传递证据。两目标进入 closing 后 ready 同一 SHA。由协调器使用共享锁整合 main、分配版本并冻结。

## 发布回验

- [ ] 等待两目标成功，核对批次 receipt、远端 main 与来源祖先关系、两端版本和实际部署来源。
- [ ] 独立完整下载 GitHub APK 和未签名 IPA，核对大小、SHA-256 和 IPA 签名状态。核对既有 iOS 软件源的版本、中文日志和署名。
- [ ] 通过认证项目接口核对网关部署及会话归属。交互约定记录实际成功结果与待真机验收项，保留 GitHub Release、两端附件和软件源的可点击链接。
