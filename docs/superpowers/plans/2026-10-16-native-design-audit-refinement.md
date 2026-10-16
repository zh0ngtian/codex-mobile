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

- [ ] 相关回归、Swift编译与关键UI通过；提交并推送本次代码。
- [ ] 在既有排他租约下沿用本机 OTA-only 流程，版本高于所有固定渠道；不触发GitHub Release、APK或软件源更新。
- [ ] 回验签名身份、HTTPS OTA及固定IPA清单/HEAD/完整GET/散列，保存验收凭证。测试使用离线资料，不创建真实任务；模拟器用后关闭。
