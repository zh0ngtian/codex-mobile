# 会话标题总结双端与网关发布实施计划

> **执行代理须知：** 必须使用子技能 superpowers:subagent-driven-development 或 superpowers:executing-plans，逐项实施本计划。各步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 将已验收的网关独立会话标题总结、新会话自动命名与重命名候选发布至双端固定渠道，并部署对应网关接口。

**架构：** 复用现役 releasectl 的客户端与网关两个目标、同一来源 SHA 和 codex-mobile-main-production 互斥。协调器负责 main 整合、冻结、版本分配、GitHub 双端 Release、本机 iOS 构建与签名、HTTPS OTA、固定 LAN、unsigned 软件源和网关部署；任务不绕过协调入口独立发包。

**技术栈：** Python unittest、Vitest、TypeScript、GitHub Actions、Xcode、Ad Hoc、LAN/HTTPS OTA、现役软件源及 launchd 网关。

---

用户明确授权“发布”，未限定平台，因此登记 `thread-title-mobile-20261023`（codex-mobile-lan-production）和 `thread-title-gateway-20261023`（codex-mobile-gateway-production）。本机 main 基线为 `7772b28f5e716d8e5e3759fb1e84a089158502ec`，发布工作区和远端 main 基线为 `dd547f33b6f564a90c1776d3d2581b00f20f633c`。独立工作区 `/Users/zhongtian/.codex/worktrees/conversation-title/codex-mobile`，私有验证目录 `~/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261023-thread-title/`。

文档收尾前已在隔离分支执行 `git fetch origin` 与 `git merge --ff-only origin/main`，实际收尾基线为 `264eab100def5b46d7d86303ce45894a877ae003`。本轮仅进行发布准备、交付及文档收尾，不改业务源码。既有4项 iPhone 17 Pro正常字号竖屏 UI 验收与真实默认模型总结已通过，测试会话已归档；已有失败与通过记录在对应 xcresult 和日志中，不把发布文档变更伪装成失败测试。若发现必须修复的生产或发布代码缺陷，先以针对性回归复现失败，再最小修复并验证；不可更改冻结失败批次或用 unsigned IPA 替代签名交付。

## 任务一：准备来源、门禁与审查

**文件：** 修改 `release/notes.md`、`docs/interaction-alignment.md`、本计划；证据保存在私有验证目录。

