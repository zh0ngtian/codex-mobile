# 仓库协作约定

- 使用中文回答问题和编写文档。
- 现役使用与架构见 [README](README.md)，运维和历史资料入口见 [文档索引](docs/README.md)；历史计划及验收记录不代表当前渠道版本。
- 部署任务必须使用 superpowers 的计划与 TDD 流程。

## 多任务协调、合批构建与发布

- 本项目的协调与交付约束以本文件为准；配置、适配器入口、失败恢复、验证要求及实际验收状态见 [发布协调说明](docs/release-coordination.md)。全局用户交互规则继续适用，不引用全局文件中不存在的发布章节。
- 本项目需要发布的任务开始即在现有 `releasectl` 登记：客户端用 `codex-mobile-lan-production`，网关用 `codex-mobile-gateway-production`。在独立 worktree 开发，持续 heartbeat，完成本地验证并推送固定 SHA 后提交 ready；提交、版本分配和 main 推进由协调器处理。配置及常用命令见发布协调说明。
- Codex Mobile 客户端批次统一覆盖 GitHub 双端 Release、固定 LAN APK/已签名 IPA、HTTPS OTA 及 unsigned IPA 软件源版本核对；服务端批次覆盖网关验证、服务端构建和部署。只改服务端不得触发客户端构建。
- 同一改动同时影响客户端与网关运行行为时，分别登记两个目标任务并 ready 同一已推送 SHA；两份目标成功凭证均核对后，才完成该工作的交付。
- 共用模拟器验证仍须排队，同一模拟器同一时间只由一个任务使用。正式发布的版本分配、构建、签名、渠道回验与部署均归协调入口，参与任务共用最终发布凭证。
- 统一入口复用发布主机已有 `~/.local/bin/releasectl` 与数据库；适配器为 `scripts/codex_mobile_release_adapter.py`。两项目队列因共同写本仓库正式 main，明确共用 `codex-mobile-main-production` 锁；不与其他仓库共用锁。多机经同一发布主机 SSH，不各建数据库。实际完成以对应成功批次 receipt 为准。

## 测试与验证

- 测试会话验证完成后必须及时归档。

## 构建与交付

- 每次完成仓库修改后，必须提交并推送本次变更；需要发布的任务推送就绪分支不等于交付完成，须等待所在批次验收成功。不涉及构建或发布的改动按现有规则直接完成。
- 改动不涉及客户端运行代码、客户端引用的共用模块、原生桥接或影响客户端产物的构建配置时，不得触发客户端 Web、Android APK 或 iOS IPA 的构建与发布；仅修改服务端、测试、文档、仓库规则或不影响客户端产物的脚本时，均遵循此规则。验证仅针对本次改动范围，服务端修改仍须完成必要验证、服务端构建和网关部署。
- 客户端运行代码（包括客户端引用的共用模块、原生桥接或影响客户端产物的构建配置）由协调入口整合、验证、冻结并推送成功后，必须按批次同时构建新 APK 和 IPA，使用统一版本号且高于 Android、iOS 两个固定渠道的现有版本，并发布到 Codex Mobile 固定局域网渠道；不得只上传 48 小时随机临时链接。
- 固定更新清单为 `http://192.168.123.79:8765/channels/codex-mobile/latest.json`，固定 APK 为 `http://192.168.123.79:8765/channels/codex-mobile/latest.apk`。
- 使用 `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <APK> --version <版本> --notes <说明>` 发布；发布后必须通过固定 JSON、HEAD、GET 核对版本、文件大小和 SHA-256。
- 涉及安装包发布的交付回复必须同时提供可点击的固定 OTA 安装页链接（`https://192.168.123.79:8766/channels/codex-mobile/current/install.html`）、固定 APK 和 IPA 下载链接，以及两个安装包各自的本次版本号、文件大小、SHA-256；IPA 还必须注明是否签名。OTA 安装页链接必须在交付回复正文中展示，不能仅保存在发布清单或部署文档中。
- iOS 安装包以后固定使用 `http://192.168.123.79:8765/channels/codex-mobile/latest.ipa`，不得只提供 48 小时随机临时链接；固定 iOS 清单为 `http://192.168.123.79:8765/channels/codex-mobile/latest-ios.json`，与 Android 的 `latest.json` 分开维护。
- 使用 `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <IPA> --version <版本> --notes <说明>` 发布 IPA。发布后通过 iOS 清单、固定 IPA 的 HEAD 和完整 GET 核对版本、文件大小和 SHA-256；交付时提供固定 IPA 链接、版本、文件大小、SHA-256，并注明是否签名，与 APK 对齐。固定渠道不参与 48 小时临时文件清理，后续版本覆盖同一地址。

## iOS 自动签名与局域网 OTA

