# 新对话记忆、引导归并与双端发布计划

**目标：** 新对话默认恢复上次选择的机器与该机器的项目；同轮引导集中出现在最终回答前，中途旧回答收进过程。将本分支此前已验证的输入栏、侧栏、滚动和未读强调色一并合入main并正式发布。

**已确认设计：** 用户2026-10-19确认“收进过程”。保留初始提问；引导消息按原顺序出现；中间旧回答及过程归入最终回答前的折叠过程；只在外部展示最后最终回答。数据、原始消息身份、附件、复制和历史编辑不得丢失。运行中尚无最终回答时继续显示实时过程，不伪造完成。显式机器/项目新建入口仍使用其明确目标，普通新对话使用已记忆选择；不增加新的不可用目标回退策略。

**架构：** 机器/项目继续由现有Web业务保存并通过原生命令传递，原生不另存一份偏好。引导规则尽量集中在共用展示投影中，Web与iOS原生共享同一呈现契约，保留原始wire记录。只改客户端，不部署网关。

## 1. 新对话目标记忆（TDD）

- [x] 在 `tests/ui/native-ui-new-chat.test.ts`、真实App导航测试及 `tests/ci/agent-session-smoke.swift` 增加失败回归：普通新建不强传空cwd，保存机器/项目可重用，显式无项目与明确项目仍受尊重，设备切换保留草稿。
- [x] 运行 `npm test -- tests/ui/native-ui-new-chat.test.ts tests/ui/native-ui-app.test.tsx tests/ci/agent-session.test.ts` 记录预期失败。
- [x] 修复 `src/App.tsx`、`src/native-ui/new-chat-target.ts` 与 `mobile/ios/AgentUI/Session/AppSession.swift` 的目标传递和恢复入口，继续复用现有 `codex-mobile:new-chat-backend` / `new-chat-project:<backend>`。
- [x] 相同回归转绿，检查冷启动、重复新建、明确项目入口和机器切换。

## 2. 引导与旧回答呈现（TDD）

- [x] 在 `tests/ui/conversation.test.tsx`、`tests/ui/native-ui-projection.test.ts` 增加完整内容/顺序回归：多次引导、多个旧回答、最终回答、无最终回答运行中、媒体去重与历史身份。
- [x] 运行 `npm test -- tests/ui/conversation.test.tsx tests/ui/native-ui-projection.test.ts tests/ui/image-loading.test.tsx` 记录预期失败。
- [x] 调整 `src/ui/turn-response-presentation.ts` 的共用呈现分段、`src/features/conversation/Timeline.tsx` 与 `src/native-ui/projection.ts` 的两端展示，必要时最小修改Swift呈现层；最终回答外只保留一份，各旧回答可在过程展开后查看。
- [x] 相同回归转绿，确认引导与附件没有重复、丢失或跨回合挪动。

## 3. 整体验证与交互合同

- [x] 更新 `docs/interaction-alignment.md` 现行要求、验收要点及状态；更新中文 `release/notes.md`，只列本次实际用户变化。
- [x] 完成代码独立审查，执行范围内与完整回归、typecheck和前端构建。
- [x] 排队独占iPhone 17 Pro正常字号竖屏模拟器，验证记忆恢复、引导折叠顺序及此前UI；本轮未发送真实测试会话，无需归档远端会话。
- [x] 完成协调器所需 `adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck` 四项带命令与日志的真实验证。

## 4. main整合与正式双端发布

- [x] 在既有releasectl登记任务 `composer-sidebar-memory-steering-20261019`，目标 `codex-mobile-lan-production`。
- [x] 持续heartbeat，提交并推送固定SHA，生成私有validation凭证后ready。
- [x] main推进、版本分配、双端构建、Ad Hoc签名与渠道交付均交由协调器；失败按既有不可变批次关联修复流程处理。
- [x] 等待成功receipt，核对任务SHA包含、GitHub APK/unsigned IPA、固定LAN APK/签名IPA、HTTPS OTA、软件源版本和中文日志。
- [x] 完整下载回验版本、大小与SHA-256，保存凭证，交付固定OTA安装页及本次APK/已签名IPA固定下载链接。

**发布边界：** 不独立手动发包，不创建重复数据库，不向软件源上传签名IPA，不安装真机。本次新功能与此前输入栏/未读等修改必须同批纳入；仅分支推送或某一阶段成功均不代表交付完成。

实现验证：新对话路径69项、引导路径151项分别通过，父任务合并运行10文件221项及typecheck通过。规格/质量两阶段审查均已通过。审查发现的目录失败后重试丢记忆、运行中缺省phase正文借用旧耗时均新增回归先失败后修复；Swift旧回答历史锚点亦先失败后修复。原生旧回答使用可选isPreviousReply过程标记保留Markdown，普通commentary样式保持。

