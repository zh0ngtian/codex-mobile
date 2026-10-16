# 原生 iOS 对齐网页设计稿：视觉验收

final result: passed

## 视觉真值与截图条件

- 来源：用户给定的 `codex-mobile-preview/src/Prototype.tsx` 与 `src/prototype.css` 最新文件，已通过内置浏览器打开对话、聚焦输入、模型、权限、侧栏与设置。
- 参考截图：相邻 `codex-mobile-preview-evidence` 中 `model-button-left/model-button-screen.png`、`project-icons-removed/sidebar-screen.png`、`quota-rows/quota-rows-screen.png`、`header-menu-refinement/{model-list,settings}-screen.png`、`iteration-2/permission-final-screen.png`。
- 本轮实际渲染：专用 iPhone 17 Pro / iOS 27 模拟器，402×874pt、1206×2622px；XCTest 截图附件位于 `.mobile-build/preview-ui-final-delivery.xcresult`（最终成功流程），导出到 `.mobile-build/preview-qa/delivery-attachments/`。
- 参考截图为393×852px，按同尺寸归一原生截图（3倍像素先缩小至逻辑画布，再统一画布）；系统状态栏、键盘、home indicator及iOS27浮动sheet外壳不比较像素一致。对话内容相同，项目与设备名称为脱敏演示值；选择值、版本及台数保留真实fixture投影，不能为贴图改产品状态。
- 同图证据：`.mobile-build/preview-qa/{conversation,usage,focused,model,permission,sidebar,settings}-comparison.png`，均已实际打开比较。权限仅比较对应面板区域（参考底下为另一技术会话）；聚焦仅比较头部和输入区域（原生保留滚到最新消息的既有行为）。

## 第一轮发现及修正

- P1：上下文环的透明中心不能稳定点中。UI用例真实tap失败，44pt标签补完整contentShape后复验。
- P2：用量面板标签/数字颜色层级反转、背景透出气泡、圆环22pt小于28pt参考。已改灰标签、黑色加粗数字、不透明背景、224pt宽与28pt环，已由最终成功流程复拍确认。
- P2：模型面板默认Form将全部文字染成强调色，完成按钮颜色错误，默认字号/间距使最后一项下沉；标题与关闭按钮方位偏离参考。已改为原生滚动分组卡，14pt文字/50pt行、左标题/右关闭、仅勾选强调；以系统label颜色明确完成按钮黑白底色，常规六项均可见。
- P2：权限面板默认字号、标题和高度明显大于参考；已改13/11pt标题副说明、13/11pt选项与77pt行，底部面板按普通/辅助字号适配。
- 设备确认返回设置丢失偏好、子页标题不准确，以及附件选择桥被局部同名变量遮蔽，已分别补红绿回归并修复；它们属于功能验收，不以截图通过替代。

## 五类视觉表面

- 字体：沿用系统字体与SF符号；正文/侧栏总体节奏接近。模型与权限已校准至参考的14pt、13/11pt层级，并使用动态字号。
- 间距：对话、侧栏分组、输入两态和设置白卡结构符合参考；模型/权限已复拍，全部选项和关闭/完成可见。
- 色彩：保留粉色气泡、强调色、灰底白卡；用量层级及模型完成按钮已复拍确认；高风险选项继续用原生橙色与文字说明。
- 图像：本设计无新增位图资产；使用原生系统图标，不使用网页控件、假键盘、截图背景或新图标依赖。
- 文案：沿用真实模型、设备、版本、权限描述及额度数据；缺少额度不伪造百分比。辅助功能提示保留7天额度语义。

## 已验证交互与边界

- 原生配置、模型/强度选择、权限、草稿与键盘恢复、设置菜单和设备往返、项目与最近入口、忙碌发送/独立停止：既有5项关键UI通过。
- 最大辅助字号、竖屏、忙碌中带草稿：发送和停止可点击且左右边界均在屏幕内，通过。
- 中文截图流程成功到达模型/权限/侧栏/设置；圆环补完整44pt触区后，最终整条中文流程真实tap复验通过。
- 未创建真实远端测试会话；不需要归档远端数据。未进行真机覆盖安装、数据保留或VoiceOver实机验收。

## 最终复拍与接受结论

- 复拍：`preview-ui-final-delivery.xcresult`，中文截图流程1项通过、0失败，实际依次操作用量→关闭→输入草稿→模型→完成→权限→关闭→侧栏→设置。配置/焦点恢复用例在 `preview-ui-verified.xcresult` 通过；上下文独立用例与最大辅助字号忙碌竖屏用例分别通过。
- 永久截图与同图比较：`/Users/zhongtian/.codex/visualizations/2026/10/16/01a1433c-545b-78c0-9522-eb1bcb3cf80d/native-preview-alignment/` 下 `*-final.png`、`*-comparison-final.png` 与 `*-detail-comparison.png`。实际打开最终模型、权限、用量、设置、输入及侧栏，且打开局部细节后才接受。
- 迭代历史：用量层级/背景/尺寸修正；模型默认Form的颜色/密度/标题方位修正；权限字号和高度修正；Circle中心命中区域修正；最后将完成按钮背景由依赖层级的primary改为确定系统label颜色，再次复拍黑底白字。最初错误证据保留为 `usage-before-comparison.png` 与 `before-model-comparison.png`，后续证据为最终同图。权限旧版本比较左侧最初误用了更早设计，最终已纠正为 `iteration-2/permission-final-screen.png`，该旧左图不用于结论。
- 无剩余P0/P1/P2。P3/有意差异：iOS27原生浮动sheet与popover圆角、底部安全区和系统键盘布局；模型选项/选中值、版本、台数和日期来自真实状态或脱敏fixture；系统图标保留SF Symbols。正文存在原生排版的细小行距差异，不影响结构、密度与阅读。
- 最终检查清单：字体与层级、留白和分组、色彩/选中/禁用、图标清晰度、真实文案与无假数据、关键操作与最大辅助字号已复核。