- 签名证书、描述文件、密码及发布配置仅保存在本机仓库外私有目录，不上传 GitHub Secrets。签名材料目录权限 700、文件权限 600。
- 本机发布配置固定为 `~/Library/Application Support/CodexMobile/ios-release.local.json`，以配置中授权的 Bundle ID、UDID、Team 与 profile 为准，不擅自使用原项目 Bundle ID 重签。
- 当前已安装身份已由用户提供的全能签 0.2.122 IPA 确认：Bundle ID 为 `vip.loock.codexmobile`，签名 application-identifier 为 `SC456JW7RP.app.jade6694.grapefruit3766`，两者分别保留。配置中的 `compatibilityIpa` 与 `compatibilityIpaSha256` 固定真实已签名基准，精确保留其权限与钥匙串组；不能再因 profile App ID 字段将 Bundle ID 改成另一个应用。基准与签名材料均位于仓库外私有目录。
- 首次修复误改标识的固定渠道时，只允许显式 `restoreInstalledIdentityFromBundleId` 加真实兼容基准的身份恢复；恢复记录须绑定原渠道版本与 IPA 散列，Team 和 application-identifier 不变。恢复完成后移除此一次性配置，后续发布继续执行身份与钥匙串组连续性检查。
- 客户端正式发布由适配器分阶段复用 `scripts/release-ios.py` 的设备构建、`scripts/ios_sign.py` 的 Ad Hoc 签名及 `scripts/ios_ota.py` 的 OTA 操作，绑定同一冻结 SHA 与统一版本，再发布固定 LAN IPA；APK 使用同批 CI 产物。`npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes '<说明>' --plan` 保留只读预检；日常任务不得独立执行该组合入口正式发包。非客户端改动不得触发此流程。
- 云端 unsigned IPA 是构建产物，不能覆盖已签名的固定 IPA 或作为 OTA 发布包；本机签名/发布失败时先解决问题，不能用未签名包替代已签名交付。
- iOS 已签名 IPA 仅发布到 HTTPS OTA 与固定 LAN 渠道，完成回验并保存签名包与 `ota-release.json`；不得再将 Ad Hoc 已签名包上传、归档或创建订阅发布到软件源。[Cloudflare 软件源](https://signos-source-aggregator.305301890.workers.dev/sources/yao.json) 只保留并自动同步 `zh0ngtian/codex-mobile` GitHub Release 的 `CodexMobile-*-unsigned.ipa` 订阅，每次正式交付核对对应未签名版本。软件源维护读取并遵循 [SignOs 软件源文档](https://github.com/zh0ngtian/SignOs/blob/main/distribution/source-aggregator/README.md) 最新版；本项目适配器仅同步既有 unsigned 订阅、保留署名并完成版本核对；软件源本身的部署、配置、上传器与重试流程仍维护在上游，不在本仓复制。
- 后续向软件源更新版本时，更新日志必须使用中文，清楚说明本版本实际新增的功能、修复的问题和主要改进（按实际改动列出），不得仅填写版本号、提交 SHA 或“常规更新”等笼统描述。自动同步所用的 GitHub Release 更新日志也须遵循此要求；正式发布与补发均适用，交付前核对软件源实际展示的更新日志与本版本改动一致。
- 更新日志只写用户能感知的本版本变化，不追加双端统一版本、冻结提交、构建容器、IPA 未签名或需自行签名、附件清单、SHA-256 校验文件与构建回执等固定构建或分发模板说明。
- 发布 App 时，从当前 GitHub 登录账号读取用户名，以软件源该 App 当前的开发者署名为基准：已有该用户名则保持原值，缺少时追加；不得覆盖或删除先前开发者，除非用户明确要求。正式发布与补发使用同一规则，不能把发布者用户名硬编码为固定值。
- 固定 OTA 安装页为 `https://192.168.123.79:8766/channels/codex-mobile/current/install.html`；更新清单为相同前缀的 `current/latest-ios.json`。HTTP 8765 固定下载渠道继续保留。
- 局域网服务由 `local.codex-mobile.ios-ota` launchd 管理；必须从长期保留的主工作区执行 `scripts/ios_ota_server.py install`，不能绑定准备归档的 worktree。
- 首次设备 CA 信任、升级身份连续性、证书续期和真机验证详见 [iOS OTA 发布文档](docs/ios-ota-release.md)。不把构建验签或模拟器 UI 验证当作真机覆盖安装与数据保留已验证。

## Git 提交规范

- 提交前必须阅读并遵守 [Git 提交规范](docs/commit-conventions.md)。
- 提交信息采用 Conventional Commits 类型前缀和中文描述。
- 提交正文必须准确说明本次新增的功能和完成的主要修改。
