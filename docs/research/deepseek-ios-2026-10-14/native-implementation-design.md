# Codex Mobile 原生界面实施基准

## 全图归一化与范围

已对照 README、inventory、resources 与 23 图联系表（`.mobile-build/native-reference/contact.png`）。来源均为完整手机截图，基准 `px / 2 = pt`，804×1748px → 402×874pt；系统状态栏及安全区包含。实际机型未知，不能把状态栏高度硬写进安全区。横屏/iPad由容器真实尺寸与系统安全区适配。S07属于系统设置；语音页面/音色/朗读仅用于排除对应入口，不移植。

| 图像 | measured像素 | 归一化 | 安全区 |
| --- | --- | --- | --- |
| `01-home.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `03-settings.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `04-appearance.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `05-settings-dark.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `06-font.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `07-language.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `08-personalization.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `09-voice-settings.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `11-data.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `14-search-no-result.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `16-attachment.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `17-file-source-menu.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `19-voice.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `22-response-complete.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `24-thinking-expanded.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `25-user-message-menu.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `27-share-selection.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `33-streaming.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `34-long-response-complete.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `35-long-response-bottom.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `36-assistant-menu.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `37-text-selection.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |
| `39-final-home.png` | 804 × 1748 px | 402 × 874 pt @2 | 系统状态栏、底部安全区均包含 |

## 布局与颜色

| 项目 | 值（pt） | 置信 |
| --- | --- | --- |
| 顶部菜单 | x16 y62 h44 w44，安全区内上方约8 | measured（AX） |
| 右侧胶囊 | 参考x298 y62 w88 h44；CM只留新对话 | measured / CM映射 |
| 抽屉 | 画布80%，主画布缩放.95并右移 | measured近似（记录） |
| 输入卡 | 左右12，空态最小高104，底部贴合系统安全区 | measured（卡位置），pass1移除额外8pt以对齐 |
| chips | h32 | measured |
| 设置 | 左右16，基础行50 | measured |
| 助手正文 | 左右24 | measured |
| 用户泡泡 | 左>=76，内部横16/竖10 | measured |
| 输入圆角 | 26，泡泡16，代码12 | inferred |
| 字体 | 顶栏14 semibold、用户14 semibold、助手14 medium、正文heading20 bold、状态14、输入14、空态18 semibold、代码12、chip12 | inferred（pass2截图迭代修正），动态字号relativeTo并结合应用fontScale |
| 阴影 | black opacity .06 / radius6 / y2 | inferred |

| 颜色 | HEX | 依据 |
| --- | --- | --- |
| 背景 | #ffffff | measured，参考首页中部 |
| 用户泡泡/选中chip | #edf3fe | measured，S22用户区域/S01 chip |
| 代码块 | #fafafa | measured，S22代码区域 |
| 设置背景/card | #f8f8f8 / #ffffff | measured，S03 |
| 深色设置/card | #1e1e1e / #292929 | measured，S05 |
| 强调蓝 | #4876f9 | inferred，避开压缩边缘后近似 |
| 文字/次级/描边 | 系统label/secondaryLabel/separator | CM适配，inferred |

颜色初采由本任务输入与图像中心区域核对，精确光学边缘、阴影与字号仍待主任务截图差分，不声称已达到像素验收。

## 文案、组件与数据流

DeepSeek空态品牌不复用，无鲸鱼、logo或语音入口。欢迎语映射为“你好，让我们开始吧”，模式chip映射为真实模型和推理强度；搜索映射为CM会话搜索；账号底栏映射为设置；导航保留设备、关注、项目、会话、草稿。截图的“深度思考”“智能搜索”不作为Codex产品开关。

正文保留原生AttributedString内联Markdown，标题/列表/围栏代码拆为原生组件；业务工具/差异/审批等由通用panel item提供。设置使用原生Form分组，语言/字体/设备/传输/通知/更新由共享业务提供panel，原生界面开关写UserDefaults，下次完整启动生效。动态字体、VoiceOver标签、ReduceMotion取消位移缩放动画；iOS18为最低系统。

每个scene的Swift宿主独立持有bridge/store，该窗口既有WebView仍执行业务且复用原WKWebsiteDataStore；桥只弱引用既有WebView。详见 `mobile/ios/NativeUI/BRIDGE.md`。不通过DOM寻找控件，不复制app-server协议。错误提供手动显示旧界面。离线launch参数使用真实原生组件，不连接后端，不创建测试会话。

## 验收顺序与边界

先新增NativeUIUITests及CI契约，已观察到“缺少真实SwiftUI根/桥/源码安装”的预期RED。之后实现、运行CI与Swift编译检查。主任务统一排队进行模拟器构建/启动/截图，对402×874pt基准做并排与透明叠图，优先纠正安全区、输入卡和字体差异。本子任务不占用模拟器/真机；未截图前不宣称视觉完成。

