# 文档索引

## 现役说明

- [项目 README](../README.md)：使用方法、架构、配置、客户端能力与边界。
- [交互与功能对齐约定](interaction-alignment.md)：AgentApp 基线、最新用户确认、覆盖关系、待验收项与后续变更记录；交互和功能修改须同步维护。
- [自动安装指南](../install.md)：macOS npm 网关安装和开机启动。
- [仓库协作约定](../AGENTS.md)与 [Git 提交规范](commit-conventions.md)：开发、验证和交付要求。
- [发布协调说明](release-coordination.md)：本项目 releasectl 配置、适配器入口、必要验证、共同凭证及实际验收状态。
- [iOS OTA 发布](ios-ota-release.md)：本机签名、身份连续性、固定渠道、软件源发布文档入口及安装诊断。
- [原生 iOS 界面桥接](native-ui-business-bridge.md)：双向切换、检查点与共享业务边界。
- [iOS 模拟器验证](ios-simulator-verification.md)：可复用操作步骤与按日期保留的验收结果。
- [2026-10-18 关注会话加载耗时](performance/2026-10-18-conversation-loading/README.md)：分阶段计时、重复打开/重启后首次打开的分布及脱敏原始样本；模拟器Debug数据。
- [2026-10-19 冷启动边栏列表耗时](performance/2026-10-19-sidebar-cold-start/README.md)：30次进程冷启动的首批会话、全部分组、阶段耗时及请求形态；模拟器Debug数据，终点为原生快照派发。
- [协议基准](../protocol/app-server-v2/README.md)：固定快照的版本、来源和使用边界。

## 当前发布入口

版本以在线清单为准，不能从 package.json 的开发版本、文档示例或历史记录推断：

- [Android 清单](http://192.168.123.79:8765/channels/codex-mobile/latest.json)及 [固定 APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)。
- [iOS 清单](http://192.168.123.79:8765/channels/codex-mobile/latest-ios.json)及 [固定 IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)。
- [HTTPS OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)及 [OTA 清单](https://192.168.123.79:8766/channels/codex-mobile/current/latest-ios.json)。
- [Cloudflare 软件源](https://signos-source-aggregator.305301890.workers.dev/sources/yao.json)：SignOs 可添加此源；只自动同步本仓库 GitHub Release 的 unsigned IPA，安装前需自行签名；Ad Hoc 已签名包仅用于 OTA/LAN。

固定链接随新版本更新。历史记录里的版本、大小、散列只描述当次发布；应读取当前清单，再用 HEAD 和完整 GET 校验当前下载。渠道可用和构建验签不等于真机覆盖安装、数据保留已验证。

## 历史资料

- [2026-10-15 原生视觉参考](research/native-visual-refresh-2026-10-15/design-spec.md)：旧截图与布局映射；后续已确认的 AgentApp 交互及视觉要求以[交互与功能约定](interaction-alignment.md)为准。

- [DeepSeek iOS 真机界面探索](research/deepseek-ios-2026-10-14/README.md)：2026-10-14 的页面、导航、截图、脱敏 UI 层级、资源清单与未验证范围，供后续原生界面设计参考；不是已批准的实施方案。

`plans/` 与 `superpowers/plans/` 保留设计决策、实施过程和当次验证证据，不是另一套现役操作说明。未勾选的旧计划项不自动成为当前待办；应先检查后续提交、交付记录与运行态。两处目录维持原路径，避免破坏既有引用。

近期可追溯记录：

- [恢复网页界面](superpowers/plans/2026-10-10-remove-native-restore-web.md)：当时原生对话与边栏回退的历史记录；当前可选原生界面以 README 和桥接说明为准。
- [键盘同步](superpowers/plans/2026-10-10-keyboard-sync.md)与 [审批回复](superpowers/plans/2026-10-10-approval-replies.md)。
- [项目拖动排序](superpowers/plans/2026-10-10-project-drag-order.md)：实现、验证与 0.2.138 发布记录；已按用户要求[回退](superpowers/plans/2026-10-10-revert-project-order.md)。
- [内置浏览器视觉记录](../design-qa.md)：原截图未保留，结论仅作历史线索。

历史测试产物通常在被 Git 忽略的 `.mobile-build/` 中，只在原机器可用。清理前先核对是否仍为唯一证据；源码中的截图与文档引用按仓库相对路径维护。
