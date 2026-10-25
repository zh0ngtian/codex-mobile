# 模型请求上传计量网关部署计划

> **执行代理须知：** 使用 superpowers:executing-plans 逐步执行这一相互依赖的部署任务；步骤用复选框跟踪。已有运行代码不重写，发现新缺陷时先补失败回归，再最小修复并验证。

**目标：** 将 main 已包含的模型请求上传计量后端部署至现役受管网关，为0.3.36客户端提供实际载荷字节数。

**架构：** 复用现役 releasectl、codex-mobile-gateway-production 目标和 codex-mobile-main-production 共享锁。协调器整合固定来源、构建服务端并部署到原安装目录；仅部署网关，不构建或发布客户端。

**技术栈：** TypeScript、Vitest、Python unittest、Codex app-server、HTTP/SSE、WebSocket、launchd、GitHub Actions、ReleaseCoordinator。

---

起始远端 main：`c58824ce074c4ae7acc7cea75e4b7277a6d810a6`。任务：`model-upload-gateway-20261025`。隔离工作区：`/Users/zhongtian/.codex/worktrees/model-upload-gateway/codex-mobile`。完整原始证据保存在仓库外 `~/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261025-model-upload-gateway/`。源码功能和本地HTTP／WebSocket两轮逐字节验收已经完成；本轮复验已有测试，不伪造新的RED记录。如果部署发现新缺陷，遵循TDD先观察失败、最小修改、再验证。

## 任务一：准备和验证

**文件：** 本计划、`docs/interaction-alignment.md`；只读检查 `server/model-upload-*.ts`、`server/app-server-manager.ts`、发布适配器及现役安装。

- [x] 登记任务、30秒heartbeat、创建隔离worktree并记录main基线；保留主工作区原有暂存内容。
- [x] 记录原网关PID、marker、server/bin/manifest/dist及启动配置散列和认证健康，确认依赖声明一致。
- [x] `npm ci --no-audit --no-fund` 安装锁定依赖。
- [x] `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`：adapter-regression，227项通过。
- [x] 在 `/Users/zhongtian/WorkSpace/release-coordinator` 执行 `python3 -B -m unittest discover -s tests -p 'test_*.py'`：coordinator-recovery，59项通过。
- [x] `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`：build-contract，21文件144项通过。
- [x] `npm run typecheck` 和 `npm run build:server`：分别保存typecheck和server-build证据，退出0；不运行客户端构建。
- [x] `CODEX_MODEL_UPLOAD_SMOKE_BIN=/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/server --maxWorkers=2 --testTimeout=60000`：验证模型原样转发、计量、HTTP/WS协议和真实CLI隔离假上游；测试会话归档后清理。

## 任务二：固定来源和协调部署

**文件：** 仓库外 `validation.json`；协调器负责 `.release-batch.json` 和生产写入。

- [x] 检查文档差异和提交规范，提交中文部署准备记录并推送独立来源分支；validation绑定完整来源SHA、四项真实passed检查及日志散列。
- [x] `releasectl heartbeat --task model-upload-gateway-20261025 --state closing`；从validation读取完整来源SHA提交ready，不手改冻结清单、不直接更新生产安装。
- [x] 使用 `releasectl wait --task model-upload-gateway-20261025 --timeout 45` 等待；核对prepare/main/gateway/verify成功及持久receipt一致。

## 任务三：部署回验与收尾

**文件：** `README.md`、`docs/interaction-alignment.md`、`docs/README.md`、本计划及 `docs/superpowers/plans/evidence/2026-10-25-model-upload-gateway-deploy.json`。

- [x] 核对同冻结SHA必要开发CI通过，客户端build/release跳过，无App版本分配。
- [x] 独立核对实际PID、命令、端口、认证健康、marker及部署散列；dist、依赖和启动配置保留。
- [ ] 用现役网关建立独立测试会话，发送最小模型请求，读取 `mobile/uploadUsage/read` 确认真实回合的正字节数和实时事件；归档测试会话。记录精确实测值及验证边界，不将传输层计量描述为模型服务接收确认。
- [x] 同步“已安装待用户重启”状态及白名单公共凭证，检查JSON、链接和差异，准备共享main锁内的纯文档提交；推送结果以Git历史与仓库外收尾凭证为准。
- [x] 核对主工作区暂存内容不变，任务进入批次后停止heartbeat；保存长期证据。
- [ ] 用户手动重启并完成实测回验后，更新激活状态、提交文档并归档本任务worktree。

首次预检历史：当时等待运行模式决策，尚未ready、未变更生产网关。四项门禁通过（217／59／144项及类型检查），服务端构建通过，六文件91项计量与网关回归通过。只读预检确认现役mode=external，连接127.0.0.1:14550/rpc；当时计量只支持managed，直接部署无法提供现役会话字节数。后续用户已确认保留外接方式并同意桌面启动适配器接入；桌面App由用户手动重启。

用户已选择方案1，保留桌面桥接。真实CLI能力探测确认已加载会话不应用resume出口覆盖；[桌面适配器接入方案](2026-10-25-desktop-model-upload-design.md)的共享模型出口改动和桌面App重启随后已获用户确认。本地实现和隔离验证完成后，已协调部署安装，仍待用户手动重启激活。

