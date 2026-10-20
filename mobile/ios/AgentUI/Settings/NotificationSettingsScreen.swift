import SwiftUI
import UserNotifications

struct NotificationSettingsScreen: View {
    @Environment(AppPreferences.self) private var preferences
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var method = "System"
    @State private var barkURL = ""
    @State private var loaded = false
    @State private var error: String?
    @State private var saving = false
    @State private var authorizationStatus: UNAuthorizationStatus = .notDetermined

    var body: some View {
        Form {
            Section {
                Picker(preferences.text("通知方式", "Delivery"), selection: $method) {
                    Text(preferences.text("系统", "System")).tag("System")
                    Text("Bark").tag("Bark")
                }
                .disabled(saving)
                if method == "Bark" {
                    TextField(preferences.text("完整 Bark 地址", "Full Bark URL"), text: $barkURL,
                              prompt: Text("https://api.day.app/BARK_DEVICE_KEY").foregroundStyle(.secondary), axis: .vertical)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .lineLimit(2...5)
                        .disabled(saving)
                        .privacySensitive()
                }
                if method == "System" {
                    LabeledContent(preferences.text("系统通知权限", "System notification permission"), value: authorizationTitle)
                }
            } footer: {
                Text(preferences.text("这里是候选配置。只有点击“保存”才会生效；返回或关闭会丢弃未保存的修改。", "These are candidate settings. Tap Save to apply them. Back or Close discards unsaved changes."))
            }
            if let warning = preferences.notificationSyncWarning {
                Section { Label(warning, systemImage: "exclamationmark.arrow.triangle.2.circlepath").foregroundStyle(.orange) }
            }
            if let error {
                Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
            }
        }
        .navigationTitle(preferences.text("通知", "Notifications"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(preferences.text("保存", "Save")) { Task { await save() } }
                    .disabled(!loaded || saving || !hasChanges)
                    .accessibilityIdentifier("notifications.save")
            }
            SettingsCloseButton()
        }
        .task { await load() }
    }

    private var hasChanges: Bool {
        method != preferences.notificationMethod || barkURL != preferences.barkURL
    }

    private func load() async {
        guard !loaded else { return }
        authorizationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        guard await preferences.openNotifications() else { error = preferences.settingsError; return }
        method = preferences.notificationMethod
        barkURL = preferences.barkURL
        loaded = true
    }

    private var authorizationTitle: String {
        switch authorizationStatus {
        case .authorized, .provisional, .ephemeral: preferences.text("已允许", "Allowed")
        case .denied: preferences.text("已关闭，请在系统设置中允许", "Off. Allow in system settings")
        case .notDetermined: preferences.text("尚未授权", "Not requested")
        @unknown default: preferences.text("未知", "Unknown")
        }
    }

    private func save() async {
        let address = barkURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if method == "Bark" {
            guard let components = URLComponents(string: address),
                  ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
                  let host = components.host, !host.isEmpty else {
                error = preferences.text("请输入以 http:// 或 https:// 开头的完整 Bark 地址。", "Enter a full Bark URL beginning with http:// or https://.")
                return
            }
        }
        saving = true
        defer { saving = false }
        guard await preferences.saveNotifications(method: method, url: address) else {
            error = preferences.settingsError ?? preferences.text("保存失败，请重试。", "Could not save. Try again.")
            return
        }
        session.toast = preferences.text("通知偏好已保存", "Notification preferences saved")
        dismiss()
    }
}
