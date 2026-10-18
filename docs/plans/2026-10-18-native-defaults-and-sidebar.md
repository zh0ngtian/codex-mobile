# 原生默认设置、设备数量与侧栏调整计划

目标：按用户五项要求修改现有界面与业务入口，仅安装 iPhone 17 Pro 模拟器验收，不推进 main、不发布、不安装真机。复用当前独立工作区。

确认范围：设备保存、恢复和原生表单都不限制数量；iOS 未保存偏好时默认原生界面、黑色强调色，保留用户已明确保存的选择；完成过程入口使用“用时xxx”，缺少可靠用时按用户确认显示“执行过程”，保留展开能力；回复末尾只保留时间。搜索、省略号与 Chat 按钮同高；用量图标固定黑色并使用中性可辨底色，强调色操作按钮明确设置可辨前景。

- [x] 先修改设备配置保存/恢复、原生启动与强调色默认值的回归，确认修改前失败。
- [x] 移除 src/backends/registry.ts 的保存限制和恢复截断，移除设备管理、设置与连接表单中的八台限制及文案；重复地址、设备身份和访问测试保持。
- [x] 修改 NativeUIPreference.enabled 的缺省读取及 AppPreferences.accent 缺省值；验证显式选择与保存失败回滚仍生效。
- [x] 在 CommentaryHistoryView 使用真实 message.duration，缺失时“执行过程”；没有 commentary 时有可靠耗时仅展示文字；MessageActions 不再重复耗时。
- [x] 用共享内容高度对齐侧栏 Chat、搜索和省略号；统一 NativeUsageIcon 黑色和中性底色，修正强调色提交按钮前景。
- [x] 在 iPhone 17 Pro 验证有/无用时、过程展开、超过八台仍可添加、侧栏等高、全部强调色可辨、原有发送停止与历史滚动。
- [x] 更新 README 与交互约定的现行规则及验证记录，提交并推送本次变更，模拟器正常启动留待用户验收。

验证命令：`NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/backend-registry.test.ts tests/ci/ios-native-ui.test.ts tests/ci/agent-ui-presentation.test.ts tests/ci/agent-session.test.ts tests/ui/native-ui-projection.test.ts`，以及 `npm run typecheck`。界面使用当前 CodexMobileUITests scheme 的范围内用例。SDK 保留现有兼容的 ViewBuilder。

验证进展：24台设备新增与存储恢复回归通过；121项代码回归、typecheck、5项针对性界面及原有发送/停止、历史阅读、按钮定位通过。十种强调色分别在Show Borders开启与关闭下检查通过，系统设置恢复开启。审查发现的pending-steer状态误作耗时已用失败回归复现并修复，修复后3项界面检查通过；显式final零秒和缺省phase也有回归。最终内嵌页面及整 App 重建、覆盖安装、正常启动和真实网关连接通过；黑色验收设置通过实际按钮填充像素核对，保留原生界面开启。未创建真实业务测试会话。源代码提交/推送按本轮Git记录核对。
