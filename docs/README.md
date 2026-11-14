# 文档索引

## 现役说明

- [项目 README](../README.md)：使用方法、架构、配置、客户端能力与边界。
- [交互与功能对齐约定](interaction-alignment.md)：AgentApp 基线、最新用户确认、覆盖关系、待验收项与后续变更记录；交互和功能修改须同步维护。
- [自动安装指南](../install.md)：macOS npm 网关安装和开机启动。
- [仓库协作约定](../AGENTS.md)与 [Git 提交规范](commit-conventions.md)：默认验证后合入 main、提交推送；main 在修改期间有新提交才需整合回归，默认不发布。
- [发布协调说明](release-coordination.md)：仅在明确要求发布或部署时使用的 releasectl 配置、适配器入口、必要验证、共同凭证及实际验收状态。
- [历史 iOS OTA 资料](ios-ota-release.md)：停止新批次操作；仅保留旧包签名身份、原固定渠道和安装诊断。现行unsigned分发使用上方发布协调说明。
- [iOS 原生界面桥接](native-ui-business-bridge.md)：iOS 双向切换、检查点与共享业务边界；Android 使用现有 Web 页面。
- [Android WebView 开发验收](android-web-verification.md)：删除 Compose 呈现后的构建、回归与独立 QA 实机结果；当前源码未正式发布。
- [Android 原生开发验收（历史）](android-native-verification.md)：已移除的 Material You 实现、独立 QA 安装及当时验证边界。
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
- [常驻 Remote 网关设计](superpowers/specs/2026-11-13-remote-gateway.md)与[实施计划](superpowers/plans/2026-11-13-remote-gateway.md)：开发中；协议、自有授权、有界RPC、受管认证、账号绑定目录、OAuth、活动身份和运行管理已有源码与隔离审查，运行层的三流RPC、同流恢复、零流短时保活及持久暂停恢复已有正式Remote收据。[Mac管理说明](remote-gateway-management.md)记录私有通道、固定CLI和实例归属；该入口已通过独立规格/质量复审及正式Remote的实际进程重启、SIGKILL恢复、活owner竞争与零流后RPC探针。[第44/45项补充方案](superpowers/specs/2026-11-13-remote-gateway-cli-proposal.md)保持当前用户专有管理和候选身份原子切换边界。[目标命令基础](superpowers/plans/evidence/2026-11-13-remote-commands-isolated-validation.json)已通过独立双审，正式Remote已验证默认权限字节输出、自有进程收尾与零流后RPC；文件层继续开发。固定计量权限例外和目标自身来源发现已隔离验证，产品统计、目标业务路由、共享队列、手机模式及长期性能继续后续任务。未部署现役服务或发布客户端。
- [Remote文件读取方式第47项](superpowers/specs/2026-11-14-remote-file-buffered-read-proposal.md)：A已实现，固定41dd源码的服务端验证及独立双审通过；[官方两轮产品读回](superpowers/plans/evidence/2026-11-14-remote-files-buffered-product-attempts.json)仍分别在80MiB超时、64MiB被原生pongTimer断开，Task3b未验收。[第48项传输存活方案](superpowers/specs/2026-11-14-remote-heartbeat-progress-proposal.md)已确认A，修复e16已通过70项专项、完整服务端1334项/7项跳过、双strict与构建；冻结新源码d235的双审通过，官方首轮仍在180秒交付74MiB后超时、连接保持在线；[新验证与耗时收据](superpowers/plans/evidence/2026-11-14-remote-heartbeat-progress-validation.json)未发现有反例支持的局部缺陷。[第49项读取预算](superpowers/specs/2026-11-14-remote-file-read-budget-proposal.md)已选择A：仅read可显式最高600秒，默认20秒、其他操作及单窗口RPC最高180秒，实现9bed已完成19项新增、完整服务端1353项/7项跳过、双strict与构建；[新验证收据](superpowers/plans/evidence/2026-11-14-remote-file-read-budget-validation.json)记录冻结d1c82e4首轮SPEC发现过期后仍可实际发送的缺陷，修复新冻结253aa0b已通过独立SPEC与QUALITY，官方首轮在68MiB后触发既有30秒组装期限，文件gate未通过。[第50项固定窗口方案](superpowers/specs/2026-11-14-remote-file-window-size-proposal.md)建议改为512KiB单块以缩小响应，待用户确认，未实施。[原调查收据](superpowers/plans/evidence/2026-11-14-remote-files-read-investigation.json)保留长流式失败及仓库外可行性；均不代表手机功能或长期稳定性通过。

