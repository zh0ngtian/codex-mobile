# 原生对话与边栏按最新截图重做计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以用户最新截图重做 iOS 原生对话、全屏边栏和输入栏两态，保留 CM 现有功能及默认旧界面/双向切换。

**Architecture:** 保留单业务 WKWebView 和显式命令快照。SwiftUI 改展示层；需要的项目/设备副标题、时间、分组类型等仅以可选字段扩展 v1 DTO，不另建业务协议。原生默认开关、检查点与可信首页修复不改动。侧栏底部输入入口用于进入新对话，不能把用户输入误发给隐藏的旧会话。

**Tech Stack:** SwiftUI/UIKit、Foundation AttributedString、现有 React/TS 适配器、Vitest、XCTest、XcodeBuildMCP、releasectl。

## 用户确认与视觉来源

- 2026-10-15 用户要求对话页和边栏按上传截图制作，随后明确忽略所有截图中的语音按钮，并要求 product-design 尽量贴近、以最新截图为准。
- 对话主参考：`.mobile-build/native-visual-refresh/reference/03-conversation-latest.png`；聚焦输入：`04-composer-focused-latest.png`。
- 边栏参考：`01-sidebar.png`；更早的对话图 `02-conversation-earlier.png` 只作补充，冲突服从03/04。
- 原图由本聊天附件提取，含用户项目/机器名称，仅留 ignored 目录，不提交原图。当前PNG是942×2048，原始附件1206×2622；以402×874pt归一，缩放因子942/402。系统状态栏、键盘和home indicator由系统提供。
- 色彩取样已对Display P3转sRGB，见同目录measurement-srgb.json。视觉尺寸和字体以设计说明表中的confidence为准，不把估计当成原始设计token。
- 既有功能继续保留；图中的点赞/点踩、语音、Sidechat不新增。新截图已经给出聚焦后展开配置图标栏的方式，按该方式容纳CM参数，不再等待旧的配置位置问题。

## Task 0：基线与测量

- [x] 已有独立worktree切到`codex/native-visual-refresh-20261015`并合并正式0.2.176基线。
- [x] releasectl登记`codex-mobile-native-visual-refresh-20261015`，持续heartbeat，不独立正式发包。
- [x] 提取4张附件，标记主次来源；本地采色确认Display P3，转换后accent约#FF49AC、用户气泡#FFEFF5。
- [x] 完成`docs/research/native-visual-refresh-2026-10-15/design-spec.md`中的测量表、P3→sRGB采色、文案/图标映射和预期差异。
- [x] 运行改动相关现有CI与原生投影基线：12文件115项通过，日志`.mobile-build/native-reference/visual-refresh-baseline.log`；测试模拟器已配置用户提供网关，禁止运行会发送/归档真实会话的live用例。

## Task 1：先修正文渲染的实际缺陷

**Files:** `mobile/ios/NativeUI/NativeInlineMarkdown.swift`、必要的单职责Foundation辅助类型、`NativePlainText.swift`、`tests/ci/native-ui-model-smoke.swift`、`tests/ci/ios-native-ui.test.ts`。

- [ ] 先写并运行失败回归，真实执行Foundation生产解析：
  - `**二是希望细化合规路径及办理指导。**企业关注` 显示无星号、前句有strong属性且后句未加粗。
  - 行内代码、转义星号、已有链接和不完整标记不被误处理。
  - `:codex-file-citation{path="/Users/example/中文 文件.xlsx" purpose="source"}` 显示可点击的文件名，URL逐字往返到原绝对路径。
  - fenced/inline code中的示例及无效路径不被转换为文件操作；消息原文和JS复制业务不改。
- [ ] 用最小原生展示解析修复，不引入新依赖、不修改权限或传输；代码块仍走独立代码视图。
- [ ] GREEN后进行规格审查，再质量审查；完成本阶段独立提交。

## Task 2：补齐现有业务的展示元数据与分组

**Files:** `src/native-ui/protocol.ts`、`projection.ts`、`workspace-adapter.ts`、`src/App.tsx`原有原生命令接线；Swift对应DTO；`tests/ui/native-ui-*.test.ts*`和真实Swift Codable契约。

- [ ] TDD新增可选展示字段（空/旧DTO仍解码）：项目名/设备名、消息时间、分组类别、项目新对话命令。不得把访问口令或BackendConfig放入快照。
- [ ] 默认导航同时显示置顶/项目/最近，搜索时展示搜索结果；复用既有排序、项目5条分页、折叠状态及“更多”。置顶仍保留在原项目中。
- [ ] 项目右侧新对话按钮使用明确的backendId/cwd，验证目标仍存在，复用已有新对话路由；不发起`thread/start`直到用户发送。
- [ ] 设备选择放入顶部菜单，保留全部设备与单设备；设置、草稿、刷新仍可达。
- [ ] 模型/推理/速度/权限继续复用既有会话设置与命令；Skill/插件可从附件菜单和@进入。只改变入口展示，不复制业务。
- [ ] 投影/上下文/旧DTO/取消输入/只读回归通过，规格与质量审查后提交。

