# iOS 软件源发布实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 逐项实施；按 test-driven-development 先验证失败再实现。

**目标：** 本机 OTA、固定 LAN IPA 校验成功后，把同一已签名 IPA 发布到 SignOs 使用的 Cloudflare 软件源，并支持失败后独立重试。

**架构：** 新增 `scripts/ios_app_source.py` 适配 SignOs 仓库已有 `scripts/app_source.py` CLI，不复制其实现、不重新签名。每次从公网和 R2 核对最新清单，在独立暂存目录恢复全部历史资源；校验 OTA 凭证和包身份、阻止冲突及降级，再执行资源先上传、清单最后上传。发布器保存 OTA 成功凭证后调用该适配器。

**技术：** Python 3.11、unittest、rclone S3、现有 SignOs CLI。

参考：SignOs `2ce22dfa01dd8935c09b7898e363930f66e3b9fc`，`cloudflare/app-source/README.md`、`PUBLISH_PROMPT.md`、`scripts/publish_signos.py`。

## 任务 1：凭证和源保护

- [x] 在 `tests/ci/test_ios_app_source.py` 创建真实 ZIP/Info.plist 测试夹具；测试签名标记、SHA、size、Bundle ID/version/build 不匹配被拒绝，`prepare` 不更改 IPA。
- [x] 运行 `python3 -m unittest discover -s tests/ci -p 'test_ios_app_source.py'`，确认缺少实现导致失败。
- [x] 实现 `prepare(ipa, receipt)`；固定 Codex Mobile 身份，沿用凭证日期与说明。实现同版本摘要冲突、旧版本降级、资源源外 URL/路径穿越拦截。
- [x] 重跑测试，确认转绿。

## 任务 2：恢复、发布、回验

- [x] 先测试 `publish` 的恢复、基线检查和失败顺序；传输边界用替身，IPA/清单文件和比较使用真实数据。
- [x] 实现只读 `--plan`；S3 凭据仅来自环境，目标默认读取 SignOs 配置，可显式 `--source-config`、`--signos-repo`。
- [x] 正式发布用共享本机锁；核对公网/R2 基线，恢复所有引用资源、验证 IPA SHA/大小，调用 SignOs `publish`；重查基线再 `sync --transport s3`，回验清单且保留前后证据。锁不声称提供跨机器互斥。
- [x] 验证未丢失其他应用与历史版本；失败不重签、不改版本、不删除历史包。

## 任务 3：主入口与交付

- [x] 先在 `tests/ci/test_ios_release.py` 测试只有 LAN 校验成功后保存凭证并调用软件源，失败保留凭证供重试。
- [x] 修改 `scripts/release-ios.py`：构建前检查软件源依赖与凭据，plan 展示新增步骤，成功后保存 `ota-release.json`，调用新适配器。增加 `npm run ios:publish-source`。
- [x] 更新 `AGENTS.md`、`README.md`、`docs/README.md`、`docs/ios-ota-release.md`，明确双 iOS 渠道完成标准、凭据注入与重试命令。
- [x] 运行 `python3 -m unittest discover -s tests/ci -p 'test_ios_*.py'` 和 `git diff --check`；使用现有正式 IPA/凭证执行只读 plan。本次无客户端改动，不构建或上传安装包。
- [x] 按中文 Conventional Commits 提交并推送开发分支。


## 验证结果

- 原发布入口基线：9 项通过。
- 软件源新测试按红 → 绿实现；最终 `python3 -m unittest discover -s tests/ci -p 'test_ios_*.py'` 共 103 项通过。
- 独立 worktree 已安装锁文件依赖；完整回归需要本机回环监听与系统 Apple 根证书访问。最初的环境限制已解除后重跑通过。
- 真实 SignOs `scripts/app_source.py publish` 本地联调通过：正式 0.2.136 IPA 原样复制，SHA-256、日期、说明与 OTA 凭证相符。临时联调目录已清理，没有执行公网上传。
- 当前私有配置的完整 `npm run ios:release ... --plan` 通过，展示 OTA → LAN → 软件源顺序，已安装身份保持不变。计划计算出的 0.2.141 仅为预检结果，没有构建或发布该版本。
- 本次仅修改脚本、测试、文档与 npm 命令，不修改客户端或网关运行代码；不发布 APK/IPA，不部署网关。没有创建应用测试会话。
- 网络上传分支由传输边界替身测试覆盖；本次没有验证新的线上 S3 上传，不把本地联调或 plan 当作公网发布完成。