- [2026-11-14 WebUI 输入框补修与双端发布](superpowers/plans/2026-11-14-web-composer-github-release.md)：0.3.47 APK／未签名 IPA 与既有软件源验收成功，加号居中和一至六行自适应已验证。
- [2026-11-11 原生版发布与后续 Android 单端构建](superpowers/plans/2026-11-11-android-only-release.md)：0.3.45 双端与软件源验收成功，已具备 APK 单端入口；后续 IPA 范围以[原生界面影响判据](release-coordination.md#ios-build-scope)为准，包含破坏原生操作的网关接口变更，仅 WebUI 不打 IPA。单端首次真实批次待后续发布验收。
- [2026-11-10 网页引用补修联合发布](superpowers/plans/2026-11-10-web-citations-hidden-release.md)：0.3.44 GitHub双端及既有iOS软件源、配套网关成功；12会话54项来源与73处引用回验通过。

## 当前发布入口

最近已验收客户端为0.3.47（3047）：WebUI 输入框对齐 iOS 的正文与工具行布局，长输入自动增高至六行，模型、思考强度、权限和 Fast 独立操作，附件加号使用居中 SVG。成功批次 `433ed0e5-e037-4af3-adeb-a65bfd59bf0e`，冻结 `248b05ebea81aa54f7642eec186f286618b8cb9e`；GitHub APK／未签名 IPA 和既有 iOS 软件源已回验，46项独立渠道核对通过。167项组件／业务回归、17项 iPhone 17 Pro WebKit 验收及四项发布门禁通过。本次未部署网关；LAN、签名 IPA 与 OTA 继续停用。真机键盘、安装、数据保留与实际手感待验收，详见[发布凭证](superpowers/plans/evidence/2026-11-14-web-composer-release.json)。

此前0.3.35已发布后续消息从输入区连续交接到用户气泡和旧图片预览保留，继承0.3.34的首条发送动效，历史、页头、附件及队列语义保持；其[发布计划](superpowers/plans/2026-10-24-followup-message-motion-release.md)与[公共凭证](superpowers/plans/evidence/2026-10-24-followup-message-motion-release.json)保留当次验收口径。

标题总结固定 `gpt-6-luna`、`low` 和Fast已另行完成仅网关部署，成功批次 `51b36234-ea37-4ba9-a7ac-c9b4375086dd`、冻结提交 `0dea2a1`。实际安装模块的手动／automatic两种HTTP入口协议探测通过，原会话和全局设置无写入；该次部署时固定客户端0.3.32的版本、大小、散列未变；现役客户端与渠道以上方最新成功凭证为准。探测使用回环协议替身，不调用真实模型或Bark。见[部署计划](superpowers/plans/2026-10-23-title-luna-gateway-deploy.md)与[公共凭证](superpowers/plans/evidence/2026-10-23-title-luna-gateway-deploy.json)。

版本以本次GitHub Release、软件源及成功凭证为准，不能从package.json、已停用LAN清单或历史记录推断：

- Android从下方GitHub Release手动下载APK安装；8765已停用，既有客户端LAN更新检查不可用，本次未实现GitHub自动更新。历史APK／IPA／清单文件保留，不作为新版本入口。
- [GitHub Release](https://github.com/zh0ngtian/codex-mobile/releases)：现行APK和unsigned IPA；iOS包未签名，安装前需自行签名。
- [Cloudflare 软件源](https://signos-source-aggregator.305301890.workers.dev/sources/yao.json)：SignOs可添加此源；只自动同步既有GitHub unsigned IPA订阅，保留原署名，不新增已签名订阅。
- [历史iOS清单](http://192.168.123.79:8765/channels/codex-mobile/latest-ios.json)、[历史固定IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)、[历史HTTPS OTA安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)及[历史OTA清单](https://192.168.123.79:8766/channels/codex-mobile/current/latest-ios.json)保留，不再更新，也不作为本次交付入口。

GitHub及既有iOS软件源随成功新批次更新；历史LAN与OTA均停止更新，服务保持停用，文件保留不删。现行回验独立完整下载GitHub两端包并核对软件源，保存github-only成功凭证，明确LAN APK、签名／OTA／固定IPA未发布。交付不要求旧固定APK、IPA或OTA链接；渠道和构建验证不等于真机覆盖安装、数据保留已验证。

## 历史资料

- [2026-10-15 原生视觉参考](research/native-visual-refresh-2026-10-15/design-spec.md)：旧截图与布局映射；后续已确认的 AgentApp 交互及视觉要求以[交互与功能约定](interaction-alignment.md)为准。

- [DeepSeek iOS 真机界面探索](research/deepseek-ios-2026-10-14/README.md)：2026-10-14 的页面、导航、截图、脱敏 UI 层级、资源清单与未验证范围，供后续原生界面设计参考；不是已批准的实施方案。

`plans/` 与 `superpowers/plans/` 保留设计决策、实施过程和当次验证证据，不是另一套现役操作说明。未勾选的旧计划项不自动成为当前待办；应先检查后续提交、交付记录与运行态。两处目录维持原路径，避免破坏既有引用。

近期可追溯记录：

- [2026-11-09 网页来源引用修复发布与网关部署](superpowers/plans/2026-11-09-web-citations-release.md)：0.3.43 GitHub双端与配套网关成功凭证、87项渠道及19项网关独立核对；[公共凭证](superpowers/plans/evidence/2026-11-09-web-citations-release.json)。
- [2026-10-26 列表排版统一发布](superpowers/plans/2026-10-26-markdown-list-rhythm-release.md)：0.3.42 GitHub-only成功批次、82项独立核对及真机待验收边界；[公共凭证](superpowers/plans/evidence/2026-10-26-markdown-list-rhythm-release.json)。
- [2026-10-25 无项目会话修复客户端发布（0.3.40）](superpowers/plans/2026-10-25-projectless-send-release.md)：53项独立核对及真机待验收边界；[公共凭证](superpowers/plans/evidence/2026-10-25-projectless-send-release.json)。
- [2026-10-26 新会话创建修复发布](superpowers/plans/2026-10-26-new-thread-creation-release.md)：0.3.41 GitHub-only成功批次与真机待验收边界；[公共凭证](superpowers/plans/evidence/2026-10-26-new-thread-creation-release.json)。
- [2026-10-25 worktree归属、GitHub-only发布与配套网关部署](superpowers/plans/2026-10-25-worktree-unsigned-release.md)：0.3.39成功批次、LAN／OTA关闭与TLS只读恢复谱系；[公共凭证](superpowers/plans/evidence/2026-10-25-worktree-github-release.json)。

- [2026-10-25 选择杆高度修复默认双端发布](superpowers/plans/2026-10-25-selection-handle-height-release.md)：0.3.36成功批次、选择杆／自动命名／上传显示字段／中途提问四项客户端变化、237项独立渠道回验与最终审查；[公共凭证](superpowers/plans/evidence/2026-10-25-selection-handle-height-release.json)。

- [2026-10-24 后续消息发送连续过渡](plans/2026-10-24-followup-message-motion.md)：后续文字与附件连续交接、保留历史与页头及旧图片预览，12项不同功能UI和用户录像视觉验收通过，已随0.3.35双端发布；渠道回验见[发布计划](superpowers/plans/2026-10-24-followup-message-motion-release.md)与[公共凭证](superpowers/plans/evidence/2026-10-24-followup-message-motion-release.json)。

- [2026-10-23 新会话首条发送连续过渡](plans/2026-10-23-new-conversation-motion.md)：已随0.3.34双端发布；保留原生与状态层验证及视觉验收记录，渠道回验见[发布计划](superpowers/plans/2026-10-23-new-conversation-motion-release.md)和[公共凭证](superpowers/plans/evidence/2026-10-24-new-conversation-motion-release.json)。

- [2026-10-23 GPT-6-Luna标题总结仅网关部署](superpowers/plans/2026-10-23-title-luna-gateway-deploy.md)：固定模型、low与Fast的成功批次、安装模块双入口协议探测及客户端渠道不变回验；[公共凭证](superpowers/plans/evidence/2026-10-23-title-luna-gateway-deploy.json)。

- [2026-10-23 Bark自动命名等待仅网关部署](superpowers/plans/2026-10-23-bark-auto-title-gateway-deploy.md)：成功批次 `f0074198-f11b-4a27-a79f-8327d3dadf56` 及12项实际部署模块隔离时序回验；其0.3.31渠道结论为当次回验时点；[公共凭证](superpowers/plans/evidence/2026-10-23-bark-auto-title-gateway-deploy.json)。

- [2026-10-23 模型提问与紧凑窗口双端发布、配套网关部署](superpowers/plans/2026-10-23-model-question-release.md)：0.3.32两目标成功凭证、签名连续性、固定渠道及83项独立渠道回验；[公共凭证](superpowers/plans/evidence/2026-10-23-model-question-release.json)。

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

- [桌面桥接模型请求计量接入方案](superpowers/plans/2026-10-25-desktop-model-upload-design.md)：已完成协调部署与入口安装，待用户手动重启激活及实测回验。
- [上传计量网关部署计划](superpowers/plans/2026-10-25-model-upload-gateway-deploy.md)：成功批次 `ddc37232-fba9-4cd0-8dfa-88031bb4ae08` 已部署网关并安装桌面接入，待用户手动重启激活及实测回验；不发布客户端。[公共凭证](superpowers/plans/evidence/2026-10-25-model-upload-gateway-deploy.json)。
