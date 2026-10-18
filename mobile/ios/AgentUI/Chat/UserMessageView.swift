import SwiftUI

struct UserMessageView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let message: ChatMessage
    let conversationID: UUID
    @Environment(\.colorScheme) private var colorScheme
    @State private var showTimestamp = false
    @State private var expanded = false
    @State private var fullHeight: CGFloat = 0
    @State private var visibleHeight: CGFloat = 0
    @State private var fullTextWidth: CGFloat = 0
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
                            .lineLimit(expanded ? nil : 12).textSelection(.enabled)
                            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { visibleHeight = $0 }
                    }
                    if expanded || fullHeight > visibleHeight + 1 {
                        Button(expanded ? preferences.text("收起", "Show less") : preferences.text("展开更多", "Show more")) { expanded.toggle() }
                            .buttonStyle(.plain)
                            .font(AgentTheme.body).frame(minHeight: 44)
                            .foregroundStyle(preferences.accent.userMessageText(in: colorScheme))
                    }
                    if !message.attachments.isEmpty { MessageAttachmentCards(attachments: message.attachments) }
                }
                .frame(minWidth: fullTextWidth, alignment: .leading)
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
        .overlay {
            // 完整正文在相同的最大可用宽度下测量，不受十二行折叠及按钮文案影响。
            Text(displayText).font(AgentTheme.body)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGSize.self) { $0.size } action: { size in
                    fullTextWidth = size.width; fullHeight = size.height
                }
                .padding(.leading, Self.leadingSpace + Self.rowSpacing)
                .padding(.horizontal, Self.horizontalPadding)
                .hidden().accessibilityHidden(true).allowsHitTesting(false)
        }
    }
}
