import SwiftUI

struct MessageActions: View {
    @Environment(AppPreferences.self) private var preferences
    let message: ChatMessage
    var includeCommentary = false
    @State private var copied = false
    var body: some View {
        HStack(spacing: 8) {
            Button(copied ? preferences.text("已复制", "Copied") : preferences.text("复制回复", "Copy response"),
                   systemImage: copied ? "checkmark" : "square.on.square", action: copy)
                .labelStyle(.iconOnly).frame(width: 44, height: 44)
            if !message.timestamp.isEmpty { Text(message.createdAt, format: .dateTime.hour().minute()).font(AgentTheme.caption) }
            if !message.duration.isEmpty { Text(message.duration).font(AgentTheme.caption) }
        }
        .foregroundStyle(.secondary).buttonStyle(.plain)
    }
    private func copy() {
        let progress = includeCommentary ? message.commentary.map(\.text) : []
        let code = message.outputs.filter { $0.kind == .code }.map(\.content)
        Clipboard.copy((progress + [message.text] + code).joined(separator: "\n\n"))
        copied = true
    }
}
