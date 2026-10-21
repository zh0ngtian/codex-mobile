# 顶部更多与直接侧栏布局双端发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将已合入 main 的顶部更多按钮及移除侧栏外层容器改动发布到 Android 与 iOS 固定渠道，并核对所有正式交付凭证。

**Architecture:** 使用现役 releasectl 的 codex-mobile-lan-production 目标及 codex-mobile-main-production 共享锁。协调器负责 main 整合、版本分配、冻结、双端构建、签名和渠道更新；负责人只准备已推送任务 SHA、验证材料与独立回验。本轮没有服务端运行改动，不登记网关任务。

**Tech Stack:** Python unittest、Vitest、TypeScript、release-coordinator、GitHub Actions、Xcode、Ad Hoc 签名及既有 LAN／HTTPS OTA。

---

用户已明确授权“发布”，范围按仓库默认双端执行，不新增产品或架构决定。基线 `8a1f1ea1a41534ef8190aafb9547006c9224fdc5`；上版0.3.25冻结 `2cf6cb29b5863495c2b7caaa502a20aa5b9c4bab`。工作区 `/Users/zhongtian/.codex/worktrees/sidebar-inline-release/codex-mobile`，工作分支 `codex/sidebar-inline-release-20261021`，任务 `sidebar-inline-release-20261021`。

本次只准备发布日志与文档，生产代码不变。TDD约束用于本轮若发现必须修复的生产缺陷：先增加真实失败回归、确认红灯，再最小修改转绿并重新通过门禁；不为纯发布文档伪造新红灯。复用同一生产代码已经通过的4项iPhone 17 Pro／iOS27／正常字号／竖屏原生UI证据：长期主工作区 `.mobile-build/sidebar-inline-menu-20261021/verification.xcresult`，总计170.8秒。

## 任务一：登记、隔离、日志与审查

**Files:** Modify `release/notes.md`、`docs/interaction-alignment.md`；Create 本计划。

- [x] 使用原生工具创建独立发布worktree，并记录基线与分支。
- [x] 执行 `releasectl register --project codex-mobile-lan-production --task sidebar-inline-release-20261021`，每30秒heartbeat；batched后由协调器批次租约维护。
- [x] 更新中文发布日志为本版实际三项变化：搜索／刷新／更多与右上Chat；移除外层容器并保留按钮玻璃外观；移除底部更多并释放列表空间。
- [x] 交互约定记录已授权发布、待成功凭证状态；不提前填写发布版本。
- [x] 阅读上游 SignOs 软件源最新文档，保存固定双端旧清单、unsigned软件源与当前gh用户名。
- [x] 对发布范围、日志与状态完成规格审查和质量审查；修复发现的问题。

## 任务二：门禁与ready

**Files:** Read `tests/ci`、现役协调器 `tests`；Evidence `/Users/zhongtian/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261021-sidebar-inline/`。

- [x] 顺序完成 `npm ci`，退出码0后再运行Node检查。
- [x] 在发布worktree执行 `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，保存 `adapter-regression.log`，退出码0。
- [x] 在 `/Users/zhongtian/WorkSpace/release-coordinator` 执行 `python3 -B -m unittest discover -s tests -p 'test_*.py'`，保存 `coordinator-recovery.log`，退出码0。
- [x] 在发布worktree执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，保存 `build-contract.log`，退出码0。
- [x] 执行 `npm run typecheck`，保存 `typecheck.log`，退出码0。
- [x] 写入validation.json，检查名精确为adapter-regression、coordinator-recovery、build-contract、typecheck，含真实passed、命令、退出码与证据路径；关联4项已有原生UI证据。
- [x] 核对最新main与提交规范，检查暂存差异；以中文Conventional Commit提交并推送本工作分支，核对远端完整SHA。
- [x] 对已推送的实际完整SHA执行 `releasectl ready --task sidebar-inline-release-20261021 --sha <实际SHA> --validation <实际validation.json路径>`；不手改冻结清单或预分配版本。

## 任务三：协调器正式发布

**Files:** 协调器生成 `.release-batch.json`、progress与receipt。

- [x] 使用 `releasectl wait --task sidebar-inline-release-20261021 --timeout 45` 及status跟踪，核对main整合、正式双端CI、iOS设备构建、签名、HTTPS OTA、固定LAN APK／IPA和unsigned软件源阶段。
- [x] 暂时只读故障保留同一批次等待；永久失败保留原现场，明确修复后按最新失败叶节点登记repairs-batch，不resume failed、不借包或独立发包。
- [x] 核对complete成功receipt，或recovered指向的同一成功子批次；核对任务SHA祖先、冻结SHA、正式CI和必要开发CI。

## 任务四：独立回验与收尾

**Files:** Create `docs/superpowers/plans/evidence/2026-10-21-sidebar-inline-release.json`；Modify 本计划、`docs/interaction-alignment.md`、`README.md`及`docs/README.md`。

- [x] 对固定latest.json／latest-ios.json、APK／IPA的HEAD及完整GET核对本批版本、字节数、SHA-256与receipt相同。
- [x] 保持TLS校验核对固定OTA安装页、JSON、manifest；对HTTPS版本化IPA实际完整下载计算字节数与完整SHA-256，逐一与本批receipt比对一致。
- [x] 独立验签实际下载IPA，并与真实兼容基准比对Bundle ID、Team、application-identifier、完整权限摘要及钥匙串组。
- [x] 核对GitHub中文Release正文；对GitHub APK／unsigned IPA实际完整下载分别计算字节数与完整SHA-256，逐一与本批receipt比对一致；核对软件源unsigned版本、构建号、URL、大小、散列、中文日志与既有署名及当前gh用户名。
- [x] 保存脱敏公开凭证，标明渠道已发布、模拟器已验证、用户现场与真机覆盖安装及数据保留待验收。
收尾约束：在共享main锁下合入、提交推送文档收尾，随后由宿主归档本任务管理worktree；实际归档与最终main核对记录于仓库外本次证据目录的closeout.json，长期材料已保存在仓库外。

最终交付正文必须展示固定OTA安装页、固定APK和已签名IPA下载链接、实际版本、两个文件各自的字节数与完整SHA-256。未创建真实测试会话，不需要归档用户会话。

### 本地门禁记录

217项适配器回归、59项协调器回归、20文件143项构建契约及类型检查均退出码0；4项原生UI复用同一生产代码的既有结果。日志和validation.json位于本计划声明的仓库外长期证据目录。

## 发布与独立回验结果

0.3.26（3026）已完成双端发布。成功批次 `fdf811e4-ef2d-453f-8cf2-e478bc33038a`，冻结 `c9c23eae31b18cbc093a8c29c757f2220aee7419`，任务来源 `fbf1ac08382cf94c18253242f06073fccdae59a8`；正式CI `39590582189` 及开发CI `39590582232` 均成功。任务、批次均complete，与持久receipt一致，无失败或关联修复批次。

固定双端渠道、HTTPS OTA、GitHub两端安装包均已独立完整下载核对大小和SHA-256；固定IPA独立验签及完整权限／钥匙串连续性通过；unsigned软件源版本、构建号、中文日志及原署名均通过。公开结果见[发布凭证](evidence/2026-10-21-sidebar-inline-release.json)。本轮仅客户端发布，未部署网关；没有新真实测试会话，人工现场及真机覆盖安装与数据保留待验收。
