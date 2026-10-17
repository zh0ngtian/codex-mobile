import SwiftUI

struct ScrollToBottomButton: View {
    @Environment(AppPreferences.self) private var preferences
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.down")
                .font(.system(size: 15))
                .foregroundStyle(AgentTheme.ink)
                .frame(width: 28, height: 28)
                .background(.regularMaterial, in: .circle)
                .overlay { Circle().strokeBorder(AgentTheme.line, lineWidth: 0.5) }
                .shadow(color: .black.opacity(0.06), radius: 3, y: 1)
                .frame(width: 44, height: 44)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(preferences.text("回到底部", "Scroll to bottom"))
        .accessibilityIdentifier("conversation.scrollToBottom")
    }
}
