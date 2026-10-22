# 文件复制导入双端发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原生普通文件复制导入修复发布到双端固定渠道，保留包名、证书、描述文件及既有安装身份。

**Architecture:** 使用现役`releasectl`的`codex-mobile-lan-production`，复用共享main互斥、版本分配、冻结、GitHub双端构建、本机iOS构建签名、HTTPS OTA、固定LAN和unsigned软件源回验。本次仅发布客户端；不部署网关，不修改签名配置，不改主工作区其他任务的暂存内容。

**Tech Stack:** Python unittest、Vitest、TypeScript、GitHub Actions、Xcode、Ad Hoc、固定LAN/HTTPS OTA、既有软件源。

---

用户已明确授权“发布”，按仓库默认双端范围登记任务`file-picker-copy-release-20261022`。来源基线`c846261a9a44e0559d60635b802d7d39bd265a1c`，独立工作区`/Users/zhongtian/.codex/worktrees/file-picker-open/codex-mobile`；私有验证目录`~/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261022-file-picker-copy/`。

TDD证据复用长期主工作区`.mobile-build/file-picker-open/device-20261022/`：真机0.3.28原生打开TXT失败，系统书签解析Cocoa257；同机同文件网页复制导入成功（usingBookmark=NO）；新增UI用例先复现sheet提前关闭误取消，移除提前取消后37.126秒通过。另有21项业务回归与16.271秒照片回归通过；测试探针已移除。发布准备只修改文档和日志，不为文档编造失败测试；若必须修复新的生产缺陷，先确认失败回归再修复。

## 任务一：准备固定来源、门禁和审查

**Files:** Modify `release/notes.md`、`docs/interaction-alignment.md`；Create 本计划；Evidence 私有验证目录。

- [x] 登记任务，确认已有独立worktree并启动30秒heartbeat，记录main基线。
- [x] 核对`git fetch origin main`后基线没有遗漏；远端main与来源基线同为`c846261a9a44e0559d60635b802d7d39bd265a1c`，保留已合入main的其他源码。
- [x] 运行`python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，记录为`adapter-regression`，217项通过。
- [x] 在`/Users/zhongtian/WorkSpace/release-coordinator`运行`python3 -B -m unittest discover -s tests -p 'test_*.py'`，记录为`coordinator-recovery`，59项通过。
- [x] 运行`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，记录为`build-contract`，20个文件143项通过。
- [x] 运行`npm run typecheck`，记录为`typecheck`；四项均真实退出码0，私有`validation.json`记录命令、cwd、环境覆盖、时间、日志、SHA-256和计数。
- [x] 逐字节核对`ComposerBar.swift`、`ComposerDocumentPicker.swift`与长期主工作区编译副本一致；成功`fixed-ui.xcresult`/`photo-regression.xcresult`及对应日志分别证明37.126秒普通文件回归与16.271秒照片回归通过。真实设备`device-verification.json`及书签错误日志证明0.3.28故障与现有复制路径对照，新原生包尚未安装真机验收；私有`source-evidence-comparison.json`保留逐字节结果与证据摘要。
- [x] 更新中文日志为本批真实用户变化：普通文件打开无响应、系统默认选文颜色、附件与文字左端对齐、手机关注与桌面置顶双向同步；不宣称未部署的网关通知已经更新。
- [ ] 读取固定双端清单、当前OTA、GitHub用户及最近Release、unsigned软件源与SignOs上游最新文档，保存发布前基线，保留现有开发者署名。
- [ ] 规格审查通过后进行质量审查；修复重要问题并复审。推送固定准备SHA，使用四项真实passed检查提交ready。

## 任务二：由协调器发布

**Files:** Read `docs/release-coordination.md`；协调器生成冻结清单与批次证据。

- [ ] 用`releasectl ready --task file-picker-copy-release-20261022 --sha <实际完整SHA> --validation <实际验证文件>`提交准备结果；参数来自实际Git及验证记录。
- [ ] 定向status/wait（每次最多45秒）跟踪同一批次，持续heartbeat；不另发安装包、不手改冻结版本。
- [ ] 核对complete/recovered成功批次的receipt包含本任务来源、冻结SHA、正式双端CI、本机iOS设备构建、Ad Hoc签名、OTA、固定APK/IPA、unsigned软件源和开发CI。
- [ ] 如批次永久失败，保留现场并按最新失败叶节点登记关联修复；不覆盖失败状态或复用其他来源的包。

## 任务三：独立回验与交付

**Files:** Create `docs/superpowers/plans/evidence/2026-10-22-file-picker-copy-release.json`；Modify 本计划、`docs/interaction-alignment.md`、`README.md`、`docs/README.md`。

- [ ] 对固定APK/IPA JSON、HEAD和完整GET核对新版本、大小及SHA-256。
- [ ] 保持TLS校验验证固定OTA安装页、JSON、manifest及版本化IPA；下载包独立验签，核对现有Bundle ID、Team、application-identifier、完整权限和钥匙串连续性。
- [ ] 完整下载GitHub APK和unsigned IPA，比对共同receipt；核对软件源unsigned版本、URL、大小、散列、中文日志和当前GitHub用户署名。
- [ ] 写入脱敏发布凭证并更新现役状态，审查文档后在main互斥下提交推送收尾。没有生产代码变化时不重复构建发布。
- [ ] 保留用户要求的模拟器现场、真机当前附件与设置；本轮没有远端测试会话。停止本任务heartbeat，保留所需工作区和诊断。

最终回复正文展示固定OTA安装页及本次APK、已签名IPA的固定链接、版本、字节数、完整SHA-256。成功receipt与独立回验之前不宣告交付完成；不把构建/渠道验证当成真机覆盖安装已通过。
