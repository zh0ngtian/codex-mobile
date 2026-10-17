import SwiftUI

struct LanguageSettingsScreen: View {
    @Environment(AppPreferences.self) private var preferences

    var body: some View {
        @Bindable var preferences = preferences
        Form {
            Section {
                Picker(preferences.text("语言", "Language"), selection: $preferences.language) {
                    Text(preferences.text("跟随系统", "System")).tag("System")
                    Text("简体中文").tag("简体中文")
                    Text("English").tag("English")
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } footer: {
                Text(preferences.text("选择后立即切换界面语言，并保存到现有应用设置。", "The interface changes immediately and is saved in the app settings."))
            }
        }
        .navigationTitle(preferences.text("语言", "Language"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { SettingsCloseButton() }
    }
}
