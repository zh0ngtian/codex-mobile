import SwiftUI

struct SidebarScreen: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @ScaledMetric(relativeTo: .body) private var chatTextSize: CGFloat = 18.25
    @ScaledMetric(relativeTo: .body) private var chatIconSize: CGFloat = 21

    // 粉色玻璃会与背景合成，局部加深 tint 以贴近参考；其他主题沿用原强调色。
    private var chatTint: Color {
        preferences.accent == .pink ? Color(red: 1, green: 0.14, blue: 0.60) : preferences.accent.color
    }

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
                    HStack(spacing: 12) {
                        Image(systemName: "square.and.pencil")
                            .font(.system(size: chatIconSize, weight: .regular))
                        Text("Chat")
                            .font(.system(size: chatTextSize, weight: .semibold))
                    }
                    .foregroundStyle(preferences.accent.foreground)
                    .padding(.horizontal, 5.5)
                    .frame(minHeight: 31)
                }
                .modifier(AgentGlassButton(prominent: true))
                .controlSize(.regular)
                .tint(chatTint)
                .clipShape(.capsule)
                .overlay {
                    Capsule()
                        .fill(LinearGradient(stops: [
                            .init(color: .white.opacity(0.12), location: 0),
                            .init(color: .white.opacity(0.025), location: 0.16),
                            .init(color: .clear, location: 0.32),
                            .init(color: .clear, location: 1)
                        ], startPoint: .top, endPoint: .bottom))
                        .overlay {
                            Capsule().strokeBorder(LinearGradient(colors: [.white.opacity(0.55), .white.opacity(0.2)],
                                                                  startPoint: .top, endPoint: .bottom), lineWidth: 0.8)
                        }
                        .allowsHitTesting(false)
                }
                .shadow(color: .black.opacity(0.02), radius: 2, y: 1)
                .accessibilityLabel(preferences.text("Chat，开始新对话", "Chat, start a new conversation"))
                .accessibilityIdentifier("sidebar.askCodex")
                Spacer()
                SidebarIconButton(systemImage: "gearshape", title: preferences.text("设置", "Settings"),
                                  identifier: "sidebar.settings") { session.settingsPresented = true }
            }
            .padding(.leading, 34)
            .padding(.trailing, 20)
            .padding(.top, 12)
        }
        .background(AgentTheme.page)
        .foregroundStyle(AgentTheme.ink)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sidebar.panel")
    }
}
