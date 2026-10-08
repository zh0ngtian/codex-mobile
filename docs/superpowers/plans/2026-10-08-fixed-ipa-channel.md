# iOS 固定下载渠道实施计划

> 执行方式：在当前会话按 superpowers:executing-plans 与 test-driven-development 流程执行。

**目标：** 将现有 0.2.91 IPA 发布到永久固定路径 `/channels/codex-mobile/latest.ipa`，并记录后续发布约定。

**架构：** 复用 GlobalTranslation 的文件服务与本机 `publish-channel` 命令，根据安装包扩展名选择平台。Android 保留 `latest.json`，iOS 使用独立 `latest-ios.json`，两个平台的文件、版本历史互不覆盖。固定文件不参与临时上传的 48 小时清理。

**技术：** Python 标准库 HTTP 服务、unittest、现有 Android 构建工具。

## 执行步骤

- [ ] 在 `GlobalTranslation/tests/test_apk_server.py` 增加固定 IPA 发布、重复发布、HEAD/GET、错误包拒绝和 Android 隔离测试。运行 `python3 -m unittest discover -s tests -p test_apk_server.py`，确认新增测试因不支持 IPA 而失败。
- [ ] 修改 `GlobalTranslation/scripts/apk-server.py`：按 `.apk` / `.ipa` 校验容器；IPA 存为 `codex-mobile.ipa`，独立清单存为 `codex-mobile-ios.json`；允许 `latest.ipa` 与 `latest-ios.json` 路由。运行同一测试命令，全部通过。
- [ ] 更新两仓库 `AGENTS.md`，记录固定 IPA 地址、独立清单、发布命令与校验要求；提交并推送相关改动。
- [ ] 重启文件服务，运行 `publish-channel codex-mobile <现有 IPA> --version 0.2.91 --notes 'iOS 固定下载渠道，未签名 IPA'`。
- [ ] 按 Codex Mobile 仓库交付约定，提交推送后构建高于当前 Android 渠道版本的 APK 并发布。
- [ ] 通过两个平台清单、HEAD 和完整 GET 校验版本、大小、SHA-256，确认两个固定地址同时可用；清理测试临时目录。