## 已完成的本地检查（Task 1）

- 新增契约首次运行3项预期失败（缺少原生根、桥、源码接入），之后转绿。
- `xcrun swiftc -typecheck -sdk iphonesimulator -target arm64-apple-ios18.0-simulator mobile/ios/NativeUI/*.swift` 通过；仅调用编译器，没有启动或占用模拟器。
- `npm test -- tests/ci`：9文件91项通过；包含真正编译/执行Swift store、Codable往返和Markdown解析的smoke，以及包含特殊字符路径的源码安装fixture。
- `npm run typecheck` 与 `ruby -c scripts/configure-ios-tests.rb` 通过。
- 模拟器完整App构建、原生UI测试、归一化截图与视觉差分尚由主任务执行，静态基准不等于视觉验收完成。

## 首轮截图布局差分与修正

主任务已实际构建App并完成首轮3项NativeUIUITests。归一化并排图位于 `.mobile-build/native-reference/conversation-side-by-side-pass1.png`。本轮只修以下三项布局，未调整字号/圆角/颜色：

1. 短会话用户泡泡起点y333，而参考S22为y148。单独设置初始滚动偏移到底部、内容不足时顶部对齐；新增UI断言要求首条用户消息位于顶栏下100pt内，首轮截图对应明确失败。
2. 顶栏按钮y70而参考y62，移除额外顶部8pt。
3. 输入卡y728/底832而参考y736/底840，移除额外底部8pt，保留系统安全区。

离线conversation fixture改用S22公开树相同标题、用户消息和助手Markdown，以便下一轮比较排版。修正后仍需主任务的新鲜截图和4项UI验收，不以类型检查替代视觉结果。

## 原生验收与质量修复复核

主任务已实际执行新增位置断言的RED：首条用户文本minY=343，期望小于顶栏maxY+100=214.25，失败结果为 `test_sim_2026-10-14T10-35-30-766Z_pid23807_92176acf.xcresult`。更新后4项NativeUIUITests均GREEN；第二轮并排图为 `.mobile-build/native-reference/conversation-side-by-side-pass2.png`。目前只确认三处大布局问题已修正，字号和其他排版差异仍待下一轮。

质量审查后，真实Swift smoke分别先复现“同进程新窗口提前应用偏好”和“权威快照无法清除旧字段覆盖值”，再转GREEN。修复为scene独立桥/状态与进程只读启动模式；字段缓存以panel/message及item组合为作用域，有效完整快照清理本地覆盖，关闭面板清理对应作用域（含secure值）。测试覆盖业务校正、多选、换面板、关闭重开及同id字段隔离。异步编辑回执协调仍由后续共享业务桥处理。

## Typography pass3

第二轮相同S22文案中，原生用户正文5行，参考约4行；首个中文字墨迹高度约14pt，参考约11.5pt。由此将初始16pt正文推断修正为14pt，并分别使用用户semibold、助手medium；正文heading约16pt bold，状态14pt，顶栏14pt semibold，输入14pt，空态18pt semibold，代码12pt。

用户正文参考TextView高83pt/约4行、基线约21pt；14pt系统默认行高约17pt，因此用户和Markdown正文增加5pt lineSpacing（inferred），块间spacing不变。

本轮仅修改字体、字重、正文leading及代码字号的fontScale传递。所有字号继续使用ScaledMetric跟随系统动态字体；代码复制保留44pt触控范围。没有调整组件间距、颜色或圆角；参考泡泡y148与当前y128的20pt差异留给独立layout pass4。新鲜截图仍由主任务统一构建和采集。

## 排版节奏 pass4

第三轮正文已接近参考并同为4行；仍可测得内容起点y128/参考y148，标题墨迹约13pt/参考17pt，以及助手块间节奏偏紧。按本轮单独修正：滚动内容顶部12→32pt，H2调整为20pt bold（仍动态缩放），用户泡泡右侧24→21pt、左侧保持>=76pt。

引入明确的Markdown block kind和共享NativeTextRhythm：状态到正文20pt；heading到后续块26pt；连续列表项20pt；列表到代码12pt；代码到后段22pt；其他默认12pt。spacingBefore由前后block kind推导，首块为0，不用负padding。所有节奏值均为inferred，颜色、圆角和其他控件不变。

参考/原生pass3黑色文字y坐标分别为heading317/288、list1 365/318、list2 402/347、code490/433、result537/472。本轮由主任务继续截图pass4并执行4项UI验收；不为小图标差异延后业务接线。
