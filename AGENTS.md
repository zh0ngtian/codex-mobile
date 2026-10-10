# 仓库协作约定

- 使用中文回答问题和编写文档。
- 现役使用与架构见 [README](README.md)，运维和历史资料入口见 [文档索引](docs/README.md)；历史计划及验收记录不代表当前渠道版本。
- 部署任务必须使用 superpowers 的计划与 TDD 流程。

## 多任务协调

- 各任务在自己的 worktree 开发和构建。
- 共用模拟器时排队验证，同一模拟器同一时间只由一个任务使用。
- 固定渠道发布也排队，同一时间只由一个任务完成版本分配、双端发布和校验。

## 测试与验证

- 测试会话验证完成后必须及时归档。

## 构建与交付

- 每次完成仓库修改后，必须提交并推送本次代码变更。
- 没有修改客户端运行代码时，无需构建或发布 APK 和 IPA；仅修改服务端、脚本、测试、文档或仓库规则也适用。服务端修改仍须完成必要验证和网关部署。
- 修改客户端运行代码（包括客户端引用的共用模块、原生桥接或影响客户端产物的构建配置）并推送成功后，必须同时构建新 APK 和 IPA，使用统一版本号且高于 Android、iOS 两个固定渠道的现有版本，并发布到 Codex Mobile 固定局域网渠道；不得只上传 48 小时随机临时链接。
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
- 推送后使用 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <与APK统一的更高版本> --notes '<说明>'` 构建设备 IPA、自动 Ad Hoc 签名、验签、发布 HTTPS OTA 和固定 LAN IPA。APK 仍需构建并发布相同版本。
- 云端 unsigned IPA 是构建产物，不能覆盖已签名的固定 IPA 或作为 OTA 发布包；本机签名/发布失败时先解决问题，不能用未签名包替代已签名交付。
- iOS 正式发布须完成 HTTPS OTA、固定 LAN IPA 和 [Cloudflare 软件源](https://yao-app-source.305301890.workers.dev/source.json)。`npm run ios:release` 在 OTA/LAN 回验后保存 `ota-release.json`，再将同一已签名 IPA 发布到软件源，不重新签名。先注入仓库外 R2 S3 凭据；依赖与重试命令见 [iOS 发布文档](docs/ios-ota-release.md#cloudflare-软件源)。
- 软件源失败时使用 `npm run ios:publish-source -- --ipa <原正式IPA> --release-json <成功OTA凭证>` 重试，不为重试重新构建、签名或递增版本。软件源与 OTA 的版本、构建号、大小和 SHA-256 必须一致；保留其他应用和历史版本，按资源先上传回验、清单最后更新的顺序发布。软件源与 SignOs 共享发布窗口，跨机器也须排队。
- 固定 OTA 安装页为 `https://192.168.123.79:8766/channels/codex-mobile/current/install.html`；更新清单为相同前缀的 `current/latest-ios.json`。HTTP 8765 固定下载渠道继续保留。
- 局域网服务由 `local.codex-mobile.ios-ota` launchd 管理；必须从长期保留的主工作区执行 `scripts/ios_ota_server.py install`，不能绑定准备归档的 worktree。
- 首次设备 CA 信任、升级身份连续性、证书续期和真机验证详见 [iOS OTA 发布文档](docs/ios-ota-release.md)。不把构建验签或模拟器 UI 验证当作真机覆盖安装与数据保留已验证。

## Git 提交规范

- 提交前必须阅读并遵守 [Git 提交规范](docs/commit-conventions.md)。
- 提交信息采用 Conventional Commits 类型前缀和中文描述。
- 提交正文必须准确说明本次新增的功能和完成的主要修改。
