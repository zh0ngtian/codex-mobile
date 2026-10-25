# 仓库协作约定

- 使用中文回答问题和编写文档。
- 交互和功能改动必须同步更新 [交互与功能约定](docs/interaction-alignment.md) 的现行要求、验收要点和变更记录；覆盖旧要求时就地修订，明确待实现、待验收与已验证/已发布状态。
- 现役使用与架构见 [README](README.md)，运维和历史资料入口见 [文档索引](docs/README.md)；历史计划及验收记录不代表当前渠道版本。
- 部署任务必须使用 superpowers 的计划与 TDD 流程。

## 多任务协调、合批构建与发布

- 本项目的协调与交付约束以本文件为准；配置、适配器入口、失败恢复、验证要求及实际验收状态见 [发布协调说明](docs/release-coordination.md)。全局用户交互规则继续适用，不引用全局文件中不存在的发布章节。
- 默认只交付源码，不发布客户端或部署生产网关；只有用户明确要求发布或部署时，才启用下述协调流程。普通开发不登记发布任务、不提交 ready、不分配发布版本或更新冻结发布清单。
- 用户明确要求发布或部署的任务开始即在现有 `releasectl` 登记：客户端使用 `codex-mobile-github-release`，网关部署使用 `codex-mobile-gateway-production`。在独立 worktree 开发，持续 heartbeat，完成本地验证并推送固定 SHA 后提交 ready；发布提交整合、版本分配和 main 推进由协调器处理。配置及常用命令见发布协调说明。
- 已获授权的客户端批次覆盖 GitHub APK／unsigned IPA Release、固定 LAN APK 及既有软件源 unsigned IPA 版本核对。自 2026-10-25 起停止本机 iOS 签名、HTTPS OTA 和固定 LAN IPA 更新，现行策略见 `release/distribution-policy.json`。客户端 `mobile-unsigned` 阶段严格为 `main/build/apk/source/verify`；旧 `mobile`／`mobile-ota` 配置在带有该策略的新源码中必须拒绝启动。历史冻结工作区和旧凭证保留原合同，不能改写为新范围。服务端部署批次覆盖网关验证、服务端构建和部署；只改服务端不得触发客户端构建。
- 已获授权的发布同时覆盖客户端与网关运行行为时，分别登记两个目标任务并 ready 同一已推送 SHA；两份目标成功凭证均核对后，才完成该发布交付。仅合入源码的任务不触发这两个发布目标。
- 允许创建多个模拟器并行验证，不同任务使用独立模拟器；同一模拟器同一时间只由一个任务使用，复用同一实例时仍须排队。正式发布的版本分配、构建、渠道回验与部署均归协调入口，参与任务共用最终发布凭证。
- 统一入口复用发布主机已有 `~/.local/bin/releasectl` 与数据库；适配器为 `scripts/codex_mobile_release_adapter.py`。客户端、网关及历史目标因共同写本仓库正式 main，明确共用 `codex-mobile-main-production` 锁；普通源码整合也须遵守 main 写入互斥，不与正式批次并发推进 main。不与其他仓库共用锁，多机经同一发布主机 SSH，不各建数据库。不修改历史失败批次或旧项目合同以切换范围，使用新客户端项目。发布或部署实际完成以对应成功批次 receipt 为准。

## 测试与验证

- 界面与交互验收只需验证 iPhone 17 Pro、正常字号、竖屏下功能正常；不要求额外验证大字号、老设备、iPad 或横屏等场景。
- 测试会话验证完成后必须及时归档。

## 构建与交付

- 每次开始修改时记录 main 提交作为基线；完成本次范围的验证后合入主分支，完成提交并推送 main 即可交付，默认不发布。合入前核对最新 main（含远端）：修改期间 main 有新提交时，须对整合结果运行相关回归，通过后再提交推送；没有新提交时复用已有验证，不必重复回归。需要发布或部署的任务推送源码不等于交付完成，仍须等待授权批次验收成功。
- 验证仅针对本次改动范围，可执行必要的验证构建；默认不启动正式 APK/IPA 打包、签名、渠道更新或生产网关部署。改动不涉及客户端运行代码、客户端引用的共用模块、原生桥接或影响客户端产物的构建配置时，不得触发客户端 Web、Android APK 或 iOS IPA 的构建与发布；仅修改服务端、测试、文档、仓库规则或不影响客户端产物的脚本时，均遵循此规则。服务端修改须完成必要验证和服务端构建，只有用户明确要求部署时才部署网关。
- 用户明确要求客户端发布后，客户端运行代码（包括客户端引用的共用模块、原生桥接或影响客户端产物的构建配置）由协调入口整合、验证、冻结并推送成功，构建同版本 APK 和 unsigned IPA 并发布 GitHub Release；APK 同时更新固定局域网渠道，unsigned IPA 同步既有软件源。版本仍高于全部 GitHub Release 标签、固定 LAN APK／历史 IPA、`mobile-version-floor.json` 及保留的失败版本预留；不读取签名配置、证书或 HTTPS OTA 分配版本。
- 固定更新清单为 `http://192.168.123.79:8765/channels/codex-mobile/latest.json`，固定 APK 为 `http://192.168.123.79:8765/channels/codex-mobile/latest.apk`。
- 使用 `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <APK> --version <版本> --notes <说明>` 发布；发布后必须通过固定 JSON、HEAD、GET 核对版本、文件大小和 SHA-256。
- 涉及安装包发布的交付回复必须提供本次 GitHub Release、固定 APK、GitHub unsigned IPA 及软件源的可点击链接，注明统一版本、两端文件大小、SHA-256 和 IPA 未签名。回验必须独立完整下载 GitHub APK／unsigned IPA，并核对固定 APK 清单、HEAD、完整 GET 及软件源；成功证据必须标明 `distribution=unsigned-only` 并保存 `unsigned-release.json`。旧 OTA 安装页和固定 IPA 不作为本次交付，也不要求提供旧 OTA 链接。
- 历史固定 IPA `http://192.168.123.79:8765/channels/codex-mobile/latest.ipa`、历史清单 `http://192.168.123.79:8765/channels/codex-mobile/latest-ios.json` 和 HTTPS OTA 保留，不删除旧包、不覆盖为 unsigned IPA，也不声称其版本随本次更新。

