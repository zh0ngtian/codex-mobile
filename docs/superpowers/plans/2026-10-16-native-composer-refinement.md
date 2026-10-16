# 原生输入栏自适应与菜单调整计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 逐项实现；每次新增行为先验证 RED，再实现 GREEN。

**目标：** 完成用户明确提出的四项调整：移除最大化、输入随行数增长且受最大尺寸约束、区分 Fast 图标、模型/思考使用会话同款系统菜单、文字与图标同字号。

**架构：** 保持同一原生 TextField、NativeUIStore、业务命令与独立界面开关。仅调整原生呈现和高度预算。系统会话菜单在 iOS 17.4+ 使用 UIMenu，SwiftUI 会话头也使用 Menu，因此模型/思考改为包含两组平级选项的 SwiftUI Menu，取消原模型底部 sheet。

**技术栈：** SwiftUI / SF Symbols / Foundation、现有 Swift smoke 与 XCTest、Vitest、releasectl。

## 边界

- 基线 origin/main 为 e0449759cd0f79da707e2f81c6ca7021c91a3668；工作区为 ios-composer-refinement，任务为 native-composer-refinement-20261016。
- 两种 iOS 原生输入呈现共用同一组件；独立输入开关和整页开关保持原语义，Web/Android 输入逻辑不变。
- 不增加网络接口、业务状态副本、热切换或自动回退；模型、思考、速度仍使用已有带 contextId 的命令。
- 输入始终从一行开始，按硬换行及自动换行自然增长。达到预算后由控件内部滚动，删除内容后缩回；不强制填满预算。
- 默认行数上限沿用现有普通模式：竖屏标准最多六行、辅助字号三行、横屏两行、横屏辅助字号一行；还须取当前可用高度预算允许的更小值。至少保留一行及发送/停止操作。
- 字体和 SF Symbol 共享一个工具栏字号（基准 16pt），同时使用现有字号比例及 Dynamic Type。44pt 点击范围和发送圆形按钮背景尺寸继续保留。
- Fast 使用权威 speedValue 判断：空值及 default/normal 默认别名为关闭，其余非默认服务档位（含 fast/priority）开启；开启为 bolt.fill，关闭为 bolt.slash；辅助功能说明同时表达当前状态。
- 模型和思考强度位于同一系统菜单内的两组列表，保留已选标记；不再用带“完成”按钮的模型底部面板。

## 文件职责

- NativeComposerView.swift：删除最大化状态/按钮/固定展开高度，使用自然行数范围；统一工具栏字体。
- NativeComposerLineLimits.swift：计算 1...安全最大行数，不再接受 maximized；实际输入传入随方向与动态字号计算的 chromeHeight。
- NativeComposerLayoutBudget.swift：为一行编辑与 44pt 工具栏预留真实高度，计算横屏紧凑间距和附件/队列的可滚动高度上限。
- NativeComposerConfigurationView.swift：Fast 图标按状态切换；模型和思考使用系统 Menu。
- NativeWebComposerHost.swift、NativeUIHost.swift、NativeRootView.swift、NativeConversationView.swift：两种原生呈现均获得真实可用高度，扣除辅助内容后传给输入栏；避免用扣除输入栏后的布局高度反向计算而振荡。
- NativeVisualMetrics.swift 或独立小型呈现策略：共用字号及 Fast 符号选择，不加入业务副本。
- NativeModelOptionsView.swift、NativeComposerAdjustmentKind.swift：处理取消模型 sheet 后的调用点与无用分支，仅移除确定不再使用的代码。
- tests/ci/native-ui-web-composer-smoke.swift、ios-native-ui.test.ts、相关 NativeUIUITests.swift：验证预算、状态及新菜单交互，更新旧最大化/完成按钮验收。
- README.md、docs/native-ui-business-bridge.md、release/notes.md：同步实际呈现与中文用户更新日志。

## 任务一：呈现策略与完整原生接入

- [x] 先改真实 Swift smoke，验证自然增长范围、预算缩小时上限下降、所有范围下界为一、非有限数值处理、辅助字号和横屏预算，运行旧实现观察预期失败。
- [x] 实现预算策略，关键合同如下：

