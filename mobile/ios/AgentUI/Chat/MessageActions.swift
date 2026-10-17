import SwiftUI

struct MessageActions: View {
    let message: ChatMessage
    var body: some View {
        if !message.timestamp.isEmpty || !message.duration.isEmpty {
            HStack(spacing: 8) {
                if !message.timestamp.isEmpty { Text(message.createdAt, format: .dateTime.hour().minute()).font(AgentTheme.caption) }
                if !message.duration.isEmpty { Text(message.duration).font(AgentTheme.caption) }
            }
            .foregroundStyle(.secondary)
        }
    }
}
