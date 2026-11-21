# 执行过程截图修复发布计划

> 使用 Superpowers 计划、测试驱动开发和逐项验收流程。

**目标** 把执行过程截图修复部署到生产网关，并发布包含该修复和正文链接修复的 Android、iOS 客户端。

**范围** 以远端 main `48c0e870` 为基线，上次客户端版本为 `0.3.48`（`972e3462`）。现有协调器分别处理 `codex-mobile-gateway-production` 和 `codex-mobile-github-only`，两任务使用同一个来源提交。网关更新服务端，客户端经 GitHub Release 交付 APK 与 unsigned IPA，既有 iOS 软件源同步同一 IPA。

**工具** Vitest、Python unittest、XCTest、releasectl、GitHub Actions。

- [x] 在隔离工作树核对修复和失败证据。服务器回归在旧实现复现漏回填图片路径，客户端回归复现文件 URL 和已经被最终回复引用的截图未正确显示，iPhone 17 Pro 旧版用例测得原生窄图可点按宽度为 27 点。修复后 440 项自动回归和 2 项模拟器用例通过。
- [x] 登记 `process-image-preview-gateway-20261121` 与 `process-image-preview-client-20261121`，沿用现有协调器及 main 共享锁。对比 `972e3462..48c0e870` 的用户可见变化，更新 `release/notes.md`。
- [x] 执行 `npm run typecheck`、`npm run build:server`、`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`、`python3 -B -m unittest discover -s tests/ci -p 'test_*.py'` 及现役协调器项目的 `python3 -B -m unittest discover -s tests`。确认全部成功并保存对应日志。
- [x] 推送本计划与发布说明的固定来源提交，对两目标提交同一 SHA。网关验证范围为 `gateway-only`、`webUi=false`。等待两目标完成，核对任务包含、冻结 SHA、运行进程、GitHub Release、两端完整下载散列和软件源中文日志及原署名。
- [x] 使用原会话的只读请求查询生产网关的 `mobile/turns/details`，核对真实的两张截图和顺序，读取缩略图及原图并核对目标字节。在 iPhone 17 Pro 模拟器打开同一会话并逐个点按执行过程截图。记录成功凭证和验收状态到 `docs/interaction-alignment.md`。

## 验收结果

网关和客户端均验收成功。两目标来源均为 `42b8c797fb8ee0b5346b26253f23449d59027223`。网关冻结 `63531523cad10433b040745c2b6a38b45eb29837`，客户端 0.3.49（3049）冻结 `750a8dc30498d1b38bccd7db7319f1bfc8d516c0`。既有 iOS 软件源与 GitHub Release 的 IPA 散列及中文日志一致。

生产对照和 iPhone 17 Pro 模拟器复点均通过，使用原会话进行只读验证。真机验收待完成。见[发布验收凭证](evidence/2026-11-21-process-image-preview-release.json)。
