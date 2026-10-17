# 参考 DailyMusuem 的系统控件更新设计

状态：只读对照已完成，导航结构范围待用户确认；尚未修改运行代码。

## 已核对的依据

- `/Users/zhongtian/WorkSpace/DailyMusuem/DailyMuseum/Views/MuseumListView.swift`：系统 `ToolbarItemGroup(.topBarTrailing)`、`NavigationLink`、`List`。
- `/Users/zhongtian/WorkSpace/DailyMusuem/DailyMuseum/Views/ArtworkDetailView.swift`：页面工具栏直接使用 `Button`、`Link`、`Menu`，不自行绘制工具栏背景。
- `/Users/zhongtian/WorkSpace/DailyMusuem/DailyMuseum/Views/SettingsView.swift`：`Form`、`Section`、`Picker`、`LabeledContent`，按系统行为呈现设置及选择弹层。
- 本项目的 `GlassIconButton`、`ConversationHeader`、`ComposerBar` 仍使用 `regularMaterial`、手工边框与自定义按钮背景；`SettingsScreen` 使用 ScrollView 和自定义设置行。两个项目最低 iOS 版本均为18，主要差异来自控件实现。
- Apple《Adopting Liquid Glass》建议优先采用标准导航、工具栏和按钮样式，避免自定义背景遮盖系统外观：https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass

## 建议实现范围

1. 对话与新对话页使用系统导航栏，侧栏入口放在 leading，额度/新建/更多放在 trailing toolbar；由系统提供按钮背景、分组、按压反馈、滚动边缘效果及尺寸布局。标题与副标题仍承载原有会话、项目和设备信息。
2. 输入区保留悬浮布局和真实输入/附件逻辑，动作按钮使用系统样式；需定制的输入容器使用原生 Liquid Glass API，去掉叠加的假玻璃描边和阴影。
3. 设置、设备、语言、传输与通知配置改用 Form/Section、Picker/Toggle/TextField/LabeledContent；保存、取消、错误和只读语义继续接现有命令。
4. 模型列表和权限选择使用系统列表/选择控件；思考强度使用离散步进的系统 Slider，保留真实档位、速度切换、重置及面板外点击关闭。
5. 预览、附件与回到底部等动作采用系统按钮和工具栏；内容卡片保持内容层视觉，不将全部内容都套上玻璃。

## 继续保留的已确认行为

- 粉色气泡参考色、默认隐藏并单击切换的外侧时间、Markdown/文字选择、commentary 与分隔线。
- 4/5侧栏、项目原有顺序、未读/运行标记、二次下拉加载及阅读位置、回到底部行为。
- 三个页头操作、用量计算口径、系统字体/粗体、ProMotion 支持及真实业务桥。
- 最低系统支持不变；优先使用跨版本系统控件，新材料仅在系统支持时采用。
- 不修改 DailyMusuem，不改变现有网关或业务协议。

## 待确认的产品选择

- 推荐：使用系统导航栏，让系统重新安排标题与右侧操作。这会替换当前手工页头布局。
- 可选：保留当前左对齐标题和页头布局，升级其余控件及页头按钮样式；导航栏排布保持现状。

## 实现后的验收与交付

- iPhone 17 Pro正常字号、竖屏验证导航、侧栏、输入/键盘、模型/权限、设置保存和预览；复核上一轮确认的消息与滚动行为。
- 完成当前改动相关数据回归、类型检查、模拟器截图与交互验收，再按用户确认继续主分支整合及本地真机安装。
- 延续不发布固定渠道与用户自行打开真机验收的约定。
