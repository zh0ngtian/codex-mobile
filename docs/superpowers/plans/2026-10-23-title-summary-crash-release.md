# 模型总结闪退修复双端发布计划

> **执行代理须知：** 必须使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐项执行；步骤以复选框跟踪。

**目标：** 将已合入 main 的模型总结回执修复发布至 Android／iOS 固定渠道，完成签名、OTA、GitHub 与 unsigned 软件源回验。

**架构：** 复用现役 `releasectl` 的 `codex-mobile-lan-production` 目标及 `codex-mobile-main-production` 锁。协调器负责来源整合、冻结、版本分配和所有正式构建发布；本轮不修改或重新部署网关。

**技术栈：** Python unittest、Vitest、TypeScript、GitHub Actions、Xcode、Ad Hoc、LAN／HTTPS OTA 与既有 unsigned 软件源。

---

用户明确要求“发布”，未限定平台，已登记 `title-summary-crash-mobile-20261023`。发布准备远端 main 基线为 `4cbda2ab8f2ef60a45f7140147aae014f7aca2d1`，最终来源为 `8a8572882146f9e3ebab0ced2006d9edb733ca8f`，在既有独立 worktree 执行并保留主工作区无关改动。发布前渠道为0.3.30；协调器已分配0.3.31（3031），冻结 `e761b795afb2ab5b37566680aaa5107abbdd83a5`，客户端批次已完成。

TDD 已在修复阶段执行：真实 WebKit 测试修复前以 SIGABRT 复现 `Invalid number value (NaN) in JSON write`，修复后成功；8文件78项相关回归、类型检查及前端构建通过，3项弹窗流程和1项真实 App／网关／JavaScript／WebKit 回归通过。原始证据在 `~/Library/Application Support/CodexMobile/validations/title-summary-crash-20261023/`。任务一只准备发布文档和日志；任务二已由协调器完成正式发布，任务三仅做文档与脱敏凭证收尾，不改写旧失败记录。

## 任务一：准备发布来源与门禁

**文件：** 修改 `release/notes.md`、`docs/interaction-alignment.md`、本计划；新建仓库外 `~/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261023-title-summary-crash/validation.json` 及日志。

