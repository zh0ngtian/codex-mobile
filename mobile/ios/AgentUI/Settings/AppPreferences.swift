import Foundation
import Observation

@MainActor @Observable
final class AppPreferences {
    private let defaults: UserDefaults
    @ObservationIgnored private weak var store: NativeUIStore?
    @ObservationIgnored private var receiving = false
    var appearance: AgentAppearance { didSet { defaults.set(appearance.rawValue, forKey: "appearance") } }
    var accent: AgentAccent { didSet { defaults.set(accent.rawValue, forKey: "accent") } }
    var language: String { didSet { if !receiving, language != oldValue { store?.command("settings.language", ["value": .string(language == "简体中文" ? "zh-CN" : language == "English" ? "en" : "system")]) } } }
    var transport: String { didSet { if !receiving, transport != oldValue { store?.command("settings.transport", ["value": .string(transport == "Stream" ? "stream" : "http")]) } } }
    var notificationMethod: String
    var barkURL: String
    private(set) var barkConfigured = false
    private(set) var settingsError: String?
    private(set) var notificationSyncWarning: String?

    func connect(store: NativeUIStore) { self.store = store }

    func receive(_ snapshot: NativeSnapshot) {
        receiving = true
        defer { receiving = false }
        if let values = snapshot.preferences {
            language = values.language == "zh-CN" ? "简体中文" : values.language == "en" ? "English" : "System"
            transport = values.transportMode == "stream" ? "Stream" : "HTTP"
            notificationMethod = values.notificationMode == "bark" ? "Bark" : "System"
            barkConfigured = values.barkConfigured ?? false
        }
        if snapshot.panel?.id == "settings:notifications" {
            barkURL = snapshot.panel?.items.first { $0.id == "bark-url" }?.value ?? barkURL
            notificationSyncWarning = snapshot.panel?.items.first { $0.id == "push-failed" }?.text
        } else { barkURL = ""; notificationSyncWarning = nil }
        settingsError = snapshot.commandResults?.last(where: { $0.name.hasPrefix("settings.") })?.error
    }

    var nativeInterfaceEnabled: Bool { store?.savedNativePreference ?? true }
    var nativeInterfaceSaving: Bool { store?.preferenceSaving ?? false }
    var canChangeNativeInterface: Bool { store?.canChangeNativePreference ?? false }
    var nativeInterfaceError: String? { store?.preferenceError }
    func changeNativeInterface(_ enabled: Bool) { store?.requestNativePreference(enabled) }
    func openNotifications() async -> Bool {
        guard let store else { return false }
        store.command("settings.open", ["id": .string("notifications")])
        for _ in 0..<200 {
            if store.snapshot.panel?.id == "settings:notifications" { receive(store.snapshot); return true }
            do { try await Task.sleep(for: .milliseconds(50)) } catch { return false }
        }
        settingsError = text("通知设置未就绪，请重试。", "Notification settings are not ready. Try again.")
        return false
    }
    func saveNotifications(method: String, url: String) async -> Bool {
        guard let store else { return false }
        let mode = method == "Bark" ? "bark" : "system"
        store.command("settings.push.mode", ["value": .string(mode)])
        guard await waitForNotificationField("push", value: mode) else { return false }
        if method == "Bark" {
            store.command("settings.push.url", ["value": .string(url)])
            guard await waitForNotificationField("bark-url", value: url) else { return false }
        }
        let preceding = Set((store.snapshot.commandResults ?? []).map(\.id))
        store.command("settings.push.save")
        for _ in 0..<400 {
            if let result = store.snapshot.commandResults?.last(where: { $0.name == "settings.push.save" && !preceding.contains($0.id) }) {
                settingsError = result.error
                return result.ok
            }
            do { try await Task.sleep(for: .milliseconds(50)) } catch { return false }
        }
        settingsError = text("通知设置保存超时，请重试。", "Saving notification settings timed out. Try again.")
        return false
    }

    private func waitForNotificationField(_ id: String, value: String) async -> Bool {
        guard let store else { return false }
        for _ in 0..<200 {
            if store.snapshot.panel?.id == "settings:notifications",
               store.snapshot.panel?.items.first(where: { $0.id == id })?.value == value { return true }
            do { try await Task.sleep(for: .milliseconds(50)) } catch { return false }
        }
        settingsError = text("通知设置未同步，请重试。", "Notification settings have not synchronized. Try again.")
        return false
    }

    var isEnglish: Bool {
        switch language {
        case "English": true
        case "简体中文": false
        default: Locale.preferredLanguages.first?.hasPrefix("zh") != true
        }
    }

    var languageTitle: String { language == "System" ? text("跟随系统", "System") : language }

    func text(_ chinese: String, _ english: String) -> String { isEnglish ? english : chinese }

    func appearanceName(_ value: AgentAppearance) -> String {
        switch value {
        case .system: text("跟随系统", "System")
        case .light: text("浅色", "Light")
        case .dark: text("深色", "Dark")
        }
    }

    func accentName(_ value: AgentAccent) -> String {
        switch value {
        case .blue: text("蓝色", "Blue")
        case .cyan: text("青色", "Cyan")
        case .green: text("绿色", "Green")
        case .lime: text("青柠", "Lime")
        case .yellow: text("黄色", "Yellow")
        case .orange: text("橙色", "Orange")
        case .pink: text("粉色", "Pink")
        case .magenta: text("洋红", "Magenta")
        case .purple: text("紫色", "Purple")
        case .black: text("黑色", "Black")
        }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        appearance = AgentAppearance(rawValue: defaults.string(forKey: "appearance") ?? "") ?? .system
        accent = AgentAccent(rawValue: defaults.string(forKey: "accent") ?? "") ?? .black
        language = "System"
        transport = "HTTP"
        notificationMethod = "System"
        barkURL = ""
        defaults.removeObject(forKey: "barkURL")
    }
}