## 已确认的桌面接入实现任务（执行中）

用户已同意桌面适配器方案，重启由用户手动操作。使用 superpowers:subagent-driven-development 的分工和先规格后质量审查流程；桌面计量IPC和启动／部署集成分别修改独立文件，最终统一回归。

### 任务四：桌面统计Unix socket

文件：`server/model-upload-meter.ts`、`server/model-upload-ipc.ts`、`tests/server/model-upload-ipc.test.ts`。先写失败测试，使用真实Unix socket验证权限、来源绑定、快照、实时更新、重连／epoch切换、丢弃旧revision、有界缓存和关闭清理；运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/server/model-upload-ipc.test.ts` 观察预期失败。最小实现只发布ID和计数，复用原meter，定义read／subscribe源接口，写入RED／GREEN长期证据。

### 任务五：桌面启动与网关外接集成

文件：`server/desktop-model-upload.ts`、`server/model-upload-routing.ts`、`server/app-server-manager.ts`、`server/index.ts`、`server/gateway.ts`、`server/http-session.ts`、`tests/server/desktop-model-upload.test.ts`。失败测试先验证只接入canonical app-server、原参数／stdio／工具管道保持、子进程路由覆盖、网关external从同来源IPC读取；非canonical命令原样传递。复用原代理，原桌面适配器备份后仍承担canonical服务启动，计量随桌面生命周期关闭。原model config读取新增真实CLI绝对路径与原有config flags支持，不查询账户。运行范围测试及服务端构建，不构建客户端。

### 任务六：协调安装与交付

文件：`scripts/release_coordination/desktop_meter.py`、`scripts/release_coordination/gateway.py`、`tests/ci/test_desktop_meter_install.py`及现行文档。先写失败测试验证私有适配器预期散列、原子备份／替换、重复安装恢复和漂移拒绝。私有任务验证记录显式声明已确认的适配器／CLI／node／canonical来源，并绑定实际任务SHA；协调器只安装到长期目录，保留原适配器、不重启桌面App。四门禁和功能回归通过后推送固定SHA、ready并等成功receipt；用户手动重启前状态明确为已安装待激活，之后回验同桌面服务与实测计量，归档测试会话。

- [x] IPC按先红后绿完成。
- [x] 桌面启动与网关外接集成按先红后绿完成。
- [x] 协调安装按先红后绿完成。
- [x] 独立规格审查通过后，代码质量审查通过。
- [x] 最新main整合结果、四门禁、功能回归及服务端构建通过。
- [x] 协调部署和适配器安装成功，到激活点通知用户手动重启。
- [ ] 用户重启后的共享服务与实测计量回验完成。

本地实现进度：桌面HTTP／WebSocket真实CLI共享服务两轮测试通过；桌面启动、参数与信号保持、external网关读数、原件备份／漂移／中断保护及31项网关部署恢复回归通过。UDS独立规格审查发现的快照／live淘汰与启动订阅窗口均已按先红后绿修复，29项UDS和独立重放通过；桌面规格审查通过。质量审查确认的SIGINT保持问题已补失败回归并修复，复审确认信号保持及prepared六项参数漂移拒绝。单独IPC断线时客户端保留最后实测快照的边界已明确记录。私有安装参数随任务验证冻结，不改变现役项目配置。

最终验证日志以仓库外 `*-final.json` 为准；SIGINT与任务安装参数绑定修复后的33文件400项服务端回归、适配器227项、类型检查及服务端构建通过，协调器59项与构建契约144项复用未受修改影响的成功结果。独立规格和质量审查均已通过。整合前再次fetch确认远端main仍为 `3db96e6ce950e333d987c6952192d3a6ee255902`，没有新增整合内容。桌面重启仍由用户手动操作。

## 部署结果与待激活边界

成功批次 `ddc37232-fba9-4cd0-8dfa-88031bb4ae08`，固定来源 `41c3c27636800dc6006d13c5fd7ff193d2ad8d05`，冻结提交 `6b9cb2febb532338f3ad6deef09ffcaa34191d59`。prepare/main/gateway/verify全部完成，持久receipt与协调器一致；开发CI `40172849559`、清单CI `40172849528`成功，客户端build/release跳过，无App版本分配。[公共凭证](evidence/2026-10-25-model-upload-gateway-deploy.json)。

独立核对网关新PID61621、进程命令、监听和认证健康、marker及文件散列通过；前端、依赖、启动脚本与环境保持。桌面入口及原件备份权限700，安装摘要与prepared候选一致；原桌面进程PID80040仍在，统计socket尚未出现，符合未重启、未激活状态。主工作区暂存／未暂存／状态散列与原记录一致，heartbeat已在任务进入批次后停止。

**下一步由用户操作：** 完全退出并重新打开桌面App，再告知本线程。代理未自行重启；重启后继续核对原桌面共享服务、网关统计来源和真实模型请求上传字节，完成后再记录计量已生效并归档worktree。本次纯文档记录的main基线为冻结提交 `6b9cb2febb532338f3ad6deef09ffcaa34191d59`，不重复构建或部署。
