# 原生对话、边栏及输入栏视觉验收

final result: passed

已完成八轮静态比较、局部放大、原生交互及真实对话只读验收。下列历史P1/P2均已处理；此报告通过表示本地设计与交互验收通过，安装包发布另以协调器成功凭证为准。

## 对照来源与归一

- 主来源：`.mobile-build/native-visual-refresh/reference/03-conversation-latest.png`；聚焦态`04-composer-focused-latest.png`；边栏`01-sidebar.png`。均为本聊天附件，私有原图不提交。
- 来源PNG：942×2048，含Display P3 ICC；原附件1206×2622。实现：iPhone 16 Pro模拟器，402×874pt、1206×2622px、@3。原生画布不涉及CSS viewport。
- 两侧先按ICC转换到sRGB，再统一到804×1748px（402×874pt、@2），并排比较图另加32px标签区；没有将分别查看的图片冒充并排比较。
- 三个离线状态分别由`--native-ui-reference-visual`、附加`--native-ui-reference-visual-sidebar`、附加`--native-ui-reference-visual-focused`启动。项目与设备采用演示值，其余正文用于同内容排版校准。
- 状态栏、home indicator和键盘由系统提供；来源聚焦图使用第三方九宫格，实现为模拟器系统拼音QWERTY键盘。键盘高度和系统图标差异属于预期，只比较App卡片相对键盘的布局；品牌保留Codex Mobile。图中语音、点赞/点踩、Sidechat操作不作为CM功能添加。

## 第一轮证据

构建：XcodeBuildMCP `build_run_sim_2026-10-14T18-52-42-432Z_pid23807_a3e400ca.log`成功。截图已实际打开并共同比较：

| 状态 | 实现截图 | 同输入并排与叠图 |
| --- | --- | --- |
| 对话 | `.mobile-build/native-visual-refresh/round1/conversation.png` | `round1/conversation-compare.png`及`conversation-compare-overlay.png` |
| 边栏 | `.mobile-build/native-visual-refresh/round1/sidebar.png` | `round1/sidebar-compare.png`及`sidebar-compare-overlay.png` |
| 聚焦 | `.mobile-build/native-visual-refresh/round1/focused.png` | `round1/focused-compare.png`及`focused-compare-overlay.png` |

上表简写路径均在`.mobile-build/native-visual-refresh/`下。后续须增加放大区域比较，不能只用全图通过验收。

## 第一轮 Findings（均已解决）

1. **[P1] 边栏首屏密度偏低。** 来源首个置顶文字约y165pt、Projects标题364/首行408、子项622/666、Recents731；实现分别约178、391/451、673/717、784。标题44pt布局与外部间距叠加，使最近分组进入输入栏遮挡区。修正：压缩静态标题和分组前后留白，保留置顶49pt、项目约42–44pt、子项44pt节奏。
2. **[P2] 正文后半段过密，列表缩进与符号偏小。** 来源列表文字x40pt，实现约36pt；段后统一12pt使末段与文件名提前约30–40pt。修正：固定marker列16pt加8pt间隙，校准符号尺寸；区分连续列表、正文进列表、列表后正文与普通段落间距。同内容fixture首句多出“天”，须先校正。
3. **[P2] 标题副标题截断设备名。** 来源优先截断项目、保留设备；实现将整行统一截断至设备末尾。修正：项目和设备分段布局，明确压缩优先级，保留全名的无障碍信息。
4. **[P2] 展开项目缺少文件夹图标。** 当前使用的`folder.open`未实际显示，展开行文本退到左边界。修正：使用实际存在的系统符号并维持统一图标列。
5. **[P2] 浮动材质与页面底部衔接不够接近。** 当前控件偏灰，输入栏背景上方有明显水平切边；聚焦时滚动内容被头部硬裁切，来源为内容从原生模糊材质下经过。修正：在下一轮校准材质与页面承载关系，消除实色底板切边并验证头部滚动覆盖。

本轮只先执行1–3，重新截图后再处理其余项，避免同一轮同时改变排版、色彩与材质。

## 后续比较记录

- **第二轮**：`round2/conversation-compare.png`、`sidebar-compare.png`及`body-detail.png`已打开比较。修正分组标题空白、副标题压缩优先级、列表16pt标记列与8pt间隙；继续校准字号和列表符号基线。
- **第三轮**：`round3/`三态全图及局部对照。正文14.5pt、用户14pt；单行气泡13×12pt内边距、22pt圆角；列表符号独立视觉尺寸并固定布局高度；分组密度与项目图标已修正。原findings 1–4已解决，字体细微抗锯齿/日期格式属于P3。
- **第四轮**：`round4/`三态对照，正常页面与聚焦页面分别按键盘可用区域调整连续底部渐变，侧栏保持白底，消除硬色块衔接。输入框仍与系统键盘保持12pt间距。原finding 5只剩顶部真实模糊P2。
- **第五、六轮**：`round5/focused-compare.png`、`round6/focused-compare.png`已打开比较，顶部仍呈平灰，不能通过验收。未以构建成功或材质API替代视觉结果。
- **模糊定因**：已通过LLDB只读属性确认所有祖先alpha/opacity为1、无raster/mask、系统透明度设置正常。运行时隔离检查证明真实正文位于顶部下方，重建已布局后的公开UIVisualEffectView animator即可获得参考中的真实模糊；恢复系统topEdge默认值仍正常。`round6/focused-restartanimator.png`和`focused-restarted-edge-default.png`仅为诊断截图，不能作为最终实现通过证据。生产修正应延后到非零布局后的主队列初始化，并取消失效任务，保留原滚动结构。