全量回归额外发现原生已结束但无final时的历史投影兼容问题：7项实际回归已恢复，3项引导旧契约按已确认需求更新，保留媒体边界与原消息身份断言。修复后11文件289项、typecheck及独立复审6文件189项通过。模拟器引导、多行输入、未读强调色、回底中断/连续动画/运行态和五条分页共7项已通过；真实机器与项目记忆及最终全量门禁后续已通过，见最终发布记录。

## 5. 本机设备构建输出协议修复（TDD，关联失败批次）

首次批次 `926b35b9-3375-4167-ba04-b7da370f1f97` 已推进main，冻结 `808325edc8f0bceda8c8407f5de12dce91b76761`，分配0.3.12。云端双端构建及GitHub Release成功，设备IPA也实际编译成功，但iosbuild的准备工程子进程将进度继承到stdout，导致严格JSON协议失败；尚未签名或发布固定LAN/OTA，不将云端成功视为交付。失败现场保持不可变。

- [x] 登记 `composer-sidebar-iosbuild-repair-20261019`，明确关联上述最新失败叶节点并持续heartbeat。
- [x] 新增真实子进程输出边界失败回归：适配器stdout仅一行JSON，准备和归档诊断进入stderr，编译日志继续单独保存。
- [x] 最小修复既有设备构建helper的输出流，不放宽协调器协议；记录red/green并完成独立审查。
- [x] 重跑修复范围发布门禁，提交推送固定SHA后ready，等待关联新批次成功凭证。新批次按既有规则分配版本，原批次与旧云端包保留。

修复前客户端功能验证：146文件1603项全量回归、203项Python发布回归、59项协调恢复与typecheck均通过。iPhone 17 Pro正常字号竖屏七项界面回归及实际连接机器的重复新建/应用重启记忆共八项通过；前端构建通过。模拟器截图及日志存于本机ReleaseCoordinator对应validation目录。修复只影响发布输出协议，不改变已验收的客户端运行代码。

设备构建输出修复的真实CLI回归已先失败后通过：失败stdout包含准备进度、归档进度及JSON；修复仅将prepare/ditto两个子进程stdout显式导向stderr，Xcode两路输出仍只写compile.log。新增回归保留完整JSON解析及来源/版本/真实产物断言，独立审查与最终门禁已通过，并已取得关联修复批次的真实发布成功凭证。

## 最终发布与交付（已完成）

关联修复批次 `20b9fda4-bfad-43c1-bc04-70edc059dcc7` 已取得成功receipt，原任务状态为recovered且指向该批次。冻结main为 `b9eaee5956d8af664663f9464e0fae7f03d14d50`，版本 **0.3.13（3013）**，包含原客户端提交 `860f1ea` 和输出协议修复 `d620a1b`。原0.3.12失败批次、错误与云端产物保留，没有resume或覆盖历史。

修复通过真实CLI red/green及两阶段独立审查；最终204项Python发布回归、138项构建契约、59项协调恢复及typecheck通过。客户端运行代码相对1603项完整回归和八项iPhone 17 Pro模拟器验收未变。正式双端CI `39196602629` 与必要开发CI `39196602605` 成功；本机设备构建、Ad Hoc签名、HTTPS OTA、固定LAN双端及软件源unsigned订阅均已回验，软件源中文日志与release/notes.md一致，当前gh用户名署名保留。

| 产物 | 大小（bytes） | SHA-256 |
| --- | --- | --- |
| APK | 4724639 | `014193f94c83c63235dced4eaec8e5424f963cf38987d8048ebde90d8d06bd68` |
| IPA（Ad Hoc已签名） | 4664784 | `be4e4403903d55ae3f5ba691a59d25feaa062453705c3c52aa287434b3e3f3af` |
| 软件源GitHub unsigned IPA | 4659980 | `91da7e1081820c3a004e2da716d58388ae278669b979dd382062cbb414b72890` |

固定[OTA安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)、[APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)与[已签名IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)已核对版本、HEAD、完整GET、大小与散列；HTTPS安装页及清单复核通过。签名保留授权Bundle ID、Team、application-identifier及完整权限/钥匙串组连续性。未部署网关，未进行真机覆盖安装或数据保留验收；本轮没有创建真实测试会话。完成后已释放模拟器锁、停止任务心跳。

[公共验收摘要](evidence/2026-10-19-memory-steering-release.json)记录冻结来源和校验值；完整成功receipt、安装包与日志保留在本机ReleaseCoordinator目录。此收尾只更新文档与验收摘要，不触发新的客户端构建或发布。
