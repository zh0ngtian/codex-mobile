import SwiftUI

struct SidebarSearchField: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @FocusState private var focused: Bool

    var body: some View {
        @Bindable var session = session
        HStack(spacing: 4) {
            TextField(preferences.text("搜索", "Search"), text: $session.searchText)
                .font(AgentTheme.body)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($focused)
                .accessibilityLabel(preferences.text("搜索当前设备范围内的会话", "Search conversations in this device scope"))
                .accessibilityIdentifier("sidebar.searchField")
            if !session.searchText.isEmpty {
                Button { session.searchText = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(width: 22, height: 36)
                }
                .accessibilityLabel(preferences.text("清空搜索", "Clear search"))
            }
        }
        .padding(.horizontal, 7)
        .frame(minHeight: 38)
        .background(AgentTheme.settings, in: .rect(cornerRadius: 10))
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .defaultFocus($focused, true)
        .task { focused = true }
    }
}