建议DTO形态（以实现时最小需求收敛）：
```ts
interface NativeMessage { /* 原字段保留 */ timestamp?: number }
interface NativeGroup { /* 原字段保留 */ kind?: 'pinned' | 'project' | 'recent' | 'search'; newCommand?: NativeCommand }
interface NativeSnapshot { /* 原字段保留 */ projectName?: string; backendName?: string; listBackendId?: string; serviceTier?: string }
```

## Task 3：设计token与静态视觉基准

**Files:** `NativePalette.swift`、新`NativeVisualMetrics.swift`、`NativeIconButton.swift`、`NativeMessageView.swift`、Markdown排版视图、`NativeUIStore.swift`参考fixture与必要单类型参考文件；原生UI契约。

- [ ] RED：白底/粉色气泡、返回按钮、合并新对话/更多操作胶囊、标题和设备项目副标题、底部单行输入、无语音入口的可测契约。
- [ ] 先建立最小token系统，再按设计说明完成静态基准。默认正文约16pt与约22pt行高作为第一轮inferred值；用户消息深粉文字、#FFEFF5气泡、较大圆角。
- [ ] 对话正文保留加粗、列表缩进、代码、表格、文件链接与媒体，操作区只使用CM已有功能。显示真实时间与整轮用时，不伪造数据。
- [ ] 首轮构建和402pt截图对比，修正最大3项差异；记录改的是排版、颜色或布局。单类型单文件，不引入第三方库。
- [ ] 规格与SwiftUI质量审查后提交。

## Task 4：全屏侧栏、头部与输入栏两态

**Files:** `NativeRootView.swift`、`NativeConversationView.swift`、`NativeSidebarView.swift`、`NativeNavigationGroupView.swift`、`NativeNavigationRow.swift`、`NativeComposerView.swift`及必要的小组件/store原生展示状态。

- [ ] RED：边栏首屏直接可见会话，设备与管理不平铺；搜索、置顶、项目折叠与新建、最近、设置/草稿均可操作。
- [ ] 第一张图对应全宽边栏；顶部品牌与连接设备菜单、右侧搜索圆按钮；移除原侧栏80%挤压主体的视觉，保留返回/滑动及Reduce Motion能力。
- [ ] 边栏底部胶囊是新对话入口，点击进入已有新对话上下文后聚焦；附件入口也须等新上下文确认，不把附件或草稿放入隐藏旧会话。
- [ ] 对话头部按最新图返回圆按钮、标题/副标题、右侧合并操作胶囊；菜单保留会话全部现有操作。
- [ ] 输入未聚焦约48pt单行胶囊；聚焦/多行/附件时展开，配置使用图标（模型、推理、速度、权限），保留可访问名称、只读/未就绪/发送/排队/停止状态。
- [ ] 键盘、附件、长标题、横屏和大字体不遮挡正文或永久控件；不复制截图中的第三方键盘、麦克风或声波按钮。
- [ ] 相关原生交互与Swift/TS契约通过，规格与质量审查后提交。

## Task 5：视觉QA与真实对话验收

- [ ] 以03/04同内容参考fixture和01同结构导航fixture捕获对话、全屏边栏、聚焦输入。原图与截图归一后并排/叠图，在同一比较图中检查，不仅分别查看。
- [ ] `design-qa.md`写明来源、viewport、密度、字体/布局/色彩/图标/文案五项检查、每轮P0/P1/P2和修改后证据；无可执行P0/P1/P2才设`final result: passed`。
- [ ] 连接用户给定网关只读打开至少3段已有对话（长文、代码/表格、图文）；保存私有截图，不创建、发送、编辑或归档用户会话。
- [ ] 检查深色、大字、横屏/iPad基本布局；仅运行明确offline/reference的原生用例，不对用户网关运行live发消息测试。
- [ ] 原界面开关与默认Web保持不变；沿用用户指示，不要求真机确认。

## Task 6：协调发布与交付

- [ ] 相关与全量TS测试、typecheck、107+项CI契约、157项发布Python及协调器恢复检查通过；保留四项required checks证据。
- [ ] 中文Conventional Commits提交并推送确定SHA；更新用户可感知中文日志，ready本任务。
- [ ] 等待成功共同receipt，核对双端GitHub、固定APK/签名IPA、HTTPS OTA和unsigned软件源；不独立分配正式版本或换签名身份。
- [ ] 交付固定OTA页、APK/IPA及版本/大小/SHA256、IPA签名状态，附视觉对照与已知边界。
