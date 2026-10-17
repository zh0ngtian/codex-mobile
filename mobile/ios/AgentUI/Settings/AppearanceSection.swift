import SwiftUI

struct AppearanceSection: View {
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        @Bindable var preferences = preferences
        Section(preferences.text("主题", "Theme")) {
            Picker(selection: $preferences.appearance) {
                ForEach(AgentAppearance.allCases) { appearance in Text(preferences.appearanceName(appearance)).tag(appearance) }
            } label: { Label(preferences.text("外观", "Appearance"), systemImage: "sun.max") }
            .accessibilityIdentifier("settings.appearance")
            Picker(selection: $preferences.accent) {
                ForEach(AgentAccent.allCases) { accent in AccentMenuLabel(accent: accent).tag(accent) }
            } label: { Label(preferences.text("强调色", "Accent color"), systemImage: "paintpalette") }
            .accessibilityIdentifier("settings.accent")
        }
    }
}
