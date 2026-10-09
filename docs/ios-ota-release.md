# iOS Ad Hoc 签名与 OTA 发布

## 已有基础设施与新增入口

继续使用 `.github/workflows/build-ios.yml` 固定提交的 PakePlus 容器、内置前端和原生补丁；`npm run ios:prepare` 复用相同步骤。Android 更新清单、APK 以及 iOS LAN IPA 固定地址保持原有渠道。

新增入口：

- `scripts/ios_sign.py`：校验并签名单 App IPA，再解包最终归档验签。支持内嵌 framework/dylib；拒绝 App Extension、多 App、XPC 和包含链接的归档。这些目标需要独立的 profile/entitlements，不能套用主 App 的证书配置。
- `scripts/ios_ota_server.py`：本机局域网 HTTPS 服务、私有 CA 首次信任配置和 launchd 托管，私钥与签名材料均位于仓库外。
- `scripts/ios_ota.py publish`：仅发布通过真实验签的 Ad Hoc IPA，生成版本化 manifest、JSON 和安装页，上传、回验后原子切换固定入口。
- `npm run ios:release -- --config <仓库外配置> --notes '<更新说明>'`：准备工程、设备构建、自动签名、HTTPS 发布并回验、LAN IPA 发布并回验。版本默认高于 Android、iOS LAN 及 HTTPS OTA 三个渠道；可用 `--version` 明确指定更高版本。

这里的“自动签名”指流水线自动执行手动管理的 Ad Hoc 证书签名，不要求买来的证书能登录 Xcode 开启 Automatically manage signing。不能用它上传到本项目的 App Store Connect 或 TestFlight。

## 覆盖升级与证书兼容

开始发布前检查当前安装 IPA 的签名，而不是只比较应用名称：

```bash
python3 scripts/ios_sign.py --verify-ipa /path/to/installed-version.ipa
```

旧 App 必须与新 App 使用相同 `CFBundleIdentifier`、`application-identifier`（包含 App ID prefix）、Team ID 和兼容的 keychain access group。正常覆盖安装保留 App 数据容器；卸载会删除容器。Team ID 与 App ID prefix 不一定相同，脚本分别从 profile 字段取值。

本项目原 Bundle ID 是 `vip.loock.codexmobile`。显式 App ID 的淘宝 profile 只授权指定 Bundle ID，不能把 `application-identifier` 随意改成本项目原 ID。如果已安装版本是全能签重签且使用其它 Bundle ID、Team 或 prefix，新证书不一定能够覆盖它。应取得授权旧标识的兼容 profile；如果选择新标识，它会成为独立 App，不能称作保留原数据的升级。脚本不自动猜测、切换 Bundle ID，HTTPS 渠道也拒绝身份变化。

首次 HTTPS 渠道尚无历史记录时，发布方必须用旧签名 IPA 核对身份。服务器没有设备上的安装记录，无法代替这一步。后续发布由渠道身份记录与 App 的实际签名配置双重校验。

Ad Hoc 只允许 profile 的 `ProvisionedDevices` 登记设备。脚本在构建前验证目标 UDID，安装时 iOS 再执行检查；增加设备必须由证书提供方重新生成 profile、重新签名。仅编辑 XML 不能增加授权。证书与 profile 均需有效，续期须保留兼容身份。

## 本机配置与凭据

上传的 P12/profile 应保存于 `~/Library/Application Support/CodexMobile/signing/`，目录权限 700，文件权限 600。不要存入仓库、`.env`、构建日志或公开服务器。仓库忽略规则只是第二道保护。

```bash
mkdir -p "$HOME/Library/Application Support/CodexMobile"
cp mobile/ios/release.example.json "$HOME/Library/Application Support/CodexMobile/ios-release.local.json"
chmod 600 "$HOME/Library/Application Support/CodexMobile/ios-release.local.json"
```

编辑配置中的 `bundleId`、目标 `udid`、证书路径。默认使用 `localRoot`、`caFile` 与固定局域网 `baseUrl`；远程服务器方式才使用 `sshHost` 和 `remoteRoot`，两种方式不能同时配置。相对证书路径以配置所在目录为基准；`baseUrl` 必须是有效 HTTPS 域名与路径，不接受账号密码、查询参数、片段和路径穿越。

