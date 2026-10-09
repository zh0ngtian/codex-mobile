# Windows 共享 app-server 实施计划

> 使用 superpowers:executing-plans 在当前分支逐项执行，使用 TDD 验证生命周期。

**目标：** 桌面端和手机网关连接同一个 app-server，桌面进程退出后清理服务，下一次启动使用已安装桌面版的当前二进制。

**架构：** Windows 启动器使用 Job Object 管理本次启动的桌面、app-server、网关及 SSH 子进程。只监听本机回环地址；公网由现有 Caddy 7443 按域名路由到 SSH 反向隧道。网关使用 External 模式。

**技术栈：** PowerShell 5.1、Windows Job Object、Node.js、OpenSSH、Caddy。

**需求依据：** 用户已批准原生 Windows、唯一服务、随桌面启动和退出、最后重启、发 IPA；禁止 push。

## 约束与风险

- 不改变 macOS 启动路径，不修改桌面安装包，不复制登录密钥。
- 先检查现有桌面进程和端口，拒绝双开；不自动杀死其他实例。
- 新子进程先挂入 Job 再运行，避免退出时留下子孙进程。
- 正常退出及启动器异常退出都必须清理所管理进程。
- 真实 app-server 启停此前被执行策略拒绝，禁止换工具绕过；只测试自建的无业务测试进程，实际启用仍需执行环境允许。
- 手机 IPA 沿用已核验的上游 v0.2.106 未签名包，本次仅服务端变化，不冒充重新编译的 IPA。

## 任务

- [x] `scripts/windows/OwnedProcessJob.cs`：创建 kill-on-close Job，用暂停创建、加入 Job、恢复运行顺序启动程序。测试正常释放与宿主异常退出时测试进程均终止。
- [x] `scripts/windows/start-shared-session.ps1`：完成候选启动器、解析检查和只读预检；动态定位桌面安装包、检测冲突，真实启用单独验收。
- [x] 生成 Caddy 待应用配置并通过 adapt 语法转换；公网 DNS 和远程端口已确认。TLS 加载和实际流量仍待切换验收，未替换现有服务。
- [x] 核验并发送 IPA，说明仅安装客户端尚不等于后端联通。
- [ ] 最终实测：真实桌面连接、两端会话和审批、公网认证、正常退出与更新后重开。受执行策略阻塞时如实保留未完成状态。

## 执行记录

- 已确认公网 DNS 指向 101.43.25.39，服务器 Caddy 2.11.7 可复用 7443，拟用反向隧道端口 18767。
- Ruling: 不 push，亦不向仓库作者私有局域网发布；用户明确约束优先于仓库通用交付规则。
- Windows 服务端回归：158 通过，3 项 POSIX 专用测试跳过；其中 2 项真实测试进程验证了 Job 正常/异常退出清理。未运行真实桌面服务切换，不声称桌面/手机联通。
- 本机候选配置：`%LOCALAPPDATA%\CodexMobile\shared-session.json`，访问口令由 DPAPI 加密存储；服务器候选文件：`/home/roxbili/codex-mobile-Caddyfile.pending`，未应用。
- 实际切换仍受此前工具 `blocked by policy` 限制；未通过新的启动器绕过限制，现有桌面自启动项未替换。
