# 当前项目继承与 Sidechat 双端发布及网关部署计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:executing-plans 在本会话逐项执行。用户已授权发布与网关部署，最终整合及发布由既有协调器执行。

**Goal:** 将已验证的当前项目继承、Sidechat 引导与历史编辑修复发布到双端固定渠道，并部署配套生产网关。

**Architecture:** 复用 `releasectl` 的客户端和网关两个目标，两者 ready 同一已推送 SHA，共用现有 main 锁。客户端覆盖 GitHub 双端 Release、固定 LAN APK/已签名 IPA、HTTPS OTA、软件源 unsigned 订阅；网关覆盖服务端构建、原安装位置及 launchd 部署。只有两个成功 receipt 都通过核对才完成交付。

**Tech Stack:** 现役 release-coordinator 0.1.7、项目 Python 适配器、Vitest/TypeScript、Xcode、Ad Hoc 签名、GitHub Actions、现有 LAN/HTTPS 发布器。

---

基线：`338802903b47ecb43b873ac43d510b76ab3b8cd6`。该提交已经完成259项相关回归、真实 app-server/临时网关往返及 iPhone 17 Pro 正常字号竖屏验收，本轮不重复改写已验证运行代码。不补造历史红灯：发布前先执行既有发布契约；若发现需改运行代码或发布适配器的缺陷，先增加可复现的失败回归，再最小修复、验证转绿，按既有不可变关联修复流程处理。

## 任务1：登记、隔离与本次日志

**Files:** 修改 `release/notes.md`；新增本计划；执行现有 `scripts/codex_mobile_release_adapter.py`。

- [x] 登记 `newchat-sidechat-client-20261020` 至 `codex-mobile-lan-production`，登记 `newchat-sidechat-gateway-20261020` 至 `codex-mobile-gateway-production`。
- [x] 从基线创建原生工具管理的独立 worktree，持续 heartbeat；原主工作区不直接构建签名或发包。
- [x] 读取现役软件源上游文档，确认只同步既有 unsigned 订阅，不上传已签名 IPA，不改软件源部署或认证配置。
- [x] 将 `release/notes.md` 改成本次三个用户变化：当前项目继承、Sidechat 引导、历史消息编辑；不附加构建分发模板说明。

## 任务2：发布门禁与同一 SHA

**Files:** 既有 `tests/ci/test_*.py`、`tests/ci/*.test.ts*`；验证日志存放仓库外 `ReleaseCoordinator/validations/codex-mobile-20261020-newchat-sidechat-release/`。

- [x] `npm ci`，确认依赖安装成功。
- [x] `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，预期所有项目发布/签名/OTA/恢复回归通过，对应 `adapter-regression`。
- [x] 在上游协调器源码目录执行 `python3 -B -m unittest discover -s tests -p 'test_*.py'`，预期恢复及租约回归通过，对应 `coordinator-recovery`。
- [x] `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，预期构建契约通过，对应 `build-contract`。
- [x] `npm run typecheck` 与 `npm run build:server`，预期退出0，对应 `typecheck` 及网关部署前构建。
- [x] `git diff --check`、`git diff --cached --check`、核对暂存文件，使用中文 Conventional Commit 提交日志与计划并推送工作分支；不手工推进 main 或分配版本。
- [x] 生成真实 passed 验证 JSON，两个目标 ready 同一已推送 SHA。

## 任务3：协调发布与网关部署

**Files:** 协调器生成冻结清单和持久 receipt；本任务不直接改写已冻结批次。

- [x] 用 `releasectl wait --task <任务ID> --timeout 45` 配合 status/batch 查询进度，持续 heartbeat，等待客户端全部必要阶段成功。
- [x] 等待网关目标完成服务端构建、原位置部署及 verify；不得用客户端成功替代网关成功。
- [x] 出现暂时只读故障时等待同一冻结批次核对；永久失败保留原批次，按最新失败叶节点登记关联修复，先失败回归再修复，不 resume failed 或擅自补发单独包。

## 任务4：独立回验与交付

**Files:** 更新 `docs/interaction-alignment.md` 当前状态及变更记录、`README.md` 相关状态；保存公开脱敏交付凭证。

- [x] 读取两个成功 receipt，核对任务来源包含、最终 SHA、必要 CI、客户端阶段及网关阶段均成功。
- [x] 固定 APK/iOS JSON、HEAD 和完整 GET 独立核对版本、字节数、SHA-256；HTTPS OTA 清单、manifest、安装页和 IPA 完整 GET 保持 TLS 校验。
- [x] 核对已签名 IPA 的 Bundle ID、Team、application-identifier、完整权限摘要及钥匙串组连续性；核对 unsigned 软件源对应版本、真实中文日志及当前 GitHub 用户署名保留。
- [x] 核对网关实际 PID、监听、认证健康与部署文件摘要；仅作不创建生产聊天的安全路由探测。
- [x] 根据 receipt 同步文档和凭证，通过共享 main 锁提交推送收尾记录；停止 heartbeat，归档本次管理 worktree。
- [x] 交付正文给出固定 OTA 安装页、APK/IPA 下载链接、版本、大小、完整 SHA-256、IPA 已签名状态，以及网关部署结果。真机覆盖安装和数据保留仍按实际证据注明状态。

## 任务5：首次客户端批次关联修复

首次客户端批次 `f0c873c7-ee90-4ca4-b8ed-e1c437cc82c9` 分配0.3.22，在GitHub列表短暂遗漏已记录CI run时永久失败；原批次及仍运行的CI保留，不resume、不取消、不借用旧包。网关批次 `5ed02bd1-a5f7-4e06-b266-3f11014db3a5` 已成功部署同一原任务源码，修复只涉及发布核对脚本，不再次部署未变化的网关运行代码。

**Files:** 修改 `scripts/codex_mobile_release_adapter.py`、`tests/ci/test_release_read_recovery.py`、`docs/release-coordination.md`。

- [x] 对比原run列表、独立详情与冻结记录，确认run `39447223990` 的SHA、工作流及attempt与原记录一致。
- [x] 先补列表遗漏、陈旧状态、详情身份变化/删除、已记录后的重复CI和网络故障回归；修复前得到8个失败子场景及1个错误，证实原实现会误判或忽略详情身份。
- [x] 已记录run改用详情接口核对身份和状态，保留列表重复检查与严格SHA、路径、attempt校验；未知读结果不换run或重置预算。
- [x] 41项只读恢复、217项完整项目发布回归、143项构建契约及类型检查通过；真实原run的详情身份已核对，未改动原批次。
- [x] 推送修复SHA并提交 `newchat-sidechat-client-repair-20261020` ready。
- [x] 等待新关联批次完成，核对原客户端任务实际recovered_by、客户端成功receipt与既有网关成功receipt，再完成渠道回验和文档收尾。

## 最终交付结果

客户端关联批次 `265f5e93-c648-4caf-8bb4-3bbe0dd12d88` 已成功发布0.3.23，原任务recovered_by与同一receipt已核对；网关批次 `5ed02bd1-a5f7-4e06-b266-3f11014db3a5` 已成功。APK、Ad Hoc已签名IPA、HTTPS OTA、unsigned软件源及中文日志、署名、签名身份与完整权限均经独立回验；网关文件摘要和实际进程再次核对一致。发布凭证见[公开记录](evidence/2026-10-20-newchat-sidechat-release.json)。收尾记录提交推送和工作区归档在本计划最终交付前执行。