推荐通过 macOS“钥匙串访问”创建通用密码项，服务名称 `codex-mobile-ios-p12`，密码填 P12 密码，配置 `passwordKeychainService` 为该服务名。也可使用 `passwordFile` 指向权限 600 的 UTF-8 文件；文件内容为密码，允许一个末尾换行；无密码 P12 使用空文件。不要同时设置两种密码来源，也不要在命令行或文档中填写密码。

签名导入一次性隔离 keychain；不会变更登录钥匙串、默认钥匙串及用户 search list。签名前验证 Apple 签署的 CMS/profile、证书授权与有效期，实际 codesign 验证私钥可用。仅请求默认 keychain group 等必要权限，不复制供应商 profile 里全部扩展权限；生成 DER entitlements 供现代 iOS 校验。临时 keychain、解包内容、密码文件的流水线副本在结束时清理。

源 P12 密码仅通过权限 600 的临时文件提供给 OpenSSL。为兼容 macOS，脚本在权限 700 的临时目录中将 P12 重新封装，中间私钥 PEM 始终加密，临时容器使用随机密码；不修改源证书。macOS `security import` 使用的临时随机密码可能短暂被同用户或管理员查看进程参数；脚本不回显参数或原始工具错误，结束后删除临时容器和钥匙串。建议使用专用构建用户/临时 CI runner。构建验签不等于联网证明证书未被 Apple 撤销，真机安装仍以系统验证结果为准。

先验证配置、profile 和版本：

```bash
npm run ios:release -- \
  --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" \
  --notes '新增 iOS 检查更新与 OTA 安装' --plan
```

正式构建与发布去掉 `--plan`。这个入口发布 iOS；仓库交付仍必须另外构建并发布相同版本 APK。不得在 Android 固定渠道还未同步时宣称双平台交付完成。

单独重签现有 IPA：

```bash
python3 scripts/ios_sign.py \
  --ipa /path/to/unsigned.ipa --output /path/to/new-adhoc.ipa \
  --profile /private/path/adhoc.mobileprovision --p12 /private/path/adhoc.p12 \
  --password-keychain-service codex-mobile-ios-p12 \
  --bundle-id vip.loock.codexmobile --udid TARGET-DEVICE-UDID
```

上述原 Bundle ID 需要获得授权它的 profile。输出路径必须不存在；成功生成 IPA 和 `.signing.json`。JSON 只包含公开签名身份、版本和有效期，不包含 UDID 列表、P12 或密码。已签名 IPA 本身必须包含 profile，下载 IPA 的人能够读到其设备列表；不能通过隐藏 JSON 彻底隐藏 IPA 内的 UDID。

## 本机局域网部署（当前采用）

证书、密码、构建和发布均在本机；不需要向 GitHub 上传签名 Secrets。现有 HTTP 固定 APK/IPA 渠道继续用于文件交付。iPhone 系统 OTA 使用独立 HTTPS 服务，不能直接以 HTTP `latest.ipa` 替代 manifest 安装。

```bash
python3 scripts/ios_ota_server.py init --host 192.168.123.79
python3 scripts/ios_ota_server.py install
python3 scripts/ios_ota_server.py status
```

状态目录默认为 `~/Library/Application Support/CodexMobile/ota-server/`。初始化生成本机 CA、有效期 365 天的 TLS 服务证书及只包含公开根证书的 `.mobileconfig`。重复初始化保持原 CA；不要删除 CA 重建，否则设备须重新信任。TLS 私钥和签名 P12/profile 不能由 HTTP/HTTPS 下载。

固定地址：

- 首次根证书配置：`http://192.168.123.79:8767/codex-mobile-ca.mobileconfig`
- OTA 安装页：`https://192.168.123.79:8766/channels/codex-mobile/current/install.html`
- 更新 JSON：`https://192.168.123.79:8766/channels/codex-mobile/current/latest-ios.json`

