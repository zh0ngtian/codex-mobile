import Foundation

enum AgentAccent: String {
    case blue = "Blue", cyan = "Cyan", green = "Green", lime = "Lime", yellow = "Yellow", orange = "Orange", pink = "Pink", magenta = "Magenta", purple = "Purple", black = "Black"
}
@MainActor final class NativeUIStore {
    var commands: [(String, [String: NativeJSONValue])] = []
    var snapshot = NativeSnapshot()
    var savedNativePreference = true
    var preferenceSaving = false
    var canChangeNativePreference = true
    var preferenceError: String?
    func command(_ name: String, _ params: [String: NativeJSONValue] = [:]) { commands.append((name, params)) }
    func requestNativePreference(_ enabled: Bool) { savedNativePreference = enabled }
}

@main struct AgentPreferencesSmoke {
    @MainActor static func main() {
        let suite = "AgentUIPreferenceSmoke-\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = AppPreferences(defaults: defaults)
        let store = NativeUIStore()
        preferences.connect(store: store)
        var snapshot = NativeSnapshot()
        snapshot.preferences = NativeSettingsPreferences(language: "en", transportMode: "stream", fontSize: "standard", notificationMode: "bark", barkConfigured: true)
        preferences.receive(snapshot)
        precondition(preferences.language == "English", "真实语言必须覆盖原型本地偏好")
        precondition(preferences.transport == "Stream", "真实传输配置必须同步")
        precondition(preferences.notificationMethod == "Bark")
        precondition(store.commands.isEmpty, "收到快照不能反向写回业务层")
        preferences.language = "简体中文"
        precondition(store.commands.last?.0 == "settings.language")
        precondition(store.commands.last?.1["value"] == .string("zh-CN"))
        preferences.transport = "HTTP"
        precondition(store.commands.last?.0 == "settings.transport")
        precondition(store.commands.last?.1["value"] == .string("http"))
        preferences.accent = .blue
        precondition(defaults.string(forKey: "accent") == "Blue")
        preferences.appearance = .dark
        precondition(defaults.string(forKey: "appearance") == "Dark")
        precondition(store.commands.count == 2, "外观偏好只保存在本机")
        print("Agent preferences smoke passed")
    }
}
