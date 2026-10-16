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
- NativeComposerLineLimits.swift：计算 1...安全最大行数，不再接受 maximized。
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
                    compact: Bool, accessibility: Bool) -> ClosedRange<Int> {
    let preferred = compact ? (accessibility ? 1 : 2) : (accessibility ? 3 : 6)
    let safeHeight = availableHeight.isFinite ? max(0, availableHeight) : 0
    let safeLine = lineHeight.isFinite && lineHeight > 0 ? max(1, lineHeight) : 24
    let budget = Int(min(Double(preferred), max(0, safeHeight - 80) / safeLine))
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

- [ ] 在生产 App + 离线 HTTP fixture 的独立模拟器测试 Bundle 中验证：无最大化图标；逐行输入增长；长输入达到上限后内部滚动；删除后缩小；横屏和最大辅助字号的输入、发送/停止可达。
- [ ] 实际打开系统模型/思考菜单，确认两组平级列表和选择标记、无旧模型 sheet“完成”按钮；选择模型和强度后保留草稿。
- [ ] 切换 Fast，核对两种图标与权威状态一致；对照截图核对文字和图标大小。
- [ ] 复核独立输入/整页原生两种呈现及原有开关，保存截图、几何记录和原始 xcresult。使用主工作区共享模拟器锁，结束后及时释放；不创建真实远端会话。
- [ ] 本地必要门禁：adapter-regression、coordinator-recovery、build-contract、typecheck；独立规格/质量审查后推送固定 SHA，再由协调器 ready。
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
