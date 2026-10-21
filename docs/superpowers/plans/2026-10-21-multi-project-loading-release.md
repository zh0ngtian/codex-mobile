# 多项目运行会话与消息排版双端发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将多项目运行会话打开、全局代码块换行、行内代码断行及用户消息链接改进发布到双端固定渠道，并完成独立回验。

**Architecture:** 复用现有 `releasectl` 与 `codex-mobile-lan-production`，由协调器在共享 `codex-mobile-main-production` 锁内整合 main、分配版本、冻结源码并构建发布。交付覆盖 GitHub 双端 Release、固定 LAN APK／已签名 IPA、HTTPS OTA 及 unsigned 软件源；本次不部署网关。

**Tech Stack:** 现役 release-coordinator、Python 发布适配器、unittest、Vitest／TypeScript、GitHub Actions、Xcode、Ad Hoc 签名及既有 LAN／HTTPS 发布服务。

---

本计划按 [发布协调说明](../../release-coordination.md) 执行。用户已明确授权发布，按默认双端客户端范围推进；由父任务使用 `superpowers:executing-plans` 执行既有协调流程，不另行询问执行方式。

发布准备基线为实际 `git rev-parse HEAD` 返回的 `8a1efd7bc3ed8a438d679021d1f02df5334737b7`。工作区为 `/Users/zhongtian/.codex/worktrees/multi-project-loading-release/codex-mobile`，分支为 `codex/multi-project-loading-release-20261021`，任务为 `multi-project-loading-release-20261021`。上次已发布客户端为 0.3.23，冻结提交为 `40fda6eec2108eb17d1aa321dd04515705e5cd52`；日志只列该提交之后的实际用户变化，不预设新版本号。

本次发布准备仅改动更新日志和计划，不新增生产代码。会话加载修复已经先在旧实现复现“五项目仅前三个会话恢复成功”，再将自动回填纳入后台调度并验证转绿；此前十项目、每项目五运行会话的压力及相关回归共 22 文件 431 项通过。431 项为此前功能验证记录，本次隔离工作区追加执行的是 7 文件 110 项功能回归。上述均来自受控协议夹具及业务链路，真实多项目运行现场仍待验收。若发布中发现缺陷，必须先增加可复现的失败回归，再最小修复、验证转绿；不得为文档准备补造新的红灯记录。

## 阶段一：隔离、登记与本次日志

**Files:**
- Modify: `release/notes.md`，只记录四项用户可感知变化。
- Create: `docs/superpowers/plans/2026-10-21-multi-project-loading-release.md`，维护发布步骤及实际完成状态。
- Read: `AGENTS.md`、`docs/release-coordination.md`、`docs/interaction-alignment.md`、`docs/commit-conventions.md`。

