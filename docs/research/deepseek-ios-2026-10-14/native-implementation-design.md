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
| 输入卡 | 左右12，空态最小高104，底部距系统安全区8 | measured（卡位置）/ inferred（额外8） |
| chips | h32 | measured |
| 设置 | 左右16，基础行50 | measured |
| 助手正文 | 左右24 | measured |
| 用户泡泡 | 左>=76，内部横16/竖10 | measured |
| 输入圆角 | 26，泡泡16，代码12 | inferred |
| 字体 | 标题17 semibold、正文16、chip12、次级13 | inferred，动态字号relativeTo |
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

Swift宿主持有一个store，旧WebView仍执行业务且复用原WKWebsiteDataStore；桥只弱引用既有WebView。详见 `mobile/ios/NativeUI/BRIDGE.md`。不通过DOM寻找控件，不复制app-server协议。错误提供手动显示旧界面。离线launch参数使用真实原生组件，不连接后端，不创建测试会话。

## 验收顺序与边界

先新增NativeUIUITests及CI契约，已观察到“缺少真实SwiftUI根/桥/源码安装”的预期RED。之后实现、运行CI与Swift编译检查。主任务统一排队进行模拟器构建/启动/截图，对402×874pt基准做并排与透明叠图，优先纠正安全区、输入卡和字体差异。本子任务不占用模拟器/真机；未截图前不宣称视觉完成。

## 已完成的本地检查（Task 1）

- 新增契约首次运行3项预期失败（缺少原生根、桥、源码接入），之后转绿。
- `xcrun swiftc -typecheck -sdk iphonesimulator -target arm64-apple-ios18.0-simulator mobile/ios/NativeUI/*.swift` 通过；仅调用编译器，没有启动或占用模拟器。
- `npm test -- tests/ci`：9文件88项通过；包含真正编译/执行Swift store、Codable往返和Markdown解析的smoke，以及包含特殊字符路径的源码安装fixture。
- `npm run typecheck` 与 `ruby -c scripts/configure-ios-tests.rb` 通过。
- 模拟器完整App构建、原生UI测试、归一化截图与视觉差分尚由主任务执行，静态基准不等于视觉验收完成。
