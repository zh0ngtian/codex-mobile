# 仓库协作约定

- 使用中文回答问题和编写文档。
- 部署任务必须使用 superpowers 的计划与 TDD 流程。

## 构建与交付

- 每次完成仓库修改后，必须提交并推送本次代码变更。
- 推送成功后，必须构建版本号高于固定渠道现有版本的新 APK，并发布到 Codex Mobile 固定局域网渠道；不得只上传 48 小时随机临时链接。
- 固定更新清单为 `http://192.168.123.79:8765/channels/codex-mobile/latest.json`，固定 APK 为 `http://192.168.123.79:8765/channels/codex-mobile/latest.apk`。
- 使用 `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <APK> --version <版本> --notes <说明>` 发布；发布后必须通过固定 JSON、HEAD、GET 核对版本、文件大小和 SHA-256。
- 交付修改时必须提供固定 APK 下载链接和本次版本号、文件大小、SHA-256。

## Git 提交规范

- 提交前必须阅读并遵守 [Git 提交规范](docs/commit-conventions.md)。
- 提交信息采用 Conventional Commits 类型前缀和中文描述。
- 提交正文必须准确说明本次新增的功能和完成的主要修改。
