# iOS 原生边栏规范

继承 MASTER.md，ui-ux-pro-max 负责视觉与搜索反馈，UIKit 负责原生行为。

- 黑白灰、系统背景、17pt 会话标题、系统动态字号；来源/时间使用已验证的不透明次级色。正文两行，搜索摘要两行，大字号不挤压文字。辅助字号收起品牌标题和设备统计，优先保留列表空间；搜索聚焦时收起设备选择等次级控件。
- 手机抽屉留出可关闭的 44pt 区域；平板限宽 420pt；安全区内顶部导航、UISearchTextField 搜索和新聊天清晰分层，列表原生滚动。
- 设备选择使用原生 menu；显示连接、加载与待审批数量。项目标题为至少44pt按钮，可折叠，搜索时展开；分页失败保留重试。
- 刷新、正在搜索与错误提供文字状态；无搜索结果给出“试试会话名称或内容”的提示，避免空白死路。
- UIKit 上下文菜单与 VoiceOver custom actions 保留全部会话管理能力；滚动与搜索不选择文字或误开会话。
- 默认不为数据刷新加几何动画；保留当前位置；关闭清空搜索并收起键盘；重新打开不丢对话草稿。

检索：`search.py 'mobile search feedback' --domain ux` 顶项命中 haptic，与搜索目标不吻合；收窄为 `search no results` 后命中 Search/No Results 与 Autocomplete，采用空态建议和输入后及时更新。Web 示例代码不用于 UIKit；API 使用 Apple UIKit skill。
