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
    var fieldValues: [String: String] = [:]
    var fieldSelections: [String: [String]] = [:]
    var showLegacyForRecovery = false
    @ObservationIgnored var sendCommand: ((NativeCommand) -> Void)?
    let isReference: Bool
    let nativeEnabled: Bool
    static let preferenceKey = "codexMobile.useNativeUI"

    static let launchPreference = UserDefaults.standard.bool(forKey: preferenceKey)

    init(arguments: [String] = ProcessInfo.processInfo.arguments) {
        isReference = arguments.contains("--native-ui-reference") || arguments.contains("--native-ui-reference-conversation")
        nativeEnabled = isReference || Self.launchPreference
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
        }
    }
    func receive(_ value: NativeSnapshot) {
        guard value.version == 1, !isReference else { return }
        snapshot = value
        if draft != value.draft { draft = value.draft }
    }
    func command(_ name: String, _ params: [String: NativeJSONValue] = [:]) {
        if isReference {
            if name == "thread.new" { snapshot.messages = []; sidebarOpen = false }
            if name == "message.send", !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                snapshot.messages.append(NativeMessage(id: UUID().uuidString, role: "user", text: draft))
                draft = ""
            }
            return
        }
        sendCommand?(NativeCommand(name: name, params: params))
    }
    func perform(_ command: NativeCommand?) {
        guard let command else { return }
        self.command(command.name, command.params)
    }
    func label(_ chinese: String, _ english: String) -> String {
        snapshot.locale.lowercased().hasPrefix("zh") ? chinese : english
    }
    func updateDraft() { command("draft.set", ["value": .string(draft)]) }
}