- [x] 登记两个目标，复用已有独立 worktree，记录 main 基线并持续30秒 heartbeat。
- [x] 核对发布前固定双端、OTA、GitHub与软件源版本及当前 GitHub 用户；读取最新 SignOs 上游说明，保留既有 unsigned 订阅与开发者署名。
- [x] 更新中文 `release/notes.md`，准确描述本次实际用户变化，删除上一版固定模板或已发布旧日志；不预分配版本或修改冻结清单。
- [x] 执行 `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，保存 adapter-regression 日志与真实退出码。
- [x] 在 `/Users/zhongtian/WorkSpace/release-coordinator` 执行 `python3 -B -m unittest discover -s tests -p 'test_*.py'`，保存 coordinator-recovery。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，保存 build-contract。
- [x] 执行 `npm run typecheck && npm run build:server`，保存 typecheck 与网关构建结果。
- [x] 逐字节核对已通过的原生UI编译副本与当前源文件；保存 xcresult/日志及真实模型测试归档证明，引用既有功能回归。
- [x] 提交发布日志、交互约定和计划，生成仓库外 validation.json，精确包含 adapter-regression、coordinator-recovery、build-contract、typecheck 四项 passed、命令、退出码、时间、计数、日志路径及 SHA-256，并绑定最终来源提交。
- [x] 规格通过后完成质量审查，推送固定来源 SHA `638f7f4485ce9a0d1d79d004595ac1f64041dc50`。

准备结果：适配器217项、协调器59项、构建契约20文件143项、类型检查与服务端构建均真实退出码0；334份Swift源文件与成功UI验收的编译副本逐字节一致，既有11文件136项功能回归、2项浏览器流程、4项原生界面验收及真实模型归档记录已保存。发布准备只修改上述三份文档，不改版本、冻结清单或业务源码；该阶段的待发布、待部署状态已由下述两个成功批次及独立回验更新，真机覆盖安装和数据保留仍待验收。

## 任务二：协调发布与部署

**文件：** 阅读 `docs/release-coordination.md`；协调器生成冻结清单与批次证据。

- [x] 两个已登记目标 ready 同一已推送来源 SHA，使用同一组真实验证证据；不手改版本，不独立运行正式打包或部署入口。
- [x] 每次最多45秒定向 wait/status，读取阶段变化并保留失败现场；任务入批后由协调器批次租约接管。
- [x] 分别核对两个成功批次 receipt 的任务包含、来源 SHA、冻结 SHA、全部必要阶段与CI；失败仅按最新失败叶节点登记关联修复，不能复用历史产物冒充新包。

协调结果：两目标ready同一来源 `638f7f4485ce9a0d1d79d004595ac1f64041dc50`。客户端批次 `be8975a2-9316-4e25-9ffa-dfdd33298821` 冻结 `7758986f78df8c2e1bedd753505e92083d106244`，发布0.3.30（3030），正式CI `39896135018`、开发CI `39896134988`成功；网关批次 `79d9da96-dded-484d-9360-a499aa921caa` 冻结并部署 `264eab100def5b46d7d86303ce45894a877ae003`，开发CI `39897439897`成功。任务、批次均complete且error为null；来源均在frozen.tasks与verify.tasksIncluded，全部必要阶段存在。任务二独立规格与质量审查均PASS。

## 任务三：独立回验、收尾与交付

**文件：** 新建 `docs/superpowers/plans/evidence/2026-10-23-thread-title-release.json`；修改本计划、`docs/interaction-alignment.md`、`README.md`、`docs/README.md`。

- [x] 固定 APK/IPA JSON、HEAD与完整 GET核对版本、文件大小和SHA-256，与客户端 receipt 一致；HTTPS OTA安装页、JSON、manifest和版本化签名IPA通过项目CA校验；实际签名IPA独立验签并与真实已安装兼容基准核对完整entitlements及钥匙串连续性。
- [x] GitHub APK/unsigned IPA、软件源版本/构建号/URL/大小/散列及中文日志一致，保留运行时GitHub用户名与已有署名；Ad Hoc签名包仅在LAN/HTTPS OTA交付。
- [x] 网关 receipt、实际 launchd 进程与已部署接口核对一致；在真实网关完成一次隔离标题总结，验证目标用户消息不增加并归档测试会话。
- [x] 记录两份 receipt、产物与验证结果到脱敏公共证据，更新现役文档；真机覆盖安装与数据保留仍标待验收。
- [x] 根代理收尾规格和质量审查均通过，按 main 互斥核对最新远端并提交推送；最终回复提供固定OTA安装页和本次APK/已签名IPA的固定链接、版本、大小、完整SHA-256，以及网关部署结果。

收尾结果：根代理独立渠道与线上网关验证均从工具确认真实退出码0，固定双端包、OTA、GitHub和unsigned软件源匹配成功receipt；软件源中文用户变化日志与开发者署名已核对。网关PID `73987`、marker及server／bin／manifest／保留frontend摘要匹配，线上标题候选接口保持原用户消息2→2、内容及名称不变，测试会话已归档。五份收尾文档仅更新本轮来源和实际发布范围，旧失败及旧截图保留历史属性，真机覆盖安装、数据保留、真实Bark送达及用户现场验收仍待完成。公共证据采用字段白名单，不含原始receipt配置、口令、UDID或私有材料路径；本次纯文档收尾只验证JSON、相对链接与diff，不重新构建或发布。

[脱敏公共凭证](evidence/2026-10-23-thread-title-release.json)包含客户端receipt SHA-256 `de29534c5924098e8c464f3b10461264a94b02f467c674025bfe8dd9d3d1b2af`、网关receipt SHA-256 `6a5c392c30a381b6eb14fdf482d72c2409a3e3dcfc859168bfb5331c0b8066d2`、固定包大小与完整SHA-256。文档收尾已通过根代理独立规格与质量审查，并在main互斥下核对最新远端后提交推送；最终收尾提交以Git历史为准。

文档自查：公共JSON解析、字段白名单、来源与receipt散列、脱敏及新增／修改行中22个相对链接和锚点存在性检查通过；`git diff --check` 与 `git diff --cached --check` 通过。只暂存上述五份文档，根代理负责最终审查与main推送。
