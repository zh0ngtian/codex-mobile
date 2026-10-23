# 模型总结闪退修复双端发布计划

> **执行代理须知：** 必须使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐项执行；步骤以复选框跟踪。

**目标：** 将已合入 main 的模型总结回执修复发布至 Android／iOS 固定渠道，完成签名、OTA、GitHub 与 unsigned 软件源回验。

**架构：** 复用现役 `releasectl` 的 `codex-mobile-lan-production` 目标及 `codex-mobile-main-production` 锁。协调器负责来源整合、冻结、版本分配和所有正式构建发布；本轮不修改或重新部署网关。

**技术栈：** Python unittest、Vitest、TypeScript、GitHub Actions、Xcode、Ad Hoc、LAN／HTTPS OTA 与既有 unsigned 软件源。

---

用户明确要求“发布”，未限定平台，已登记 `title-summary-crash-mobile-20261023`。来源与远端 main 基线为 `4cbda2ab8f2ef60a45f7140147aae014f7aca2d1`，独立 worktree 为 `/Users/zhongtian/.codex/worktrees/conversation-title/codex-mobile`，保留主工作区无关改动。发布前渠道为0.3.30；版本由协调器分配，不提前填写或改动冻结清单。

TDD 已在修复阶段执行：真实 WebKit 测试修复前以 SIGABRT 复现 `Invalid number value (NaN) in JSON write`，修复后成功；8文件78项相关回归、类型检查及前端构建通过，3项弹窗流程和1项真实 App／网关／JavaScript／WebKit 回归通过。原始证据在 `~/Library/Application Support/CodexMobile/validations/title-summary-crash-20261023/`。本轮只准备发布文档和日志；若发现代码缺陷，先增加失败回归，再最小修复，不改写旧失败记录。

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
- [ ] 来源完成规格审查后再完成质量审查，修复阻塞意见后才进入 ready。

任务一实测结果：四项门禁均退出码0，适配器217项（12.756秒）、协调器59项（42.991秒）、构建契约21文件144项（31.568秒）、类型检查1次（4.874秒）。日志、起止时间、计数与 SHA-256 在仓库外 `~/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261023-title-summary-crash/`；`validation.json` 绑定最终推送的完整来源 SHA。`inherited-evidence.json` 引用修复前失败、修复后8文件78项相关回归及3项弹窗和1项完整 App 链路的原始日志／xcresult，记录全部9个非文档修复文件与提交 `4cbda2ab8f2ef60a45f7140147aae014f7aca2d1` 逐字节一致，并为结果包生成完整散列清单；不补造旧日志未记录的 shell 退出码。

根代理的 `preflight.json` 已核对发布前 APK／IPA、HTTPS OTA、GitHub 与 unsigned 软件源均为0.3.30（3030），当前 GitHub 用户和软件源原开发者均为 `zh0ngtian`；最新上游说明要求沿用既有 unsigned IPA 订阅、保留署名，Ad Hoc 签名包只进入 LAN／HTTPS OTA。发布准备只改本任务列出的三份文档，未改版本或冻结清单；来源的独立规格和质量审查仍待主代理执行。

## 任务二：协调器双端发布与成功凭证

**文件：** 只读已推送来源与本机配置；协调器生成冻结清单、批次记录和长期产物。

- [ ] 执行 `releasectl ready --task title-summary-crash-mobile-20261023 --sha <已审查完整来源SHA> --validation <任务一实际validation.json>`；尖括号值必须使用任务一真实结果，不能预造版本或 SHA。
- [ ] 以最多45秒一次的 `releasectl wait --task title-summary-crash-mobile-20261023 --timeout 45` 跟踪阶段；只在变化时更新进展。若失败，保存现场，只对最新失败叶节点登记关联修复，不手工 resume 或另起正式打包。
- [ ] 成功后读取该任务对应 receipt，核对 task 来源包含、冻结 SHA、版本／构建号、全部 main/build/iosbuild/sign/ota/apk/ipa/source/verify 阶段、正式和开发 CI 成功；不能把单端成功当作交付。
- [ ] 先进行规格审查，再进行质量审查；本阶段尚不宣称真机覆盖安装或数据保留已验证。

## 任务三：独立回验、文档收尾与交付

**文件：** 新建 `docs/superpowers/plans/evidence/2026-10-23-title-summary-crash-release.json`；修改本计划、`README.md`、`docs/README.md`、`docs/interaction-alignment.md`。

- [ ] 独立读取固定 APK／IPA JSON、HEAD 和完整 GET，核对 receipt 中本次版本、文件大小和 SHA-256；HTTPS OTA 安装页、JSON、manifest、版本化 IPA 必须使用项目 CA 校验。
- [ ] 对实际下载的 Ad Hoc IPA 独立验签，与真实兼容基准核对 Bundle ID、Team、application-identifier、完整 entitlements 与钥匙串组连续性。
- [ ] 独立核对 GitHub APK／unsigned IPA、软件源版本／构建号／URL／大小／散列、中文用户变化日志及当前账号与原开发者署名；已签名 IPA 不上传软件源。
- [ ] 将脱敏字段白名单凭证、真实验证结果和当前渠道状态同步至上述五份文档；保留0.3.30与旧网关部署历史，注明本轮客户端修复，不改变网关部署状态。
- [ ] 完成规格、质量及整体收尾审查后，在共享 main 锁内核对最新远端并提交推送；若 main 有变更，对整合后的相关范围重新验证。纯文档收尾不再次触发正式发布。
- [ ] 最终回复提供实际版本、固定 OTA 安装页、本次 APK 与已签名 IPA 固定下载链接、大小及完整 SHA-256。真机覆盖安装及数据保留继续保持待验收。