<a id="ios-自动签名与局域网-ota"></a>

## iOS unsigned 分发与历史签名资料

- 签名证书、描述文件、密码及发布配置仅保存在本机仓库外私有目录，不上传 GitHub Secrets。签名材料目录权限 700、文件权限 600。
- 现行客户端发布不读取或使用本机签名配置；历史配置 `~/Library/Application Support/CodexMobile/ios-release.local.json`、证书、描述文件及兼容基准留在原私有位置，不删除或迁移。不得独立执行历史签名、OTA 或固定 IPA 发布入口。
- 历史已安装身份由用户提供的全能签 0.2.122 IPA 确认：Bundle ID 为 `vip.loock.codexmobile`，签名 application-identifier 为 `SC456JW7RP.app.jade6694.grapefruit3766`。历史配置中的 `compatibilityIpa` 与 `compatibilityIpaSha256` 固定真实已签名基准，基准与签名材料均位于仓库外私有目录；这些事实仅供旧包诊断与历史凭证核对，不要求新发布执行签名或权限检查。
- 旧流程首次修复误改标识时曾要求显式 `restoreInstalledIdentityFromBundleId` 加真实兼容基准，恢复记录绑定原渠道版本与IPA散列且Team、application-identifier不变，完成后移除一次性配置；旧流程的身份、权限与钥匙串连续性约束仅供历史冻结合同回溯。现行unsigned发布不启用该恢复，也不执行这些签名检查。
- `scripts/release-ios.py`、`scripts/ios_sign.py`、`scripts/ios_ota.py` 和旧 mobile／OTA 模板仅保留历史冻结批次兼容与回归，不是新批次操作流程。现行 `mobile-unsigned` 在 check、execute、run 三个入口均拒绝 `iosbuild/sign/ota/ipa/gateway` 等未授权阶段，不生成 `ota-release.json`，不写固定 IPA。
- 云端 unsigned IPA 是本次正式 iOS 交付，必须明确未签名，安装前由用户自行签名；不能覆盖历史已签名固定 IPA 或用作 OTA 包。
- [Cloudflare 软件源](https://signos-source-aggregator.305301890.workers.dev/sources/yao.json) 只保留并自动同步 `zh0ngtian/codex-mobile` GitHub Release 的 `CodexMobile-*-unsigned.ipa` 订阅，每次正式交付核对对应未签名版本。不得上传或新建 Ad Hoc 已签名包订阅。软件源维护读取并遵循 [SignOs 软件源文档](https://github.com/zh0ngtian/SignOs/blob/main/distribution/source-aggregator/README.md) 最新版；本项目适配器仅同步既有 unsigned 订阅、保留署名并完成版本核对；软件源本身的部署、配置、上传器与重试流程仍维护在上游，不在本仓复制。
- 后续向软件源更新版本时，更新日志必须使用中文，清楚说明本版本实际新增的功能、修复的问题和主要改进（按实际改动列出），不得仅填写版本号、提交 SHA 或“常规更新”等笼统描述。自动同步所用的 GitHub Release 更新日志也须遵循此要求；正式发布与补发均适用，交付前核对软件源实际展示的更新日志与本版本改动一致。
- 更新日志只写用户能感知的本版本变化，不追加双端统一版本、冻结提交、构建容器、IPA 未签名或需自行签名、附件清单、SHA-256 校验文件与构建回执等固定构建或分发模板说明。
- 发布 App 时，从当前 GitHub 登录账号读取用户名，以软件源该 App 当前的开发者署名为基准：已有该用户名则保持原值，缺少时追加；不得覆盖或删除先前开发者，除非用户明确要求。正式发布与补发使用同一规则，不能把发布者用户名硬编码为固定值。
- 历史OTA目录与 `local.codex-mobile.ios-ota` launchd 配置保留，不为新批次启动或重装，不删除旧包与材料。首次设备CA信任、升级身份连续性、证书续期及旧包诊断见 [历史 iOS OTA 文档](docs/ios-ota-release.md)。不把构建、渠道下载或模拟器UI验证当作真机覆盖安装与数据保留已验证。

## Git 提交规范

- 提交前必须阅读并遵守 [Git 提交规范](docs/commit-conventions.md)。
- 提交信息采用 Conventional Commits 类型前缀和中文描述。
- 提交正文必须准确说明本次新增的功能和完成的主要修改。
