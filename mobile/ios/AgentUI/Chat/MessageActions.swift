import SwiftUI

struct MessageActions: View {
    let message: ChatMessage
    var body: some View {
        if !message.timestamp.isEmpty {
            Text(message.timestampLabel)
                .font(AgentTheme.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("message.reply-time")
        }
    }
}
