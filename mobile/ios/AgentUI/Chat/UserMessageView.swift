import SwiftUI

struct UserMessageView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let message: ChatMessage
    let conversationID: UUID
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.messageFlightImages) private var firstImages
    @Environment(\.messageFlightPreviewID) private var flightPreviewID
    @State private var showTimestamp = false
    @State private var selectionRequest: UUID?
    private static let leadingSpace: CGFloat = 30
    private static let rowSpacing: CGFloat = 8
    private static let horizontalPadding: CGFloat = 16
    private var displayText: String { UserMessageText.visible(message.text) }
    var body: some View {
        HStack(spacing: Self.rowSpacing) {
            Spacer(minLength: Self.leadingSpace)
            VStack(alignment: .trailing, spacing: 6) {
                NativeMessageContextMenu(copyTitle: preferences.text("复制", "Copy"),
                    editTitle: preferences.text("编辑", "Edit"), selectTitle: preferences.text("选择文本", "Select Text"),
                    canEdit: session.canEditHistory(conversationID), canSelect: !displayText.isEmpty, menuEnabled: selectionRequest == nil,
                    copy: { Clipboard.copy(message.rawText ?? message.text); session.toast = preferences.text("已复制", "Copied") },
                    edit: { session.beginHistoryEdit(conversationID: conversationID, messageID: message.id) },
                    select: { selectionRequest = UUID() }) {
                    VStack(alignment: .leading, spacing: 8) {
                        if !message.references.isEmpty { MessageReferenceCards(references: message.references) }
                        if !displayText.isEmpty {
                            NativeSelectableText(text: NativeSelectableMarkdown.inline(displayText, color: UIColor(preferences.accent.userMessageText(in: colorScheme))), identifier: "user.selectable", openLink: openLink, onTap: { showTimestamp.toggle() }, fitsContentWidth: true,
                                selectionEnabled: selectionRequest != nil, selectionRequest: selectionRequest,
                                onSelectionEnd: { selectionRequest = nil })
                                .selectionQuoteSource(message.quoteSource)
                        }
                        if !message.attachments.isEmpty {
                            MessageAttachmentCards(attachments: message.attachments,
                                previewImages: flightPreviewID == message.id ? firstImages : [])
                        }
                    }
                    .padding(.horizontal, Self.horizontalPadding).padding(.vertical, 10)
                    .background {
                        RoundedRectangle(cornerRadius: 23)
                            .fill(preferences.accent.userMessageBackground(in: colorScheme))
                            .contentShape(.rect)
                            .onTapGesture {
                                if selectionRequest != nil { selectionRequest = nil }
                                else { showTimestamp.toggle() }
                            }
                    }
                    .contentShape(.rect)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("message.user-bubble")
                    .environment(session)
                    .environment(preferences)
                }

                if showTimestamp && !message.timestampLabel.isEmpty {
                    Text(message.timestampLabel).font(.body).foregroundStyle(.secondary)
                        .accessibilityIdentifier("message.user-time")
                }
            }
        }
    }

    private func openLink(_ url: URL) {
        if ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        } else { session.nativeStore?.command("file.open", ["href": .string(url.absoluteString)]) }
    }
}
