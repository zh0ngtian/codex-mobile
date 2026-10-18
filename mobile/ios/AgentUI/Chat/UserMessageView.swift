import SwiftUI

struct UserMessageView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let message: ChatMessage
    let conversationID: UUID
    @Environment(\.colorScheme) private var colorScheme
    @State private var showTimestamp = false
    private static let leadingSpace: CGFloat = 30
    private static let rowSpacing: CGFloat = 8
    private static let horizontalPadding: CGFloat = 16
    private var displayText: String { UserMessageText.visible(message.text) }
    var body: some View {
        HStack(spacing: Self.rowSpacing) {
            Spacer(minLength: Self.leadingSpace)
            VStack(alignment: .trailing, spacing: 6) {
                VStack(alignment: .leading, spacing: 8) {
                    if !displayText.isEmpty {
                        Text(displayText).font(AgentTheme.body)
                            .foregroundStyle(preferences.accent.userMessageText(in: colorScheme))
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                    if !message.attachments.isEmpty { MessageAttachmentCards(attachments: message.attachments) }
                }
                .padding(.horizontal, Self.horizontalPadding).padding(.vertical, 10)
                .background(preferences.accent.userMessageBackground(in: colorScheme), in: .rect(cornerRadius: 23))
                .contentShape(.rect)
                .onTapGesture { showTimestamp.toggle() }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("message.user-bubble")
                .contextMenu {
                    Group {
                        Button(preferences.text("复制", "Copy"), systemImage: "doc.on.doc") { Clipboard.copy(message.text); session.toast = preferences.text("已复制", "Copied") }
                        if session.canEditHistory(conversationID) {
                            Button(preferences.text("编辑", "Edit"), systemImage: "pencil") { session.beginHistoryEdit(conversationID: conversationID, messageID: message.id) }
                        }
                    }
                    .tint(AgentTheme.ink)
                }
                if showTimestamp && !message.timestampLabel.isEmpty {
                    Text(message.timestampLabel).font(.body).foregroundStyle(.secondary)
                        .accessibilityIdentifier("message.user-time")
                }
            }
        }
    }
}
