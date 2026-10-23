# 模型提问选择窗口双端发布与配套网关部署计划

> **执行代理须知：** 使用 superpowers:subagent-driven-development 逐项执行，先规格审查、再质量审查；正式发布与部署只由主协调入口操作，独立验证不修改共享发布状态。

**目标：** 将用户已确认的异步模型提问与紧凑选择窗口发布到双端固定渠道，并部署历史问题回填所需的配套网关，取得两个成功批次凭证。

**架构：** 复用现役 releasectl，客户端目标为 codex-mobile-lan-production，网关目标为 codex-mobile-gateway-production，共用 codex-mobile-main-production 锁。两个目标使用同一推送来源 SHA；协调器负责整合 main、分配版本、冻结和正式构建发布。

**技术栈：** Python unittest、Vitest、TypeScript、GitHub Actions、Xcode、Ad Hoc 签名、固定 LAN、HTTPS OTA 与既有 unsigned IPA 软件源订阅。

---

用户本轮明确要求“发布”，默认双端；已登记 model-question-window-mobile-20261023 与 model-question-window-gateway-20261023，持续 heartbeat。准备基线为远端 main `8f174ba70c28154b3ac04d72049dc000a02c4f5d`，包含提问处理 `2a5d10e`、紧凑窗口 `7055949`，以及已合入的通知名称修复。开始时固定 APK／已签名 IPA 均为0.3.31；版本由协调器分配，本计划不手工决定版本。准备期间已纳入其他授权网关批次的最新 main `fa1e8d6`；该次增量仅为部署文档和冻结记录，相关整合回归另行验证。

主工作区已有无关暂存改动，在独立 worktree 执行，不复用主工作区脏索引。上一轮已验证的窗口截图、57.615秒完整 App 流程、23项相关回归保存在主工作区 `.mobile-build/compact-question-preview-20261023/`；异步提问处理原185项回归及历史恢复50项定向回归保存在 `.mobile-build/model-question-preview-20261023/`。

TDD：功能阶段已先复现异步格式漏接、待确认队列重排和多题滚动点击遮挡，再修复并验证。发布准备不增加生产运行代码；先对旧更新日志运行本版内容断言并记录失败，再写入实际中文用户变化并验证通过。若发布中发现需要修改运行代码或适配器，先补最小失败回归再修复，不绕过门禁。

## 任务一：准备与审查同一发布来源

**文件：** 修改 `release/notes.md`、`docs/interaction-alignment.md` 和本计划；仓库外验证目录为 `~/Library/Application Support/ReleaseCoordinator/validations/model-question-window-20261023/`。

- [x] 登记两个目标，记录基线和现役0.3.31，建立35秒 heartbeat，使用独立工作区。
- [x] 阅读最新 SignOs 软件源说明；继续只同步既有 Codex Mobile unsigned 订阅，Ad Hoc 包仅进入 LAN／HTTPS OTA，保持当前登录用户及原开发者署名。
- [x] 执行旧日志断言并记录失败：读取 `release/notes.md`，要求包含异步提问、紧凑窗口和已合入的最新通知名称变化；缺少时以非零退出，不把旧闪退日志作为本版日志。
- [x] 将 `release/notes.md` 写为：
  ```text
  - 模型发出结构化提问时，直接显示可选择或自行填写的回答窗口，支持稍后继续。
  - iOS 提问窗口改为参考指令排队的紧凑卡片，按内容收缩，稍后回答与提交按钮同排，多题可滚动。
  - 回答提交失败时保留答案；执行中的回答立即作为引导发送，已结束时发送新消息，保留原有未发送草稿。
  - 新会话完成通知等待自动名称保存后再发送，并在实际投递时读取最新会话名称。
  ```
- [x] 重新运行内容断言，确认退出码0；不追加版本／SHA／未签名等固定分发模板文字。
- [x] 执行 `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，记录 adapter-regression。
- [x] 在 `/Users/zhongtian/WorkSpace/release-coordinator` 执行 `python3 -B -m unittest discover -s tests -p 'test_*.py'`，记录 coordinator-recovery。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，记录 build-contract。
- [x] 执行 `npm run typecheck`、`npm run build:server`，并执行本次异步提问／历史回填／审批／通知名称的相关回归。全部保存真实退出码、计数、命令、日志与散列。
- [x] 只读运行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --plan`，核对现有签名配置、升级身份与渠道预检；不独立正式发包。
- [ ] 对准备来源先完成规格审查，再完成质量审查；修复阻塞意见后，按中文提交规范提交并推送独立分支。validation.json 绑定最终完整来源 SHA 和四项门禁实测证据。

## 任务二：协调器发布与部署

**文件：** 只读已推送来源；协调器产生冻结清单、版本、批次、正式日志、签名包与成功 receipt。

- [ ] 用同一已推送 SHA 和 validation.json 为两个任务提交 ready；不手工推进正式 main、不另起正式 APK／IPA 构建。
- [ ] 随阶段变化跟踪两个任务，允许与同目标已有任务合批；不取消其他任务，不修改其状态。
- [ ] 客户端核对 main/build/iosbuild/sign/ota/apk/ipa/source/verify 全部阶段；网关核对 main/gateway/verify。失败按不可变失败链创建显式修复任务，结果未知先对账。
- [ ] 读取两个成功 receipt，核对来源 SHA、祖先包含、冻结 SHA、版本、正式／开发 CI、长期产物、网关部署标识与实际进程摘要。
- [ ] 两个目标分别先完成规格审查、再完成质量审查，不能用客户端成功替代网关成功。

## 任务三：独立回验、收尾与交付

**文件：** 新建 `docs/superpowers/plans/evidence/2026-10-23-model-question-release.json`；更新本计划、`docs/interaction-alignment.md`、`README.md`、`docs/README.md` 的实际现役状态。

- [ ] 独立读取固定 APK／IPA JSON、HEAD 和完整 GET，核对实际版本、字节大小和完整 SHA-256；HTTPS OTA 安装页、JSON、manifest、版本化 IPA 使用项目 CA 验证。
- [ ] 对实际下载的签名 IPA 独立验签，核对 Bundle ID、Team、application-identifier、完整 entitlements 和钥匙串组连续性；不把验签或模拟器当作真机覆盖安装。
- [ ] 核对 GitHub unsigned IPA 与软件源实际版本、构建号、URL、大小、散列、中文用户变化日志和原开发者署名；不上传 Ad Hoc 包到软件源。
- [ ] 保存两个成功凭证及脱敏公共索引，补齐计划状态、当前渠道与部署记录；先规格、后质量及整体收尾审查，按 main 互斥完成纯文档整合，不重复构建发布。
- [ ] 停止 heartbeat、归档本轮工作区；真实测试会话若有创建则及时归档。
- [ ] 最终回复包含可点击固定 OTA 安装页、APK／已签名 IPA 固定下载链接、统一版本、两包大小与完整 SHA-256，并明确真机验收边界。
