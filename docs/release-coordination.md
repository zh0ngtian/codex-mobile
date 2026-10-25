# Codex Mobile 发布协调器接入

本项目的协调与交付约束维护在 [仓库 AGENTS.md](../AGENTS.md)。本页说明项目配置、执行入口、不可变失败与关联修复、验证和必要例外；协调器上游合同见 [README](https://github.com/zh0ngtian/release-coordinator/blob/main/README.md) 和 [USAGE](https://github.com/zh0ngtian/release-coordinator/blob/main/USAGE.md)。

## 启用条件与默认源码交付

自 2026-10-20 起，普通任务默认只交付源码：开始修改时记录 main 提交，完成本次范围的验证后合入 main，完成提交并推送。合入前核对最新 main（含远端）；修改期间 main 有新提交时，对整合结果运行相关回归，通过后再提交推送；没有新提交时复用已有验证，不必重复回归。普通源码整合继续遵守共享 main 写入互斥。

只有用户明确要求发布客户端或部署网关时，才登记对应发布任务并使用下文的 heartbeat、ready、冻结、构建发布及 receipt 流程。普通任务不登记发布任务、不提交 ready、不分配发布版本、不更新 `.release-batch.json`，不触发正式 APK/IPA 打包、渠道更新或生产网关部署；必要的开发验证构建仍按改动范围执行。客户端与网关均有源码变更本身不构成联合发布授权。

2026-10-25 用户确认今后停止本机iOS签名、HTTPS OTA及固定LAN IPA更新。现行客户端项目为 `codex-mobile-github-release`，`options.kind=mobile-unsigned`，只交付GitHub APK／unsigned IPA、固定APK及既有unsigned软件源。仓库策略为 [distribution-policy.json](../release/distribution-policy.json)；该策略所在源码拒绝旧mobile／mobile-ota配置，不能因沿用旧模板启动签名／OTA。历史无策略冻结工作区保留原合同，旧包、材料、失败批次和凭证不删除、不改写。当前为本地实现及回归验证阶段，新范围与配套网关的真实批次仍待验收。

## 本机部署与作用域

2026-10-13 已只读确认现有 `releasectl 0.1.3` 健康并复用，不另装服务或数据库。CLI 为 `~/.local/bin/releasectl`；状态库在 `~/Library/Application Support/ReleaseCoordinator/state.sqlite3`，runtime 由上游安装器复制为不可变目录，launchd 不指向开发 worktree。

| 项目配置 ID | 仓库/正式分支 | 目标与环境 | 必要交付 |
| --- | --- | --- | --- |
| `codex-mobile-github-release` | `zh0ngtian/codex-mobile` / `main` | `codex-mobile-github-release` / `github-release` | GitHub APK／unsigned IPA Release、固定 LAN APK、既有软件源 unsigned 版本核对 |
| `codex-mobile-gateway-production` | 相同仓库 / `main` | `codex-mobile-gateway` / `production` | 服务端构建、原本机安装位置及 launchd 网关部署验收；不构建客户端 |
| `codex-mobile-lan-production`（历史） | 相同仓库 / `main` | `vip.loock.codexmobile` / `lan-production` | 原GitHub双端、固定双端、签名／OTA合同；新源码禁止使用 |
| `codex-mobile-ios-ota-production`（历史） | 相同仓库 / `main` | `vip.loock.codexmobile` / `ota-production` | 原独立OTA合同；新源码禁止使用 |

客户端、网关及历史目标均会推进同一正式 main，因此显式共用可写目标锁 `codex-mobile-main-production`。不因为共用发布主机而锁住其他仓库；其他项目沿用自己的作用域。多机器必须 SSH 到本发布主机运行同一 CLI，并把固定 SHA 推送共享 Git 远端、把验证文件传到发布主机；不另装数据库，不将 SQLite 放网络盘。旧客户端项目留有历史失败合同时不得改数据库或覆盖其配置，以新项目登记现行范围。

现有服务为 **LaunchAgent 用户登录启动**：`gui/501/local.release-coordinator`、`~/Library/LaunchAgents/local.release-coordinator.plist`，已核对 running PID 与 installation.json。当前没有系统 LaunchDaemon，不能称为登录前系统开机启动。若用户需要切换为系统启动，在系统终端从 `/Users/zhongtian/WorkSpace/release-coordinator` 执行 `sudo /opt/homebrew/opt/python@3.11/bin/python3.11 install.py --system --user zhongtian --python /opt/homebrew/opt/python@3.11/bin/python3.11`；管理员认证由用户完成，仍复用同一状态库。之后须核对安装凭证和 `launchctl print system/local.release-coordinator`，签名钥匙串与 GitHub 认证可在登录前尚不可用。

## 项目配置与适配器

项目配置路径与用途：

- `~/Library/Application Support/ReleaseCoordinator/projects/codex-mobile-github-release.json`：2026-10-25已登记现行客户端配置；任务已登记，真实批次仍待验收，登记不代表已发布。
- `~/Library/Application Support/ReleaseCoordinator/projects/codex-mobile-gateway-production.json`。
- `~/Library/Application Support/ReleaseCoordinator/projects/codex-mobile-lan-production.json` 与 `codex-mobile-ios-ota-production.json`：仅保留历史合同。

可移植模板位于 [现行客户端配置](../release/coordinator.unsigned.example.json)及 [网关配置](../release/coordinator.gateway.example.json)。[旧双端配置](../release/coordinator.mobile.example.json)与[旧独立OTA配置](../release/coordinator.ios-ota.example.json)保持历史原样，不用于新源码。现行客户端模板不含 `ios_config`，项目、target、environment、main分支、共享锁及五阶段顺序必须精确匹配；check／execute／run均拒绝额外阶段。模板中的路径替换为本项目长期工作区和已有私有配置；服务已存在时只注册项目，不能再运行安装器或另开 serve。

适配器命令为 `python3 {workspace}/scripts/codex_mobile_release_adapter.py`，接收上游 `run/check <阶段> --context <文件>` 协议。共享持久状态实现为 `scripts/release_coordination/state.py`；网关阶段为 `scripts/release_coordination/gateway.py`。本机使用现有 Python 3.11、Node.js、Git、gh、curl、Xcode 和原发布工具，不增加运行时依赖。

已冻结阶段的只读网络核对若在有限重试后仍遇到 EOF、不完整 JSON、连接/DNS/超时、HTTP 408/429/5xx，适配器抛出 `TransientReadError`，由 `check` / `run` 入口以退出码 0 输出唯一一行 JSON：

```json
{"done":false,"retryable":{"kind":"transient-read","reason":"脱敏后的非空原因"}}
```

该响应只能含上述字段，不能同时包含 `result`；它表示需要继续只读核对，不是阶段完成或写操作可盲目重做。支持此协议的协调器可在同一冻结批次中等待后再核对，保留原版本、SHA、CI run/attempt 和已验收平台产物；已完整下载的一端不重复下载，候选来源、大小与 SHA-256 校验仍执行。下载意图记录 `downloading` / `interrupted` / `downloaded`；来源回执已校验、下载响应尚未确认且仅 payload 截断的候选只重下该端，原半包保留诊断。已成功退出下载或已验收 partial 的回执/文件缺失、大小/散列错误均永久失败，不能用重下掩盖来源或完整性不匹配。GitHub GET 保留四次有界重试；HTTP GET/HEAD、完整只读下载、`gh run download`、`git ls-remote/fetch` 的真实网络故障采用相同异常边界；只读 `command` 入口有 180 秒子进程超时，GitHub GET 单次超时仍为 45 秒，HTTP curl 请求仍有 120 秒上限，写命令保持原执行语义。

GitHub 403 只有明确包含 `API rate limit exceeded` 或 `secondary rate limit` 时按限流进入等待；403 也可能来自限流，参见 [GitHub 官方 REST 限流说明](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)。适配器将最早再次读取时间 `githubReadNotBefore` 持久化到 progress，至少等待 60 秒；响应已有可解析 `Retry-After`（秒或 HTTP 日期）或 `x-ratelimit-reset` 时取更晚时间。等待窗口内直接返回只读暂时故障，不实际重发 GET，进程重启也保留窗口。

`prepare` 查询失败仍非零并停止冻结，不使用此协议。HTTP 401、普通 403 权限错误（即使同时含 EOF）、证书无效、curl 23 本地写入失败、配置错误、真实 CI 失败、来源/大小/散列不匹配均为永久错误。POST、渠道发布、签名和 main push 不因错误文本含“网络”就成为可重执行操作；响应丢失继续按各阶段原有证据对账，无法确认时保留失败现场。

正式 CI 首次等待时将 epoch 秒 `waitStartedAt` 与 `waitDeadlineAt`（起点加一小时）写入 progress 的 `operations.build`，进程或服务重启不重新计时。预算过期后仍先查询同一 run/attempt：已完成且成功可继续验收，确认仍运行才报告等待超时；真实完成失败依旧失败。适配器协议的本地实现及隔离回归不等同于现役服务已更新，实际安装与批次状态仍以对应验收凭证为准。

正式 CI 尚未记录 run 时通过冻结 SHA 的工作流列表发现唯一运行；已有 run 后，身份与状态由该 run 的独立详情接口核对，列表短暂遗漏或状态滞后不等于运行丢失。列表仍检查重复正式 CI；详情中的 run ID、冻结 SHA、工作流路径、attempt 改变或真实404继续永久失败，不借用其他运行或重跑产物。详情读取的暂时网络故障沿用原只读等待协议，不改变冻结身份和等待预算。

### 2026-10-19 只读恢复实际启用

原协调器服务已升级为0.1.7，审查源码`99c518e`，不可变runtime逐字节核对通过；项目适配器审查源码`d4b31c1`已合入main。核心59项、项目203项回归及核心四组平台/Python CI通过，规格/质量复审通过。对最终适配器与已安装runtime的真实HTTP断连、服务进程重启联合验收确认：原批次、版本、冻结SHA和CI run不变，prepare与构建次数均为1。原72批次、81任务和6项目配置核对未变。

此验收只使用临时状态及模拟产物，本轮没有新的App发布或网关部署；固定APK/IPA仍为0.3.11。[完整记录](plans/2026-10-19-release-query-recovery.md)含实际源码和证据位置。已失败的历史批次依旧不可resume；本机制用于已冻结且尚未失败的批次，不回写旧失败记录。

客户端每批发布前更新受控的 `release/notes.md`，只列本版本实际用户变化。GitHub Release和固定APK共用冻结工作区的日志读取器；显式manifest日志优先，当前canonical manifest缺少此字段时读取该文件，缺失、空白或与HEAD不一致均失败。软件源沿用该GitHub Release中文日志，不用批次ID、签名或分发模板代替。

现行客户端options仅引用既有LAN发布器和软件源私有credentials，不读取 `CodexMobile/ios-release.local.json`、证书、profile或HTTPS OTA；网关目录／label合同保持。凭据不复制、不进入Git／命令参数或共同凭证。维护软件源仍遵循 [现役上游说明](https://github.com/zh0ngtian/SignOs/blob/main/distribution/source-aggregator/README.md)，只操作本仓库既有unsigned订阅，使用真实App Bundle ID `vip.loock.codexmobile` 匹配原订阅，而不是新发布项目的target；保留完整署名和展示信息，不维护另一个签名包订阅。

## 历史独立 OTA 目标与来源（停止新批次操作）

以下仅记录旧合同，不能作为新任务操作流程。历史OTA-only使用同一releasectl的独立项目，`options.kind=mobile-ota`，阶段为 `main → iosbuild → sign → ota → ipa → verify`；历史无策略冻结工作区仍按原身份、版本、来源、签名和渠道证据恢复及回归。带有unsigned-only策略的新源码初始化即拒绝此配置。

原版本分配高于GitHub标签、固定APK/IPA、HTTPS OTA、仓库下限及版本预留；原成功receipt的 `distribution=ota-only`，`ota-release.json` 明确记录未发布的GitHub/APK/软件源渠道。这些历史字段不变成新范围的必要步骤。

0.2.179、0.2.180 是接入独立目标之前的已验证单独 OTA，不补造历史批次。`release/standalone-ota-history.json` 索引其原始公开凭证；新 OTA 批次从冻结 Git 提交读取这些凭证，检查其真实 sourceCommit 是本批祖先，并把原版本、散列、凭证路径和源码包含结果写入 `priorStandaloneDeliveries`。此记录证明源码已集成，不代表旧包由新批次构建，也不替代旧包原验签结果。

### 独立 OTA 实际启用状态

2026-10-16 已登记新项目并完成本地实现与门禁验证，代码提交 `8992a47` 位于 `codex/native-preview-alignment-20261016`。用户随后取消本轮发布，任务 `native-rules-ota-20261016` 已 withdrawn，未 ready、无批次、未推进 main，也未发布安装包。新目标的首次真实批次验收及旧 OTA 源码整合仍待后续发起；使用前须纳入上述实现提交，不能把配置登记或本地测试当成已上线。

## 验证、冻结与各阶段

已获授权的发布或部署任务，ready 必需本地检查名为 `adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck`；均需真实 passed 记录及可定位的命令/结果证据。协调器 prepare 在整合 worktree 再执行锁定依赖安装、typecheck、原 `tests/ci` 契约测试和现有/新增 Python 发布回归。普通源码任务按上文默认流程验证、整合并提交推送，不调用 ready；文档/规则改动仅检查相关文字、链接与规则一致性。

客户端版本仍为 `major.minor.patch`，构建号为 `major * 1000000 + minor * 1000 + patch`，minor/patch小于1000，构建号正数且不超过2100000000。prepare分页读取GitHub全部Release标签、仓库下限、固定LAN APK／历史IPA及保留的失败版本预留，原子保留一次更高版本；重试不再分配。现行prepare不读取签名配置、证书或HTTPS OTA，也不执行signing_preflight。网关批次不递增App版本。

prepare在整合结果门禁通过后提交与上游字节一致的公共 `.release-batch.json`，采用本项目中文Conventional Commit；协调器冻结该清单引入提交的SHA。清单不自引用自身SHA、不包含私有路径或验证日志。签名身份的历史检查仅保留在旧工作区路径。

| 阶段 | 实际核对与缺失步骤 |
| --- | --- |
| `main` | 非强制推送冻结 SHA；核对正式远端分支已包含它 |
| `build` | 按冻结 SHA 查询唯一正式 CI，记录 run/attempt；只下载本 run 缺失的平台，校验批次、任务、版本、真实来源、大小与散列；核对 Release tag 和附件 |
| `apk` | 原publish-channel固定APK渠道；不覆盖同版本不同包或更高版本；固定JSON、HEAD、完整GET校验 |
| `source` | 本仓库 unsigned IPA 的版本/构建号、GitHub URL、大小、散列及当前 gh 用户署名；核对真实同步 job，保留原开发者与展示信息；公开记录缺失散列时，经版本/URL/大小核对后调用现役 `/attest` CAS 写入该产物散列并回验，响应丢失先对账 |
| `gateway` | 仅 `npm run build:server`；更新原已安装包的 server/bin，保留已部署 dist、依赖、start.py 与环境；核对文件摘要、实际 launchd PID/命令、监听端口和认证状态接口；健康探测使用既有 `HOST`，通配地址转回环、IPv6 加方括号、本机请求绕过代理；响应丢失不重复重启 |
| `verify` | 等待同冻结SHA必要开发CI；现行客户端再次核对main/build/apk/source，独立完整下载GitHub APK／unsigned IPA，保存 `unsigned-release.json` 和 `distribution=unsigned-only` 成功证据，明确signed IPA／OTA／固定IPA均未发布；网关核对main/gateway |

正式CI只在main冻结清单变化时触发，使用稳定作用域、`cancel-in-progress: false`、`queue: max`；gateway清单跳过客户端build/release，历史OTA清单保留原跳过行为。现行客户端额外阶段 `iosbuild/sign/ota/ipa/gateway` 及未知阶段全部拒绝。手动dispatch需匹配已有batch／版本／最终SHA，不得用它另发独立版本或重复触发同批；重复正式run会被适配器拒绝并保留诊断。开发／PR检查使用另一并发组，仅执行原有必要检查，不发包。recipe、容器SHA、工具版本、Android签名及iOS unsigned策略保留。

网关依赖声明若与已安装包不同，当前阶段阻止部署，需先完成该依赖变更所需验证和关联修复；不能假装旧依赖满足新代码。仅修改协调器接入不自动要求客户端发布或网关部署；2026-10-13 的真实双端发布与网关验收是当次用户授权，不能作为后续任务的默认授权。

## 常用命令与完成核对

仅在用户明确要求对应发布或部署后，在发布主机执行（任务 ID 与验证文件换为自己的实际值）：

```bash
~/.local/bin/releasectl health
~/.local/bin/releasectl register --project codex-mobile-github-release --task MY_TASK
~/.local/bin/releasectl heartbeat --task MY_TASK
~/.local/bin/releasectl heartbeat --task MY_TASK --state closing
# 独立分支本地验证并 push 确定提交后：
~/.local/bin/releasectl ready --task MY_TASK --sha FULL_40_CHARACTER_SHA --validation /private/path/validation.json
~/.local/bin/releasectl wait --task MY_TASK --timeout 45
~/.local/bin/releasectl status --task MY_TASK
~/.local/bin/releasectl batch --id BATCH_ID
```

网关部署任务使用 `codex-mobile-gateway-production`，不复用客户端队列ID。已获授权的发布同时覆盖客户端和网关运行行为时，分别在两个项目ID登记目标任务，ready使用同一已推送SHA；该发布须核对两个目标的成功receipt才可交付。中断且未失败的批次等待lease到期后由服务接管；failed不使用resume，也不改冻结现场。旧签名／OTA项目不接受新范围任务；修复任务只绑定同目标最新失败叶节点：

```bash
~/.local/bin/releasectl register --project codex-mobile-github-release --task MY_REPAIR --repairs-batch FAILED_LEAF_ID
# 验证并 push 修复 SHA 后，再以同样 required checks 调用 ready
```

status 返回原任务 `complete`，或 `recovered` 且 `recovered_by` 指向成功子批次时，读取该 batch 的同一 `data.receipt`，逐项核对最终 SHA、任务包含证据和所有必要渠道/部署成功。排队、冻结、恢复请求或某个渠道先成功都不代表交付。原 failed 批次和错误、子批次谱系、历史包均保留。

持久凭证在 `ReleaseCoordinator/receipts/<batch>.json`；本项目产物在 `ReleaseCoordinator/artifacts/codex-mobile/<batch>/`，现行客户端包含版本预留、CI两端包、各阶段证据、独立GitHub下载及 `unsigned-release.json`，不生成 `ota-release.json`、本机签名包或固定IPA。交付回复提供本次GitHub Release、固定APK、GitHub unsigned IPA和软件源链接，两端大小与SHA-256，并明确IPA未签名；不要求旧OTA安装页。14天Actions artifacts不替代长期记录。历史设备构建、签名包、`ota-release.json` 及 `.mobile-build/ota-release/<version>/` 保留原位，不覆盖为unsigned IPA。

## 历史实际验收边界

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

## 桌面共享服务计量的可选安装

网关任务的私有项目配置可显式提供 `options.gateway_desktop_meter`：`adapterPath`、`originalSha256`、`nodeExecutable`、`codexExecutable`、`socketPath`、`upstreamUrl`。仅用于用户已确认的桌面计量接入；必须与既有网关external模式和完整上游URL一致，不允许隐式切换模式。协调器构建服务端后核对并备份原桌面适配器，在原位置原子安装启动层；恢复按原件、启动层及模块散列验收，未知漂移拒绝覆盖。原始备份位于同一私有目录并保留原名字加 `.pre-model-upload`，不上传私有配置或材料。

此安装不重启桌面App，也不更改全局Codex配置、现有网关环境或桌面控制桥接。成功网关receipt的 `desktopMeter.activation=requires-user-desktop-restart` 只证明安装和网关部署成功；必须另等用户手动重启，再核对同一桌面共享服务和实测计量，才能把计量标为生产生效。本轮首次接入的网关部署及入口安装已由成功批次 `ddc37232-fba9-4cd0-8dfa-88031bb4ae08` 完成，独立文件与健康回验通过，仍待用户手动重启后的激活验收，见[公共凭证](superpowers/plans/evidence/2026-10-25-model-upload-gateway-deploy.json)。

单次网关任务也可在私有 `validation.json.desktopModelMeter` 显式声明同一组安装参数，而不修改现役项目配置。适配器要求验证记录的 `scope=gateway-only` 且 `sourceCommit` 等于该任务固定SHA；多任务请求及项目显式参数必须完全一致，否则拒绝。现役协调器把完整验证记录冻结到批次context，各阶段读取同一输入；公共Git清单只保留既有checks白名单，不发布私有路径。该输入只授权已确认的桌面启动层安装，正式目标、环境和main共享锁不变。
