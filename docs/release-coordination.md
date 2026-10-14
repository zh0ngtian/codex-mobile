# Codex Mobile 发布协调器接入

通用合批策略及不可变失败/关联修复规则维护在当前 canonical 全局 `AGENTS.md`。本页只说明本项目的配置、入口、验证和必要例外；上游合同见 [README](https://github.com/zh0ngtian/release-coordinator/blob/main/README.md) 和 [USAGE](https://github.com/zh0ngtian/release-coordinator/blob/main/USAGE.md)。

## 本机部署与作用域

2026-10-13 已只读确认现有 `releasectl 0.1.3` 健康并复用，不另装服务或数据库。CLI 为 `~/.local/bin/releasectl`；状态库在 `~/Library/Application Support/ReleaseCoordinator/state.sqlite3`，runtime 由上游安装器复制为不可变目录，launchd 不指向开发 worktree。

| 项目配置 ID | 仓库/正式分支 | 目标与环境 | 必要交付 |
| --- | --- | --- | --- |
| `codex-mobile-lan-production` | `zh0ngtian/codex-mobile` / `main` | `vip.loock.codexmobile` / `lan-production` | GitHub 双端 Release、固定 LAN APK/已签名 IPA、HTTPS OTA、软件源 unsigned 版本核对 |
| `codex-mobile-gateway-production` | 相同仓库 / `main` | `codex-mobile-gateway` / `production` | 服务端构建、原本机安装位置及 launchd 网关部署验收；不构建客户端 |

两者分别登记任务，但均会推进同一正式 main，因此显式共用可写目标锁 `codex-mobile-main-production`。不因为共用发布主机或只读证书而锁住其他仓库；其他项目沿用自己的作用域。多机器必须 SSH 到本发布主机运行同一 CLI，并把固定 SHA 推送共享 Git 远端、把验证文件传到发布主机；不另装数据库，不将 SQLite 放网络盘。

现有服务为 **LaunchAgent 用户登录启动**：`gui/501/local.release-coordinator`、`~/Library/LaunchAgents/local.release-coordinator.plist`，已核对 running PID 与 installation.json。当前没有系统 LaunchDaemon，不能称为登录前系统开机启动。若用户需要切换为系统启动，在系统终端从 `/Users/zhongtian/WorkSpace/release-coordinator` 执行 `sudo /opt/homebrew/opt/python@3.11/bin/python3.11 install.py --system --user zhongtian --python /opt/homebrew/opt/python@3.11/bin/python3.11`；管理员认证由用户完成，仍复用同一状态库。之后须核对安装凭证和 `launchctl print system/local.release-coordinator`，签名钥匙串与 GitHub 认证可在登录前尚不可用。

## 项目配置与适配器

本机已注册配置：

- `~/Library/Application Support/ReleaseCoordinator/projects/codex-mobile-lan-production.json`。
- `~/Library/Application Support/ReleaseCoordinator/projects/codex-mobile-gateway-production.json`。

可移植模板位于 [客户端配置](../release/coordinator.mobile.example.json)及 [网关配置](../release/coordinator.gateway.example.json)。模板中的路径必须替换为本项目长期工作区和已有私有配置；服务已存在时只注册项目，不能再运行安装器或另开 serve。

适配器命令为 `python3 {workspace}/scripts/codex_mobile_release_adapter.py`，接收上游 `run/check <阶段> --context <文件>` 协议。共享持久状态实现为 `scripts/release_coordination/state.py`；网关阶段为 `scripts/release_coordination/gateway.py`。本机使用现有 Python 3.11、Node.js、Git、gh、curl、Xcode 和原发布工具，不增加运行时依赖。

客户端每批发布前更新受控的 `release/notes.md`，只列本版本实际用户变化。GitHub Release、LAN 和 OTA 共用冻结工作区的日志读取器；显式 manifest 日志优先，当前 canonical manifest 缺少此字段时读取该文件，缺失、空白或与 HEAD 不一致均失败。软件源沿用该 GitHub Release 日志，不用批次 ID 或分发模板代替。

私有 options 引用原 `CodexMobile/ios-release.local.json`、现有 LAN 发布器、现有网关目录/label；软件源管理仅引用该服务既有私有 credentials，凭据不复制、不进入 Git/命令参数或共同凭证。维护软件源仍遵循 [现役上游说明](https://github.com/zh0ngtian/SignOs/blob/main/distribution/source-aggregator/README.md)，只操作本仓库既有 unsigned 订阅，保留完整署名和展示信息，不维护另一个签名包订阅。

## 验证、冻结与各阶段

ready 必需本地检查名为 `adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck`；均需真实 passed 记录及可定位的命令/结果证据。协调器 prepare 在整合 worktree 再执行锁定依赖安装、typecheck、原 `tests/ci` 契约测试和现有/新增 Python 发布回归。无构建发布的文档/规则改动按仓库例外直接提交推送，不调用 ready 触发发包。

客户端版本仍为 `major.minor.patch`，构建号为 `major * 1000000 + minor * 1000 + patch`，minor/patch 小于 1000，构建号正数且不超过 2100000000。prepare 读取 GitHub 全部 Release 标签、仓库下限、LAN APK/IPA、HTTPS OTA 和保留的失败版本预留，原子保留一次更高版本；重试不再分配。网关批次不递增 App 版本。

prepare 检查原 profile、UDID、Bundle ID、Team、application-identifier、兼容基准与完整权限后，提交与上游字节一致的公共 `.release-batch.json`，采用本项目中文 Conventional Commit；协调器冻结该清单引入提交的 SHA。清单不自引用自身 SHA、不包含私有路径或验证日志。

| 阶段 | 实际核对与缺失步骤 |
| --- | --- |
| `main` | 非强制推送冻结 SHA；核对正式远端分支已包含它 |
| `build` | 按冻结 SHA 查询唯一正式 CI，记录 run/attempt；只下载本 run 缺失的平台，校验批次、任务、版本、真实来源、大小与散列；核对 Release tag 和附件 |
| `iosbuild` | 复用现有设备构建 helper，保留编译成功日志和 DerivedData；编译成功后恢复只完成归档，已完整 IPA 候选直接接纳 |
| `sign` | 原 Ad Hoc 签名/独立验签；核对完整 entitlements 散列，恢复接纳已成功签名的候选，不重复签名；成功散列不可被替换 |
| `ota` | 完整候选校验后原子安装本批暂存；复用既有不可变版本目录及 current 切换；HTTPS 清单、manifest、安装页、HEAD/完整 GET 核对 |
| `apk` / `ipa` | 原 publish-channel 渠道；只补缺失一端，不覆盖同版本不同包或更高版本；固定 JSON、HEAD、完整 GET 校验 |
| `source` | 本仓库 unsigned IPA 的版本/构建号、GitHub URL、大小、散列及当前 gh 用户署名；核对真实同步 job，保留原开发者与展示信息；公开记录缺失散列时，经版本/URL/大小核对后调用现役 `/attest` CAS 写入该产物散列并回验，响应丢失先对账 |
| `gateway` | 仅 `npm run build:server`；更新原已安装包的 server/bin，保留已部署 dist、依赖、start.py 与环境；核对文件摘要、实际 launchd PID/命令、监听端口和认证状态接口；健康探测使用既有 `HOST`，通配地址转回环、IPv6 加方括号、本机请求绕过代理；响应丢失不重复重启 |
| `verify` | 等待同冻结 SHA 必要开发 CI；再次核对全部对应阶段及任务祖先，生成共同成功凭证；客户端另外独立完整下载 GitHub APK/unsigned IPA |

正式 CI 只在 main 冻结清单变化时触发，使用稳定作用域、`cancel-in-progress: false`、`queue: max`；gateway 清单跳过客户端 build/release。手动 dispatch 需匹配已有 batch/版本/最终 SHA，不得用它另发独立版本或重复触发同批；重复正式 run 会被适配器拒绝并保留诊断。开发/PR检查使用另一并发组，仅执行原有必要检查，不发包。recipe、容器 SHA、工具版本、Android 签名及 iOS unsigned 策略保留。

网关依赖声明若与已安装包不同，当前阶段阻止部署，需先完成该依赖变更所需验证和关联修复；不能假装旧依赖满足新代码。不修改服务端运行代码的协调器接入仍需按本次用户授权分别完成真实客户端发布和网关适配验收。

## 常用命令与完成核对

在发布主机执行（任务 ID 与验证文件换为自己的实际值）：

```bash
~/.local/bin/releasectl health
~/.local/bin/releasectl register --project codex-mobile-lan-production --task MY_TASK
~/.local/bin/releasectl heartbeat --task MY_TASK
~/.local/bin/releasectl heartbeat --task MY_TASK --state closing
# 独立分支本地验证并 push 确定提交后：
~/.local/bin/releasectl ready --task MY_TASK --sha FULL_40_CHARACTER_SHA --validation /private/path/validation.json
~/.local/bin/releasectl wait --task MY_TASK --timeout 45
~/.local/bin/releasectl status --task MY_TASK
~/.local/bin/releasectl batch --id BATCH_ID
```

网关任务使用 `codex-mobile-gateway-production`，不复用客户端队列 ID。一次改动同时影响客户端和网关运行行为时，分别在两个项目 ID 登记目标任务，ready 使用同一已推送 SHA；该工作须核对两个目标的成功 receipt 才可交付。中断且未失败的批次等待 lease 到期后由服务接管；failed 不使用 resume，也不改冻结现场。修复任务只绑定最新失败叶节点：

```bash
~/.local/bin/releasectl register --project codex-mobile-lan-production --task MY_REPAIR --repairs-batch FAILED_LEAF_ID
# 验证并 push 修复 SHA 后，再以同样 required checks 调用 ready
```

status 返回原任务 `complete`，或 `recovered` 且 `recovered_by` 指向成功子批次时，读取该 batch 的同一 `data.receipt`，逐项核对最终 SHA、任务包含证据和所有必要渠道/部署成功。排队、冻结、恢复请求或某个渠道先成功都不代表交付。原 failed 批次和错误、子批次谱系、历史包均保留。

持久凭证在 `ReleaseCoordinator/receipts/<batch>.json`；本项目产物在 `ReleaseCoordinator/artifacts/codex-mobile/<batch>/`，包含版本预留、编译日志/设备 IPA、已签名 IPA、CI 两端包、各阶段证据及 `ota-release.json`。14 天 Actions artifacts 不替代这些长期记录。旧 `npm run ios:release` 独立工具的 `.mobile-build/ota-release/<version>/` 历史继续保留，不以云端 unsigned IPA 覆盖已签名渠道。

## 实际验收边界

2026-10-13 已完成真实发布与部署，摘要见 [验收记录](superpowers/plans/evidence/2026-10-13-release-coordinator-acceptance.json)。共同凭证长期保留在本机状态目录，记录 task SHA 包含证据、CI run、渠道、部署 ID 和修复谱系：

| 目标 | 成功批次 / 冻结 SHA | 实际验收 |
| --- | --- | --- |
| 客户端 | `ddfe5aa2-4a4b-49df-974f-ff8780af235e` / `798fba3b4d049f079d6c3cc4655dab7b430b89dd` | `0.2.167` / `2167`；正式双端 CI `38341442719`、必要开发 CI `38341442711` 成功；GitHub APK/unsigned IPA、固定 LAN 双端、已签名 HTTPS OTA、软件源 unsigned 订阅均完整回验 |
| 网关 | `1dc61420-cbd4-4175-ac9d-8fe84e61ccc9` / `08174d17063c9575764305c9ea1b37eb0908e7fd` | 原 launchd `com.minis.codex-mobile-gateway`、PID `45773`；实际监听 `192.168.123.79:18766`、认证状态接口、进程命令与冻结文件摘要一致；开发 CI `38343347111` 成功；清单 CI `38343347098` 成功且跳过客户端构建 |

客户端固定 [OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)、[APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)、[IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa) 的本次记录：

| 包 | 版本 / 大小（bytes） | SHA-256 |
| --- | --- | --- |
| APK | `0.2.167` / `4721095` | `c1bdb3ba242a397c2a1be36bd661a7e215caf7f264e2048724c81682c2a1e104` |
| IPA（Ad Hoc 已签名） | `0.2.167` / `3790213` | `7983aaa90a4bec01fdbbe99544df3b250e0d91c1ac789ecd32fc30304a7d07b3` |

签名保留 `vip.loock.codexmobile`、Team `SC456JW7RP`、原 application-identifier、完整权限与钥匙串组；软件源为同版本 GitHub unsigned IPA，散列 `c9ab9b62812fad29f612c316a082c91e88bc9ab9d7de27df3dd85ec286b91ec0`，当前 `zh0ngtian` 署名及展示信息保留。网关保留现有 start.py、gateway-env.json、Node 路径、依赖和前端 dist；前端散列 `82c243e7f812096f2be3270347cfab2c74ab4df0df44ec06f2db25f1a2ae821b` 与部署前一致。

真实失败链保持不可变：客户端 `818f16e6…`（设备构建路径空格）→ `b5bd33b7…`（只读远端请求中断）→ `aa55dea4…`（软件源公开散列缺失）→ 成功 `ddfe5aa2…`；网关 `9a93da69…`（探针地址与原 HOST 不符）→ 成功 `1dc61420…`。每次均显式 register --repairs-batch 最新叶节点，按规则创建子批次；没有取消已运行 CI、覆盖失败状态或借用其他提交的包。原任务已实际核对 `recovered_by` 指向对应成功子批次并读取同一 receipt。

本地 153 项 Python 发布/恢复回归、78 项构建契约、typecheck 和上游 19 项并发/窗口/冻结/租约/不可变关联修复检查通过。额外隔离验收实际终止负责人进程，验证租约未到期拒绝接管、到期后接管，发布只发生一次且凭证冻结 SHA 不变；真实 HTTP 替身验证响应丢失不重复发包、单渠道失败保留另一端成功。验证日志与 owner-interruption.json 在状态目录 `validations/codex-mobile-20261013/`。规范与质量独立审查通过。

当前仍是用户登录启动，未安装登录前系统 LaunchDaemon。构建验签/渠道可用不等于真机覆盖安装或数据保留；当前未进行该真机验收。额外全量 UI 探查发现 5 个旧图片/视频/边栏用例失败；相关客户端源码、UI 测试及依赖锁相对接入前未改动，不把这些用例宣称通过。