~~~swift
static func resolve(availableHeight: Double, lineHeight: Double,
                    compact: Bool, accessibility: Bool,
                    chromeHeight: Double) -> ClosedRange<Int> {
    let preferred = compact ? (accessibility ? 1 : 2) : (accessibility ? 3 : 6)
    let safeHeight = availableHeight.isFinite ? max(0, availableHeight) : 0
    let safeLine = lineHeight.isFinite && lineHeight > 0 ? max(1, lineHeight) : 24
    let chrome = chromeHeight.isFinite ? max(0, chromeHeight) : 80
    let budget = Int(min(Double(preferred), max(0, safeHeight - chrome) / safeLine))
    return 1...max(1, budget)
}
~~~

- [x] 移除 allowsMaximizing、maximized、最大化/还原按钮和用于填满编辑区的 frame；TextField 仍只保留一个实例，使用上述 1...上限。实际可用预算扣除附件、队列、候选与提示，不重复补键盘/安全区。
- [x] 高度在宿主外层读取后向下传递，完整原生与混合模式均使用实际值；保留几何 probe 的真实遮挡回传与旧 context 保护。禁止从已经扣除 composer 的正文高度创建反馈循环。
- [x] 为 Fast 开启/关闭状态补行为用例，先 RED，再实现状态符号选择：

~~~swift
static func speedSymbol(_ value: String?) -> String {
    isFastEnabled(value) ? "bolt.fill" : "bolt.slash"
}
~~~

- [x] 工具栏使用一份 NativeScaledFont 或同等共享字体配置；移除 plus/权限/速度/模型/发送各自不一致的字号覆盖，保留点击区域和状态色。字体统一以实际截图验收，不新增只镜像常量的测试。
- [x] 模型/思考改 Menu，按下面结构复用原 chooseComposerOption，并在动作生成时捕获 context：

~~~swift
Menu {
    Section(store.label("模型", "Model")) {
        ForEach(store.snapshot.models) { option in
            let context = store.snapshot.contextId
            Button {
                store.chooseComposerOption("model.select", value: option.value, contextID: context)
            } label: {
                if option.value == store.snapshot.modelValue {
                    Label(option.title, systemImage: "checkmark")
                } else { Text(option.title) }
            }
        }
    }
    Section(store.label("思考强度", "Reasoning Effort")) {
        ForEach(store.snapshot.efforts) { option in
            let context = store.snapshot.contextId
            Button {
                store.chooseComposerOption("effort.select", value: option.value, contextID: context)
            } label: {
                if option.value == store.snapshot.effortValue {
                    Label(option.title, systemImage: "checkmark")
                } else { Text(option.title) }
            }
        }
    }
} label: {
    HStack(spacing: 4) {
        Text(store.snapshot.model).foregroundStyle(.primary).lineLimit(1)
        Text(store.snapshot.effort).foregroundStyle(.secondary).lineLimit(1).fixedSize(horizontal: true, vertical: false)
    }
    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
    .contentShape(.rect)
}
.disabled(!store.composerCanEdit)
~~~

- [x] 更新旧模型 sheet 的测试及草稿/光标/context Swift 回归，权限与附件面板保持原路径；菜单选择后的实际键盘行为留待任务二模拟器验收。
- [x] 运行关联回归和 typecheck，自审后按中文 Conventional Commits 提交；不推送 main、不自行分配版本或正式发包。

## 任务二：实际布局、发布与交付

- [x] 在生产 App + 离线 HTTP fixture 的独立模拟器测试 Bundle 中验证：无最大化图标；逐行输入增长；长输入达到上限后内部滚动；删除后缩小；横屏和最大辅助字号的输入、发送/停止可达。
- [x] 实际打开系统模型/思考菜单，确认两组平级列表和选择标记、无旧模型 sheet“完成”按钮；选择模型和强度后保留草稿。
- [x] 切换 Fast，核对两种图标与权威状态一致；对照截图核对文字和图标大小。
- [x] 复核独立输入/整页原生两种呈现及原有开关，保存截图、几何记录和原始 xcresult。使用主工作区共享模拟器锁，结束后及时释放；不创建真实远端会话。
- [x] 本地必要门禁：adapter-regression、coordinator-recovery、build-contract、typecheck；独立规格与质量审查通过。
- [ ] 推送固定 SHA 并由协调器 ready，等待成功批次凭证。
- [ ] 等待同批 APK、签名 IPA、HTTPS OTA、GitHub Release 和 unsigned 软件源成功凭证，再做固定清单/HEAD/完整 GET/散列核对。
- [ ] 最终提供固定 OTA、APK、IPA 链接，以及两个包的版本、字节大小、SHA-256；注明 IPA 签名状态和实际真机验证边界。


## 2026-10-16 实现与本地验证

