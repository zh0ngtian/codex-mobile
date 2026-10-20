import SwiftUI

struct ScrollToBottomButton: View {
    @Environment(AppPreferences.self) private var preferences
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.down")
                .font(.system(size: 15))
                .foregroundStyle(AgentTheme.ink)
                .frame(width: 16, height: 16)
        }
        .modifier(AgentGlassButton(circular: true))
        .controlSize(.regular)

        .accessibilityLabel(preferences.text("回到底部", "Scroll to bottom"))
        .accessibilityIdentifier("conversation.scrollToBottom")
    }
}
