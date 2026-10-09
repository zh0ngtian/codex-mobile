# iOS Ad Hoc 签名与 OTA 发布实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 逐项执行，独立签名组件可按 superpowers:subagent-driven-development 委派；遵循 superpowers:test-driven-development。用户已经授权实现、提交、推送及固定渠道发布。

**Goal:** 复用 PakePlus 构建与固定局域网渠道，实现安全的 Ad Hoc 自动签名、HTTPS OTA 发布和 iOS 检查更新。

**Architecture:** 构建保持原有固定容器，签名作为独立后处理；从描述文件验证设备、证书、App ID prefix 与 Team ID，以明确配置的 Bundle ID 签名。HTTPS 渠道使用版本目录和原子 current 切换，将 IPA、manifest、JSON 与安装页面一起发布；App 从原生 Info.plist 获取固定 OTA 地址，复用 Android 的更新界面，通过原生桥打开 Safari 安装页。LAN 固定 APK/IPA 渠道继续保留。

**Tech Stack:** Python 标准库、macOS security/codesign、Xcode、React、TypeScript、Vitest、GitHub Actions、SSH/rsync。

## 1. 签名

- [x] 在 `tests/ci/test_ios_signing.py` 验证已过期 profile、未登记 UDID、非 Ad Hoc、Bundle ID 不匹配、App ID prefix 与 Team ID 不同的处理，以及仅生成必要 entitlements。
- [x] `python3 -m unittest discover -s tests/ci -p 'test_ios_signing.py'` 必须先失败，再添加 `scripts/ios_sign.py`。
- [x] CLI 输入 `--ipa --output --profile --p12 --password-file --bundle-id --udid`；密码仅通过文件/钥匙串读取。临时 keychain 不修改登录钥匙串，使用 finally 清理。校验 profile 证书 SHA-1、有效期和私钥存在，拒绝扩展等不支持的 bundle，签名后解包 codesign 校验。

## 2. HTTPS 发布

- [x] 在 `tests/ci/test_ios_ota.py` 验证 HTTP 被拒绝、manifest 实际 plist 结构、版本递增、签名身份连续性和安装页 URL 转义。
- [x] `python3 -m unittest discover -s tests/ci -p 'test_ios_ota.py'` 必须先失败，再实现 `scripts/ios_ota.py`。
- [x] 发布格式：`releases/<version>/latest.ipa`、`manifest.plist`、`latest-ios.json`、`install.html`；固定路径通过 `current` 链接。IPA 与 manifest 采用版本化 HTTPS 地址避免跨版本混用，JSON 带 `bundleId teamId applicationIdentifier signed installUrl manifestUrl`。
- [x] 上传使用 SSH 严格主机验证与 rsync，远程锁保护版本检查和原子链接切换；HEAD/完整 GET 验证 IPA 大小和 SHA-256，验证 manifest、JSON；不向公开文件复制 UDID、profile 或私钥。

## 3. 更新界面与原生桥

- [x] 在 `tests/ui/app-update-hook.test.tsx` 新增 iOS 桥测试：支持检查、拒绝错误签名身份、调用 Safari 安装入口、缓存与 Android 隔离。
- [x] `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/app-update-hook.test.tsx` 必须先失败。
- [x] 修改 `src/app-update/release.ts` 的解析器与 checker 接口以支持平台 parser 和 cache key；新增 iOS 解析器和桥；`useAppUpdate` 复用现有 UI，iOS 不显示伪下载进度。
- [x] 在 `.github/workflows/build-ios.yml` 注入受信任本地前端专用的 `appUpdate` 桥并验证 HTTPS 主机与路径，OTA 安装页通过 `UIApplication.shared.open` 交给 Safari。

## 4. 自动化与文档

- [x] 新增 `scripts/release-ios.py` 串联 prepare、xcodebuild、签名、HTTPS 上传与 LAN 发布；非敏感配置模板放 `mobile/ios/release.example.json`，真实配置与证书位于仓库外。
- [x] 补齐本地/CI 签名和发布入口，更新 README 与 `docs/ios-ota-release.md`；明确证书是显式 App ID，与原 Bundle ID 不兼容，保留数据需要已安装签名身份一致。
- [x] 调研 Apple 官方 OTA 与 Ad Hoc 规则，区分企业信任流程和 Ad Hoc；没有 iOS 27 真机实测时不得声称安装完成或数据已保留。

## 5. 验证与交付

- [x] 执行 Python 发布/签名测试、UI 更新测试、`tests/ci`、`npm run typecheck`、`git diff --check`。
- [ ] 阅读提交规范，提交并推送本次变更；重新读取双平台固定清单，选高于两者的统一版本。
- [ ] 推送后从本次源码构建 APK 与 IPA，具备密码和兼容 profile 后验证实际签名，具备 HTTPS 服务器后验证实际 OTA 发布。
- [ ] 分别调用 `apk-server.py publish-channel codex-mobile` 发布；对 JSON、HEAD 和完整 GET 验证版本、大小和 SHA-256；记录签名状态与未完成的真机验证。

## 已完成的实际验证

- Python 57 项、相关前端及 CI 54 项通过，TypeScript 类型检查与 diff 空白检查通过。
- Xcode 27.0 编译 iOS Simulator 成功，iOS 27 / iPhone 17 模拟器 XCTest 验证管理设备中的“检查更新”按钮及未配置提示通过（1 项）。
- 已读取用户提供的真实 profile：授权显式 Bundle ID 与项目原 ID 不同；针对已登记设备验证成功，使用原项目 ID 被正确拒绝。
- 已签名生产 IPA、生产 HTTPS 发布、真机覆盖升级与数据保留尚未验证：需要服务器地址/SSH 配置和旧安装的签名身份；P12 密码已从压缩包文件名取得并验证。

## 6. 用户补充：仅本机与局域网

- [x] 删除本次上传的四个 GitHub Secrets 与两个 Variables；证书与密码仅留本机私有目录。
- [x] 真实 P12 兼容转换、实际 IPA 签名与独立验签通过（32 项签名测试）。
- [x] TDD 实现局域网 HTTPS OTA 静态服务、私有 CA 首次信任入口与 launchd 托管。
- [x] TDD 支持 localRoot/caFile 本机发布，先验证版本目录再原子切换固定入口，保留远程发布兼容。
- [ ] 本机配置仅保存权限 600 文件；发布带固定 HTTPS 更新源的已签名 IPA。
- [ ] 验证局域网 TLS、HEAD/完整 GET、manifest、固定安装页，交付首次 CA 信任步骤与真机待验证边界。