- 高度预算 smoke 在旧实现上因“宿主可用高度缩小时，自然增长上限也必须缩小”按预期失败；实现后通过。覆盖竖横屏、辅助字号、最小高度、非有限高度、无效行高及极大有限值。
- Fast 符号策略先新增测试，旧实现缺少状态投影 API 时 RED；实现后覆盖 Fast/标准/空值、命令发送期间保持权威状态及快照确认后更新。
- 保留真实 store 的旧上下文拒绝、草稿、UTF-16 光标与 selectionRevision 保护；模型和思考采用系统菜单平级选项。
- 五个关联测试文件共 31 项通过，涵盖真实 Swift smoke、独立输入与 bootstrap 契约、草稿及 adapter。原生 Swift 源码和 XCTest 源文件使用 iPhoneSimulator 27.0 SDK 进行 `swiftc -typecheck`，均通过；`npm run typecheck` 通过。
- 更新自然增缩、内部滚动、系统菜单选择、Fast 状态及截图的 XCTest 步骤，尚未执行模拟器验收。
- RED/GREEN 原始日志存于仓库外 `~/Library/Application Support/CodexMobile/validation/native-composer-refinement-20261016/`；没有执行发布、版本分配或 ready。

### 规格审查修复：Fast 服务档位别名

- 真实 Swift smoke 先对 `priority` 运行 RED，在旧 `fast` 单值判断上按预期失败；统一 `isFastEnabled` 后回归。
- 速度图标与辅助功能共用现有业务语义：空值及 `default`/`normal` 为正常，`fast`、`priority` 及其他非默认服务档位为开启。离线 UI fixture 使用真实 `priority` 值。
- 复用 `settings.test.ts` 和 `native-ui-workspace.test.ts`，43 项通过，确认旧 fast 映射到目录 priority、原生 adapter 原样投影 `speedValue: priority`，不硬编码速度目录。
- 模拟器发现系统菜单自动反序；模型与速度菜单采用 `.menuOrder(.fixed)`，保持模型→思考与正常→Fast，以及目录选项的原始顺序，留待父任务按截图复验。
- 修复后真实 Swift smoke 与上述业务回归合计 59 项通过，原生 Swift iOS 类型检查及 TypeScript 类型检查通过；原始日志为 `red-fast-tier.log`、`green-fast-tier.log`、`swift-typecheck-fast-tier.log` 与 `typecheck-fast-tier.log`。

### 实际 UI 修复：横屏附件与整体输入预算

- 父任务在 `testAttachmentDoesNotConsumeEditorHeightBudget` 复现 RED：178pt 键盘上方空间不足以容纳原 98pt 编辑卡、60pt 音频附件及 32pt 间距/外边距，附件可操作但发送被键盘遮挡。原始证据为 `.mobile-build/refinement-attachment-budget.xcresult` 与私有 `attachment-qa/E9E97CDC-14B8-41AE-B6C2-43B2EE0C0298.png`。
- 新增真实生产 `NativeComposerLayoutBudget` 数学回归，覆盖 178pt 下附件、长队列、辅助字号的整个容器边界，以及附件不填满预算、竖屏仍可自然增长到六行。
- 宿主改读外层 GeometryReader 提案并固定子树承载尺寸，空态正文允许压缩；唯一 TextField 保留，字号使用实际字体行高计算。辅助内容独立测量理想高度、按宿主预算限高滚动；横屏只调整间距，不缩小 44pt 发送、停止或附件操作范围。
- 新增仓库 XCTest `testLandscapeAttachmentKeepsEditorAndActionsAboveKeyboard`，等待父任务继续同场景实际复验；本地不操作模拟器或 `.mobile-build`。
- 最终行数合同由视图传入 `NativeComposerLayoutBudget.editorChromeHeight`，按实际字体行高与工具栏净空计算；80pt 仅作为无效 chrome 数值的防护默认，不再作为真实输入的固定扣除值。旋转首帧的旧方向环境也须满足整个输入容器不超过 178pt 的数学边界。
- 本地修复后关联 3 文件 25 项通过，原生 Swift 与 XCTest 源码 iOS 类型检查、TypeScript 类型检查通过；日志分别为 `green-attachment-budget.log`、`swift-typecheck-attachment-budget.log`、`ui-tests-typecheck-attachment-budget.log`、`typecheck-attachment-budget.log`。

### 实际 UI 修复：最大辅助字号工具栏净空

