import Foundation
import Observation

@MainActor @Observable
final class NativeUIStore {
    var snapshot = NativeSnapshot()
    var draft = ""
    var sidebarOpen = false
    var settingsOpen = false
    var search = ""
    var attachmentOpen = false
    private var fieldValues: [NativeFieldKey: String] = [:]
    private var fieldSelections: [NativeFieldKey: [String]] = [:]
    private var pendingFields: [NativeFieldKey: Int] = [:]
    private var fieldRevision = 0
    private var draftRevision = 0
    private var pendingSearchRevision: Int? = nil
    private var pendingSidebarRevision: Int? = nil
    private var receivedResultIDs: Set<String> = []
    var commandError: String? = nil
    private(set) var caretOffset = 0
    var notice: String? = nil
    var showLegacyForRecovery = false
    @ObservationIgnored var sendCommand: ((NativeCommand) -> Void)?
    @ObservationIgnored var copyText: ((String) -> Void)?
    @ObservationIgnored private var timelines: [String: NativeTimelineState] = [:]
    let isReference: Bool
    let nativeEnabled: Bool
    static let preferenceKey = "codexMobile.useNativeUI"

    static let launchPreference = UserDefaults.standard.bool(forKey: preferenceKey)

    init(arguments: [String] = ProcessInfo.processInfo.arguments) {
        isReference = arguments.contains("--native-ui-reference") || arguments.contains("--native-ui-reference-conversation")
        #if DEBUG
        nativeEnabled = isReference || Self.launchPreference || arguments.contains("--native-ui-live")
        #else
        nativeEnabled = isReference || Self.launchPreference
        #endif
        if isReference {
            snapshot.ready = true
            snapshot.connection = "connected"
            snapshot.title = "UI测试回复示例"
            snapshot.model = "GPT-5"
            snapshot.effort = "中等推理"
            snapshot.groups = [NativeGroup(id: "projects", title: "项目", items: [NativeNavigationItem(id: "reference", title: "Codex Mobile", subtitle: "原生界面基准")]), NativeGroup(id: "today", title: "今天", items: [NativeNavigationItem(id: "conversation", title: "UI 原生测试", selected: true)])]
            if arguments.contains("--native-ui-reference-conversation") {
                snapshot.messages = [NativeMessage(id: "user", role: "user", text: "这是一次 UI 探索测试（UI-20261014）。请用中文简短回复：一个二级标题、两条列表，再用 Swift 代码块展示 print(\"Hello\")。最后说明 12 × 13 的结果。"), NativeMessage(id: "assistant", role: "assistant", text: "## UI 探索测试\n- 测试标识：UI-20261014\n- 内容：二级标题、两条列表、Swift 代码块\n\n```swift\nprint(\"Hello\")\n```\n\n12 × 13 = 156", status: "已思考（用时 1 秒）")]
            }
            if arguments.contains("--native-ui-reference-long") {
                snapshot.messages = (1...80).map { index in
                    NativeMessage(id: "reference-history-\(index)", role: "assistant", text: "历史消息 \(index)\n这是用于验证分页与阅读位置的离线参考内容。")
                }
            }
            if arguments.contains("--native-ui-reference-busy") {
                snapshot.threadId = "reference-thread"
                snapshot.busy = true
                snapshot.canInterrupt = true
                draft = "等待上一轮完成后的测试消息"
                caretOffset = draft.utf16.count
            }
        }
    }
    func receive(_ value: NativeSnapshot) {
        guard value.version == 1, !isReference else { return }
        let contextChanged = value.contextId != snapshot.contextId
        let panelChanged = value.panel?.id != snapshot.panel?.id
        if contextChanged {
            pendingFields.removeAll()
            draftRevision = value.draftRevision ?? 0
            pendingSearchRevision = nil
            receivedResultIDs.removeAll()
            commandError = nil
        }
        if panelChanged {
            pendingFields = pendingFields.filter { key, _ in
                if case .panel = key.scope { return false }
                return true
            }
        }
        for result in value.commandResults ?? [] {
            guard result.contextId == nil || result.contextId == value.contextId else { continue }
            if let key = result.fieldKey, let revision = result.fieldRevision {
                pendingFields = pendingFields.filter { $0.key.wireValue != key || $0.value > revision }
                if key == "sidebar-search", let pending = pendingSearchRevision, revision >= pending { pendingSearchRevision = nil }
                if key == "sidebar-state", let pending = pendingSidebarRevision, revision >= pending { pendingSidebarRevision = nil }
            }
            if !receivedResultIDs.contains(result.id), !result.ok {
                commandError = result.error ?? label("操作未完成，请重试", "The operation failed. Please retry.")
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
        if pendingSidebarRevision == nil, let open = value.sidebarOpen { sidebarOpen = open }
        timeline(for: threadKey).receive(messageIDs: value.messages.map(\.id))
        if contextChanged || (value.draftRevision ?? 0) >= draftRevision {
            if draft != value.draft { draft = value.draft }
            caretOffset = min(draft.utf16.count, max(0, value.caretOffset ?? draft.utf16.count))
        }
        if pendingSearchRevision == nil, let search = value.search, self.search != search { self.search = search }
    }
    func fieldValue(_ item: NativePanelItem, scope: NativeFieldScope) -> String {
        fieldValues[NativeFieldKey(scope: scope, itemID: item.id)] ?? item.value ?? ""
    }
    func setFieldValue(_ value: String, item: NativePanelItem, scope: NativeFieldScope) {
        fieldValues[NativeFieldKey(scope: scope, itemID: item.id)] = value
    }
    func selectedValues(_ item: NativePanelItem, scope: NativeFieldScope) -> [String] {
        fieldSelections[NativeFieldKey(scope: scope, itemID: item.id)] ?? item.values ?? []
    }
    func setSelectedValues(_ values: [String], item: NativePanelItem, scope: NativeFieldScope) {
        fieldSelections[NativeFieldKey(scope: scope, itemID: item.id)] = values
    }
    func closePanel() {
        guard let panel = snapshot.panel else { return }
        let scope = NativeFieldScope.panel(panel.id)
        fieldValues = fieldValues.filter { $0.key.scope != scope }
        fieldSelections = fieldSelections.filter { $0.key.scope != scope }
        pendingFields = pendingFields.filter { $0.key.scope != scope }
        snapshot.panel = nil
        command("panel.close", ["id": .string(panel.id)])
    }
    func command(_ name: String, _ params: [String: NativeJSONValue] = [:]) {
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
            if name == "thread.new" {
                snapshot.messages = []; draft = ""; sidebarOpen = false
                snapshot.contextId = "reference:\(UUID().uuidString)"
                snapshot.threadId = nil
            }
            if name == "message.send", !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                if snapshot.busy {
                    let id = UUID().uuidString
                    let cancel = NativePanelItem(id: "\(id):cancel", kind: "action", title: "移除", command: NativeCommand(name: "queue.cancel", params: ["id": .string(id)]))
                    snapshot.queued.append(NativeNavigationItem(id: id, title: draft, subtitle: "排队中", actions: [cancel]))
                } else {
                    snapshot.messages.append(NativeMessage(id: UUID().uuidString, role: "user", text: draft))
                }
                draft = ""
                timeline(for: threadKey).receive(messageIDs: snapshot.messages.map(\.id))
            }
            if name == "turn.stop" { snapshot.busy = false; snapshot.canInterrupt = false }
            if name == "queue.cancel", case .string(let id) = params["id"] { snapshot.queued.removeAll { $0.id == id } }
            return
        }
        var contextual = params
        if contextual["contextId"] == nil, let context = snapshot.contextId { contextual["contextId"] = .string(context) }
        sendCommand?(NativeCommand(name: name, params: contextual))
    }
    func perform(_ command: NativeCommand?) {
        guard let command else { return }
        self.command(command.name, command.params)
    }
    func label(_ chinese: String, _ english: String) -> String {
        snapshot.locale.lowercased().hasPrefix("zh") ? chinese : english
    }
    var composerText: String {
        get { draft }
        set {
            guard draft != newValue else { return }
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
        draftRevision += 1
        command("draft.set", ["value": .string(draft), "revision": .number(Double(draftRevision)), "caretOffset": .number(Double(caretOffset))])
    }
    func setCaretOffset(_ offset: Int) {
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
        let key = NativeFieldKey(scope: scope, itemID: item.id)
        fieldRevision += 1
        pendingFields[key] = fieldRevision
        var params = action.params.merging(values) { _, new in new }
        params["fieldKey"] = .string(key.wireValue)
        params["fieldRevision"] = .number(Double(fieldRevision))
        command(action.name, params)
    }
}
