import SwiftUI

struct SettingsCloseButton: ToolbarContent {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            if session.settingsPresented {
                Button(preferences.text("关闭设置", "Close settings"), systemImage: "xmark", action: close)
                    .labelStyle(.iconOnly)
                    .disabled(session.deviceTesting)
                    .accessibilityIdentifier("settings.close")
            }
        }
    }

    private func close() { session.settingsPresented = false }
}
