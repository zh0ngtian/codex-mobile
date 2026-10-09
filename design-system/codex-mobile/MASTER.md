# Codex Mobile 视觉规范

本规范由 ui-ux-pro-max 主导视觉规则，Apple skills 校验原生 API 与平台行为。用户指定 ChatGPT 的对话方向，优先于数据库的通用配色、营销页结构和网页字体建议。

## 产品与取舍

- 产品：移动端 AI 编程对话工具；核心任务是阅读回复、输入、发送、查看执行过程。
- 风格：内容优先、极简、高对比、克制留白。检索命中 Minimalism & Swiss Style，采纳其阅读层次与低装饰原则。
- 不采纳检索器的 Product Demo + Features、彩色生产力配色、Google Fonts；这些不适配已有 ChatGPT 参考和 UIKit。
- 技术事实：SwiftUI/WKWebView 容器；核心对话为 UIKit，React 管理业务状态。SwiftUI 数据库只有系统动态字号原则适用，具体实现查 UIKit。

## 视觉参数

| 角色 | 规范 |
| --- | --- |
| 背景 | systemBackground；浅色白、深色黑，按系统语义解析 |
| 用户气泡 / 代码 / 输入 | secondarySystemBackground；短消息贴合文字、靠右 |
| 正文 | label；默认 17pt，UIFontMetrics .body，叠加 App 内字号设置 |
| 次级正文 / 状态 / 工具摘要 | 统一不透明次级色；浅色 white=0.36，深色 white=0.68；实际截图灰色表面对比为浅色 5.99:1、深色 7.58:1 |
| 标题 | 系统 semibold；按 headline/title 字体角色缩放 |
| 代码 | 系统等宽；按正文角色缩放，保留缩进与完整内容 |
| 图标 | SF Symbols；普通操作 18–20pt，辅助 chevron 12pt，发送 18pt semibold |
| 触控 | iOS 至少 44×44pt；控件之间至少 8pt；按压反馈不改几何 |
| 间距 | 4pt 基础格；8、12、16、20、24、32pt 按层级使用 |
| 阅读宽度 | 手机左右 20pt；大屏正文不超过 720pt，居中 |
| 输入区域 | 手机左右 12pt；大屏居中；空态与单行约 60pt，多行或辅助字号按内容增长 |
| 圆角 | 消息 20pt、代码 12pt、输入 28pt；不用随机阴影装饰 |

## 交互

- 顶栏只保留列表、Codex/设置、会话菜单；下拉用 SF chevron，不用文字字符模拟图标。
- 用户消息长按使用原生上下文菜单；复制、编辑等 VoiceOver 操作同时可用。回复保留轻量操作区。
- 附件与发送/停止保持固定 44pt；空输入折叠，真实多行与辅助字号展开，避免缩小字号或截断正文。
- 输入 label 与 placeholder 一致；禁用、处理中、失败提供语义与文字状态，保留草稿。
- 系统字号变化重新布局所有消息、输入与表格，不改变消息 ID 或用户阅读位置。
- 横向滚动只用于宽表格局部；页面不横向溢出。触控表格仍可选取文字与访问链接。
- 尊重 Reduce Motion；键盘与视图尺寸不加自定义几何动画。重要操作保留原生反馈。

## 原生与验收边界

Apple skills 中 UIKit 为一等实现方案；不为“原生”名称强行改写 SwiftUI。iOS HIG 的字号、触控与安全区作为事实约束，不决定视觉方向。

设备包保留 iPhone / iPad，当前声明竖屏。本轮按支持范围验收小屏、普通手机与平板；横屏不在本轮支持声明中。

验收必须保存实际默认字号、系统最大字号、浅色/深色、键盘展开及短消息截图。检查对比、按钮、焦点、内容长度与状态；模拟器验证不能代替真机覆盖安装。

## 来源

- [ui-ux-pro-max](/Users/zhongtian/.codex/skills/ui-ux-pro-max/SKILL.md)：Minimalism & Swiss Style；quick-reference 的 Dynamic Type、对比、4/8 间距、按压与 Reduce Motion；pro-rules 交付清单。
- [Apple Typography](https://developer.apple.com/design/human-interface-guidelines/typography)、[UIKit UIFont](https://developer.apple.com/documentation/uikit/uifont)：原生字形与系统字号实现。
- [ChatGPT 官方参考](https://apps.apple.com/us/app/chatgpt/id6448311069)：现有对话结构与黑白灰方向。
