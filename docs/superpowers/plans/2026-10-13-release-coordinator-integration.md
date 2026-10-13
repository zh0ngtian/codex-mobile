# Codex Mobile 发布协调器接入实施计划

> 按任务逐项执行；使用 superpowers 的计划、TDD、验证与代码审查流程。用户已授权适配器实现和真实发布验收。

**Goal:** 复用本机 releasectl，以冻结批次发布 Codex Mobile 并可从中断、响应丢失与关联修复恢复。

**Architecture:** 复用现有 ReleaseCoordinator 0.1.3 LaunchAgent 和 SQLite。客户端与网关分别配置任务队列；两者都写同一正式 main，因此明确共用本仓库 main 的 lock_scope，不与其他项目共用锁。项目 Python 适配器复用现有 Node/React/PakePlus、GitHub Actions、iOS 签名和 LAN/OTA 工具；所有产物按批次持久保留，阶段先 check、再补齐 run、再 check。failed 批次不可变，只登记最新失败叶节点的关联修复任务。

**Tech Stack:** 现有 Python 发布脚本、Node.js/Vitest、GitHub Actions、PakePlus Android/iOS、launchd；不增加协调服务、数据库或分发渠道。

## 1. 复用服务与登记

- [x] 阅读上游 README.md、USAGE.md，并核对本机 CLI、数据库、runtime 与 launchd。
- [x] 确认健康 0.1.3、登录启动；未安装系统 LaunchDaemon，不宣称系统开机启动。
- [x] 私有客户端/网关配置注册到现有服务，开始登记当前任务；开发阶段 heartbeat，ready 前不触发发布。
- [x] 复用本聊天独立 worktree，确认干净基线。

## 2. 冻结 CI 与来源门禁（先失败测试）

文件：`.github/workflows/build-mobile.yml`、`scripts/validate-release-batch.mjs`、`scripts/build-mobile.mjs`、`tests/ci/mobile-build-workflow.test.ts`、`tests/ci/release-batch.test.ts`。

- [x] 测试只有冻结清单触发正式 CI、稳定作用域、cancel-in-progress false、queue max。
- [x] 验证最终 SHA 为清单引入提交、任务祖先、目标、统一版本、构建号、手动输入及产物回执。
- [x] CI 保留双端 recipe、工具版本、必要构建契约及 unsigned 策略；不再独立分配版本。
- [x] 开发/PR 检查另组，不允许发包；纯文档、服务端批次不构建客户端。

## 3. 项目适配器（先失败测试）

文件：`scripts/codex_mobile_release_adapter.py`、`scripts/release_coordination/`、`tests/ci/test_release_adapter.py`。

- [x] prepare 在持久批次目录原子预留一次版本，读取 GitHub/LAN/OTA/下限；完成整合检查，重试复用预留。
- [x] main 阶段非强制推送冻结 SHA，并核对实际远端；build 查询该 SHA 的 CI 和本 run 回执/产物，不从其他 run 借包。
- [x] iOS 设备构建、签名、OTA、APK、IPA 分阶段保存意图和真实证据；已有成功操作只检查，不重复执行。复用项目已安装身份及现有 helper。
- [x] 软件源只核对本批 unsigned IPA，保留开发者署名；最终核对全部渠道、大小、SHA-256、签名、来源、CI 和任务包含证据。
- [x] 网关适配器保留现有本机 npm 安装和 launchd 方式，只构建服务端，复用已部署前端；真实进程、接口和部署包来源必须对得上。

## 4. 可控替身与审查

- [x] 并发独立作用域、窗口截止、冻结后新任务、负责人租约中断、丢失响应、单渠道失败/最新叶节点修复均保留可复现测试证据。
- [x] 实际适配器的 check/run 替身测试验证只补缺失步骤、版本预留不重复、拒绝错误提交/签名/渠道散列。
- [x] 运行现有受影响 CI、签名/OTA 测试、typecheck；完成独立规范审查及质量审查。

## 5. 真发布与文档

- [x] 提交推送固定 SHA 到任务分支，保存本地验证记录，再 ready；等待共同 receipt，核对任务 SHA 包含于成功冻结提交。
- [x] 真实统一版本双端 CI、LAN APK/已签名 IPA、HTTPS OTA、软件源 unsigned 版本验收；按需要验收网关作用域。
- [x] 更新 AGENTS.md、发布文档、配置模板及常用命令，通用策略仍引用 canonical 全局规则。
- [x] 保存批次、失败/修复链、CI run、所有历史产物和凭证；交付链接及大小/散列/签名状态。登录启动与系统启动分别报告，管理员认证由用户自行完成。

最终证据：78 项构建契约、153 项 Python 发布/恢复回归、typecheck 和文档链接检查通过；上游 19 项协调器验收及真实负责人进程终止/租约接管通过。额外全量 UI 5 项旧失败保留记录，真机覆盖安装/数据保留未验证。客户端、网关及关联修复均经独立规范/质量审查。

真实客户端成功批次 `ddfe5aa2-4a4b-49df-974f-ff8780af235e`，版本 `0.2.167` / `2167`；网关成功批次 `1dc61420-cbd4-4175-ac9d-8fe84e61ccc9`，冻结 SHA `08174d17063c9575764305c9ea1b37eb0908e7fd`，原部署目录/身份/前端保留且未触发客户端构建。原失败任务均已实际 recovered 到成功子批次的同一凭证；失败链、产物和凭证保留。[机器可读验收摘要](evidence/2026-10-13-release-coordinator-acceptance.json)、[发布说明与完整验收边界](../../release-coordination.md)。
