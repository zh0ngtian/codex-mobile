# Remote 网关 Mac 管理（开发中）

本页说明源码中的 Mac 管理入口；现役网关和手机尚未部署这些改动。目标业务路由、共享队列、手机模式选择及长期稳定性验收仍在开发，不能据此认为手机已能使用 Remote。阶段状态和收据见[实施计划](superpowers/plans/2026-11-13-remote-gateway.md)。

从源码验证时先执行 `npm run build:server`，再以 `node bin/codex-mobile.mjs remote …` 调用本工作区编译产物。下列 `codex-mobile remote …` 写法指同一套已编译入口，不代表现役安装版本已包含这些命令。

## 管理同一个运行实例

网关进程持有 Remote 身份、唯一主连接和当前用户私有管理 socket。CLI 只向已经运行的实例提交固定管理操作；状态查询和 URL 导出不执行 OAuth，不新建 Remote 主连接。未授权或 Remote 启动证明失败时，本地服务仍可用；目录与进程归属无法证明时，网关启动失败。

管理目录默认为 `~/.codex-mobile/remote`。网关通过 `CODEX_MOBILE_REMOTE_DIR` 选择其他目录；CLI 使用相同环境变量或 `--root <绝对目录>`。不同目录对应不同实例，CLI 不猜测其他端口或目录，不自动启动网关。网关使用已有运行配置解析出的 canonical 地址，包括显式 `CODEX_APP_SERVER_URL`。

根目录必须为当前用户的真实私有目录，权限 `0700`；管理 socket 和元数据权限为 `0600`。CLI 只读证明祖先路径、owner、文件类型、inode、PID 和实例随机标识，不修复目录或离线写入身份。手机 token 不能调用这条私有管理通道。

运行实例固定首次观察到的祖先、根目录及实际锁/owner身份；存储克隆、身份候选、受管启动和管理入口持续使用同一证明。目录或锁证明失效后永久取消，并停止后续资源创建；入口每100ms检查空闲期的归属。管理目录应保持原位；整体移走时原实例停止，无法精确定位的旧目录锁保留，不能自动采用同名新目录或猜测旧目录的新位置。

## 命令

```sh
codex-mobile remote status
codex-mobile remote url --plain
codex-mobile remote help
```

`status` 查询当前活动身份和状态。`url` 导出运行实例实际监听端口及现有网关 token 组成的连接 URL；默认同时显示二维码，`--plain` 仅输出 URL。URL 格式和手机现有输入方式保持一致，不包含 OpenAI 凭据或授权链接。

```sh
codex-mobile remote login
codex-mobile remote authorize
codex-mobile remote targets
codex-mobile remote pair-local
```

`login` 发起 canonical 的普通 ChatGPT 登录；`authorize` 只用于尚无活动 Remote 身份的首次授权，登记网关自己的设备身份并完成本机配对和双 ID 证明。两者各自可能打开浏览器。`targets` 刷新当前 controller 可见的目录，`pair-local` 显式核验并配对 canonical 证明的本机。

其他机器必须使用真实目录或配对流程提供的完整 `environmentId + installationId`。下列 `ENV_ID`、`INSTALLATION_ID` 和 `PAIR_CODE` 均须替换为对应实际值；名称和 IP 不作为身份依据。

```sh
codex-mobile remote pair --code PAIR_CODE --environment-id ENV_ID --installation-id INSTALLATION_ID
codex-mobile remote accept --environment-id ENV_ID --installation-id INSTALLATION_ID
codex-mobile remote resume --environment-id ENV_ID --installation-id INSTALLATION_ID
```

`pair` 使用配对码核验指定完整目标；`accept` 显式接受具有当前有效配对的完整目标；`resume` 仅在原完整身份和目标重新核验后解除该目标的持久暂停。多个身份变更命令竞争时返回“正在进行”，只读状态可以并行。

## 撤销与目标重装

```sh
codex-mobile remote recover
codex-mobile remote reauthorize
```

这两个命令使用同一显式恢复流程。新登记在独立私有候选记录中准备，原账号、工作区、用户及 canonical codexHome 必须保持一致；停止旧主连接后核验新登记与本机配对，再原子切换活动指针。旧记录保留，原目标暂停不会自动清除。取消或失败不自动重试；提交结果待确认时先查询 `status`。

目标重装需要显式确认旧、新完整身份：

```sh
codex-mobile remote reassociate --previous-environment-id OLD_ENV_ID --previous-installation-id OLD_INSTALLATION_ID --next-environment-id NEW_ENV_ID --next-installation-id NEW_INSTALLATION_ID
```

需要重新配对时附加 `--code PAIR_CODE`。重新关联仅确认后续访问的新目标；旧操作保持原身份，不按机器名称、IP 或记录时间迁移。活动身份在进程中断后只从已提交指针恢复。

关闭 CLI、按下 Ctrl-C 或操作超时会取消尚未提交的管理操作；已经开始的原子提交可能需要查询结果。网关退出先关闭管理入口和 Remote 资源，等待实际存储、当前及旧 Relay/canonical 连接收尾后再释放进程归属。入口最多等待5秒，未完成则退出并保留锁，由后续实例证明原PID已死后恢复；不因普通 `close()` 已返回而提前释放。

清理只删除经原子捕获后再次核验为本实例所有的条目。发现替换物时保留在指定私有目录的 `.cleanup-*` 中并拒绝继续清理，不恢复到可能已变化的父目录；正常退出不会留下这些隔离条目。

## 验证边界

候选源码 `700c7c7d96c5fc7cadf58913d5f855d1c731ed5a` 的31文件相关回归已有717项通过、7项按配置跳过，源码及含测试的两种严格服务端类型检查、服务端构建通过。先前质量审查复现的root整体替换归属断链已补充同一证明、失效取消和实际收尾回归；规格复审另确认的5处最终期限缺口已逐项红绿修复。QUALITY后续确认的六处过期资源创建边界也已统一保留原父操作及短阶段预算，原独立脚本均触发延迟后验证连接、原生请求或helper创建为零；成功交付后的Relay挑战、零流保活与重连继续通过。最终固定源码的独立规格与质量复审均已通过，见[隔离验收记录](superpowers/plans/evidence/2026-11-13-remote-admin-isolated-validation.json)。同一冻结源码的[官方Remote实际OS入口探针](superpowers/plans/evidence/2026-11-13-remote-admin-product-probe.json)已通过：三次进程各完成只读RPC及CLI状态/真实端口核验，正常退出后重启和SIGKILL后恢复成功，健康owner下第二个进程在Runtime启动前被拒绝。关闭逻辑流25秒后新增RPC成功，认证准备次数保持1。三次启动至RPC和CLI就绪分别为11789、14244、10065ms；这些是完整保留的单次冷启动样本，不能作为P95或8小时验收。

真实 OAuth、授权撤销与重新登记未在现役服务上执行；当前没有发布客户端、部署生产网关或操作 launchd。正式 Remote 已有只读 RPC、同流恢复、零流短时保活与持久暂停的隔离收据；手机接入、P95、跨刷新和连续8小时验收仍待后续任务。