- [x] 从实际 HEAD 记录上述 main 基线，在独立 worktree 准备发布。
- [x] 将本任务登记到 `codex-mobile-lan-production` 并建立发布分支，不登记网关目标。
- [ ] 持续执行 `~/.local/bin/releasectl heartbeat --task multi-project-loading-release-20261021`，预期现有任务续约成功；直至任务完成或按协调器规则收尾。
- [x] 核对 `git log --oneline 40fda6e..HEAD` 与交互约定，更新日志为多项目打开、全局换行偏好、行内代码断行、用户 Markdown 链接四项，不携带上版 Sidechat 日志或固定构建、分发模板说明。
- [x] 读取 [SignOs 软件源最新文档](https://github.com/zh0ngtian/SignOs/blob/main/distribution/source-aggregator/README.md)，确认只同步现有 unsigned 订阅；读取现有开发者署名与当前 GitHub 登录用户名，留作回验依据。

## 阶段二：必要发布门禁、提交与 ready

**Files:**
- Test: `tests/ci/test_*.py`、`tests/ci/*.test.ts*`。
- Test: `/Users/zhongtian/WorkSpace/release-coordinator/tests/`。
- Evidence: `/Users/zhongtian/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261021-multi-project-loading/`，ready 文件为该目录的 `validation.json`。

- [x] 顺序完成锁定依赖安装与门禁。首轮 Python 回归和 `npm ci` 误并行，4 个依赖 jsdom 的用例因环境准备时序失败；首轮日志保留，依赖就绪后顺序重跑通过，没有为此修改生产代码。
- [x] 在发布 worktree 执行 `adapter-regression`：

  ```bash
  python3 -B -m unittest discover -s tests/ci -p 'test_*.py'
  ```

  结果：217 项项目发布、签名、OTA 及恢复回归通过，退出码 0。

- [x] 在 `/Users/zhongtian/WorkSpace/release-coordinator` 执行 `coordinator-recovery`：

  ```bash
  python3 -B -m unittest discover -s tests -p 'test_*.py'
  ```

  结果：59 项协调器恢复及相关回归通过，退出码 0。

- [x] 在发布 worktree 执行 `build-contract`：

  ```bash
  NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000
  ```

  结果：143 项构建契约通过，退出码 0。

- [x] 执行 `npm run typecheck`，结果：类型检查退出码 0。
- [x] 将四项真实通过记录写入 `validation.json`，保留准确检查名、命令、退出码和日志位置；不以此前 431 项功能回归替代发布门禁。
- [x] 执行 `git fetch origin main`，核对基线与最新远端 main；新增提交由协调器整合并对整合结果完成相关回归，不手工与正式批次并发推进 main。
- [ ] 阅读提交规范，执行 `git diff --check`、`git diff --cached --check` 及 `git diff --cached --name-status`；用中文 Conventional Commit 提交本次日志、计划及实际需要的发布修复。正文必须准确包含“新增功能”和“主要修改”。
- [ ] 在发布工作分支完成提交并推送：

  ```bash
  git push origin HEAD:refs/heads/codex/multi-project-loading-release-20261021
  git rev-parse HEAD
  git ls-remote origin refs/heads/codex/multi-project-loading-release-20261021
  ```

  预期：本地与远端完整 SHA 相同；不手改版本或 `.release-batch.json`。

- [ ] 以已推送的确定 SHA 提交 ready：

  ```bash
  release_task_sha=$(git rev-parse HEAD)
  ~/.local/bin/releasectl ready --task multi-project-loading-release-20261021 --sha "$release_task_sha" --validation '/Users/zhongtian/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261021-multi-project-loading/validation.json'
  ```

  预期：客户端任务 ready 成功；协调器 prepare 在整合 worktree 重新执行既有必要验证。

## 阶段三：协调整合、冻结、构建与发布

**Files:**
- Generated: 协调器维护的 `.release-batch.json`、持久 progress、冻结批次及 receipt。
- Existing: `scripts/codex_mobile_release_adapter.py`、`scripts/release-ios.py`、`scripts/ios_sign.py`、`scripts/ios_ota.py`。

- [ ] 由协调器完成 main 整合、必要回归、版本分配和冻结推送；统一版本高于全部现役渠道。负责人不独立正式打包、签名或上传渠道。
- [ ] 持续 heartbeat，并使用 `~/.local/bin/releasectl wait --task multi-project-loading-release-20261021 --timeout 45` 与 `~/.local/bin/releasectl status --task multi-project-loading-release-20261021` 跟踪任务。预期同一冻结批次完成正式 CI、GitHub 双端 Release、固定 LAN APK／已签名 IPA、HTTPS OTA 和 unsigned 软件源核对。
- [ ] 暂时只读故障等待同一冻结批次继续核对。永久失败保留原批次、错误及 CI；需要修复时先失败回归、最小修复并转绿，再以最新失败叶节点登记关联修复、推送确定 SHA 和 ready；不 resume failed、不重置等待预算、不借用旧包。
- [ ] 只接受任务 `complete`，或 `recovered` 且 `recovered_by` 指向成功子批次。读取该成功批次的同一 receipt，核对任务 SHA 包含证据、冻结 SHA、必要 CI 及所有客户端阶段；排队或单一渠道成功不代表交付。

## 阶段四：独立回验、文档与交付

**Files:**
- Read: `ReleaseCoordinator/receipts/` 与 `ReleaseCoordinator/artifacts/codex-mobile/` 的本批次长期凭证、安装包及 `ota-release.json`。
- Modify after success: `docs/interaction-alignment.md` 的现行要求、验收要点及本次变更状态，必要时同步 `README.md` 的现役版本。
- Create after success: `docs/superpowers/plans/evidence/2026-10-21-multi-project-loading-release.json`，只保存可公开的脱敏凭证。
- Update: 本计划实际完成状态及结果。

- [ ] 读取固定 Android 清单 `http://192.168.123.79:8765/channels/codex-mobile/latest.json` 与 iOS 清单 `http://192.168.123.79:8765/channels/codex-mobile/latest-ios.json`；对固定 [APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk) 和 [IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa) 分别做 HEAD、完整 GET，核对实际统一版本、字节数与 SHA-256 均匹配清单和成功 receipt。
- [ ] 保持 TLS 校验，读取 [HTTPS OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)、同前缀的 `latest-ios.json` 与 manifest，并完整下载版本化 IPA；核对版本、地址、大小及散列来自本批次。
- [ ] 核对 IPA 为 Ad Hoc 已签名，Bundle ID、Team、application-identifier、完整权限摘要及钥匙串组延续本机兼容基准；unsigned 构建包不得覆盖固定 IPA。
- [ ] 核对 [unsigned 软件源](https://signos-source-aggregator.305301890.workers.dev/sources/yao.json) 指向本批次 GitHub `CodexMobile-*-unsigned.ipa`，中文展示日志与冻结日志一致；原开发者署名保留，当前 GitHub 用户名已有则不变、缺少则追加，不硬编码或覆盖先前开发者。
- [ ] 按真实证据分别记录自动回归已通过、渠道已发布和现场待验收，更新交互约定及公开凭证。真机多项目运行现场、覆盖安装及数据保留没有实际证据时继续标为待验收，不能用构建验签或受控夹具替代。
- [ ] 文档及凭证经文字、链接、敏感信息和 `git diff --check` 自查后，通过共享 main 写入互斥提交推送收尾记录；本次不部署生产网关。新增测试会话及时归档，随后结束 heartbeat 并归档管理 worktree。
- [ ] 最终交付正文提供可点击的固定 OTA 安装页、APK、已签名 IPA 下载链接、实际版本、各自字节数和完整 SHA-256，并据实说明仍待现场或真机验收的范围。
