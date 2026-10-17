import SwiftUI

struct SettingsScreen: View {
    @Environment(AppPreferences.self) private var preferences
    @Environment(AppSession.self) private var session
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 0) {
                    SettingsSection(title: preferences.text("应用", "Application"), topSpacing: 20) {
                        NavigationLink(value: SettingsRoute.language) {
                            SettingsRow(title: preferences.text("语言", "Language"), symbol: "globe", value: preferences.languageTitle)
                        }
                        SettingsDivider()
                        NavigationLink(value: SettingsRoute.devices) {
                            SettingsRow(title: preferences.text("设备", "Devices"), symbol: "desktopcomputer", value: "\(session.devices.count)/8")
                        }
                        SettingsDivider()
                        NavigationLink(value: SettingsRoute.transport) {
                            SettingsRow(title: preferences.text("传输方式", "Transport"), symbol: "arrow.left.arrow.right", value: preferences.transport)
                        }
                        SettingsDivider()
                        NavigationLink(value: SettingsRoute.notifications) {
                            SettingsRow(title: preferences.text("通知", "Notifications"), symbol: "bell", value: notificationSummary)
                        }
                    }
                    AppearanceSection()
                    SettingsSection(title: preferences.text("界面", "Interface")) {
                        Toggle(isOn: Binding(get: { preferences.nativeInterfaceEnabled }, set: preferences.changeNativeInterface)) {
                            Label(preferences.text("原生界面", "Native interface"), systemImage: "iphone")
                        }
                        .padding(16)
                        .disabled(!preferences.canChangeNativeInterface || preferences.nativeInterfaceSaving)
                        .accessibilityIdentifier("native-ui-preference")
                        if preferences.nativeInterfaceSaving { ProgressView().padding(.bottom, 12) }
                        if let error = preferences.nativeInterfaceError {
                            Text(error).font(.body).foregroundStyle(.red).padding(.horizontal, 16)
                        }
                        Text(preferences.text("关闭后，下次完整启动使用网页界面。", "When off, the next full launch uses the web interface."))
                            .font(.body).foregroundStyle(.secondary).padding(16)
                    }
                    SettingsSection(title: preferences.text("关于", "About")) {
                        SettingsRow(title: preferences.text("当前版本", "Current version"), symbol: "info.circle", value: version, disclosure: false)
                    }
                }
                .padding(.horizontal, 16)
                .buttonStyle(.plain)
            }
            .scrollIndicators(.hidden)
            .background(AgentTheme.settings)
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
