import SwiftUI

struct UserMessageView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let message: ChatMessage
    let conversationID: UUID
    @State private var expanded = false
    @State private var fullHeight: CGFloat = 0
    @State private var visibleHeight: CGFloat = 0
    private var displayText: String { UserMessageText.visible(message.text) }
    var body: some View {
        HStack {
            Spacer(minLength: 30)
            VStack(alignment: .leading, spacing: 8) {
                if !displayText.isEmpty {
                    Text(displayText).font(AgentTheme.body.weight(.medium))
                        .foregroundStyle(preferences.accent.color)
                        .lineLimit(expanded ? nil : 6).textSelection(.enabled)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { visibleHeight = $0 }
                        .background {
                            Text(displayText).font(AgentTheme.body.weight(.medium))
                                .fixedSize(horizontal: false, vertical: true)
                                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fullHeight = $0 }
                                .hidden().accessibilityHidden(true)
                        }
                }
                if expanded || fullHeight > visibleHeight + 1 {
                    Button(expanded ? preferences.text("收起", "Show less") : preferences.text("展开更多", "Show more")) { expanded.toggle() }
                        .font(.caption.bold()).frame(minHeight: 44)
                }
                if !message.attachments.isEmpty { MessageAttachmentCards(attachments: message.attachments) }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(preferences.accent.color.opacity(0.075), in: .rect(cornerRadius: 23))
            .contextMenu {
                Group {
                    Button(preferences.text("复制", "Copy"), systemImage: "doc.on.doc") { Clipboard.copy(message.text); session.toast = preferences.text("已复制", "Copied") }
                    if session.canEditHistory(conversationID) {
                        Button(preferences.text("编辑", "Edit"), systemImage: "pencil") { session.beginHistoryEdit(conversationID: conversationID, messageID: message.id) }
                    }
                }
                .tint(AgentTheme.ink)
            }
        }
    }
}
