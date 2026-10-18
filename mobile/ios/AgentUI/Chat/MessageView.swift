import SwiftUI

struct MessageView: View {
    @Environment(AppSession.self) private var session
    let message: ChatMessage
    let conversationID: UUID
    @State private var progressExpanded = false
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if message.isUser {
                if session.historyEdit?.messageID == message.id { HistoryEditView(message: message) }
                else { UserMessageView(message: message, conversationID: conversationID) }
            } else {
                if !message.commentary.isEmpty {
                    CommentaryHistoryView(entries: message.commentary, expanded: $progressExpanded)
                }
                if !message.text.isEmpty { AssistantBody(text: message.text) }
                LiveBusinessBlocks(messageID: message.id)
                ForEach(message.outputs.filter { $0.kind == .code }) { output in
                    CodeCard(code: output.content, language: output.name)
                }
                if !message.outputs.isEmpty { OutputCards(items: message.outputs) }
                if MessagePresentation.showsResponseActions(for: message) {
                    MessageActions(message: message)
                }
                if message.kind == "commentary" { Divider().accessibilityIdentifier("commentary.separator") }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