## 最终源代码证据

- 第七轮重新构建后，`round7/conversation-compare.png`、`sidebar-compare.png`与`focused-compare.png`已实际打开并排查看。顶部开始真实采样滚动正文。
- 第八轮在实际呈现两帧后用公开API结束模糊animator，保留当前效果，消除XCTest每步等待60秒的问题。`round8/focused-compare.png`、`composer-detail.png`、`body-detail.png`和补充底部渐变后的`sidebar-compare.png`均已实际打开查看。局部对照明确区分键盘高度差异与App输入卡相对位置。
- 干净工程准备后构建成功：`build_run_sim_2026-10-15T01-54-43-429Z_pid23807_fa65834e.log`；最终表格修正构建：`build_run_sim_2026-10-15T03-04-17-008Z_pid23807_0e746d8f.log`。不是用LLDB临时诊断画面判通过。
- 9项明确offline原生场景通过：新建提问、附件、项目/最近新建、箭头、参数值、设置与切换入口、排队/停止、大字横屏及隐藏旧输入门控。主体8项的最终通过记录为`test_sim_2026-10-15T02-32-20-597Z_pid23807_080b5f6d.log`；最后一项为`test_sim_2026-10-15T02-53-38-113Z_pid23807_133254c5.log`。
- 最后一项断言由错误的`isHittable`改为字段禁用且键盘未出现：诊断显示被覆盖的UIKit字段`enabled=false`却`hittable=true`，后者不代表可编辑。生产额外明确了实际安全区根的AX隐藏、命中禁用和字段禁用。没有删除旧上下文保护或放宽业务门控。
- 真实网关只读查看3段已有会话：长文/文件引用、表格/图片、技术说明/代码。证据为`live/01-prose.png`、`02-table-media.png`、`03-technical.png`。发现长表格截断后修为限定列宽完整换行，`05-table-wrapping-final.png`与`06-table-horizontal.png`确认无省略号、无行重叠并可横向读取。未发送、创建、修改或归档用户会话。
- 深色：`adaptive/dark-conversation.png`及`dark-sidebar.png`；iPad：`adaptive/ipad-conversation.png`及`ipad-sidebar.png`，实际打开确认基本布局。大字横屏的旋转后发送按钮等待布局就绪，草稿完整且持续可编辑，XCTest通过。
- 新建ACK/权威context纯Swift状态机覆盖任意到达顺序、UUID、目标、取消、错误、只读、重复与一次消费；规格、质量及后续局部修正独立复审均通过。

上述路径除构建/测试日志外均相对`.mobile-build/native-visual-refresh/`；日志在XcodeBuildMCP工作区logs中。原图、真实会话及生成截图不提交。

## 必须核对的五个表面

- 字体与排版：同内容正文14.5pt、strong粗体、行内代码、链接、列表16pt标记列/8pt间隙；段落与列表节奏已局部比较。长表格内容完整换行。
- 间距与布局：44pt头部按钮、合并操作胶囊、全宽侧栏、49pt置顶/44pt项目行，以及48pt收起/98pt展开输入卡已对照；项目与新建为相邻独立命中区域。
- 颜色与tokens：Display P3先转换至sRGB，粉色气泡/深粉文字/强调色使用测量值；正常/聚焦背景与底部连续渐变、真实模糊均由实际截图确认。
- 图像与图标：原生系统符号与形状，无位图模拟控件。展开文件夹图标已显示，真实图片可见；系统键盘及状态栏保持系统提供。
- 文案与内容：CM品牌、实际设备/项目/配置语义及动态本地化保留；不添加截图中的语音、点赞/点踩或Sidechat。新增两个英文key漏配已由全量测试发现并补齐。

非阻塞P3：系统字形/时间格式与参考存在细微差异；复制glyph的可见布局仍为28×36pt，扩大命中区可后续改善；长表格按列横滚，短单元格下的分隔线随自身内容高度，仍有美化空间。没有剩余可执行P0/P1/P2。

## Implementation Checklist

- [x] 第一轮三项修正完成并重新构建捕获。
- [x] 补足放大区域与第二轮比较，清除其余P0/P1/P2。
- [x] 完成新会话ACK/权威上下文后的聚焦/附件行为及纯Swift回归。
- [x] 明确offline/reference原生交互验收，默认Web与双向切换保持。
- [x] 最终样式只读检查至少3段已有真实对话，并验证深色、大字体、横屏/iPad。
- [x] 最终独立规格和质量审查通过后更新本报告结果。
