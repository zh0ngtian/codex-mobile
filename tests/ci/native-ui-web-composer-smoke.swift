import Foundation

enum NativeWebComposerSmoke {
    @MainActor static func verify() throws {
        func decodedBodyFontSize(_ raw: String) throws -> Double? {
            let decoder = JSONDecoder()
            decoder.nonConformingFloatDecodingStrategy = .convertFromString(positiveInfinity: "Infinity", negativeInfinity: "-Infinity", nan: "NaN")
            let presentation = try decoder.decode(NativeWebComposerPresentation.self, from: Data(raw.utf8))
            let encoded = try JSONEncoder().encode(presentation)
            return (try JSONSerialization.jsonObject(with: encoded) as? [String: Any])?["bodyFontSize"] as? Double
        }
        let payload = #"{"contextId":"a:t","visible":true,"blocked":false"#
        let modernBodyFontSize = try decodedBodyFontSize(payload + #","bodyFontSize":14.2}"#)
        precondition(modernBodyFontSize == 14.2, "网页正文基准字号必须跨桥往返，不能被旧DTO丢弃")
        let legacyBodyFontSize = try decodedBodyFontSize(payload + "}")
        precondition(legacyBodyFontSize == nil, "旧payload缺少字号仍正常解码并保留原生默认字号")
        for rawSize in ["0", "-16", "1e300", "null", #""invalid""#, #""NaN""#, #""Infinity""#, #""-Infinity""#] {
            let invalidBodyFontSize = try decodedBodyFontSize(payload + ",\"bodyFontSize\":" + rawSize + "}")
            precondition(invalidBodyFontSize == nil, "无效字号不能进入布局或影响旧快照解码")
        }
        let natural = NativeComposerLineLimits.resolve(availableHeight: 500, lineHeight: 24, compact: false, accessibility: false)
        let restricted = NativeComposerLineLimits.resolve(availableHeight: 128, lineHeight: 24, compact: false, accessibility: false)
        precondition(natural == 1...6, "竖屏输入从一行按内容自然增长，最多六行")
        precondition(restricted == 1...2, "宿主可用高度缩小时，自然增长上限也必须缩小")
        precondition(NativeComposerLineLimits.resolve(availableHeight: 500, lineHeight: 24, compact: false, accessibility: true) == 1...3, "竖屏辅助字号最多三行")
        precondition(NativeComposerLineLimits.resolve(availableHeight: 500, lineHeight: 24, compact: true, accessibility: false) == 1...2, "横屏最多两行")
        precondition(NativeComposerLineLimits.resolve(availableHeight: 500, lineHeight: 24, compact: true, accessibility: true) == 1...1, "横屏辅助字号最多一行")
        for height in [0.0, -100, 80, 100, Double.nan, Double.infinity, -Double.infinity] {
            precondition(NativeComposerLineLimits.resolve(availableHeight: height, lineHeight: 60, compact: false, accessibility: false) == 1...1, "极小或非有限高度至少保留一行，不强制占满高度")
        }
        for height in [128.0, 500, Double.greatestFiniteMagnitude] {
            let range = NativeComposerLineLimits.resolve(availableHeight: height, lineHeight: 24, compact: false, accessibility: false)
            precondition(range.lowerBound == 1 && range.upperBound <= 6, "所有有效高度均从一行自然增长，极端大值不会溢出")
        }
        for lineHeight in [0.0, -24, Double.nan, Double.infinity, -Double.infinity] {
            precondition(NativeComposerLineLimits.resolve(availableHeight: 128, lineHeight: lineHeight, compact: false, accessibility: false) == 1...2, "无效行高使用安全行高，不能将非有限数转换为整数")
        }
        let attachmentLayout = NativeComposerLayoutBudget.resolve(availableHeight: 178, lineHeight: 21, toolbarHeight: 24, expanded: true, focused: true, compact: true, hasSupplementaryContent: true)
        let audioHeight = min(60, attachmentLayout.supplementaryMaximumHeight)
        precondition(audioHeight >= 44, "横屏音频附件保留完整的移除点击高度")
        precondition(attachmentLayout.editorMinimumHeight + attachmentLayout.outerHeight + attachmentLayout.supplementarySpacing + audioHeight <= 178, "附件与最小编辑器整体不能超过键盘上方宿主预算")
        precondition(attachmentLayout.editorMinimumHeight >= 21 + attachmentLayout.editorChromeHeight, "紧凑输入仍保留真实一行和工具栏")
        let queuedHeight = min(640, attachmentLayout.supplementaryMaximumHeight)
        precondition(attachmentLayout.editorMinimumHeight + attachmentLayout.outerHeight + attachmentLayout.supplementarySpacing + queuedHeight <= 178, "长队列只能在辅助区内部滚动，不能挤出发送按钮")
        let firstRotationLayout = NativeComposerLayoutBudget.resolve(availableHeight: 178, lineHeight: 21, toolbarHeight: 24, expanded: true, focused: true, compact: false, hasSupplementaryContent: true)
        precondition(firstRotationLayout.editorMinimumHeight + firstRotationLayout.outerHeight + firstRotationLayout.supplementarySpacing + firstRotationLayout.supplementaryMaximumHeight <= 178, "旋转首帧即使方向环境尚未更新，也不能撑大宿主")
        let largeLayout = NativeComposerLayoutBudget.resolve(availableHeight: 178, lineHeight: 52, toolbarHeight: 60, expanded: true, focused: true, compact: true, hasSupplementaryContent: true)
        precondition(largeLayout.supplementaryMaximumHeight >= 44, "辅助字号仍留出可滚动附件操作区")
        precondition(largeLayout.editorBottomInset >= 60 + 4 + 1, "必须为完整工具栏高度与底边距预留净空，不能只按居中溢出平均值估算")
        precondition(largeLayout.editorMinimumHeight + largeLayout.outerHeight + largeLayout.supplementarySpacing + largeLayout.supplementaryMaximumHeight <= 178, "动态字号的整个输入容器遵守真实宿主高度")
        let portraitLayout = NativeComposerLayoutBudget.resolve(availableHeight: 500, lineHeight: 21, toolbarHeight: 24, expanded: true, focused: true, compact: false, hasSupplementaryContent: true)
        let portraitInputBudget = 500 - portraitLayout.outerHeight - portraitLayout.supplementarySpacing - min(60, portraitLayout.supplementaryMaximumHeight)
        precondition(NativeComposerLineLimits.resolve(availableHeight: portraitInputBudget, lineHeight: 21, compact: false, accessibility: false, chromeHeight: portraitLayout.editorChromeHeight) == 1...6, "附件只扣实际内容高度，不能填满预算把自然增长压回一行")
        for speed in ["fast", "priority", "custom-tier"] {
            precondition(NativeComposerSymbols.isFastEnabled(speed), "非默认速度档位的辅助功能和图标共用开启状态")
            precondition(NativeComposerSymbols.speedSymbol(speed) == "bolt.fill", "任意已启用的非默认速度档位都显示实心闪电，不能只识别 fast")
        }
        for speed in [nil, "default", "normal", ""] as [String?] {
            precondition(!NativeComposerSymbols.isFastEnabled(speed), "默认速度档位的辅助功能和图标共用关闭状态")
            precondition(NativeComposerSymbols.speedSymbol(speed) == "bolt.slash", "正常、默认或空速度显示划线闪电")
        }
        let speedStore = NativeUIStore(arguments: [])
        var speedSnapshot = NativeSnapshot()
        speedSnapshot.ready = true; speedSnapshot.contextId = "speed:context"
        speedSnapshot.speedValue = ""
        speedStore.receive(speedSnapshot)
        var speedCommands: [NativeCommand] = []
        speedStore.sendCommand = { speedCommands.append($0) }
        speedStore.chooseComposerOption("speed.select", value: "priority", contextID: "speed:context")
        precondition(speedCommands.count == 1 && speedCommands[0].name == "speed.select", "速度沿原命令派发")
        precondition(NativeComposerSymbols.speedSymbol(speedStore.snapshot.speedValue) == "bolt.slash", "请求发送后仍显示权威速度，不乐观改图标")
        speedSnapshot.speedValue = "priority"; speedStore.receive(speedSnapshot)
        precondition(NativeComposerSymbols.speedSymbol(speedStore.snapshot.speedValue) == "bolt.fill", "权威快照确认 Fast 后更新图标")
        let store = NativeUIStore(arguments: [])
        precondition(store.composerEnabled && !store.nativeEnabled, "默认只启用独立输入框")
        let previous = UserDefaults.standard.object(forKey: NativeUIPreference.composerKey)
        defer { if let previous { UserDefaults.standard.set(previous, forKey: NativeUIPreference.composerKey) } else { UserDefaults.standard.removeObject(forKey: NativeUIPreference.composerKey) } }
        try NativeUIPreference(storageKey: NativeUIPreference.composerKey, defaultEnabled: true).save(false)
        precondition(store.composerEnabled && NativeUIStore(arguments: []).composerEnabled, "同进程scene不提前读取已保存输入偏好")
        var value = NativeSnapshot()
        value.ready = true; value.contextId = "a:t"; value.draft = "甲😀中文尾文本"; value.caretOffset = 3
        store.receive(value)
        precondition(!store.webComposerVisible, "ready不能代替真实挂载登记")
        value.webComposer = NativeWebComposerPresentation(contextId: "a:t", visible: true, blocked: false)
        store.receive(value); precondition(store.webComposerVisible)
        let selection = store.selectionRevision
        store.sendCommand = { _ in }
        store.composerText = "甲😀中文输入尾文本"
        let localSelection = store.selectionRevision
        precondition(localSelection == selection, "本地编辑不重设组字选区")
        value.draft = store.draft; value.caretOffset = store.caretOffset; value.draftRevision = 1
        store.receive(value); precondition(store.selectionRevision == localSelection, "相同echo不改变选区版本")
        value.draft = "甲😀$skill 中文输入尾文本"; value.caretOffset = 10
        store.receive(value); precondition(store.selectionRevision > localSelection && store.caretOffset == 10, "权威插入使用UTF16选区")
        value.webComposer?.blocked = true; store.receive(value); precondition(!store.webComposerVisible)
        value.webComposer?.blocked = false; value.webComposer?.contextId = "a:old"; store.receive(value); precondition(!store.webComposerVisible)
        value.webComposer?.contextId = "a:t"; value.sidebarOpen = true; store.receive(value); precondition(!store.webComposerVisible)
        value.sidebarOpen = false; store.receive(value); store.showLegacyForRecovery = true; precondition(!store.webComposerVisible)
        let presentation = NativeWebComposerPresentation(contextId: "a:t", visible: true, blocked: false)
        precondition(!presentation.isVisible(composerEnabled: true, nativeEnabled: true, recovery: false, ready: true, sidebarOpen: false, contextId: "a:t"), "完整原生优先")
        let roundtrip = try JSONDecoder().decode(NativeSnapshot.self, from: JSONEncoder().encode(value))
        precondition(roundtrip.webComposer?.contextId == "a:t", "呈现DTO可往返")
        store.showLegacyForRecovery = false
        store.savedComposerPreference = true
        var commands: [NativeCommand] = []
        store.sendCommand = { commands.append($0) }
        store.requestNativePreference(false, kind: "composer")
        precondition(commands.count == 1 && commands[0].name == "settings.native-composer" && store.preferenceSaving)
        value.commandResults = [NativeCommandResult(id: commands[0].id, name: "settings.native-ui", ok: false, error: "错误类型回执")]
        store.receive(value); precondition(store.preferenceSaving, "另一偏好类型不能释放本次请求")
        value.commandResults = [NativeCommandResult(id: commands[0].id, name: "settings.native-composer", ok: false, error: "检查点失败")]
        store.receive(value); precondition(!store.preferenceSaving && store.savedComposerPreference && store.preferenceError == "检查点失败")
        store.requestNativePreference(false, kind: "composer")
        store.expireNativePreferenceRequest("old-request"); precondition(store.preferenceSaving)
        store.expireNativePreferenceRequest(commands.last!.id); precondition(!store.preferenceSaving && store.preferenceError != nil)
        print("Native web composer smoke passed")
    }
}
