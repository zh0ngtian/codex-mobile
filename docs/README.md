# 文档索引

## 现役说明

- [项目 README](../README.md)：使用方法、架构、配置、客户端能力与边界。
- [交互与功能对齐约定](interaction-alignment.md)：AgentApp 基线、最新用户确认、覆盖关系、待验收项与后续变更记录；交互和功能修改须同步维护。
- [自动安装指南](../install.md)：macOS npm 网关安装和开机启动。
- [仓库协作约定](../AGENTS.md)与 [Git 提交规范](commit-conventions.md)：默认验证后合入 main、提交推送；main 在修改期间有新提交才需整合回归，默认不发布。
- [发布协调说明](release-coordination.md)：仅在明确要求发布或部署时使用的 releasectl 配置、适配器入口、必要验证、共同凭证及实际验收状态。
- [iOS OTA 发布](ios-ota-release.md)：本机签名、身份连续性、固定渠道、软件源发布文档入口及安装诊断。
- [原生 iOS 界面桥接](native-ui-business-bridge.md)：双向切换、检查点与共享业务边界。
- [iOS 模拟器验证](ios-simulator-verification.md)：可复用操作步骤与按日期保留的验收结果。
- [2026-10-18 关注会话加载耗时](performance/2026-10-18-conversation-loading/README.md)：分阶段计时、重复打开/重启后首次打开的分布及脱敏原始样本；模拟器Debug数据。
- [2026-10-19 冷启动边栏列表耗时](performance/2026-10-19-sidebar-cold-start/README.md)：30次进程冷启动的首批会话、全部分组、阶段耗时及请求形态；模拟器Debug数据，终点为原生快照派发。
- [2026-10-19 冷启动边栏优化复测](performance/2026-10-19-sidebar-startup-optimized/README.md)：额度后台调度、无项目定向摘要及每组五条分页；同原生容器各30次对照，模拟器验证完成、未发布。
- [2026-10-19 真机冷启动边栏耗时](performance/2026-10-19-sidebar-real-device/README.md)：已安装 0.3.18 的 20 次进程冷启动、3 次低查询对照、上屏终点与长尾边界；当时的测量和优化提案，后续实施见下条。
- [2026-10-20 首批解耦与运行会话五条计数](performance/2026-10-20-sidebar-startup-simulator/README.md)：模拟器同容器各20次冷启动，首批明显提前、整轮未证明提速；运行计入五条及更多/折叠验收通过，采样时未发布；相关实现后续已随0.3.19交付。
- [2026-10-20 整轮刷新摘要索引与并发对照](performance/2026-10-20-sidebar-full-refresh-index/README.md)：网关批量摘要、无项目五条游标、2/4/6并发及前台检查；最终四并发20次P50改善、P95近乎不变，未达1秒，采样时未发布；相关实现后续已随0.3.19交付。
- [2026-10-20 折叠项目按需加载](performance/2026-10-20-sidebar-lazy-projects/README.md)：新设备默认全折叠，点击才取本组五条，20次目录/摘要阶段P50/P95为130/136毫秒；不含延后的会话首批，采样时未发布；相关实现后续已随0.3.19交付。
- [2026-10-20 当前项目展开耗时补测](performance/2026-10-20-sidebar-project-expand/README.md)：20次首次展开数据就绪P50/P95为91/113毫秒；另3次原生录像从展开首帧到五条文字接近最终清晰度约0.51–0.53秒，口径分开，采样时未发布；相关实现后续已随0.3.19交付。
- [2026-10-20 边栏优化双端发布与网关部署](superpowers/plans/2026-10-20-sidebar-lazy-release.md)：已发布0.3.19（3019），两目标成功凭证及固定APK/已签名IPA、OTA与unsigned软件源回验；性能报告仍保留原采样口径。
- [协议基准](../protocol/app-server-v2/README.md)：固定快照的版本、来源和使用边界。

## 当前发布入口

