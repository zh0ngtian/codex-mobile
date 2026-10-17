# 原生界面九项验收调整实施计划

> 沿用当前隔离 worktree，在当前会话逐项执行并自查；不另开并行代码任务。

**Goal:** 完成用户确认的九项界面修订，延续仅本地验收、不发布渠道的交付范围。

**Architecture:** 真实业务投影负责结构化任务耗时；用量格式化保留真实七天刷新时刻，展示倒计时。SwiftUI 保留系统字号和粗体环境，UIKit 正文显式解析对应字体；只在展示期间监听面板外点击。通过应用 Info.plist 和被动 UIUpdateLink 支持 ProMotion，不制造常驻刷新循环。

**Tech Stack:** SwiftUI、UIKit、Foundation、XCUITest、Vitest、现有签名与 devicectl。

- [x] 在 usage-refresh smoke 中先验证 111 小时剩余为 `4d15h (66%)`，覆盖七天上限、过期、缺失及无效数值；在投影测试中验证 3723000ms 为 `用时 1 小时 2 分钟 3 秒`，先运行确认旧实现失败。
- [x] 在 UI 回归中先加入用户时间默认隐藏、点击显示气泡外右下角、再次隐藏断言，运行确认旧实现失败。
- [x] 修改 UsageFormatting 与两处用量卡片，按真实剩余秒数 / 604800 计算百分比，每分钟更新，继续只用七天窗口。
- [x] ConversationHeader 三个按钮统一44pt点击区域和20pt图标画布；没有会话用量时只显示灰色底环，不画最小进度。
- [x] UserMessageView 时间独立于气泡背景默认隐藏，通过单击切换外侧右对齐时间；保留长按复制、附件及展开宽度。粉色主题正文使用参考深粉色、背景使用取样浅粉色，其他主题继续有效。
- [x] 任务耗时按真实毫秒拆分为小时、分钟、秒，三项均显示；不把其他业务状态解析成耗时。
- [x] NativeSelectableText 同步 Dynamic Type 和 legibilityWeight，保留 Markdown 标题、强体和等宽代码语义；通过实际 UIKit 字体属性与代表性字号/粗体 UI 验证。
- [x] 为模型选择页和思考强度卡片增加不吞掉原触摸事件的外侧单击关闭；不影响选择模型和列表滚动。
- [x] 在 iOS 构建配置启用 CADisableMinimumFrameDurationOnPhone；应用窗口使用非连续 UIUpdateLink 表达最高120Hz偏好，后台停用，实际刷新率由系统调度。
- [x] 同步交互约定；完成格式化、投影、构建契约和 iPhone17Pro 正常竖屏 UI 回归，确认新包中 ProMotion 开关为true。
- [ ] 提交推送，沿用已授权的主分支整合与真机本地覆盖安装；保留原签名身份，不发布 APK、固定IPA或OTA，按用户选择不做自动真机界面检查。
