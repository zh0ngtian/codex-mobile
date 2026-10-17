import SwiftUI

struct SidebarScreen: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences

    var body: some View {
        VStack(spacing: 0) {
            HomeHeader()
            Divider()
            if session.searchVisible { SidebarSearchField() }
            ScrollView {
                SidebarConversationList()
                    .padding(.horizontal, 8)
                    .padding(.top, 10)
                    .padding(.bottom, 16)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            Divider()
            Button { session.beginNewConversation() } label: {
                HStack(spacing: 6) {
                    Image(systemName: "square.and.pencil").font(AgentTheme.body.weight(.semibold))
                    Text("Ask Codex").font(AgentTheme.body.weight(.semibold)).lineLimit(1)
                }
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(AgentTheme.card, in: .rect(cornerRadius: 15))
                .overlay { RoundedRectangle(cornerRadius: 15).strokeBorder(AgentTheme.line) }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(preferences.text("Ask Codex，开始新对话", "Ask Codex, start a new conversation"))
            .accessibilityIdentifier("sidebar.askCodex")
            .padding(.horizontal, 8)
            .padding(.vertical, 10)
        }
        .background(AgentTheme.page)
        .foregroundStyle(AgentTheme.ink)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sidebar.panel")
    }
}
