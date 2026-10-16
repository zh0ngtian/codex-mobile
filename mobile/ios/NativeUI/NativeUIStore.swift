import Foundation
import Observation

@MainActor @Observable
final class NativeUIStore {
    var snapshot = NativeSnapshot()
    var draft = ""
    var sidebarOpen = false
    var settingsOpen = false {
        didSet { if settingsOpen { cancelComposerPresentation() } }
    }
    var search = ""
    var attachmentOpen = false
    private(set) var composerPresentation: NativeComposerPresentationEvent?
    private var composerIntent: NativeComposerPresentationIntent?
    var awaitingNewConversation: Bool { composerIntent != nil }
    var webComposerVisible: Bool { snapshot.webComposer?.isVisible(composerEnabled: composerEnabled, nativeEnabled: nativeEnabled, recovery: showLegacyForRecovery, ready: snapshot.ready, sidebarOpen: sidebarOpen, contextId: snapshot.contextId) == true }
    var composerCanEdit: Bool { (nativeEnabled || snapshot.webComposer == nil || webComposerVisible) && snapshot.ready && !snapshot.readOnly && snapshot.pending != true && !awaitingNewConversation }
    var composerCanSend: Bool {
        composerCanEdit && (isReference ? !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !snapshot.attachments.isEmpty : snapshot.canSend)
    }
    var composerCanInterrupt: Bool { snapshot.ready && !snapshot.readOnly && !awaitingNewConversation && (snapshot.canInterrupt ?? snapshot.busy) }
    var navigationBackends: [NativeBackend] { snapshot.backends.filter { $0.id != "all" } }
    var listBackendConnected: Bool {
        snapshot.listBackendId == "all" ? navigationBackends.contains { $0.connected == true } : navigationBackends.first { $0.id == snapshot.listBackendId }?.connected == true
    }
    private var fieldValues: [NativeFieldKey: String] = [:]
    private var fieldSelections: [NativeFieldKey: [String]] = [:]
    private var pendingFields: [NativeFieldKey: Int] = [:]
    private var fieldRevision = 0
    private var draftRevision = 0
    private var pendingSearchRevision: Int? = nil
    private var pendingSidebarRevision: Int? = nil
    private var receivedResultIDs: Set<String> = []
    var commandError: String? = nil
    var textPrompt: NativeTextPrompt? = nil
    var promptValue = ""
    private(set) var caretOffset = 0
    private(set) var selectionRevision = 0
    private var preferenceRuntimeReady = false
    var canChangeNativePreference: Bool { snapshot.ready && preferenceRuntimeReady }
    var savedComposerPreference = NativeUIPreference(storageKey: NativeUIPreference.composerKey, defaultEnabled: true).enabled
    var savedNativePreference = NativeUIPreference().enabled
    var preferenceSaving = false
    @ObservationIgnored private var preferenceKind = "interface"
    @ObservationIgnored private var preferenceCommandID: String?
    @ObservationIgnored private var preferenceTimeout: Task<Void, Never>?
    var preferenceError: String? = nil
    var notice: String? = nil
    var showLegacyForRecovery = false
    @ObservationIgnored var sendCommand: ((NativeCommand) -> Void)?
    @ObservationIgnored var copyText: ((String) -> Void)?
    @ObservationIgnored private var timelines: [String: NativeTimelineState] = [:]
    let visualReferenceFocused: Bool
    let isReference: Bool
    let nativeEnabled: Bool
    let composerEnabled: Bool
    static let preferenceKey = NativeUIPreference.key
    // 与共享运行时的全局命令域一致，导航回执不属于某个工作区。
    private static let globalCommands: Set<String> = [
        "backend.select", "navigation.search", "navigation.sidebar", "navigation.refresh", "navigation.filter",
        "thread.new", "thread.open", "thread.manage", "project.toggle", "project.more", "project.retry",
        "settings.open", "drafts.open", "device.add", "device.edit", "device.change", "device.save", "device.cancel", "device.scan",
        "device.toggle", "device.remove", "device.move", "settings.language", "settings.font", "settings.transport",
        "settings.push.mode", "settings.push.url", "settings.push.save", "settings.update.check", "drafts.restore", "drafts.remove", "drafts.retry",
        "update.install", "update.retry", "update.close", "confirmation.answer", "settings.native-ui", "settings.native-composer"
    ]

