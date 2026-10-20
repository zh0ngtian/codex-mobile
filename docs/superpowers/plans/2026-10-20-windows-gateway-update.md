# Windows 本机网关更新

用户要求拉取最新代码并更新当前 Windows 网关。主分支基线 `c116165a12931f691ec8dd677c21ae4412cfb6c7`，原 Windows 分支 `ae8e786`。独立 worktree 整合后客户端源码与主分支一致，保留既有 Windows 启动及主目录定位兼容。

- [x] 获取最新主分支并解决整合冲突。
- [x] 先复现 HTTP 持久请求、追问队列和 Bark 保存中的目录 fsync 失败，再统一使用跨平台目录同步；文件 fsync 和原子重命名保持。
- [x] POSIX mode 位及目录 fsync 故障测试按平台执行；断线清理测试等待实际落盘，避免固定 30ms 的偶发失败。
- [x] 服务端 330 项通过、4 项按平台条件跳过；服务端构建通过，独立审查指出的目录同步遗漏已修复。
- [ ] 提交推送 Windows 整合分支，当前工作区快进到已验证提交。
- [ ] 备份并替换 npm-dist/server，只重启网关子进程，验证文件摘要、认证 API、公网访问及 app-server 连续性。

目标为 Windows 已安装的 CodexMobile-Service。正式协调器配置部署另一台 macOS 的 launchd 网关，不适用本机更新；本次不推进共享 main、不触发该正式批次，保留现役静态前端、不构建 Web/APK/IPA。

当前记录构建及回归，部署最终凭证另存本机私有维护目录 `C:/Users/Fanding/AppData/Local/Codex/maintenance/gateway-update-20261020`。备份 `server-before` 可用于恢复旧产物并由现役监督器重新拉起网关；凭证不包含口令。
