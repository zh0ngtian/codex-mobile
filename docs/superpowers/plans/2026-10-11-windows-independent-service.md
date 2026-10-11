# Windows 独立 Codex 服务与空闲自动对齐实施计划

**目标：** 后台与界面分离，自动检查已安装 Codex 的配套二进制，在所有工作空闲后切换版本。

**架构：** 当前用户计划任务启动 PowerShell Job 宿主，宿主管理 Node supervisor；真实 app-server 使用每代独立 Job，透明 WebSocket 入口统一桌面和手机请求准入，网关与隧道继续使用原配置。部署文件保存在仓库外长期目录。

**技术栈：** Node.js、ws、PowerShell 5.1、Windows Job Object、Windows 计划任务。

**设计：** docs/superpowers/specs/2026-10-11-windows-independent-codex-service-design.md。

## 全局约束

- 用户已确认设计并要求开始，在当前会话直接实施。
- 公共 app-server 入口 127.0.0.1:18765、网关 127.0.0.1:18766、远端隧道 18767；真实 app-server 私有端口默认 18768。
- 检查间隔 60 秒，持续空闲 30 秒；状态未知或查询失败禁止自动更新。
- 所有桌面和手机请求都经过可暂停准入的入口；进入切换后复查全部会话、后台终端和在途请求。
- 默认不强制停止任务；不擅自关闭当前 Codex 或其他 app-server。
- 本机口令仅使用现有 DPAPI 文件；控制接口另用本机随机凭据，不记录正文和口令。
- 只改变 Windows 后台，不构建手机安装包。

## 审查重点

- 分页会话和子 Agent 被漏读导致误判空闲。
- 入站新任务与最后一次空闲检查竞争。
- 二进制复制时更新包变化，或重启后版本仍是旧版。
- 重启失败后端口占用或未知进程被误杀。
- 监控、日志和状态输出泄露口令或用户内容。

## 任务 1：统一连接入口与空闲判断

文件：scripts/windows/service/shared-endpoint.mjs、rpc.mjs、idle-state.mjs；tests/windows/service-policy.test.mjs、shared-endpoint.test.mjs。

接口：SharedEndpoint 提供 listen()/drain()/resume()/disconnectClients()/close() 和 pendingCount；readIdleState(rpc) 完整读取运行状态；IdleUpdatePolicy.observe(target, idle, time) 决定是否可尝试切换。

- [x] 先测试状态分页、审批/输入/后台终端/未知状态阻止更新，观察缺少实现而失败。
- [x] 实现只读 RPC、完整分页及空闲策略，测试通过。
- [x] 用真实 WebSocket 验证准入屏障：此前请求完成后才排空，屏障后的新请求不进入上游，双端都受同一屏障控制。
- [x] 保留反向审批回复、响应 ID 和消息顺序；测试异常连接与独立进程阻止更新，不泄露正文。
- [x] 验证通过并提交本任务。

## 任务 2：独立生命周期与版本切换

文件：scripts/windows/service/runtime.mjs、versions.mjs、run-service.mjs、resolve-desktop.ps1、run-owned-process.ps1、start-independent-service.ps1；tests/windows/service-runtime.test.mjs、service-versions.test.mjs。

接口：版本快照返回 fingerprint/executable/version/desktopExecutable；ServiceRuntime 提供 start()/checkUpdate()/restart()/status()/stop()；生命周期适配器每代拥有独立进程树。

- [x] 先测试保持后台与界面无关、忙时等待、空闲自动切换、切换前再次变忙时取消、失败回退及版本一致不重启。
- [x] 实现经过散列校验的版本快照，动态解析当前安装包，不固定旧路径。
- [x] 实现服务 supervisor、私有控制接口及 Windows Job 宿主，沿用现有网关和隧道配置。
- [x] 修复既有 Windows Job 测试启动方式：使用与已部署任务相同的进程级 RemoteSigned，不更改系统执行策略。
- [x] 验证测试及现有 External 网关/Windows Job 回归，通过后提交。

## 任务 3：安装入口、部署与交付

文件：scripts/windows/manage-service.ps1、docs/windows-independent-service.md；tests/windows/service-control.test.mjs。

接口：manage-service.ps1 支持 install/start/stop/restart/status/ui/check；部署到 LOCALAPPDATA/CodexMobile/Service，备份原任务、启动项和环境变量。

- [x] 测试控制接口鉴权、并发更新互斥、状态脱敏和错误传播。
- [x] 实现安装与三个快捷方式；用户登录自动启动后台，界面单独打开。
- [x] 运行新 Node 测试、既有回归、仓库完整测试和必要语法检查，如实记录现有基线问题。
- [ ] 全分支独立代码审查并修复重要问题。
- [ ] 部署文件、备份、注册新任务，检查切换条件；当前桌面有活动任务时保留待切换状态并提供具体切换步骤。
- [ ] 切换后通过本机/公网健康和只读 RPC 核验；未实测部分明确记录，不提前宣称恢复成功。

## 执行记录

执行账本保存在 .mobile-build/independent-service/progress.md。设计已由用户确认；用户“可以的，开始吧”明确授权本会话实施，按此授权连续执行，不重复请求计划实施许可。

验证：新增 Node 测试 21 项通过，现有 Windows Job 与 External 网关回归 3 项通过；类型检查及 Node/PowerShell 语法检查通过。使用临时独立 CODEX_HOME 核验真实 codex-cli 0.162.0-alpha.17.2，经共享入口初始化、模型列表与后台终端接口成功，没有读取或创建用户现有会话。

完整 Windows 测试为 851 通过、53 失败、3 跳过。失败集中于 ios-attachment-picker、ios-local-build、portrait-orientation 和 bark-notifications；在原 Windows 分支重新运行这四个文件，同样为 53 失败、19 通过，确认是原有平台基线问题。本次不改动这些无关模块，不将完整套件声称为通过。
