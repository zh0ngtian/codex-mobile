import SwiftUI

struct MessageActions: View {
    let message: ChatMessage
    var body: some View {
        if !message.timestamp.isEmpty || !message.duration.isEmpty {
            HStack(spacing: 8) {
                if !message.timestamp.isEmpty { Text(message.timestampLabel).font(AgentTheme.caption).accessibilityIdentifier("message.reply-time") }
                if !message.duration.isEmpty { Text(message.duration).font(AgentTheme.caption) }
            }
            .foregroundStyle(.secondary)
        }
    }
}