iPhone 与 Mac 连接同一局域网。首次用 Safari 下载根证书配置，然后在“设置 → 通用 → VPN 与设备管理”安装 **Codex Mobile LAN CA**；再到“设置 → 通用 → 关于本机 → 证书信任设置”开启该根证书的完全信任。随后打开 HTTPS 安装页确认安装。仅安装配置而不启用完全信任不足以通过 SSL/TLS 校验。此步骤信任本机 HTTPS CA，不是信任企业 App 证书；Ad Hoc 仍单独检查 UDID 与应用签名。[Apple 官方说明](https://support.apple.com/en-us/102390)。

为保持入口稳定，将 Mac 的 `192.168.123.79` 在路由器设为 DHCP 保留地址。Mac 开机登录后 launchd 自动恢复服务；Mac 关机或离开局域网时安装入口不可用。若系统请求本地网络访问，允许 Safari/应用访问局域网。首次证书信任、系统安装确认以及真机覆盖后数据保留不能由模拟器代替验证。

本机发布配置使用模板中的 `localRoot` 与 `caFile`。发布入口设置进程内 `SSL_CERT_FILE` 以验证自己的 CA，始终执行 TLS 验证，不使用 `-k` 或关闭证书检查。先建立版本目录，HTTPS 完整回验通过后原子切换 `current`，最后验证固定入口；升级时无需重新安装 CA。TLS 证书到期前执行 `python3 scripts/ios_ota_server.py renew`，保持 CA、服务私钥与 IP 不变；已加载的 launchd 服务会自动重启使用新证书，设备无需重新信任。`init` 不覆盖现有证书。

本机默认发布命令仍为：

```bash
npm run ios:release -- \
  --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" \
  --notes '本次更新说明'
```

## HTTPS 服务器与固定安装入口

服务器需要 SSH、rsync、Python 3.9+，发布用户可写 `remoteRoot`；本地需要 macOS Python 3.9+、Xcode 与 rsync。SSH 主机必须已在 `known_hosts` 中验证，支持 `~/.ssh/config` 主机别名。发布脚本不自动信任未知主机指纹。

以 `baseUrl=https://updates.example.com/codex-mobile`、服务器目录 `/var/www/codex-mobile` 为例：

```text
/var/www/codex-mobile/
  releases/0.2.116/
    latest.ipa
    manifest.plist
    latest-ios.json
    install.html
  current -> releases/0.2.116
```

固定安装链接为 `https://updates.example.com/codex-mobile/current/install.html`，App 查询 `.../current/latest-ios.json`。页面内的 `itms-services://?action=download-manifest&url=...` 指向版本化 HTTPS manifest；manifest 又指向同版本 IPA。这样安装时不会因固定 `latest.ipa` 被下一版覆盖而混用版本。

Nginx 已有 HTTPS 虚拟主机可新增以下静态目录配置；域名证书须由 iPhone 系统信任，TLS 证书应提供完整链：

```nginx
location /codex-mobile/ {
    alias /var/www/codex-mobile/;
    autoindex off;
    types {
        text/html html;
        application/json json;
        application/xml plist;
        application/octet-stream ipa;
    }
    default_type application/octet-stream;
    add_header Cache-Control "no-store" always;
    add_header Access-Control-Allow-Origin "*" always;
    limit_except GET HEAD { deny all; }
    location ~ /\. { deny all; }
}
```

确认服务器允许读取 `current` 符号链接，目录和文件对 Web 服务用户可读，隐藏暂存目录不可访问。需要已有站点的 TLS 配置、DNS 与防火墙；本文的 example.com 不是已部署地址。若自行调整缓存，固定 current 页面/JSON 禁止缓存，版本目录可长期缓存。

OTA JSON 与 manifest、IPA 必须允许 iOS 安装服务独立 GET/HEAD；不要依赖浏览器 Cookie、登录跳转或附加 Authorization header。所有安装资源必须使用 HTTPS，不允许降级 HTTP 重定向。LAN 的 `http://192.168.123.79:8765/channels/codex-mobile/latest.ipa` 继续作为下载交付地址，不能直接当 OTA manifest 资源。

```bash
python3 scripts/ios_ota.py publish \
  --ipa /path/to/new-adhoc.ipa \
  --base-url https://updates.example.com/codex-mobile \
  --host ota-server --remote-root /var/www/codex-mobile \
  --notes '本次更新说明'
```

上传先到隐藏暂存目录，再在远程锁内建立不可变版本目录。通过 HTTPS 检查新目录的 IPA HEAD、完整 GET SHA-256/大小、manifest、JSON、安装页后，再加锁原子切换 `current`，最后回验固定入口。出现失败不切换到尚未完成初次回验的版本；切换后的固定入口回验若失败，会报错，需检查网络/服务器，不自动删除历史版本。失败留存版本目录禁止覆盖，请修复原因并用更高版本重试。发布命令返回成功才算发布完成。

App 和直接安装页都要求用户确认系统安装提示；不能静默升级。安装开始后回主屏幕等待，再打开新版本。App 不伪造 iOS 安装进度或宣称系统已完成安装。

## 可选 GitHub Actions 自动化（当前不启用）

当前采用本机局域网发布，没有向 GitHub 保留签名凭据。下述仅供以后明确选择云端签名时配置；默认云工作流仍只生成未签名 IPA。现有主工作流支持将 Secrets 传给可复用 iOS 工作流。配置以下 Repository Variables：

| Variable | 含义 |
| --- | --- |
| `IOS_ADHOC_ENABLED=true` | 每次 IPA 构建后签名；缺少凭据时任务失败，不伪装已签名 |
| `IOS_BUNDLE_ID` | 与 profile 及旧安装兼容的 Bundle ID |
| `IOS_OTA_BASE_URL` | 固定 HTTPS 渠道前缀 |
| `IOS_OTA_ENABLED=true` | 签名成功后自动上传并回验 |
| `IOS_OTA_SSH_HOST` | 已知指纹的 user@host |
| `IOS_OTA_REMOTE_ROOT` | 服务器绝对目录 |

Secrets：`IOS_P12_BASE64`、`IOS_PROFILE_BASE64`、`IOS_P12_PASSWORD`、`IOS_TARGET_UDID`、`IOS_OTA_SSH_KEY`、`IOS_OTA_KNOWN_HOSTS`。P12 密码为空时允许空 Secret。私钥使用专用发布账户，known_hosts 通过独立可信渠道核对后配置；不在日志里生成或展示 Secrets。

开启签名后额外提供 `CodexMobile-ios-adhoc` artifact；原有 `CodexMobile-ios-unsigned` 与公共 GitHub Release 保留构建兼容性，公共 Release 中的 unsigned 文件不是 OTA 安装包。实际 OTA 使用验签后的 Ad Hoc artifact。默认未配置签名时仍输出明确标注未签名的 IPA；不会生成可安装的 OTA。启用 OTA 时，主工作流的版本解析同时读取公开 HTTPS 最新版本，独立 iOS 工作流也从该渠道与版本下限解析更高版本，防止本机先发布后 CI 反复构建旧版本。云 runner 无法连接 LAN 固定服务，LAN 双端交付仍从更新服务器所在 Mac 执行；仅发布 LAN 的任务须同步 `mobile-version-floor.json` 或在手动工作流显式传入高于双端 LAN 版本的版本号。

## iOS 27 验收与边界

截至本次调研，Apple 官方 Ad Hoc 文档仍要求授权 App ID、分发证书和已登记设备；官方 OTA 资料描述 HTTPS manifest 与 `itms-services`。未找到明确宣告 iOS 27 全面禁止 Ad Hoc OTA 的官方规则，也没有将企业证书“手动信任/重启”流程直接套用到 Ad Hoc 的依据。这不等于本项目已在 iOS 27 真机安装成功。

本流程在 App 中通过原生桥打开 Safari HTTPS 安装页；桥仅接受内置主页面、固定 HTTPS 安装 URL。普通外部网页和内置浏览器没有更新桥。模拟器只能验证界面和原生编译，不能验证 Ad Hoc/UDID 或系统 OTA 安装。

目标设备必须进行以下真实验证：先记录旧版设备配置和一条未发送草稿；从 Safari 固定链接确认安装；不卸载旧 App；检查新版本号、原配置与草稿；再次发布更高版本重复覆盖安装。记录设备 iOS 27 的具体 build、安装时间和结果。失败使用 macOS Console/Xcode 获取 `installd`、`appstored`、`itms-services` 日志，区分 TLS、manifest、UDID、签名身份不一致、过期/撤销、设备管理限制和网络问题。脚本的版本号/身份预检不能绕过系统策略。

官方参考：

- [Apple：创建 Ad Hoc profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile)
- [Apple：分发到登记设备](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices)
- [Apple：无线分发自有 App（企业文档，OTA 传输格式参考）](https://support.apple.com/guide/deployment/depce7cefc4d/web)
- [Apple：TN3125 Provisioning Profile 与代码签名](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)
- [Apple：TN2319 安装失败与升级 application-identifier 不匹配](https://developer.apple.com/library/archive/technotes/tn2319/)
- [Apple：QA1726 App ID prefix 变化导致钥匙串访问丢失](https://developer.apple.com/library/archive/qa/qa1726/_index.html)