- [x] 登记客户端任务，复用已附加独立 worktree，核对 main 基线，开始30秒 heartbeat。
- [x] 核对现役 APK／IPA、OTA、GitHub 和软件源版本，运行 `gh api user --jq .login` 读取发布账号；读取最新 SignOs 软件源说明，保留既有 unsigned 订阅与开发者。
- [x] 将 `release/notes.md` 更新为本版实际用户变化：`- 修复 iOS 点击“模型总结”后闪退的问题，候选名称返回后可继续编辑并保存。` 不重复旧版新增功能或追加分发模板。
- [x] 执行 `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，记录真实退出码、计数和日志散列为 adapter-regression。
- [x] 在 `/Users/zhongtian/WorkSpace/release-coordinator` 执行 `python3 -B -m unittest discover -s tests -p 'test_*.py'`，记录 coordinator-recovery。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，记录 build-contract。
- [x] 执行 `npm run typecheck`，记录 typecheck；本轮不修改服务端，不重建或部署网关。
- [x] 引用上述真实功能回归，核对 `src/native-ui/runtime.ts` 与已验收提交一致；完整保存证据，不以 JSON.stringify 替代真实对象桥验证。
- [x] 更新交互约定的发布进行中状态，完成中文 Conventional Commit，推送独立来源分支；validation.json 绑定完整来源 SHA，四项 required checks 均真实 passed，包含命令、时间、退出码、日志路径和 SHA-256。
- [x] 来源完成规格审查后再完成质量审查，修复阻塞意见后才进入 ready。

任务一实测结果：四项门禁均退出码0，适配器217项（12.756秒）、协调器59项（42.991秒）、构建契约21文件144项（31.568秒）、类型检查1次（4.874秒）。日志、起止时间、计数与 SHA-256 在仓库外 `~/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261023-title-summary-crash/`；`validation.json` 绑定最终推送的完整来源 SHA。`inherited-evidence.json` 引用修复前失败、修复后8文件78项相关回归及3项弹窗和1项完整 App 链路的原始日志／xcresult，记录全部9个非文档修复文件与提交 `4cbda2ab8f2ef60a45f7140147aae014f7aca2d1` 逐字节一致，并为结果包生成完整散列清单；不补造旧日志未记录的 shell 退出码。

根代理的 `preflight.json` 已核对发布前 APK／IPA、HTTPS OTA、GitHub 与 unsigned 软件源均为0.3.30（3030），当前 GitHub 用户和软件源原开发者均为 `zh0ngtian`；最新上游说明要求沿用既有 unsigned IPA 订阅、保留署名，Ad Hoc 签名包只进入 LAN／HTTPS OTA。发布准备只改本任务列出的三份文档，未改版本或冻结清单；来源独立规格与质量审查均通过，最终来源 `8a8572882146f9e3ebab0ced2006d9edb733ca8f` 已推送并进入ready；来源开发CI `39905407112` 成功。

## 任务二：协调器双端发布与成功凭证

**文件：** 只读已推送来源与本机配置；协调器生成冻结清单、批次记录和长期产物。

- [x] 以任务一实际 `validation.json` 执行ready，固定来源为 `8a8572882146f9e3ebab0ced2006d9edb733ca8f`；版本与冻结提交均由协调器生成。
- [x] 按阶段变化跟踪协调器任务，批次与任务最终均complete，error为null；未手工另起正式打包。
- [x] 读取持久receipt，核对来源包含、冻结提交、版本／构建号、prepare及全部main/build/iosbuild/sign/ota/apk/ipa/source/verify阶段，正式及冻结开发CI成功。
- [x] 先完成规格审查，再完成质量审查，两项均PASS；不宣称真机覆盖安装或数据保留已验证。

任务二实际结果：批次 `42a3b787-8202-426a-8530-62fb9d74194c`，来源 `8a8572882146f9e3ebab0ced2006d9edb733ca8f`，冻结 `e761b795afb2ab5b37566680aaa5107abbdd83a5`，版本0.3.31（3031）。持久receipt SHA-256为 `223d42c042cf8ec1e85e2ad1162fdeefe18bdaf8ed5e9ca68eac8ae7e0926ae1`；正式双端CI [39906323606](https://github.com/zh0ngtian/codex-mobile/actions/runs/39906323606)与冻结开发CI [39906323471](https://github.com/zh0ngtian/codex-mobile/actions/runs/39906323471)均为attempt 1、success。unsigned订阅同步job `323c19fc-c8b2-42b7-8049-6297c9308bbe` 与entry均succeeded，Ad Hoc签名IPA仅发布至LAN／HTTPS OTA。本轮未重新部署网关。

## 任务三：独立回验、文档收尾与交付

**文件：** 新建 `docs/superpowers/plans/evidence/2026-10-23-title-summary-crash-release.json`；修改本计划、`README.md`、`docs/README.md`、`docs/interaction-alignment.md`。

- [x] 独立读取固定 APK／IPA JSON、HEAD 和完整 GET，核对receipt中的本次版本、大小和SHA-256；HTTPS OTA安装页、JSON、manifest及版本化IPA均使用项目CA校验。
- [x] 对实际下载的Ad Hoc IPA独立验签，与真实兼容基准核对Bundle ID、Team、application-identifier、完整entitlements与钥匙串组连续性。
- [x] 独立核对GitHub APK／unsigned IPA、软件源版本／构建号／URL／大小／散列、中文用户变化日志及当前账号与原开发者署名；已签名IPA未上传软件源。
- [x] 将字段白名单公共凭证、实际回验结论及0.3.31现役状态同步至上述五份文件；保留0.3.30与旧网关部署历史。
- [x] 主代理完成本次五文件文档的独立规格、质量及整体收尾审查，均为PASS，无遗留问题。
- [x] 主代理在共享main锁内核对最新远端，完成相关文档检查并合入推送；最终交付包含版本、固定OTA安装页、本次APK／已签名IPA链接、大小及完整SHA-256。真机覆盖安装、数据保留与功能验收保持待现场确认。

独立回验已由根代理完成，receipt审计与完整下载／验签命令真实退出码均为0，未重复执行成功的渠道验证。实际产物见[脱敏公共凭证](evidence/2026-10-23-title-summary-crash-release.json)：APK 4,751,179字节，Ad Hoc已签名IPA 4,894,447字节，GitHub unsigned IPA 4,891,142字节；固定LAN、HTTPS OTA、GitHub、unsigned软件源及签名连续性均通过，软件源保留 `zh0ngtian` 署名，中文日志与冻结来源一致。

文档收尾基线为 `e761b795afb2ab5b37566680aaa5107abbdd83a5`，由当前隔离分支fetch后ff-only到远端main取得，不切换或修改主工作区main。本次只更新README、文档索引、交互约定、本计划及公共JSON；只执行JSON解析、字段白名单和脱敏扫描、新改相对链接与锚点检查、diff检查及文件范围检查，私有验证记录保存在仓库外。文档规格、质量及整轮收尾审查均PASS，最终main交付在共享互斥下核对最新远端并推送，收尾提交以Git历史为准。纯文档收尾不触发客户端构建、签名、再次发布或网关部署。
