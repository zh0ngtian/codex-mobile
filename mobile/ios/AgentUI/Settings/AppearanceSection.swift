import SwiftUI

struct AppearanceSection: View {
    @Environment(AppPreferences.self) private var preferences

    var body: some View {
        @Bindable var preferences = preferences
        SettingsSection(title: preferences.text("主题", "Theme")) {
            Menu {
                Picker(preferences.text("外观", "Appearance"), selection: $preferences.appearance) {
                    ForEach(AgentAppearance.allCases) { appearance in Text(preferences.appearanceName(appearance)).tag(appearance) }
                }
                .pickerStyle(.inline)
            } label: {
                HStack(spacing: 0) {
                    SettingsRow(title: preferences.text("外观", "Appearance"), symbol: "sun.max", disclosure: false)
                    HStack(spacing: 5) {
                        Text(preferences.appearanceName(preferences.appearance)).font(AgentTheme.body).foregroundStyle(.secondary)
                        Image(systemName: "chevron.up.chevron.down").font(AgentTheme.caption).foregroundStyle(.secondary)
                    }
                    .padding(.trailing, 16)
                    .fixedSize()
                }
            }
            .tint(AgentTheme.ink)
            .buttonStyle(.plain)
            .accessibilityLabel(preferences.text("外观", "Appearance"))
            .accessibilityValue(preferences.appearanceName(preferences.appearance))
            SettingsDivider()
            Menu {
                Picker(preferences.text("强调色", "Accent color"), selection: $preferences.accent) {
                    ForEach(AgentAccent.allCases) { accent in
                        AccentMenuLabel(accent: accent).tag(accent)
                    }
                }
                .pickerStyle(.inline)
            } label: {
                HStack(spacing: 0) {
                    SettingsRow(title: preferences.text("强调色", "Accent color"), symbol: "paintpalette", disclosure: false)
                    HStack(spacing: 5) {
                        Text(preferences.accentName(preferences.accent)).font(AgentTheme.body).foregroundStyle(.secondary)
                        Image(systemName: "chevron.up.chevron.down").font(AgentTheme.caption).foregroundStyle(.secondary)
                    }
                    .padding(.trailing, 16)
                    .fixedSize()
                }
            }
            .tint(AgentTheme.ink)
            .buttonStyle(.plain)
            .accessibilityLabel(preferences.text("强调色", "Accent color"))
            .accessibilityValue(preferences.accentName(preferences.accent))
        }
    }
}