- `.mobile-build/refinement-final.xcresult` 的实际 RED 显示输入底边 325.333pt 大于模型菜单顶边 320pt；其他四个布局、输入与配置场景已通过。
- 数学回归先对“完整 60pt 工具栏 + 4pt 底距 + 1pt 舍入净空”要求运行 RED，旧居中溢出平均公式按预期失败。
- 工具栏所有文字与图标改由同一个 16pt `ScaledMetric` 字体绘制并计算首帧行高保护；实际整行高度测量后参与编辑器 padding 和最低高度预算，不降低字号或 44pt 操作范围，不重建 TextField。
- 修复后关联 3 文件 25 项通过，原生 Swift、XCTest 源码和 TypeScript 类型检查通过；日志为 `red-toolbar-clearance.log`、`green-toolbar-clearance.log`、`swift-typecheck-toolbar-clearance.log`、`ui-tests-typecheck-toolbar-clearance.log`、`typecheck-toolbar-clearance.log`。仓库横屏输入测试提升到最大辅助字号并加入文字与工具栏不重叠断言，实际 UI 由父任务继续复验。


### 最终本地验收

- 最终运行代码为 `113368b11483042d61fa3479ba647fd394bd923c`。生产 App + 内存 HTTP fixture 的独立 Bundle 在 iOS 27 模拟器完成六项真实交互验收：硬换行/自动折行增长、封顶滚动、删除缩回；完整原生模式增长；模型→思考固定菜单顺序、切换保留草稿；真实 `priority` 档位 Fast 开关；横屏附件与运行中操作；最大辅助字号横屏布局；先编辑再旋转且键盘保持屏内。
- 最大辅助字号与屏内键盘同时存在时，输入底边 114pt、模型工具栏顶边 116pt/底边 170pt、发送底边 164pt，均在键盘顶边 222pt 以上；输入、模型和发送均可点击。附件场景同样通过，未将屏外键盘的快照当作已覆盖。
- 最终 `129` 文件 `1458` 项 Vitest 通过，真实 Swift smoke 包含在内；发布适配器 Python `166` 项、协调器恢复 `30` 项通过。原生 Swift、XCTest 源码及 TypeScript 类型检查通过。独立规格与质量复核通过，两处实际 UI 缺陷已按 RED→GREEN 关闭。
- 原始 xcresult、截图、几何及验收脚本持久保存在仓库外 `~/Library/Application Support/CodexMobile/validation/native-composer-refinement-20261016/`。测试仅使用离线数据，未创建真实远端测试会话；未进行真机覆盖安装和数据保留验收。
- 发布仍由已登记任务 `native-composer-refinement-20261016` 交给协调器，成功版本、渠道下载与散列以共同成功 receipt 及独立回验 JSON 为准，不在本地自行分配版本或正式发包。

### 正式 CI 修复：Swift 冷 SDK 编译预算

- 正式批次 `ee3e1566-ac8b-446f-a331-55232b484be8` 的 iOS 构建契约提供实际 RED：11 文件 114 项中，113 项通过；真实 Swift Store/DTO/Markdown/输入栏 smoke 编译在 90050ms 触发 `spawnSync xcrun ETIMEDOUT`，没有 Swift 编译错误。原始失败日志保存在私有验证目录 `formal-ci-failed.log`；该批次未发布固定渠道。
- 正式 CI 的完整 Swift 回归编译实测触发 90 秒上限，日志未定位具体编译阶段；为云端冷启动保留有界预算，仅将 `swiftCompileTimeout` 从 90000ms 调整为 180000ms、外层 `swiftContractTimeout` 从 120000ms 调整为 210000ms。Swift 执行仍严格限制 15000ms，全部生产源文件、smoke 文件和断言保持原样；不修改生产 Swift 或用户功能更新日志。
- 父任务关联修复登记为 `native-composer-refinement-ci-repair-20261016`，后续推送与 ready 继续由父任务及协调器执行。
- 本地使用与正式 CI 相同的 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，11 文件 114 项全部通过；`npm run typecheck` 通过。日志为 `green-ci-timeout-repair.log`、`typecheck-ci-timeout-repair.log`。
- 额外使用全新隔离 `-module-cache-path` 对同一组 44 份生产 Swift 源与 4 份 smoke 进行一次冷编译/执行：编译 11.459 秒、执行 0.098 秒，全部真实断言通过。临时缓存和可执行文件验证后清理；计时及断言输出保存为 `cold-swift-ci-timeout-repair.log`。这是本机补充验证，不替代云端新批次成功凭证。
