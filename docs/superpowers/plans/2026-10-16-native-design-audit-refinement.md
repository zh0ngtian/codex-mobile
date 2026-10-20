# 原生界面逐屏复核与项目折叠修正

> **For agentic workers:** 按 Superpowers TDD 与独立问题域分工执行；主代理负责截图、整合及 OTA，规格和质量分别复核。

**Goal:** 修复展开图标、折叠后加载更多及灰色样式，并对最新网页设计逐屏纠正可见差异。

**Architecture:** 保留 NativeSnapshot/原业务命令和原生控件。以本轮重新采集的网页与模拟器截图为依据；设备/通知仅重排现有字段和动作，不变更授权、持久化或默认界面。继续本对话已授权的 OTA-only 发布。

**Tech Stack:** SwiftUI、现有 TS 投影、Swift smoke、Vitest、XCTest、既有本机 Ad Hoc/OTA 及共享发布租约。

## 一、项目组（独立问题域）

文件：`src/native-ui/projection.ts`、`tests/ui/native-ui-projection.test.ts`、`NativeNavigationGroupView.swift`、项目底部动作组件。

- [x] 先测试“折叠且hasMore/error”无底部动作，展开恢复正确动作；加载中禁用重复加载，验证红灯。
- [x] 生产投影按collapsed隐藏内部状态与actions；SwiftUI也以项目collapsed守卫整个子内容。
- [x] 收起/展开使用不同系统文件夹图标并提供无障碍状态；分页/重试采用灰色14pt、与子项同缩进、44pt触区。
- [x] 真正点击展开→加载更多→折叠→再展开，验证动作可达性与状态。

## 二、设置（独立问题域）

文件：`NativeSettingsView.swift`、`NativeSettingsPanelDestination.swift`、设置子页组件，必要的只读展示元数据。

- [x] 采集当前设备/表单/通知页，和本轮source截图比较后实施。
- [x] 对齐根设置标题、分组/脚注间距；设备以白卡、状态、编辑和底部动作排列；表单保留SecureField/扫码/测试保存；通知使用原生单选行、说明、Bark安全字段和保存按钮。
- [x] 保留真实错误、测试中禁用、确认流程、作用域字段缓存和版本检查；不重造设置拥有者。
- [x] 通过实际回调/错误边界测试以及UI导航复拍。

## 三、对话与输入

文件：模型面板/选项组、输入及附件面板、相关UI测试。

- [x] 重新核对文字行距、模型行间距、输入两态、附件与菜单；只改实际发现的偏差。
- [x] 附件入口使用原生sheet，保留照片/文件/Skill/位置真实动作；关闭后再打开系统选择器，草稿和上下文安全保留。
- [x] 以同状态新截图复核，包括项目折叠/展开、加载更多、设置子页和附件；更新独立审查记录，所有P0/P1/P2需修完。

## 四、交付

- [x] 相关回归、Swift编译与关键UI通过；提交并推送本次代码。
- [x] 在既有排他租约下沿用本机 OTA-only 流程，版本高于所有固定渠道；不触发GitHub Release、APK或软件源更新。
- [x] 回验签名身份、HTTPS OTA及固定IPA清单/HEAD/完整GET/散列，保存验收凭证。测试使用离线资料，不创建真实任务；模拟器用后关闭。

## 实际验收

- 代码提交：`e568d72a41a9de0aa3cd2209a547456bf207cd62`，已推送 `codex/native-preview-alignment-20261016`。
- TypeScript、45项投影/设置/Swift smoke通过；四种UI流程分别覆盖项目折叠/分页、设备/通知导航、附件草稿恢复和七屏视觉对照。
- 新截图与归一化比较：`.mobile-build/design-audit-20261016/`；长期副本位于 `/Users/zhongtian/.codex/visualizations/2026/10/16/01a1433c-545b-78c0-9522-eb1bcb3cf80d/native-design-audit/`。本轮已修正旧报告过宽的验收结论，详见 `design-qa.md`。
- OTA `0.2.180` / `2180` 已签名，4,841,462字节，SHA-256 `119595bcaed4ebe0d06f73e33bec45d07f7453fb0113dd07e4da55aa3c420af4`。使用现有发布数据库和排他租约；发布完成后已释放租约。
- [固定OTA安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)，[固定IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)。HTTPS渠道检查和固定IPA独立HEAD/完整GET均通过。
- GitHub最新Release与固定APK仍为0.2.178，没有更新软件源；之后正式批次须纳入本次源码，当前未推进main。
- 测试仅用离线fixture，未创建远端会话；专用模拟器已关闭。未声称完成真机覆盖安装和数据保留验收。
- [公开验收凭证](evidence/2026-10-16-native-design-audit-ota-release.json)。
