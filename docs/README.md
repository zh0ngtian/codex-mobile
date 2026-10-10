# 文档索引

## 现役说明

- [项目 README](../README.md)：使用方法、架构、配置、客户端能力与边界。
- [自动安装指南](../install.md)：macOS npm 网关安装和开机启动。
- [仓库协作约定](../AGENTS.md)与 [Git 提交规范](commit-conventions.md)：开发、验证和交付要求。
- [iOS OTA 发布](ios-ota-release.md)：本机签名、身份连续性、固定渠道、Cloudflare 软件源同步与重试及安装诊断。
- [iOS 模拟器验证](ios-simulator-verification.md)：可复用操作步骤与按日期保留的验收结果。
- [协议基准](../protocol/app-server-v2/README.md)：固定快照的版本、来源和使用边界。

## 当前发布入口

版本以在线清单为准，不能从 package.json 的开发版本、文档示例或历史记录推断：

- [Android 清单](http://192.168.123.79:8765/channels/codex-mobile/latest.json)及 [固定 APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)。
- [iOS 清单](http://192.168.123.79:8765/channels/codex-mobile/latest-ios.json)及 [固定 IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)。
- [HTTPS OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)及 [OTA 清单](https://192.168.123.79:8766/channels/codex-mobile/current/latest-ios.json)。
- [Cloudflare 软件源](https://yao-app-source.305301890.workers.dev/source.json)：SignOs 可添加此源；正式发版使用 OTA 已成功发布的同一签名 IPA。

固定链接随新版本更新。历史记录里的版本、大小、散列只描述当次发布；应读取当前清单，再用 HEAD 和完整 GET 校验当前下载。渠道可用和构建验签不等于真机覆盖安装、数据保留已验证。

## 历史资料

`plans/` 与 `superpowers/plans/` 保留设计决策、实施过程和当次验证证据，不是另一套现役操作说明。未勾选的旧计划项不自动成为当前待办；应先检查后续提交、交付记录与运行态。两处目录维持原路径，避免破坏既有引用。

近期可追溯记录：

- [恢复网页界面](superpowers/plans/2026-10-10-remove-native-restore-web.md)：原生对话与原生边栏已回退；WKWebView 容器和原生桥保留。
- [键盘同步](superpowers/plans/2026-10-10-keyboard-sync.md)与 [审批回复](superpowers/plans/2026-10-10-approval-replies.md)。
- [项目拖动排序](superpowers/plans/2026-10-10-project-drag-order.md)：实现、验证与 0.2.138 发布记录；已按用户要求[回退](superpowers/plans/2026-10-10-revert-project-order.md)。
- [内置浏览器视觉记录](../design-qa.md)：原截图未保留，结论仅作历史线索。

历史测试产物通常在被 Git 忽略的 `.mobile-build/` 中，只在原机器可用。清理前先核对是否仍为唯一证据；源码中的截图与文档引用按仓库相对路径维护。
