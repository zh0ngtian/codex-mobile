# 会话结束刷新与过程用时双端发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将会话结束后自动补齐回复、执行过程与用时合并，以及 main 上尚未发布的侧栏顶部按钮调整发布到双端固定渠道并独立回验。

**Architecture:** 复用现役 `releasectl`、`codex-mobile-lan-production` 与共享 `codex-mobile-main-production` 锁；由协调器整合 main、分配版本、冻结 SHA、构建、签名及发布。覆盖 GitHub 双端 Release、固定 LAN APK／已签名 IPA、HTTPS OTA 及既有 unsigned 软件源；本次无服务端运行改动，不登记或部署网关。

**Tech Stack:** Python 发布适配器、unittest、Vitest、TypeScript、release-coordinator、GitHub Actions、Xcode 与现有 Ad Hoc／LAN／HTTPS 流程。

---

用户已明确授权发布，按仓库默认双端范围推进，不新增产品或架构决策。发布基线为 `e415ecdeb2349f6ccc090c36cf540842c026cb47`；上次已发布0.3.24冻结为 `e876569b34ac09b87ebc89728708e254b4a90214`。工作区 `/Users/zhongtian/.codex/worktrees/completion-refresh-release/codex-mobile`，工作分支 `codex/completion-refresh-release-20261021`，任务 `completion-refresh-release-20261021`。

本次准备只更新日志、计划与发布状态，运行修复已经先用新增回归观察旧实现失败，再最小修复转绿。此前198项相关检查和4项iPhone 17 Pro正常字号竖屏离线UI验收通过；本次不伪造新的红灯。若发布发现生产缺陷，先新增失败回归、确认原因、最小修改再转绿，随后重新走四项门禁与关联修复流程。

## 任务一：隔离、登记、日志与规格／质量审查

**Files:** Modify `release/notes.md`、`docs/interaction-alignment.md`；Create 本计划。

- [x] 通过原生工具创建独立worktree，记录基线并建立发布工作分支。
- [x] `releasectl register --project codex-mobile-lan-production --task completion-refresh-release-20261021`，持续30秒heartbeat；batched后交由协调器批次租约维护。
- [x] 核对`git log --oneline e876569..HEAD`，更新`release/notes.md`为三项实际变化：结束后当前会话补齐回复；隐藏工具／推理不拆分用时入口；侧栏搜索／刷新／设置与右上Chat布局。禁止加入固定分发模板或复用上版日志。
- [x] 交互约定保留既有开发验收记录，追加本次已授权发布准备、现场待验收状态，不在成功receipt前宣称已发布。
- [x] 读取上游软件源最新文档；保存当前固定双端清单、unsigned软件源及`gh api user --jq .login`用于最终署名核对。
- [x] 规格审查核对范围、日志与状态；通过后质量审查核对文档及实际运行改动，修复发现的问题。

## 任务二：四项门禁、推送确定SHA与ready

**Files:** Read `tests/ci`、`tests/ui/native-ui-completion-refresh.test.tsx`、`tests/native-ui/agentapp-projection.test.ts`；Evidence 位于仓库外`ReleaseCoordinator/validations/codex-mobile-20261021-completion-refresh/`。

- [x] 顺序完成`npm ci`，退出码0后再启动测试，避免依赖安装与测试竞争。
- [x] 在发布worktree执行`python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，保存`adapter-regression.log`，要求退出码0。
- [x] 在`/Users/zhongtian/WorkSpace/release-coordinator`执行`python3 -B -m unittest discover -s tests -p 'test_*.py'`，保存`coordinator-recovery.log`，要求退出码0。
- [x] 在发布worktree执行`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，保存`build-contract.log`，要求退出码0。
- [x] 执行`npm run typecheck`，保存`typecheck.log`，要求退出码0。
- [x] 在隔离目录重验本次运行恢复／投影／历史相关7文件197项功能回归，记录准确结果；复用本次基线已完成的4项原生UI证据。
- [x] 写入`validation.json`，四个检查名精确为`adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck`，每项含真实passed、退出码、命令及证据路径。
- [ ] `git fetch origin main`核对最新main，阅读提交规范；`git diff --check`、`git diff --cached --check`及`git diff --cached --name-status`通过后，以中文Conventional Commit提交并推送`codex/completion-refresh-release-20261021`，核对本地／远端完整SHA相同。
- [ ] `release_task_sha=$(git rev-parse HEAD)`后执行`releasectl ready --task completion-refresh-release-20261021 --sha "$release_task_sha" --validation "/Users/zhongtian/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261021-completion-refresh/validation.json"`；SHA与路径取实际记录，不预分配版本或手改冻结清单。

## 任务三：协调冻结、双端发布与成功凭证

**Files:** Coordinator-generated `.release-batch.json`、progress与receipt；复用`scripts/codex_mobile_release_adapter.py`和原签名／OTA入口。

- [ ] 协调器完成main整合、必要回归、版本分配、冻结与推送。负责人不独立发包、签名或切换渠道。
- [ ] `releasectl wait --task completion-refresh-release-20261021 --timeout 45`与`status`跟踪批次；暂时只读故障留在同一冻结批次恢复核对。
- [ ] 永久失败保留原现场，只为已确认原因增加失败回归并修复，登记`--repairs-batch <最新失败叶节点>`，不resume failed、不取消CI、不借用其他包。
- [ ] 任务complete，或recovered指向成功子批次后，读取同一成功receipt，核对任务SHA祖先、冻结SHA、正式双端CI、必要开发CI及所有发布阶段。

## 任务四：独立渠道验收、文档收尾与交付

**Files:** Create `docs/superpowers/plans/evidence/2026-10-21-completion-refresh-release.json`；Modify 本计划、`docs/interaction-alignment.md`、`README.md`、`docs/README.md`。

- [ ] 对固定`latest.json`和`latest-ios.json`、APK／IPA的HEAD及完整GET，核对本批统一版本、字节数、SHA-256与receipt相同。
- [ ] 保持TLS校验，验证固定OTA安装页、更新JSON、manifest及HTTPS版本化IPA完整下载。
- [ ] 用本项目`ios_sign.py --verify-ipa`独立验签固定IPA，并与真实兼容基准比对Bundle ID、Team、application-identifier、全文权限摘要及钥匙串组；确认固定IPA为已签名包。
- [ ] 核对GitHub实际Release中文正文、APK／unsigned IPA完整下载散列；软件源现有App的unsigned版本、构建号、URL、大小、SHA及中文日志均相符；保留原开发者署名并核对当前gh用户名。
- [ ] 保存脱敏公开凭证，分别标明渠道已发布、受控回归已验证、用户现场／真机覆盖安装和数据保留待验收。
- [ ] 以共享main写入互斥提交并推送收尾文档；无新真实测试会话时明确记录无需归档，随后归档本任务管理worktree。
- [ ] 最终正文展示固定OTA安装页、固定APK和已签名IPA链接、实际版本、两个文件各自大小和完整SHA-256。

### 本地门禁结果

本次实际验证：217项适配器回归、59项协调器回归、20文件143项构建契约、类型检查及7文件197项相关功能回归均退出码0。原生4项UI验收结果复用基线同一生产代码的`/Users/zhongtian/WorkSpace/codex-mobile/.mobile-build/completion-refresh-20261021/process-ui-final.xcresult`，未改动运行代码，不新增模拟器或真实测试会话。