现役双端客户端为0.3.31（3031），修复 iOS 点击“模型总结”后闪退，候选名称返回后可继续编辑并保存；继承0.3.30的独立标题总结、自动命名、重命名候选确认及界面改进。双端固定渠道、HTTPS OTA、GitHub及unsigned软件源独立回验通过，来源准备与正式发布的规格、质量审查均通过，见[本次发布计划](superpowers/plans/2026-10-23-title-summary-crash-release.md)与[公共凭证](superpowers/plans/evidence/2026-10-23-title-summary-crash-release.json)。本轮仅发布客户端，网关沿用此前0.3.30的配套部署；桌面置顶的Bark完成通知由网关独立跟踪，配置后App退出仍可接收。此前线上标题接口、部署进程及摘要已核对；真实Bark送达、真机原生文件入口、修复版覆盖安装、数据保留和功能验收仍待现场确认。

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

- [2026-10-23 模型总结闪退修复双端发布](superpowers/plans/2026-10-23-title-summary-crash-release.md)：0.3.31成功批次、双端固定渠道、签名连续性、GitHub与unsigned软件源独立回验；本轮未重新部署网关；[公共凭证](superpowers/plans/evidence/2026-10-23-title-summary-crash-release.json)。
- [2026-10-23 会话标题总结双端发布与网关部署](superpowers/plans/2026-10-23-thread-title-release.md)：0.3.30双目标成功批次、固定渠道及签名连续性、unsigned软件源、线上标题接口与会话归档回验；[公共凭证](superpowers/plans/evidence/2026-10-23-thread-title-release.json)。
- [2026-10-22 普通文件复制导入双端发布](superpowers/plans/2026-10-22-file-picker-copy-release.md)：0.3.29成功批次、双端固定渠道、签名连续性与独立回验；[公共凭证](superpowers/plans/evidence/2026-10-22-file-picker-copy-release.json)。
- [2026-10-21 侧栏与对话页顶部按钮对齐双端发布](superpowers/plans/2026-10-21-sidebar-header-alignment-release.md)：0.3.28历史批次与当次验收；[公开凭证](superpowers/plans/evidence/2026-10-21-sidebar-header-alignment-release.json)。

- [恢复网页界面](superpowers/plans/2026-10-10-remove-native-restore-web.md)：当时原生对话与边栏回退的历史记录；当前可选原生界面以 README 和桥接说明为准。
- [键盘同步](superpowers/plans/2026-10-10-keyboard-sync.md)与 [审批回复](superpowers/plans/2026-10-10-approval-replies.md)。
- [项目拖动排序](superpowers/plans/2026-10-10-project-drag-order.md)：实现、验证与 0.2.138 发布记录；已按用户要求[回退](superpowers/plans/2026-10-10-revert-project-order.md)。
- [内置浏览器视觉记录](../design-qa.md)：原截图未保留，结论仅作历史线索。

历史测试产物通常在被 Git 忽略的 `.mobile-build/` 中，只在原机器可用。清理前先核对是否仍为唯一证据；源码中的截图与文档引用按仓库相对路径维护。

- [Sidechat 已批准设计](superpowers/specs/2026-10-19-sidechat-design.md)与[实施计划](superpowers/plans/2026-10-19-sidechat.md)：模拟器验证通过，源码已合入main；客户端与生产网关尚未发布。

- [2026-10-21 视频独立预览与侧栏修复双端发布](superpowers/plans/2026-10-21-video-preview-release.md)：0.3.27成功批次、双端固定渠道、签名连续性及九项独立回验；[公开凭证](superpowers/plans/evidence/2026-10-21-video-preview-release.json)。
- [2026-10-21 顶部更多与直接侧栏布局双端发布](superpowers/plans/2026-10-21-sidebar-inline-release.md)：0.3.26成功批次、双端固定渠道与签名连续性独立回验；[公开凭证](superpowers/plans/evidence/2026-10-21-sidebar-inline-release.json)。
- [2026-10-21 回复同步与侧栏操作双端发布](superpowers/plans/2026-10-21-completion-refresh-release.md)：0.3.25成功批次、双端渠道独立回验及真机待验收边界；[公开凭证](superpowers/plans/evidence/2026-10-21-completion-refresh-release.json)。
