import SwiftUI

struct SidebarScreen: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences

    var body: some View {
        VStack(spacing: 0) {
            HomeHeader()
            if session.searchVisible { SidebarSearchField() }
            ScrollView {
                SidebarConversationList()
                    .padding(.horizontal, 8)
                    .padding(.top, 10)
                    .padding(.bottom, 16)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            HStack {
                Button { session.beginNewConversation() } label: {
                    Label("Chat", systemImage: "square.and.pencil")
                        .font(.body).foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .frame(minHeight: 20)
                }
                .modifier(AgentGlassButton(prominent: true))
                .controlSize(.large)
                .tint(preferences.accent.color)
                .accessibilityLabel(preferences.text("Chat，开始新对话", "Chat, start a new conversation"))
                .accessibilityIdentifier("sidebar.askCodex")
                Spacer()
                Button { session.settingsPresented = true } label: {
                    Image(systemName: "gearshape").font(.title3)
                        .frame(width: 20, height: 20)
                }
                .modifier(AgentGlassButton(circular: true))
                .controlSize(.large)
                .tint(AgentTheme.ink)
                .accessibilityLabel(preferences.text("设置", "Settings"))
                .accessibilityIdentifier("sidebar.settings")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(AgentTheme.page)
        .foregroundStyle(AgentTheme.ink)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sidebar.panel")
    }
}
