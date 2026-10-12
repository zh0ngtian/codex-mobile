# Windows 独立 Codex 后台服务

后台独立运行 app-server、手机网关和 SSH 隧道。桌面界面和手机通过同一个本机入口连接共享服务；关闭桌面界面不会停止后台。

## 日常使用

- 双击桌面“打开 Codex”打开界面。入口使用无控制台启动器，启动完成后退出，不留下 Terminal 窗口。
- “Codex 服务状态”查看当前版本、目标版本和是否等待空闲。
- 自动监测每 60 秒检查当前安装的 Codex 配套二进制；不一致时，连续空闲 30 秒后自动切换。
- “重启 Codex 服务”作为手动入口。默认有运行中的任务、审批、待输入、后台终端或未知状态时不重启。

首次安装会等待现有 app-server 退出。先完成当前任务，从托盘完全退出旧 Codex，再通过“打开 Codex”打开界面。普通启动器需要重新加载用户环境才能继承共享地址；专用快捷方式每次显式设置地址。手机原有地址和口令保持不变。

## 管理命令

安装入口：`scripts/windows/manage-service.ps1 -Action install`。

安装后使用：

```powershell
$manager = "$env:LOCALAPPDATA\CodexMobile\Service\manage-service.ps1"
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $manager -Action status
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $manager -Action start
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $manager -Action restart
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $manager -Action stop
```

`-Force` 仅供用户明确需要中断任务时手动使用，自动更新永远不强制中断。

已安装的旧入口需要使用**新版仓库中的** `scripts/windows/manage-service.ps1 -Action update-launchers` 升级为无终端方式；旧部署目录内的管理脚本尚不支持此操作。此操作备份并更新快捷方式和后台任务的后续启动入口，保留正在运行的后台。状态与手动重启入口仍显示诊断窗口。

后台计划任务名为 `CodexMobile-Service`，当前用户登录时启动。部署文件及日志位于 `%LOCALAPPDATA%\CodexMobile\Service`，不依赖开发 worktree。后台 app-server 的版本快照包含经过 SHA-256 校验的配套文件；新版本启动失败会尝试恢复上一可用版本。

服务继续使用原 `shared-session.json` 的网关配置与 DPAPI 口令文件。控制接口有独立的本机随机凭据，拒绝网页 Origin；状态和日志不保存会话内容及口令。

## 切换与回退

桌面和手机均通过 18765 连接入口访问私有 18768 app-server。更新时先暂停新请求、等待在途请求完成并复查全部工作状态，再切换二进制。网关 18766 与 SSH 隧道地址保持稳定。界面是否能自动恢复需要按当前桌面版本实测；不能恢复时重新打开界面。

安装时将旧任务 XML、启动快捷方式和用户连接环境保存到部署目录的 `backup-<时间>`。回退前正常停止新服务，确认没有活动任务后恢复备份的启动项及 `CODEX_APP_SERVER_WS_URL`，再启用原 `CodexMobile-SharedDesktop` 任务。

开发验证使用 `npm run test:windows-service` 及现有 Windows Job、External 网关测试。部署验收还需检查本机和公网连接、真实桌面连接，以及关闭界面后手机连接仍然可用。

## 本机部署记录

2026-10-11 已安装后台计划任务及桌面入口，旧入口、环境变量和计划任务备份在 `%LOCALAPPDATA%\CodexMobile\Service\backup-20261011-234900`。安装后核验任务权限、文件一致性、配置和快捷方式均通过。

2026-10-12 完成首次接管：后台、手机网关与 SSH 隧道均已运行，版本处于对齐状态。本机和公网带口令的 API 均返回 200，初始化及模型列表 RPC 成功，无口令 API 返回 401。手机可继续使用原连接地址与口令。若之后通过 uTools 打开界面，先重启一次 uTools，使其读取新的用户环境变量。

新增 25 项服务测试、5 项 Windows 启动与进程回归及类型检查通过。无终端入口的真实测试确认 GUI 可执行文件类型、子进程无控制台、服务目录含空格时参数正确和后台失败退出码保留。实际打开桌面快捷方式后没有新增 Terminal 窗口，启动器正常退出，后台进程保持不变。

无终端入口备份位于 `%LOCALAPPDATA%\CodexMobile\Service\launcher-backup-20261012-085315`。当前服务的遗留终端已隐藏，服务持续运行；后续后台启动也使用无控制台入口。关闭界面后手机持续使用的真机操作仍需单独验收。
