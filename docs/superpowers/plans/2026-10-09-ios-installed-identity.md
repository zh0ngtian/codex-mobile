# 保留已安装 iOS 身份实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 复现用户已成功安装的全能签 IPA 身份，让本机签名与 OTA 包保留原 Bundle ID，提供真实可验证的覆盖升级包。

**Architecture:** 默认签名继续执行严格的 Bundle ID/profile 对应检查。显式配置已签名兼容基准 IPA 及 SHA-256 后，独立验签该包、验证全部权限获得 profile 授权，再复用基准的签名权限与原 Bundle ID。固定渠道通过一次有来源版本与散列约束的身份恢复记录切回原 Bundle ID；Team 与 application-identifier 仍必须连续。

**Tech Stack:** Python、macOS codesign/security、Xcode、现有 HTTPS OTA 与 LAN 固定渠道。

---

### Task 1：基准验签与兼容签名

**Files:** `scripts/ios_sign.py`, `tests/ci/test_ios_signing.py`

- [x] 现有 Python iOS 测试基线 59 项通过。
- [ ] 先写测试：未指定基准仍拒绝不同 Bundle ID；兼容基准允许 `vip.loock.codexmobile` 与 profile 指定 application-identifier 分别保持；禁止基准散列不匹配、Team 不同、未授权 entitlement、UDID 未授权、签名无效；精确保留基准权限和钥匙串组。
- [ ] 运行新增测试确认失败，再实现最小兼容路径。

```python
# 发布预检与 sign_ipa 共用；没有 compatibility_ipa 时保留原行为。
identity = signing_identity(profile, bundle_id, udid,
    compatibility_ipa=baseline_path, compatibility_ipa_sha256=baseline_sha256)
# identity['entitlements'] 精确复制独立验签且获新 profile 授权的基准权限。
# sign_ipa 同名可选参数传入基准；--compatibility-ipa 与
# --compatibility-ipa-sha256 必须成对提供。
```

- [ ] `verify_ipa` 以真实签名权限对 profile 验证，分别返回实际 Bundle ID 与 application-identifier，新增 `keychainAccessGroups`、`entitlementsSha256` 公共字段；默认签名模式仍要求原来的严格对应。
- [ ] 用上传的真实 0.2.122 IPA 独立验签和真实证书签名验证，不把本机验签当真机升级成功。
- [ ] 完成规格审查、质量审查及中文提交，集成主任务。

### Task 2：发布配置与固定渠道恢复

**Files:** `scripts/release-ios.py`, `scripts/ios_ota.py`, `tests/ci/test_ios_release.py`, `tests/ci/test_ios_ota.py`

- [ ] 先写测试验证配置必须同时包含私有兼容 IPA 路径及 SHA-256；预检与签名使用相同基准。
- [ ] 身份恢复明确要求 `restoreInstalledIdentityFromBundleId` 与当前渠道旧 Bundle ID 相符，且目标 Bundle ID 来自真实兼容基准；生成如下恢复记录，仅允许 Bundle ID 恢复，拒绝 Team/application-identifier 改变和陈旧记录。

```python
identity_transition = {
    'fromBundleId': previous['bundleId'], 'toBundleId': identity['bundleId'],
    'previousVersion': previous['version'], 'previousSha256': previous['sha256'],
    'compatibilityIpaSha256': config['compatibilityIpaSha256'],
}
```

- [ ] 发布检查包括版本递增、源渠道版本/散列匹配和恢复记录身份；普通升级继续检查身份与已记录的钥匙串组连续性。
- [ ] 用旧包验签结果预检，阶段发布与原子激活重复执行相同校验；保持历史发布目录。

### Task 3：部署、双端发布与文档

**Files:** `docs/ios-ota-release.md`, `AGENTS.md`；本机仓库外 `ios-release.local.json`、兼容基准 IPA。

- [ ] 修正文档中必须改 Bundle ID 的过度推断，记录旧包证据、兼容基准、续期处理和真机待验证项。
- [ ] 基准 IPA 保存至本机签名目录 600 并固定散列；配置 Bundle ID 恢复到 `vip.loock.codexmobile`，保持现有证书、UDID、Team、HTTPS 和 CA。
- [ ] 提交推送完成代码，按双端固定渠道版本下限分配统一更高版本；构建 Android 与本机设备 IPA，真实签名并独立验签。
- [ ] HTTPS 与 LAN 清单、HEAD、完整 GET 核对散列、大小和版本。保存交付证据、归档 worktree，给出固定安装链接和 APK/IPA 元数据。
- [ ] 真机覆盖安装和原数据保留由用户验证；不将构建结果等同于该目标已验证。

## 已确认旧包事实

旧包 0.2.122：`CFBundleIdentifier=vip.loock.codexmobile`，`application-identifier=SC456JW7RP.app.jade6694.grapefruit3766`，Team `SC456JW7RP`，keychain groups 为 `SC456JW7RP.*` 与 `com.apple.token`。严格资源验签通过，嵌入 profile 的 Apple CMS 验证通过。当前自动签名错误地把 Bundle ID 改为 profile 指定标识，并缩减了钥匙串组，需修正。
