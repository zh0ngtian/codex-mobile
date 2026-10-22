# 文件复制导入双端发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原生普通文件复制导入修复发布到双端固定渠道，保留包名、证书、描述文件及既有安装身份。

**Architecture:** 使用现役`releasectl`的`codex-mobile-lan-production`，复用共享main互斥、版本分配、冻结、GitHub双端构建、本机iOS构建签名、HTTPS OTA、固定LAN和unsigned软件源回验。本次仅发布客户端；不部署网关，不修改签名配置，不改主工作区其他任务的暂存内容。

**Tech Stack:** Python unittest、Vitest、TypeScript、GitHub Actions、Xcode、Ad Hoc、固定LAN/HTTPS OTA、既有软件源。

---

用户已明确授权“发布”，按仓库默认双端范围登记任务`file-picker-copy-release-20261022`。来源基线`c846261a9a44e0559d60635b802d7d39bd265a1c`，独立工作区`/Users/zhongtian/.codex/worktrees/file-picker-open/codex-mobile`；私有验证目录`~/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261022-file-picker-copy/`。

TDD证据复用长期主工作区`.mobile-build/file-picker-open/device-20261022/`：真机0.3.28原生打开TXT失败，系统书签解析Cocoa257；同机同文件网页复制导入成功（usingBookmark=NO）；新增UI用例先复现sheet提前关闭误取消，移除提前取消后37.126秒通过。另有21项业务回归与16.271秒照片回归通过；测试探针已移除。发布准备只修改文档和日志，不为文档编造失败测试；若必须修复新的生产缺陷，先确认失败回归再修复。

## 当前结果

客户端发布与独立回验已于2026-10-22晚完成；2026-10-23跨日完成文档收尾，最终规格／质量审查均PASS，已在共享main互斥下核对最新main并推送收尾提交。任务`file-picker-copy-release-20261022`与批次`46697d9c-4a6d-481a-a206-73859004256f`均为complete，error为null，无关联失败恢复；版本0.3.29（3029）。任务来源为`cdbb01a394144ca74f1e88c9a51a75874c8d8604`，冻结SHA为`d48d3653c2166501e555dfed4abd29e2d419b9fa`，成功receipt的SHA-256为`12ebc68f54419a5c3d9a492354742d12c69f0b2ae92307db01b0a190a69dda33`。正式双端CI `39807060885`、同冻结提交开发CI `39807060369`均成功。

本次文档收尾开始时，隔离worktree的HEAD为来源SHA；`git fetch origin main`后快进至上述冻结SHA，远端没有额外main提交，未改动主工作区的暂存或未暂存内容。只更新本计划、README、文档索引、交互约定及[脱敏公共凭证](evidence/2026-10-22-file-picker-copy-release.json)，没有修改生产源码或重新构建发布。

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
- [x] 读取固定双端清单、当前OTA、GitHub用户及最近Release、unsigned软件源与SignOs上游最新文档，保存发布前基线；保留现有开发者署名并核对运行时读取的GitHub用户。
- [x] 规格审查通过后完成质量审查，两份结果均PASS；推送固定准备SHA `cdbb01a394144ca74f1e88c9a51a75874c8d8604`，使用四项真实passed检查提交ready。

## 任务二：由协调器发布

**Files:** Read `docs/release-coordination.md`；协调器生成冻结清单与批次证据。

- [x] 用`releasectl ready`提交本任务、完整来源SHA `cdbb01a394144ca74f1e88c9a51a75874c8d8604`及四项真实passed验证记录，准备结果已受理。
- [x] 定向status/wait（每次最多45秒）跟踪同一批次并持续heartbeat；未另发安装包或手改冻结版本。
- [x] 核对complete成功批次的receipt包含本任务来源、冻结SHA、正式双端CI、本机iOS设备构建、Ad Hoc签名、OTA、固定APK/IPA、unsigned软件源和开发CI。
- 不适用：本批成功完成，未触发永久失败恢复，未复用其他来源安装包。

## 任务三：独立回验与交付

