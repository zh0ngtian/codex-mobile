import SwiftUI

struct SettingsScreen: View {
    @Environment(AppPreferences.self) private var preferences
    @Environment(AppSession.self) private var session
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            Form {
                Section(preferences.text("应用", "Application")) {
                    NavigationLink(value: SettingsRoute.language) { SettingsRow(title: preferences.text("语言", "Language"), symbol: "globe", value: preferences.languageTitle) }
                    NavigationLink(value: SettingsRoute.devices) { SettingsRow(title: preferences.text("设备", "Devices"), symbol: "desktopcomputer", value: "\(session.devices.count)/8") }
                    NavigationLink(value: SettingsRoute.transport) { SettingsRow(title: preferences.text("传输方式", "Transport"), symbol: "arrow.left.arrow.right", value: preferences.transport) }
                    NavigationLink(value: SettingsRoute.notifications) { SettingsRow(title: preferences.text("通知", "Notifications"), symbol: "bell", value: notificationSummary) }
                }
                AppearanceSection()
                Section {
                    Toggle(isOn: Binding(get: { preferences.nativeInterfaceEnabled }, set: preferences.changeNativeInterface)) {
                        Label(preferences.text("原生界面", "Native interface"), systemImage: "iphone")
                    }
                    .disabled(!preferences.canChangeNativeInterface || preferences.nativeInterfaceSaving)
                    .accessibilityIdentifier("native-ui-preference")
                    if preferences.nativeInterfaceSaving { ProgressView() }
                    if let error = preferences.nativeInterfaceError { Text(error).foregroundStyle(.red) }
                } header: { Text(preferences.text("界面", "Interface")) }
                footer: { Text(preferences.text("关闭后，下次完整启动使用网页界面。", "When off, the next full launch uses the web interface.")) }
                Section(preferences.text("关于", "About")) {
                    LabeledContent { Text(version).foregroundStyle(.secondary) } label: { Label(preferences.text("当前版本", "Current version"), systemImage: "info.circle") }
                }
            }
            .accessibilityIdentifier("settings.form")
            .navigationTitle(preferences.text("设置", "Settings"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { SettingsCloseButton() }
            .navigationDestination(for: SettingsRoute.self) { route in
                switch route {
                case .language: LanguageSettingsScreen()
                case .devices: DeviceManagerScreen()
                case .transport: TransportSettingsScreen()
                case .notifications: NotificationSettingsScreen()
                }
            }
        }
        .task { session.openSettingsPage("settings") }
        .interactiveDismissDisabled()
        .tint(AgentTheme.ink)
    }

    private var notificationSummary: String {
        return preferences.notificationMethod == "System" ? preferences.text("系统", "System") : "Bark"
    }

    private var version: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(version) (\(build))"
    }
}
