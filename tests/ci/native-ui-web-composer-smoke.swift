import Foundation

enum NativeWebComposerSmoke {
    @MainActor static func verify() throws {
        let collapsed = NativeComposerLineLimits.resolve(maximized: false, availableHeight: 500, lineHeight: 24, compact: false, accessibility: false)
        let maximized = NativeComposerLineLimits.resolve(maximized: true, availableHeight: 500, lineHeight: 24, compact: false, accessibility: false)
        precondition(collapsed == 1...6, "普通输入按内容自然增长")
        precondition(maximized.lowerBound > collapsed.lowerBound && maximized.lowerBound == maximized.upperBound, "最大化实际编辑区域必须保留预算行数，不能只扩大背景")
        precondition(Double(maximized.upperBound) * 24 + 80 <= 500, "输入行数为底部操作预留高度")
        precondition(NativeComposerLineLimits.resolve(maximized: false, availableHeight: 500, lineHeight: 24, compact: true, accessibility: true) == 1...1, "横屏大字号普通输入维持原限制")
        precondition(NativeComposerLineLimits.resolve(maximized: true, availableHeight: 100, lineHeight: 60, compact: true, accessibility: true) == 1...1, "有限高度至少保留一行并允许滚动")
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