**Files:** Create `docs/superpowers/plans/evidence/2026-10-22-file-picker-copy-release.json`；Modify 本计划、`docs/interaction-alignment.md`、`README.md`、`docs/README.md`。

- [x] 对固定APK/IPA JSON、HEAD和完整GET核对0.3.29（3029）、大小及SHA-256，与成功receipt一致。
- [x] 保持项目CA的TLS校验验证固定OTA安装页、JSON、manifest及版本化IPA；实际下载包独立验签，核对兼容基准的Bundle ID、Team、application-identifier、完整权限和钥匙串连续性。
- [x] 完整下载GitHub APK和unsigned IPA，比对共同receipt；核对软件源unsigned 0.3.29（3029）、URL、大小、散列、四条中文用户变化日志和当前GitHub用户署名。
- [x] 按字段白名单写入脱敏发布凭证，更新README、文档索引和交互约定的现役0.3.29状态；仅文档收尾，不重复测试或构建发布。
- [x] 主代理完成最终文档规格／质量审查，两份结果均PASS；在共享main互斥下核对远端仍为冻结SHA，已将收尾提交`24ef9a4e3d606220319bd8b72caef8230d03610c`推送main，主工作区原有改动保持不变。
- [x] 保留用户要求的模拟器现场、真机当前附件与设置；本轮没有远端测试会话。本任务heartbeat已停止，所需worktree和诊断继续保留，不关闭、归档或清理。

## 验证与边界

| 准备门禁 | 真实结果 | 耗时 |
| --- | --- | --- |
| 适配器回归 | 217项通过，退出码0 | 13.470秒 |
| 协调器恢复回归 | 59项通过，退出码0 | 47.045秒 |
| 构建契约 | 20个文件143项通过，退出码0 | 31.415秒 |
| TypeScript类型检查 | 通过，退出码0 | 5.611秒 |

文件导入复用既有21项附件业务回归与两项原生UI成功证据：普通文件复制导入及正文／已有附件保留、按钮取消／下滑关闭为37.126秒，照片自动导入为16.271秒；两份Swift生产文件与成功工程编译副本逐字节一致。范围为iPhone 17 Pro、正常字号、竖屏。真机0.3.28的授权故障及同机复制路径对照已完成，新版原生入口、覆盖安装、数据保留与用户验收仍待安装后完成。

根代理实际执行独立`verify-published.py`并取得退出码0，日志记录固定LAN与HTTPS OTA、签名连续性、GitHub产物及unsigned软件源均通过。软件源保留原订阅和开发者，版本／构建号、URL、大小、散列及四条中文日志一致；未将Ad Hoc已签名IPA订阅到软件源。完整命令、真实退出码及原始证据留在本轮私有验证目录，公共凭证仅保留白名单发布信息，不含私有路径、设备UDID、口令或签名材料。

固定APK为4,749,967字节，SHA-256 `952890e4d7e222e46fcbcbcc9aa072c28a2c97d0c011d51692c7d2c891894b6e`；固定Ad Hoc已签名IPA为4,853,372字节，SHA-256 `8b3e5a09af76001156f1019ef97443a68c035f6082421dc560b0d3b044f4a8d8`。签名保持Bundle ID `vip.loock.codexmobile`及application-identifier `SC456JW7RP.app.jade6694.grapefruit3766`，完整权限和钥匙串组连续性已核对。本次未部署网关，桌面置顶独立通知变更不属于本次已上线范围。

知识面状态：代码与运行态为`verified-current`；文档已更新且JSON、相对链接及diff空白检查通过，最终规格／质量审查均PASS，收尾提交已推送main，文档为`verified-current`；规则只读核对、无须改动；记忆维护为`out-of-scope`；工作区按用户要求保留，清理为`out-of-scope`。本次没有重跑生产测试或构建。

最终回复正文展示[固定OTA安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)及本次[APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)、[已签名IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)的版本、字节数、完整SHA-256。成功receipt与独立回验均已完成；不把构建或渠道验证当成真机覆盖安装已通过。