    static let launchPreference = NativeUIPreference().enabled
    static let launchComposerPreference = NativeUIPreference(storageKey: NativeUIPreference.composerKey, defaultEnabled: true).enabled

    init(arguments: [String] = ProcessInfo.processInfo.arguments) {
        composerEnabled = Self.launchComposerPreference
        visualReferenceFocused = arguments.contains("--native-ui-reference-visual-focused")
        isReference = arguments.contains("--native-ui-reference-history") || arguments.contains("--native-ui-reference") || arguments.contains("--native-ui-reference-conversation") || arguments.contains("--native-ui-reference-visual")
        #if DEBUG
        nativeEnabled = isReference || Self.launchPreference || arguments.contains("--native-ui-live")
        #else
        nativeEnabled = isReference || Self.launchPreference
        #endif
        if isReference {
            snapshot.ready = true
            snapshot.connection = "online"
            snapshot.title = "UI测试回复示例"
            snapshot.model = "GPT-5"
            snapshot.effort = "中等推理"
            snapshot.groups = [NativeGroup(id: "projects", title: "项目", items: [NativeNavigationItem(id: "reference", title: "Codex Mobile", subtitle: "原生界面基准")]), NativeGroup(id: "today", title: "今天", items: [NativeNavigationItem(id: "conversation", title: "UI 原生测试", selected: true, actions: [NativePanelItem(id: "reference-rename", kind: "action", title: "重命名", command: NativeCommand(name: "thread.manage", params: ["action": .string("rename"), "backendId": .string("reference"), "threadId": .string("conversation")]))])])]
            if arguments.contains("--native-ui-reference-conversation") {
                snapshot.messages = [NativeMessage(id: "user", role: "user", text: "这是一次 UI 探索测试（UI-20261014）。请用中文简短回复：一个二级标题、两条列表，再用 Swift 代码块展示 print(\"Hello\")。最后说明 12 × 13 的结果。"), NativeMessage(id: "assistant", role: "assistant", text: "## UI 探索测试\n- 测试标识：UI-20261014\n- 内容：二级标题、两条列表、Swift 代码块\n\n```swift\nprint(\"Hello\")\n```\n\n12 × 13 = 156", status: "已思考（用时 1 秒）")]
            }
            if arguments.contains("--native-ui-reference-long") {
                snapshot.messages = (1...80).map { index in
                    NativeMessage(id: "reference-history-\(index)", role: "assistant", text: "历史消息 \(index)\n这是用于验证分页与阅读位置的离线参考内容。")
                }
            }
            if arguments.contains("--native-ui-reference-rich") {
                snapshot.messages = [NativeMessage(id: "rich", role: "assistant", text: "## 富内容示例\n1. 有序列表\n   - [x] 已完成的任务\n\n> 保持原生文字选择\n\n| 列一 | 列二 |\n| --- | --- |\n| 单元格 A | 单元格 B |", blocks: [
                    NativePanelItem(id: "safe-html", kind: "html", title: "HTML 预览", value: "<p id='sentinel'>安全预览</p><script>document.getElementById('sentinel').textContent='脚本已执行'</script><svg viewBox='0 0 240 80'><rect x='10' y='10' width='220' height='60' rx='12' fill='#edf3fe'/><text x='120' y='48' text-anchor='middle' fill='#111'>SVG</text></svg>")
                ])]
            }
            if arguments.contains("--native-ui-reference-svg") {
                snapshot.messages = [NativeMessage(id: "svg", role: "assistant", text: "", blocks: [NativePanelItem(id: "vector", kind: "image", title: "vector.svg", value: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20240%2080'%3E%3Ctext%20x='10'%20y='40'%3E矢量原图%3C/text%3E%3C/svg%3E")])]
            }
            if arguments.contains("--native-ui-reference-source") {
                let content = (1...80).map { "let line\($0) = \($0)" }.joined(separator: "\n")
                snapshot.messages = [NativeMessage(id: "source", role: "activity", text: "", blocks: [NativePanelItem(id: "source", kind: "source", title: "example.swift", text: content, line: 40)])]
            }
            if arguments.contains("--native-ui-reference-inline-image") {
                let image = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNDAgODAiPjx0ZXh0IHg9IjEwIiB5PSI0MCI+U1ZHPC90ZXh0Pjwvc3ZnPg=="
                snapshot.messages = [NativeMessage(id: "inline-image", role: "user", text: "正文 ![行内图片](\(image)) 末尾文本")]
            }
            if arguments.contains("--native-ui-reference-audio") {
                snapshot.messages = []
                snapshot.attachments = [NativeAttachment(id: "reference-audio", name: "silence.wav", detail: "0.1 秒音频", type: "audio/wav", command: NativeCommand(name: "attachment.preview", params: ["id": .string("reference-audio")]))]
            }
            if arguments.contains("--native-ui-reference-busy") {
                snapshot.threadId = "reference-thread"
                snapshot.busy = true
                snapshot.canInterrupt = true
                draft = "等待上一轮完成后的测试消息"
                caretOffset = draft.utf16.count
            }
        }
        if arguments.contains("--native-ui-reference-visual") {
            snapshot = NativeVisualReference.snapshot(chinese: arguments.contains("--native-ui-reference-visual-zh"))
            if arguments.contains("--native-ui-reference-project-pagination"), let index = snapshot.groups.firstIndex(where: { $0.id == "visual-project-4" }) {
                snapshot.groups[index].actions = [NativePanelItem(id: "visual-project-4:more", kind: "action", title: "加载更多", command: NativeCommand(name: "project.more", params: ["backendId": .string("visual-device"), "cwd": .string("/demo/demo_gpu_monitor")]))]
            }
            sidebarOpen = arguments.contains("--native-ui-reference-visual-sidebar")
        }
        if arguments.contains("--native-ui-reference-history") {
            snapshot = NativeHistoryEditReference.snapshot(fails: arguments.contains("--native-ui-reference-history-failure"))
            draft = snapshot.draft
        }
    }
    func requestNativePreference(_ enabled: Bool, kind: String = "interface") {
        guard ["interface", "composer"].contains(kind), !preferenceSaving, enabled != (kind == "composer" ? savedComposerPreference : savedNativePreference) else { return }
        guard !isReference, canChangeNativePreference, sendCommand != nil else {
            preferenceError = label("连接尚未就绪，请稍后重试", "The connection is not ready. Please retry.")
            return
        }
        preferenceError = nil
        preferenceSaving = true
        preferenceKind = kind
        let command = NativeCommand(name: kind == "composer" ? "settings.native-composer" : "settings.native-ui", params: ["enabled": .bool(enabled)])
        preferenceCommandID = command.id
        preferenceTimeout?.cancel()
        preferenceTimeout = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(20)) }
            catch { return }
            self?.expireNativePreferenceRequest(command.id)
        }
        sendCommand?(command)
    }

    func expireNativePreferenceRequest(_ id: String) {
        guard preferenceCommandID == id, preferenceSaving else { return }
        receivedNativePreference(preferenceKind == "composer" ? savedComposerPreference : savedNativePreference, kind: preferenceKind, error: label("界面设置保存超时，请重试", "Saving the interface setting timed out. Please retry."))
    }

    func receivedNativePreference(_ enabled: Bool, kind: String = "interface", error: String? = nil) {
        if kind == "composer" { savedComposerPreference = enabled } else { savedNativePreference = enabled }
        guard preferenceCommandID == nil || preferenceKind == kind else { return }
        preferenceTimeout?.cancel()
        preferenceTimeout = nil
        preferenceCommandID = nil
        preferenceSaving = false
        preferenceError = error
        if error == nil { notice = label("下次完整启动时生效", "Applies at the next full launch") }
    }

    func failNativePreference(_ command: NativeCommand, error: String) {
        guard command.id == preferenceCommandID else { return }
        receivedNativePreference(preferenceKind == "composer" ? savedComposerPreference : savedNativePreference, kind: preferenceKind, error: error)
    }

    func receive(_ value: NativeSnapshot) {
        guard value.version == 1, !isReference else { return }
        preferenceRuntimeReady = value.ready && value.panel?.id != "native-switch-recovery"
        let contextChanged = value.contextId != snapshot.contextId
        let panelChanged = value.panel?.id != snapshot.panel?.id
        if let event = composerPresentation,
           !value.ready || value.readOnly || value.pending == true || value.threadId?.isEmpty == false ||
           value.commandResults?.contains(where: { $0.id == event.id && $0.name == "thread.new" && !$0.ok }) == true {
            composerPresentation = nil
        }
        if contextChanged {
            attachmentOpen = false
            if composerPresentation?.contextID != value.contextId { composerPresentation = nil }
            pendingFields.removeAll()
            draftRevision = value.draftRevision ?? 0
            pendingSearchRevision = nil
            receivedResultIDs.removeAll()
            commandError = nil
            textPrompt = nil
        }
        pendingFields = pendingFields.filter { key, _ in
            if case .historyEdit(let contextID, let messageID, let editID) = key.scope {
                return contextID == (value.contextId ?? "") && value.messages.first(where: { $0.id == messageID })?.historyEdit?.id == editID
            }
            return true
        }
        if panelChanged {
            pendingFields = pendingFields.filter { key, _ in
                if case .panel = key.scope { return false }
                return true
            }
        }
        for result in value.commandResults ?? [] {
            if result.name == (preferenceKind == "composer" ? "settings.native-composer" : "settings.native-ui"), result.id == preferenceCommandID {
                preferenceTimeout?.cancel()
                preferenceTimeout = nil
                preferenceCommandID = nil
                preferenceSaving = false
                if !result.ok { preferenceError = result.error ?? label("切换保存失败，请重试", "Could not save the interface setting. Please retry.") }
            }
            guard result.contextId == nil || result.contextId == value.contextId else { continue }
            if let key = result.fieldKey, let revision = result.fieldRevision {
                pendingFields = pendingFields.filter { $0.key.wireValue != key || $0.value > revision }
                if key == "sidebar-search", let pending = pendingSearchRevision, revision >= pending { pendingSearchRevision = nil }
                if key == "sidebar-state", let pending = pendingSidebarRevision, revision >= pending { pendingSidebarRevision = nil }
            }
            if !receivedResultIDs.contains(result.id) {
                commandError = result.ok ? nil : result.error ?? label("操作未完成，请重试", "The operation failed. Please retry.")
            }
            receivedResultIDs.insert(result.id)
        }
        if receivedResultIDs.count > 512 {
            receivedResultIDs = Set((value.commandResults ?? []).map(\.id))
        }
        // 未确认编辑保留在当前字段；命令回执到达后由权威快照收敛。
        fieldValues = fieldValues.filter { pendingFields[$0.key] != nil }
        fieldSelections = fieldSelections.filter { pendingFields[$0.key] != nil }
        snapshot = value
        snapshot.fontScale = 0.875
        if pendingSidebarRevision == nil, let open = value.sidebarOpen, !awaitingNewConversation { sidebarOpen = open }
        timeline(for: threadKey).receive(messageIDs: value.messages.map(\.id))
        if contextChanged || (value.draftRevision ?? 0) >= draftRevision {
            let nextCaret = min(value.draft.utf16.count, max(0, value.caretOffset ?? value.draft.utf16.count))
            if contextChanged || draft != value.draft || caretOffset != nextCaret { selectionRevision += 1 }
            if draft != value.draft { draft = value.draft }
            caretOffset = nextCaret
        }
        if pendingSearchRevision == nil, let search = value.search, self.search != search { self.search = search }
        advanceComposerPresentation(value)
    }
    // SwiftUI diff期间旧Binding仍可读取上一帧DTO；ACK后必须按身份读取当前快照。
    private func currentItem(_ item: NativePanelItem, scope: NativeFieldScope) -> NativePanelItem {
        let items: [NativePanelItem]
        switch scope {
        case .panel(let id):
            items = snapshot.panel?.id == id ? snapshot.panel?.items ?? [] : []
        case .historyEdit(let contextID, let messageID, let editID):
            if contextID == (snapshot.contextId ?? ""), let editor = snapshot.messages.first(where: { $0.id == messageID })?.historyEdit, editor.id == editID {
                items = editor.items
            } else { items = [] }
        case .message(let id):
            if let message = snapshot.messages.first(where: { $0.id == id }) {
                items = (message.blocks ?? []) + (message.actions ?? [])
            } else if id == "conversation:\(threadKey)" || id == "history:\(threadKey)" {
                items = snapshot.conversationActions ?? []
            } else if let queued = snapshot.queued.first(where: { id == "queue:\($0.id)" }) {
                items = queued.actions ?? []
            } else if let group = snapshot.groups.first(where: { id == "group:\($0.id)" }) {
                items = group.actions ?? []
            } else {
                items = snapshot.groups.flatMap(\.items).first(where: { id == "navigation:\($0.id)" })?.actions ?? []
            }
        }
        func find(_ candidates: [NativePanelItem]) -> NativePanelItem? {
            for candidate in candidates {
                if candidate.id == item.id { return candidate }
                if let match = find(candidate.children ?? []) { return match }
            }
            return nil
        }
        return find(items) ?? item
    }
    func fieldValue(_ item: NativePanelItem, scope: NativeFieldScope) -> String {
        fieldValues[NativeFieldKey(scope: scope, itemID: item.id)] ?? currentItem(item, scope: scope).value ?? ""
    }
    func setFieldValue(_ value: String, item: NativePanelItem, scope: NativeFieldScope) {
        fieldValues[NativeFieldKey(scope: scope, itemID: item.id)] = value
    }
    func selectedValues(_ item: NativePanelItem, scope: NativeFieldScope) -> [String] {
        fieldSelections[NativeFieldKey(scope: scope, itemID: item.id)] ?? currentItem(item, scope: scope).values ?? []
    }
    func setSelectedValues(_ values: [String], item: NativePanelItem, scope: NativeFieldScope) {
        fieldSelections[NativeFieldKey(scope: scope, itemID: item.id)] = values
    }
    func closePanel(expectedID: String? = nil) {
        guard let panel = snapshot.panel, expectedID == nil || expectedID == panel.id else { return }
        let scope = NativeFieldScope.panel(panel.id)
        fieldValues = fieldValues.filter { $0.key.scope != scope }
        fieldSelections = fieldSelections.filter { $0.key.scope != scope }
        pendingFields = pendingFields.filter { $0.key.scope != scope }
        snapshot.panel = nil
        command("panel.close", ["id": .string(panel.id)])
    }
    func startNewConversation(presentation: NativeComposerPresentation = .focus, params: [String: NativeJSONValue] = [:]) {
        guard snapshot.ready, snapshot.pending != true, isReference || sendCommand != nil else { return }
        let request = NativeCommand(name: "thread.new", params: params)
        let targetBackendID: String?
        if case .string(let value) = params["backendId"] { targetBackendID = value }
        else { targetBackendID = nil }
        composerPresentation = nil
        attachmentOpen = false
        commandError = nil
        composerIntent = NativeComposerPresentationIntent(commandID: request.id, previousContextID: snapshot.contextId, previousThreadID: snapshot.threadId, targetBackendID: targetBackendID, presentation: presentation)
        if isReference {
            // 本地演示也先确认 ACK，再通过相同纯值状态机确认权威的新上下文。
            var ack = snapshot
            ack.commandResults = [NativeCommandResult(id: request.id, name: request.name, ok: true)]
            advanceComposerPresentation(ack)
            var fresh = snapshot
            fresh.contextId = "reference:\(UUID().uuidString)"
            fresh.threadId = nil
            if let targetBackendID { fresh.backendId = targetBackendID }
            fresh.messages = []; fresh.draft = ""; fresh.attachments = []; fresh.queued = []
            fresh.readOnly = false; fresh.pending = false; fresh.busy = false; fresh.canInterrupt = false
            fresh.sidebarOpen = false; fresh.commandResults = nil
            snapshot = fresh
            draft = ""; caretOffset = 0; selectionRevision += 1
            advanceComposerPresentation(fresh)
        } else {
            sendCommand?(request)
        }
    }
    func cancelComposerPresentation() {
        composerIntent = nil
        composerPresentation = nil
        attachmentOpen = false
    }
    private func advanceComposerPresentation(_ value: NativeSnapshot) {
        guard var intent = composerIntent else { return }
        intent.receive(value)
        if intent.invalidated {
            composerIntent = nil
            return
        }
        if let contextID = intent.confirmedContextID {
            composerIntent = nil
            composerPresentation = NativeComposerPresentationEvent(id: intent.commandID, contextID: contextID, presentation: intent.presentation)
            sidebarOpen = false
        } else {
            composerIntent = intent
        }
    }
    func consumeComposerPresentation(contextID: String?) -> NativeComposerPresentation? {
        guard let event = composerPresentation, event.contextID == contextID, contextID == snapshot.contextId,
              composerCanEdit, !sidebarOpen else { return nil }
        composerPresentation = nil
        switch event.presentation {
        case .focus: break
        case .attachments: attachmentOpen = true
        case .photos: command("attachment.pick", ["kind": .string("photos")])
        case .files: command("attachment.pick", ["kind": .string("files")])
        }
        return event.presentation
    }
    func chooseComposerOption(_ name: String, value: String, contextID: String?) {
        guard composerCanEdit, contextID == snapshot.contextId,
              ["model.select", "effort.select", "speed.select", "permission.select"].contains(name) else { return }
        var params: [String: NativeJSONValue] = ["value": .string(value)]
        if let contextID { params["contextId"] = .string(contextID) }
        command(name, params)
    }
    func command(_ name: String, _ params: [String: NativeJSONValue] = [:]) {
        if name == "thread.new" { startNewConversation(params: params); return }
        if ["thread.open", "backend.select", "drafts.restore", "drafts.open", "settings.open", "navigation.filter", "newchat.backend", "newchat.project"].contains(name) {
            cancelComposerPresentation()
        }
        let editingCommands: Set<String> = ["draft.set", "draft.save", "model.select", "effort.select", "speed.select", "permission.select", "attachment.pick", "attachment.remove", "location.insert", "mention.search", "mention.insert"]
        if editingCommands.contains(name), !composerCanEdit { return }
        if name == "panel.open", ["permission", "mentions"].contains({ if case .string(let id) = params["id"] { return id }; return "" }()), !composerCanEdit { return }
        if name == "panel.open", !snapshot.ready || awaitingNewConversation { return }
        if ["attachment.preview", "queue.cancel", "queue.send", "queue.edit", "queue.change"].contains(name), !snapshot.ready || awaitingNewConversation { return }
        if name == "message.send", !composerCanSend { return }
        if name == "turn.stop", !composerCanInterrupt { return }
        if name != "message.copy" { notice = nil }
        if name == "message.copy" {
            guard case .string(let id) = params["id"], let message = snapshot.messages.first(where: { $0.id == id }) else {
                commandError = label("消息已更新，请重新选择", "The message changed. Please select it again.")
                return
            }
            guard let copyText else { commandError = label("剪贴板尚未就绪", "Clipboard is not ready"); return }
            copyText(NativePlainText.message(message.text, role: message.role))
            notice = label("已复制", "Copied")
            return
        }
        if isReference {
            if NativeHistoryEditReference.handle(name, params: params, snapshot: &snapshot, error: &commandError) { return }
            if name == "project.toggle", let index = snapshot.groups.firstIndex(where: { $0.command?.name == "project.toggle" && $0.command?.params == params }) {
                snapshot.groups[index].collapsed = snapshot.groups[index].collapsed != true
            }
            if name == "project.more", let index = snapshot.groups.firstIndex(where: { $0.command?.params == params }) {
                snapshot.groups[index].items.append(NativeNavigationItem(id: "visual-more", title: "加载出的历史会话"))
                snapshot.groups[index].actions = []
            }
            if name == "settings.open", case .string(let id) = params["id"] {
                if id == "devices" { snapshot.panel = NativeReferenceSettings.devices(locale: snapshot.locale); return }
                if id == "notifications" { snapshot.panel = NativeReferenceSettings.notifications(locale: snapshot.locale); return }
                snapshot.panel = id == "settings" ? NativeReferenceSettings.panel(locale: snapshot.locale) : NativePanel(id: "reference-settings:\(id)", title: label("设置", "Settings"), items: [NativePanelItem(id: "reference-setting-value", kind: "text", title: id == "devices" ? label("设备", "Devices") : label("检查更新", "Check for Updates"))])
            }
            if ["device.add", "device.edit"].contains(name) { snapshot.panel = NativeReferenceSettings.deviceForm(locale: snapshot.locale) }
            if name == "device.cancel" { snapshot.panel = NativeReferenceSettings.devices(locale: snapshot.locale) }
            if name == "settings.push.mode" { snapshot.panel = NativeReferenceSettings.notifications(locale: snapshot.locale, bark: params["value"] == .string("bark")) }
            if name == "settings.language", case .string(let value) = params["value"] {
                if value != "system" { snapshot.locale = value }
                snapshot.panel = NativeReferenceSettings.panel(locale: snapshot.locale)
            }
            if ["model.select", "effort.select", "permission.select", "speed.select"].contains(name), case .string(let value) = params["value"] {
                if name == "model.select", let option = snapshot.models.first(where: { $0.value == value }) { snapshot.modelValue = value; snapshot.model = option.title }
                if name == "effort.select", let option = snapshot.efforts.first(where: { $0.value == value }) { snapshot.effortValue = value; snapshot.effort = option.title }
                if name == "permission.select", let option = snapshot.permissions?.first(where: { $0.value == value }) { snapshot.permissionValue = value; snapshot.permission = option.title }
                if name == "speed.select", let option = snapshot.speeds?.first(where: { $0.value == value }) { snapshot.speedValue = value; snapshot.speed = option.title }
            }
            if name == "attachment.preview", params["id"] == .string("reference-audio") {
                snapshot.panel = NativePanel(id: "attachment:reference-audio", title: "silence.wav", items: [NativePanelItem(id: "audio", kind: "audio", title: "silence.wav", value: NativeReferenceAudio.source())])
            }
            if name == "message.send", !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                if snapshot.busy {
                    let id = UUID().uuidString
                    let cancel = NativePanelItem(id: "\(id):cancel", kind: "action", title: "移除", command: NativeCommand(name: "queue.cancel", params: ["id": .string(id)]))
                    snapshot.queued.append(NativeNavigationItem(id: id, title: draft, subtitle: "排队中", command: NativeCommand(name: "queue.send", params: ["id": .string(id)]), actions: [cancel]))
                } else {
                    snapshot.messages.append(NativeMessage(id: UUID().uuidString, role: "user", text: draft))
                }
                draft = ""
                timeline(for: threadKey).receive(messageIDs: snapshot.messages.map(\.id))
            }
            if name == "turn.stop" { snapshot.busy = false; snapshot.canInterrupt = false }
            if ["queue.cancel", "queue.send"].contains(name), case .string(let id) = params["id"] { snapshot.queued.removeAll { $0.id == id } }
            return
        }
        var contextual = params
        if !Self.globalCommands.contains(name), contextual["contextId"] == nil, let context = snapshot.contextId {
            contextual["contextId"] = .string(context)
        }
        sendCommand?(NativeCommand(name: name, params: contextual))
    }
    func perform(_ command: NativeCommand?) {
        guard let command else { return }
        if command.name == "thread.manage", command.params["action"] == .string("rename"), command.params["value"] == nil {
            cancelComposerPresentation()
            promptValue = ""
            textPrompt = NativeTextPrompt(title: label("重命名会话", "Rename Conversation"), command: command)
            return
        }
        self.command(command.name, command.params)
    }
    func confirmTextPrompt(_ presented: NativeTextPrompt? = nil) {
        guard let prompt = presented ?? textPrompt, !promptValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        var params = prompt.command.params
        params["value"] = .string(promptValue)
        textPrompt = nil
        command(prompt.command.name, params)
    }
    func label(_ chinese: String, _ english: String) -> String {
        snapshot.locale.lowercased().hasPrefix("zh") ? chinese : english
    }
    var composerText: String {
        get { draft }
        set {
            guard composerCanEdit, draft != newValue else { return }
            let lengthChange = newValue.utf16.count - draft.utf16.count
            draft = newValue
            caretOffset = min(newValue.utf16.count, max(0, caretOffset + lengthChange))
            updateDraft()
        }
    }
    var sidebarIsOpen: Bool {
        get { sidebarOpen }
        set {
            guard sidebarOpen != newValue else { return }
            cancelComposerPresentation()
            sidebarOpen = newValue
            fieldRevision += 1
            pendingSidebarRevision = fieldRevision
            command("navigation.sidebar", ["open": .bool(newValue), "fieldKey": .string("sidebar-state"), "fieldRevision": .number(Double(fieldRevision))])
        }
    }
    var sidebarSearchText: String {
        get { search }
        set {
            guard search != newValue else { return }
            search = newValue
            fieldRevision += 1
            pendingSearchRevision = fieldRevision
            command("navigation.search", ["value": .string(newValue), "fieldKey": .string("sidebar-search"), "fieldRevision": .number(Double(fieldRevision))])
        }
    }
    func updateDraft() {
        guard composerCanEdit else { return }
        draftRevision += 1
        command("draft.set", ["value": .string(draft), "revision": .number(Double(draftRevision)), "caretOffset": .number(Double(caretOffset))])
    }
    func setCaretOffset(_ offset: Int) {
        guard composerCanEdit else { return }
        let bounded = min(draft.utf16.count, max(0, offset))
        guard caretOffset != bounded else { return }
        caretOffset = bounded
        updateDraft()
    }
    var contextKey: String { snapshot.contextId ?? "\(snapshot.backendId ?? "reference"):\(snapshot.threadId ?? "new")" }
    var threadKey: String { "\(snapshot.backendId ?? "reference"):\(snapshot.threadId ?? "new:\(contextKey)")" }
    func timeline(for key: String) -> NativeTimelineState {
        if let timeline = timelines[key] { return timeline }
        let value = NativeTimelineState()
        timelines[key] = value
        return value
    }
    func sendFieldEdit(_ item: NativePanelItem, scope: NativeFieldScope, values: [String: NativeJSONValue]) {
        guard let action = item.command else { return }
        if case .historyEdit(let contextID, let messageID, let editID) = scope {
            guard contextID == (snapshot.contextId ?? ""),
                  let editor = snapshot.messages.first(where: { $0.id == messageID })?.historyEdit,
                  editor.id == editID, editor.items.first(where: { $0.id == item.id })?.disabled != true else { return }
        }
        let key = NativeFieldKey(scope: scope, itemID: item.id)
        fieldRevision += 1
        pendingFields[key] = fieldRevision
        var params = action.params.merging(values) { _, new in new }
        params["fieldKey"] = .string(key.wireValue)
        params["fieldRevision"] = .number(Double(fieldRevision))
        command(action.name, params)
    }
}
